import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ProductQualityMonthlyMttrDocument = ProductQualityMonthlyMttr &
  Document;

@Schema({ timestamps: true })
export class ProductQualityMonthlyMttr {
  @Prop({ required: true, min: 2000, max: 2100 }) year!: number;
  @Prop({ required: true, min: 1, max: 12 }) month!: number;
  @Prop({ required: true, min: 1 }) resolved_defects!: number;
  @Prop({ required: true, min: 1 }) total_resolution_minutes!: number;
  @Prop({ trim: true, maxlength: 2000 }) note?: string;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  entered_by!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  updated_by!: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export const ProductQualityMonthlyMttrSchema = SchemaFactory.createForClass(
  ProductQualityMonthlyMttr,
);
ProductQualityMonthlyMttrSchema.index({ year: 1, month: 1 }, { unique: true });
