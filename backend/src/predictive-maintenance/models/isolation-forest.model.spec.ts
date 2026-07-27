import { IsolationForestModel } from './isolation-forest.model';
import { FEATURE_NAMES, TrainingSample } from '../prediction-model.interface';

function sample(features: number[]): TrainingSample {
  return { machineId: 'm1', asOfDate: new Date('2026-01-01'), features };
}

function normalVector(jitter = 0): number[] {
  return FEATURE_NAMES.map((_, i) => 5 + jitter * ((i % 3) - 1));
}

describe('IsolationForestModel', () => {
  let model: IsolationForestModel;

  beforeEach(() => {
    model = new IsolationForestModel();
  });

  it('produces a self-describing artifact with trees and subsample size', () => {
    const samples = Array.from({ length: 50 }, (_, i) => sample(normalVector(i % 5)));
    const artifact = model.train(samples, 42);

    expect(artifact.trees.length).toBe(100);
    expect(artifact.subsampleSize).toBeGreaterThan(0);
    expect(artifact.trainingSampleCount).toBe(50);
    expect(artifact.randomSeed).toBe(42);
  });

  it('is fully reproducible given the same samples and seed', () => {
    const samples = Array.from({ length: 40 }, (_, i) => sample(normalVector(i % 4)));
    const a = model.train(samples, 7);
    const b = model.train(samples, 7);

    expect(JSON.stringify(a.trees)).toBe(JSON.stringify(b.trees));
  });

  it('produces different trees for a different seed', () => {
    const samples = Array.from({ length: 40 }, (_, i) => sample(normalVector(i % 4)));
    const a = model.train(samples, 1);
    const b = model.train(samples, 2);

    expect(JSON.stringify(a.trees)).not.toBe(JSON.stringify(b.trees));
  });

  it('scores an obvious outlier higher than a point resembling the training population', () => {
    const samples = Array.from({ length: 80 }, (_, i) => sample(normalVector(i % 5)));
    const artifact = model.train(samples, 3);

    const normalResult = model.score(normalVector(1), artifact);
    const outlierResult = model.score(FEATURE_NAMES.map(() => 10000), artifact);

    expect(outlierResult.anomalyScore).toBeGreaterThan(normalResult.anomalyScore);
  });

  it('keeps anomaly score within [0, 1]', () => {
    const samples = Array.from({ length: 20 }, (_, i) => sample(normalVector(i % 3)));
    const artifact = model.train(samples, 5);

    const result = model.score(FEATURE_NAMES.map(() => -99999), artifact);
    expect(result.anomalyScore).toBeGreaterThanOrEqual(0);
    expect(result.anomalyScore).toBeLessThanOrEqual(1);
  });

  it('handles an empty training set without throwing', () => {
    const artifact = model.train([], 1);
    const result = model.score(normalVector(), artifact);
    expect(Number.isFinite(result.anomalyScore)).toBe(true);
  });
});
