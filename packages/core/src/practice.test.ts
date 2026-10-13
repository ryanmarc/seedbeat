import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildChart, type Difficulty } from './chart';
import { MOOD_IDS } from './moods';
import { PRACTICE_RATES, PracticeBuilder, repStart, sectionLength } from './practice';
import { makeSong } from './song';
import { TUTORIAL_MOOD, TUTORIAL_SEED, tutorialChart } from './tutorial';

const arbMood = fc.constantFrom(...MOOD_IDS);
const arbDiff = fc.constantFrom<Difficulty>(0, 1, 2, 3);
const arbRate = fc.constantFrom(...PRACTICE_RATES);
const arbSeed = fc.string({ minLength: 1, maxLength: 12 });

describe('PracticeBuilder', () => {
  it('scales the section chart by the rate and shifts repetitions by the section length', () => {
    const song = makeSong('amber-11', 'chiptune', 'song');
    const sec = song.sections[2]!; // first chorus
    const p = { fromBar: sec.start, toBar: sec.start + sec.len, rate: 0.5 as const };
    const b = new PracticeBuilder(song, 2, p);
    const full = buildChart(song, 2).notes.filter(
      (n) => n.t >= sec.start * song.barDur && n.t < (sec.start + sec.len) * song.barDur,
    );
    const rep0 = b.next();
    expect(rep0.length).toBe(full.length);
    for (let i = 0; i < full.length; i++) {
      expect(rep0[i]!.t).toBeCloseTo(full[i]!.t / 0.5, 9);
      expect(rep0[i]!.end).toBeCloseTo(full[i]!.end ? full[i]!.end / 0.5 : 0, 9);
    }
    const rep1 = b.next();
    const L = sectionLength(song, p) / 0.5;
    expect(rep1[0]!.t - rep0[0]!.t).toBeCloseTo(L, 9);
    expect(repStart(song, p, 1)).toBeCloseTo(repStart(song, p, 0) + L, 9);
  });

  it('keeps notes sorted, holds owning their lane across the wrap, at most two at once', () => {
    fc.assert(
      fc.property(
        arbSeed,
        arbMood,
        arbDiff,
        arbRate,
        fc.nat({ max: 6 }),
        (seed, mood, d, rate, si) => {
          const song = makeSong(seed, mood, 'song');
          const sec = song.sections[si % song.sections.length]!;
          const p = { fromBar: sec.start, toBar: sec.start + sec.len, rate };
          const b = new PracticeBuilder(song, d, p);
          const all = [...b.next(), ...b.next(), ...b.next()];
          const sd = song.sd / rate;
          for (let i = 1; i < all.length; i++)
            expect(all[i]!.t).toBeGreaterThanOrEqual(all[i - 1]!.t);
          for (const h of all) {
            if (!h.end) continue;
            for (const n of all) {
              if (n === h || n.lane !== h.lane) continue;
              const inside = n.t >= h.t && n.t < h.end + sd * 1.5;
              expect(inside).toBe(false);
            }
          }
          for (const n of all) {
            const same = all.filter((m) => Math.abs(m.t - n.t) < 1e-9).length;
            expect(same).toBeLessThanOrEqual(2);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('rejects endless songs and bad ranges', () => {
    expect(
      () =>
        new PracticeBuilder(makeSong('x', 'lofi', 'endless'), 1, { fromBar: 0, toBar: 4, rate: 1 }),
    ).toThrow();
    const song = makeSong('x', 'lofi', 'song');
    expect(() => new PracticeBuilder(song, 1, { fromBar: 4, toBar: 4, rate: 1 })).toThrow();
    expect(
      () => new PracticeBuilder(song, 1, { fromBar: 0, toBar: song.total! + 1, rate: 1 }),
    ).toThrow();
  });
});

describe('tutorialChart', () => {
  const song = makeSong(TUTORIAL_SEED, TUTORIAL_MOOD, 'song');
  const t = tutorialChart(song);

  it('is deterministic and ends on a section boundary inside the song', () => {
    expect(tutorialChart(song)).toEqual(t);
    expect(t.totalBars).toBeGreaterThan(16);
    expect(t.totalBars).toBeLessThanOrEqual(song.total!);
    expect(song.sections.some((s) => s.start + s.len === t.totalBars)).toBe(true);
  });

  it('teaches taps, then chords, then holds, then the song chart', () => {
    const bar = (x: number): number => Math.floor(x / song.barDur + 1e-9);
    const taps = t.notes.filter((n) => bar(n.t) >= 1 && bar(n.t) <= 4);
    expect(taps.length).toBe(16);
    expect(taps.every((n) => !n.end)).toBe(true);
    const chords = t.notes.filter((n) => bar(n.t) >= 6 && bar(n.t) <= 9);
    expect(chords.length).toBe(16);
    for (const c of chords) expect(chords.filter((m) => m.t === c.t).length).toBe(2);
    const holds = t.notes.filter((n) => bar(n.t) >= 11 && bar(n.t) <= 14);
    expect(holds.length).toBe(6);
    expect(holds.every((n) => n.end > n.t)).toBe(true);
    expect(t.notes.some((n) => bar(n.t) >= 16)).toBe(true);
    expect(t.prompts.map((p) => p.bar)).toEqual([0, 5, 10, 15]);
  });

  it('keeps the chart invariants (sorted, hold ownership, ≤ 2 simultaneous)', () => {
    const all = t.notes;
    for (let i = 1; i < all.length; i++) expect(all[i]!.t).toBeGreaterThanOrEqual(all[i - 1]!.t);
    for (const h of all) {
      if (!h.end) continue;
      for (const n of all)
        if (n !== h && n.lane === h.lane)
          expect(n.t >= h.t && n.t < h.end + song.sd * 1.5).toBe(false);
    }
    for (const n of all)
      expect(all.filter((m) => Math.abs(m.t - n.t) < 1e-9).length).toBeLessThanOrEqual(2);
  });
});
