import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type InterventionReportDocument = InterventionReport & Document;

@Schema()
export class InterventionReport {
  @Prop({ required: true, unique: true })
  report_id: string;

  @Prop({ type: Types.ObjectId, ref: 'WorkOrder', required: true })
  ot_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  technician_id: Types.ObjectId;

  @Prop({ type: Date, required: true })
  date_debut: Date;

  @Prop({ type: Date, required: true })
  date_fin: Date;

  @Prop()
  cause_racine?: string;

  @Prop()
  description_action?: string;

  @Prop()
  etat_final?: string;

  @Prop()
  validation_responsable?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  validated_by?: Types.ObjectId;

  @Prop({ type: Date })
  validated_at?: Date;
}

export const InterventionReportSchema =
  SchemaFactory.createForClass(InterventionReport);
InterventionReportSchema.index({ ot_id: 1 });
InterventionReportSchema.index(
  { ot_id: 1, date_fin: -1 },
  { name: 'intervention_reports_work_order_finished_desc' },
);
InterventionReportSchema.index({ technician_id: 1, date_debut: -1 });
