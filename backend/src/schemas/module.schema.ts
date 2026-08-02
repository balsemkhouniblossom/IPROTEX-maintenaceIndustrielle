import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ModuleDocument = Module & Document;

@Schema({ timestamps: true })
export class Module {
  @Prop({ required: true, unique: true })
  module_id: string;

  @Prop({ type: Types.ObjectId, ref: 'Machine', required: true })
  machine_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ModuleType', required: true })
  mod_type_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Module' })
  parent_module_id?: Types.ObjectId;

  @Prop()
  localisation?: string;
}

export const ModuleSchema = SchemaFactory.createForClass(Module);
ModuleSchema.index({ machine_id: 1, mod_type_id: 1 });
