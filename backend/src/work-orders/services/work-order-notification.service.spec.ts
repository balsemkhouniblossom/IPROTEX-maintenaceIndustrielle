import { Types } from 'mongoose';
import { NotificationType } from '../../schemas/notification.schema';
import { Role } from '../../schemas/user.schema';
import { WorkOrderNotificationService } from './work-order-notification.service';
import { NotificationCenterService } from '../../notification-center/notification-center.service';

describe('WorkOrderNotificationService', () => {
  let service: WorkOrderNotificationService;
  let notificationCenterService: {
    createIfNotExists: ReturnType<typeof jest.fn>;
  };

  beforeEach(() => {
    notificationCenterService = { createIfNotExists: jest.fn() };
    service = new WorkOrderNotificationService(
      notificationCenterService as any,
    );
  });

  describe('notifyCreated', () => {
    it('returns null when technician_id is missing', async () => {
      const result = await service.notifyCreated({});
      expect(result).toBeNull();
      expect(
        notificationCenterService.createIfNotExists,
      ).not.toHaveBeenCalled();
    });

    it('returns null when technician_id is an object without toString', async () => {
      const result = await service.notifyCreated({
        _id: '123',
        machine_id: '456',
      });
      expect(result).toBeNull();
    });

    it('creates notification with WORK_ORDER_CREATED type', async () => {
      const technicianId = new Types.ObjectId().toString();
      const woId = new Types.ObjectId().toString();
      await service.notifyCreated({
        technician_id: technicianId,
        _id: woId,
        ot_id: 'WO-001',
        machine_id: 'machine-1',
      });
      expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith({
        dedupeKey: `work_order_created:${woId}`,
        type: NotificationType.WORK_ORDER_CREATED,
        title: 'New work order WO-001 assigned',
        recipientUserId: technicianId,
        workOrderId: woId,
        machineId: 'machine-1',
      });
    });
  });

  describe('notifyValidationDecision', () => {
    it('creates approved notification', async () => {
      const technicianId = new Types.ObjectId().toString();
      await service.notifyValidationDecision({
        workOrderId: 'wo-1',
        action: 'approve',
        technicianId,
        otId: 'WO-001',
      });
      expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith({
        dedupeKey: 'validation_decision:wo-1:approve',
        type: NotificationType.VALIDATION_APPROVED,
        title: 'Your report for WO-001 was approved',
        recipientUserId: technicianId,
        workOrderId: 'wo-1',
      });
    });

    it('creates rejected notification', async () => {
      const technicianId = new Types.ObjectId().toString();
      await service.notifyValidationDecision({
        workOrderId: 'wo-1',
        action: 'reject',
        technicianId,
        otId: 'WO-001',
      });
      expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith({
        dedupeKey: 'validation_decision:wo-1:reject',
        type: NotificationType.VALIDATION_REJECTED,
        title: 'Your report for WO-001 was rejected',
        recipientUserId: technicianId,
        workOrderId: 'wo-1',
      });
    });
  });

  describe('notifyCorrectiveAwaitingValidation', () => {
    it('creates corrective awaiting validation notification for admin', async () => {
      await service.notifyCorrectiveAwaitingValidation({
        workOrderId: 'wo-1',
        otId: 'WO-001',
        reportId: 'report-1',
      });
      expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith({
        dedupeKey: 'corrective_awaiting_validation:wo-1',
        type: NotificationType.CORRECTIVE_AWAITING_VALIDATION,
        title: 'Corrective report for WO-001 is awaiting validation',
        recipientRole: Role.ADMIN,
        workOrderId: 'wo-1',
        referenceId: 'report-1',
      });
    });
  });

  describe('notifyPartRequestCreated', () => {
    it('creates part request notification for technician', async () => {
      await service.notifyPartRequestCreated({
        requestId: 'req-1',
        otId: 'WO-001',
        workOrderId: 'wo-1',
      });
      expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith({
        dedupeKey: 'part_request_created:req-1',
        type: NotificationType.PART_REQUEST_CREATED,
        title: 'A part was requested for work order WO-001',
        recipientRole: Role.TECHNICIAN,
        workOrderId: 'wo-1',
        referenceId: 'req-1',
      });
    });
  });

  describe('notifyPartRequestDecision', () => {
    it('creates approved part request notification', async () => {
      const requesterId = new Types.ObjectId().toString();
      await service.notifyPartRequestDecision({
        requestId: 'req-1',
        decision: 'approve',
        requesterUserId: requesterId,
        workOrderId: 'wo-1',
      });
      expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith({
        dedupeKey: 'part_request_decision:req-1:approve',
        type: NotificationType.PART_REQUEST_DECISION,
        title: 'Your part request was approved and reserved',
        recipientUserId: requesterId,
        workOrderId: 'wo-1',
        referenceId: 'req-1',
      });
    });

    it('creates rejected part request notification', async () => {
      const requesterId = new Types.ObjectId().toString();
      await service.notifyPartRequestDecision({
        requestId: 'req-1',
        decision: 'reject',
        requesterUserId: requesterId,
        workOrderId: 'wo-1',
      });
      expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith({
        dedupeKey: 'part_request_decision:req-1:reject',
        type: NotificationType.PART_REQUEST_DECISION,
        title: 'Your part request was rejected',
        recipientUserId: requesterId,
        workOrderId: 'wo-1',
        referenceId: 'req-1',
      });
    });

    it('creates cancelled part request notification', async () => {
      const requesterId = new Types.ObjectId().toString();
      await service.notifyPartRequestDecision({
        requestId: 'req-1',
        decision: 'cancel',
        requesterUserId: requesterId,
        workOrderId: 'wo-1',
      });
      expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith({
        dedupeKey: 'part_request_decision:req-1:cancel',
        type: NotificationType.PART_REQUEST_DECISION,
        title: 'Your reserved part request was cancelled',
        recipientUserId: requesterId,
        workOrderId: 'wo-1',
        referenceId: 'req-1',
      });
    });
  });
});
