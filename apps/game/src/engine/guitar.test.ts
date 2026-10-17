import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { GuitarReport } from './gip';
import { FRET_LANES, GuitarLanes, type LaneQuery } from './guitar';
import type { LaneEvent } from './input';

const G = 1,
  R = 2,
  Y = 4,
  B = 8,
  O = 16;
const rep = (f: Partial<GuitarReport> = {}): GuitarReport => ({
  upper: 0,
  solo: 0,
  strumUp: false,
  strumDown: false,
  whammy: 0,
  tilt: 0,
  ...f,
});
const FREE: LaneQuery = () => ({ holding: false, noteNear: false });

function collect(): { out: LaneEvent[]; sink: (e: LaneEvent) => void } {
  const out: LaneEvent[] = [];
  return { out, sink: (e) => out.push(e) };
}
const ev = (lane: number, down: boolean, perfMs: number): LaneEvent => ({
  lane,
  down,
  perfMs,
  source: 'guitar',
});

describe('fret → lane', () => {
  it('maps green red yellow blue to lanes 1–4 and orange onto lane 4', () => {
    expect(FRET_LANES).toEqual([0, 1, 2, 3, 3]);
  });
});

describe('GuitarLanes, strum mode', () => {
  it('a fret alone does nothing; the strum presses every held fret, release follows the fret', () => {
    const g = new GuitarLanes('strum');
    const { out, sink } = collect();
    g.update(rep({ upper: G | Y }), 10, sink, FREE);
    expect(out).toEqual([]);
    g.update(rep({ upper: G | Y, strumDown: true }), 20, sink, FREE);
    expect(out).toEqual([ev(0, true, 20), ev(2, true, 20)]);
    g.update(rep({ upper: G | Y }), 30, sink, FREE); // strum bar returns: nothing
    g.update(rep({ upper: Y }), 40, sink, FREE); // green lifted
    expect(out.slice(2)).toEqual([ev(0, false, 40)]);
    g.update(rep(), 50, sink, FREE);
    expect(out.slice(3)).toEqual([ev(2, false, 50)]);
  });
  it('strum up and strum down are both strums; holding the bar is one strum', () => {
    const g = new GuitarLanes('strum');
    const { out, sink } = collect();
    g.update(rep({ upper: R, strumUp: true }), 10, sink, FREE);
    g.update(rep({ upper: R, strumUp: true }), 15, sink, FREE);
    g.update(rep({ upper: R }), 20, sink, FREE);
    g.update(rep({ upper: R, strumDown: true }), 30, sink, FREE);
    expect(out).toEqual([ev(1, true, 10), ev(1, false, 30), ev(1, true, 30)]);
  });
  it('strumming with no fret held does nothing', () => {
    const g = new GuitarLanes('strum');
    const { out, sink } = collect();
    g.update(rep({ strumDown: true }), 10, sink, FREE);
    expect(out).toEqual([]);
  });
  it('solo frets and orange reach the same lanes as the upper frets', () => {
    const g = new GuitarLanes('strum');
    const { out, sink } = collect();
    g.update(rep({ solo: B, upper: O, strumDown: true }), 10, sink, FREE);
    expect(out).toEqual([ev(3, true, 10)]); // one lane, one press
    g.update(rep({ solo: B }), 20, sink, FREE); // orange off, blue solo still held: lane stays down
    expect(out).toHaveLength(1);
    g.update(rep(), 30, sink, FREE);
    expect(out[1]).toEqual(ev(3, false, 30));
  });
  it('repeated notes on one fret: each strum re-presses (release + press at the strum time)', () => {
    const g = new GuitarLanes('strum');
    const { out, sink } = collect();
    g.update(rep({ upper: G, strumDown: true }), 10, sink, FREE);
    g.update(rep({ upper: G }), 15, sink, FREE);
    g.update(rep({ upper: G, strumUp: true }), 20, sink, FREE);
    expect(out).toEqual([ev(0, true, 10), ev(0, false, 20), ev(0, true, 20)]);
  });
  it('extended sustain: a strum for another lane leaves a sustaining fret alone', () => {
    const g = new GuitarLanes('strum');
    const { out, sink } = collect();
    g.update(rep({ upper: G, strumDown: true }), 10, sink, FREE);
    const sustaining: LaneQuery = (lane) => ({ holding: lane === 0, noteNear: false });
    g.update(rep({ upper: G | R, strumUp: true }), 20, sink, sustaining);
    expect(out).toEqual([ev(0, true, 10), ev(1, true, 20)]);
    g.update(rep({ upper: R }), 30, sink, sustaining); // green lifted: its hold releases
    expect(out[2]).toEqual(ev(0, false, 30));
  });
  it('a sustaining fret with its next note due re-presses on the strum', () => {
    const g = new GuitarLanes('strum');
    const { out, sink } = collect();
    g.update(rep({ upper: G, strumDown: true }), 10, sink, FREE);
    const nextDue: LaneQuery = (lane) => ({ holding: lane === 0, noteNear: lane === 0 });
    g.update(rep({ upper: G, strumUp: true }), 20, sink, nextDue);
    expect(out).toEqual([ev(0, true, 10), ev(0, false, 20), ev(0, true, 20)]);
  });
  it('exposes held lanes for the receptor lights even before a strum', () => {
    const g = new GuitarLanes('strum');
    const { out, sink } = collect();
    g.update(rep({ upper: G, solo: O }), 10, sink, FREE);
    expect(out).toEqual([]);
    expect(g.held).toEqual([true, false, false, true]);
    g.update(rep(), 20, sink, FREE);
    expect(g.held).toEqual([false, false, false, false]);
  });
  it('reports a tap per strum edge, fret or no fret, for calibration', () => {
    const g = new GuitarLanes('strum');
    const { sink } = collect();
    expect(g.update(rep({ strumDown: true }), 10, sink, FREE)).toBe(true); // bare strum
    expect(g.update(rep({ strumDown: true }), 15, sink, FREE)).toBe(false); // still held
    expect(g.update(rep({ upper: G }), 20, sink, FREE)).toBe(false); // fret alone
    expect(g.update(rep({ upper: G, strumUp: true }), 30, sink, FREE)).toBe(true);
    const t = new GuitarLanes('tap');
    expect(t.update(rep({ strumDown: true }), 40, sink, FREE)).toBe(false);
    expect(t.update(rep({ upper: R }), 50, sink, FREE)).toBe(true);
    expect(t.update(rep({ upper: R }), 60, sink, FREE)).toBe(false);
  });
  it('reset forgets held lanes without emitting', () => {
    const g = new GuitarLanes('strum');
    const { out, sink } = collect();
    g.update(rep({ upper: G, strumDown: true }), 10, sink, FREE);
    g.reset();
    g.update(rep(), 20, sink, FREE);
    expect(out).toEqual([ev(0, true, 10)]);
  });
});

