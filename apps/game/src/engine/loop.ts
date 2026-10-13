/**
 * The frame loop (RENDERING.md §4):
 *   rAF → pacing skip? → clock.sample → session.update → scene.update → render → monitors
 * Nothing in here allocates once running; stats go into preallocated typed arrays that the
 * perf harness and the diagnostics overlay read.
 */
import { PacingController } from './pacing';
import { QualityController } from '../render/quality';

export const STATS_FRAMES = 4096;

export interface FrameStats {
  /** Raw interval between rAF timestamps, seconds. */
  intervals: Float32Array;
  /** Main-thread time inside the frame callback, seconds. */
  work: Float32Array;
  count: number;
  /** Frames skipped by the pacing controller. */
  skipped: number;
}

export interface LoopHooks {
  /** Do the frame's work for rAF timestamp `frameTimeMs`. */
  frame(frameTimeMs: number): void;
  /** Called when the quality controller wants a new tier applied (in a chart gap). */
  applyTier?(tier: number): void;
  /** Chart gap check for tier changes. */
  inGap?(gapSec: number): boolean;
}

export class GameLoop {
  readonly pacing = new PacingController();
  readonly quality: QualityController;
  readonly stats: FrameStats = {
    intervals: new Float32Array(STATS_FRAMES),
    work: new Float32Array(STATS_FRAMES),
    count: 0,
    skipped: 0,
  };
  private raf = 0;
  private last = Number.NaN;
  private running = false;
  monitoring = true;

  constructor(
    private readonly hooks: LoopHooks,
    startTier = 0,
  ) {
    this.quality = new QualityController(startTier);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = Number.NaN;
    const tick = (now: number): void => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      this.step(now);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** One frame; public so tests can drive it. */
  step(now: number): void {
    if (this.pacing.skipThisRefresh(now)) {
      this.stats.skipped++;
      return;
    }
    const raw = Number.isNaN(this.last) ? 0 : (now - this.last) / 1000;
    this.last = now;
    const w0 = performance.now();
    this.hooks.frame(now);
    const work = (performance.now() - w0) / 1000;
    if (this.monitoring && raw > 0) {
      const s = this.stats;
      if (s.count < STATS_FRAMES) {
        s.intervals[s.count] = raw;
        s.work[s.count] = work;
        s.count++;
      }
      this.quality.record(now / 1000, raw, work);
      if (this.hooks.applyTier && this.hooks.inGap) {
        const tier = this.quality.tierToApply(now / 1000, this.hooks.inGap);
        if (tier !== null) this.hooks.applyTier(tier);
      }
    }
  }

  resetStats(): void {
    this.stats.count = 0;
    this.stats.skipped = 0;
  }
}

export interface StatsSummary {
  frames: number;
  fps: number;
  /** Fraction of frames later than 1.5× the refresh interval. */
  late: number;
  p50Ms: number;
  p95Ms: number;
  workP95Ms: number;
  refreshHz: number;
  skipped: number;
}

/** Summarise recorded frames; uses the 20th-percentile interval as the refresh estimate. */
export function summarizeStats(s: FrameStats): StatsSummary {
  const n = s.count;
  if (!n)
    return {
      frames: 0,
      fps: 0,
      late: 0,
      p50Ms: 0,
      p95Ms: 0,
      workP95Ms: 0,
      refreshHz: 0,
      skipped: s.skipped,
    };
  const iv = Array.from(s.intervals.subarray(0, n)).sort((a, b) => a - b);
  const wk = Array.from(s.work.subarray(0, n)).sort((a, b) => a - b);
  const refresh = iv[Math.floor(n * 0.2)]!;
  let late = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += s.intervals[i]!;
    if (s.intervals[i]! > refresh * 1.5) late++;
  }
  return {
    frames: n,
    fps: n / total,
    late: late / n,
    p50Ms: iv[Math.floor(n * 0.5)]! * 1000,
    p95Ms: iv[Math.floor(n * 0.95)]! * 1000,
    workP95Ms: wk[Math.floor(n * 0.95)]! * 1000,
    refreshHz: 1 / refresh,
    skipped: s.skipped,
  };
}
