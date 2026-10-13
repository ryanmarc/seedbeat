import { describe, expect, it } from 'vitest';
import { GameClock, eventMs } from './clock';
import { estimateOffset, tapDeviation } from './calibration';
import { GamepadLanes, KeyMap, PointerLanes, laneFromX, type LaneEvent } from './input';
import { PacingController, decidePacing } from './pacing';

describe('eventMs', () => {
  it('uses the event stamp when recent and not in the future, else now', () => {
    expect(eventMs(1000, 1050)).toBe(1000);
    expect(eventMs(1000, 1400)).toBe(1400);
    expect(eventMs(1100, 1050)).toBe(1050);
    expect(eventMs(0, 1050)).toBe(1050);
    expect(eventMs(1051, 1050)).toBe(1051); // 2 ms slack
  });
});

describe('GameClock', () => {
  function fakeAudio(latency = 0.08) {
    return {
      state: 'running' as 'running' | 'suspended' | 'closed',
      currentTime: 0,
      outputLatency: latency,
      stamp: null as { contextTime: number; performanceTime: number } | null,
      getOutputTimestamp() {
        return this.stamp ?? {};
      },
    };
  }

  it('maps perf time through a stable offset and snaps on the first sample', () => {
    const a = fakeAudio();
    let now = 1000;
    const c = new GameClock(a, () => now);
    a.currentTime = 5;
    c.sample();
    // offset = (5 - 0.08) - 1.0 = 3.92
    expect(c.heardAt(1000)).toBeCloseTo(4.92, 9);
    c.startSong(4.92);
    c.audioOffset = 0.05;
    expect(c.songTime(1000)).toBeCloseTo(-0.05, 9);
    now = 1016.667;
    expect(c.songTime(now)).toBeCloseTo(0.016667 - 0.05, 6);
  });

  it('prefers getOutputTimestamp when it is fresh, else falls back to currentTime − latency', () => {
    const a = fakeAudio(0.08);
    const now = 2000;
    const c = new GameClock(a, () => now);
    a.currentTime = 8.59; // render clock; heard = 8.51 at perf 2.0 → 6.51
    a.stamp = { contextTime: 8.5, performanceTime: 1990 }; // heard 8.5 at perf 1.99 → 6.51
    c.sample();
    expect(c.offset).toBeCloseTo(6.51, 9);
    a.stamp = { contextTime: 8.5, performanceTime: 500 }; // stale by 1.5 s → ignored
    a.currentTime = 8.6; // fallback: 8.52 − 2.0 = 6.52, within glide range
    c.sample();
    expect(c.offset).toBeCloseTo(6.5105, 9); // glided 0.5 ms toward 6.52
  });

  it('glides toward a higher target by at most 0.5 ms per frame and snaps over 150 ms', () => {
    const a = fakeAudio(0);
    let now = 0;
    const c = new GameClock(a, () => now);
    a.currentTime = 1;
    c.sample(); // offset 1
    a.currentTime = 1.02; // target +20 ms
    c.sample();
    expect(c.offset).toBeCloseTo(1.0005, 9);
    now = 16;
    a.currentTime = 1.02 + 0.016;
    c.sample();
    expect(c.offset).toBeCloseTo(1.001, 9);
    a.currentTime = 10; // +9 s → snap
    c.sample();
    expect(c.offset).toBeCloseTo(10 - 0.016, 9);
  });

  it('freezes while the context is not running and re-snaps on resume', () => {
    const a = fakeAudio(0.01);
    let now = 0;
    const c = new GameClock(a, () => now);
    a.currentTime = 3;
    c.sample();
    a.state = 'suspended';
    c.sample();
    expect(c.offset).toBeNull();
    expect(c.heardAt(5000)).toBeCloseTo(2.99, 9); // frozen currentTime − latency
    a.state = 'running';
    now = 7000;
    a.currentTime = 3.5;
    c.sample();
    expect(c.offset).toBeCloseTo(3.49 - 7, 9);
  });

  it('accepts worklet status samples', () => {
    const a = fakeAudio(0.02);
    const c = new GameClock(a, () => 1000);
    a.currentTime = 4;
    c.sample(); // 3.98 − 1 = 2.98
    c.sampleFromWorklet(4.1); // exact block time: 4.08 − 1 = 3.08, higher → target rises
    expect(c.offset).toBeGreaterThan(2.98);
  });
});

