import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MachineMaintenanceMttrEntryDocument = MachineMaintenanceMttrEntry &
  Document;

export type MachineMaintenanceMttrSource = 'OPERATOR_REPORT' | 'ADMIN_MANUAL';

@Schema({ timestamps: true })
export class MachineMaintenanceMttrEntry {
  @Prop({ type: Types.ObjectId, ref: 'Machine', required: true })
  machine_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'MachineType', required: true })
  machine_type_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WorkOrder' })
  work_order_id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'InterventionReport' })
  intervention_report_id?: Types.ObjectId;

  @Prop({ type: Date, required: true })
  started_at: Date;

  @Prop({ type: Date, required: true })
  ended_at: Date;

  @Prop({ type: Number, required: true, min: 0 })
  duration_minutes: number;

  @Prop({ required: true, enum: ['OPERATOR_REPORT', 'ADMIN_MANUAL'] })
  source: MachineMaintenanceMttrSource;

  @Prop({ maxlength: 2000 })
  description?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  entered_by: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  updated_by?: Types.ObjectId;
}

export const MachineMaintenanceMttrEntrySchema = SchemaFactory.createForClass(
  MachineMaintenanceMttrEntry,
);
MachineMaintenanceMttrEntrySchema.index({ machine_type_id: 1, ended_at: 1 });
MachineMaintenanceMttrEntrySchema.index({ machine_id: 1, ended_at: -1 });
MachineMaintenanceMttrEntrySchema.index(
  { intervention_report_id: 1 },
  { unique: true, sparse: true },
);
