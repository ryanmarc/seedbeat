/**
 * Envelopes that reproduce the Web Audio automation shapes the prototype used:
 * - `AdsrEnv`: linearRamp to peak over `a`, setTargetAtTime(sustain, tau = d/3), on release
 *   setTargetAtTime(0, tau = r/3). Finished when the level decays below the floor after release.
 * - `ExpEnv`: exponentialRamp from 1e-4 to peak over `a`, then exponentialRamp to 1e-4 at `dur`.
 *
 * Each has a per-sample `next()` (tests) and a block `render()` used on the audio thread, which
 * keeps the state in locals so no fraction crosses a function boundary per sample.
 */

const FLOOR = 1e-4;
const DONE = 2e-5;

const A_LEVEL = 0;
const A_PEAK = 1;
const A_SUSTAIN = 2;
const A_STEP = 3;
const A_DECAY = 4;
const A_RELEASE = 5;
/** Sample index (relative to trigger) at which release starts, or Infinity while held. */
const A_RELEASE_AT = 6;
const A_I = 7;

type AdsrStage = 'idle' | 'attack' | 'decay' | 'release';

export class AdsrEnv {
  private readonly s = new Float64Array(8);
  private stage: AdsrStage = 'idle';

  constructor() {
    this.s[A_RELEASE_AT] = Infinity;
  }

  trigger(
    peak: number,
    a: number,
    d: number,
    s: number,
    r: number,
    holdSec: number,
    sampleRate: number,
  ): void {
    const st = this.s;
    st[A_LEVEL] = 0;
    st[A_PEAK] = peak;
    st[A_SUSTAIN] = peak * s;
    const aSamples = Math.max(1, Math.round(a * sampleRate));
    st[A_STEP] = peak / aSamples;
    st[A_DECAY] = Math.exp(-1 / (Math.max(d / 3, 1e-4) * sampleRate));
    st[A_RELEASE] = Math.exp(-1 / (Math.max(r / 3, 1e-4) * sampleRate));
    // Release begins at max(dur, a), as in the prototype.
    st[A_RELEASE_AT] = Math.round(Math.max(holdSec, a) * sampleRate);
    this.stage = 'attack';
    st[A_I] = 0;
  }

  /** Force release now (voice stealing, stop). */
  release(): void {
    if (this.stage !== 'idle' && this.stage !== 'release') this.stage = 'release';
  }

  get active(): boolean {
    return this.stage !== 'idle';
  }

  next(): number {
    const st = this.s;
    const i = st[A_I]!;
    st[A_I] = i + 1;
    if (i >= st[A_RELEASE_AT]! && this.stage !== 'release') this.stage = 'release';
    let level = st[A_LEVEL]!;
    switch (this.stage) {
      case 'attack':
        level += st[A_STEP]!;
        if (level >= st[A_PEAK]!) {
          level = st[A_PEAK]!;
          this.stage = 'decay';
        }
        break;
      case 'decay': {
        const sus = st[A_SUSTAIN]!;
        level = sus + (level - sus) * st[A_DECAY]!;
        break;
      }
      case 'release':
        level *= st[A_RELEASE]!;
        if (level < DONE) {
          level = 0;
          this.stage = 'idle';
        }
        break;
      case 'idle':
        return 0;
    }
    st[A_LEVEL] = level;
    return level;
  }

  /**
   * Write levels for samples [from, to) into `out`. Returns the index at which the envelope went
   * idle (samples from there on were not written), or `to` if it is still running.
   */
  render(out: Float64Array, from: number, to: number): number {
    const st = this.s;
    let stage = this.stage;
    if (stage === 'idle') return from;
    let i = st[A_I]!;
    let level = st[A_LEVEL]!;
    const peak = st[A_PEAK]!;
    const sus = st[A_SUSTAIN]!;
    const step = st[A_STEP]!;
    const decay = st[A_DECAY]!;
    const rel = st[A_RELEASE]!;
    const releaseAt = st[A_RELEASE_AT]!;
    let end = to;
    for (let j = from; j < to; j++) {
      const n = i++;
      if (n >= releaseAt && stage !== 'release') stage = 'release';
      if (stage === 'attack') {
        level += step;
        if (level >= peak) {
          level = peak;
          stage = 'decay';
        }
      } else if (stage === 'decay') {
        level = sus + (level - sus) * decay;
      } else {
        level *= rel;
        if (level < DONE) {
          level = 0;
          stage = 'idle';
          end = j;
          break;
        }
      }
      out[j] = level;
    }
    st[A_I] = i;
    st[A_LEVEL] = level;
    this.stage = stage;
    return end;
  }
}

