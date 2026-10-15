import { describe, expect, it } from 'vitest';
import { getBar } from './bars';
import { noteToMidi } from './curated/build';
import { getMotif } from './motif';
import { makeSong } from './song';

describe('authored motifs', () => {
  it('curated sections return the authored melody with its bar count', () => {
    const s = makeSong('friday', 'techno', 'song');
    const chorus = getMotif(s, 'chorus', 0);
    expect(chorus.authored).toBe(true);
    expect(chorus.bars).toBe(4);
    expect(getMotif(s, 'verse', 0).bars).toBe(4);
    expect(getMotif(s, 'intro', 0)).toBe(getMotif(s, 'verse', 0)); // fallback shares the memo
    expect(getMotif(s, 'outro', 0)).toBe(getMotif(s, 'chorus', 0));
  });
  it('procedural motifs are unchanged: 2 bars, not authored', () => {
    const s = makeSong('amber-11', 'lofi', 'song');
    const m = getMotif(s, 'chorus', 0);
    expect(m.bars).toBe(2);
    expect(m.authored).toBe(false);
  });
  it('a 4-bar chorus repeats twice across an 8-bar section at the written pitches', () => {
    const s = makeSong('friday', 'techno', 'song');
    const start = s.sections.find((x) => x.type === 'chorus')!.start;
    const leadMidis = (bar: number): number[] =>
      getBar(s, bar)
        .ev.filter((e) => e.type === 'lead')
        .map((e) => e.midi!);
    // Bar 1 of the hook: E4 F#4 E4 D4 B3 C#4 D4
    expect(leadMidis(start)).toEqual(
      ['F#4', 'E4', 'D4', 'C#4', 'D4'].map((n) => noteToMidi(n) + 12),
    );
    // Bar 2 ends on B3 (played B4); no chromatic notes in the hook.
    expect(leadMidis(start + 1).at(-1)).toBe(noteToMidi('B3') + 12);
    expect(leadMidis(start + 4)).toEqual(leadMidis(start));
    expect(leadMidis(start + 5)).toEqual(leadMidis(start + 1));
  });
  it('an entry transpose lifts every authored note into the lead register', () => {
    const s = makeSong('friday', 'techno', 'song');
    const start = s.sections.find((x) => x.type === 'chorus')!.start;
    const first = getBar(s, start).ev.find((e) => e.type === 'lead')!;
    // Written F#4 (66), played one octave up so it sits where the moods' leads sit.
    expect(s.curated?.transpose).toBe(12);
    expect(first.midi).toBe(noteToMidi('F#4') + 12);
  });
  it('endless cycles transpose the authored notes', () => {
    const s = makeSong('friday', 'techno', 'endless');
    const lead = (bar: number): number[] =>
      getBar(s, bar)
        .ev.filter((e) => e.type === 'lead')
        .map((e) => e.midi!);
    const a = lead(4 + 8); // chorus, cycle 0
    const b = lead(4 + 8 + 48); // chorus, cycle 1: +2 semitones
    expect(b).toEqual(a.map((m) => m + 2));
  });
});
