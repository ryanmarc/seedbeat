/** Judgement windows for note heads, in seconds (TIMING.md §4). */
export const WINDOWS = { perfect: 0.045, great: 0.09, good: 0.135 } as const;
/**
 * A hold's tail pays sustain points for the fraction of it actually held (Guitar Hero rules,
 * 2026-10-17): a fully held sustain is worth one Perfect at the current multiplier. Letting go
 * early forfeits the rest and nothing else; there is no release judgement.
 */
export const SUSTAIN_SCORE = 300;

/** Grace beyond the Good window before a note is declared missed in the frame loop (TIMING.md §3). */
export const MISS_GRACE = 0.03;

export type HitJudgement = 'perfect' | 'great' | 'good';
/** Only note heads are judged; a hold's tail scores through `SUSTAIN_SCORE`. */
export type Judgement = HitJudgement | 'miss';

export const SCORE: Record<Judgement, number> = {
  perfect: 300,
  great: 200,
  good: 100,
  miss: 0,
};

export const ACCURACY: Record<Judgement, number> = {
  perfect: 1,
  great: 0.7,
  good: 0.35,
  miss: 0,
};

export const HEALTH: Record<Judgement, number> = {
  perfect: 1.2,
  great: 0.8,
  good: 0.3,
  miss: -9,
};

/** Easy scales penalties by this factor (PRD §2). */
export const EASY_PENALTY_SCALE = 0.65;

/** Grade a head hit by absolute offset; null when outside the Good window. */
export function judgeHit(absOffset: number): HitJudgement | null {
  if (absOffset <= WINDOWS.perfect) return 'perfect';
  if (absOffset <= WINDOWS.great) return 'great';
  if (absOffset <= WINDOWS.good) return 'good';
  return null;
}

export function isBreak(j: Judgement): j is 'miss' {
  return j === 'miss';
}

/** Score multiplier from combo (PRD §2). */
export function multiplier(combo: number): number {
  return 1 + Math.min(combo, 100) / 100;
}

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

/** Grade from accuracy (0–1); F when failed. */
export function gradeFor(accuracy: number, failed: boolean): Grade {
  if (failed) return 'F';
  const pct = accuracy * 100;
  if (pct >= 95) return 'S';
  if (pct >= 88) return 'A';
  if (pct >= 78) return 'B';
  if (pct >= 65) return 'C';
  return 'D';
}
