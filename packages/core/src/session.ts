import type { ChartNote } from './chart';
import {
  ACCURACY,
  EASY_PENALTY_SCALE,
  HEALTH,
  MISS_GRACE,
  SCORE,
  RELEASE_WINDOWS,
  WINDOWS,
  gradeFor,
  isBreak,
  isRelease,
  judgeHit,
  judgeRelease,
  multiplier,
  type Grade,
  type Judgement,
} from './judgement';

export interface SessionNote extends ChartNote {
  judged: Judgement | null;
  holding: boolean;
  done: boolean;
  dropped: boolean;
}

export interface SessionOptions {
  /** 0 Easy … 3 Expert; Easy scales miss penalties. */
  difficulty: number;
  /** Health never ends the run. */
  noFail?: boolean;
  /** Song mode: song time at which the run completes (total bars × bar length + 1.2 s). */
  endTime?: number;
}

/** Something to show or play: one per judgement, in order. */
export interface JudgementEvent {
  judgement: Judgement;
  lane: number;
  /** Signed offset: note time − input time (positive = early), seconds. 0 for misses. */
  dt: number;
  /** Song time at which the event was produced. */
  t: number;
}

export interface SessionState {
  notes: SessionNote[];
  /** First index that may still need judging. */
  cursor: number;
  holds: (SessionNote | null)[];
  pressed: number[];
  score: number;
  combo: number;
  maxCombo: number;
  counts: { perfect: number; great: number; good: number; miss: number; holds: number };
  accSum: number;
  accN: number;
  health: number;
  /** Health hit zero (and no-fail was off). */
  failed: boolean;
  /** Run is over (failed, or song complete). */
  ended: boolean;
  /** Song time of the last update. */
  time: number;
  /** Inputs whose timestamp targeted a note already judged missed (delivered too late). */
  lateInputs: number;
  readonly options: SessionOptions;
  events: JudgementEvent[];
}

export function createSession(notes: readonly ChartNote[], options: SessionOptions): SessionState {
  return {
    notes: notes.map(toSessionNote),
    cursor: 0,
    holds: [null, null, null, null],
    pressed: [0, 0, 0, 0],
    score: 0,
    combo: 0,
    maxCombo: 0,
    counts: { perfect: 0, great: 0, good: 0, miss: 0, holds: 0 },
    accSum: 0,
    accN: 0,
    health: 100,
    failed: false,
    ended: false,
    time: -Infinity,
    lateInputs: 0,
    options,
    events: [],
  };
}

function toSessionNote(n: ChartNote): SessionNote {
  return {
    t: n.t,
    lane: n.lane,
    end: n.end,
    judged: null,
    holding: false,
    done: false,
    dropped: false,
  };
}

/** Endless: append notes generated ahead of time. They must be later than every existing note. */
export function appendNotes(s: SessionState, notes: readonly ChartNote[]): void {
  for (const n of notes) s.notes.push(toSessionNote(n));
}

export function accuracy(s: SessionState): number {
  return s.accN ? s.accSum / s.accN : 0;
}

export function grade(s: SessionState): Grade {
  return gradeFor(accuracy(s), s.failed);
}

function register(s: SessionState, j: Judgement, lane: number, dt: number, t: number): void {
  s.accSum += ACCURACY[j];
  s.accN++;
  if (isBreak(j)) {
    s.combo = 0;
    s.counts.miss++;
  } else {
    s.combo++;
    if (s.combo > s.maxCombo) s.maxCombo = s.combo;
    const base = isRelease(j) ? j.slice(1) : j;
    s.counts[base as 'perfect' | 'great' | 'good']++;
    s.score += Math.round(SCORE[j] * multiplier(s.combo));
  }
  let hp = HEALTH[j];
  if (isBreak(j) && s.options.difficulty === 0) hp *= EASY_PENALTY_SCALE;
  s.health = Math.min(100, Math.max(0, s.health + hp));
  s.events.push({ judgement: j, lane, dt, t });
  if (s.health <= 0 && !s.options.noFail && !s.ended) {
    s.failed = true;
    s.ended = true;
  }
}

/**
 * Lane pressed at song time `t` (TIMING.md §4): first unjudged note in the lane within the Good
 * window from the cursor. Call `update` for the frame before inputs, as the game loop does.
 */
