import { describe, expect, it } from 'vitest';
import { BLOCK_SIZE, Engine } from '@seedbeat/dsp';
import { warmUp } from './warmup';

describe('warmUp', () => {
  it('leaves the engine silent and idle, and is cheap', () => {
    const e = new Engine(48000);
    const t0 = performance.now();
    warmUp(e);
    const ms = performance.now() - t0;
    expect(e.stats.peakVoices).toBeGreaterThan(4);
    const l = new Float32Array(BLOCK_SIZE);
    const r = new Float32Array(BLOCK_SIZE);
    for (let i = 0; i < 8; i++) e.render(l, r, BLOCK_SIZE, 1 << 20);
    expect(e.stats.voices).toBe(0);
    expect(Math.max(...l.map(Math.abs), ...r.map(Math.abs))).toBe(0);
    // About a second of audio rendered: well under 100 ms here, a few hundred on a phone.
    expect(ms).toBeLessThan(500);
    console.log(`warm-up ${ms.toFixed(1)} ms`);
  });
});
