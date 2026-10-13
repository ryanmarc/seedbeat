import { Biquad } from './biquad';
import { FeedbackDelay } from './delay';
import { Compressor, Limiter } from './dynamics';
import { MOOD_MIX, type Mood, type Trigger } from './presets';
import { Reverb } from './reverb';
import { TWO_PI, Xorshift } from './util';
import { Voice, type VoiceParams } from './voice';

export const BLOCK_SIZE = 128;
export const VOICE_POOL = 64;
export const HIT_VOICE_RESERVE = 8;
/** Base output gain before the per-mood trim (the prototype's 0.85). */
const BASE_GAIN = 0.85;

export interface EngineStats {
  /** Voices active at the end of the last block. */
  voices: number;
  /** Highest voice count seen since reset. */
  peakVoices: number;
  /** Triggers that had to steal a voice. */
  steals: number;
}

/**
 * The synth: a preallocated voice pool, delay and reverb sends, and the master chain
 * (tone lowpass → compressor → mood trim → limiter). No allocation in `render`.
 */
export class Engine {
  readonly sampleRate: number;
  private readonly voices: Voice[] = [];
  private readonly dry = new Float32Array(BLOCK_SIZE);
  private readonly delaySend = new Float32Array(BLOCK_SIZE);
  private readonly reverbSend = new Float32Array(BLOCK_SIZE);
  private readonly hitBuf = new Float32Array(BLOCK_SIZE);
  private readonly scratchSend = new Float32Array(BLOCK_SIZE);
  private readonly rvOut = new Float32Array(2);
  private readonly limOut = new Float32Array(2);
  private readonly delay: FeedbackDelay;
  private readonly reverb: Reverb;
  private readonly toneL = new Biquad();
  private readonly toneR = new Biquad();
  private readonly dcL = new Biquad();
  private readonly dcR = new Biquad();
  private readonly comp: Compressor;
  private readonly limiter: Limiter;
  private readonly crackleRng = new Xorshift(0xc0ffee);
  private mood: Mood = 'lofi';
  private trim = 1;
  private delayWet = 0.45;
  private reverbWet = 0.38;
  private crackle = false;
  private wobble = false;
  private lfoPhase = 0;
  private clickAmp = 0;
  private clickLeft = 0;
  private age = 0;
  musicGain = 1;
  hitGain = 1;
  masterGain = 1;
  readonly stats: EngineStats = { voices: 0, peakVoices: 0, steals: 0 };

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    for (let i = 0; i < VOICE_POOL; i++) {
      const v = new Voice(sampleRate, 0x1234567 + i * 7919);
      v.reserved = i >= VOICE_POOL - HIT_VOICE_RESERVE;
      this.voices.push(v);
    }
    this.delay = new FeedbackDelay(sampleRate, 2);
    this.reverb = new Reverb(sampleRate);
    this.comp = new Compressor(sampleRate, {
      threshold: -18,
      knee: 8,
      ratio: 3.5,
      attack: 0.004,
      release: 0.18,
    });
    this.limiter = new Limiter(sampleRate, -1.5, 0.0015, 0.08);
  }

  /** Samples of latency introduced by the limiter lookahead. */
  get latencySamples(): number {
    return this.limiter.latencySamples;
  }

  /** Configure for a mood and a step duration (delay time = 3 steps). Resets effect state. */
  configure(mood: Mood, stepSec: number): void {
    const mix = MOOD_MIX[mood];
    this.mood = mood;
    this.trim = BASE_GAIN * mix.trim;
    this.delayWet = mix.delayWet;
    this.reverbWet = mix.reverbWet;
    this.crackle = mix.crackle;
    this.wobble = mix.wobble;
    this.delay.configure(Math.min(1.9, stepSec * 3), mix.delayFeedback, mix.delayLowpassHz);
    this.delay.reset();
    this.reverb.reset();
    this.toneL.set('lowpass', mix.toneLowpassHz, this.sampleRate, -3);
    this.toneR.set('lowpass', mix.toneLowpassHz, this.sampleRate, -3);
    this.toneL.reset();
    this.toneR.reset();
    // DC blocker: kicks and one-sided envelopes leave a few mdB of offset otherwise.
    this.dcL.set('highpass', 8, this.sampleRate, 0);
    this.dcR.set('highpass', 8, this.sampleRate, 0);
    this.dcL.reset();
    this.dcR.reset();
    this.comp.reset();
    this.limiter.reset();
    this.lfoPhase = 0;
    this.clickAmp = 0;
    this.clickLeft = 0;
  }

  /** Current mood. */
  get currentMood(): Mood {
    return this.mood;
  }

  /** Silence all voices immediately (stop). */
  allNotesOff(): void {
    for (const v of this.voices) v.kill();
  }

  /** Release all music voices (pause): tails ring out, nothing new starts. */
  releaseAll(): void {
    for (const v of this.voices) v.release();
  }

  private allocate(reserved: boolean): Voice {
    let best: Voice | null = null;
    let bestScore = Infinity;
    for (const v of this.voices) {
      if (v.reserved !== reserved) continue;
      if (!v.active) return v;
      // Prefer releasing voices, then the quietest, then the oldest.
      const score = (v.releasing ? 0 : 1000) + v.level * 100 + (v.age / (this.age + 1)) * 10;
      if (score < bestScore) {
        bestScore = score;
        best = v;
      }
    }
    this.stats.steals++;
    return best!;
  }

  /** Start a voice at an absolute frame (may be inside or after the next block). */
  trigger(params: VoiceParams, startFrame: number, reserved = false): void {
    const v = this.allocate(reserved);
    v.trigger(params, startFrame, this.age++);
  }

  triggerAll(triggers: readonly Trigger[], eventFrame: number, reserved = false): void {
    for (const t of triggers)
      this.trigger(t.params, eventFrame + Math.round(t.offset * this.sampleRate), reserved);
  }

  /** Render one block of up to BLOCK_SIZE frames starting at absolute frame `blockStart`. */
  render(outL: Float32Array, outR: Float32Array, nFrames: number, blockStart: number): void {
    const dry = this.dry;
    const ds = this.delaySend;
    const rs = this.reverbSend;
    const hit = this.hitBuf;
    dry.fill(0, 0, nFrames);
    ds.fill(0, 0, nFrames);
    rs.fill(0, 0, nFrames);
    hit.fill(0, 0, nFrames);
    this.scratchSend.fill(0, 0, nFrames);

    // Lo-fi tape wobble: 0.55 Hz, ±7 cents (prototype LFO gain 7 into detune).
    const wobCents = this.wobble ? 7 * Math.sin(this.lfoPhase) : 0;
    if (this.wobble) {
      this.lfoPhase += (TWO_PI * 0.55 * nFrames) / this.sampleRate;
      if (this.lfoPhase > TWO_PI) this.lfoPhase -= TWO_PI;
    }

    let active = 0;
    for (const v of this.voices) {
      if (!v.active) continue;
      if (v.reserved) v.render(hit, this.scratchSend, this.scratchSend, blockStart, nFrames, 0);
      else v.render(dry, ds, rs, blockStart, nFrames, wobCents);
      if (v.active) active++;
    }
    this.stats.voices = active;
    if (active > this.stats.peakVoices) this.stats.peakVoices = active;

    const rv = this.rvOut;
    const lim = this.limOut;
    const music = this.musicGain;
    const hitG = this.hitGain;
    const master = this.masterGain;
    for (let i = 0; i < nFrames; i++) {
      let mono = dry[i]! + this.delay.process(ds[i]!) * this.delayWet;
      if (this.crackle) mono += this.nextCrackle() * 0.6;
      this.reverb.process(rs[i]!, rv);
      let l = this.dcL.process(this.toneL.process(mono + rv[0]! * this.reverbWet));
      let r = this.dcR.process(this.toneR.process(mono + rv[1]! * this.reverbWet));
      const g = this.comp.gain(Math.max(Math.abs(l), Math.abs(r))) * this.trim * music;
      l = l * g + hit[i]! * hitG;
      r = r * g + hit[i]! * hitG;
      this.limiter.process(l, r, lim);
      outL[i] = lim[0]! * master;
      outR[i] = lim[1]! * master;
    }
  }

  /** Vinyl crackle: low hiss plus sparse decaying clicks (prototype CRACKLE buffer). */
  private nextCrackle(): number {
    let v = this.crackleRng.next() * 0.006;
    if (this.clickLeft > 0) {
      v += this.clickAmp;
      this.clickAmp *= 0.6;
      this.clickLeft--;
    } else if ((this.crackleRng.next() + 1) * 0.5 < 0.00035) {
      const sign = this.crackleRng.next() < 0 ? -1 : 1;
      this.clickAmp = sign * (0.15 + (this.crackleRng.next() + 1) * 0.5 * 0.4);
      this.clickLeft = 12;
    }
    return v;
  }
}
