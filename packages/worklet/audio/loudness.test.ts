import { makeSong } from '@seedbeat/core';
import { MOOD_MIX } from '@seedbeat/dsp';
import { describe, expect, it } from 'vitest';
import {
  BARS,
  DC_MAX_DB,
  LUFS_TOLERANCE,
  MOODS,
  PHONE_SPREAD_MAX,
  SEEDS,
  TARGET_LUFS,
  TRUE_PEAK_MAX,
  mean,
  renderAndMeasure,
  type Measured,
} from './helpers';

/**
 * AUDIO.md §3–4: each mood × 5 seeds rendered offline over bars 4–28.
 * - integrated loudness −16 LUFS ± 1 LU per mood (mean over seeds)
 * - phone-weighted (220 Hz HP) loudness of all moods within 1.5 LU of each other
 * - true peak ≤ −1 dBTP, no NaN/Inf, DC below −60 dBFS, render faster than realtime
 * - voice pool never overflows (no steals)
 *
 * `AUDIO_CALIBRATE=1` prints the trim each mood needs to hit the target instead of asserting.
 */
const CALIBRATE = process.env['AUDIO_CALIBRATE'] === '1';

describe('offline renders: loudness, peaks, health', () => {
  const byMood = new Map<string, Measured[]>();
  for (const mood of MOODS) {
    for (const seed of SEEDS) {
      it(`${mood} ${seed} renders cleanly`, () => {
        const m = renderAndMeasure(mood, seed);
        byMood.set(mood, [...(byMood.get(mood) ?? []), m]);
        const song = makeSong(seed, mood, 'song');
        expect(song.total).toBeGreaterThanOrEqual(BARS + 4);
        expect(m.full.nan).toBe(0);
        expect(m.full.truePeakDb).toBeLessThanOrEqual(TRUE_PEAK_MAX);
        expect(m.full.dcDb).toBeLessThan(DC_MAX_DB);
        expect(m.render.stats.steals).toBe(0);
        expect(m.render.renderSec).toBeLessThan(m.render.audioSec);
      });
    }
  }

  it('each mood averages −16 LUFS ± 1 LU, and the phone-weighted spread is ≤ 1.5 LU', () => {
    const rows: string[] = [];
    const phoneMeans: number[] = [];
    for (const mood of MOODS) {
      const ms = byMood.get(mood) ?? [];
      const lufs = mean(ms.map((m) => m.full.integrated));
      const phone = mean(ms.map((m) => m.phone));
      const tp = Math.max(...ms.map((m) => m.full.truePeakDb));
      const speed = mean(ms.map((m) => m.render.audioSec / m.render.renderSec));
      const peakVoices = Math.max(...ms.map((m) => m.render.stats.peakVoices));
      phoneMeans.push(phone);
      const needed = MOOD_MIX[mood].trim * Math.pow(10, (TARGET_LUFS - lufs) / 20);
      rows.push(
        `${mood.padEnd(10)} LUFS ${lufs.toFixed(2)}  phone ${phone.toFixed(2)}  TP ${tp.toFixed(2)} dBTP  peak voices ${peakVoices}  ${speed.toFixed(0)}× realtime  trim ${MOOD_MIX[mood].trim.toFixed(3)} → suggested ${needed.toFixed(3)}`,
      );
      if (!CALIBRATE)
        expect(
          Math.abs(lufs - TARGET_LUFS),
          `${mood} loudness ${lufs.toFixed(2)} LUFS`,
        ).toBeLessThanOrEqual(LUFS_TOLERANCE);
    }
    const spread = Math.max(...phoneMeans) - Math.min(...phoneMeans);
    rows.push(`phone-weighted spread ${spread.toFixed(2)} LU`);
    console.log(rows.join('\n'));
    if (!CALIBRATE) expect(spread).toBeLessThanOrEqual(PHONE_SPREAD_MAX);
  });
});
