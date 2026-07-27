import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { PredictionModelType } from '../predictive-maintenance/prediction-model.interface';

export type PredictionModelVersionDocument = PredictionModelVersion & Document;

export enum PredictionModelVersionStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

/**
 * One row per trained model, immutable once written — training never
 * updates a row in place, it always inserts the next `version` number for
 * that `model_type` and (inside the same transaction-free two-step used
 * elsewhere in this codebase for "only one current X") archives whichever
 * version was previously `active`. `artifact` is the model's own
 * plain-JSON parameters (see each concrete model's `*Artifact` type in
 * `predictive-maintenance/models/`) — together with `feature_names`,
 * `training_sample_count`, and `random_seed`, a row is fully reproducible
 * without needing to know which code version produced it.
 */
@Schema({ timestamps: true })
export class PredictionModelVersion {
  @Prop({ type: String, enum: Object.values(PredictionModelType), required: true })
  model_type!: PredictionModelType;

  @Prop({ required: true })
  version!: number;

  @Prop({
    type: String,
    enum: Object.values(PredictionModelVersionStatus),
    required: true,
    default: PredictionModelVersionStatus.ACTIVE,
  })
  status!: PredictionModelVersionStatus;

  @Prop({ type: [String], required: true })
  feature_names!: string[];

  @Prop({ required: true })
  training_sample_count!: number;

  @Prop({ required: true })
  random_seed!: number;

  @Prop({ type: Object, required: true })
  artifact!: Record<string, unknown>;

  @Prop({ type: Date, required: true })
  trained_at!: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  trained_by?: Types.ObjectId;
}

export const PredictionModelVersionSchema = SchemaFactory.createForClass(PredictionModelVersion);
PredictionModelVersionSchema.index({ model_type: 1, version: -1 });
PredictionModelVersionSchema.index({ model_type: 1, status: 1 });
