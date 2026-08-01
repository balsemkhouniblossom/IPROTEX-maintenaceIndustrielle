import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ReportFormat, ReportType } from './generated-report.schema';

export type ScheduledReportDocument = ScheduledReport & Document;

export enum ScheduleFrequency {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

/**
 * A recurring export definition, ticked by `ReportSchedulerService`. Kept
 * deliberately separate from `GeneratedReport`: this row is the durable
 * *template* (what to generate and how often), while every firing creates
 * its own independent `GeneratedReport` row linked back via
 * `scheduled_report_id` — deleting or expiring a past export never
 * affects the schedule that produced it, and disabling a schedule never
 * touches reports it already generated.
 */
@Schema({ timestamps: true })
export class ScheduledReport {
  @Prop({ required: true, unique: true })
  schedule_id!: string;

  @Prop({ type: String, enum: Object.values(ReportType), required: true })
  type!: ReportType;

  @Prop({ type: String, enum: Object.values(ReportFormat), required: true })
  format!: ReportFormat;

  /**
   * Template parameters. `relativeRangeDays`, when set, is recomputed on
   * every firing as "now minus N days" through "now" — this is what makes
   * a recurring report actually useful (a fixed `dateFrom`/`dateTo` would
   * only ever cover the same frozen window). Any other keys (e.g.
   * `machineId`) are passed through unchanged on every run.
   */
  @Prop({ type: Object, required: true })
  parameters!: Record<string, unknown>;

  @Prop({
    type: String,
    enum: Object.values(ScheduleFrequency),
    required: true,
  })
  frequency!: ScheduleFrequency;

  @Prop({ required: true, default: true })
  active!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  created_by!: Types.ObjectId;

  @Prop({ type: Date })
  last_run_at?: Date;

  @Prop({ type: Date, required: true })
  next_run_at!: Date;
}

export const ScheduledReportSchema =
  SchemaFactory.createForClass(ScheduledReport);
ScheduledReportSchema.index({ active: 1, next_run_at: 1 });
ScheduledReportSchema.index({ created_by: 1 });
