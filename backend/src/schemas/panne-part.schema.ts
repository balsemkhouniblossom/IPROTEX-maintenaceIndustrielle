import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PannePartDocument = PannePart & Document;

export enum PannePartPriority {
  OPTIONAL = 'optional',
  RECOMMENDED = 'recommended',
  REQUIRED = 'required',
}

@Schema({ timestamps: true })
export class PannePart {
  @Prop({ type: Types.ObjectId, ref: 'Panne', required: true })
  panne_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Catalogue', required: true })
  part_id: Types.ObjectId;

  @Prop({ required: true, min: 1, default: 1 })
  recommended_quantity: number;

  @Prop({ enum: PannePartPriority, default: PannePartPriority.RECOMMENDED })
  priority: PannePartPriority;

  @Prop()
  note?: string;
}

export const PannePartSchema = SchemaFactory.createForClass(PannePart);
PannePartSchema.index({ panne_id: 1, part_id: 1 }, { unique: true });
PannePartSchema.index({ part_id: 1 });
