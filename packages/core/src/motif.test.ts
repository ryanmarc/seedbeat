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
    expect(chorus.bars).toBe(8);
    expect(getMotif(s, 'verse', 0).bars).toBe(4);
    expect(getMotif(s, 'intro', 0).bars).toBe(2); // the riff, authored for intro and outro
    expect(getMotif(s, 'outro', 0)).toEqual(getMotif(s, 'intro', 0));
  });
  it('procedural motifs are unchanged: 2 bars, not authored', () => {
    const s = makeSong('amber-11', 'lofi', 'song');
    const m = getMotif(s, 'chorus', 0);
    expect(m.bars).toBe(2);
    expect(m.authored).toBe(false);
  });
  it('the hook plays at the written pitches, an octave up, without chromatic notes', () => {
    const s = makeSong('friday', 'techno', 'song');
    const start = s.sections.find((x) => x.type === 'chorus')!.start;
    const leadMidis = (bar: number): number[] =>
      getBar(s, bar)
        .ev.filter((e) => e.type === 'lead')
        .map((e) => e.midi!);
    // Bar 1 of the hook: E4 F#4 E4 D4 B3 C#4 D4
    expect(leadMidis(start)).toEqual(
      ['E4', 'F#4', 'E4', 'D4', 'B3', 'C#4', 'D4'].map((n) => noteToMidi(n) + 12),
    );
    // Bar 2 ends on B3 (played B4); no chromatic notes in the hook.
    expect(leadMidis(start + 1).at(-1)).toBe(noteToMidi('B3') + 12);
  });
  it('an entry transpose lifts every authored note into the lead register', () => {
    const s = makeSong('friday', 'techno', 'song');
    const start = s.sections.find((x) => x.type === 'chorus')!.start;
    const first = getBar(s, start).ev.find((e) => e.type === 'lead')!;
    // Written E4 (64), played one octave up so it sits where the moods' leads sit.
    expect(s.curated?.transpose).toBe(12);
    expect(first.midi).toBe(noteToMidi('E4') + 12);
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

describe('8-bar melodies', () => {
  it('an 8-bar hook plays through an 8-bar chorus and restarts at the next chorus', () => {
    const s = makeSong('friday', 'techno', 'song');
    expect(getMotif(s, 'chorus', 0).bars).toBe(8);
    const starts = s.sections.filter((x) => x.type === 'chorus').map((x) => x.start);
    const bar = (b: number): string[] =>
      getBar(s, b)
        .ev.filter((e) => e.type === 'lead')
        .map((e) => `${e.step}:${e.midi}`);
    expect(bar(starts[0]! + 4)).not.toEqual(bar(starts[0]!)); // second half differs
    expect(bar(starts[1]!)).toEqual(bar(starts[0]!)); // next chorus restarts the hook
    expect(getMotif(s, 'intro', 0).bars).toBe(2); // the riff
    expect(getMotif(s, 'outro', 0)).toEqual(getMotif(s, 'intro', 0));
  });
});
