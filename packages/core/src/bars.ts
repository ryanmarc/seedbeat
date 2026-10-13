import { DRUMS, SECT, patternHit, type DrumMode } from './moods';
import { getMotif } from './motif';
import { rngFor } from './rng';
import { degToMidi, snap } from './theory';
import { sectionFor, type SectionInfo, type Song } from './song';

export type EventType =
  | 'kick'
  | 'snare'
  | 'clap'
  | 'hat'
  | 'rim'
  | 'crash'
  | 'riser'
  | 'bass'
  | 'drone'
  | 'lead'
  | 'keys'
  | 'pad'
  | 'arp'
  | 'stab';

/**
 * One musical event in a bar. Which optional fields are present depends on the type, matching the
 * prototype's objects exactly (the golden fixtures compare every key).
 */
export interface BarEvent {
  type: EventType;
  /** 16th step within the bar. */
  step: number;
  midi?: number;
  midis?: number[];
  /** Length in steps. */
  len?: number;
  vel?: number;
  open?: boolean;
  /** Lead accent, 0–1. */
  acc?: number;
}

/** A lead note of a bar: the melody the chart is written from. */
export interface LeadNote {
  step: number;
  deg: number;
  len: number;
  lane: number;
}

export interface Bar {
  bar: number;
  sec: SectionInfo;
  lead: LeadNote[];
  /** Events in generation order. */
  ev: BarEvent[];
  /** Events bucketed by whole step, for the sequencer. */
  byStep: BarEvent[][];
}

/**
 * All events for a bar. Pure in (song, bar); memoised on the song. Generating bars in any order
 * gives the same result because every random draw is keyed by the bar.
 */
