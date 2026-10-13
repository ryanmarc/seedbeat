import { getBar } from './bars';
import { rngFor } from './rng';
import { stepTime, type Song } from './song';

/** 0 Easy, 1 Normal, 2 Hard, 3 Expert (also the Endless ceiling). */
export type Difficulty = 0 | 1 | 2 | 3;
export const DIFFICULTY_NAMES = ['easy', 'normal', 'hard', 'expert'] as const;
export type DifficultyName = (typeof DIFFICULTY_NAMES)[number];

/** Per-level chart rules: grid in steps, min gap, hold threshold (lead len), double chance. */
export const LEVELS = {
  grid: [4, 2, 1, 1],
  gap: [4, 2, 1, 1],
  hold: [6, 4, 4, 3],
  dbl: [0, 0.05, 0.15, 0.28],
} as const;

/** Approach time base in seconds per difficulty (PRD §6). */
export const APPROACH_BASE = [1.7, 1.35, 1.05, 0.9] as const;

export interface ChartNote {
  /** Song time of the head, seconds (swing applied). */
  t: number;
  lane: number;
  /** Song time of the tail for holds, else 0. */
  end: number;
}

/** Chart level at a bar: fixed in Song mode, ramps toward 3 in Endless (GENERATION.md §5). */
export function levelAt(s: Song, difficulty: Difficulty, bar: number): number {
  return difficulty + (s.total === null ? Math.min(3 - difficulty, Math.max(0, bar - 4) / 40) : 0);
}

/** Approach time at a bar (seconds a note is visible). Shrinks in Endless. */
export function approachAt(s: Song, difficulty: Difficulty, bar: number): number {
  return (
    APPROACH_BASE[difficulty] *
    (s.total === null ? Math.max(0.62, 1 - Math.max(0, bar - 4) * 0.004) : 1)
  );
}

interface Candidate {
  step: number;
  lane: number;
  /** Hold length in steps, 0 for a tap. */
  hold: number;
}

/**
 * Chart candidates for one bar at a (possibly fractional) level. Lane reservation within the bar
 * only; `buildChart` applies the cross-bar rule.
 */
export function chartBar(s: Song, bar: number, level: number): ChartNote[] {
  const b = getBar(s, bar);
  const li = Math.min(3, Math.floor(level));
  const r = rngFor(s.seed, s.mood, 'chart', bar, li);
  const out: Candidate[] = [];
  let lastStep = -99;
  let lastLane = -1;
  for (const n of [...b.lead].sort((a, c) => a.step - c.step)) {
    if (n.step % LEVELS.grid[li]! !== 0 || n.step - lastStep < LEVELS.gap[li]!) continue;
    let lane = n.lane;
    if (lane === lastLane && n.step - lastStep <= 1) lane = (lane + 1) % 4;
    const hold = n.len >= LEVELS.hold[li]! ? Math.max(2, Math.min(n.len, 12) - 1.5) : 0;
    out.push({ step: n.step, lane, hold });
    lastStep = n.step;
    lastLane = lane;
  }
  if (li >= 2) {
    for (const e of b.ev) {
      if (
        (e.type === 'snare' || e.type === 'clap') &&
        e.vel! >= 0.9 &&
        !out.some((o) => Math.abs(o.step - e.step) <= 1)
      ) {
        out.push({ step: e.step, lane: lastLane < 2 ? 3 : 0, hold: 0 });
      }
    }
  }
  if (li === 0 && out.length === 0 && b.sec.type !== 'intro')
    out.push({ step: 0, lane: 1, hold: 0 });
  if (li > 0) {
    for (const o of [...out]) {
      if (o.step % 8 === 0 && !o.hold && r.chance(LEVELS.dbl[li]! + (level - li) * 0.1)) {
        out.push({ step: o.step, lane: (o.lane + 2) % 4, hold: 0 });
      }
    }
  }
  out.sort((a, c) => a.step - c.step || a.lane - c.lane);
  const busy = [-99, -99, -99, -99];
  const res: Candidate[] = [];
  for (const o of out) {
    if (o.step <= busy[o.lane]! + 1) continue;
    if (res.some((x) => x.step === o.step && x.lane === o.lane)) continue;
    busy[o.lane] = o.step + o.hold;
    res.push(o);
  }
  return res.map((o) => ({
    t: stepTime(s, bar, o.step),
    lane: o.lane,
    end: o.hold ? bar * s.barDur + (o.step + o.hold) * s.sd : 0,
  }));
}

export interface Chart {
  notes: ChartNote[];
  /** Highest level reached. */
  peakLevel: number;
}

/**
 * Chart for bars [0, uptoBar) with cross-bar lane reservation: a lane stays reserved until a hold's
 * tail plus 1.5 steps (or a tap plus 0.5 steps), so nothing can land inside a hold, even across a
 * bar line. In Song mode `uptoBar` defaults to the song length; Endless must pass it.
 */
export function buildChart(s: Song, difficulty: Difficulty, uptoBar?: number): Chart {
  const bars = uptoBar ?? s.total;
  if (bars === null) throw new Error('buildChart: endless songs need uptoBar');
  const notes: ChartNote[] = [];
  const laneFree = [-9, -9, -9, -9];
  let peakLevel = 0;
  for (let bar = 0; bar < bars; bar++) {
    const lv = levelAt(s, difficulty, bar);
    peakLevel = Math.max(peakLevel, lv);
    for (const n of chartBar(s, bar, lv)) {
      if (n.t < laneFree[n.lane]!) continue;
      notes.push(n);
      laneFree[n.lane] = n.end ? n.end + s.sd * 1.5 : n.t + s.sd * 0.5;
    }
  }
  return { notes, peakLevel };
}
