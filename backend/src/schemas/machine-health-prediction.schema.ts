import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { PredictionModelType } from '../predictive-maintenance/prediction-model.interface';

export type MachineHealthPredictionDocument = MachineHealthPrediction &
  Document;

export enum PredictionRiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
  /**
   * Not a health assessment at all: the machine had no measurable telemetry,
   * alarms, work orders, maintenance plans, or interventions as of this
   * prediction, so no model output can be trusted as "healthy" or otherwise.
   * Deliberately kept out of the low/medium/high/critical ordering — it
   * means "we don't know yet," never "this machine is fine."
   */
  INSUFFICIENT_DATA = 'insufficient_data',
}

/**
 * A structured explanation split into exactly the three categories the
 * feature requires: `measuredFacts` (read directly off WorkOrder/
 * FaultEvent/Telemetry/MaintenancePlan — true regardless of which model
 * produced this prediction), `modelOutputNotes` (specific to this model's
 * own reasoning — a different model type would say something different
 * here even given identical measured facts), and `uncertaintyNotes`
 * (explicit call-outs of what the prediction can't vouch for — sparse
 * training data, missing telemetry, etc). Never blend these three: a
 * reader must be able to tell "the machine had 3 corrective work orders
 * this month" (fact) apart from "the model considers this anomalous"
 * (inference) apart from "confidence is low because only 4 training
 * samples exist" (uncertainty).
 */
@Schema({ _id: false })
export class PredictionExplanation {
  @Prop({ type: [String], default: [] })
  measuredFacts!: string[];

  @Prop({ type: [String], default: [] })
  modelOutputNotes!: string[];

  @Prop({ type: [String], default: [] })
  uncertaintyNotes!: string[];
}

export const PredictionExplanationSchema = SchemaFactory.createForClass(
  PredictionExplanation,
);

const DEFAULT_PREDICTION_HISTORY_RETENTION_SECONDS = 180 * 24 * 60 * 60; // 180 days

/**
 * One row per (machine, model_type, point in time) — the auditable
 * prediction history the feature requires. Strictly advisory and
 * read-only from the rest of the app's point of view: nothing in this
 * module, including this schema, is ever written to in response to a
 * WorkOrder/Stock/Machine mutation, and nothing here triggers one either.
 */
@Schema({ timestamps: true })
export class MachineHealthPrediction {
  @Prop({ type: Types.ObjectId, ref: 'Machine', required: true })
  machine_id!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'PredictionModelVersion', required: true })
  model_version_id!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(PredictionModelType),
    required: true,
  })
  model_type!: PredictionModelType;

  /** 0 (failing) - 100 (healthy); derived from `anomaly_score` as `100 * (1 - anomaly_score)`. */
  @Prop({ required: true })
  health_score!: number;

  /** Raw model output, 0 (baseline-like) - 1 (maximally anomalous). */
  @Prop({ required: true })
  anomaly_score!: number;

  @Prop({
    type: String,
    enum: Object.values(PredictionRiskLevel),
    required: true,
  })
  risk_level!: PredictionRiskLevel;

  /** 0 - 1; how much weight this specific score deserves (data sufficiency x model maturity). */
  @Prop({ required: true })
  confidence!: number;

  /** The exact feature vector fed to the model, in `FEATURE_NAMES` order — lets a stored prediction be replayed/audited later. */
  @Prop({ type: [Number], required: true })
  feature_snapshot!: number[];

  @Prop({ type: PredictionExplanationSchema, required: true })
  explanation!: PredictionExplanation;

  @Prop({ type: Date, required: true })
  generated_at!: Date;
}

export const MachineHealthPredictionSchema = SchemaFactory.createForClass(
  MachineHealthPrediction,
);
MachineHealthPredictionSchema.index({
  machine_id: 1,
  model_type: 1,
  generated_at: -1,
});

/**
 * Bounded retention, same pattern as FaultEvent/Telemetry — prediction
 * rows accumulate automatically on every scheduler tick, so without a TTL
 * this collection grows forever. Nothing else in this schema is ever
 * exempted from expiry the way FaultEvent exempts unresolved alarms:
 * every prediction is a point-in-time snapshot, not an ongoing state.
 */
MachineHealthPredictionSchema.index(
  { generated_at: 1 },
  {
    expireAfterSeconds:
      Number(process.env.PREDICTION_HISTORY_RETENTION_SECONDS) ||
      DEFAULT_PREDICTION_HISTORY_RETENTION_SECONDS,
    name: 'machine_health_prediction_retention_ttl',
  },
);
