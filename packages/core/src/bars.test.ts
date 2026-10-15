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

describe('authored bass and break bars', () => {
  it('techno keeps its break-bar drone under an authored bass, so the downbeat still sounds', () => {
    const s = makeSong('friday', 'techno', 'song');
    const bridge = s.sections.find((x) => x.type === 'bridge')!.start;
    const b = getBar(s, bridge + 1);
    expect(b.ev.some((e) => e.type === 'drone' && e.step === 0)).toBe(true);
    expect(b.ev.filter((e) => e.type === 'bass').length).toBeGreaterThan(0);
  });
});

describe('half-bar chords, both halves from the entry', () => {
  /** A friday song whose curated entry is replaced (before any bar is generated). */
  const withEntry = (mood: 'lofi' | 'synthwave' | 'chiptune' | 'techno', patch: object) => {
    const s = makeSong('friday', mood, 'song');
    s.curated = { ...s.curated!, ...patch };
    return s;
  };
  it('a 3-bar progression keeps first and second halves from the same bar', () => {
    const s = withEntry('techno', {
      progs: {
        chorus: [
          [0, 4],
          [5, 2],
          [1, 3],
        ],
      },
    });
    const chorus = s.sections.find((x) => x.type === 'chorus')!.start;
    const D = (deg: number): number => degToMidi(s.scale, s.root, deg);
    const stabs = getBar(s, chorus + 4).ev.filter((e) => e.type === 'stab'); // bar 4 → p[1] = [5, 2]
    expect(stabs.filter((e) => e.step < 8).map((e) => e.midis![0])).toEqual([D(5) + 12, D(5) + 12]);
    expect(stabs.filter((e) => e.step >= 8).map((e) => e.midis![0])).toEqual([
      D(2) + 12,
      D(2) + 12,
    ]);
  });
  it('synthwave splits the pad and chiptune switches the arp triad at step 8', () => {
    const sw = makeSong('friday', 'synthwave', 'song');
    const chorus = sw.sections.find((x) => x.type === 'chorus')!.start;
    const pads = getBar(sw, chorus).ev.filter((e) => e.type === 'pad');
    expect(pads.map((e) => `${e.step}:${e.len}`)).toEqual(['0:8', '8:8']);
    expect(pads[0]!.midis).not.toEqual(pads[1]!.midis);
    const ch = makeSong('friday', 'chiptune', 'song');
    const arps = getBar(ch, ch.sections.find((x) => x.type === 'chorus')!.start)
      .ev.filter((e) => e.type === 'arp')
      .map((e) => e.midi!);
    expect(new Set(arps.slice(0, 8)).size).toBe(3);
    expect(new Set(arps.slice(8)).size).toBe(3);
    expect(new Set(arps.slice(0, 8))).not.toEqual(new Set(arps.slice(8)));
  });
  it('the procedural bass follows the second chord when an entry has no bass of its own', () => {
    const s = withEntry('synthwave', { bass: undefined });
    const chorus = s.sections.find((x) => x.type === 'chorus')!.start;
    const bass = getBar(s, chorus).ev.filter((e) => e.type === 'bass');
    const D = (deg: number): number => degToMidi(s.scale, s.root, deg);
    expect(bass.find((e) => e.step === 0)!.midi).toBe(D(0) - 12);
    expect(bass.find((e) => e.step === 8)!.midi).toBe(D(4) - 12);
  });
});

describe('friday cadence', () => {
  it('ends on the tonic triad', () => {
    const s = makeSong('friday', 'techno', 'song');
    const last = getBar(s, s.total! - 1);
    const D = (deg: number): number => degToMidi(s.scale, s.root, deg);
    const pad = last.ev.find((e) => e.type === 'pad');
    expect(pad?.midis).toEqual([D(0) + 12, D(2) + 12, D(4) + 12]);
  });
});

describe('authored drums and section fills', () => {
  it('keeps every kick at section ends and only risers into a drop', () => {
    const s = makeSong('friday', 'techno', 'song');
    const kicks = (bar: number): number[] =>
      getBar(s, bar)
        .ev.filter((e) => e.type === 'kick')
        .map((e) => e.step);
    const riser = (bar: number): boolean => getBar(s, bar).ev.some((e) => e.type === 'riser');
    // Bar 15 ends the verse before a 2-bar break: no fill, no missing kick.
    expect(kicks(15)).toEqual([0, 4, 8, 12]);
    expect(riser(15)).toBe(false);
    // Bar 17 ends the break right before a chorus: the riser builds into the drop.
    expect(riser(17)).toBe(true);
    // Bar 25 ends a chorus before another chorus: riser, kicks intact.
    expect(kicks(25)).toEqual([0, 4, 8, 12]);
    expect(riser(25)).toBe(true);
  });
  it('synthwave rolls into a drop only', () => {
    const s = makeSong('friday', 'synthwave', 'song');
    const roll = (bar: number): number =>
      getBar(s, bar).ev.filter((e) => e.type === 'snare' && e.step >= 12).length;
    expect(roll(15)).toBe(1); // only the authored clap on 12
    expect(roll(17)).toBeGreaterThan(1); // the roll into the chorus
  });
});
