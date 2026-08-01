import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import {
  Notification,
  NotificationDocument,
  NotificationType,
} from '../schemas/notification.schema';
import { Role } from '../schemas/user.schema';
import { CounterService } from '../counters/counter.service';

export interface CreateNotificationInput {
  dedupeKey: string;
  type: NotificationType;
  title: string;
  message?: string;
  recipientUserId?: string;
  recipientRole?: Role;
  workOrderId?: string;
  machineId?: string;
  referenceId?: string;
}

@Injectable()
export class NotificationCenterService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    private readonly counterService: CounterService,
  ) {}

  /**
   * Creates a notification for a real-world event unless one already exists
   * for the same `dedupeKey` — the sole, permanent duplicate-prevention
   * mechanism (callers encode the recurrence dimension, e.g. a date or
   * status, directly into the key). Returns `null` when the event was
   * already recorded, so callers can tell a genuine no-op from a failure.
   * The unique index on `dedupe_key` is the authoritative guard (races
   * between the pre-check and the insert fail safe here, not silently).
   */
  async createIfNotExists(
    input: CreateNotificationInput,
  ): Promise<NotificationDocument | null> {
    if (!input.recipientUserId && !input.recipientRole) {
      throw new Error(
        'A notification must have a recipientUserId or a recipientRole',
      );
    }

    const alreadyExists = await this.notificationModel
      .exists({ dedupe_key: input.dedupeKey })
      .exec();
    if (alreadyExists) {
      return null;
    }

    try {
      const notification = await this.notificationModel.create({
        notification_id: await this.generateNotificationCode(),
        type: input.type,
        title: input.title,
        message: input.message,
        recipient_user_id: input.recipientUserId
          ? new Types.ObjectId(input.recipientUserId)
          : undefined,
        recipient_role: input.recipientRole,
        work_order_id: input.workOrderId
          ? new Types.ObjectId(input.workOrderId)
          : undefined,
        machine_id: input.machineId
          ? new Types.ObjectId(input.machineId)
          : undefined,
        reference_id: input.referenceId
          ? new Types.ObjectId(input.referenceId)
          : undefined,
        dedupe_key: input.dedupeKey,
        is_read: false,
      });
      return notification;
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        return null;
      }
      throw error;
    }
  }

  async listForUser(
    userId: string,
    role: string,
    page: number,
    limit: number,
    unreadOnly?: boolean,
  ): Promise<PaginatedResponse<Notification>> {
    const query: Record<string, unknown> = {
      ...this.visibilityScope(userId, role),
    };
    if (unreadOnly) {
      query.is_read = false;
    }

    const skip = (page - 1) * limit;
    const [items, totalItems] = await Promise.all([
      this.notificationModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.notificationModel.countDocuments(query).exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  async unreadCount(userId: string, role: string): Promise<number> {
    return this.notificationModel
      .countDocuments({ ...this.visibilityScope(userId, role), is_read: false })
      .exec();
  }

  async markAsRead(
    userId: string,
    role: string,
    notificationId: string,
  ): Promise<NotificationDocument> {
    this.assertValidObjectId(notificationId);
    const updated = await this.notificationModel
      .findOneAndUpdate(
        { _id: notificationId, ...this.visibilityScope(userId, role) },
        { $set: { is_read: true, read_at: new Date() } },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException('Notification not found');
    }
    return updated;
  }

  async markAllAsRead(
    userId: string,
    role: string,
  ): Promise<{ modifiedCount: number }> {
    const result = await this.notificationModel
      .updateMany(
        { ...this.visibilityScope(userId, role), is_read: false },
        { $set: { is_read: true, read_at: new Date() } },
      )
      .exec();
    return { modifiedCount: result.modifiedCount || 0 };
  }

  async clearOne(
    userId: string,
    role: string,
    notificationId: string,
  ): Promise<void> {
    this.assertValidObjectId(notificationId);
    const result = await this.notificationModel
      .deleteOne({ _id: notificationId, ...this.visibilityScope(userId, role) })
      .exec();
    if (!result.deletedCount) {
      throw new NotFoundException('Notification not found');
    }
  }

  async clearAll(
    userId: string,
    role: string,
  ): Promise<{ deletedCount: number }> {
    const result = await this.notificationModel
      .deleteMany(this.visibilityScope(userId, role))
      .exec();
    return { deletedCount: result.deletedCount || 0 };
  }

  private visibilityScope(
    userId: string,
    role: string,
  ): Record<string, unknown> {
    const clauses: Record<string, unknown>[] = [{ recipient_role: role }];
    if (Types.ObjectId.isValid(userId)) {
      clauses.push({ recipient_user_id: new Types.ObjectId(userId) });
    }
    return { $or: clauses };
  }

  private assertValidObjectId(value: string): void {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException('Invalid notification id');
    }
  }

  private async generateNotificationCode(): Promise<string> {
    const sequence = await this.counterService.getNextSequence('notification');
    return `NOTIF-${sequence.toString().padStart(6, '0')}`;
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: number }).code === 11000
    );
  }
}
