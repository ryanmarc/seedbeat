/**
 * Authoring helpers for curated seeds (docs/superpowers/specs/2026-10-15-curated-seeds-design.md).
 * Pure functions: tokens → motif notes, reference tempo → per-mood tempo.
 */
import { MOODS, type MoodId, type SectionType } from '../moods';
import type { Scale, ScaleName } from '../theory';

/** One bar of a curated progression: a chord degree, or two degrees (first and second half). */
export type CuratedBarChord = number | readonly [number, number];
export type CuratedProgression = readonly CuratedBarChord[];

export interface CuratedSong {
  /** Shown as the song name. */
  title: string;
  /** Reference tempo; clamped into each mood's range unless `tempo[mood]` is set. */
  bpm: number;
  tempo?: Partial<Record<MoodId, number>>;
  scale: ScaleName;
  /** MIDI note of the key root (B2 = 47). */
  root: number;
  /**
   * Semitones added to every authored note when played, so melodies can be written at the
   * pitch they were sung and still sit in the moods' lead register (procedural leads centre
   * around two octaves above the root). Default 0.
   */
  transpose?: number;
  /** 1–4 bars of bass tokens (absolute note names, `.`, `-`), looping by bar within a section. */
  bass?: readonly string[];
  /** 16-step drum patterns (`x` hit, `o` soft, `.` rest) replacing the mood's picks in every mood. */
  drums?: { kick?: string; snare?: string; hat?: string };
  /**
   * Chord degrees per bar, looping by bar within the section. A bar is one degree or a pair
   * (first and second half). Missing types fall back: intro → verse, outro → chorus; otherwise
   * the procedural draw.
   */
  progs: Partial<Record<SectionType, CuratedProgression>>;
  /**
   * Bars of 16 tokens per 16th step: note name (`E4`, `A#3`, `Bb3`), `.` rest, `-` extend the
   * previous note. 2 or 4 bars.
   */
  melody: Partial<Record<SectionType, readonly string[]>>;
}

export interface AuthoredNote {
  step: number;
  deg: number;
  /** Semitone offset above the degree, for chromatic notes. */
  alt: number;
  len: number;
  lane: number;
}

const NAMES: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
};

export function noteToMidi(token: string): number {
  const m = /^([A-G](?:#|b)?)(-?\d)$/.exec(token);
  const pc = m ? NAMES[m[1]!] : undefined;
  if (!m || pc === undefined) throw new Error(`bad note token "${token}"`);
  return (Number(m[2]) + 1) * 12 + pc;
}

/** Nearest scale degree at or below `midi` (relative to `root`), plus the semitone remainder. */
export function midiToDegree(
  midi: number,
  scale: Scale,
  root: number,
): { deg: number; alt: number } {
  const rel = midi - root;
  const oct = Math.floor(rel / 12);
  const pc = rel - oct * 12;
  let i = 0;
  for (let k = scale.length - 1; k >= 0; k--) {
    if (scale[k]! <= pc) {
      i = k;
      break;
    }
  }
  return { deg: oct * 7 + i, alt: pc - scale[i]! };
}

export function tempoFor(c: CuratedSong, mood: MoodId): number {
  const over = c.tempo?.[mood];
  if (over !== undefined) return over;
  const [lo, hi] = MOODS[mood].bpm;
  return Math.min(hi, Math.max(lo, c.bpm));
}

/** Parses bar strings into motif notes. `root` is the pitch the lead's degree 0 sounds at. */
export function parseMelody(
  bars: readonly string[],
  scale: Scale,
  root: number,
  allowed: readonly number[] = [2, 4, 8],
): { notes: AuthoredNote[]; bars: number } {
  if (!allowed.includes(bars.length))
    throw new Error(`melody must be ${allowed.join(' or ')} bars, got ${bars.length}`);
  const onsets: { step: number; midi: number; sounding: number }[] = [];
  bars.forEach((bar, b) => {
    const tokens = bar.trim().split(/\s+/);
    if (tokens.length !== 16)
      throw new Error(`bar ${b} has ${tokens.length} tokens, need 16 tokens`);
    tokens.forEach((tok, i) => {
      const step = b * 16 + i;
      if (tok === '.') return;
      if (tok === '-') {
        const last = onsets[onsets.length - 1];
        if (!last || last.step + last.sounding !== step)
          throw new Error(`bar ${b} step ${i}: '-' must follow a note`);
        last.sounding++;
        return;
      }
      try {
        onsets.push({ step, midi: noteToMidi(tok), sounding: 1 });
      } catch (e) {
        throw new Error(`bar ${b} step ${i}: ${(e as Error).message}`, { cause: e });
      }
    });
  });
  if (onsets.length === 0) throw new Error('melody has no notes');
  const total = bars.length * 16;
  let mn = Infinity;
  let mx = -Infinity;
  for (const o of onsets) {
    mn = Math.min(mn, o.midi);
    mx = Math.max(mx, o.midi);
  }
  const notes: AuthoredNote[] = onsets.map((o, i) => {
    const next = i + 1 < onsets.length ? onsets[i + 1]!.step : total + onsets[0]!.step;
    const gap = Math.min(next - o.step, 12);
    const { deg, alt } = midiToDegree(o.midi, scale, root);
    const len = o.sounding > 1 ? Math.min(o.sounding, 12) : gap;
    const lane = mx === mn ? i % 4 : Math.round(((o.midi - mn) / (mx - mn)) * 3);
    return { step: o.step, deg, alt, len, lane };
  });
  return { notes, bars: bars.length };
}