const E_LEVEL = 0;
const E_ATTACK_RATIO = 1;
const E_DECAY_RATIO = 2;
const E_ATTACK_END = 3;
const E_END = 4;
const E_I = 5;

export class ExpEnv {
  private readonly s = new Float64Array(6);
  private stage: 'idle' | 'attack' | 'decay' = 'idle';

  constructor() {
    this.s[E_LEVEL] = FLOOR;
    this.s[E_ATTACK_RATIO] = 1;
    this.s[E_DECAY_RATIO] = 1;
  }

  /** Peak reached at `a` seconds, back to the floor at `dur` seconds, then silent. */
  trigger(peak: number, a: number, dur: number, sampleRate: number): void {
    const st = this.s;
    const p = Math.max(peak, 2e-4);
    const aS = Math.max(1, Math.round(a * sampleRate));
    const dS = Math.max(aS + 1, Math.round(dur * sampleRate));
    st[E_LEVEL] = FLOOR;
    st[E_ATTACK_RATIO] = Math.pow(p / FLOOR, 1 / aS);
    st[E_DECAY_RATIO] = Math.pow(FLOOR / p, 1 / (dS - aS));
    st[E_ATTACK_END] = aS;
    st[E_END] = dS;
    this.stage = 'attack';
    st[E_I] = 0;
  }

  get active(): boolean {
    return this.stage !== 'idle';
  }

  next(): number {
    if (this.stage === 'idle') return 0;
    const st = this.s;
    const i = st[E_I]!;
    st[E_I] = i + 1;
    let level = st[E_LEVEL]!;
    if (i < st[E_ATTACK_END]!) level *= st[E_ATTACK_RATIO]!;
    else if (i < st[E_END]!) level *= st[E_DECAY_RATIO]!;
    else {
      this.stage = 'idle';
      level = 0;
    }
    st[E_LEVEL] = level;
    return level;
  }

  /** Block form of `next()`; returns the index at which the envelope ended, or `to`. */
  render(out: Float64Array, from: number, to: number): number {
    if (this.stage === 'idle') return from;
    const st = this.s;
    let i = st[E_I]!;
    let level = st[E_LEVEL]!;
    const aEnd = st[E_ATTACK_END]!;
    const dEnd = st[E_END]!;
    const aRatio = st[E_ATTACK_RATIO]!;
    const dRatio = st[E_DECAY_RATIO]!;
    let end = to;
    for (let j = from; j < to; j++) {
      const n = i++;
      if (n < aEnd) level *= aRatio;
      else if (n < dEnd) level *= dRatio;
      else {
        this.stage = 'idle';
        level = 0;
        end = j;
        break;
      }
      out[j] = level;
    }
    st[E_I] = i;
    st[E_LEVEL] = level;
    return end;
  }
}

const R_VALUE = 0;
const R_RATIO = 1;
const R_REMAINING = 2;
const R_TARGET = 3;

/** Exponential parameter ramp (frequency sweeps), evaluated per sample. */
export class ExpRamp {
  private readonly s = new Float64Array(4);

  constructor() {
    this.s[R_RATIO] = 1;
  }

  set(from: number, to: number, seconds: number, sampleRate: number): void {
    const st = this.s;
    st[R_VALUE] = from;
    st[R_TARGET] = to;
    const remaining = Math.max(1, Math.round(seconds * sampleRate));
    st[R_REMAINING] = remaining;
    st[R_RATIO] = Math.pow(to / from, 1 / remaining);
  }

  next(): number {
    return this.advance(1);
  }

  /** Step the ramp `n` times and return the value after the last step. */
  advance(n: number): number {
    const st = this.s;
    let remaining = st[R_REMAINING]!;
    let v = st[R_VALUE]!;
    const ratio = st[R_RATIO]!;
    const target = st[R_TARGET]!;
    for (let k = 0; k < n; k++) {
      if (remaining > 0) {
        remaining--;
        v *= ratio;
        if (remaining === 0) v = target;
      }
    }
    st[R_REMAINING] = remaining;
    st[R_VALUE] = v;
    return v;
  }

  /** Write the value after each of the steps for samples [from, to). */
  render(out: Float64Array, from: number, to: number): void {
    const st = this.s;
    let remaining = st[R_REMAINING]!;
    let v = st[R_VALUE]!;
    const ratio = st[R_RATIO]!;
    const target = st[R_TARGET]!;
    for (let i = from; i < to; i++) {
      if (remaining > 0) {
        remaining--;
        v *= ratio;
        if (remaining === 0) v = target;
      }
      out[i] = v;
    }
    st[R_REMAINING] = remaining;
    st[R_VALUE] = v;
  }
}
