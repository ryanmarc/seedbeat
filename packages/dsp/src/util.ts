export const TWO_PI = Math.PI * 2;

/** Frames per render block (the AudioWorklet quantum). Scratch buffers are sized to this. */
export const BLOCK_SIZE = 128;

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
  /** uint32 state (exceeds V8's small-integer range, so it lives in a typed array). */
  readonly state = new Float64Array(1);
  constructor(seed = 0x9e3779b9) {
    this.state[0] = seed || 1;
  }
  /** Float in [-1, 1). */
  next(): number {
    let x = this.state[0]!;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    const u = x >>> 0;
    this.state[0] = u;
    return (u / 4294967296) * 2 - 1;
  }
  /** Fill out[from, to) with floats in [-1, 1), in the same sequence `next()` would give. */
  fill(out: Float64Array, from: number, to: number): void {
    let x = this.state[0]!;
    for (let i = from; i < to; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      x >>>= 0;
      out[i] = (x / 4294967296) * 2 - 1;
    }
    this.state[0] = x;
  }
}
