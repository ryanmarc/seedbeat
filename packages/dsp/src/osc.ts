import { TWO_PI } from './util';

export type Wave = 'sine' | 'triangle' | 'sawtooth' | 'square' | 'pulse25' | 'pulse12';

const DUTY: Record<Wave, number> = {
  sine: 0.5,
  triangle: 0.5,
  sawtooth: 0.5,
  square: 0.5,
  pulse25: 0.25,
  pulse12: 0.125,
};

/** polyBLEP residual for a discontinuity at phase t (0..1) with per-sample increment dt. */
function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

const PHASE = 0;
const TRI = 1;
const DT = 2;
const DUTY_SLOT = 3;

/**
 * Band-limited oscillator (polyBLEP). Pulse waves are square waves with a duty cycle, the
 * equivalent of the prototype's 64-harmonic PeriodicWave. Triangle is a leaky-integrated square.
 *
 * `render` produces a whole block in one loop with local state. The per-sample `next()` exists
 * for tests; on the audio thread every non-inlined call that passes or returns a fraction boxes
 * it as a heap number, so the hot path only crosses function boundaries once per block
 * (PERFORMANCE.md §3).
 */
export class Oscillator {
  private readonly s = new Float64Array(4);
  private wave: Wave = 'sine';

  constructor() {
    this.s[DUTY_SLOT] = 0.5;
  }

  reset(wave: Wave, phase = 0): void {
    this.wave = wave;
    this.s[DUTY_SLOT] = DUTY[wave];
    this.s[PHASE] = phase;
    this.s[TRI] = 0;
  }

  setFrequency(hz: number, sampleRate: number): void {
    this.s[DT] = hz / sampleRate;
  }

  /** Next sample in [-1, 1]. */
  next(): number {
    const s = this.s;
    const t = s[PHASE]!;
    const dt = s[DT]!;
    let v: number;
    switch (this.wave) {
      case 'sine':
        v = Math.sin(TWO_PI * t);
        break;
      case 'sawtooth':
        v = 2 * t - 1 - polyBlep(t, dt);
        break;
      case 'square':
      case 'pulse25':
      case 'pulse12': {
        const d = s[DUTY_SLOT]!;
        v = t < d ? 1 : -1;
        v += polyBlep(t, dt);
        v -= polyBlep((t - d + 1) % 1, dt);
        v = (v - (2 * d - 1)) / (2 - 2 * d);
        break;
      }
      case 'triangle': {
        let sq = t < 0.5 ? 1 : -1;
        sq += polyBlep(t, dt);
        sq -= polyBlep((t + 0.5) % 1, dt);
        const tri = (1 - dt * 4) * s[TRI]! + 4 * dt * sq;
        s[TRI] = tri;
        v = tri;
        break;
      }
    }
    let phase = t + dt;
    if (phase >= 1) phase -= 1;
    s[PHASE] = phase;
    return v;
  }

  /**
   * Render samples [from, to) into `out`, adding when `add` is set. With `hz`, the frequency is
   * taken per sample from `hz[i]` (pitch sweeps); otherwise from `setFrequency`.
   */
  render(
    out: Float64Array,
    from: number,
    to: number,
    add: boolean,
    hz: Float64Array | null,
    sampleRate: number,
  ): void {
    const s = this.s;
    let t = s[PHASE]!;
    let dt = s[DT]!;
    const d = s[DUTY_SLOT]!;
    let tri = s[TRI]!;
    switch (this.wave) {
      case 'sine':
        for (let i = from; i < to; i++) {
          if (hz !== null) dt = hz[i]! / sampleRate;
          const v = Math.sin(TWO_PI * t);
          out[i] = add ? out[i]! + v : v;
          t += dt;
          if (t >= 1) t -= 1;
        }
        break;
      case 'sawtooth':
        for (let i = from; i < to; i++) {
          if (hz !== null) dt = hz[i]! / sampleRate;
          const v = 2 * t - 1 - polyBlep(t, dt);
          out[i] = add ? out[i]! + v : v;
          t += dt;
          if (t >= 1) t -= 1;
        }
        break;
      case 'square':
      case 'pulse25':
      case 'pulse12':
        for (let i = from; i < to; i++) {
          if (hz !== null) dt = hz[i]! / sampleRate;
          let v = t < d ? 1 : -1;
          v += polyBlep(t, dt);
          v -= polyBlep((t - d + 1) % 1, dt);
          // Remove the DC offset of an asymmetric pulse and normalise the peak to 1, matching a
          // PeriodicWave with no DC term and Web Audio's default normalisation.
          v = (v - (2 * d - 1)) / (2 - 2 * d);
          out[i] = add ? out[i]! + v : v;
          t += dt;
          if (t >= 1) t -= 1;
        }
        break;
      case 'triangle':
        for (let i = from; i < to; i++) {
          if (hz !== null) dt = hz[i]! / sampleRate;
          let sq = t < 0.5 ? 1 : -1;
          sq += polyBlep(t, dt);
          sq -= polyBlep((t + 0.5) % 1, dt);
          // Leaky integrator scaled so the peak is about ±1.
          tri = (1 - dt * 4) * tri + 4 * dt * sq;
          out[i] = add ? out[i]! + tri : tri;
          t += dt;
          if (t >= 1) t -= 1;
        }
        break;
    }
    s[PHASE] = t;
    s[DT] = dt;
    s[TRI] = tri;
  }
}
