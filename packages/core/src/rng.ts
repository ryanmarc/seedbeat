/**
 * Seeded randomness for generator v1. Ported verbatim from the prototype (`hash32`, `mulberry`,
 * `rngFor`): the port must keep every draw in the same order or golden parity fails.
 */

/** cyrb-style 32-bit string hash. Uses UTF-16 code units, like the prototype. */
export function hash32(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32 PRNG. Returns floats in [0, 1). */
export function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** Next float in [0, 1). */
  f(): number;
  /** Integer in [a, b] inclusive. */
  int(a: number, b: number): number;
  /** Uniform pick from a non-empty array. */
  pick<T>(arr: readonly T[]): T;
  /** True with probability p. */
  chance(p: number): boolean;
}

/**
 * An rng keyed by what it decides, e.g. `rngFor(seed, mood, 'bar', 12)`. Parts are joined with `|`
 * using JavaScript's default number formatting, exactly as the prototype did.
 */
export function rngFor(...parts: (string | number)[]): Rng {
  const f = mulberry(hash32(parts.join('|')));
  return {
    f,
    int: (a, b) => a + Math.floor(f() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(f() * arr.length)]!,
    chance: (p) => f() < p,
  };
}
