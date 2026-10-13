/**
 * Seedbeat AudioWorkletProcessor. Registered as PROCESSOR_NAME. All music is sequenced and
 * synthesized here on the audio thread; the main thread only sends control messages.
 */
import { isGeneratorVersion } from '@seedbeat/core';
import { BLOCK_SIZE, Engine } from '@seedbeat/dsp';
import {
  PROCESSOR_NAME,
  PROTOCOL_VERSION,
  STATUS_INTERVAL_SEC,
  type MainToWorklet,
  type WorkletToMain,
} from './protocol';
import { Sequencer } from './sequencer';
import { StallMeter } from './stall-meter';
import { warmUp } from './warmup';

class SeedbeatProcessor extends AudioWorkletProcessor {
  private readonly engine = new Engine(sampleRate);
  private readonly seq = new Sequencer(this.engine, sampleRate);
  private readonly statusEvery = Math.max(
    1,
    Math.round((STATUS_INTERVAL_SEC * sampleRate) / BLOCK_SIZE),
  );
  private blocks = 0;
  private readonly stall = new StallMeter();
  private uiGain = 1;
  private endedSent = false;
  private readonly silentL = new Float32Array(BLOCK_SIZE);
  private readonly silentR = new Float32Array(BLOCK_SIZE);

  constructor() {
    super();
    warmUp(this.engine);
    this.port.onmessage = (e: MessageEvent<MainToWorklet>) => {
      try {
        this.onMessage(e.data);
      } catch (err) {
        this.post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    };
    this.post({
      type: 'ready',
      protocolVersion: PROTOCOL_VERSION,
      latencyFrames: this.engine.latencySamples,
    });
  }

  private post(msg: WorkletToMain): void {
    this.port.postMessage(msg);
  }

  private onMessage(msg: MainToWorklet): void {
    switch (msg.type) {
      case 'start': {
        if (!isGeneratorVersion(msg.generatorVersion)) {
          this.post({
            type: 'error',
            message: `Unknown generator version ${msg.generatorVersion}`,
          });
          return;
        }
        const startFrame = Math.round(msg.startTime * sampleRate);
        this.seq.start({
          seed: msg.seed,
          mood: msg.mood,
          mode: msg.mode,
          startFrame,
          ...(msg.rate !== undefined ? { rate: msg.rate } : {}),
          ...(msg.countIn !== undefined ? { countIn: msg.countIn } : {}),
          ...(msg.fromBar !== undefined ? { fromBar: msg.fromBar } : {}),
          ...(msg.toBar !== undefined ? { toBar: msg.toBar } : {}),
          ...(msg.loop !== undefined ? { loop: msg.loop } : {}),
        });
        this.endedSent = false;
        this.stall.reset();
        break;
      }
      case 'pause':
        this.seq.pause(currentFrame);
        break;
      case 'period':
        this.stall.setPeriod(msg.ms);
        break;
      case 'resume':
        this.seq.resume(Math.round(msg.atTime * sampleRate));
        this.stall.resume();
        break;
      case 'stop':
        this.seq.stop();
        break;
      case 'clicks':
        this.seq.clicks(
          Math.round(msg.startTime * sampleRate),
          msg.count,
          msg.interval * sampleRate,
        );
        break;
      case 'volumes':
        if (msg.master !== undefined) this.engine.masterGain = msg.master;
        if (msg.music !== undefined) this.engine.musicGain = msg.music;
        if (msg.hit !== undefined) this.engine.hitGain = msg.hit;
        if (msg.ui !== undefined) this.uiGain = msg.ui;
        break;
      case 'hitSound':
        this.seq.hitSound(msg.judgement, currentFrame);
        break;
      case 'ui':
        this.seq.uiSound(msg.sound, currentFrame, this.uiGain);
        break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const l = out?.[0] ?? this.silentL;
    const r = out?.[1] ?? l;
    const n = l.length;
    // Date is the only clock in this scope; 1 ms resolution is enough to see a missed buffer.
    // Count stalls only once the song is sounding: the stream start and the lead-in are irregular.
    const t0 = Date.now();
    this.stall.armed = this.seq.isPlaying && this.seq.songFrameAt(currentFrame) >= 0;
    this.stall.tick(t0);
    this.seq.process(l, r, n, currentFrame);
    this.stall.busy(Date.now() - t0);
    if (out && out.length > 2) for (let c = 2; c < out.length; c++) out[c]!.set(l);

    if (++this.blocks % this.statusEvery === 0) {
      this.post({
        type: 'status',
        frame: this.seq.songFrameAt(currentFrame),
        ctxTime: currentFrame / sampleRate,
        bar: this.seq.currentBar,
        step: this.seq.currentStep,
        playing: this.seq.isPlaying,
        voices: this.engine.stats.voices,
        peakVoices: this.engine.stats.peakVoices,
        steals: this.engine.stats.steals,
        ...this.stall.snapshot(),
      });
    }
    if (this.seq.hasEnded && !this.endedSent) {
      this.endedSent = true;
      this.post({ type: 'ended' });
    }
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, SeedbeatProcessor);
