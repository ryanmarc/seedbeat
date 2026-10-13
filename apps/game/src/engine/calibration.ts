/**
 * Audio offset calibration (TIMING.md §5): 24 clicks at 100 BPM, the first 4 are warm-up.
 * Pure estimator so the harness can script taps.
 */
export const CLICK_COUNT = 24;
export const WARMUP_CLICKS = 4;
export const CLICK_INTERVAL = 0.6;
/** Seconds after start before the first click. */
export const FIRST_CLICK_DELAY = 1;
/** Taps further than this from any click are ignored. */
export const MAX_DEVIATION = 0.25;

export interface CalibrationEstimate {
  /** Trimmed mean of deviations, seconds. */
  offset: number;
  /** Half the interquartile range, seconds. */
  spread: number;
  taps: number;
}

/** Deviation of a tap (song-time seconds since the first click) from the nearest click, or null. */
export function tapDeviation(tSinceFirstClick: number): number | null {
  const k = Math.round(tSinceFirstClick / CLICK_INTERVAL);
  if (k < WARMUP_CLICKS || k >= CLICK_COUNT) return null;
  const d = tSinceFirstClick - k * CLICK_INTERVAL;
  return Math.abs(d) > MAX_DEVIATION ? null : d;
}

export function estimateOffset(deviations: readonly number[]): CalibrationEstimate {
  const b = [...deviations].sort((x, y) => x - y);
  const n = b.length;
  if (n === 0) return { offset: 0, spread: 0, taps: 0 };
  const k = Math.floor(n * 0.2);
  const mid = b.slice(k, n - k || n);
  const offset = mid.reduce((x, y) => x + y, 0) / mid.length;
  const spread = n >= 4 ? (b[Math.floor(n * 0.75)]! - b[Math.floor(n * 0.25)]!) / 2 : 0;
  return { offset, spread, taps: n };
}
