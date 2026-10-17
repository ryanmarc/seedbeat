import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ChartNote } from './chart';
import { MISS_GRACE, SUSTAIN_SCORE, WINDOWS, gradeFor, judgeHit, multiplier } from './judgement';
import { createSession, dropHolds, noteNear, press, release, summarize, update } from './session';

const tap = (t: number, lane: number): ChartNote => ({ t, lane, end: 0 });
const hold = (t: number, lane: number, end: number): ChartNote => ({ t, lane, end });

describe('judgement tables', () => {
  it('windows and grades match the prototype', () => {
    expect(judgeHit(0.045)).toBe('perfect');
    expect(judgeHit(0.0451)).toBe('great');
    expect(judgeHit(0.09)).toBe('great');
    expect(judgeHit(0.1)).toBe('good');
    expect(judgeHit(0.135)).toBe('good');
    expect(judgeHit(0.1351)).toBeNull();
    expect(multiplier(0)).toBe(1);
    expect(multiplier(50)).toBe(1.5);
    expect(multiplier(250)).toBe(2);
    expect(gradeFor(0.95, false)).toBe('S');
    expect(gradeFor(0.949, false)).toBe('A');
    expect(gradeFor(0.6, false)).toBe('D');
    expect(gradeFor(1, true)).toBe('F');
  });
});

