import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ModulePiecesDocument = ModulePieces & Document;

@Schema({ timestamps: true })
export class ModulePieces {
  @Prop({ type: Types.ObjectId, ref: 'ModuleType', required: true })
  mod_type_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Catalogue', required: true })
  part_id: Types.ObjectId;

  @Prop({ required: true })
  quantite_standard: number;
}

export const ModulePiecesSchema = SchemaFactory.createForClass(ModulePieces);
ModulePiecesSchema.index({ mod_type_id: 1, part_id: 1 }, { unique: true });
