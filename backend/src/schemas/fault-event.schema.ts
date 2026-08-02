import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type FaultEventDocument = FaultEvent & Document;

export enum FaultEventSeverity {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical',
}

/**
 * A single fault-code occurrence reported by a device. `code_panne` is a
 * plain string matched against the existing `Panne.code_panne` /
 * `WorkOrder.code_panne` / `KnowledgeArticle.fault_codes` vocabulary — the
 * same string-equality convention used everywhere else in this codebase for
 * fault codes, so a device-reported fault immediately cross-references the
 * existing Panne catalog and Knowledge Base without any new mapping table.
 * An event with no `resolved_at` is an *active alarm*.
 */
@Schema({ timestamps: true })
export class FaultEvent {
  @Prop({ type: Types.ObjectId, ref: 'Device', required: true })
  device_id!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Machine', required: true })
  machine_id!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  code_panne!: string;

  @Prop({
    type: String,
    enum: Object.values(FaultEventSeverity),
    default: FaultEventSeverity.WARNING,
    required: true,
  })
  severity!: FaultEventSeverity;

  @Prop()
  message?: string;

  @Prop({ type: Date, required: true })
  raised_at!: Date;

  @Prop({ type: Date, default: Date.now, required: true })
  received_at!: Date;

  @Prop({ type: Date })
  resolved_at?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  resolved_by?: Types.ObjectId;

  @Prop({ trim: true, maxlength: 1000 })
  resolution_note?: string;
}

export const FaultEventSchema = SchemaFactory.createForClass(FaultEvent);
FaultEventSchema.index({ machine_id: 1, resolved_at: 1, raised_at: -1 });
FaultEventSchema.index({ device_id: 1, raised_at: -1 });

const DEFAULT_FAULT_EVENT_RETENTION_SECONDS = 90 * 24 * 60 * 60; // 90 days

/**
 * Bounded retention for fault history — but only for *resolved* events.
 * A partial TTL index (MongoDB 4.2+) applies `expireAfterSeconds` only to
 * documents matching `partialFilterExpression`, so an unresolved event
 * (an active alarm) is never auto-deleted no matter how old it gets; it can
 * only leave the collection once `resolved_at` is set, at which point the
 * retention clock (from `received_at`) starts applying to it.
 */
FaultEventSchema.index(
  { received_at: 1 },
  {
    expireAfterSeconds:
      Number(process.env.FAULT_EVENT_RETENTION_SECONDS) ||
      DEFAULT_FAULT_EVENT_RETENTION_SECONDS,
    name: 'fault_event_retention_ttl',
    partialFilterExpression: { resolved_at: { $exists: true } },
  },
);