describe('session', () => {
  it('scores taps with combo multiplier and tracks accuracy', () => {
    const s = createSession([tap(1, 0), tap(2, 1), tap(3, 2)], { difficulty: 1 });
    update(s, 1);
    press(s, 0, 1.0); // perfect
    release(s, 0, 1.05);
    update(s, 2);
    press(s, 1, 2.06); // great (60 ms)
    release(s, 1, 2.1);
    update(s, 3);
    press(s, 2, 2.9); // good (100 ms early)
    release(s, 2, 2.95);
    expect(s.events.map((e) => e.judgement)).toEqual(['perfect', 'great', 'good']);
    expect(s.score).toBe(Math.round(300 * 1.01) + Math.round(200 * 1.02) + Math.round(100 * 1.03));
    expect(s.combo).toBe(3);
    expect(summarize(s).accuracy).toBeCloseTo((1 + 0.7 + 0.35) / 3, 9);
    expect(s.health).toBeCloseTo(100, 9); // clamped
  });

  it('misses after the Good window plus grace, breaking combo and costing health', () => {
    const s = createSession([tap(1, 0)], { difficulty: 1 });
    update(s, 1 + WINDOWS.good + 0.03);
    expect(s.events).toEqual([]);
    update(s, 1 + WINDOWS.good + 0.031);
    expect(s.events[0]?.judgement).toBe('miss');
    expect(s.health).toBe(91);
    expect(s.combo).toBe(0);
  });

  it('Easy scales miss penalties by 0.65', () => {
    const s = createSession([tap(1, 0)], { difficulty: 0 });
    update(s, 2);
    expect(s.health).toBeCloseTo(100 - 9 * 0.65, 9);
  });

  it('a press far from any note does nothing, and ignores other lanes', () => {
    const s = createSession([tap(1, 0)], { difficulty: 1 });
    press(s, 0, 0.5);
    press(s, 1, 1.0);
    expect(s.events).toEqual([]);
    expect(s.notes[0]!.judged).toBeNull();
  });

  it('a late-delivered input that targets an already-missed note is counted', () => {
    const s = createSession([tap(1, 0)], { difficulty: 1 });
    update(s, 1.3); // missed
    press(s, 0, 1.01); // timestamp was fine, delivery was not
    expect(s.lateInputs).toBe(1);
  });

  it('holds: the head is judged; the sustain pays for the fraction held, with no release judgement', () => {
    const s = createSession([hold(1, 2, 2), hold(3, 1, 4)], { difficulty: 1 });
    update(s, 1);
    press(s, 2, 1.0);
    expect(s.holds[2]).not.toBeNull();
    const afterHead = s.score;
    update(s, 1.5);
    release(s, 2, 1.6); // 60 % of the way through
    expect(s.events.map((e) => e.judgement)).toEqual(['perfect']); // no second event
    expect(s.score - afterHead).toBe(Math.round(SUSTAIN_SCORE * 0.6 * multiplier(1)));
    expect(s.notes[0]!.done).toBe(true);
    expect(s.notes[0]!.heldTo).toBe(1.6);
    expect(s.combo).toBe(1); // letting go early is not a break
    expect(s.counts.miss).toBe(0);
    expect(s.health).toBe(100);
    expect(s.counts.holds).toBe(1);
    update(s, 3);
    press(s, 1, 3.0);
    const before = s.score;
    release(s, 1, 3.0); // instant release: nothing earned, nothing lost
    expect(s.score).toBe(before);
    expect(s.combo).toBe(2);
  });

  it('a sustain held to the tail completes there with full points; the later lift pays nothing', () => {
    const s = createSession([hold(1, 0, 2)], { difficulty: 1 });
    update(s, 1);
    press(s, 0, 1);
    const afterHead = s.score;
    update(s, 1.9);
    expect(s.holds[0]).not.toBeNull();
    expect(s.score).toBe(afterHead);
    update(s, 2 + MISS_GRACE); // tail passed the line (plus the late-input grace) while still held
    expect(s.holds[0]).toBeNull();
    expect(s.notes[0]!.heldTo).toBe(2);
    expect(s.score - afterHead).toBe(Math.round(SUSTAIN_SCORE * multiplier(1)));
    release(s, 0, 2.5);
    expect(s.score - afterHead).toBe(Math.round(SUSTAIN_SCORE * multiplier(1)));
    expect(s.events).toHaveLength(1);
  });

  it('a release timestamped after the tail still pays the full sustain', () => {
    const s = createSession([hold(1, 0, 2)], { difficulty: 1 });
    update(s, 1);
    press(s, 0, 1);
    release(s, 0, 2.3); // input arrives before the frame that would complete it
    expect(s.notes[0]!.heldTo).toBe(2);
    expect(s.score).toBe(
      Math.round(300 * multiplier(1)) + Math.round(SUSTAIN_SCORE * multiplier(1)),
    );
  });

  it('two fingers on one lane: the sustain ends only when the last one lifts', () => {
    const s = createSession([hold(1, 0, 2)], { difficulty: 1 });
    update(s, 1);
    press(s, 0, 1);
    press(s, 0, 1.2);
    release(s, 0, 1.3);
    expect(s.holds[0]).not.toBeNull();
    release(s, 0, 1.5);
    expect(s.holds[0]).toBeNull();
    expect(s.notes[0]!.heldTo).toBe(1.5);
  });

  it('pause ends active sustains at the pause time with partial points and no break', () => {
    const s = createSession([hold(1, 3, 2)], { difficulty: 1 });
    update(s, 1);
    press(s, 3, 1);
    const afterHead = s.score;
    dropHolds(s, 1.4);
    expect(s.holds[3]).toBeNull();
    expect(s.pressed[3]).toBe(0);
    expect(s.combo).toBe(1);
    expect(s.score - afterHead).toBe(Math.round(SUSTAIN_SCORE * 0.4 * multiplier(1)));
  });

  it('the sustain pays at the multiplier its head earned, whatever the combo does meanwhile', () => {
    const s = createSession([hold(1, 0, 3), tap(1.5, 1), tap(2, 2)], { difficulty: 1 });
    update(s, 1);
    press(s, 0, 1); // combo 1 → multiplier 1.01
    press(s, 1, 1.5);
    press(s, 2, 2); // combo 3 → multiplier 1.03
    const before = s.score;
    update(s, 3 + MISS_GRACE);
    expect(s.score - before).toBe(Math.round(SUSTAIN_SCORE * multiplier(1)));
  });

  it('sustain points are bounded by the full value and never decrease with a later release', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.2, max: 3, noNaN: true }),
        fc.double({ min: -0.5, max: 4, noNaN: true }),
        fc.double({ min: -0.5, max: 4, noNaN: true }),
        (len, ra, rb) => {
          const run = (rel: number): number => {
            const s = createSession([hold(1, 0, 1 + len)], { difficulty: 1 });
            update(s, 1);
            press(s, 0, 1);
            const afterHead = s.score;
            release(s, 0, 1 + rel);
            return s.score - afterHead;
          };
          const [lo, hi] = ra <= rb ? [ra, rb] : [rb, ra];
          const a = run(lo);
          const b = run(hi);
          expect(a).toBeGreaterThanOrEqual(0);
          expect(b).toBeLessThanOrEqual(Math.round(SUSTAIN_SCORE * multiplier(1)));
          expect(b).toBeGreaterThanOrEqual(a);
        },
      ),
    );
  });

  it('fails at zero health unless no-fail is on', () => {
    const notes = Array.from({ length: 15 }, (_, i) => tap(1 + i, i % 4));
    const a = createSession(notes, { difficulty: 1 });
    update(a, 100);
    expect(a.failed).toBe(true);
    expect(a.ended).toBe(true);
    expect(a.events.length).toBeLessThan(15); // stops judging once failed
    const b = createSession(notes, { difficulty: 1, noFail: true });
    update(b, 100);
    expect(b.failed).toBe(false);
    expect(b.health).toBe(0);
    expect(b.events).toHaveLength(15);
    expect(summarize(b).grade).toBe('D');
  });

  it('ends after endTime in Song mode', () => {
    const s = createSession([tap(1, 0)], { difficulty: 1, endTime: 5 });
    update(s, 4.9);
    expect(s.ended).toBe(false);
    update(s, 5.1);
    expect(s.ended).toBe(true);
    expect(summarize(s).grade).toBe('D');
  });

  it('never runs backwards', () => {
    const s = createSession([tap(1, 0)], { difficulty: 1 });
    update(s, 2);
    update(s, 0.5);
    expect(s.time).toBe(2);
  });
});

describe('noteNear', () => {
  it('reports an unjudged note in the lane within the Good window, and nothing else', () => {
    const s = createSession([tap(1, 0), hold(2, 1, 3), tap(5, 0)], { difficulty: 1 });
    update(s, 0.5);
    expect(noteNear(s, 0, 1)).toBe(true);
    expect(noteNear(s, 0, 1 - WINDOWS.good)).toBe(true);
    expect(noteNear(s, 0, 1 + WINDOWS.good)).toBe(true);
    expect(noteNear(s, 0, 1 + WINDOWS.good + 0.001)).toBe(false);
    expect(noteNear(s, 1, 1)).toBe(false); // other lane
    expect(noteNear(s, 1, 2.05)).toBe(true); // hold heads count
    expect(noteNear(s, 0, 3)).toBe(false); // nothing near
  });
  it('ignores notes that are already judged', () => {
    const s = createSession([tap(1, 0), tap(1.1, 0)], { difficulty: 1 });
    update(s, 0.9);
    press(s, 0, 1);
    expect(noteNear(s, 0, 1.0)).toBe(true); // the second note is still unjudged and 100 ms away
    press(s, 0, 1.1);
    expect(noteNear(s, 0, 1.05)).toBe(false);
  });
});
