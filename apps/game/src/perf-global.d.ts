/** Hooks the play page exposes for the perf harness and e2e tests. */
interface SeedbeatPerfHooks {
  summary(): {
    frames: number;
    fps: number;
    late: number;
    p50Ms: number;
    p95Ms: number;
    workP95Ms: number;
    refreshHz: number;
    skipped: number;
  };
  reset(): void;
  session(): { score: number; combo: number; judged: number; ended: boolean };
  /** Latest worklet stats (zeros without audio). */
  audio(): {
    voices: number;
    peakVoices: number;
    steals: number;
    periodMs: number;
    maxGapMs: number;
    stalls: number;
    lastStallMs: number;
    maxBusyMs: number;
    lastStallAt: string;
  };
  ready: boolean;
}
interface Window {
  __seedbeatPerf?: SeedbeatPerfHooks;
}
