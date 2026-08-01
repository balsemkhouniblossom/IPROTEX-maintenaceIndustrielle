import { Injectable } from '@nestjs/common';
import {
  FEATURE_NAMES,
  ModelArtifact,
  ModelInferenceResult,
  PredictionModel,
  PredictionModelType,
  TrainingSample,
} from '../prediction-model.interface';
import { clamp01, computeFeatureStats, squash, standardize } from './math.util';
import { createSeededRandom } from './seeded-random.util';

export type AutoencoderArtifact = ModelArtifact & {
  mean: number[];
  std: number[];
  inputSize: number;
  hiddenSize: number;
  w1: number[][]; // hiddenSize x inputSize
  b1: number[]; // hiddenSize
  w2: number[][]; // inputSize x hiddenSize
  b2: number[]; // inputSize
  finalTrainingLoss: number;
};

const HIDDEN_RATIO = 0.5;
const EPOCHS = 200;
const LEARNING_RATE = 0.05;
const CONFIDENCE_FULL_AT_SAMPLES = 50;
const RECONSTRUCTION_SQUASH_SCALE = 2;

function tanh(x: number): number {
  return Math.tanh(x);
}

function initMatrix(rows: number, cols: number, rng: () => number): number[][] {
  const scale = 1 / Math.sqrt(cols || 1);
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => (rng() * 2 - 1) * scale),
  );
}

function forward(
  x: number[],
  w1: number[][],
  b1: number[],
  w2: number[][],
  b2: number[],
): { hidden: number[]; output: number[] } {
  const hidden = w1.map((weights, h) => {
    const z = weights.reduce((sum, w, d) => sum + w * (x[d] ?? 0), b1[h]);
    return tanh(z);
  });
  const output = w2.map((weights, d) =>
    weights.reduce((sum, w, h) => sum + w * hidden[h], b2[d]),
  );
  return { hidden, output };
}

/**
 * A minimal single-hidden-layer autoencoder (tanh hidden activation,
 * linear output, trained by plain SGD with manual backpropagation — no
 * ML framework dependency). Anomaly score is reconstruction error: a
 * machine's feature vector that looks like what the network was trained
 * to compress and reconstruct comes back out close to itself; one the
 * network has never seen a pattern like reconstructs poorly. This is the
 * only model in the registry that can, in principle, learn a genuinely
 * nonlinear notion of "normal" rather than a distance- or density-based
 * one — at the cost of needing the most training data to be reliable,
 * reflected in its higher `CONFIDENCE_FULL_AT_SAMPLES` threshold.
 */
@Injectable()
export class AutoencoderModel implements PredictionModel {
  readonly type = PredictionModelType.AUTOENCODER;
  readonly displayName = 'Autoencoder (Reconstruction Error)';

  train(samples: TrainingSample[], randomSeed: number): AutoencoderArtifact {
    const inputSize = FEATURE_NAMES.length;
    const hiddenSize = Math.max(2, Math.round(inputSize * HIDDEN_RATIO));
    const rng = createSeededRandom(randomSeed);

    const stats = computeFeatureStats(
      samples.map((s) => s.features),
      inputSize,
    );
    const standardizedSamples = samples.map((s) =>
      standardize(s.features, stats),
    );

    let w1 = initMatrix(hiddenSize, inputSize, rng);
    let b1 = new Array(hiddenSize).fill(0);
    let w2 = initMatrix(inputSize, hiddenSize, rng);
    let b2 = new Array(inputSize).fill(0);

    let finalTrainingLoss = 0;

    if (standardizedSamples.length > 0) {
      for (let epoch = 0; epoch < EPOCHS; epoch += 1) {
        let epochLoss = 0;

        for (const x of standardizedSamples) {
          const { hidden, output } = forward(x, w1, b1, w2, b2);

          const outputError = output.map((o, d) => o - (x[d] ?? 0));
          epochLoss +=
            outputError.reduce((sum, e) => sum + e * e, 0) / inputSize;

          // Output layer is linear: dL/dz2 == outputError (scaled by 2/inputSize, folded into the learning rate).
          const dOutput = outputError.map((e) => (2 * e) / inputSize);

          const dHidden = hidden.map((h, hIdx) => {
            const upstream = dOutput.reduce(
              (sum, dOut, d) => sum + dOut * w2[d][hIdx],
              0,
            );
            return upstream * (1 - h * h); // tanh derivative
          });

          // Update output weights before they're used to compute dHidden would be wrong order —
          // dHidden above already used the pre-update w2, so it's safe to update w2 now.
          w2 = w2.map((weights, d) =>
            weights.map((w, h) => w - LEARNING_RATE * dOutput[d] * hidden[h]),
          );
          b2 = b2.map((b, d) => b - LEARNING_RATE * dOutput[d]);

          w1 = w1.map((weights, h) =>
            weights.map((w, d) => w - LEARNING_RATE * dHidden[h] * x[d]),
          );
          b1 = b1.map((b, h) => b - LEARNING_RATE * dHidden[h]);
        }

        finalTrainingLoss = epochLoss / standardizedSamples.length;
      }
    }

    return {
      featureNames: FEATURE_NAMES,
      trainingSampleCount: samples.length,
      randomSeed,
      trainedAt: new Date().toISOString(),
      mean: stats.mean,
      std: stats.std,
      inputSize,
      hiddenSize,
      w1,
      b1,
      w2,
      b2,
      finalTrainingLoss,
    };
  }

  score(features: number[], artifact: ModelArtifact): ModelInferenceResult {
    const { mean, std, w1, b1, w2, b2 } = artifact as AutoencoderArtifact;
    const standardized = standardize(features, { mean, std });
    const { output } = forward(standardized, w1, b1, w2, b2);
    const mse =
      output.reduce((sum, o, d) => sum + (o - standardized[d]) ** 2, 0) /
      Math.max(output.length, 1);

    return {
      anomalyScore: squash(mse, RECONSTRUCTION_SQUASH_SCALE),
      confidence: clamp01(
        artifact.trainingSampleCount / CONFIDENCE_FULL_AT_SAMPLES,
      ),
      modelNotes: [
        `Reconstruction error: ${mse.toFixed(3)} (standardized mean-squared error).`,
        mse > 1
          ? 'The network reconstructs this feature pattern poorly compared to patterns seen during training.'
          : 'The network reconstructs this feature pattern about as well as patterns seen during training.',
      ],
    };
  }
}
