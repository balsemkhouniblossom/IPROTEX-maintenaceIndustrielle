import { ZScoreModel } from './zscore.model';
import { FEATURE_NAMES, TrainingSample } from '../prediction-model.interface';

function sample(machineId: string, features: number[]): TrainingSample {
  return { machineId, asOfDate: new Date('2026-01-01'), features };
}

describe('ZScoreModel', () => {
  let model: ZScoreModel;

  beforeEach(() => {
    model = new ZScoreModel();
  });

  it('trains a mean/std artifact matching the feature vector length', () => {
    const artifact = model.train(
      [
        sample('m1', new Array(FEATURE_NAMES.length).fill(1)),
        sample('m1', new Array(FEATURE_NAMES.length).fill(3)),
      ],
      1,
    );

    expect(artifact.mean).toHaveLength(FEATURE_NAMES.length);
    expect(artifact.std).toHaveLength(FEATURE_NAMES.length);
    expect(artifact.mean[0]).toBeCloseTo(2, 5);
    expect(artifact.trainingSampleCount).toBe(2);
  });

  it('scores a point at the trained mean as low anomaly', () => {
    const baseline = new Array(FEATURE_NAMES.length).fill(5);
    const artifact = model.train(
      Array.from({ length: 20 }, () => sample('m1', baseline)),
      1,
    );

    const result = model.score(baseline, artifact);
    expect(result.anomalyScore).toBeCloseTo(0, 5);
  });

  it('scores a point far from the trained baseline as high anomaly', () => {
    const samples: TrainingSample[] = [];
    for (let i = 0; i < 30; i += 1) {
      samples.push(
        sample(
          'm1',
          new Array(FEATURE_NAMES.length).fill(5 + (i % 2 === 0 ? 0.1 : -0.1)),
        ),
      );
    }
    const artifact = model.train(samples, 1);

    const outlier = new Array(FEATURE_NAMES.length).fill(500);
    const result = model.score(outlier, artifact);

    expect(result.anomalyScore).toBeGreaterThan(0.9);
  });

  it('reports higher confidence with more training samples', () => {
    const few = model.train([sample('m1', [1])], 1);
    const many = model.train(
      Array.from({ length: 60 }, () => sample('m1', [1])),
      1,
    );

    const fewResult = model.score([1], few);
    const manyResult = model.score([1], many);

    expect(manyResult.confidence).toBeGreaterThan(fewResult.confidence);
  });

  it('is deterministic given the same samples', () => {
    const samples = Array.from({ length: 10 }, (_, i) =>
      sample('m1', [i, i * 2]),
    );
    const a = model.train(samples, 1);
    const b = model.train(samples, 1);
    expect(a.mean).toEqual(b.mean);
    expect(a.std).toEqual(b.std);
  });
});
