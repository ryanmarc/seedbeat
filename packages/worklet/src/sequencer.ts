import { getBar, makeSong, stepTime, type MoodId, type Mode, type Song } from '@seedbeat/core';
import {
  Engine,
  countInTrigger,
  eventTriggers,
  hitSoundTriggers,
  type Judgement,
  type Trigger,
} from '@seedbeat/dsp';

export interface StartOptions {
  seed: string;
  mood: MoodId;
  mode: Mode;
  /** Absolute frame of bar 0's downbeat. */
  startFrame: number;
  rate?: number;
  countIn?: boolean;
  fromBar?: number;
  toBar?: number;
}

/** Bars kept in the song's memo cache behind the playhead (prototype: 4). */
const KEEP_BARS = 4;

/**
 * Sample-accurate sequencer. Walks bars and steps of a core Song, converting step times to
 * absolute frames and triggering voices on the Engine. Plain TypeScript: used by the
 * AudioWorkletProcessor and by the offline Node renderer alike.
 */
export class Sequencer {
  private song: Song | null = null;
  private startFrame = 0;
  private rate = 1;
  private bar = 0;
  private step = 0;
  private toBar = Infinity;
  private playing = false;
  private pausedAtFrame = 0;
  private ended = false;
  private readonly pre: { frame: number; trigger: Trigger }[] = [];
  private readonly scratch: Trigger[] = [];

  constructor(
    readonly engine: Engine,
    readonly sampleRate: number,
  ) {}

  get isPlaying(): boolean {
    return this.playing;
  }

  get hasEnded(): boolean {
    return this.ended;
  }

  get currentBar(): number {
    return this.bar;
  }

  get currentStep(): number {
    return this.step;
  }

  get currentSong(): Song | null {
    return this.song;
  }

  /** Song time in seconds of an absolute frame (0 = bar 0 downbeat), at the playback rate. */
  songTimeAt(frame: number): number {
    return this.songFrameAt(frame) / this.sampleRate;
  }

  /** Song position in frames (song-time × sampleRate) at an absolute frame. Frozen while paused. */
  songFrameAt(frame: number): number {
    const f = this.playing ? frame : this.pausedAtFrame;
    return Math.round((f - this.startFrame) * this.rate);
  }

  start(o: StartOptions): void {
    const song = makeSong(o.seed, o.mood, o.mode);
    this.song = song;
    this.rate = o.rate ?? 1;
    this.startFrame = o.startFrame;
    this.bar = o.fromBar ?? 0;
    this.step = 0;
    this.toBar = Math.min(o.toBar ?? Infinity, song.total ?? Infinity);
    this.playing = true;
    this.ended = false;
    this.pre.length = 0;
    this.engine.configure(o.mood, song.sd / this.rate);
    if (o.countIn) {
      for (let i = 0; i < 4; i++) {
        const t = -((4 - i) * song.sd * 4) / this.rate;
        this.pre.push({ frame: this.frameOf(t), trigger: countInTrigger(i === 0 ? 1 : 0.7) });
      }
    }
  }

  pause(nowFrame: number): void {
    if (!this.playing) return;
    this.playing = false;
    this.pausedAtFrame = nowFrame;
    this.engine.releaseAll();
  }

  /** Continue so that the song position frozen at pause lands on `atFrame`. */
  resume(atFrame: number): void {
    if (this.playing || !this.song) return;
    this.startFrame += atFrame - this.pausedAtFrame;
    this.playing = true;
  }

  stop(): void {
    this.playing = false;
    this.song = null;
    this.pre.length = 0;
    this.engine.allNotesOff();
  }

  /** Calibration clicks: a short square blip every `intervalFrames`, accented every fourth. */
  clicks(startFrame: number, count: number, intervalFrames: number): void {
    this.stop();
    this.engine.configure('chiptune', 0.15);
    for (let i = 0; i < count; i++) {
      this.pre.push({
        frame: startFrame + Math.round(i * intervalFrames),
        trigger: {
          offset: 0,
          params: {
            kind: 'tone',
            wave: 'square',
            freq: i % 4 === 0 ? 1760 : 1320,
            dur: 0.03,
            vol: 0.12,
            a: 0.001,
            d: 0.03,
            s: 0,
            r: 0.02,
          },
        },
      });
    }
    this.playing = true;
  }

  hitSound(j: Judgement, atFrame: number): void {
    this.scratch.length = 0;
    hitSoundTriggers(j, this.scratch);
    this.engine.triggerAll(this.scratch, atFrame, true);
  }

  private frameOf(songTime: number): number {
    return this.startFrame + Math.round((songTime / this.rate) * this.sampleRate);
  }

  /**
   * Schedule every event whose frame falls in [blockStart, blockStart + nFrames), then render
   * the block. Triggers for later frames are never created, so pool occupancy stays minimal.
   */
  process(outL: Float32Array, outR: Float32Array, nFrames: number, blockStart: number): void {
    const s = this.song;
    const end = blockStart + nFrames;
    if (this.playing) {
      // Count-in and calibration clicks.
      for (let i = this.pre.length - 1; i >= 0; i--) {
        const p = this.pre[i]!;
        if (p.frame < end) {
          if (p.frame >= blockStart) this.engine.trigger(p.trigger.params, p.frame);
          this.pre.splice(i, 1);
        }
      }
    }
    if (s && this.playing) {
      for (;;) {
        if (this.bar >= this.toBar) {
          if (!this.ended) this.ended = true;
          break;
        }
        const t = stepTime(s, this.bar, this.step);
        const frame = this.frameOf(t);
        if (frame >= end) break;
        if (frame >= blockStart) {
          const b = getBar(s, this.bar);
          const sd = s.sd / this.rate;
          for (const e of b.byStep[this.step]!) {
            this.scratch.length = 0;
            eventTriggers(s.mood, e, sd, this.scratch);
            this.engine.triggerAll(this.scratch, frame);
          }
        }
        if (++this.step >= 16) {
          this.step = 0;
          this.bar++;
          s.bars.delete(this.bar - KEEP_BARS);
        }
      }
    }
    this.engine.render(outL, outR, nFrames, blockStart);
  }
}
