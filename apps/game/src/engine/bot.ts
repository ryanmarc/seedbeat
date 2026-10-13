import type { ChartNote } from '@seedbeat/core';
import type { LaneEvent } from './input';

/**
 * Autoplay bot for the perf harness and e2e tests. Emits lane events at note times with a small
 * deterministic offset so judgements vary, releasing holds at the tail. Pure: `due` returns the
 * events whose time has come, in order, without allocating per call after construction.
 */
export class AutoplayBot {
  private readonly events: { t: number; lane: number; down: boolean }[] = [];
  private next = 0;
  private readonly out: LaneEvent = { lane: 0, down: true, perfMs: 0, source: 'key' };

  constructor(notes: readonly ChartNote[], seed = 1) {
    let r = seed >>> 0 || 1;
    const rnd = (): number => {
      r = (r * 1664525 + 1013904223) >>> 0;
      return r / 4294967296;
    };
    for (const n of notes) {
      const err = (rnd() - 0.5) * 0.06; // ±30 ms: mostly Perfect, some Great
      const down = n.t + err;
      this.events.push({ t: down, lane: n.lane, down: true });
      this.events.push({
        t: n.end ? n.end + (rnd() - 0.5) * 0.04 : down + 0.06,
        lane: n.lane,
        down: false,
      });
    }
    this.events.sort((a, b) => a.t - b.t);
  }

  /** Endless: add notes generated later (they are later than everything queued). */
  append(notes: readonly ChartNote[]): void {
    for (const n of notes) {
      const down = n.t + 0.01;
      this.events.push({ t: down, lane: n.lane, down: true });
      this.events.push({ t: n.end ? n.end : down + 0.06, lane: n.lane, down: false });
    }
  }

  /**
   * Deliver every event with song time ≤ `songTime`. `toPerfMs` maps song seconds to the
   * performance clock so the run judges them at their exact intended time.
   */
  drain(songTime: number, toPerfMs: (t: number) => number, sink: (e: LaneEvent) => void): void {
    while (this.next < this.events.length && this.events[this.next]!.t <= songTime) {
      const e = this.events[this.next++]!;
      this.out.lane = e.lane;
      this.out.down = e.down;
      this.out.perfMs = toPerfMs(e.t);
      sink(this.out);
    }
  }
}
