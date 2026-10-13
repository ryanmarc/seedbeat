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

/**
 * Band-limited oscillator (polyBLEP). Pulse waves are square waves with a duty cycle, the
 * equivalent of the prototype's 64-harmonic PeriodicWave. Triangle is a leaky-integrated square.
 */
export class Oscillator {
  private phase = 0;
  private tri = 0;
  private wave: Wave = 'sine';
  private duty = 0.5;
  /** Phase increment per sample. */
  private dt = 0;

  reset(wave: Wave, phase = 0): void {
    this.wave = wave;
    this.duty = DUTY[wave];
    this.phase = phase;
    this.tri = 0;
  }

  setFrequency(hz: number, sampleRate: number): void {
    this.dt = hz / sampleRate;
  }

  /** Next sample in [-1, 1]. */
  next(): number {
    const t = this.phase;
    const dt = this.dt;
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
        const d = this.duty;
        v = t < d ? 1 : -1;
        v += polyBlep(t, dt);
        v -= polyBlep((t - d + 1) % 1, dt);
        // Remove the DC offset of an asymmetric pulse and normalise the peak to 1, matching a
        // PeriodicWave with no DC term and Web Audio's default normalisation.
        v = (v - (2 * d - 1)) / (2 - 2 * d);
        break;
      }
      case 'triangle': {
        let sq = t < 0.5 ? 1 : -1;
        sq += polyBlep(t, dt);
        sq -= polyBlep((t + 0.5) % 1, dt);
        // Leaky integrator scaled so the peak is about ±1.
        this.tri = (1 - dt * 4) * this.tri + 4 * dt * sq;
        v = this.tri;
        break;
      }
    }
    this.phase = t + dt;
    if (this.phase >= 1) this.phase -= 1;
    return v;
  }
}
