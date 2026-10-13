/**
 * Frame pacing (TIMING.md §6): on fast screens that cannot hold cadence, draw every other
 * refresh. Pure decision over interval samples; the controller is sticky for the session.
 */

export const SAMPLE_FRAMES = 120;
/** Refresh intervals below this (seconds) count as "faster than 80 Hz". */
export const FAST_REFRESH = 0.0125;
export const LATE_FRACTION = 0.06;
export const LATE_FACTOR = 1.5;

export interface PacingDecision {
  /** 20th-percentile interval, seconds. */
  refresh: number;
  late: number;
  half: boolean;
}

/** Decide from one window of raw frame intervals (seconds), given the current mode. */
export function decidePacing(
  intervals: readonly number[],
  currentlyHalf: boolean,
  refreshIfHalf: number,
): PacingDecision {
  const sorted = [...intervals].sort((a, b) => a - b);
  const refresh = currentlyHalf ? refreshIfHalf : sorted[Math.floor(sorted.length * 0.2)]!;
  const step = currentlyHalf ? refresh * 2 : refresh;
  const late = intervals.filter((x) => x > step * LATE_FACTOR).length / intervals.length;
  const half = currentlyHalf || (refresh < FAST_REFRESH && late > LATE_FRACTION);
  return { refresh, late, half };
}

export class PacingController {
  private readonly ivs: number[] = [];
  private last = Number.NaN;
  private skipNext = false;
  refresh = 0;
  late = 0;
  half = false;

  /** Returns true when this refresh should be skipped (half mode draws every other one). */
  skipThisRefresh(frameTimeMs: number): boolean {
    if (!Number.isNaN(this.last)) this.record((frameTimeMs - this.last) / 1000);
    this.last = frameTimeMs;
    if (!this.half) return false;
    this.skipNext = !this.skipNext;
    return this.skipNext;
  }

  private record(interval: number): void {
    this.ivs.push(interval);
    if (this.ivs.length < SAMPLE_FRAMES) return;
    const d = decidePacing(this.ivs, this.half, this.refresh);
    this.ivs.length = 0;
    this.refresh = d.refresh;
    this.late = d.late;
    this.half = d.half;
  }
}
