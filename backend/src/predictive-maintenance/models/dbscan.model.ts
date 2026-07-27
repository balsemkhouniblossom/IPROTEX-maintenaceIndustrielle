import { Injectable } from '@nestjs/common';
import {
  FEATURE_NAMES,
  ModelArtifact,
  ModelInferenceResult,
  PredictionModel,
  PredictionModelType,
  TrainingSample,
} from '../prediction-model.interface';
import { clamp01, computeFeatureStats, euclideanDistance, squash, standardize } from './math.util';

export type DbscanArtifact = ModelArtifact & {
  mean: number[];
  std: number[];
  epsilon: number;
  minPts: number;
  corePoints: number[][];
};

const DEFAULT_EPSILON = 2.5;
const DEFAULT_MIN_PTS = 3;
const MAX_STORED_CORE_POINTS = 300;
const CONFIDENCE_FULL_AT_SAMPLES = 40;

/**
 * Density-based clustering: a point is "core" if at least `minPts` other
 * training points fall within `epsilon` of it (in standardized feature
 * space). The dense regions those core points trace out are this model's
 * notion of "normal operation" — there's no single centroid or baseline
 * mean, just however many distinct operating regimes the training data
 * actually contains. Inference has no built-in DBSCAN concept, so this
 * follows the common convention: score by distance from the new point to
 * the *nearest* core point, which handles multiple legitimate operating
 * modes better than a single-baseline model like Z-score can.
 */
@Injectable()
export class DbscanModel implements PredictionModel {
  readonly type = PredictionModelType.DBSCAN;
  readonly displayName = 'DBSCAN Density Clustering';

  train(samples: TrainingSample[], randomSeed: number): DbscanArtifact {
    const featureCount = FEATURE_NAMES.length;
    const raw = samples.map((s) => s.features);
    const stats = computeFeatureStats(raw, featureCount);
    const standardized = raw.map((f) => standardize(f, stats));
    const n = standardized.length;

    const isCore = new Array(n).fill(false);
    for (let i = 0; i < n; i += 1) {
      let neighborCount = 0;
      for (let j = 0; j < n; j += 1) {
        if (i === j) continue;
        if (euclideanDistance(standardized[i], standardized[j]) <= DEFAULT_EPSILON) neighborCount += 1;
      }
      if (neighborCount + 1 >= DEFAULT_MIN_PTS) isCore[i] = true;
    }

    const corePoints = standardized.filter((_, i) => isCore[i]);
    const stride = corePoints.length > MAX_STORED_CORE_POINTS
      ? Math.ceil(corePoints.length / MAX_STORED_CORE_POINTS)
      : 1;
    const cappedCorePoints = corePoints.filter((_, i) => i % stride === 0);

    return {
      featureNames: FEATURE_NAMES,
      trainingSampleCount: samples.length,
      randomSeed,
      trainedAt: new Date().toISOString(),
      mean: stats.mean,
      std: stats.std,
      epsilon: DEFAULT_EPSILON,
      minPts: DEFAULT_MIN_PTS,
      corePoints: cappedCorePoints,
    };
  }

  score(features: number[], artifact: ModelArtifact): ModelInferenceResult {
    const { mean, std, epsilon, corePoints } = artifact as DbscanArtifact;

    if (corePoints.length === 0) {
      return {
        anomalyScore: 0.5,
        confidence: 0,
        modelNotes: ['No dense region could be established from the training data — DBSCAN has no baseline to compare against.'],
      };
    }

    const standardized = standardize(features, { mean, std });
    const minDistance = Math.min(...corePoints.map((core) => euclideanDistance(standardized, core)));
    const excess = Math.max(0, minDistance - epsilon);

    return {
      anomalyScore: squash(excess, Math.max(epsilon, 0.5)),
      confidence: clamp01(artifact.trainingSampleCount / CONFIDENCE_FULL_AT_SAMPLES),
      modelNotes: [
        `Distance to the nearest dense operating region: ${minDistance.toFixed(2)} (density threshold epsilon=${epsilon.toFixed(2)}).`,
        minDistance <= epsilon
          ? 'Falls within a dense region of normal operation observed during training.'
          : 'Falls outside every dense region of normal operation observed during training.',
      ],
    };
  }
}
