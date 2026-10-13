import { describe, expect, it } from 'vitest';
import { BLOCK_SIZE, clampSample } from '../src/index';

/**
 * `pnpm test:audio` — offline DSP render checks (loudness, true peak, NaN/Inf, DC offset).
 * M2 replaces this placeholder with real renders of each mood × 5 seeds.
 */
describe('offline render (placeholder until M2)', () => {
  it('produces finite samples for a silent block', () => {
    const block = new Float32Array(BLOCK_SIZE);
    for (let i = 0; i < block.length; i++) block[i] = clampSample(block[i] ?? 0);
    expect(block.every((s) => Number.isFinite(s))).toBe(true);
  });
});
