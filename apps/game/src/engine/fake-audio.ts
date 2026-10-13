import type { AudioTimeSource } from './clock';

/**
 * An audio clock driven by performance.now(), for running the game without sound (perf harness,
 * screenshots, CI). Behaves like a perfectly regular AudioContext with zero latency.
 */
export class PerformanceAudioSource implements AudioTimeSource {
  state: 'suspended' | 'running' | 'closed' = 'running';
  readonly outputLatency = 0;
  constructor(private readonly now: () => number = () => performance.now()) {}
  get currentTime(): number {
    return this.now() / 1000;
  }
}
