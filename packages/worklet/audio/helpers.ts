import { measureLoudness, phoneWeight, type LoudnessResult } from '@seedbeat/dsp';
import type { MoodId } from '@seedbeat/core';
import { renderOffline, type OfflineRender } from '../src/offline';

export const MOODS: readonly MoodId[] = ['lofi', 'synthwave', 'chiptune', 'techno'];
/** Five seeds per mood (AUDIO.md §3). Three are golden seeds. */
export const SEEDS = ['amber-11', 'cobalt-42', 'orbit-73', 'lantern-7', 'glacier-58'] as const;
export const SAMPLE_RATE = 48000;
/** Measurement window: bars 4–28 (AUDIO.md §3). */
export const FROM_BAR = 4;
export const BARS = 24;

export const TARGET_LUFS = -16;
export const LUFS_TOLERANCE = 1;
export const PHONE_SPREAD_MAX = 1.5;
export const TRUE_PEAK_MAX = -1;
export const DC_MAX_DB = -60;

export interface Measured {
  mood: MoodId;
  seed: string;
  full: LoudnessResult;
  phone: number;
  render: OfflineRender;
}

const clock = (): number => performance.now() / 1000;

export function renderAndMeasure(mood: MoodId, seed: string, bars = BARS): Measured {
  const render = renderOffline(
    { seed, mood, fromBar: FROM_BAR, bars, sampleRate: SAMPLE_RATE },
    clock,
  );
  const ch = [render.left, render.right];
  const full = measureLoudness(ch, SAMPLE_RATE);
  const phone = measureLoudness(phoneWeight(ch, SAMPLE_RATE), SAMPLE_RATE).integrated;
  return { mood, seed, full, phone, render };
}

export function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** RMS in dBFS per bar of the window, for regression snapshots. */
export function rmsPerBar(r: OfflineRender, barSec: number, bars: number): number[] {
  const out: number[] = [];
  const n = Math.round(barSec * r.sampleRate);
  for (let b = 0; b < bars; b++) {
    const start = r.originFrame + b * n;
    let s = 0;
    for (let i = start; i < start + n && i < r.left.length; i++) {
      const l = r.left[i]!;
      const rr = r.right[i]!;
      s += (l * l + rr * rr) / 2;
    }
    out.push(10 * Math.log10(Math.max(s / n, 1e-12)));
  }
  return out;
}

/** Spectral centroid (Hz) per bar via a coarse DFT on 2048-sample frames, for regression snapshots. */
export function centroidPerBar(r: OfflineRender, barSec: number, bars: number): number[] {
  const N = 2048;
  const out: number[] = [];
  const n = Math.round(barSec * r.sampleRate);
  const re = new Float64Array(N);
  const bins = 64; // coarse: 64 log-spaced-ish bins is enough for a centroid
  for (let b = 0; b < bars; b++) {
    let num = 0;
    let den = 0;
    for (
      let start = r.originFrame + b * n;
      start + N <= r.originFrame + (b + 1) * n && start + N <= r.left.length;
      start += N * 4
    ) {
      for (let i = 0; i < N; i++)
        re[i] =
          (r.left[start + i]! + r.right[start + i]!) *
          0.5 *
          (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
      for (let k = 1; k <= bins; k++) {
        const bin = Math.round(Math.pow(N / 2, k / bins));
        let sr = 0;
        let si = 0;
        const w = (2 * Math.PI * bin) / N;
        for (let i = 0; i < N; i++) {
          sr += re[i]! * Math.cos(w * i);
          si -= re[i]! * Math.sin(w * i);
        }
        const mag = Math.sqrt(sr * sr + si * si);
        const hz = (bin * r.sampleRate) / N;
        num += mag * hz;
        den += mag;
      }
    }
    out.push(den > 0 ? num / den : 0);
  }
  return out;
}
