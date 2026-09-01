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

export type AiAnomalyModelMetadata = {
  modelVersion: string;
  artifactVersion?: string;
  selectedMethod?: string;
  datasetOrigin: string;
  validatedExperiments: string[];
  generalization: {
    secondTest: string;
    thirdTest: string;
    iprotex: string;
  };
  limitations: string[];
  runtime?: Record<string, unknown>;
};
