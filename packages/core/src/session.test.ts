import { describe, expect, it } from 'vitest';
import type { ChartNote } from './chart';
import {
  RELEASE_WINDOWS,
  WINDOWS,
  gradeFor,
  judgeHit,
  judgeRelease,
  multiplier,
} from './judgement';
import { createSession, dropHolds, press, release, summarize, update } from './session';

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
    // Releases use the wider RELEASE_WINDOWS (Perfect 90 ms, Great 180 ms, Good 200 ms).
    expect(judgeRelease(0.201)).toBe('drop');
    expect(judgeRelease(0.2)).toBe('rgood');
    expect(judgeRelease(0.135)).toBe('rgreat');
    expect(judgeRelease(-0.3)).toBe('rgood'); // late releases cap at Good via auto-release
    expect(judgeRelease(-0.09)).toBe('rperfect');
    expect(judgeRelease(0.0901)).toBe('rgreat');
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

  it('holds: head then release graded by the tail; early release drops', () => {
    const s = createSession([hold(1, 2, 2), hold(3, 1, 4)], { difficulty: 1 });
    update(s, 1);
    press(s, 2, 1.0);
    expect(s.holds[2]).not.toBeNull();
    update(s, 1.5);
    release(s, 2, 2.02);
    expect(s.events.map((e) => e.judgement)).toEqual(['perfect', 'rperfect']);
    expect(s.counts.holds).toBe(1);
    update(s, 3);
    press(s, 1, 3.0);
    release(s, 1, 3.5); // 0.5 s early → drop
    expect(s.events.at(-1)?.judgement).toBe('drop');
    expect(s.notes[1]!.dropped).toBe(true);
    expect(s.combo).toBe(0);
    expect(s.health).toBeCloseTo(100 - 6, 9); // health clamps at 100 before the drop
  });

  it('holding past the tail auto-releases as a late Good', () => {
    const s = createSession([hold(1, 0, 2)], { difficulty: 1 });
    update(s, 1);
    press(s, 0, 1);
    update(s, 2 + WINDOWS.good + 0.001); // past the head Good window: still held
    expect(s.events.map((e) => e.judgement)).toEqual(['perfect']);
    update(s, 2 + RELEASE_WINDOWS.good + 0.001);
    expect(s.events.map((e) => e.judgement)).toEqual(['perfect', 'rgood']);
    expect(s.holds[0]).toBeNull();
    release(s, 0, 2.5); // nothing left to release
    expect(s.events).toHaveLength(2);
  });

  it('two fingers on one lane: the hold releases only when the last one lifts', () => {
    const s = createSession([hold(1, 0, 2)], { difficulty: 1 });
    update(s, 1);
    press(s, 0, 1);
    press(s, 0, 1.2);
    release(s, 0, 1.3);
    expect(s.holds[0]).not.toBeNull();
    release(s, 0, 2.0);
    expect(s.events.at(-1)?.judgement).toBe('rperfect');
  });

  it('pause drops active holds', () => {
    const s = createSession([hold(1, 3, 2)], { difficulty: 1 });
    update(s, 1);
    press(s, 3, 1);
    dropHolds(s, 1.4);
    expect(s.events.at(-1)?.judgement).toBe('drop');
    expect(s.pressed[3]).toBe(0);
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
