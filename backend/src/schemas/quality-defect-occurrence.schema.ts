import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type QualityDefectOccurrenceDocument = QualityDefectOccurrence &
  Document;
export enum QualityDefectSource {
  HISTORICAL_IMPORT = 'HISTORICAL_IMPORT',
  APPLICATION = 'APPLICATION',
}
export enum QualityDefectStatus {
  HISTORICAL = 'HISTORICAL',
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}
export enum QualityDatePrecision {
  DATE = 'DATE',
  DATETIME = 'DATETIME',
}

@Schema({ timestamps: true })
export class QualityDefectOccurrence {
  @Prop({ required: true, unique: true }) occurrence_id!: string;
  @Prop({ required: true }) defect_code!: string;
  @Prop({ type: Types.ObjectId, ref: 'ProductDefectCatalogue' })
  catalogue_id?: Types.ObjectId;
  @Prop({ required: true }) process!: string;
  @Prop({ type: Date, required: true }) occurrence_date!: Date;
  @Prop({
    type: String,
    enum: Object.values(QualityDatePrecision),
    required: true,
  })
  date_precision!: QualityDatePrecision;
  @Prop({ type: Number, required: true, min: 1 }) quantity_affected!: number;
  @Prop({
    type: String,
    enum: Object.values(QualityDefectSource),
    required: true,
  })
  source!: QualityDefectSource;
  @Prop({
    type: String,
    enum: Object.values(QualityDefectStatus),
    required: true,
  })
  status!: QualityDefectStatus;
  @Prop({ type: Date }) detected_at?: Date;
  @Prop({ type: Date }) resolved_at?: Date;
  @Prop({ type: Types.ObjectId, ref: 'Machine' }) machine_id?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'WorkOrder' })
  linked_work_order_id?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User' }) reported_by?: Types.ObjectId;
  @Prop() observation?: string;
  @Prop() source_file?: string;
  @Prop() source_sheet?: string;
  @Prop() source_row?: number;
  @Prop() source_cell?: string;
  @Prop() source_defect_code?: string;
  @Prop({ type: Number }) source_year?: number;
  @Prop() import_identity?: string;
}

export const QualityDefectOccurrenceSchema = SchemaFactory.createForClass(
  QualityDefectOccurrence,
);
QualityDefectOccurrenceSchema.index(
  { import_identity: 1 },
  {
    unique: true,
    partialFilterExpression: { source: QualityDefectSource.HISTORICAL_IMPORT },
  },
);
QualityDefectOccurrenceSchema.index({ occurrence_date: -1, defect_code: 1 });
QualityDefectOccurrenceSchema.index({ source: 1, status: 1 });
