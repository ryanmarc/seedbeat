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

describe('curated songs', () => {
  it('friday overlays tempo, key, progressions and title, in any letter case', () => {
    const a = makeSong('friday', 'techno', 'song');
    const b = makeSong('FRIDAY', 'techno', 'song');
    expect(a.curated?.title).toBe('Friday');
    expect(a.seed).toBe('friday');
    expect(b.seed).toBe('friday');
    expect(a.bpm).toBe(124); // 123 reference clamped into techno's 124–136
    expect(a.scaleName).toBe('minor');
    expect(a.root).toBe(47);
    expect(a.name).toBe('Friday');
    expect(a.progs.chorus).toEqual([0, 5, 0, 5]); // first-half degrees of the 2-bar pair loop
    expect(a.progs.intro).toEqual(a.progs.verse);
    expect(a.progs.outro).toEqual([0, 5, 0, 0]); // authored outro, tonic on its last bar
    expect(a.sd).toBeCloseTo(60 / 124 / 4, 12);
    expect(a.pat).toEqual(b.pat); // procedural picks keyed by the canonical seed
    expect(a.sections).toEqual(b.sections);
  });
  it('clamps the tempo into each mood range', () => {
    expect(makeSong('friday', 'lofi', 'song').bpm).toBe(86);
    expect(makeSong('friday', 'synthwave', 'song').bpm).toBe(118);
    expect(makeSong('friday', 'chiptune', 'song').bpm).toBe(140);
  });
  it('non-curated seeds are untouched', () => {
    const s = makeSong('amber-11', 'lofi', 'song');
    expect(s.curated).toBeNull();
    expect(s.bpm).toBe(71);
    expect(s.name).toBe('Paper Sunday');
  });
});

describe('curated arrangement', () => {
  it('a curated section list replaces the walk and ignores the 105 s target', () => {
    const s = makeSong('friday', 'techno', 'song');
    expect(s.sections.map((x) => `${x.type}:${x.len}@${x.start}`)).toEqual([
      'intro:4@0',
      'chorus:8@4',
      'verse:4@12',
      'bridge:2@16',
      'chorus:8@18',
      'chorus:8@26',
      'verse:4@34',
      'bridge:4@38',
      'bridge:8@42',
      'chorus:8@50',
      'chorus:8@58',
      'verse:4@66',
      'outro:4@70',
    ]);
    expect(s.total).toBe(74);
    expect(makeSong('friday', 'techno', 'endless').total).toBeNull();
  });
});
