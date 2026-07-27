import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TelemetryDocument = Telemetry & Document;

/**
 * A single telemetry sample from a registered device. `received_at` (not
 * `recorded_at`) drives the TTL index — bounded retention is about how long
 * the server keeps data it has ingested, independent of what timestamp the
 * device itself reports (which may be skewed, replayed, or missing).
 */
@Schema()
export class Telemetry {
  @Prop({ type: Types.ObjectId, ref: 'Device', required: true })
  device_id!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Machine', required: true })
  machine_id!: Types.ObjectId;

  @Prop({ type: Object, required: true })
  metrics!: Record<string, number>;

  @Prop({ type: Date, required: true })
  recorded_at!: Date;

  @Prop({ type: Date, default: Date.now, required: true })
  received_at!: Date;
}

export const TelemetrySchema = SchemaFactory.createForClass(Telemetry);
TelemetrySchema.index({ machine_id: 1, received_at: -1 });
TelemetrySchema.index({ device_id: 1, received_at: -1 });

const DEFAULT_TELEMETRY_RETENTION_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Bounded retention via a native MongoDB TTL index, read from
 * `TELEMETRY_RETENTION_SECONDS` at module-load time (same lightweight
 * `process.env`-at-call-time pattern as `business-time.ts` — `main.ts`
 * loads `.env` before anything else is imported, so this sees real values
 * in production while tests get a safe default).
 */
TelemetrySchema.index(
  { received_at: 1 },
  {
    expireAfterSeconds:
      Number(process.env.TELEMETRY_RETENTION_SECONDS) ||
      DEFAULT_TELEMETRY_RETENTION_SECONDS,
    name: 'telemetry_retention_ttl',
  },
);
