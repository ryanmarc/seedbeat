/** Judgement windows in seconds (TIMING.md §4). Same for heads and releases. */
export const WINDOWS = { perfect: 0.045, great: 0.09, good: 0.135 } as const;

/** Grace beyond the Good window before a note is declared missed in the frame loop (TIMING.md §3). */
export const MISS_GRACE = 0.03;

export type HitJudgement = 'perfect' | 'great' | 'good';
export type ReleaseJudgement = 'rperfect' | 'rgreat' | 'rgood';
/** `drop` = let go early (combo break). */
export type Judgement = HitJudgement | ReleaseJudgement | 'miss' | 'drop';

export const SCORE: Record<Judgement, number> = {
  perfect: 300,
  great: 200,
  good: 100,
  rperfect: 300,
  rgreat: 200,
  rgood: 100,
  miss: 0,
  drop: 0,
};

export const ACCURACY: Record<Judgement, number> = {
  perfect: 1,
  great: 0.7,
  good: 0.35,
  rperfect: 1,
  rgreat: 0.7,
  rgood: 0.35,
  miss: 0,
  drop: 0,
};

export const HEALTH: Record<Judgement, number> = {
  perfect: 1.2,
  great: 0.8,
  good: 0.3,
  rperfect: 1.2,
  rgreat: 0.8,
  rgood: 0.3,
  miss: -9,
  drop: -6,
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

/** Grade a release: `d = tail − t`. Early beyond Good = drop; otherwise by |d|. */
export function judgeRelease(d: number): ReleaseJudgement | 'drop' {
  if (d > WINDOWS.good) return 'drop';
  const a = Math.abs(d);
  return a <= WINDOWS.perfect ? 'rperfect' : a <= WINDOWS.great ? 'rgreat' : 'rgood';
}

export function isRelease(j: Judgement): j is ReleaseJudgement {
  return j === 'rperfect' || j === 'rgreat' || j === 'rgood';
}

export function isBreak(j: Judgement): j is 'miss' | 'drop' {
  return j === 'miss' || j === 'drop';
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
