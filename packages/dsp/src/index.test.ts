import { describe, expect, it } from 'vitest';
import { BLOCK_SIZE, clampSample } from './index';

describe('dsp package', () => {
  it('uses the AudioWorklet block size', () => {
    expect(BLOCK_SIZE).toBe(128);
  });

  it('clamps samples to [-1, 1]', () => {
    expect(clampSample(2)).toBe(1);
    expect(clampSample(-2)).toBe(-1);
    expect(clampSample(0.25)).toBe(0.25);
  });
});