describe('pacing', () => {
  const trace = (hz: number, lateFrac: number, n = 120): number[] => {
    const iv = 1 / hz;
    return Array.from({ length: n }, (_, i) =>
      i % Math.round(1 / lateFrac) === 0 && lateFrac > 0 ? iv * 2 : iv,
    );
  };
  it('decides per TIMING.md §7 case 4', () => {
    expect(decidePacing(trace(120, 0.1), false, 0).half).toBe(true);
    expect(decidePacing(trace(120, 0.02), false, 0).half).toBe(false);
    expect(decidePacing(trace(60, 0.15), false, 0).half).toBe(false);
    expect(decidePacing(trace(90, 0.12), false, 0).half).toBe(true);
  });
  it('controller is sticky and skips alternate refreshes in half mode', () => {
    const p = new PacingController();
    let t = 0;
    const ivs = trace(120, 0.1, 121);
    const skipped: boolean[] = [];
    for (const iv of ivs) {
      skipped.push(p.skipThisRefresh(t));
      t += iv * 1000;
    }
    expect(p.half).toBe(true);
    const after: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      after.push(p.skipThisRefresh(t));
      t += 1000 / 120;
    }
    expect(after.filter(Boolean)).toHaveLength(3);
    for (let i = 1; i < after.length; i++) expect(after[i]).toBe(!after[i - 1]);
    // A clean window afterwards does not switch back.
    for (let i = 0; i < 130; i++) {
      p.skipThisRefresh(t);
      t += 1000 / 120;
    }
    expect(p.half).toBe(true);
  });
});

describe('calibration', () => {
  it('ignores warm-up clicks and wild taps', () => {
    expect(tapDeviation(0.6 * 2)).toBeNull();
    expect(tapDeviation(0.6 * 4 + 0.03)).toBeCloseTo(0.03, 9);
    expect(tapDeviation(0.6 * 4 + 0.3)).toBeNull();
    expect(tapDeviation(0.6 * 24)).toBeNull();
  });
  it('trimmed mean and IQR/2 spread', () => {
    const e = estimateOffset([0.03, 0.031, 0.029, 0.5, -0.5, 0.03, 0.032, 0.028, 0.03, 0.03]);
    expect(e.offset).toBeCloseTo(0.03, 3);
    expect(e.spread).toBeLessThan(0.01);
    expect(estimateOffset([]).taps).toBe(0);
  });
});

describe('input mapping', () => {
  it('remappable keys with arrows always working', () => {
    const k = new KeyMap();
    expect(k.laneFor('KeyD')).toBe(0);
    expect(k.laneFor('KeyK')).toBe(3);
    expect(k.laneFor('ArrowUp')).toBe(2);
    expect(k.laneFor('KeyZ')).toBe(-1);
    k.set(0, 'KeyA');
    expect(k.laneFor('KeyA')).toBe(0);
    expect(k.laneFor('KeyD')).toBe(-1);
  });
  it('lane from x: touch uses full width, desktop the highway', () => {
    expect(laneFromX(10, { touch: true, width: 400, highwayLeft: 0, highwayWidth: 0 })).toBe(0);
    expect(laneFromX(399, { touch: true, width: 400, highwayLeft: 0, highwayWidth: 0 })).toBe(3);
    expect(laneFromX(250, { touch: false, width: 1000, highwayLeft: 200, highwayWidth: 400 })).toBe(
      0,
    );
    expect(laneFromX(550, { touch: false, width: 1000, highwayLeft: 200, highwayWidth: 400 })).toBe(
      3,
    );
    expect(laneFromX(-50, { touch: false, width: 1000, highwayLeft: 200, highwayWidth: 400 })).toBe(
      0,
    );
  });
  it('pointer ids release the lane they pressed', () => {
    const p = new PointerLanes();
    p.down(7, 2);
    p.down(9, 0);
    expect(p.active).toBe(2);
    expect(p.up(9)).toBe(0);
    expect(p.up(9)).toBe(-1);
    expect(p.up(7)).toBe(2);
  });
  it('gamepad emits transitions only', () => {
    const g = new GamepadLanes();
    const out: LaneEvent[] = [];
    const sink = (e: LaneEvent): void => {
      out.push(e);
    };
    const btn = (...on: number[]): boolean[] =>
      Array.from({ length: 16 }, (_, i) => on.includes(i));
    g.poll(btn(0), 10, sink); // A → lane 1
    g.poll(btn(0), 20, sink);
    g.poll(btn(), 30, sink);
    expect(out).toEqual([
      { lane: 1, down: true, perfMs: 10, source: 'gamepad' },
      { lane: 1, down: false, perfMs: 30, source: 'gamepad' },
    ]);
  });
});
