import { describe, expect, it } from 'vitest';
import { DC_MAX_DB, MOODS, TRUE_PEAK_MAX, renderAndMeasure } from './helpers';

/** Authored melodies cluster differently from procedural ones; each mood must still render clean. */
describe('curated song renders', () => {
  for (const mood of MOODS) {
    it(`${mood} friday: no NaN, true peak and DC within limits, no voice steals`, () => {
      const m = renderAndMeasure(mood, 'friday');
      expect(m.full.nan).toBe(0);
      expect(m.full.truePeakDb).toBeLessThanOrEqual(TRUE_PEAK_MAX);
      expect(m.full.dcDb).toBeLessThan(DC_MAX_DB);
      expect(m.render.stats.steals).toBe(0);
      expect(Math.abs(m.full.integrated - -16)).toBeLessThan(2.5);
    });
  }
});
