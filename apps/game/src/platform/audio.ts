/**
 * Main-thread wrapper for the Seedbeat AudioWorklet. Never import the worklet entry module here:
 * it only runs in the AudioWorkletGlobalScope. The virtual module below is just its URL
 * (see vite-plugin-worklet.ts). Creates the context from a user gesture,
 * loads the processor module, and exposes the protocol as methods. The main thread never
 * creates audio nodes during play; everything musical happens in the worklet.
 */
import {
  PROCESSOR_NAME,
  type MainToWorklet,
  type StatusMessage,
  type WorkletToMain,
} from '@seedbeat/worklet/protocol';
import workletUrl from 'virtual:seedbeat-worklet-url';

export type AudioEngineEvents = {
  status: (s: StatusMessage) => void;
  ended: () => void;
  error: (message: string) => void;
};

export class AudioEngine {
  readonly ctx: AudioContext;
  private node: AudioWorkletNode | null = null;
  private readonly listeners: { [K in keyof AudioEngineEvents]: Set<AudioEngineEvents[K]> } = {
    status: new Set(),
    ended: new Set(),
    error: new Set(),
  };
  /** Limiter lookahead reported by the worklet, in seconds. */
  latencySec = 0;

  private constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  /** Call from a user gesture. Resolves when the worklet is loaded and has said hello. */
  static async create(): Promise<AudioEngine> {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    if (ctx.state === 'suspended') await ctx.resume();
    await ctx.audioWorklet.addModule(workletUrl);
    const engine = new AudioEngine(ctx);
    const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, { outputChannelCount: [2] });
    engine.node = node;
    node.connect(ctx.destination);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('AudioWorklet did not respond')), 5000);
      node.port.onmessage = (e: MessageEvent<WorkletToMain>) => {
        const m = e.data;
        if (m.type === 'ready') {
          clearTimeout(timer);
          engine.latencySec = m.latencyFrames / ctx.sampleRate;
          node.port.onmessage = (ev: MessageEvent<WorkletToMain>) => engine.dispatch(ev.data);
          resolve();
        }
      };
    });
    return engine;
  }

  on<K extends keyof AudioEngineEvents>(event: K, fn: AudioEngineEvents[K]): () => void {
    this.listeners[event].add(fn);
    return () => this.listeners[event].delete(fn);
  }

  private dispatch(m: WorkletToMain): void {
    switch (m.type) {
      case 'status':
        for (const fn of this.listeners.status) fn(m);
        break;
      case 'ended':
        for (const fn of this.listeners.ended) fn();
        break;
      case 'error':
        for (const fn of this.listeners.error) fn(m.message);
        break;
      case 'ready':
        break;
    }
  }

  send(msg: MainToWorklet): void {
    this.node?.port.postMessage(msg);
  }

  /** Output latency in seconds as reported by the browser (0 where unsupported). */
  get outputLatency(): number {
    const c = this.ctx as AudioContext & { outputLatency?: number };
    return c.outputLatency || c.baseLatency || 0;
  }

  async close(): Promise<void> {
    this.send({ type: 'stop' });
    this.node?.disconnect();
    await this.ctx.close();
  }
}
