import { describe, expect, it } from 'vitest';
import { makeSong, sectionFor, stepTime } from './song';

describe('song', () => {
  it('reproduces a known golden song skeleton', () => {
    // From tools/golden/fixtures/v1/lofi-song-amber-11.json
    const s = makeSong('amber-11', 'lofi', 'song');
    expect(s.bpm).toBe(71);
    expect(s.scaleName).toBe('dorian');
    expect(s.root).toBe(55);
    expect(s.name).toBe('Paper Sunday');
    expect(s.total).toBe(32);
    expect(s.sections.map((x) => `${x.type}:${x.len}@${x.start}`)).toEqual([
      'intro:4@0',
      'verse:8@4',
      'chorus:8@12',
      'bridge:8@20',
      'outro:4@28',
    ]);
  });

  it('endless sections cycle every 48 bars with a transpose per cycle', () => {
    const s = makeSong('signal-90', 'techno', 'endless');
    expect(s.total).toBeNull();
    expect(sectionFor(s, 0)).toEqual({ type: 'intro', len: 4, barIn: 0, cycle: 0, transpose: 0 });
    expect(sectionFor(s, 4)).toEqual({ type: 'verse', len: 8, barIn: 0, cycle: 0, transpose: 0 });
    expect(sectionFor(s, 4 + 48)).toEqual({
      type: 'verse',
      len: 8,
      barIn: 0,
      cycle: 1,
      transpose: 2,
    });
    expect(sectionFor(s, 4 + 48 * 6 + 36)).toEqual({
      type: 'bridge',
      len: 8,
      barIn: 4,
      cycle: 6,
      transpose: 0,
    });
  });

  it('swing delays odd whole 16ths only', () => {
    const s = makeSong('amber-11', 'lofi', 'song');
    expect(s.swing).toBe(0.17);
    expect(stepTime(s, 0, 0)).toBe(0);
    expect(stepTime(s, 0, 1)).toBeCloseTo(s.sd * 1.17, 12);
    expect(stepTime(s, 0, 2)).toBeCloseTo(s.sd * 2, 12);
    expect(stepTime(s, 1, 0)).toBeCloseTo(s.barDur, 12);
    expect(stepTime(s, 0, 1.5)).toBeCloseTo(s.sd * 1.5, 12);
  });
});
