/**
 * Music transport: the AudioWorklet in real play, or a silent performance-clock stand-in for
 * harnesses and tests. Both expose the same clock so the game code never branches on audio.
 */
import type { MoodId, Mode } from '@seedbeat/core';
import type { Judgement, UiSound } from '@seedbeat/worklet/protocol';
import { GameClock, audioSourceFromContext } from '../engine/clock';
import { PerformanceAudioSource } from '../engine/fake-audio';
import { AudioEngine } from '../platform/audio';
import { watchAudio, type AudioHooks } from '../platform/lifecycle';

export interface StartOptions {
  seed: string;
  mood: MoodId;
  mode: Mode;
  /** Context time of bar 0. */
  startTime: number;
  countIn: boolean;
  fromBar?: number;
  toBar?: number;
  rate?: number;
  loop?: boolean;
}

export interface Transport {
  readonly kind: 'worklet' | 'silent';
  readonly clock: GameClock;
  /** Context time now, seconds. */
  now(): number;
  readonly outputLatency: number;
  start(o: StartOptions): void;
  pause(): void;
  resume(atTime: number): void;
  stop(): void;
  clicks(startTime: number, count: number, interval: number): void;
  hitSound(j: Judgement): void;
  ui(sound: UiSound): void;
  setVolumes(v: { master?: number; music?: number; hit?: number; ui?: number }): void;
  onEnded(fn: () => void): () => void;
  /** Audio-context state changes (interruptions). No-op without audio. */
  watchState(hooks: AudioHooks): () => void;
  /** Resume a suspended/interrupted context (call from a gesture). True when it is running. */
  ensureRunning(): Promise<boolean>;
}

export class WorkletTransport implements Transport {
  readonly kind = 'worklet' as const;
  readonly clock: GameClock;
  private constructor(private readonly engine: AudioEngine) {
    this.clock = new GameClock(audioSourceFromContext(engine.ctx), () => performance.now());
    engine.on('status', (s) => this.clock.sampleFromWorklet(s.ctxTime));
  }
  static async create(): Promise<WorkletTransport> {
    return new WorkletTransport(await AudioEngine.create());
  }
  now(): number {
    return this.engine.ctx.currentTime;
  }
  get outputLatency(): number {
    return this.engine.outputLatency;
  }
  start(o: StartOptions): void {
    this.engine.send({
      type: 'start',
      seed: o.seed,
      mood: o.mood,
      mode: o.mode,
      generatorVersion: 1,
      startTime: o.startTime,
      countIn: o.countIn,
      ...(o.fromBar !== undefined ? { fromBar: o.fromBar } : {}),
      ...(o.toBar !== undefined ? { toBar: o.toBar } : {}),
      ...(o.rate !== undefined ? { rate: o.rate } : {}),
      ...(o.loop !== undefined ? { loop: o.loop } : {}),
    });
  }
  pause(): void {
    this.engine.send({ type: 'pause' });
    this.clock.reset();
  }
  resume(atTime: number): void {
    this.engine.send({ type: 'resume', atTime });
    this.clock.reset();
  }
  stop(): void {
    this.engine.send({ type: 'stop' });
  }
  clicks(startTime: number, count: number, interval: number): void {
    this.engine.send({ type: 'clicks', startTime, count, interval });
  }
  hitSound(j: Judgement): void {
    this.engine.send({ type: 'hitSound', judgement: j });
  }
  ui(sound: UiSound): void {
    this.engine.send({ type: 'ui', sound });
  }
  setVolumes(v: { master?: number; music?: number; hit?: number; ui?: number }): void {
    this.engine.send({ type: 'volumes', ...v });
  }
  onEnded(fn: () => void): () => void {
    return this.engine.on('ended', fn);
  }
  async resumeContext(): Promise<void> {
    if (this.engine.ctx.state !== 'running') await this.engine.ctx.resume();
  }
  watchState(hooks: AudioHooks): () => void {
    return watchAudio(this.engine.ctx, hooks);
  }
  async ensureRunning(): Promise<boolean> {
    const ctx = this.engine.ctx;
    if (ctx.state === 'closed') return false;
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch {
        /* iOS: resume outside a gesture is refused; the caller asks for a tap */
      }
    }
    return (ctx.state as string) === 'running';
  }
}

/** No sound: a perfectly regular clock. Pause/resume shift a virtual song start. */
export class SilentTransport implements Transport {
  readonly kind = 'silent' as const;
  readonly clock: GameClock;
  readonly outputLatency = 0;
  private readonly source = new PerformanceAudioSource();
  private readonly endedListeners = new Set<() => void>();
  constructor() {
    this.clock = new GameClock(this.source, () => performance.now());
  }
  now(): number {
    return this.source.currentTime;
  }
  start(): void {
    this.source.state = 'running';
  }
  pause(): void {
    this.clock.reset();
  }
  resume(): void {
    this.clock.reset();
  }
  stop(): void {}
  clicks(): void {}
  hitSound(): void {}
  ui(): void {}
  setVolumes(): void {}
  onEnded(fn: () => void): () => void {
    this.endedListeners.add(fn);
    return () => this.endedListeners.delete(fn);
  }
  watchState(): () => void {
    return () => {};
  }
  ensureRunning(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
