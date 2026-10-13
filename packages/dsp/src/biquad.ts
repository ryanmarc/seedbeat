import { TWO_PI, dbToGain } from './util';

export type BiquadType = 'lowpass' | 'highpass' | 'bandpass' | 'highshelf' | 'lowshelf';

/**
 * Direct form I biquad with Web Audio's conventions: for lowpass and highpass the Q parameter is
 * in dB (Chrome's BiquadFilterNode), for bandpass it is the linear quality factor. Shelves take a
 * gain in dB. Coefficients are recomputed only on `set`, which is cheap enough for per-block
 * modulation (filter envelopes update every 32 samples).
 */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
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
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  /** Raw coefficient set (used by the K-weighting filters, whose coefficients are tabulated). */
  setCoefficients(b0: number, b1: number, b2: number, a1: number, a2: number): void {
    this.b0 = b0;
    this.b1 = b1;
    this.b2 = b2;
    this.a1 = a1;
    this.a2 = a2;
  }

  process(x: number): number {
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}
