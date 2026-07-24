import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { NotificationCenterService } from './notification-center.service';
import { NotificationType } from '../schemas/notification.schema';
import { Role } from '../schemas/user.schema';

function queryResult<T>(value: T) {
  return {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('NotificationCenterService', () => {
  const userId = new Types.ObjectId().toHexString();
  let notificationModel: {
    exists: jest.Mock;
    create: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
    findOneAndUpdate: jest.Mock;
    updateMany: jest.Mock;
    deleteOne: jest.Mock;
    deleteMany: jest.Mock;
  };
  let counterService: { getNextSequence: jest.Mock };
  let service: NotificationCenterService;

  beforeEach(() => {
    notificationModel = {
      exists: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      find: jest.fn().mockReturnValue(queryResult([])),
      countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) }),
      findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      updateMany: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      }),
      deleteOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      }),
      deleteMany: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      }),
    };
    counterService = { getNextSequence: jest.fn().mockResolvedValue(1) };

    service = new NotificationCenterService(
      notificationModel as never,
      counterService as never,
    );
  });

  describe('createIfNotExists', () => {
    it('creates a notification with a generated human-readable id when no duplicate exists', async () => {
      const result = await service.createIfNotExists({
        dedupeKey: 'work_order_created:abc',
        type: NotificationType.WORK_ORDER_CREATED,
        title: 'New work order',
        recipientUserId: userId,
      });

      expect(notificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          notification_id: 'NOTIF-000001',
          type: NotificationType.WORK_ORDER_CREATED,
          title: 'New work order',
          recipient_user_id: new Types.ObjectId(userId),
          dedupe_key: 'work_order_created:abc',
          is_read: false,
        }),
      );
      expect(result).not.toBeNull();
    });

    it('returns null instead of creating a second notification for the same dedupe key (pre-check)', async () => {
      notificationModel.exists.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      });

      const result = await service.createIfNotExists({
        dedupeKey: 'overdue:abc:2026-01-01',
        type: NotificationType.PREVENTIVE_OVERDUE,
        title: 'Overdue',
        recipientRole: Role.ADMIN,
      });

      expect(notificationModel.create).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('returns null instead of throwing when a race loses to the unique dedupe_key index', async () => {
      const duplicateKeyError = Object.assign(new Error('E11000 duplicate key'), {
        code: 11000,
      });
      notificationModel.create.mockRejectedValue(duplicateKeyError);

      const result = await service.createIfNotExists({
        dedupeKey: 'stock_alert:abc:5',
        type: NotificationType.STOCK_ALERT,
        title: 'Stock alert',
        recipientRole: Role.ADMIN,
      });

      expect(result).toBeNull();
    });

    it('rejects a notification with neither a recipient user nor a recipient role', async () => {
      await expect(
        service.createIfNotExists({
          dedupeKey: 'x',
          type: NotificationType.WORK_ORDER_CREATED,
          title: 'x',
        }),
      ).rejects.toThrow();
      expect(notificationModel.create).not.toHaveBeenCalled();
    });
  });

  describe('listForUser / unreadCount', () => {
    it('scopes the visibility query to the user own notifications and their role broadcast', async () => {
      await service.listForUser(userId, Role.OPERATOR, 1, 20);

      expect(notificationModel.find).toHaveBeenCalledWith({
        $or: [
          { recipient_role: Role.OPERATOR },
          { recipient_user_id: new Types.ObjectId(userId) },
        ],
      });
    });

    it('adds an is_read filter when unreadOnly is requested', async () => {
      await service.listForUser(userId, Role.OPERATOR, 1, 20, true);

      expect(notificationModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ is_read: false }),
      );
    });

    it('counts only this users unread notifications', async () => {
      await service.unreadCount(userId, Role.TECHNICIAN);

      expect(notificationModel.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ is_read: false }),
      );
    });
  });

  describe('markAsRead / markAllAsRead', () => {
    it('throws NotFoundException when the notification is not visible to this user', async () => {
      await expect(
        service.markAsRead(userId, Role.OPERATOR, new Types.ObjectId().toHexString()),
      ).rejects.toThrow(NotFoundException);
    });

    it('marks a visible notification as read', async () => {
      const notificationId = new Types.ObjectId().toHexString();
      notificationModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: notificationId, is_read: true }),
      });

      const result = await service.markAsRead(userId, Role.OPERATOR, notificationId);

      expect(notificationModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: notificationId }),
        expect.objectContaining({
          $set: expect.objectContaining({ is_read: true }),
        }),
        { new: true },
      );
      expect(result.is_read).toBe(true);
    });

    it('marks every unread visible notification as read in bulk', async () => {
      notificationModel.updateMany.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 3 }),
      });

      const result = await service.markAllAsRead(userId, Role.ADMIN);

      expect(result.modifiedCount).toBe(3);
    });
  });

  describe('clearOne / clearAll', () => {
    it('throws NotFoundException when clearing a notification not visible to this user', async () => {
      await expect(
        service.clearOne(userId, Role.OPERATOR, new Types.ObjectId().toHexString()),
      ).rejects.toThrow(NotFoundException);
    });

    it('deletes a visible notification', async () => {
      notificationModel.deleteOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      });

      await expect(
        service.clearOne(userId, Role.OPERATOR, new Types.ObjectId().toHexString()),
      ).resolves.toBeUndefined();
    });

    it('deletes every notification visible to this user', async () => {
      notificationModel.deleteMany.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ deletedCount: 5 }),
      });

      const result = await service.clearAll(userId, Role.OPERATOR);

      expect(result.deletedCount).toBe(5);
    });
  });
});
