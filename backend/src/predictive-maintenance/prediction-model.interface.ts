/**
 * The fixed feature vector every model trains and predicts against. Order
 * matters — index `i` of a `TrainingSample.features` / inference vector
 * always corresponds to `FEATURE_NAMES[i]`. Keeping the list in one place
 * is what lets `MachineHealthPrediction.feature_snapshot` be replayed
 * against any model version and still mean the same thing.
 */
export const FEATURE_NAMES = [
  'telemetry_sample_count',
  'telemetry_metric_key_count',
  'telemetry_avg_volatility',
  'telemetry_max_zscore',
  'active_alarm_count',
  'critical_alarm_count',
  'recent_fault_event_count',
  'corrective_work_order_count',
  'preventive_work_order_count',
  'overdue_work_order_count',
  'active_maintenance_plan_count',
  'avg_resolution_days',
  'days_since_last_intervention',
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export const FEATURE_VECTOR_LENGTH = FEATURE_NAMES.length;

export enum PredictionModelType {
  ZSCORE = 'zscore',
  ISOLATION_FOREST = 'isolation_forest',
  DBSCAN = 'dbscan',
  AUTOENCODER = 'autoencoder',
}

export type TrainingSample = {
  machineId: string;
  asOfDate: Date;
  features: number[];
};

/**
 * What a model persists after training — must be plain-JSON-serializable
 * (stored verbatim in `PredictionModelVersion.artifact`). Each concrete
 * model defines its own shape on top of this, but every one carries
 * `featureNames`/`trainingSampleCount`/`randomSeed` so a stored version is
 * self-describing without needing the code that produced it.
 */
export type ModelArtifact = {
  featureNames: readonly string[];
  trainingSampleCount: number;
  randomSeed: number;
  trainedAt: string;
  [key: string]: unknown;
};

export type ModelInferenceResult = {
  /** Normalized to [0, 1]; 0 = indistinguishable from training baseline, 1 = maximally anomalous. */
  anomalyScore: number;
  /** Normalized to [0, 1]; how much weight this specific score deserves. */
  confidence: number;
  /** Short, model-specific phrases explaining *how* the score was derived (never claims a fact about the machine itself — that's the caller's job). */
  modelNotes: string[];
};

/**
 * The common interface every prediction model implements — Isolation
 * Forest, Autoencoder, DBSCAN, Z-score, and any future model plug in here
 * without the orchestration layer (`PredictiveMaintenanceService`,
 * `PredictiveMaintenanceTrainingService`) knowing which concrete
 * algorithm it's talking to. Registered as a flat array behind the
 * `PREDICTION_MODELS` DI token (see `predictive-maintenance.module.ts`) —
 * adding a model means adding one more provider to that array.
 */
export interface PredictionModel {
  readonly type: PredictionModelType;
  /** Human-readable name for audit/UI display. */
  readonly displayName: string;
  train(samples: TrainingSample[], randomSeed: number): ModelArtifact;
  score(features: number[], artifact: ModelArtifact): ModelInferenceResult;
}

export const PREDICTION_MODELS = Symbol('PREDICTION_MODELS');