describe('GuitarLanes, tap mode', () => {
  it('frets act like keys: down on press, up on release, strum ignored', () => {
    const g = new GuitarLanes('tap');
    const { out, sink } = collect();
    g.update(rep({ upper: G }), 10, sink, FREE);
    g.update(rep({ upper: G | B, strumDown: true }), 20, sink, FREE);
    g.update(rep({ upper: B }), 30, sink, FREE);
    g.update(rep(), 40, sink, FREE);
    expect(out).toEqual([ev(0, true, 10), ev(3, true, 20), ev(0, false, 30), ev(3, false, 40)]);
  });
  it('switching mode releases anything held so the session never sees an unmatched press', () => {
    const g = new GuitarLanes('strum');
    const { out, sink } = collect();
    g.update(rep({ upper: G, strumDown: true }), 10, sink, FREE);
    g.setMode('tap', 20, sink);
    expect(out[1]).toEqual(ev(0, false, 20));
  });
});

describe('GuitarLanes invariants', () => {
  const report = fc.record({
    upper: fc.integer({ min: 0, max: 31 }),
    solo: fc.integer({ min: 0, max: 31 }),
    strumUp: fc.boolean(),
    strumDown: fc.boolean(),
    whammy: fc.constant(0),
    tilt: fc.constant(0),
  });
  const query = fc.record({ holding: fc.boolean(), noteNear: fc.boolean() });
  it('presses and releases pair up per lane, and releases follow the fret within one report', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('strum', 'tap'),
        fc.array(fc.tuple(report, query), { minLength: 1, maxLength: 60 }),
        (mode, steps) => {
          const g = new GuitarLanes(mode);
          const depth = [0, 0, 0, 0];
          let t = 0;
          for (const [r, q] of steps) {
            t += 1;
            g.update(
              r,
              t,
              (e) => {
                expect(e.perfMs).toBe(t);
                depth[e.lane]! += e.down ? 1 : -1;
                expect(depth[e.lane]).toBeGreaterThanOrEqual(0);
                expect(depth[e.lane]).toBeLessThanOrEqual(1);
              },
              () => q,
            );
            // Every lane whose frets are all up must be released by the end of the report.
            const held = r.upper | r.solo;
            for (let lane = 0; lane < 4; lane++) {
              const anyFret = FRET_LANES.some((l, fret) => l === lane && held & (1 << fret));
              if (!anyFret) expect(depth[lane]).toBe(0);
            }
          }
        },
      ),
    );
  });
});
