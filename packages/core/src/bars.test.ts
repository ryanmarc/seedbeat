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

describe('authored drums', () => {
  it('friday kicks on every beat and claps on 2 and 4 in lo-fi, which no lo-fi kit does', () => {
    const s = makeSong('friday', 'lofi', 'song');
    const chorus = s.sections.find((x) => x.type === 'chorus')!.start;
    const b = getBar(s, chorus + 1);
    expect(b.ev.filter((e) => e.type === 'kick').map((e) => e.step)).toEqual([0, 4, 8, 12]);
    expect(b.ev.filter((e) => e.type === 'snare').map((e) => e.step)).toEqual([4, 12]);
  });
  it('a break bar still drops the kicks even with authored drums', () => {
    const s = makeSong('friday', 'synthwave', 'song');
    const bridge = s.sections.find((x) => x.type === 'bridge')!.start;
    expect(getBar(s, bridge).ev.filter((e) => e.type === 'kick')).toHaveLength(0);
  });
});

describe('authored bass', () => {
  it('friday plays the measured 2-bar figure in every mood', () => {
    for (const mood of ['lofi', 'synthwave', 'chiptune', 'techno'] as const) {
      const s = makeSong('friday', mood, 'song');
      const chorus = s.sections.find((x) => x.type === 'chorus')!.start;
      const bass = (bar: number): string[] =>
        getBar(s, bar)
          .ev.filter((e) => e.type === 'bass')
          .map((e) => `${e.step}:${e.midi}:${e.len}`);
      // B1 - · F#1 - · F#2 - · F#2 -
      expect(bass(chorus)).toEqual(['1:35:2', '7:30:2', '10:42:2', '13:42:2']);
      // G1 (lone token: sounds to the next onset) · D2 - · D2 - · D2 -
      expect(bass(chorus + 1)).toEqual(['2:31:5', '7:38:2', '10:38:2', '13:38:2']);
    }
  });
});
