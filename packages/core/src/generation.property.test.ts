import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ChartBuilder, buildChart, chartBar, levelAt, type Difficulty } from './chart';
import { getBar, type Bar } from './bars';
import { MOOD_IDS, type MoodId } from './moods';
import { makeSong, type Mode } from './song';

/**
 * GENERATION.md §6 invariants, checked over random seeds × moods × modes × difficulties.
 * Song mode charts cover the whole song; Endless covers the first ENDLESS_BARS bars.
 */
const ENDLESS_BARS = 64;
const RUNS = Number(process.env['PROPERTY_RUNS'] ?? 300);
const TIMEOUT = 120_000;

const arbSeed = fc.oneof(
  fc.string({ minLength: 1, maxLength: 12 }),
  fc
    .tuple(fc.constantFrom('amber', 'cobalt', 'orbit', 'signal', 'echo', 'prism'), fc.nat(99))
    .map(([w, n]) => `${w}-${n}`),
  fc.constantFrom('friday', 'Friday', ' FRIDAY '),
);
const arbMood = fc.constantFrom<MoodId>(...MOOD_IDS);
const arbMode = fc.constantFrom<Mode>('song', 'endless');
const arbDiff = fc.constantFrom<Difficulty>(0, 1, 2, 3);
const arbCase = fc.record({ seed: arbSeed, mood: arbMood, mode: arbMode, diff: arbDiff });

function barCount(mode: Mode, total: number | null): number {
  return mode === 'song' ? total! : ENDLESS_BARS;
}

/** Snapshot of a bar without the memo-owned arrays' identity, for deep-equal across songs. */
function plain(b: Bar): unknown {
  return JSON.parse(JSON.stringify({ sec: b.sec, lead: b.lead, ev: b.ev }));
}

