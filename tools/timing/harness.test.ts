/**
 * TIMING.md §7 harnesses. All headless: the clock takes a fake audio source and a fake
 * performance clock; the session runs on song time.
 */
import { describe, expect, it } from 'vitest';
import { rngFor, createSession, press, update, WINDOWS, MISS_GRACE } from '@seedbeat/core';
import { GameClock } from '../../apps/game/src/engine/clock.ts';
import {
  estimateOffset,
  tapDeviation,
  CLICK_INTERVAL,
  WARMUP_CLICKS,
  CLICK_COUNT,
} from '../../apps/game/src/engine/calibration.ts';
import { decidePacing } from '../../apps/game/src/engine/pacing.ts';
import { PlayRun } from '../../apps/game/src/engine/play.ts';

const FRAME = 1000 / 60;

/**
 * Simulated phone audio clock: the true audio time advances continuously, but
 * getOutputTimestamp only refreshes in irregular 40–100 ms bursts, with 80 ms output latency.
 */
class BurstyAudio {
  state = 'running' as const;
  outputLatency = 0.08;
  private lastUpdate = -Infinity;
  private snapshot = { contextTime: 0, performanceTime: 0 };
  private nextGap = 0.04;
  constructor(
    private readonly rng: { f(): number },
    private readonly startCtx: number,
  ) {}
  /** True audio time (what the speaker is playing right now) at perf ms. */
  trueHeard(perfMs: number): number {
    return this.startCtx + perfMs / 1000;
  }
  /** The render-side clock, also only refreshed per callback (stale between updates). */
  get currentTime(): number {
    return this.snapshot.contextTime + this.outputLatency;
  }
  tick(perfMs: number): void {
    if (perfMs - this.lastUpdate >= this.nextGap * 1000) {
      this.lastUpdate = perfMs;
      this.nextGap = 0.04 + this.rng.f() * 0.06;
      // getOutputTimestamp pairs the context time of the sample leaving the speaker with the
      // performance time it was captured at; both are exact as of the callback.
      this.snapshot = { contextTime: this.trueHeard(perfMs), performanceTime: perfMs };
    }
  }
  getOutputTimestamp(): { contextTime: number; performanceTime: number } {
    return this.snapshot;
  }
}

describe('harness 1: bursty clock', () => {
  it('note-position step error under 1 ms per frame and mean bias within 5 ms over 5 s', () => {
    const rng = rngFor('harness', 'bursty');
    const audio = new BurstyAudio(rng, 100);
    let now = 0;
    const clock = new GameClock(audio, () => now);
    clock.startSong(audio.trueHeard(0));
    let prev: number | null = null;
    let maxStep = 0;
    let biasSum = 0;
    let n = 0;
    for (let f = 0; f < 300; f++) {
      now = f * FRAME;
      audio.tick(now);
      clock.sample();
      const t = clock.songTime(now);
      if (prev !== null) {
        const step = t - prev;
        maxStep = Math.max(maxStep, Math.abs(step - FRAME / 1000));
      }
      prev = t;
      // Bias: reported song time vs truth (truth = now/1000 since the song started at perf 0).
      biasSum += t - now / 1000;
      n++;
    }
    const bias = biasSum / n;
    expect(maxStep).toBeLessThan(0.001);
    expect(Math.abs(bias)).toBeLessThan(0.005);
  });
});

describe('harness 2: late delivery', () => {
  it('inputs whose handlers run 50 ms late but carry exact timestamps all judge Perfect', () => {
    const notes = Array.from({ length: 40 }, (_, i) => ({ t: 1 + i * 0.25, lane: i % 4, end: 0 }));
    const audio = { state: 'running' as const, currentTime: 0, outputLatency: 0 };
    let now = 0;
    const clock = new GameClock(audio, () => now);
    clock.startSong(0);
    const run = new PlayRun(
      clock,
      {
        seed: 's',
        mood: 'lofi',
        mode: 'song',
        difficulty: 1,
        generatorVersion: 1,
        speed: 1,
        noFail: false,
      },
      notes,
    );
    const pending: { deliverAt: number; lane: number; down: boolean; perfMs: number }[] = [];
    for (const nt of notes) {
      pending.push({ deliverAt: nt.t * 1000 + 50, lane: nt.lane, down: true, perfMs: nt.t * 1000 });
      pending.push({
        deliverAt: nt.t * 1000 + 80,
        lane: nt.lane,
        down: false,
        perfMs: nt.t * 1000 + 30,
      });
    }
    for (let f = 0; f * FRAME < 12_000; f++) {
      now = f * FRAME;
      audio.currentTime = now / 1000;
      run.frame(now);
      for (const p of pending) {
        if (p.deliverAt <= now && p.deliverAt > now - FRAME)
          run.input({ lane: p.lane, down: p.down, perfMs: p.perfMs, source: 'key' });
      }
    }
    const js = run.session.events.map((e) => e.judgement);
    expect(js).toHaveLength(40);
    expect(new Set(js)).toEqual(new Set(['perfect']));
    expect(run.session.lateInputs).toBe(0);
    // And the grace is what makes it work: 50 ms late is inside Good + grace.
    expect(0.05).toBeLessThan(WINDOWS.good + MISS_GRACE);
  });

  it('an input delivered after the miss grace is counted as late, not judged', () => {
    const s = createSession([{ t: 1, lane: 0, end: 0 }], { difficulty: 1 });
    update(s, 1 + WINDOWS.good + MISS_GRACE + 0.001);
    press(s, 0, 1);
    expect(s.events[0]?.judgement).toBe('miss');
    expect(s.lateInputs).toBe(1);
  });
});

describe('harness 3: calibration estimator', () => {
  it('scripted taps at +30 ms with 8 ms Gaussian noise → every estimate within 6 ms, spread 5–10 ms', () => {
    const spreads: number[] = [];
    for (let trial = 0; trial < 12; trial++) {
      const rng = rngFor('harness', 'calibration', trial);
      const gauss = (): number => {
        const u = 1 - rng.f();
        const v = rng.f();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      };
      const devs: number[] = [];
      for (let k = 0; k < CLICK_COUNT; k++) {
        const d = tapDeviation(k * CLICK_INTERVAL + 0.03 + gauss() * 0.008);
        if (d !== null) devs.push(d);
      }
      expect(devs).toHaveLength(CLICK_COUNT - WARMUP_CLICKS);
      const e = estimateOffset(devs);
      expect(Math.abs(e.offset - 0.03), `trial ${trial} offset ${e.offset}`).toBeLessThan(0.006);
      spreads.push(e.spread);
    }
    spreads.sort((a, b) => a - b);
    const median = spreads[Math.floor(spreads.length / 2)]!;
    expect(median).toBeGreaterThanOrEqual(0.005);
    expect(median).toBeLessThanOrEqual(0.01);
  });
});

describe('harness 4: pacing decision', () => {
  const trace = (hz: number, lateFrac: number): number[] => {
    const rng = rngFor('harness', 'pacing', hz, lateFrac);
    const iv = 1 / hz;
    return Array.from({ length: 120 }, () =>
      rng.f() < lateFrac ? iv * 2 : iv * (1 + (rng.f() - 0.5) * 0.1),
    );
  };
  it.each([
    [120, 0.1, true],
    [120, 0.02, false],
    [60, 0.15, false],
    [90, 0.12, true],
  ])('%i Hz with %f late → half=%s', (hz, late, half) => {
    expect(decidePacing(trace(hz, late), false, 0).half).toBe(half);
  });
});
