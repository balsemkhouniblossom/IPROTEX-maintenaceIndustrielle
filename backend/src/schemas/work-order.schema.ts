import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WorkOrderDocument = WorkOrder & Document;

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
