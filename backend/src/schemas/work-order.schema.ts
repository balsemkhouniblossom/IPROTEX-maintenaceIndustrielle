import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WorkOrderDocument = WorkOrder & Document;

export type WorkOrderLifecycleAction =
  | 'closed_for_validation'
  | 'validated'
  | 'rejected'
  | 'returned';

/**
 * Mirrors `MaintenancePlanLifecycleEntry` (maintenance-plan.schema.ts) so the
 * same shape can be flattened by the shared Audit History report. Unlike
 * MaintenancePlan, WorkOrder.status is a free string rather than an enum, so
 * from_status/to_status stay plain strings here.
 */
@Schema({ _id: false })
export class WorkOrderLifecycleEntry {
  @Prop({ required: true })
  action: WorkOrderLifecycleAction;

  @Prop()
  from_status?: string;

  @Prop({ required: true })
  to_status: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  actor_user_id?: Types.ObjectId;

  @Prop()
  reason?: string;

  @Prop({ type: Date, default: Date.now, required: true })
  at: Date;
}

const WorkOrderLifecycleEntrySchema = SchemaFactory.createForClass(
  WorkOrderLifecycleEntry,
);

@Schema()
export class WorkOrder {
  @Prop({ required: true, unique: true })
  ot_id: string;

  @Prop({ type: Types.ObjectId, ref: 'Machine', required: true })
  machine_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Module' })
  module_id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  technician_id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'MaintenancePlan' })
  plan_id?: Types.ObjectId;

  @Prop()
  description?: string;

  @Prop()
  type_maintenance?: string;

  @Prop({ required: true })
  status: string;

  @Prop()
  priorite?: string;

  @Prop()
  code_panne?: string;

  @Prop({ type: Date, required: true })
  date_created: Date;

  @Prop({ type: Date })
  date_start?: Date;

  @Prop({ type: Date })
  scheduled_date?: Date;

  @Prop({ type: Date })
  due_date?: Date;

  @Prop({ type: Date })
  execution_date?: Date;

  @Prop({ type: Date })
  date_end?: Date;

  @Prop({ type: Date })
  date_closed?: Date;

  @Prop({ type: Types.ObjectId, ref: 'WorkOrder' })
  recurrence_source_occurrence_id?: Types.ObjectId;

  @Prop({ type: Date })
  original_due_date?: Date;

  @Prop()
  reschedule_reason?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  rescheduled_by?: Types.ObjectId;

  @Prop({ type: Date })
  rescheduled_at?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  validated_by?: Types.ObjectId;

  @Prop({ type: Date })
  validated_at?: Date;

  @Prop({ type: [WorkOrderLifecycleEntrySchema], default: [] })
  lifecycle_history: WorkOrderLifecycleEntry[];
}

export const WorkOrderSchema = SchemaFactory.createForClass(WorkOrder);
WorkOrderSchema.index({ machine_id: 1, status: 1 });
WorkOrderSchema.index({ technician_id: 1, status: 1 });
WorkOrderSchema.index({ date_created: -1, status: 1 });
WorkOrderSchema.index({ due_date: 1, status: 1 });
WorkOrderSchema.index({
  machine_id: 1,
  plan_id: 1,
  type_maintenance: 1,
  due_date: 1,
});
// Supports the Admin work orders list's status+priority filters and
// combined-status/date sort.
WorkOrderSchema.index({ status: 1, priorite: 1, date_created: -1 });
