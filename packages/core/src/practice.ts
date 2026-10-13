/**
 * Practice mode (PRD §3): one section of a Song-mode chart, looped, optionally slowed to 75% or
 * 50%. The music is re-synthesised at the lower tempo by the worklet (same step grid, longer
 * steps), so the chart is simply time-scaled: a note at song time `t` plays at `t / rate` real
 * seconds. Repetition `k` is shifted by `k` section lengths, so the practice clock runs
 * continuously from bar 0 of the song at the practice tempo (bar 0 is never heard; the run starts
 * at `fromBar`).
 */
import { buildChart, type ChartNote, type Difficulty } from './chart';
import type { Song } from './song';

export const PRACTICE_RATES = [1, 0.75, 0.5] as const;
export type PracticeRate = (typeof PRACTICE_RATES)[number];

export interface PracticeSection {
  fromBar: number;
  /** Exclusive. */
  toBar: number;
  rate: PracticeRate;
}

/** Section length in song seconds. */
export function sectionLength(song: Song, p: PracticeSection): number {
  return (p.toBar - p.fromBar) * song.barDur;
}

/** Real seconds at which repetition `rep` begins (its first downbeat). */
export function repStart(song: Song, p: PracticeSection, rep: number): number {
  return (p.fromBar * song.barDur + rep * sectionLength(song, p)) / p.rate;
}

/**
 * Yields the section's notes one repetition at a time, in real seconds at the practice rate. Lane
 * reservation (GENERATION.md §5) carries across the wrap, so a hold ending in the section's last
 * bar still owns its lane into the next repetition's first bar.
 */
export class PracticeBuilder {
  private readonly section: ChartNote[];
  private readonly laneFree = [-9, -9, -9, -9];
  private rep = 0;

  constructor(
    private readonly song: Song,
    difficulty: Difficulty,
    private readonly p: PracticeSection,
  ) {
    if (song.total === null) throw new Error('practice needs a Song-mode song');
    if (!(p.fromBar >= 0 && p.toBar > p.fromBar && p.toBar <= song.total))
      throw new Error('practice section out of range');
    const from = p.fromBar * song.barDur;
    const to = p.toBar * song.barDur;
    this.section = buildChart(song, difficulty, p.toBar).notes.filter(
      (n) => n.t >= from && n.t < to,
    );
  }

  /** Index of the next repetition `next()` produces. */
  get nextRep(): number {
    return this.rep;
  }

  next(): ChartNote[] {
    const s = this.song;
    const shift = this.rep++ * sectionLength(s, this.p);
    const rate = this.p.rate;
    const out: ChartNote[] = [];
    for (const n of this.section) {
      const t = (n.t + shift) / rate;
      if (t < this.laneFree[n.lane]!) continue;
      const end = n.end ? (n.end + shift) / rate : 0;
      out.push({ t, lane: n.lane, end });
      this.laneFree[n.lane] = end ? end + (s.sd * 1.5) / rate : t + (s.sd * 0.5) / rate;
    }
    return out;
  }
}
