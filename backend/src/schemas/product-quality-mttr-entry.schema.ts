import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ProductQualityMttrEntryDocument = ProductQualityMttrEntry &
  Document;

@Schema({ timestamps: true })
export class ProductQualityMttrEntry {
  @Prop({ required: true, min: 2000, max: 9999 }) year!: number;
  @Prop({ required: true, min: 1, max: 12 }) month!: number;
  @Prop({ type: Types.ObjectId, ref: 'MachineType', required: true })
  machine_type_id!: Types.ObjectId;
  @Prop({ required: true, min: 0 }) mttr_value!: number;
  @Prop({ required: true, enum: ['MINUTES'], default: 'MINUTES' })
  unit!: 'MINUTES';
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  entered_by!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  updated_by!: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export const ProductQualityMttrEntrySchema = SchemaFactory.createForClass(
  ProductQualityMttrEntry,
);
ProductQualityMttrEntrySchema.index(
  { year: 1, month: 1, machine_type_id: 1 },
  { unique: true },
);
