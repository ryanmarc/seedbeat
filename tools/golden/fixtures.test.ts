import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_DIR, listFixtureFiles, readFixture, readIndex } from './fixtures.ts';

/**
 * Fixture integrity. The real generator comparison arrives in M1 (compare.test.ts); this file makes
 * sure the frozen v1 fixtures are complete, well-formed and untouched.
 */
const DIFFS = ['easy', 'normal', 'hard'] as const;

describe('golden fixtures v1', () => {
  const index = readIndex();
  const files = listFixtureFiles();

  it('has 16 fixtures: 4 moods × (3 song seeds + 1 endless seed)', () => {
    expect(files).toHaveLength(16);
    expect(index).toHaveLength(16);
    expect(index.map((r) => r.file).sort()).toEqual(files);
    for (const mood of ['lofi', 'synthwave', 'chiptune', 'techno']) {
      const rows = index.filter((r) => r.mood === mood);
      expect(rows.filter((r) => r.mode === 'song')).toHaveLength(3);
      expect(rows.filter((r) => r.mode === 'endless')).toHaveLength(1);
    }
  });

  for (const row of index) {
    describe(row.file, () => {
      const fx = readFixture(row.file);

      it('metadata matches the index and is generator v1', () => {
        expect(fx.meta.generatorVersion).toBe(1);
        expect(fx.meta.seed).toBe(row.seed);
        expect(fx.meta.mood).toBe(row.mood);
        expect(fx.meta.mode).toBe(row.mode);
        expect(fx.meta.bpm).toBe(row.bpm);
        expect(fx.meta.name).toBe(row.name);
        expect(fx.meta.totalBars).toBe(row.totalBars);
        expect(fx.meta.stepSec).toBeCloseTo(60 / row.bpm / 4, 12);
        expect(fx.meta.barSec).toBeCloseTo(fx.meta.stepSec * 16, 12);
      });

      it('has the documented number of event bars', () => {
        expect(fx.bars).toHaveLength(row.eventBars);
        fx.bars.forEach((b, i) => expect(b.bar).toBe(i));
      });

      it('chart note counts match the index', () => {
        for (const d of DIFFS) expect(fx.charts[d]).toHaveLength(row.notes[d]);
      });

      it('chart notes are [time, lane, tail], sorted, lanes 0–3, tails after heads', () => {
        for (const d of DIFFS) {
          let prev = -Infinity;
          for (const [t, lane, tail] of fx.charts[d]) {
            expect(t).toBeGreaterThanOrEqual(prev);
            expect(lane).toBeGreaterThanOrEqual(0);
            expect(lane).toBeLessThanOrEqual(3);
            if (tail !== 0) expect(tail).toBeGreaterThan(t + fx.meta.stepSec);
            prev = t;
          }
        }
      });

      it('song sections are contiguous and end at totalBars', () => {
        let bar = 0;
        for (const s of fx.meta.sections) {
          expect(s.start).toBe(bar);
          bar += s.len;
        }
        if (fx.meta.mode === 'song') expect(bar).toBe(fx.meta.totalBars);
      });
    });
  }

  // The tracked copy must stay byte-identical to the handoff kit's source of truth when it is present
  // (it is gitignored, so this is skipped in CI).
  const source = join(import.meta.dirname, '..', '..', 'reference', 'golden', 'v1');
  it.skipIf(!existsSync(source))(
    'tracked fixtures are byte-identical to reference/golden/v1',
    () => {
      for (const f of [...files, 'index.json']) {
        expect(readFileSync(join(FIXTURE_DIR, f))).toEqual(readFileSync(join(source, f)));
      }
    },
  );
});
