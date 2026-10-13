import { makeSong, type MoodId, type Mode } from '@seedbeat/core';
import { BLOCK_SIZE, Engine } from '@seedbeat/dsp';
import { Sequencer } from './sequencer';

export interface OfflineOptions {
  seed: string;
  mood: MoodId;
  mode?: Mode;
  /** First bar to render (inclusive). */
  fromBar?: number;
  /** Number of bars to render. Default: the rest of the song. */
  bars?: number;
  sampleRate?: number;
  rate?: number;
  /** Seconds rendered after the last bar for tails. */
  tailSec?: number;
}

export interface OfflineRender {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  /** Frame index (in the output) of bar `fromBar`'s downbeat. */
  originFrame: number;
  /** Absolute engine frame of each triggered bar downbeat, for onset tests. */
  stats: { voices: number; peakVoices: number; steals: number };
  /** Wall-clock seconds spent rendering. */
  renderSec: number;
  /** Rendered audio seconds. */
  audioSec: number;
}

/**
 * Renders a song window to stereo Float32Arrays in Node (no Web Audio), using exactly the code
 * the AudioWorklet runs. Used by `pnpm test:audio` and the trim calibration.
 */
export function renderOffline(o: OfflineOptions, now: () => number = () => 0): OfflineRender {
  const sampleRate = o.sampleRate ?? 48000;
  const mode = o.mode ?? 'song';
  const song = makeSong(o.seed, o.mood, mode);
  const fromBar = o.fromBar ?? 0;
  const total = song.total ?? Infinity;
  const bars = Math.min(o.bars ?? total - fromBar, total - fromBar);
  const rate = o.rate ?? 1;
  const tail = o.tailSec ?? 1.5;
  const lead = 0.05;
  const originFrame = Math.round(lead * sampleRate);
  const audioSec = lead + (bars * song.barDur) / rate + tail;
  const n = Math.ceil(audioSec * sampleRate);
  const left = new Float32Array(n);
  const right = new Float32Array(n);

  const engine = new Engine(sampleRate);
  const seq = new Sequencer(engine, sampleRate);
  // Bar `fromBar` should sound at originFrame: bar 0 would then be earlier.
  const startFrame = originFrame - Math.round(((fromBar * song.barDur) / rate) * sampleRate);
  seq.start({ seed: o.seed, mood: o.mood, mode, startFrame, rate, fromBar, toBar: fromBar + bars });

  const bl = new Float32Array(BLOCK_SIZE);
  const br = new Float32Array(BLOCK_SIZE);
  const t0 = now();
  for (let pos = 0; pos < n; pos += BLOCK_SIZE) {
    const len = Math.min(BLOCK_SIZE, n - pos);
    seq.process(bl, br, len, pos);
    left.set(len === BLOCK_SIZE ? bl : bl.subarray(0, len), pos);
    right.set(len === BLOCK_SIZE ? br : br.subarray(0, len), pos);
  }
  const renderSec = now() - t0;
  return { left, right, sampleRate, originFrame, stats: { ...engine.stats }, renderSec, audioSec };
}
