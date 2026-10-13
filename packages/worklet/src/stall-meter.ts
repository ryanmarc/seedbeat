/**
 * Audio-thread stall detector. The AudioWorkletGlobalScope has no high-resolution clock, so
 * `process()` cannot time itself (AUDIO.md). What it can see is the wall-clock gap between
 * consecutive render callbacks: the browser renders a hardware buffer's worth of blocks in one
 * burst per callback, so a gap well above the callback period means the thread was held up
 * (garbage collection, pre-emption) and the output almost certainly glitched.
 *
 * The period is normally supplied by the main thread (AudioContext.baseLatency). Without it the
 * meter estimates it as the 90th percentile of the gaps it sees: `Date.now()` has 1 ms
 * resolution, so blocks inside one burst often show a 1–2 ms gap, and a median would learn
 * that instead of the burst-to-burst period on large buffers.
 */
export const MIN_SAMPLES = 48;
const BUCKETS = 128;

export interface StallSnapshot {
  /** Callback period in use, ms (0 until known). */
  periodMs: number;
  /** Largest gap since the previous snapshot, ms. */
  maxGapMs: number;
  /** Gaps judged as stalls since the last reset. */
  stalls: number;
  /** Length of the most recent stall, ms. */
  lastStallMs: number;
  /** Longest single render callback since the previous snapshot, ms (GC inside a burst shows here). */
  maxBusyMs: number;
}

export class StallMeter {
  private last = -1;
  private readonly hist = new Uint32Array(BUCKETS);
  private samples = 0;
  private learned = 0;
  private fixed = 0;
  private maxGap = 0;
  private maxBusy = 0;
  /** When false, gaps and busy times are measured but not counted as stalls. */
  armed = true;
  stalls = 0;
  lastStallMs = 0;

  /** Known callback period from the main thread; 0 falls back to the estimate. */
  setPeriod(ms: number): void {
    this.fixed = ms > 0 ? ms : 0;
  }

  get period(): number {
    if (this.fixed > 0) return this.fixed;
    return this.samples >= MIN_SAMPLES ? this.learned : 0;
  }

  /** Call once per render callback with the wall clock in ms (1 ms resolution is enough). */
  tick(nowMs: number): void {
    if (this.last >= 0) {
      const gap = nowMs - this.last;
      if (gap >= 1) {
        this.hist[Math.min(BUCKETS - 1, Math.floor(gap))]!++;
        this.samples++;
        if (this.samples % 16 === 0 || this.learned === 0) this.learned = this.percentile(0.9);
        if (gap > this.maxGap) this.maxGap = gap;
        const period = this.period;
        if (this.armed && period > 0 && gap > Math.max(period * 2, period + 4)) {
          this.stalls++;
          this.lastStallMs = gap;
        }
      }
    }
    this.last = nowMs;
  }

  /**
   * Time spent inside one render callback. Longer than the period means the output underran even
   * though the gaps between callbacks looked normal (a GC between two blocks of a burst).
   */
  busy(ms: number): void {
    if (ms > this.maxBusy) this.maxBusy = ms;
    const period = this.period;
    if (this.armed && period > 0 && ms > period) {
      this.stalls++;
      this.lastStallMs = ms;
    }
  }

  /** A stall is a gap of at least double the period and at least 4 ms over it. */
  threshold(): number {
    const p = this.period;
    return p > 0 ? Math.max(p * 2, p + 4) : Infinity;
  }

  private percentile(q: number): number {
    let acc = 0;
    const target = this.samples * q;
    for (let i = 0; i < BUCKETS; i++) {
      acc += this.hist[i]!;
      if (acc >= target) return i + 0.5;
    }
    return 0;
  }

  /** Forget the last callback time (pause/resume): the next gap is not a stall. */
  resume(): void {
    this.last = -1;
  }

  /** Clear counts and the estimate; keeps the known period. */
  reset(): void {
    this.last = -1;
    this.hist.fill(0);
    this.samples = 0;
    this.learned = 0;
    this.maxGap = 0;
    this.maxBusy = 0;
    this.stalls = 0;
    this.lastStallMs = 0;
  }

  snapshot(): StallSnapshot {
    const s = {
      periodMs: this.period,
      maxGapMs: this.maxGap,
      stalls: this.stalls,
      lastStallMs: this.lastStallMs,
      maxBusyMs: this.maxBusy,
    };
    this.maxGap = 0;
    this.maxBusy = 0;
    return s;
  }
}
