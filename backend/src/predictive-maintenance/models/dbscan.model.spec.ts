import { DbscanModel } from './dbscan.model';
import { FEATURE_NAMES, TrainingSample } from '../prediction-model.interface';

function sample(features: number[]): TrainingSample {
  return { machineId: 'm1', asOfDate: new Date('2026-01-01'), features };
}

function clusterVector(jitter: number): number[] {
  return FEATURE_NAMES.map((_, i) => 5 + jitter * (((i * 7) % 5) - 2) * 0.1);
}

describe('DbscanModel', () => {
  let model: DbscanModel;

  beforeEach(() => {
    model = new DbscanModel();
  });

  it('identifies at least one dense core region from a tight cluster of samples', () => {
    const samples: TrainingSample[] = Array.from({ length: 30 }, (_, i) => sample(clusterVector(i)));
    const artifact = model.train(samples, 1);

    expect(artifact.corePoints.length).toBeGreaterThan(0);
    expect(artifact.epsilon).toBeGreaterThan(0);
  });

  it('scores a point inside the trained cluster as low anomaly', () => {
    const samples: TrainingSample[] = Array.from({ length: 30 }, (_, i) => sample(clusterVector(i)));
    const artifact = model.train(samples, 1);

    const result = model.score(clusterVector(1), artifact);
    expect(result.anomalyScore).toBeLessThan(0.3);
  });

  it('scores a point far from every dense region as high anomaly', () => {
    const samples: TrainingSample[] = Array.from({ length: 30 }, (_, i) => sample(clusterVector(i)));
    const artifact = model.train(samples, 1);

    const outlier = FEATURE_NAMES.map(() => 5000);
    const result = model.score(outlier, artifact);
    expect(result.anomalyScore).toBeGreaterThan(0.5);
  });

  it('reports zero confidence and a neutral score when no core points could be established', () => {
    const artifact = model.train([sample(FEATURE_NAMES.map(() => 1))], 1);
    const result = model.score(FEATURE_NAMES.map(() => 1), artifact);

    expect(artifact.corePoints).toHaveLength(0);
    expect(result.confidence).toBe(0);
    expect(result.anomalyScore).toBe(0.5);
  });

  it('is deterministic given the same samples', () => {
    const samples: TrainingSample[] = Array.from({ length: 25 }, (_, i) => sample(clusterVector(i)));
    const a = model.train(samples, 1);
    const b = model.train(samples, 1);
    expect(a.corePoints).toEqual(b.corePoints);
  });
});
