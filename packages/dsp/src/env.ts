/**
 * Envelopes that reproduce the Web Audio automation shapes the prototype used:
 * - `AdsrEnv`: linearRamp to peak over `a`, setTargetAtTime(sustain, tau = d/3), on release
 *   setTargetAtTime(0, tau = r/3). Finished when the level decays below the floor after release.
 * - `ExpEnv`: exponentialRamp from 1e-4 to peak over `a`, then exponentialRamp to 1e-4 at `dur`.
 */

const FLOOR = 1e-4;
const DONE = 2e-5;

export class AdsrEnv {
  private level = 0;
  private stage: 'idle' | 'attack' | 'decay' | 'release' = 'idle';
  private peak = 0;
  private sustain = 0;
  private attackStep = 0;
  private decayCoef = 1;
  private releaseCoef = 1;
  /** Sample index (relative to trigger) at which release starts, or Infinity while held. */
  private releaseAt = Infinity;
  private i = 0;

  trigger(
    peak: number,
    a: number,
    d: number,
    s: number,
    r: number,
    holdSec: number,
    sampleRate: number,
  ): void {
    this.level = 0;
    this.peak = peak;
    this.sustain = peak * s;
    const aSamples = Math.max(1, Math.round(a * sampleRate));
    this.attackStep = peak / aSamples;
    this.decayCoef = Math.exp(-1 / (Math.max(d / 3, 1e-4) * sampleRate));
    this.releaseCoef = Math.exp(-1 / (Math.max(r / 3, 1e-4) * sampleRate));
    // Release begins at max(dur, a), as in the prototype.
    this.releaseAt = Math.round(Math.max(holdSec, a) * sampleRate);
    this.stage = 'attack';
    this.i = 0;
  }

  /** Force release now (voice stealing, stop). */
  release(): void {
    if (this.stage !== 'idle' && this.stage !== 'release') this.stage = 'release';
  }

  get active(): boolean {
    return this.stage !== 'idle';
  }

  next(): number {
    const i = this.i++;
    if (i >= this.releaseAt && this.stage !== 'release') this.stage = 'release';
    switch (this.stage) {
      case 'attack':
        this.level += this.attackStep;
        if (this.level >= this.peak) {
          this.level = this.peak;
          this.stage = 'decay';
        }
        break;
      case 'decay':
        this.level = this.sustain + (this.level - this.sustain) * this.decayCoef;
        break;
      case 'release':
        this.level *= this.releaseCoef;
        if (this.level < DONE) {
          this.level = 0;
          this.stage = 'idle';
        }
        break;
      case 'idle':
        return 0;
    }
    return this.level;
  }
}

export class ExpEnv {
  private level = FLOOR;
  private stage: 'idle' | 'attack' | 'decay' = 'idle';
  private attackRatio = 1;
  private decayRatio = 1;
  private attackEnd = 0;
  private end = 0;
  private i = 0;

  /** Peak reached at `a` seconds, back to the floor at `dur` seconds, then silent. */
  trigger(peak: number, a: number, dur: number, sampleRate: number): void {
    const p = Math.max(peak, 2e-4);
    const aS = Math.max(1, Math.round(a * sampleRate));
    const dS = Math.max(aS + 1, Math.round(dur * sampleRate));
    this.level = FLOOR;
    this.attackRatio = Math.pow(p / FLOOR, 1 / aS);
    this.decayRatio = Math.pow(FLOOR / p, 1 / (dS - aS));
    this.attackEnd = aS;
    this.end = dS;
    this.stage = 'attack';
    this.i = 0;
  }

  get active(): boolean {
    return this.stage !== 'idle';
  }

  next(): number {
    if (this.stage === 'idle') return 0;
    const i = this.i++;
    if (i < this.attackEnd) this.level *= this.attackRatio;
    else if (i < this.end) this.level *= this.decayRatio;
    else {
      this.stage = 'idle';
      this.level = 0;
    }
    return this.level;
  }
}

/** Exponential parameter ramp (frequency sweeps), evaluated per sample. */
export class ExpRamp {
  private value = 0;
  private ratio = 1;
  private remaining = 0;
  private target = 0;

  set(from: number, to: number, seconds: number, sampleRate: number): void {
    this.value = from;
    this.target = to;
    this.remaining = Math.max(1, Math.round(seconds * sampleRate));
    this.ratio = Math.pow(to / from, 1 / this.remaining);
  }

  next(): number {
    if (this.remaining > 0) {
      this.remaining--;
      this.value *= this.ratio;
      if (this.remaining === 0) this.value = this.target;
    }
    return this.value;
  }
}
