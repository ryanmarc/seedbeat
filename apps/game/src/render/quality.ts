/**
 * Resolution quality controller (RENDERING.md §5). Pure decision logic; the stage applies tiers.
 *
 * Drop rule: two consecutive 1 s windows with mean frame interval > 21 ms or mean CPU work > 9 ms
 * → request one tier lower. Verify: after 2 s at the new tier keep it only if the mean interval
 * improved by more than 15 %; otherwise try one more tier, then restore the original and lock.
 */
export const TIERS = [2, 1.5, 1.25, 1] as const;
export const WINDOW_SEC = 1;
export const INTERVAL_LIMIT = 0.021;
export const WORK_LIMIT = 0.009;
export const IMPROVEMENT = 0.15;

export interface QualityState {
  tier: number;
  locked: boolean;
  /** Tier waiting to be applied in a gap, or null. */
  pending: number | null;
}

export class QualityController {
  readonly state: QualityState;
  private ivSum = 0;
  private workSum = 0;
  private n = 0;
  private windowStart = 0;
  private strikes = 0;
  private before = 0;
  private verify: { from: number; before: number; windows: number; tries: number } | null = null;
  private next: { from: number; before: number; tries: number } | null = null;
  private since = 0;

  constructor(startTier = 0) {
    this.state = { tier: Math.min(startTier, TIERS.length - 1), locked: false, pending: null };
  }

  get resolutionScale(): number {
    return TIERS[this.state.tier]!;
  }

  /** Feed one frame: interval since last frame and CPU work, both in seconds. `t` is any monotonic clock in seconds. */
  record(t: number, interval: number, work: number): void {
    if (!this.windowStart) this.windowStart = t;
    this.ivSum += interval;
    this.workSum += work;
    this.n++;
    if (t - this.windowStart < WINDOW_SEC) return;
    const m = this.ivSum / this.n;
    const w = this.workSum / this.n;
    this.ivSum = this.workSum = 0;
    this.n = 0;
    this.windowStart = t;
    this.evaluate(m, w);
  }

  private evaluate(meanInterval: number, meanWork: number): void {
    const s = this.state;
    if (s.pending !== null) return;
    if (this.verify) {
      if (++this.verify.windows < 2) return;
      const v = this.verify;
      this.verify = null;
      if (meanInterval <= v.before * (1 - IMPROVEMENT)) return; // it helped: keep it
      if (v.tries < 2 && s.tier < TIERS.length - 1) {
        s.pending = s.tier + 1;
        this.next = { from: v.from, before: v.before, tries: v.tries + 1 };
      } else {
        s.pending = v.from; // no gain: restore and stop adjusting
        s.locked = true;
      }
      return;
    }
    if (s.locked) return;
    if (meanWork > WORK_LIMIT || meanInterval > INTERVAL_LIMIT) {
      if (++this.strikes >= 2 && s.tier < TIERS.length - 1) {
        s.pending = s.tier + 1;
        this.before = meanInterval;
      }
    } else this.strikes = 0;
  }

  /**
   * Called each frame with whether the chart has a gap right now. Returns the tier to apply, or
   * null. A gap is: no active hold and no unjudged note within 0.8 s (0.3 s after waiting 5 s).
   */
  tierToApply(t: number, gapCheck: (gapSec: number) => boolean): number | null {
    const s = this.state;
    if (s.pending === null) {
      this.since = 0;
      return null;
    }
    if (!this.since) this.since = t;
    const gap = t - this.since > 5 ? 0.3 : 0.8;
    if (!gapCheck(gap)) return null;
    this.since = 0;
    const from = s.tier;
    const to = s.pending;
    s.pending = null;
    s.tier = to;
    this.strikes = 0;
    this.ivSum = this.workSum = 0;
    this.n = 0;
    this.windowStart = 0;
    if (this.next) {
      this.verify = { ...this.next, windows: 0 };
      this.next = null;
    } else if (to > from) {
      this.verify = { from, before: this.before, windows: 0, tries: 1 };
    }
    return to;
  }
}
