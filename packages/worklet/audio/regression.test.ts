import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeSong } from '@seedbeat/core';
import { describe, expect, it } from 'vitest';
import { FROM_BAR, MOODS, SAMPLE_RATE, centroidPerBar, rmsPerBar } from './helpers';
import { renderOffline } from '../src/offline';

/**
 * Regression snapshots (AUDIO.md §4): RMS per bar and spectral centroid per bar for one golden
 * song per mood, compared with tolerance rather than bit-exactly. Intentional DSP changes update
 * them with UPDATE_AUDIO_SNAPSHOTS=1.
 */
const DIR = join(import.meta.dirname, '__snapshots__');
const BARS = 8;
const RMS_TOL_DB = 1.5;
const CENTROID_TOL = 0.12;
const UPDATE = process.env['UPDATE_AUDIO_SNAPSHOTS'] === '1';

interface Snap {
  rms: number[];
  centroid: number[];
}

describe('audio regression snapshots (amber-11, bars 4–12)', () => {
  for (const mood of MOODS) {
    it(mood, () => {
      const song = makeSong('amber-11', mood, 'song');
      const r = renderOffline({
        seed: 'amber-11',
        mood,
        fromBar: FROM_BAR,
        bars: BARS,
        sampleRate: SAMPLE_RATE,
      });
      const now: Snap = {
        rms: rmsPerBar(r, song.barDur, BARS),
        centroid: centroidPerBar(r, song.barDur, BARS),
      };
      const file = join(DIR, `${mood}-amber-11.json`);
      if (UPDATE || !existsSync(file)) {
        mkdirSync(DIR, { recursive: true });
        writeFileSync(file, JSON.stringify(now, null, 1) + '\n');
        console.log(`wrote ${file}`);
        return;
      }
      const ref = JSON.parse(readFileSync(file, 'utf8')) as Snap;
      for (let b = 0; b < BARS; b++) {
        expect(Math.abs(now.rms[b]! - ref.rms[b]!), `bar ${b} RMS`).toBeLessThanOrEqual(RMS_TOL_DB);
        const rel = Math.abs(now.centroid[b]! - ref.centroid[b]!) / Math.max(ref.centroid[b]!, 1);
        expect(rel, `bar ${b} centroid`).toBeLessThanOrEqual(CENTROID_TOL);
      }
    });
  }
});
