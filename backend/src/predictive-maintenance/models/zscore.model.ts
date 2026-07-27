import { Injectable } from '@nestjs/common';
import {
  FEATURE_NAMES,
  ModelArtifact,
  ModelInferenceResult,
  PredictionModel,
  PredictionModelType,
  TrainingSample,
} from '../prediction-model.interface';
import { computeFeatureStats, clamp01, squash } from './math.util';

export type ZScoreArtifact = ModelArtifact & {
  mean: number[];
  std: number[];
};

const CONFIDENCE_FULL_AT_SAMPLES = 30;
const SQUASH_SCALE = 3;

/**
 * The baseline model: per-feature mean/std from the training set, scored
 * by how many standard deviations the live feature vector sits from that
 * baseline (averaged across features, so one wildly-off feature doesn't by
 * itself saturate the score the way `max` would). Deliberately the
 * simplest model in the registry — a sane fallback that stays interpretable
 * even with very little training data, at the cost of missing anomalies
 * that only show up as an unusual *combination* of otherwise-normal values
 * (Isolation Forest and DBSCAN pick up where this leaves off).
 */
@Injectable()
export class ZScoreModel implements PredictionModel {
  readonly type = PredictionModelType.ZSCORE;
  readonly displayName = 'Z-Score Baseline';

  train(samples: TrainingSample[], randomSeed: number): ZScoreArtifact {
    const stats = computeFeatureStats(
      samples.map((s) => s.features),
      FEATURE_NAMES.length,
    );

    return {
      featureNames: FEATURE_NAMES,
      trainingSampleCount: samples.length,
      randomSeed,
      trainedAt: new Date().toISOString(),
      mean: stats.mean,
      std: stats.std,
    };
  }

  score(features: number[], artifact: ModelArtifact): ModelInferenceResult {
    const { mean, std } = artifact as ZScoreArtifact;
    const zScores = features.map((value, i) => Math.abs((value - mean[i]) / std[i]));
    const avgAbsZ = zScores.reduce((sum, z) => sum + z, 0) / Math.max(zScores.length, 1);
    const maxZ = Math.max(0, ...zScores);
    const maxZIndex = zScores.indexOf(maxZ);

    return {
      anomalyScore: squash(avgAbsZ, SQUASH_SCALE),
      confidence: clamp01(artifact.trainingSampleCount / CONFIDENCE_FULL_AT_SAMPLES),
      modelNotes: [
        `Average deviation from baseline: ${avgAbsZ.toFixed(2)} standard deviations.`,
        maxZ > 2
          ? `Largest single deviation: "${FEATURE_NAMES[maxZIndex]}" at ${maxZ.toFixed(2)} standard deviations from its trained baseline.`
          : 'No individual feature deviates sharply from its trained baseline.',
      ],
    };
  }
}
