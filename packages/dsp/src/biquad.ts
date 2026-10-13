import { TWO_PI, dbToGain } from './util';

export type BiquadType = 'lowpass' | 'highpass' | 'bandpass' | 'highshelf' | 'lowshelf';

/**
 * Direct form I biquad with Web Audio's conventions: for lowpass and highpass the Q parameter is
 * in dB (Chrome's BiquadFilterNode), for bandpass it is the linear quality factor. Shelves take a
 * gain in dB. Coefficients are recomputed only on `set`, which is cheap enough for per-block
 * modulation (filter envelopes update every 32 samples).
 */
// Coefficients and history in one Float64Array so the state can be read into locals per block.
const B0 = 0;
const B1 = 1;
const B2 = 2;
const A1 = 3;
const A2 = 4;
const X1 = 5;
const X2 = 6;
const Y1 = 7;
const Y2 = 8;

export class Biquad {
  private readonly s = new Float64Array(9);

  constructor() {
    this.s[B0] = 1;
  }

  reset(): void {
    const s = this.s;
    s[X1] = s[X2] = s[Y1] = s[Y2] = 0;
  }

  /** Configure. `q` is dB for lowpass/highpass, linear for bandpass; `gainDb` for shelves. */
  set(type: BiquadType, freq: number, sampleRate: number, q = 1, gainDb = 0): void {
    const nyq = sampleRate * 0.5;
    const f = Math.min(Math.max(freq, 1), nyq * 0.999);
    const w0 = (TWO_PI * f) / sampleRate;
    const cos = Math.cos(w0);
    const sin = Math.sin(w0);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    switch (type) {
      case 'lowpass':
      case 'highpass': {
        // Web Audio: resonance in dB → linear, with the "d" damping form from Blink.
        const g = dbToGain(q);
        const alpha = sin / (2 * g);
        if (type === 'lowpass') {
          b0 = (1 - cos) / 2;
          b1 = 1 - cos;
          b2 = (1 - cos) / 2;
        } else {
          b0 = (1 + cos) / 2;
          b1 = -(1 + cos);
          b2 = (1 + cos) / 2;
        }
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      }
      case 'bandpass': {
        const alpha = sin / (2 * Math.max(q, 0.0001));
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      }
      case 'highshelf':
      case 'lowshelf': {
        const A = Math.pow(10, gainDb / 40);
        const S = 1;
        const alpha = (sin / 2) * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2);
        const beta = 2 * Math.sqrt(A) * alpha;
        if (type === 'highshelf') {
          b0 = A * (A + 1 + (A - 1) * cos + beta);
          b1 = -2 * A * (A - 1 + (A + 1) * cos);
          b2 = A * (A + 1 + (A - 1) * cos - beta);
          a0 = A + 1 - (A - 1) * cos + beta;
          a1 = 2 * (A - 1 - (A + 1) * cos);
          a2 = A + 1 - (A - 1) * cos - beta;
        } else {
          b0 = A * (A + 1 - (A - 1) * cos + beta);
          b1 = 2 * A * (A - 1 - (A + 1) * cos);
          b2 = A * (A + 1 - (A - 1) * cos - beta);
          a0 = A + 1 + (A - 1) * cos + beta;
          a1 = -2 * (A - 1 + (A + 1) * cos);
          a2 = A + 1 + (A - 1) * cos - beta;
        }
        break;
      }
    }
    const s = this.s;
    s[B0] = b0 / a0;
    s[B1] = b1 / a0;
    s[B2] = b2 / a0;
    s[A1] = a1 / a0;
    s[A2] = a2 / a0;
  }

  /** Raw coefficient set (used by the K-weighting filters, whose coefficients are tabulated). */
  setCoefficients(b0: number, b1: number, b2: number, a1: number, a2: number): void {
    const s = this.s;
    s[B0] = b0;
    s[B1] = b1;
    s[B2] = b2;
    s[A1] = a1;
    s[A2] = a2;
  }

  process(x: number): number {
    const s = this.s;
    const x1 = s[X1]!;
    const y1 = s[Y1]!;
    const y = s[B0]! * x + s[B1]! * x1 + s[B2]! * s[X2]! - s[A1]! * y1 - s[A2]! * s[Y2]!;
    s[X2] = x1;
    s[X1] = x;
    s[Y2] = y1;
    s[Y1] = y;
    return y;
  }

  /** Filter buf[from, to) in place; the block form of `process` with the state in locals. */
  processBlock(buf: Float64Array, from: number, to: number): void {
    const s = this.s;
    const b0 = s[B0]!;
    const b1 = s[B1]!;
    const b2 = s[B2]!;
    const a1 = s[A1]!;
    const a2 = s[A2]!;
    let x1 = s[X1]!;
    let x2 = s[X2]!;
    let y1 = s[Y1]!;
    let y2 = s[Y2]!;
    for (let i = from; i < to; i++) {
      const x = buf[i]!;
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      buf[i] = y;
    }
    s[X1] = x1;
    s[X2] = x2;
    s[Y1] = y1;
    s[Y2] = y2;
  }
}
