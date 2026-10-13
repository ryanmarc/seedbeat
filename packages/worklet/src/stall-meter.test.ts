import { describe, expect, it } from 'vitest';
import { MIN_SAMPLES, StallMeter } from './stall-meter';

/**
 * Feed `n` bursts of `blocks` blocks, one burst every `periodMs`, through a 1 ms clock
 * (Date.now()): block k of a burst is stamped at floor(t + k * 0.3) so blocks inside a burst
 * often share a tick or sit 1 ms apart, as on a phone. Returns the next burst time.
 */
function bursts(m: StallMeter, t: number, n: number, periodMs: number, blocks = 2): number {
  for (let i = 0; i < n; i++) {
    for (let b = 0; b < blocks; b++) m.tick(Math.floor(t + b * 0.3));
    t += periodMs;
  }
  return t;
}

describe('StallMeter', () => {
  it('uses the period from the main thread and flags a missed callback on any buffer size', () => {
    for (const [period, blocks] of [
      [5.33, 2],
      [10, 4],
      [21.33, 8],
    ] as const) {
      const m = new StallMeter();
      m.setPeriod(period);
      const t = bursts(m, 0, 60, period, blocks);
      const quiet = m.snapshot();
      expect(quiet.stalls, `period ${period}`).toBe(0);
      expect(quiet.periodMs).toBe(period);
      bursts(m, t + period * 1.3, 4, period, blocks); // one callback 1.3 periods late
      expect(m.snapshot().stalls, `period ${period}`).toBe(1);
      expect(m.lastStallMs).toBeGreaterThan(m.threshold());
    }
  });

  it('estimates the period as the burst-to-burst gap when none is given, even with 1 ms ticks', () => {
    for (const [period, blocks] of [
      [5, 2],
      [21, 8],
    ] as const) {
      const m = new StallMeter();
      bursts(m, 0, MIN_SAMPLES * 2, period, blocks);
      const s = m.snapshot();
      // The estimate is the gap between bursts: the period less the burst's own length.
      expect(s.periodMs, `period ${period}`).toBeGreaterThanOrEqual(period - blocks * 0.3 - 1);
      expect(s.periodMs, `period ${period}`).toBeLessThanOrEqual(period + 1);
      expect(s.stalls, `period ${period}`).toBe(0);
    }
  });

  it('does not count the first gaps or the gap across a pause', () => {
    const m = new StallMeter();
    m.tick(0);
    m.tick(500); // warm-up: no period yet
    const t = bursts(m, 500, MIN_SAMPLES + 4, 10, 4);
    m.resume();
    bursts(m, t + 5000, 4, 10, 4); // paused for 5 s
    expect(m.snapshot().stalls).toBe(0);
    m.setPeriod(10);
    m.reset();
    expect(m.snapshot()).toEqual({
      periodMs: 10,
      maxGapMs: 0,
      stalls: 0,
      lastStallMs: 0,
      maxBusyMs: 0,
    });
    m.busy(3);
    m.busy(12);
    expect(m.snapshot()).toMatchObject({ stalls: 1, lastStallMs: 12, maxBusyMs: 12 });
  });
});
