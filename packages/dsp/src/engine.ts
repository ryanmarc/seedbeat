import { Biquad } from './biquad';
import { FeedbackDelay } from './delay';
import { Compressor, Limiter } from './dynamics';
import { MOOD_MIX, type Mood, type Trigger } from './presets';
import { Reverb } from './reverb';
import { BLOCK_SIZE, TWO_PI, Xorshift } from './util';
import { Voice, type VoiceParams } from './voice';

export { BLOCK_SIZE };
export const VOICE_POOL = 64;
export const HIT_VOICE_RESERVE = 8;
/** Base output gain before the per-mood trim (the prototype's 0.85). */
const BASE_GAIN = 0.85;
/** Vinyl crackle level in the mono mix (the prototype used 0.6; lowered after playtest, 2026-10-13). */
const CRACKLE_MIX = 0.35;

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
  // Master chain scratch. The reverb output is Float32 because the per-sample chain rounded it
  // through a Float32Array; the rest stays double, as the locals were.
  private readonly rvL = new Float32Array(BLOCK_SIZE);
  private readonly rvR = new Float32Array(BLOCK_SIZE);
  private readonly wet = new Float64Array(BLOCK_SIZE);
  private readonly crk = new Float64Array(BLOCK_SIZE);
  private readonly bufL = new Float64Array(BLOCK_SIZE);
  private readonly bufR = new Float64Array(BLOCK_SIZE);
  private readonly gBuf = new Float64Array(BLOCK_SIZE);
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
  /** Ambience (vinyl crackle) only while the sequencer is playing: not after stop, not while paused. */
  private transport = false;
  private lfoPhase = 0;
  /** Crackle click state [amp, samplesLeft]; typed-array slots because they change per sample. */
  private readonly click = new Float64Array(2);
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
    this.click[0] = 0;
    this.click[1] = 0;
  }

  /** The sequencer tells the engine when music is running, so ambience starts and stops with it. */
  setTransport(playing: boolean): void {
    this.transport = playing;
  }

  /** Current mood. */
  get currentMood(): Mood {
    return this.mood;
  }

  /** Silence all voices immediately (stop). */
  allNotesOff(): void {
    const vs = this.voices;
    for (let i = 0; i < vs.length; i++) vs[i]!.kill();
  }

  /** Release all music voices (pause): tails ring out, nothing new starts. */
  releaseAll(): void {
    const vs = this.voices;
    for (let i = 0; i < vs.length; i++) vs[i]!.release();
  }

  private allocate(reserved: boolean): Voice {
    let best: Voice | null = null;
    let bestScore = Infinity;
    const vs = this.voices;
    // Index loops: a for-of iterator is an allocation on the audio thread.
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i]!;
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
    for (let i = 0; i < triggers.length; i++) {
      const t = triggers[i]!;
      this.trigger(t.params, eventFrame + Math.round(t.offset * this.sampleRate), reserved);
    }
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
    const vs = this.voices;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i]!;
      if (!v.active) continue;
      if (v.reserved) v.render(hit, this.scratchSend, this.scratchSend, blockStart, nFrames, 0);
      else v.render(dry, ds, rs, blockStart, nFrames, wobCents);
      if (v.active) active++;
    }
    this.stats.voices = active;
    if (active > this.stats.peakVoices) this.stats.peakVoices = active;

    const n = nFrames;
    const wet = this.wet;
    const crk = this.crk;
    const rvL = this.rvL;
    const rvR = this.rvR;
    const bufL = this.bufL;
    const bufR = this.bufR;
    const gBuf = this.gBuf;
    this.delay.processBlock(ds, wet, n);
    const crackle = this.crackle && this.transport;
    if (crackle) this.crackleBlock(crk, n);
    this.reverb.processBlock(rs, rvL, rvR, n);
    const delayWet = this.delayWet;
    const reverbWet = this.reverbWet;
    for (let i = 0; i < n; i++) {
      let mono = dry[i]! + wet[i]! * delayWet;
      if (crackle) mono += crk[i]! * CRACKLE_MIX;
      bufL[i] = mono + rvL[i]! * reverbWet;
      bufR[i] = mono + rvR[i]! * reverbWet;
    }
    this.toneL.processBlock(bufL, 0, n);
    this.dcL.processBlock(bufL, 0, n);
    this.toneR.processBlock(bufR, 0, n);
    this.dcR.processBlock(bufR, 0, n);
    this.comp.gainBlock(bufL, bufR, gBuf, n);
    const tm = this.trim;
    const music = this.musicGain;
    const hitG = this.hitGain;
    for (let i = 0; i < n; i++) {
      const g = gBuf[i]! * tm * music;
      bufL[i] = bufL[i]! * g + hit[i]! * hitG;
      bufR[i] = bufR[i]! * g + hit[i]! * hitG;
    }
    this.limiter.processBlock(bufL, bufR, outL, outR, n, this.masterGain);
  }

  /** Vinyl crackle: low hiss plus sparse decaying clicks (prototype CRACKLE buffer). */
  private crackleBlock(out: Float64Array, n: number): void {
    const c = this.click;
    const st = this.crackleRng.state;
    let s = st[0]!;
    let amp = c[0]!;
    let left = c[1]!;
    for (let i = 0; i < n; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      let v = ((s / 4294967296) * 2 - 1) * 0.006;
      if (left > 0) {
        v += amp;
        amp *= 0.6;
        left--;
      } else {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        s >>>= 0;
        if (((s / 4294967296) * 2 - 1 + 1) * 0.5 < 0.00035) {
          s ^= s << 13;
          s ^= s >>> 17;
          s ^= s << 5;
          s >>>= 0;
          const sign = (s / 4294967296) * 2 - 1 < 0 ? -1 : 1;
          s ^= s << 13;
          s ^= s >>> 17;
          s ^= s << 5;
          s >>>= 0;
          amp = sign * (0.15 + ((s / 4294967296) * 2 - 1 + 1) * 0.5 * 0.4);
          left = 12;
        }
      }
      out[i] = v;
    }
    st[0] = s;
    c[0] = amp;
    c[1] = left;
  }
}
