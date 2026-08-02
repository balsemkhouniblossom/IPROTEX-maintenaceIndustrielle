import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type GeneratedReportDocument = GeneratedReport & Document;

export enum ReportType {
  MACHINE_HISTORY = 'machine_history',
  PREVENTIVE_COMPLIANCE = 'preventive_compliance',
  CORRECTIVE_DOWNTIME = 'corrective_downtime',
  MTTR_MTBF_TRENDS = 'mttr_mtbf_trends',
  STOCK_MOVEMENTS = 'stock_movements',
  MAINTENANCE_COSTS = 'maintenance_costs',
  TECHNICIAN_WORKLOAD = 'technician_workload',
  FAULT_FREQUENCY = 'fault_frequency',
  AUDIT_HISTORY = 'audit_history',
  PREDICTIVE_RISK = 'predictive_risk',
}

export enum ReportFormat {
  PDF = 'pdf',
  EXCEL = 'excel',
  CSV = 'csv',
}

export enum ReportStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

const DEFAULT_REPORT_RETENTION_SECONDS = 30 * 24 * 60 * 60; // 30 days

/**
 * One row per requested export — created immediately (`status: pending`)
 * so the request handler can return right away, then updated in place as
 * generation actually runs in the background (`processing` ->
 * `completed`/`failed`). Every field the feature requires is here:
 * `status`, `parameters` (the exact filters used, for reproducibility),
 * `requested_by`/`requester_role` (who, and what they were authorized as
 * at request time), `checksum` (sha256 of the generated file, verified
 * again on every download), `expires_at` (bounded retention — the
 * scheduler deletes the stored file once past this and the row itself
 * expires via the TTL index below), and `error_message` (failure
 * details). Never mutated by anything outside the reports module: this is
 * purely an export of other modules' data, not a place any of them write.
 */
@Schema({ timestamps: true })
export class GeneratedReport {
  @Prop({ required: true, unique: true })
  report_id!: string;

  @Prop({ type: String, enum: Object.values(ReportType), required: true })
  type!: ReportType;

  @Prop({ type: String, enum: Object.values(ReportFormat), required: true })
  format!: ReportFormat;

  @Prop({
    type: String,
    enum: Object.values(ReportStatus),
    required: true,
    default: ReportStatus.PENDING,
  })
  status!: ReportStatus;

  @Prop({ type: Object, required: true })
  parameters!: Record<string, unknown>;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  requested_by!: Types.ObjectId;

  @Prop({ required: true })
  requester_role!: string;

  @Prop({ type: Types.ObjectId, ref: 'ScheduledReport' })
  scheduled_report_id?: Types.ObjectId;

  @Prop()
  file_path?: string;

  @Prop()
  file_size_bytes?: number;

  @Prop()
  checksum?: string;

  @Prop()
  row_count?: number;

  @Prop()
  error_message?: string;

  @Prop({ type: Date })
  generated_at?: Date;

  @Prop({ type: Date })
  expires_at?: Date;
}

export const GeneratedReportSchema =
  SchemaFactory.createForClass(GeneratedReport);
GeneratedReportSchema.index({ requested_by: 1, createdAt: -1 });
GeneratedReportSchema.index({ status: 1 });
GeneratedReportSchema.index(
  { status: 1, createdAt: -1 },
  { name: 'generated_reports_status_created_desc' },
);
// Supports the Admin "all reports" view's type/format filters and the
// scheduler's "reports produced by this schedule" lookups.
GeneratedReportSchema.index({ type: 1, createdAt: -1 });
GeneratedReportSchema.index(
  { type: 1, format: 1, createdAt: -1 },
  { name: 'generated_reports_type_format_created_desc' },
);
GeneratedReportSchema.index({ scheduled_report_id: 1 });

/**
 * Bounded retention on the metadata row itself, same TTL pattern as
 * FaultEvent/Telemetry/MachineHealthPrediction. The scheduler proactively
 * deletes the underlying stored *file* once `expires_at` passes (Mongo's
 * TTL sweep only ever removes documents, never external files) — this
 * index is the backstop that removes the row shortly after, whether or
 * not the file cleanup step ran.
 */
GeneratedReportSchema.index(
  { expires_at: 1 },
  {
    expireAfterSeconds: 0,
    name: 'generated_report_retention_ttl',
    partialFilterExpression: { expires_at: { $exists: true } },
  },
);

export const DEFAULT_REPORT_RETENTION_MS =
  DEFAULT_REPORT_RETENTION_SECONDS * 1000;
