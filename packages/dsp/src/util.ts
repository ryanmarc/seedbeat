export const TWO_PI = Math.PI * 2;

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(g: number): number {
  return 20 * Math.log10(Math.max(g, 1e-12));
}

export function mtof(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Clamp a sample to the [-1, 1] range. */
export function clampSample(x: number): number {
  return x < -1 ? -1 : x > 1 ? 1 : x;
}

/** Small deterministic PRNG (xorshift32) for noise sources. Not for generation; see @seedbeat/core. */
export class Xorshift {
  private s: number;
  constructor(seed = 0x9e3779b9) {
    this.s = seed || 1;
  }
  /** Float in [-1, 1). */
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return (this.s / 4294967296) * 2 - 1;
  }
}
