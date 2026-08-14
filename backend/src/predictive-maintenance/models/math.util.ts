/** Squashes a non-negative "distance-like" score into (0, 1); larger k means the score climbs more slowly. */
export function squash(value: number, k: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return clamp01(1 - Math.exp(-value / k));
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export type FeatureStats = { mean: number[]; std: number[] };

/** Population mean/std per feature index, with a floor on std to keep division-by-zero from ever producing NaN/Infinity downstream. */
export function computeFeatureStats(
  samples: number[][],
  featureCount: number,
): FeatureStats {
  const mean: number[] = new Array<number>(featureCount).fill(0);
  const std: number[] = new Array<number>(featureCount).fill(0);
  const n = samples.length;

  if (n === 0) {
    return { mean, std: std.map(() => 1) };
  }

  for (const sample of samples) {
    for (let i = 0; i < featureCount; i += 1) mean[i] += (sample[i] ?? 0) / n;
  }
  for (const sample of samples) {
    for (let i = 0; i < featureCount; i += 1) {
      const diff = (sample[i] ?? 0) - mean[i];
      std[i] += (diff * diff) / n;
    }
  }
  for (let i = 0; i < featureCount; i += 1) {
    std[i] = Math.max(Math.sqrt(std[i]), 1e-6);
  }

  return { mean, std };
}

export function standardize(features: number[], stats: FeatureStats): number[] {
  return features.map(
    (value, i) => ((value ?? 0) - stats.mean[i]) / stats.std[i],
  );
}

export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}
