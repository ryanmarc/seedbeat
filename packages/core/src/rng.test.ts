import { describe, expect, it } from 'vitest';
import { hash32, mulberry, rngFor } from './rng';

describe('rng', () => {
  it('hash32 is stable and 32-bit unsigned', () => {
    expect(hash32('')).toBe(hash32(''));
    expect(hash32('amber-11|lofi|song')).toBe(hash32('amber-11|lofi|song'));
    expect(hash32('a')).not.toBe(hash32('b'));
    for (const s of ['', 'seed', 'cobalt-42|techno|bar|17', '♯']) {
      const h = hash32(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('mulberry32 yields floats in [0,1) and is reproducible', () => {
    const a = mulberry(12345);
    const b = mulberry(12345);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('rngFor keys by its parts, numbers formatted like JavaScript', () => {
    expect(rngFor('s', 'lofi', 'bar', 3).f()).toBe(rngFor('s', 'lofi', 'bar', '3').f());
    expect(rngFor('s', 'lofi', 'bar', 3).f()).not.toBe(rngFor('s', 'lofi', 'bar', 4).f());
  });

  it('int is inclusive on both ends and pick covers the array', () => {
    const r = rngFor('coverage');
    const seen = new Set<number>();
    const picked = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      seen.add(r.int(2, 5));
      picked.add(r.pick(['a', 'b', 'c']));
    }
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
    expect([...picked].sort()).toEqual(['a', 'b', 'c']);
  });
});
