import { describe, expect, it } from 'vitest';
import { SCALES } from '../theory';
import { midiToDegree, noteToMidi, parseMelody, tempoFor, type CuratedSong } from './build';

const MINOR = SCALES.minor;
const B2 = 47;

describe('note tokens', () => {
  it('parses names with sharps and flats', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A#3')).toBe(58);
    expect(noteToMidi('Bb3')).toBe(58);
    expect(noteToMidi('B2')).toBe(47);
  });
  it('rejects malformed tokens', () => {
    for (const bad of ['E', 'H4', 'e4', 'E#', '4']) expect(() => noteToMidi(bad)).toThrow(bad);
  });
  it('maps a pitch to the nearest lower scale degree plus a semitone offset', () => {
    expect(midiToDegree(47, MINOR, B2)).toEqual({ deg: 0, alt: 0 }); // B
    expect(midiToDegree(50, MINOR, B2)).toEqual({ deg: 2, alt: 0 }); // D
    expect(midiToDegree(58, MINOR, B2)).toEqual({ deg: 6, alt: 1 }); // A#3: A (degree 6) + 1 semitone
    expect(midiToDegree(59, MINOR, B2)).toEqual({ deg: 7, alt: 0 }); // B3, next octave
    expect(midiToDegree(45, MINOR, B2)).toEqual({ deg: -1, alt: 0 }); // A2 below root
  });
});

describe('tempoFor', () => {
  const c: CuratedSong = { title: 'T', bpm: 123, scale: 'minor', root: B2, progs: {}, melody: {} };
  it('clamps the reference tempo into each mood range', () => {
    expect(tempoFor(c, 'lofi')).toBe(86);
    expect(tempoFor(c, 'synthwave')).toBe(118);
    expect(tempoFor(c, 'chiptune')).toBe(140);
    expect(tempoFor(c, 'techno')).toBe(124); // range 124–136 clamps the 123 reference up
  });
  it('a per-mood override wins and is not clamped', () => {
    expect(tempoFor({ ...c, tempo: { lofi: 61 } }, 'lofi')).toBe(61);
  });
});

describe('parseMelody', () => {
  it('turns 16-token bars into onsets with gap lengths and pitch lanes', () => {
    const m = parseMelody(
      ['B3 . . . D4 . . . F#4 . . . B4 . . .', '. . . . . . . . . . . . . . . .'],
      MINOR,
      B2 + 24,
    );
    expect(m.bars).toBe(2);
    expect(m.notes.map((n) => n.step)).toEqual([0, 4, 8, 12]);
    expect(m.notes.map((n) => n.deg)).toEqual([-7, -5, -3, 0]);
    expect(m.notes.map((n) => n.len)).toEqual([4, 4, 4, 12]); // last gap wraps to 32 → capped 12
    expect(m.notes.map((n) => n.lane)).toEqual([0, 1, 2, 3]);
  });
  it('a dash run sets the sounding length and chromatic notes carry alt', () => {
    const m = parseMelody(
      ['E4 - - . A#3 . . . . . . . . . . .', '. . . . . . . . . . . . . . . .'],
      MINOR,
      B2 + 24,
    );
    expect(m.notes[0]).toMatchObject({ step: 0, len: 3, alt: 0 });
    expect(m.notes[1]).toMatchObject({ step: 4, alt: 1 });
  });
  it('accepts 4 bars and rejects other lengths', () => {
    const bar = 'B3 . . . . . . . . . . . . . . .';
    expect(parseMelody([bar, bar, bar, bar], MINOR, B2).bars).toBe(4);
    expect(() => parseMelody([bar], MINOR, B2)).toThrow('2 or 4 bars');
    expect(() => parseMelody([bar, bar, bar], MINOR, B2)).toThrow('2 or 4 bars');
  });
  it('reports the bar and step of a bad token or a stray dash', () => {
    const ok = 'B3 . . . . . . . . . . . . . . .';
    expect(() => parseMelody(['B3 . . H4 . . . . . . . . . . . .', ok], MINOR, B2)).toThrow(
      'bar 0 step 3',
    );
    expect(() => parseMelody(['- . . . . . . . . . . . . . . .', ok], MINOR, B2)).toThrow(
      'bar 0 step 0',
    );
    expect(() => parseMelody(['B3 . - . . . . . . . . . . . . .', ok], MINOR, B2)).toThrow(
      'bar 0 step 2',
    );
    expect(() => parseMelody(['B3 . . . . . . . . . . . . . .', ok], MINOR, B2)).toThrow(
      '16 tokens',
    );
    expect(() => parseMelody([ok.replace('B3', '.'), ok.replace('B3', '.')], MINOR, B2)).toThrow(
      'no notes',
    );
  });
});
