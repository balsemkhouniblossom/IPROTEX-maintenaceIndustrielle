import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MesureDocument = Mesure & Document;

@Schema({ timestamps: true })
export class Mesure {
  @Prop({ required: true, unique: true })
  mesure_id: string;

  @Prop({ type: Types.ObjectId, ref: 'Capteur', required: true })
  capteur_id: Types.ObjectId;

  @Prop({ required: true })
  valeur: number;

  @Prop({ type: Date, required: true })
  timestamp: Date;

  @Prop({ required: true })
  status: string;
}

export const MesureSchema = SchemaFactory.createForClass(Mesure);
MesureSchema.index({ capteur_id: 1, timestamp: -1 });
MesureSchema.index({ status: 1, timestamp: -1 });
