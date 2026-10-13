import { mtof } from './util';
import type { KickParams, NoiseParams, ToneParams, VoiceParams } from './voice';

/** Structural subset of @seedbeat/core's BarEvent, so dsp stays independent of core. */
export interface MusicEvent {
  type: string;
  midi?: number;
  midis?: number[];
  len?: number;
  vel?: number;
  open?: boolean;
  acc?: number;
}

export type Mood = 'lofi' | 'synthwave' | 'chiptune' | 'techno';

/** A voice to start `offset` seconds after the event time. */
export interface Trigger {
  offset: number;
  params: VoiceParams;
}

const KICK: Record<Mood, { f0: number; f1: number; dur: number; vol: number }> = {
  lofi: { f0: 110, f1: 42, dur: 0.32, vol: 0.75 },
  synthwave: { f0: 160, f1: 45, dur: 0.42, vol: 1 },
  chiptune: { f0: 320, f1: 55, dur: 0.16, vol: 0.3 },
  techno: { f0: 140, f1: 40, dur: 0.55, vol: 0.8 },
};

const tone = (p: Omit<ToneParams, 'kind'>): ToneParams => ({ kind: 'tone', ...p });
const noise = (p: Omit<NoiseParams, 'kind'>): NoiseParams => ({ kind: 'noise', ...p });

/**
 * Voices for one music event, ported branch for branch from the prototype's `play()`.
 * `sd` is the 16th-step duration in seconds (already divided by the playback rate).
 */