export function getBar(s: Song, bar: number): Bar {
  const cached = s.bars.get(bar);
  if (cached) return cached;

  const sec = sectionFor(s, bar);
  const m = s.m;
  const mk = s.mood;
  const r = rngFor(s.seed, mk, 'bar', bar);
  const prog = s.progs[sec.type];
  const cd = prog[sec.barIn % prog.length]!;
  const root = s.root + sec.transpose;
  const D = (deg: number): number => degToMidi(s.scale, root, deg);
  const ev: BarEvent[] = [];
  const add = (step: number, o: Omit<BarEvent, 'step'>): void => {
    // Spread first so `step` is the last key, as in the prototype (`o.step = step`).
    ev.push({ ...o, step } as BarEvent);
  };
  const last = sec.barIn === sec.len - 1;
  const first = sec.barIn === 0;
  const isEnd = s.total !== null && bar === s.total - 1;
  const mode: DrumMode = SECT[sec.type].drums;

  // ---- lead
  const mot = getMotif(s, sec.type, sec.cycle);
  const half = (sec.barIn % 2) * 16;
  const chordTones = (m.sevenths ? [0, 2, 4, 6] : [0, 2, 4]).map((x) => cd + x);
  let lead: LeadNote[] = [];
  for (const n of mot.notes) {
    if (n.step < half || n.step >= half + 16) continue;
    let deg = n.deg;
    if (n.step % 4 === 0) deg = snap(deg, chordTones);
    lead.push({ step: n.step - half, deg, len: n.len, lane: n.lane });
  }
  if (isEnd) lead = [{ step: 0, deg: 7, len: 14, lane: 1 }];
  for (const n of lead) add(n.step, { type: 'lead', midi: D(n.deg) + 24, len: n.len, acc: r.f() });

  // ---- drums
  const dk = DRUMS[mk];
  const kp = dk.kick[sec.type === 'chorus' ? s.pat.kick2 : s.pat.kick]!;
  const sp = dk.snare[s.pat.snare]!;
  const hp = dk.hat[sec.type === 'chorus' ? (s.pat.hat + 1) % dk.hat.length : s.pat.hat]!;
  if (!isEnd) {
    for (let i = 0; i < 16; i++) {
      const k = patternHit(kp, i);
      const sn = patternHit(sp, i);
      const h = patternHit(hp, i);
      if (k && mode !== 'break' && (mode !== 'light' || i === 0 || mk === 'techno'))
        add(i, { type: 'kick', vel: k });
      if (sn && mode !== 'light' && !(mode === 'break' && i < 8))
        add(i, { type: mk === 'techno' ? 'clap' : 'snare', vel: sn });
      if (h && (mode !== 'break' || i % 4 === 2 || mk === 'lofi'))
        add(i, {
          type: 'hat',
          vel: h * (mk === 'lofi' ? 0.6 + 0.4 * r.f() : 1),
          open: mk === 'techno' && i % 4 === 2,
        });
      if (mk === 'techno' && (mode === 'full' || mode === 'big'))
        add(i, {
          type: 'hat',
          vel: patternHit(dk.ch![mode === 'big' ? 1 : 0]!, i) * 0.5,
          open: false,
        });
      if (mk === 'techno' && mode === 'big' && patternHit(dk.rim![bar % 2]!, i))
        add(i, { type: 'rim', vel: 0.8 });
      if (mk === 'synthwave' && mode === 'big' && i % 2 === 1)
        add(i, { type: 'hat', vel: 0.35, open: false });
    }
  }
  // Fills on the last bar of a section.
  if (last && !isEnd && mode !== 'light') {
    if (mk === 'synthwave' || mk === 'chiptune') {
      for (let i = 12; i < 16; i++) add(i, { type: 'snare', vel: 0.5 + (i - 12) * 0.15 });
    } else if (mk === 'lofi') {
      add(14, { type: 'snare', vel: 0.35 });
      add(15, { type: 'snare', vel: 0.45 });
    } else {
      for (let j = ev.length - 1; j >= 0; j--) {
        const e = ev[j]!;
        if (e.type === 'kick' && e.step >= 12) ev.splice(j, 1);
      }
      add(0, { type: 'riser', len: 16 });
    }
  }
  if (first && bar > 0 && sec.type !== 'intro' && mk !== 'lofi') add(0, { type: 'crash', vel: 1 });
  if (isEnd && mk !== 'lofi') add(0, { type: 'crash', vel: 0.8 });

  // ---- bass
  const bm = D(cd) - 12;
  const b5 = D(cd + 4) - 12;
  if (sec.type !== 'intro' || mk === 'techno') {
    if (isEnd) {
      add(0, { type: 'bass', midi: D(0) - 12, len: 12 });
    } else if (mk === 'lofi') {
      add(0, { type: 'bass', midi: bm, len: 6 });
      const at = r.pick([6, 10]);
      add(at, { type: 'bass', midi: r.chance(0.5) ? b5 : bm, len: 4 });
      if (r.chance(0.4)) add(14, { type: 'bass', midi: bm + 12, len: 2 });
    } else if (mk === 'synthwave') {
      if (mode === 'break') {
        add(0, { type: 'bass', midi: bm, len: 6 });
        add(8, { type: 'bass', midi: bm, len: 6 });
      } else {
        for (let i = 0; i < 16; i += 2)
          add(i, { type: 'bass', midi: i % 4 === 2 ? bm + 12 : bm, len: 1.6 });
      }
    } else if (mk === 'chiptune') {
      const seq = [bm, bm + 12, b5, bm + 12];
      for (let i = 0; i < 16; i += 2) add(i, { type: 'bass', midi: seq[(i / 2) % 4]!, len: 1.2 });
    } else {
      if (mode === 'break' || (mode === 'light' && sec.type === 'intro' && sec.barIn < 2)) {
        add(0, { type: 'drone', midi: bm, len: 16 });
      } else {
        for (const i of [2, 6, 10, 14]) add(i, { type: 'bass', midi: bm, len: 1.4 });
        if (mode === 'big')
          for (const i of [3, 7, 11, 15]) add(i, { type: 'bass', midi: bm, len: 0.9, vel: 0.6 });
      }
    }
  }

  // ---- harmony
  const tones = (m.sevenths ? [0, 2, 4, 6] : [0, 2, 4]).map((x) => D(cd + x) + 12);
  if (isEnd) {
    add(0, {
      type: mk === 'lofi' ? 'keys' : mk === 'chiptune' ? 'arp' : 'pad',
      midis: tones,
      midi: tones[0]!,
      len: 14,
    });
  } else if (mk === 'lofi') {
    add(0, { type: 'keys', midis: tones, len: 15 });
    if (r.chance(0.35)) add(10, { type: 'keys', midis: tones, len: 6, vel: 0.6 });
  } else if (mk === 'synthwave') {
    add(0, { type: 'pad', midis: tones, len: 16 });
  } else if (mk === 'chiptune') {
    const stepN = mode === 'break' || mode === 'light' ? 2 : 1;
    for (let i = 0; i < 16; i += stepN)
      add(i, { type: 'arp', midi: tones[(i / stepN) % tones.length]! + 12, len: 0.85 });
  } else {
    if (sec.type !== 'intro')
      for (const i of s.stab) add(i, { type: 'stab', midis: tones, len: 1 });
  }

  const byStep: BarEvent[][] = Array.from({ length: 16 }, () => []);
  for (const e of ev) byStep[Math.floor(e.step)]!.push(e);
  const b: Bar = { bar, sec, lead, ev, byStep };
  s.bars.set(bar, b);
  return b;
}
