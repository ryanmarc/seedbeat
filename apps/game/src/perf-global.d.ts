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
  ready: boolean;
}
interface Window {
  __seedbeatPerf?: SeedbeatPerfHooks;
}
