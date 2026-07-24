import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PreventiveTaskDocument = PreventiveTask & Document;

@Schema({ timestamps: true })
export class PreventiveTask {
  @Prop({ required: true, unique: true, trim: true })
  task_id!: string;

  @Prop({ type: Types.ObjectId, ref: 'MaintenancePlan' })
  plan_id?: Types.ObjectId;

  @Prop({ trim: true })
  plan_code?: string;

  @Prop({ type: Types.ObjectId, ref: 'Module' })
  module_id?: Types.ObjectId;

  @Prop({ required: true, trim: true })
  instruction!: string;

  @Prop({ trim: true })
  responsable?: string;

  @Prop({ enum: ['pending', 'completed'], default: 'pending' })
  status!: 'pending' | 'completed';

  @Prop({ trim: true })
  notes?: string;

  @Prop({ type: Date })
  completed_at?: Date;

  @Prop({ enum: ['plan', 'manual'], default: 'manual' })
  source!: 'plan' | 'manual';

  @Prop({ unique: true, sparse: true })
  source_key?: string;

  @Prop({ type: Date })
  deleted_at?: Date;
}

export const PreventiveTaskSchema =
  SchemaFactory.createForClass(PreventiveTask);
PreventiveTaskSchema.index({ status: 1, module_id: 1 });
PreventiveTaskSchema.index({ plan_id: 1 });
