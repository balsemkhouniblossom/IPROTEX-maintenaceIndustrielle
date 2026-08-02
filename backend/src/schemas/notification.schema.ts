import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Role } from './user.schema';

export type NotificationDocument = Notification & Document;

export enum NotificationType {
  WORK_ORDER_CREATED = 'work_order_created',
  PREVENTIVE_DUE = 'preventive_due',
  PREVENTIVE_OVERDUE = 'preventive_overdue',
  OVERDUE_ESCALATION = 'overdue_escalation',
  CORRECTIVE_AWAITING_VALIDATION = 'corrective_awaiting_validation',
  VALIDATION_APPROVED = 'validation_approved',
  VALIDATION_REJECTED = 'validation_rejected',
  INTERVENTION_COMPLETED = 'intervention_completed',
  PART_REQUEST_CREATED = 'part_request_created',
  PART_REQUEST_DECISION = 'part_request_decision',
  STOCK_ALERT = 'stock_alert',
  LUBRICATION_DUE = 'lubrication_due',
  SENSOR_ALERT = 'sensor_alert',
  DUPLICATE_WORK_ORDER = 'duplicate_work_order',
  DEVICE_FAULT = 'device_fault',
  DEVICE_OFFLINE = 'device_offline',
  REPORT_READY = 'report_ready',
}

/**
 * A single persisted in-app notification. Every notification is targeted
 * either at one specific user (`recipient_user_id`, e.g. "your report was
 * approved") or broadcast to everyone holding a role (`recipient_role`, e.g.
 * "a corrective report needs Admin validation") — at least one of the two is
 * always set. `dedupe_key` is unique and is how the same real-world event
 * (a work order becoming overdue on a given day, a specific report being
 * approved, etc.) is guaranteed to ever produce at most one notification,
 * even across server restarts or concurrent cron ticks.
 */
@Schema({ timestamps: true })
export class Notification {
  @Prop({ required: true, unique: true })
  notification_id: string;

  @Prop({ type: String, enum: Object.values(NotificationType), required: true })
  type: NotificationType;

  @Prop({ required: true })
  title: string;

  @Prop()
  message?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  recipient_user_id?: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(Role) })
  recipient_role?: Role;

  @Prop({ type: Types.ObjectId, ref: 'WorkOrder' })
  work_order_id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Machine' })
  machine_id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  reference_id?: Types.ObjectId;

  @Prop({ required: true, unique: true })
  dedupe_key: string;

  @Prop({ type: Boolean, default: false, required: true })
  is_read: boolean;

  @Prop({ type: Date })
  read_at?: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ recipient_user_id: 1, is_read: 1, createdAt: -1 });
NotificationSchema.index({ recipient_role: 1, is_read: 1, createdAt: -1 });
NotificationSchema.index(
  { recipient_user_id: 1, createdAt: -1 },
  { name: 'notifications_user_created_desc' },
);
NotificationSchema.index(
  { recipient_role: 1, createdAt: -1 },
  { name: 'notifications_role_created_desc' },
);
