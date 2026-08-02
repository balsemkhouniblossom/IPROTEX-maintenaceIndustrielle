import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type LubrificationLogDocument = LubrificationLog & Document;

@Schema()
export class LubrificationLog {
  @Prop({ required: true, unique: true })
  log_id: string;

  @Prop({ type: Types.ObjectId, ref: 'Module', required: true })
  module_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Lubrifiant', required: true })
  lubrifiant_id: Types.ObjectId;

  @Prop({ type: Date, required: true })
  date_application: Date;

  @Prop({ required: true })
  quantite: number;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  technician_id: Types.ObjectId;
}

export const LubrificationLogSchema =
  SchemaFactory.createForClass(LubrificationLog);
LubrificationLogSchema.index(
  { module_id: 1, date_application: -1 },
  { name: 'lubrification_logs_module_application_desc' },
);
