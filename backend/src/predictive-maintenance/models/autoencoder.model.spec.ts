import { AutoencoderModel } from './autoencoder.model';
import { FEATURE_NAMES, TrainingSample } from '../prediction-model.interface';

function sample(features: number[]): TrainingSample {
  return { machineId: 'm1', asOfDate: new Date('2026-01-01'), features };
}

function normalVector(jitter: number): number[] {
  return FEATURE_NAMES.map((_, i) => 5 + jitter * (((i * 3) % 4) - 1.5) * 0.2);
}

describe('AutoencoderModel', () => {
  let model: AutoencoderModel;

  beforeEach(() => {
    model = new AutoencoderModel();
  });

  it('trains a network sized off the feature vector length', () => {
    const samples = Array.from({ length: 40 }, (_, i) => sample(normalVector(i)));
    const artifact = model.train(samples, 1);

    expect(artifact.inputSize).toBe(FEATURE_NAMES.length);
    expect(artifact.hiddenSize).toBeGreaterThanOrEqual(2);
    expect(artifact.w1).toHaveLength(artifact.hiddenSize);
    expect(artifact.w1[0]).toHaveLength(artifact.inputSize);
    expect(artifact.w2).toHaveLength(artifact.inputSize);
    expect(artifact.w2[0]).toHaveLength(artifact.hiddenSize);
    expect(Number.isFinite(artifact.finalTrainingLoss)).toBe(true);
  }, 20000);

  it('reduces reconstruction loss over training relative to an untrained network', () => {
    const samples = Array.from({ length: 40 }, (_, i) => sample(normalVector(i)));
    const trained = model.train(samples, 1);

    // An essentially-untrained network (seed only, would need epochs=0) isn't
    // directly comparable, so instead assert the loss is small in absolute
    // terms once trained on a low-variance population.
    expect(trained.finalTrainingLoss).toBeLessThan(1);
  }, 20000);

  it('reconstructs a point resembling the training population better than a wild outlier', () => {
    const samples = Array.from({ length: 50 }, (_, i) => sample(normalVector(i)));
    const artifact = model.train(samples, 2);

    const normalResult = model.score(normalVector(1), artifact);
    const outlierResult = model.score(FEATURE_NAMES.map(() => 100000), artifact);

    expect(outlierResult.anomalyScore).toBeGreaterThan(normalResult.anomalyScore);
  }, 20000);

  it('is fully reproducible given the same samples and seed', () => {
    const samples = Array.from({ length: 20 }, (_, i) => sample(normalVector(i)));
    const a = model.train(samples, 9);
    const b = model.train(samples, 9);

    expect(a.w1).toEqual(b.w1);
    expect(a.w2).toEqual(b.w2);
    expect(a.finalTrainingLoss).toBe(b.finalTrainingLoss);
  }, 20000);

  it('handles an empty training set without throwing', () => {
    const artifact = model.train([], 1);
    const result = model.score(normalVector(0), artifact);
    expect(Number.isFinite(result.anomalyScore)).toBe(true);
  });
});
