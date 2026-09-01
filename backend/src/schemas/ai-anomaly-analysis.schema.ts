import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Machine } from './machine.schema';
import { Capteur } from './capteur.schema';
import { User } from './user.schema';

export enum AiAnomalyValidationStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
}

export enum AiAnomalyInputSource {
  DATASET_REPLAY = 'DATASET_REPLAY',
  DEMO = 'DEMO',
}

export enum AiAnomalyDatasetOrigin {
  IMS_PUBLIC_TEST_RIG = 'IMS_PUBLIC_TEST_RIG',
}

export enum AiAnomalyValidationScope {
  IMS_1ST_TEST_ONLY = 'IMS_1ST_TEST_ONLY',
}

export enum AiAnomalyGeneralizationStatus {
  NOT_ESTABLISHED_FOR_IPROTEX = 'NOT_ESTABLISHED_FOR_IPROTEX',
}

@Schema({ _id: false })
export class AiAnomalyComponentScores {
  @Prop({ type: Number, required: true })
  zScore: number;

  @Prop({ type: Number, required: true })
  isolationForest: number;
}

export const AiAnomalyComponentScoresSchema = SchemaFactory.createForClass(
  AiAnomalyComponentScores,
);

@Schema({ _id: false })
export class AiAnomalyModelResponse {
  @Prop({ type: String, required: true })
  modelVersion: string;

  @Prop({ type: String, required: true })
  experiment: string;

  @Prop({ type: String, required: true })
  timestamp: string;

  @Prop({ type: Number, required: true })
  bearing: number;

  @Prop({ type: Number, required: true })
  anomalyScore: number;

  @Prop({ type: Number, required: true })
  riskScore: number;

  @Prop({ type: String, required: true })
  riskLevel: string;

  @Prop({ type: Boolean, required: true })
  rawAnomaly: boolean;

  @Prop({ type: Boolean, required: true })
  persistentAlert: boolean;

  @Prop({ type: AiAnomalyComponentScoresSchema, required: true })
  componentScores: AiAnomalyComponentScores;

  @Prop({ type: [String], required: true, default: [] })
  reasonCodes: string[];

  @Prop({ type: Boolean, required: true })
  prototypeResult: boolean;
}

export const AiAnomalyModelResponseSchema = SchemaFactory.createForClass(
  AiAnomalyModelResponse,
);

export type AiAnomalyAnalysisDocument = HydratedDocument<AiAnomalyAnalysis>;

@Schema({
  collection: 'ai_anomaly_analyses',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class AiAnomalyAnalysis {
  @Prop({ type: String, required: true, unique: true, index: true })
  analysis_id: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Machine.name,
    required: true,
    index: true,
  })
  machine_id: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Capteur.name,
    required: false,
    index: true,
  })
  capteur_id?: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
    index: true,
  })
  requested_by: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  model_version: string;

  @Prop({
    type: String,
    enum: Object.values(AiAnomalyInputSource),
    required: true,
    index: true,
  })
  input_source: AiAnomalyInputSource;

  @Prop({ type: String, required: true, index: true })
  experiment: string;

  @Prop({ type: Date, required: true, index: true })
  measurement_timestamp: Date;

  @Prop({ type: Number, required: true, index: true })
  bearing: number;

  @Prop({ type: Number, required: true })
  anomaly_score: number;

  @Prop({ type: Number, required: true })
  risk_score: number;

  @Prop({ type: String, required: true, index: true })
  risk_level: string;

  @Prop({ type: Boolean, required: true })
  raw_anomaly: boolean;

  @Prop({ type: Boolean, required: true, index: true })
  persistent_alert: boolean;

  @Prop({ type: AiAnomalyComponentScoresSchema, required: true })
  component_scores: AiAnomalyComponentScores;

  @Prop({ type: [String], required: true, default: [] })
  reason_codes: string[];

  @Prop({ type: Boolean, required: true, default: true })
  prototype_result: boolean;

  @Prop({ type: AiAnomalyModelResponseSchema, required: true })
  model_response: AiAnomalyModelResponse;

  @Prop({
    type: String,
    enum: Object.values(AiAnomalyDatasetOrigin),
    required: true,
    default: AiAnomalyDatasetOrigin.IMS_PUBLIC_TEST_RIG,
  })
  dataset_origin: AiAnomalyDatasetOrigin;

  @Prop({
    type: String,
    enum: Object.values(AiAnomalyValidationScope),
    required: true,
    default: AiAnomalyValidationScope.IMS_1ST_TEST_ONLY,
  })
  validation_scope: AiAnomalyValidationScope;

  @Prop({
    type: String,
    enum: Object.values(AiAnomalyGeneralizationStatus),
    required: true,
    default: AiAnomalyGeneralizationStatus.NOT_ESTABLISHED_FOR_IPROTEX,
  })
  generalization_status: AiAnomalyGeneralizationStatus;

  @Prop({
    type: String,
    enum: Object.values(AiAnomalyValidationStatus),
    required: true,
    default: AiAnomalyValidationStatus.PENDING,
    index: true,
  })
  validation_status: AiAnomalyValidationStatus;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: false,
    index: true,
  })
  validated_by?: Types.ObjectId;

  @Prop({ type: String, required: false, maxlength: 1000 })
  validation_comment?: string;

  @Prop({ type: Date, required: false })
  validated_at?: Date;

  created_at?: Date;
  updated_at?: Date;
}

export const AiAnomalyAnalysisSchema =
  SchemaFactory.createForClass(AiAnomalyAnalysis);

AiAnomalyAnalysisSchema.index(
  {
    machine_id: 1,
    model_version: 1,
    input_source: 1,
    experiment: 1,
    measurement_timestamp: 1,
    bearing: 1,
  },
  {
    unique: true,
    name: 'uniq_ai_anomaly_machine_model_source_experiment_time_bearing',
  },
);

AiAnomalyAnalysisSchema.index(
  { machine_id: 1, measurement_timestamp: -1, created_at: -1 },
  { name: 'idx_ai_anomaly_machine_history' },
);
