import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AutomationJobLockDocument = AutomationJobLock & Document;

@Schema({ timestamps: true })
export class AutomationJobLock {
  @Prop({ required: true, unique: true })
  name: string;

  @Prop({ required: true })
  owner: string;

  @Prop()
  owner_id?: string;

  @Prop()
  run_id?: string;

  @Prop()
  acquired_at?: Date;

  @Prop()
  heartbeat_at?: Date;

  @Prop({ required: true })
  expires_at: Date;

  @Prop()
  status?: string;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;
}

export const AutomationJobLockSchema =
  SchemaFactory.createForClass(AutomationJobLock);

AutomationJobLockSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
AutomationJobLockSchema.index({ name: 1, owner_id: 1, run_id: 1 });
