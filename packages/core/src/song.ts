import {
  DRUMS,
  MOODS,
  type MoodDef,
  type MoodId,
  type Progression,
  type SectionType,
} from './moods';
import { rngFor } from './rng';
import { SCALES, type Scale, type ScaleName } from './theory';
import type { Bar } from './bars';
import type { Motif } from './motif';

export const MODES = ['song', 'endless'] as const;
export type Mode = (typeof MODES)[number];

export interface SongSection {
  type: SectionType;
  len: number;
  start: number;
}

export interface SectionInfo {
  type: SectionType;
  len: number;
  /** Bar index within the section. */
  barIn: number;
  /** Endless cycle number (0 in Song mode). */
  cycle: number;
  /** Semitone transpose for this cycle (0 in Song mode). */
  transpose: number;
}

export interface Song {
  seed: string;
  mood: MoodId;
  m: MoodDef;
  mode: Mode;
  bpm: number;
  scaleName: ScaleName;
  scale: Scale;
  root: number;
  /** Sixteenth-step duration in seconds. */
  sd: number;
  /** Bar duration in seconds. */
  barDur: number;
  swing: number;
  progs: Record<SectionType, Progression>;
  pat: { kick: number; kick2: number; snare: number; hat: number };
  stab: readonly number[];
  name: string;
  /** Song mode section list; empty for endless. */
  sections: SongSection[];
  /** Total bars in Song mode; null for endless. */
  total: number | null;
  /** Memo caches. Pure functions of (seed, mood, mode), so caching cannot change output. */
  bars: Map<number, Bar>;
  motifs: Map<string, Motif>;
}

const SONG_ORDER: readonly (readonly [SectionType, number])[] = [
  ['intro', 4],
  ['verse', 8],
  ['chorus', 8],
  ['bridge', 8],
  ['chorus', 8],
  ['verse', 8],
  ['chorus', 8],
];

const CYCLE: readonly (readonly [SectionType, number])[] = [
  ['verse', 8],
  ['chorus', 8],
  ['verse', 8],
  ['chorus', 8],
  ['bridge', 8],
  ['chorus', 8],
];
const CYCLE_LEN = 48;
const TRANSPOSE = [0, 2, 5, -2, 3, -4] as const;

/** Builds the song skeleton. Draw order is frozen for generator v1. */
export function makeSong(seed: string, mood: MoodId, mode: Mode): Song {
  const m = MOODS[mood];
  const r = rngFor(seed, mood, 'song');
  const bpm = r.int(m.bpm[0], m.bpm[1]);
  const scaleName = r.pick(m.scales);
  const root = r.int(m.root[0], m.root[1]);
  const sd = 60 / bpm / 4;
  const barDur = sd * 16;
  const verse = r.pick(m.progs);
  const chorus = r.pick(m.progs);
  const bridge = r.pick(m.progs);
  const progs: Record<SectionType, Progression> = {
    verse,
    chorus,
    bridge,
    intro: verse,
    outro: chorus,
  };
  const dk = DRUMS[mood];
  const pat = {
    kick: r.int(0, dk.kick.length - 1),
    kick2: r.int(0, dk.kick.length - 1),
    snare: r.int(0, dk.snare.length - 1),
    hat: r.int(0, dk.hat.length - 1),
  };
  const stab = r.pick<readonly number[]>([
    [2, 10],
    [3, 6, 11],
    [2, 7, 10, 14],
    [6, 14],
  ]);
  const name = r.pick(m.words.a) + ' ' + r.pick(m.words.n);

  const sections: SongSection[] = [];
  let total: number | null = null;
  if (mode === 'song') {
    const target = Math.round(105 / barDur);
    let bar = 0;
    for (const [type, len] of SONG_ORDER) {
      if (bar > 0 && bar + len + 4 > target + 6) break;
      sections.push({ type, len, start: bar });
      bar += len;
    }
    sections.push({ type: 'outro', len: 4, start: bar });
    total = bar + 4;
  }

  return {
    seed,
    mood,
    m,
    mode,
    bpm,
    scaleName,
    scale: SCALES[scaleName],
    root,
    sd,
    barDur,
    swing: m.swing,
    progs,
    pat,
    stab,
    name,
    sections,
    total,
    bars: new Map(),
    motifs: new Map(),
  };
}

export function sectionFor(s: Song, bar: number): SectionInfo {
  if (s.total !== null) {
    for (let i = s.sections.length - 1; i >= 0; i--) {
      const x = s.sections[i]!;
      if (bar >= x.start)
        return { type: x.type, len: x.len, barIn: bar - x.start, cycle: 0, transpose: 0 };
    }
    return { type: 'intro', len: 4, barIn: 0, cycle: 0, transpose: 0 };
  }
  if (bar < 4) return { type: 'intro', len: 4, barIn: bar, cycle: 0, transpose: 0 };
  const b = bar - 4;
  const cycle = Math.floor(b / CYCLE_LEN);
  let off = b % CYCLE_LEN;
  for (const [type, len] of CYCLE) {
    if (off < len)
      return { type, len, barIn: off, cycle, transpose: TRANSPOSE[cycle % TRANSPOSE.length]! };
    off -= len;
  }
  /* unreachable: CYCLE sums to CYCLE_LEN */
  throw new Error('sectionFor: bad cycle table');
}

/** Song time (s) of a step in a bar, with swing on odd whole 16ths. */
export function stepTime(s: Song, bar: number, step: number): number {
  const i = Math.floor(step);
  return bar * s.barDur + step * s.sd + (i % 2 === 1 && step === i ? s.swing * s.sd : 0);
}
