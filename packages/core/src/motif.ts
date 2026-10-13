import { SECT, type SectionType } from './moods';
import { rngFor } from './rng';
import type { Song } from './song';

export interface MotifNote {
  /** 0–31 across the motif's two bars. */
  step: number;
  /** Scale degree (relative to the key root, may be negative). */
  deg: number;
  /** Gap to the next onset in steps (capped at 12), or a short staccato length. */
  len: number;
  /** Lane 0–3 from the note's pitch position within the motif's range. */
  lane: number;
}

export interface Motif {
  notes: MotifNote[];
}

const MOVES = [-2, -1, -1, 0, 1, 1, 2, 3, -3, 4] as const;

/** One 2-bar melody per (section type, endless cycle). Memoised on the song. */
export function getMotif(s: Song, type: SectionType, cycle: number): Motif {
  const key = type + cycle;
  const cached = s.motifs.get(key);
  if (cached) return cached;

  const r = rngFor(s.seed, s.mood, 'motif', type, cycle);
  const dens = SECT[type].lead;
  const g16 = s.m.g16;

  // Bar 1 rhythm from per-step weights.
  const rh: number[] = [];
  for (let i = 0; i < 16; i++) {
    const w = i === 0 ? 1.3 : i % 8 === 0 ? 1 : i % 4 === 0 ? 0.8 : i % 2 === 0 ? 0.5 : g16;
    if (r.f() < w * dens) rh.push(i);
  }
  if (rh.length < 2) {
    rh.length = 0;
    rh.push(0, 8);
  }
  // Bar 2: mutated copy (drop some, add a few).
  const second = rh.filter((i) => !(i > 0 && r.f() < 0.25)).map((i) => i + 16);
  for (let i = 1; i < 16; i++) {
    if (!rh.includes(i) && r.f() < 0.08 * dens * (i % 2 ? g16 * 3 : 1)) second.push(i + 16);
  }
  const all = [...rh, ...second].sort((a, b) => a - b);

  // Degrees: bounded random walk.
  let d = r.pick([0, 2, 4]);
  const notes: MotifNote[] = [];
  for (let i = 0; i < all.length; i++) {
    if (i > 0) {
      d += r.pick(MOVES);
      if (d < -2) d += 3;
      if (d > 9) d -= 4;
    }
    notes.push({ step: all[i]!, deg: d, len: 0, lane: 0 });
  }
  let mn = 99;
  let mx = -99;
  for (const n of notes) {
    mn = Math.min(mn, n.deg);
    mx = Math.max(mx, n.deg);
  }
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]!;
    const next = i + 1 < notes.length ? notes[i + 1]!.step : 32 + notes[0]!.step;
    const gap = next - n.step;
    n.len = gap >= 3 && r.f() < s.m.stacc ? r.int(1, 2) : Math.min(gap, 12);
    n.lane = mx === mn ? i % 4 : Math.round(((n.deg - mn) / (mx - mn)) * 3);
  }

  const motif: Motif = { notes };
  s.motifs.set(key, motif);
  return motif;
}
