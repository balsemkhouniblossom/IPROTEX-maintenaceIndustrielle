import { Injectable } from '@nestjs/common';
import {
  FEATURE_NAMES,
  ModelArtifact,
  ModelInferenceResult,
  PredictionModel,
  PredictionModelType,
  TrainingSample,
} from '../prediction-model.interface';
import { clamp01 } from './math.util';
import { createSeededRandom, randomInt } from './seeded-random.util';

type TreeLeaf = { leaf: true; size: number };
type TreeSplit = {
  leaf: false;
  featureIndex: number;
  splitValue: number;
  left: TreeNode;
  right: TreeNode;
};
type TreeNode = TreeLeaf | TreeSplit;

export type IsolationForestArtifact = ModelArtifact & {
  trees: TreeNode[];
  subsampleSize: number;
};

const NUM_TREES = 100;
const MAX_SUBSAMPLE_SIZE = 256;
const CONFIDENCE_FULL_AT_SAMPLES = 40;

/** Harmonic-number-based average path length of an unsuccessful BST search — the standard Isolation Forest normalizing constant c(n). */
function averagePathLengthFactor(n: number): number {
  if (n <= 1) return 0;
  return 2 * (Math.log(n - 1) + 0.5772156649) - (2 * (n - 1)) / n;
}

function buildTree(
  data: number[][],
  featureCount: number,
  depth: number,
  maxDepth: number,
  rng: () => number,
): TreeNode {
  if (depth >= maxDepth || data.length <= 1) {
    return { leaf: true, size: data.length };
  }

  // Try a handful of random features looking for one with a non-constant
  // range to split on; if every feature is constant across this subsample
  // (degenerate data), fall back to a leaf rather than looping forever.
  for (let attempt = 0; attempt < featureCount; attempt += 1) {
    const featureIndex = randomInt(rng, featureCount);
    const values = data.map((row) => row[featureIndex] ?? 0);
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) continue;

    const splitValue = min + rng() * (max - min);
    const left = data.filter((row) => (row[featureIndex] ?? 0) < splitValue);
    const right = data.filter((row) => (row[featureIndex] ?? 0) >= splitValue);
    if (left.length === 0 || right.length === 0) continue;

    return {
      leaf: false,
      featureIndex,
      splitValue,
      left: buildTree(left, featureCount, depth + 1, maxDepth, rng),
      right: buildTree(right, featureCount, depth + 1, maxDepth, rng),
    };
  }

  return { leaf: true, size: data.length };
}

function pathLength(node: TreeNode, features: number[], depth: number): number {
  if (node.leaf) return depth + averagePathLengthFactor(node.size);
  const branch =
    (features[node.featureIndex] ?? 0) < node.splitValue
      ? node.left
      : node.right;
  return pathLength(branch, features, depth + 1);
}

/**
 * Isolates points by recursive random splits: an outlier tends to get
 * separated from the rest of the data in far fewer splits than a normal
 * point does, because it doesn't need many cuts to end up alone. Averaged
 * over `NUM_TREES` randomized trees, the average path length converts to
 * an anomaly score via the standard Liu/Ting/Zhou normalization. Good at
 * catching anomalies that are only unusual as a *combination* of features
 * that are each individually unremarkable — exactly what the Z-score
 * model (which scores each feature independently) misses.
 */
@Injectable()
export class IsolationForestModel implements PredictionModel {
  readonly type = PredictionModelType.ISOLATION_FOREST;
  readonly displayName = 'Isolation Forest';

  train(
    samples: TrainingSample[],
    randomSeed: number,
  ): IsolationForestArtifact {
    const rng = createSeededRandom(randomSeed);
    const featureCount = FEATURE_NAMES.length;
    const allData = samples.map((s) => s.features);
    const subsampleSize = Math.min(
      MAX_SUBSAMPLE_SIZE,
      Math.max(allData.length, 1),
    );
    const maxDepth = Math.ceil(Math.log2(Math.max(subsampleSize, 2)));

    const trees: TreeNode[] = [];
    for (let t = 0; t < NUM_TREES; t += 1) {
      const subsample: number[][] = [];
      if (allData.length === 0) {
        subsample.push(new Array<number>(featureCount).fill(0));
      } else {
        for (let i = 0; i < subsampleSize; i += 1) {
          subsample.push(allData[randomInt(rng, allData.length)]);
        }
      }
      trees.push(buildTree(subsample, featureCount, 0, maxDepth, rng));
    }

    return {
      featureNames: FEATURE_NAMES,
      trainingSampleCount: samples.length,
      randomSeed,
      trainedAt: new Date().toISOString(),
      trees,
      subsampleSize,
    };
  }

  score(features: number[], artifact: ModelArtifact): ModelInferenceResult {
    const { trees, subsampleSize } = artifact as IsolationForestArtifact;
    const pathLengths = trees.map((tree) => pathLength(tree, features, 0));
    const avgPathLength =
      pathLengths.reduce((sum, h) => sum + h, 0) /
      Math.max(pathLengths.length, 1);
    const normalizer = averagePathLengthFactor(subsampleSize) || 1;
    const anomalyScore = clamp01(2 ** (-avgPathLength / normalizer));

    return {
      anomalyScore,
      confidence: clamp01(
        artifact.trainingSampleCount / CONFIDENCE_FULL_AT_SAMPLES,
      ),
      modelNotes: [
        `Average isolation path length: ${avgPathLength.toFixed(2)} splits across ${trees.length} trees (shorter paths mean easier to isolate, i.e. more anomalous).`,
        anomalyScore > 0.6
          ? 'This combination of feature values is markedly easier to isolate than the trained baseline population.'
          : 'This combination of feature values isolates about as easily as the trained baseline population.',
      ],
    };
  }
}
