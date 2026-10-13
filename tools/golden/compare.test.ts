import { describe, expect, it } from 'vitest';
import { compareFixture, formatMismatch } from './compare.ts';
import { readFixture, readIndex } from './fixtures.ts';

describe('the comparison is not vacuous', () => {
  it('reports a chart time off by 2e-9', () => {
    const fx = readFixture('techno-song-amber-11.json');
    fx.charts.hard[100]![0] += 2e-9;
    expect(compareFixture(fx).map((m) => m.where)).toEqual(['charts.hard[100][0]']);
  });

  it('reports a changed event field, a wrong name and a missing note', () => {
    const fx = readFixture('lofi-song-amber-11.json');
    fx.bars[7]!.events[3]!.vel = 0.5;
    fx.meta.name = 'Wrong';
    fx.charts.easy.pop();
    const where = compareFixture(fx).map((m) => m.where);
    expect(where).toContain('meta.name');
    expect(where).toContain('bars[7].events[3].vel');
    expect(where).toContain('charts.easy.length');
  });

  it('compares a substantial corpus', () => {
    let events = 0;
    let notes = 0;
    for (const row of readIndex()) {
      const fx = readFixture(row.file);
      for (const b of fx.bars) events += b.events.length;
      for (const d of ['easy', 'normal', 'hard'] as const) notes += fx.charts[d].length;
    }
    expect(events).toBeGreaterThan(5000);
    expect(notes).toBe(11462); // GENERATION.md §6
  });
});

/**
 * Generator v1 parity (CLAUDE.md rule 2): every fixture must be reproduced exactly, with times
 * compared to 1e-9 s. If this fails, fix the port; never regenerate the fixtures.
 */
describe('generator v1 reproduces the golden fixtures', () => {
  for (const row of readIndex()) {
    it(`${row.file} (${row.name}, ${row.bpm} BPM)`, () => {
      const mismatches = compareFixture(readFixture(row.file));
      expect(mismatches.map(formatMismatch)).toEqual([]);
    });
  }
});
