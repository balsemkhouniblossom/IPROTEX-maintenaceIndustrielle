import { Role } from '../schemas/user.schema';

export type AiAnomalyActor = {
  userId: string;
  role: Role;
};

export type ImsAnomalyFeatureRow = {
  timestamp: string;
  experiment: string;
  sensor_channel: number;
  bearing: number;
  axis: string;
  rms: number;
  standard_deviation: number;
  peak_to_peak: number;
  kurtosis: number;
  skewness: number;
  crest_factor: number;
  spectral_energy: number;
  dominant_frequency_hz: number;
};

export type AiAnomalyFastApiPayload = {
  stream_id?: string;
  rows: ImsAnomalyFeatureRow[];
};

export type AiAnomalyFastApiResult = {
  modelVersion: string;
  experiment: string;
  timestamp: string;
  bearing: number;
  anomalyScore: number;
  riskScore: number;
  riskLevel: string;
  rawAnomaly: boolean;
  persistentAlert: boolean;
  componentScores: {
    zScore: number;
    isolationForest: number;
  };
  reasonCodes: string[];
  prototypeResult: boolean;
};

export type AiAnomalyFastApiResults = {
  results: AiAnomalyFastApiResult[];
};

export type AiAnomalyRuntimeModel = {
  id: string;
  name: string;
  task: string;
  purpose: string;
  modelVersion: string;
  artifactVersion?: string;
  selectedMethod?: string;
  sourceDataset: string;
  validatedExperiments: string[];
  validationScope: string;
  generalizationStatus: string;
  featureOrder: string[];
  framework: string;
  loaded: boolean;
  enabled: boolean;
  running: boolean;
  status: 'ACTIVE' | 'STOPPED' | 'RUNNING' | 'STOPPING' | 'ERROR';
  activeExecutions: number;
  lastExecutionAt?: string;
  lastExecutionDurationMs?: number;
  lastError?: string;
  validationMetrics: Record<string, unknown>;
};

export type AiAnomalyModelMetadata = { models: AiAnomalyRuntimeModel[] };

export type AiDatasetReplayCatalog = {
  dataset: 'IMS Bearing';
  mode: 'DATASET_REPLAY';
  experiments: Array<{ id: string; sampleCount: number; supported: boolean }>;
};

export type AiDatasetReplaySamples = {
  experiment: string;
  samples: string[];
  total: number;
};

export type AiDatasetReplayRows = {
  dataset: 'IMS Bearing';
  mode: 'DATASET_REPLAY';
  rows: ImsAnomalyFeatureRow[];
};
