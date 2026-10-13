import { describe, expect, it } from 'vitest';
import { BLOCK_SIZE, Engine } from './engine';
import { eventTriggers, type MusicEvent, type Trigger } from './presets';

/**
 * Rule 4 (CLAUDE.md) for the audio thread: rendering must not allocate. V8 boxes any fraction that
 * crosses a non-inlined call as a 16-byte heap number, so a per-sample call chain can produce tens
 * of MB of garbage per second and the young-generation collections then stall the worklet (the
 * M7 stutter). This renders a busy mix and bounds the heap growth per block. Node reports heap
 * use with about 1 KB of noise per sample, so the bound is loose but far below the ~50–100 KB per
 * block the per-sample chain produced.
 */
const SR = 48000;
const LIMIT_BYTES_PER_BLOCK = 4096;

function busyEngine(): Engine {
  const e = new Engine(SR);
  e.configure('lofi', 0.14); // crackle and wobble on: the most work per sample
  const events: MusicEvent[] = [
    { type: 'kick' },
    { type: 'snare' },
    { type: 'hat' },
    { type: 'bass', midi: 36, len: 4 },
    { type: 'keys', midis: [60, 64, 67, 71], len: 8 },
    { type: 'lead', midi: 72, len: 2 },
    { type: 'pad', midis: [48, 55, 60], len: 16 },
  ];
  const out: Trigger[] = [];
  for (const ev of events) {
    out.length = 0;
    eventTriggers('lofi', ev, 0.14, out);
    e.triggerAll(out, 0);
  }
  return e;
}

describe('engine allocation', () => {
  it('renders a busy mix without allocating per block', () => {
    const e = busyEngine();
    const l = new Float32Array(BLOCK_SIZE);
    const r = new Float32Array(BLOCK_SIZE);
    // Warm up the JIT on a few hundred blocks, retriggering so voices stay busy.
    for (let i = 0; i < 400; i++) e.render(l, r, BLOCK_SIZE, i * BLOCK_SIZE);
    expect(e.stats.peakVoices).toBeGreaterThan(8);
    const blocks = 1500;
    let alloc = 0;
    let last = process.memoryUsage().heapUsed;
    for (let i = 0; i < blocks; i++) {
      e.render(l, r, BLOCK_SIZE, (400 + i) * BLOCK_SIZE);
      if (i % 4 === 3) {
        const h = process.memoryUsage().heapUsed;
        if (h > last) alloc += h - last;
        last = h;
      }
    }
    const perBlock = alloc / blocks;
    expect(perBlock, `bytes allocated per block`).toBeLessThan(LIMIT_BYTES_PER_BLOCK);
  });
});
