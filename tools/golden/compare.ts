/**
 * Regenerates a golden fixture with @seedbeat/core and reports the first mismatch, if any.
 * Used by compare.test.ts (pnpm test:golden) and by /golden-check to explain failures.
 */
import {
  buildChart,
  getBar,
  makeSong,
  type Difficulty,
  type MoodId,
  type Mode,
} from '@seedbeat/core';
import type { Fixture } from './fixtures.ts';

export const TOLERANCE = 1e-9;
/** Endless fixtures contain charts for this many bars. */
export const ENDLESS_CHART_BARS = 96;

const DIFFS: readonly { name: 'easy' | 'normal' | 'hard'; level: Difficulty }[] = [
  { name: 'easy', level: 0 },
  { name: 'normal', level: 1 },
  { name: 'hard', level: 2 },
];

export interface Mismatch {
  where: string;
  expected: unknown;
  actual: unknown;
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCE;
}

/** Deep-compare JSON-ish values; numbers within TOLERANCE. Returns the first mismatch path. */
function diff(path: string, expected: unknown, actual: unknown): Mismatch | null {
  if (typeof expected === 'number' && typeof actual === 'number') {
    return near(expected, actual) ? null : { where: path, expected, actual };
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return { where: path, expected, actual };
    if (expected.length !== actual.length)
      return { where: `${path}.length`, expected: expected.length, actual: actual.length };
    for (let i = 0; i < expected.length; i++) {
      const d = diff(`${path}[${i}]`, expected[i], actual[i]);
      if (d) return d;
    }
    return null;
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual))
      return { where: path, expected, actual };
    const e = expected as Record<string, unknown>;
    const a = actual as Record<string, unknown>;
    const keys = new Set([...Object.keys(e), ...Object.keys(a).filter((k) => a[k] !== undefined)]);
    for (const k of keys) {
      const d = diff(`${path}.${k}`, e[k], a[k]);
      if (d) return d;
    }
    return null;
  }
  return Object.is(expected, actual) ? null : { where: path, expected, actual };
}

/** Compares one fixture against a fresh generation. Returns all mismatches found (first per area). */
export function compareFixture(fx: Fixture): Mismatch[] {
  const out: Mismatch[] = [];
  const song = makeSong(fx.meta.seed, fx.meta.mood as MoodId, fx.meta.mode as Mode);

  // ---- meta
  const meta = {
    generatorVersion: 1,
    seed: song.seed,
    mood: song.mood,
    mode: song.mode,
    bpm: song.bpm,
    scale: song.scaleName,
    rootMidi: song.root,
    swing: song.swing,
    stepSec: song.sd,
    barSec: song.barDur,
    totalBars: song.total,
    name: song.name,
    progressions: song.progs,
    patternIdx: song.pat,
    stabSteps: song.stab,
    sections: song.sections,
  };
  const md = diff('meta', fx.meta, meta);
  if (md) out.push(md);

  // ---- bars (events in generation order, every key compared)
  for (const fb of fx.bars) {
    const b = getBar(song, fb.bar);
    const d =
      diff(`bars[${fb.bar}].section`, fb.section, b.sec) ??
      diff(`bars[${fb.bar}].lead`, fb.lead, b.lead) ??
      diff(`bars[${fb.bar}].events`, fb.events, b.ev);
    if (d) {
      out.push(d);
      break;
    }
  }

  // ---- charts
  const upto = song.total ?? ENDLESS_CHART_BARS;
  for (const { name, level } of DIFFS) {
    const chart = buildChart(song, level, upto).notes.map((n) => [n.t, n.lane, n.end]);
    const d = diff(`charts.${name}`, fx.charts[name], chart);
    if (d) out.push(d);
  }
  return out;
}

export function formatMismatch(m: Mismatch): string {
  return `${m.where}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)}`;
}
