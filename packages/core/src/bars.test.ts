import { describe, expect, it } from 'vitest';
import { getBar } from './bars';
import { makeSong } from './song';
import { degToMidi } from './theory';

describe('half-bar chords', () => {
  it('a paired bar changes bass and stab roots at step 8 (techno), single bars do not', () => {
    const s = makeSong('friday', 'techno', 'song');
    const chorus = s.sections.find((x) => x.type === 'chorus')!.start;
    const bar = getBar(s, chorus); // first chorus bar: pair [0, 4] (Bm then F#)
    const D = (deg: number): number => degToMidi(s.scale, s.root, deg);
    const stabs = bar.ev.filter((e) => e.type === 'stab');
    const early = stabs.filter((e) => e.step < 8).map((e) => e.midis![0]);
    const late = stabs.filter((e) => e.step >= 8).map((e) => e.midis![0]);
    expect(early.length).toBeGreaterThan(0);
    expect(late.length).toBeGreaterThan(0);
    expect(early.every((m) => m === D(0) + 12)).toBe(true);
    expect(late.every((m) => m === D(4) + 12)).toBe(true);
  });
  it('procedural songs resolve the same chord for both halves', () => {
    const s = makeSong('amber-11', 'chiptune', 'song');
    const b = getBar(s, 12);
    const arps = b.ev.filter((e) => e.type === 'arp').map((e) => e.midi!);
    expect(new Set(arps).size).toBe(3); // one triad across the whole bar
  });
});
