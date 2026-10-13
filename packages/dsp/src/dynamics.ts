import { dbToGain } from './util';

/**
 * Feed-forward compressor approximating Web Audio's DynamicsCompressorNode: soft knee in dB,
 * RMS-free peak detection with attack/release smoothing on the gain, stereo-linked.
 */
export class Compressor {
  private readonly env = new Float64Array(1);
  private attackCoef: number;
  private releaseCoef: number;
  private threshold: number;
  private knee: number;
  private ratio: number;

  constructor(
    sampleRate: number,
    opts: { threshold: number; knee: number; ratio: number; attack: number; release: number },
  ) {
    this.threshold = opts.threshold;
    this.knee = opts.knee;
    this.ratio = opts.ratio;
    this.attackCoef = Math.exp(-1 / (Math.max(opts.attack, 1e-4) * sampleRate));
    this.releaseCoef = Math.exp(-1 / (Math.max(opts.release, 1e-3) * sampleRate));
  }

  /** Gain multiplier for this sample given the linked peak level |l|,|r|. */
  gain(peak: number): number {
    const inDb = 20 * Math.log10(Math.max(peak, 1e-12));
    const t = this.threshold;
    const k = this.knee;
    let outDb: number;
    const over = inDb - t;
    if (over <= -k / 2) outDb = inDb;
    else if (over >= k / 2) outDb = t + over / this.ratio;
    else {
      const x = over + k / 2;
      outDb = inDb + ((1 / this.ratio - 1) * x * x) / (2 * k);
    }
    const target = outDb - inDb; // ≤ 0 dB
    const targetGain = Math.pow(10, target / 20);
    // Smooth the gain: attack when reducing, release when recovering.
    const env = this.env[0]!;
    const coef = targetGain < env ? this.attackCoef : this.releaseCoef;
    const next = env === 0 ? targetGain : targetGain + (env - targetGain) * coef;
    this.env[0] = next;
    return next;
  }

  /** Block form of `gain`: out[i] = gain for the linked peak of l[i], r[i]. */
  gainBlock(l: Float64Array, r: Float64Array, out: Float64Array, n: number): void {
    const t = this.threshold;
    const k = this.knee;
    const ratio = this.ratio;
    const attack = this.attackCoef;
    const release = this.releaseCoef;
    let env = this.env[0]!;
    for (let i = 0; i < n; i++) {
      const peak = Math.max(Math.abs(l[i]!), Math.abs(r[i]!));
      const inDb = 20 * Math.log10(Math.max(peak, 1e-12));
      let outDb: number;
      const over = inDb - t;
      if (over <= -k / 2) outDb = inDb;
      else if (over >= k / 2) outDb = t + over / ratio;
      else {
        const x = over + k / 2;
        outDb = inDb + ((1 / ratio - 1) * x * x) / (2 * k);
      }
      const targetGain = Math.pow(10, (outDb - inDb) / 20);
      const coef = targetGain < env ? attack : release;
      env = env === 0 ? targetGain : targetGain + (env - targetGain) * coef;
      out[i] = env;
    }
    this.env[0] = env;
  }

  reset(): void {
    this.env[0] = 0;
  }
}

/**
 * Lookahead brick-wall limiter. Delays the signal by the lookahead, computes the gain needed so the
 * delayed peak never exceeds the ceiling, attacks instantly over the lookahead window (minimum of
 * required gains) and releases exponentially. The ceiling is set below the true-peak target to
 * leave room for inter-sample peaks.
 */
export class Limiter {
  private bufL: Float32Array;
  private bufR: Float32Array;
  private gains: Float32Array;
  private w = 0;
  private len: number;
  private ceiling: number;
  private releaseCoef: number;
  private readonly gain = new Float64Array([1]);

  constructor(sampleRate: number, ceilingDb = -1.5, lookaheadSec = 0.0015, releaseSec = 0.08) {
    this.len = Math.max(2, Math.round(lookaheadSec * sampleRate));
    this.bufL = new Float32Array(this.len);
    this.bufR = new Float32Array(this.len);
    this.gains = new Float32Array(this.len);
    this.ceiling = dbToGain(ceilingDb);
    this.releaseCoef = Math.exp(-1 / (releaseSec * sampleRate));
  }

  get latencySamples(): number {
    return this.len;
  }

  reset(): void {
    this.bufL.fill(0);
    this.bufR.fill(0);
    this.gains.fill(1);
    this.w = 0;
    this.gain[0] = 1;
  }

  /** Push one stereo sample; writes the limited, delayed sample into out[0], out[1]. */
  process(l: number, r: number, out: Float32Array): void {
    // The sample leaving the delay line now still has its own required gain in the window.
    let minGain = 1;
    for (let i = 0; i < this.len; i++) if (this.gains[i]! < minGain) minGain = this.gains[i]!;
    // Instant attack to the window minimum, exponential release toward 1.
    const prev = this.gain[0]!;
    const gain = minGain < prev ? minGain : minGain + (prev - minGain) * this.releaseCoef;
    this.gain[0] = gain;
    const rd = this.w;
    out[0] = this.bufL[rd]! * gain;
    out[1] = this.bufR[rd]! * gain;
    // Store the incoming sample and the gain it will need by the time it is output.
    const peak = Math.max(Math.abs(l), Math.abs(r));
    this.gains[this.w] = peak > this.ceiling ? this.ceiling / peak : 1;
    this.bufL[this.w] = l;
    this.bufR[this.w] = r;
    this.w = (this.w + 1) % this.len;
  }

  /**
   * Block form of `process`: outL[i] = limited(l[i]) * master. The limited sample is rounded to
   * float32 before the master gain, as the per-sample path does through its Float32Array.
   */
  processBlock(
    l: Float64Array,
    r: Float64Array,
    outL: Float32Array,
    outR: Float32Array,
    n: number,
    master: number,
  ): void {
    const bufL = this.bufL;
    const bufR = this.bufR;
    const gains = this.gains;
    const len = this.len;
    const ceiling = this.ceiling;
    const release = this.releaseCoef;
    let w = this.w;
    let gain = this.gain[0]!;
    for (let i = 0; i < n; i++) {
      let minGain = 1;
      for (let k = 0; k < len; k++) if (gains[k]! < minGain) minGain = gains[k]!;
      gain = minGain < gain ? minGain : minGain + (gain - minGain) * release;
      outL[i] = Math.fround(bufL[w]! * gain) * master;
      outR[i] = Math.fround(bufR[w]! * gain) * master;
      const li = l[i]!;
      const ri = r[i]!;
      const peak = Math.max(Math.abs(li), Math.abs(ri));
      gains[w] = peak > ceiling ? ceiling / peak : 1;
      bufL[w] = li;
      bufR[w] = ri;
      w = (w + 1) % len;
    }
    this.w = w;
    this.gain[0] = gain;
  }
}
