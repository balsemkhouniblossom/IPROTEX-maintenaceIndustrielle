/**
 * A tiny deterministic PRNG (mulberry32) — every model that needs
 * randomness (Isolation Forest's random splits, the Autoencoder's initial
 * weights) is seeded from the trained artifact's stored `randomSeed`, so
 * re-running training with the same seed and the same samples reproduces
 * byte-identical model parameters. `Math.random()` is never used anywhere
 * in this module for exactly that reason.
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = toSignedInt32(state);
    state = toSignedInt32(state + 0x6d2b79f5);
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toSignedInt32(value: number): number {
  const unsigned = Math.trunc(value) >>> 0;
  return unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned;
}

export function randomInt(rng: () => number, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

export function shuffleInPlace<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomInt(rng, i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