export function eventTriggers(mood: Mood, e: MusicEvent, sd: number, out: Trigger[]): void {
  const len = (e.len ?? 1) * sd;
  const vel = e.vel ?? 1;
  const at = (offset: number, params: VoiceParams): void => {
    out.push({ offset, params });
  };
  switch (e.type) {
    case 'kick': {
      const k = KICK[mood];
      const kick: KickParams = {
        kind: 'kick',
        wave: mood === 'chiptune' ? 'square' : 'sine',
        f0: k.f0,
        f1: k.f1,
        sweep: mood === 'techno' ? 0.13 : 0.08,
        dur: k.dur,
        vol: k.vol * vel,
      };
      at(0, kick);
      if (mood === 'techno' || mood === 'synthwave')
        at(0, noise({ f: 3000, dur: 0.014, vol: 0.22 * vel }));
      break;
    }
    case 'snare':
      if (mood === 'chiptune') {
        at(0, noise({ f: 1500, dur: 0.1, vol: 0.28 * vel }));
        at(
          0,
          tone({ wave: 'square', freq: 240, dur: 0.04, vol: 0.08 * vel, s: 0, d: 0.04, r: 0.02 }),
        );
      } else {
        at(
          0,
          noise({
            type: 'bandpass',
            f: mood === 'lofi' ? 1300 : 1900,
            q: 0.8,
            dur: mood === 'lofi' ? 0.14 : 0.2,
            vol: (mood === 'lofi' ? 0.32 : 0.5) * vel,
            rev: mood === 'lofi' ? 0.15 : 0.25,
          }),
        );
        at(
          0,
          tone({ wave: 'triangle', freq: 185, dur: 0.05, vol: 0.22 * vel, s: 0, d: 0.08, r: 0.04 }),
        );
      }
      break;
    case 'clap':
      for (let k = 0; k < 3; k++) {
        at(
          k * 0.011,
          noise({
            type: 'bandpass',
            f: 1400,
            q: 1,
            dur: k < 2 ? 0.02 : 0.18,
            vol: 0.55 * vel,
            rev: k === 2 ? 0.35 : 0,
          }),
        );
      }
      break;
    case 'hat':
      if (mood === 'chiptune') at(0, noise({ f: 6000, dur: 0.025, vol: 0.09 * vel }));
      else
        at(
          0,
          noise({
            f: mood === 'lofi' ? 6500 : 7800,
            dur: e.open ? 0.26 : 0.045,
            vol: (mood === 'lofi' ? 0.07 : mood === 'techno' ? 0.15 : 0.11) * vel,
          }),
        );
      break;
    case 'rim':
      at(
        0,
        tone({
          wave: 'triangle',
          freq: 820,
          dur: 0.02,
          vol: 0.16 * vel,
          s: 0,
          d: 0.03,
          r: 0.02,
          send: 0.35,
        }),
      );
      break;
    case 'crash':
      at(0, noise({ f: 4500, dur: 1.6, vol: 0.1 * vel, rev: 0.35 }));
      break;
    case 'riser':
      at(
        0,
        noise({
          type: 'bandpass',
          f: 400,
          q: 3,
          dur: len,
          vol: 0.12,
          a: len * 0.9,
          rev: 0.3,
          sweepTo: 6000,
        }),
      );
      break;
    case 'bass': {
      const f = mtof(e.midi!);
      if (mood === 'lofi')
        at(
          0,
          tone({
            wave: 'triangle',
            freq: f,
            dur: len,
            vol: 0.34,
            a: 0.01,
            d: 0.4,
            s: 0.6,
            r: 0.12,
            cut: 700,
            wob: true,
          }),
        );
      else if (mood === 'synthwave')
        at(
          0,
          tone({
            wave: 'sawtooth',
            freq: f,
            dur: len,
            vol: 0.22,
            a: 0.003,
            d: 0.15,
            s: 0.5,
            r: 0.05,
            cut: 260,
            fenv: 1500,
            fdec: 0.12,
            q: 4,
          }),
        );
      else if (mood === 'chiptune')
        at(
          0,
          tone({ wave: 'triangle', freq: f, dur: len, vol: 0.3, a: 0.002, d: 0.05, s: 1, r: 0.02 }),
        );
      else
        at(
          0,
          tone({
            wave: 'sawtooth',
            freq: f,
            dur: len,
            vol: 0.2 * vel,
            a: 0.003,
            d: 0.08,
            s: 0.4,
            r: 0.04,
            cut: 240,
            fenv: 1100,
            fdec: 0.08,
            q: 6,
          }),
        );
      break;
    }
    case 'drone':
      at(
        0,
        tone({
          wave: 'sawtooth',
          freq: mtof(e.midi!),
          dur: len,
          det: [-6, 6],
          vol: 0.08,
          a: 1.2,
          d: 1,
          s: 1,
          r: 1,
          cut: 380,
          rev: 0.5,
        }),
      );
      break;
    case 'lead': {
      const f = mtof(e.midi!);
      if (mood === 'lofi')
        at(
          0,
          tone({
            wave: 'triangle',
            freq: f,
            dur: len,
            vol: 0.15,
            a: 0.02,
            d: 0.35,
            s: 0.5,
            r: 0.25,
            cut: 2400,
            wob: true,
            send: 0.22,
            rev: 0.3,
          }),
        );
      else if (mood === 'synthwave')
        at(
          0,
          tone({
            wave: 'sawtooth',
            freq: f,
            dur: len,
            det: [-9, 9],
            vol: 0.13,
            a: 0.01,
            d: 0.2,
            s: 0.7,
            r: 0.15,
            cut: 2600,
            fenv: 2200,
            fdec: 0.15,
            send: 0.35,
            rev: 0.2,
          }),
        );
      else if (mood === 'chiptune')
        at(
          0,
          tone({
            wave: 'pulse25',
            freq: f,
            dur: len * 0.92,
            vol: 0.1,
            a: 0.002,
            d: 0.05,
            s: 0.8,
            r: 0.02,
            send: 0.12,
          }),
        );
      else
        at(
          0,
          tone({
            wave: 'sawtooth',
            freq: f,
            dur: len,
            vol: 0.2,
            a: 0.003,
            d: 0.12,
            s: 0.45,
            r: 0.05,
            cut: 420,
            q: 12,
            fenv: 1600 + 2600 * (e.acc ?? 0),
            fdec: 0.14,
            send: 0.3,
          }),
        );
      break;
    }
    case 'keys':
      for (let mi = 0, ms = e.midis!; mi < ms.length; mi++) {
        const f = mtof(ms[mi]!);
        at(
          0,
          tone({
            wave: 'sine',
            freq: f,
            dur: len,
            vol: 0.085 * vel,
            a: 0.008,
            d: 0.9,
            s: 0.35,
            r: 0.4,
            wob: true,
            rev: 0.35,
          }),
        );
        at(
          0,
          tone({
            wave: 'sine',
            freq: f * 2,
            dur: len * 0.3,
            vol: 0.025 * vel,
            a: 0.004,
            d: 0.25,
            s: 0,
            r: 0.1,
            wob: true,
          }),
        );
      }
      break;
    case 'pad':
      for (let mi = 0, ms = e.midis!; mi < ms.length; mi++)
        at(
          0,
          tone({
            wave: 'sawtooth',
            freq: mtof(ms[mi]!),
            dur: len,
            det: [-12, 0, 12],
            vol: 0.065,
            a: 0.35,
            d: 1,
            s: 0.9,
            r: 0.5,
            cut: 1700,
            rev: 0.5,
          }),
        );
      break;
    case 'arp':
      at(
        0,
        tone({
          wave: 'pulse12',
          freq: mtof(e.midi!),
          dur: len,
          vol: 0.045,
          a: 0.001,
          d: 0.05,
          s: 0.8,
          r: 0.02,
        }),
      );
      break;
    case 'stab':
      for (let mi = 0, ms = e.midis!; mi < ms.length; mi++)
        at(
          0,
          tone({
            wave: 'sawtooth',
            freq: mtof(ms[mi]!),
            dur: len,
            det: [-8, 8],
            vol: 0.11,
            a: 0.002,
            d: 0.1,
            s: 0.25,
            r: 0.08,
            cut: 1000,
            fenv: 1800,
            fdec: 0.1,
            q: 3,
            send: 0.4,
            rev: 0.3,
          }),
        );
      break;
  }
}

