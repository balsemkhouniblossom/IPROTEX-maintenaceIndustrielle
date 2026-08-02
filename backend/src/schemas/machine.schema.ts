import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MachineDocument = Machine & Document;

export type MachineLifecycleAction = 'created' | 'status_changed';

/** Mirrors WorkOrderLifecycleEntry/DocumentLifecycleEntry so it can be flattened by the same kind of history reporting/aggregation. */
@Schema({ _id: false })
export class MachineLifecycleEntry {
  @Prop({ required: true })
  action: MachineLifecycleAction;

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

const MachineLifecycleEntrySchema = SchemaFactory.createForClass(
  MachineLifecycleEntry,
);

@Schema({ timestamps: true })
export class Machine {
  @Prop({ required: true, unique: true })
  machine_id: string;

  @Prop({ type: Types.ObjectId, ref: 'MachineType', required: true })
  type_id: Types.ObjectId;

  @Prop({ required: true })
  serial_no: string;

  @Prop()
  reference?: string;

  @Prop({ type: Date })
  installation_date?: Date;

  @Prop()
  poids_kg?: number;

  @Prop()
  fabricant?: string;

  @Prop()
  model?: string;

  @Prop()
  location?: string;

  @Prop({ required: true })
  status: string;

  @Prop({ type: [MachineLifecycleEntrySchema], default: [] })
  lifecycle_history: MachineLifecycleEntry[];
}

export const MachineSchema = SchemaFactory.createForClass(Machine);
MachineSchema.index({ type_id: 1, status: 1 });
MachineSchema.index({ serial_no: 1 });
