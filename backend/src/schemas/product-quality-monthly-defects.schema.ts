import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ProductQualityMonthlyDefectsDocument =
  ProductQualityMonthlyDefects & Document;

@Schema({ timestamps: true })
export class ProductQualityMonthlyDefects {
  @Prop({ required: true, min: 2000, max: 9999 }) year!: number;
  @Prop({ required: true, min: 1, max: 12 }) month!: number;
  @Prop({ type: Types.ObjectId, ref: 'MachineType', required: true })
  machine_type_id!: Types.ObjectId;
  @Prop({ required: true, min: 0 }) defect_count!: number;
  @Prop({ required: true, enum: ['MANUAL'], default: 'MANUAL' })
  source!: 'MANUAL';
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  entered_by!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  updated_by!: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export const ProductQualityMonthlyDefectsSchema = SchemaFactory.createForClass(
  ProductQualityMonthlyDefects,
);
ProductQualityMonthlyDefectsSchema.index(
  { year: 1, month: 1, machine_type_id: 1 },
  { unique: true },
);
