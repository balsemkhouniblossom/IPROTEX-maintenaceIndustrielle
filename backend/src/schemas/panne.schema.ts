import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PanneDocument = Panne & Document;

@Schema()
export class Panne {
  @Prop({ required: true, unique: true })
  panne_id: string;

  @Prop({ required: true })
  code_panne: string;

  @Prop({ required: true })
  description: string;

  @Prop({ type: Types.ObjectId, ref: 'MachineType', index: true })
  machine_type_id?: Types.ObjectId;

  @Prop()
  component?: string;

  @Prop()
  gravite?: string;

  @Prop({ default: true, index: true })
  is_active: boolean;
}

export const PanneSchema = SchemaFactory.createForClass(Panne);
PanneSchema.index({ machine_type_id: 1, code_panne: 1 }, { unique: true });
PanneSchema.index({ machine_type_id: 1, component: 1, is_active: 1 });