export function press(s: SessionState, lane: number, t: number): void {
  s.pressed[lane] = (s.pressed[lane] ?? 0) + 1;
  if (s.ended) return;
  for (let i = s.cursor; i < s.notes.length; i++) {
    const n = s.notes[i]!;
    if (n.t > t + WINDOWS.good) break;
    if (n.judged || n.lane !== lane) continue;
    const d = Math.abs(n.t - t);
    if (d > WINDOWS.good) continue;
    const j = judgeHit(d)!;
    n.judged = j;
    register(s, j, lane, n.t - t, t);
    if (n.end) {
      n.holding = true;
      s.holds[lane] = n;
      s.counts.holds++;
    }
    return;
  }
  // Nothing hit. If a note in this lane within the window was already declared missed, the
  // input was delivered too late for its timestamp (replay would score it differently).
  for (let i = s.cursor - 1; i >= 0; i--) {
    const n = s.notes[i]!;
    if (n.t < t - WINDOWS.good) break;
    if (n.lane === lane && n.judged === 'miss' && Math.abs(n.t - t) <= WINDOWS.good) {
      s.lateInputs++;
      return;
    }
  }
}

/** Lane released at song time `t`. Only the last finger/key on a lane releases a hold. */
export function release(s: SessionState, lane: number, t: number): void {
  s.pressed[lane] = Math.max(0, (s.pressed[lane] ?? 0) - 1);
  if (s.pressed[lane]! > 0) return;
  const h = s.holds[lane];
  if (!h) return;
  s.holds[lane] = null;
  h.holding = false;
  h.done = true;
  if (s.ended) return;
  const d = h.end - t;
  const j = judgeRelease(d);
  if (j === 'drop') h.dropped = true;
  register(s, j, lane, j === 'drop' ? 0 : d, t);
}

/** Drop every active hold as an early release (pause behaviour, TIMING.md §4). */
export function dropHolds(s: SessionState, t: number): void {
  for (let lane = 0; lane < 4; lane++) {
    const h = s.holds[lane];
    if (!h) continue;
    s.holds[lane] = null;
    h.holding = false;
    h.done = true;
    h.dropped = true;
    s.pressed[lane] = 0;
    if (!s.ended) register(s, 'drop', lane, 0, t);
  }
}

/**
 * Advance to song time `t` from the frame loop: declare misses (Good window + grace), auto-release
 * holds held past the tail, and end the run when the song is over.
 */
export function update(s: SessionState, t: number): void {
  if (t < s.time) return; // never run backwards
  s.time = t;
  if (s.ended) return;
  while (s.cursor < s.notes.length) {
    const n = s.notes[s.cursor]!;
    if (n.judged) {
      s.cursor++;
      continue;
    }
    if (t > n.t + WINDOWS.good + MISS_GRACE) {
      n.judged = 'miss';
      if (n.end) n.done = true;
      register(s, 'miss', n.lane, 0, t);
      s.cursor++;
      if (s.ended) return;
      continue;
    }
    break;
  }
  for (let lane = 0; lane < 4; lane++) {
    const h = s.holds[lane];
    if (h && t > h.end + RELEASE_WINDOWS.good) {
      s.holds[lane] = null;
      h.holding = false;
      h.done = true;
      register(s, 'rgood', lane, -RELEASE_WINDOWS.good, t);
      if (s.ended) return;
    }
  }
  if (s.options.endTime !== undefined && t > s.options.endTime) s.ended = true;
}

export interface SessionSummary {
  score: number;
  accuracy: number;
  grade: Grade;
  maxCombo: number;
  counts: SessionState['counts'];
  failed: boolean;
  fullCombo: boolean;
  allPerfect: boolean;
  lateInputs: number;
}

export function summarize(s: SessionState): SessionSummary {
  const c = s.counts;
  return {
    score: s.score,
    accuracy: accuracy(s),
    grade: grade(s),
    maxCombo: s.maxCombo,
    counts: { ...c },
    failed: s.failed,
    fullCombo: c.miss === 0 && s.accN > 0,
    allPerfect: c.miss === 0 && c.great === 0 && c.good === 0 && s.accN > 0,
    lateInputs: s.lateInputs,
  };
}
