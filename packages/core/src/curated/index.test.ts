import { describe, expect, it } from 'vitest';
import { SCALES } from '../theory';
import { CURATED, canonicalSeed, findCurated } from './index';
import { parseMelody } from './build';

describe('curated registry', () => {
  it('finds entries case-insensitively and ignores surrounding spaces', () => {
    expect(findCurated('friday')?.title).toBe('Friday');
    expect(findCurated('FRIDAY')?.title).toBe('Friday');
    expect(findCurated('  Friday ')?.title).toBe('Friday');
    expect(findCurated('fridays')).toBeNull();
    expect(findCurated('amber-11')).toBeNull();
  });
  it('ignores Object.prototype keys as seeds', () => {
    for (const seed of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(findCurated(seed)).toBeNull();
      expect(canonicalSeed(seed)).toBe(seed);
    }
  });
  it('canonicalises only curated seeds', () => {
    expect(canonicalSeed('Friday')).toBe('friday');
    expect(canonicalSeed(' FRIDAY ')).toBe('friday');
    expect(canonicalSeed('Blue')).toBe('Blue');
  });
  it('every entry has lowercase keys, a title, and parseable melodies', () => {
    for (const [key, c] of Object.entries(CURATED)) {
      expect(key).toBe(key.toLowerCase().trim());
      expect(c.title.length).toBeGreaterThan(0);
      for (const bars of Object.values(c.melody))
        expect(() => parseMelody(bars!, SCALES[c.scale], c.root + 24)).not.toThrow();
    }
  });
});