/** Count-in click (the prototype used the rim voice). */
export function countInTrigger(vel: number): Trigger {
  return {
    offset: 0,
    params: tone({
      wave: 'triangle',
      freq: 820,
      dur: 0.02,
      vol: 0.16 * vel,
      s: 0,
      d: 0.03,
      r: 0.02,
    }),
  };
}

export type Judgement = 'perfect' | 'great' | 'good' | 'miss';

/** Hit sounds (AUDIO.md §1): short filtered clicks, pitched by judgement. Not in the prototype. */
export function hitSoundTriggers(j: Judgement, out: Trigger[]): void {
  if (j === 'miss') {
    out.push({
      offset: 0,
      params: tone({
        wave: 'sine',
        freq: 180,
        dur: 0.05,
        vol: 0.18,
        a: 0.002,
        d: 0.06,
        s: 0,
        r: 0.03,
      }),
    });
    return;
  }
  const freq = j === 'perfect' ? 1400 : j === 'great' ? 1000 : 700;
  out.push({ offset: 0, params: noise({ f: 5000, dur: 0.02, vol: 0.12 }) });
  out.push({
    offset: 0,
    params: tone({ wave: 'sine', freq, dur: 0.015, vol: 0.12, a: 0.001, d: 0.03, s: 0, r: 0.02 }),
  });
}

export type UiSound = 'tap' | 'confirm' | 'back' | 'unlock';

/** Menu blips (DESIGN.md §6): short, quiet, from the same DSP, on the reserved voices. */
export function uiSoundTriggers(kind: UiSound, out: Trigger[]): void {
  const blip = (freq: number, offset: number, vol = 0.07, dur = 0.03): Trigger => ({
    offset,
    params: tone({ wave: 'triangle', freq, dur, vol, a: 0.002, d: 0.05, s: 0, r: 0.03 }),
  });
  switch (kind) {
    case 'tap':
      out.push(blip(880, 0));
      break;
    case 'confirm':
      out.push(blip(660, 0), blip(990, 0.07));
      break;
    case 'back':
      out.push(blip(520, 0, 0.06));
      break;
    case 'unlock':
      out.push(blip(660, 0), blip(880, 0.08), blip(1320, 0.16, 0.08, 0.08));
      break;
  }
}

/** Master chain settings per mood (AUDIO.md §1). */
export interface MoodMix {
  toneLowpassHz: number;
  delayFeedback: number;
  delayLowpassHz: number;
  delayWet: number;
  reverbWet: number;
  /** Output trim measured by `AUDIO_CALIBRATE=1 pnpm test:audio` (bars 4–28, 5 seeds per mood). */
  trim: number;
  crackle: boolean;
  wobble: boolean;
}

export const MOOD_MIX: Record<Mood, MoodMix> = {
  lofi: {
    toneLowpassHz: 4800,
    delayFeedback: 0.32,
    delayLowpassHz: 1800,
    delayWet: 0.45,
    reverbWet: 0.38,
    trim: 1.767,
    crackle: true,
    wobble: true,
  },
  synthwave: {
    toneLowpassHz: 16000,
    delayFeedback: 0.42,
    delayLowpassHz: 3200,
    delayWet: 0.45,
    reverbWet: 0.38,
    trim: 1.8,
    crackle: false,
    wobble: false,
  },
  chiptune: {
    toneLowpassHz: 14000,
    delayFeedback: 0.32,
    delayLowpassHz: 3200,
    delayWet: 0.45,
    reverbWet: 0.38,
    trim: 1.74,
    crackle: false,
    wobble: false,
  },
  techno: {
    toneLowpassHz: 16000,
    delayFeedback: 0.32,
    delayLowpassHz: 3200,
    delayWet: 0.45,
    reverbWet: 0.5,
    trim: 1.772,
    crackle: false,
    wobble: false,
  },
};
