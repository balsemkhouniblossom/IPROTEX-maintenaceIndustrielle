import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AutomationJobLockDocument = AutomationJobLock & Document;

@Schema({ timestamps: true })
export class AutomationJobLock {
  @Prop({ required: true, unique: true })
  name: string;

  @Prop({ required: true })
  owner: string;

  @Prop({ required: true })
  expires_at: Date;
}

export const AutomationJobLockSchema =
  SchemaFactory.createForClass(AutomationJobLock);

AutomationJobLockSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