describe('generator v1 invariants', () => {
  it(
    '1. determinism: independent generations are deep-equal, in any bar order',
    () => {
      fc.assert(
        fc.property(
          arbCase,
          fc.array(fc.nat(ENDLESS_BARS - 1), { minLength: 1, maxLength: 20 }),
          (c, order) => {
            const a = makeSong(c.seed, c.mood, c.mode);
            const b = makeSong(c.seed, c.mood, c.mode);
            const bars = barCount(c.mode, a.total);
            // Generate b's bars in a random order first, then compare everything.
            for (const i of order) if (i < bars) getBar(b, i);
            for (let i = bars - 1; i >= 0; i--) getBar(b, i);
            for (let i = 0; i < bars; i++) expect(plain(getBar(a, i))).toEqual(plain(getBar(b, i)));
            const ca = buildChart(a, c.diff, bars).notes;
            const cb = buildChart(b, c.diff, bars).notes;
            expect(ca).toEqual(cb);
          },
        ),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    '2. no note lies inside a hold in the same lane (head → tail + 1.5 steps)',
    () => {
      fc.assert(
        fc.property(arbCase, (c) => {
          const s = makeSong(c.seed, c.mood, c.mode);
          const notes = buildChart(s, c.diff, barCount(c.mode, s.total)).notes;
          // Notes are time-sorted, so one pass per lane with the current hold's close time suffices.
          const closes = [-Infinity, -Infinity, -Infinity, -Infinity];
          for (const n of notes) {
            expect(n.t, `note at ${n.t} lane ${n.lane} is inside a hold`).toBeGreaterThanOrEqual(
              closes[n.lane]! - 1e-9,
            );
            closes[n.lane] = n.end > 0 ? n.end + 1.5 * s.sd : -Infinity;
          }
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    '3. notes sorted by time; no two share time and lane',
    () => {
      fc.assert(
        fc.property(arbCase, (c) => {
          const s = makeSong(c.seed, c.mood, c.mode);
          const notes = buildChart(s, c.diff, barCount(c.mode, s.total)).notes;
          for (let i = 1; i < notes.length; i++) {
            const p = notes[i - 1]!;
            const n = notes[i]!;
            expect(n.t).toBeGreaterThanOrEqual(p.t);
            if (n.t === p.t) expect(n.lane).not.toBe(p.lane);
          }
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    '4. hold tail > head + 1 step',
    () => {
      fc.assert(
        fc.property(arbCase, (c) => {
          const s = makeSong(c.seed, c.mood, c.mode);
          for (const n of buildChart(s, c.diff, barCount(c.mode, s.total)).notes) {
            if (n.end > 0) expect(n.end).toBeGreaterThan(n.t + s.sd);
          }
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    '5. at most 2 simultaneous notes at every level',
    () => {
      fc.assert(
        fc.property(arbCase, (c) => {
          const s = makeSong(c.seed, c.mood, c.mode);
          const notes = buildChart(s, c.diff, barCount(c.mode, s.total)).notes;
          let run = 1;
          for (let i = 1; i < notes.length; i++) {
            run = Math.abs(notes[i]!.t - notes[i - 1]!.t) < 1e-9 ? run + 1 : 1;
            expect(run).toBeLessThanOrEqual(2);
          }
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    '6. every chart note coincides with a music event (lead, snare, clap or kick; any event for the level-0 downbeat guarantee)',
    () => {
      // GENERATION.md §6 lists lead/snare/clap/kick. Frozen v1 has one exception: at level 0 a
      // non-intro bar with no eligible lead gets a tap on step 0 (so Easy never has an empty bar),
      // and on a bridge downbeat that step carries only a crash/drone/harmony event.
      fc.assert(
        fc.property(arbCase, (c) => {
          const s = makeSong(c.seed, c.mood, c.mode);
          const bars = barCount(c.mode, s.total);
          const notes = buildChart(s, c.diff, bars).notes;
          for (const n of notes) {
            const bar = Math.floor(n.t / s.barDur + 1e-9);
            const b = getBar(s, bar);
            const stepT = (step: number): number =>
              bar * s.barDur + step * s.sd + (step % 2 === 1 ? s.swing * s.sd : 0);
            const at = b.ev.filter((e) => Math.abs(stepT(e.step) - n.t) < 1e-9);
            const strict = at.some(
              (e) =>
                e.type === 'lead' || e.type === 'snare' || e.type === 'clap' || e.type === 'kick',
            );
            const downbeatGuarantee =
              levelAt(s, c.diff, bar) < 1 && Math.abs(n.t - bar * s.barDur) < 1e-9;
            expect(
              strict || (downbeatGuarantee && at.length > 0),
              `note at ${n.t} (bar ${bar}) is off the music`,
            ).toBe(true);
          }
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    '7. Song mode duration is within 80–130 s for every mood',
    () => {
      fc.assert(
        fc.property(arbSeed, arbMood, (seed, mood) => {
          const s = makeSong(seed, mood, 'song');
          const dur = s.total! * s.barDur;
          // Curated songs author their own arrangement and ignore the length target.
          if (!s.curated) {
            expect(dur).toBeGreaterThanOrEqual(80);
            expect(dur).toBeLessThanOrEqual(130);
          }
          expect(s.sections[0]!.type).toBe('intro');
          expect(s.sections.at(-1)!.type).toBe('outro');
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    'ChartBuilder produces exactly what buildChart does, bar by bar',
    () => {
      fc.assert(
        fc.property(arbCase, (c) => {
          const s = makeSong(c.seed, c.mood, c.mode);
          const bars = barCount(c.mode, s.total);
          const whole = buildChart(s, c.diff, bars);
          const b = new ChartBuilder(s, c.diff);
          const inc: typeof whole.notes = [];
          for (let i = 0; i < bars; i++) inc.push(...b.next());
          expect(inc).toEqual(whole.notes);
          expect(b.peakLevel).toBe(whole.peakLevel);
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    'chartBar is pure: calling it twice gives equal notes, and levels stay in [diff, 3]',
    () => {
      fc.assert(
        fc.property(arbCase, fc.nat(ENDLESS_BARS - 1), (c, bar) => {
          const s = makeSong(c.seed, c.mood, c.mode);
          if (s.total !== null && bar >= s.total) return;
          const lv = levelAt(s, c.diff, bar);
          expect(lv).toBeGreaterThanOrEqual(c.diff);
          expect(lv).toBeLessThanOrEqual(3);
          expect(chartBar(s, bar, lv)).toEqual(chartBar(s, bar, lv));
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );
});
