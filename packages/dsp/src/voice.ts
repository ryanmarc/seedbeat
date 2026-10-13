import { Biquad, type BiquadType } from './biquad';
import { AdsrEnv, ExpEnv, ExpRamp } from './env';
import { Oscillator, type Wave } from './osc';
import { Xorshift } from './util';

/** Tone voice: the prototype's `vTone` options. Times in seconds, `vol` is peak gain. */
export interface ToneParams {
  kind: 'tone';
  wave: Wave;
  freq: number;
  /** Note length in seconds (release starts at max(dur, a)). */
  dur: number;
  /** Detune in cents per oscillator; one oscillator at 0 if omitted. */
  det?: readonly number[];
  vol: number;
  a?: number;
  d?: number;
  s?: number;
  r?: number;
  /** Lowpass cutoff; omitted = no filter. */
  cut?: number;
  /** Filter resonance (Web Audio dB convention). */
  q?: number;
  /** Filter envelope: start at cut+fenv, exponential ramp to cut over fdec. */
  fenv?: number;
  fdec?: number;
  /** Apply the mood wobble LFO (lo-fi tape). */
  wob?: boolean;
  send?: number;
  rev?: number;
}

/** Noise voice: the prototype's `vNoise` options. */
export interface NoiseParams {
  kind: 'noise';
  type?: BiquadType;
  f: number;
  q?: number;
  dur: number;
  vol: number;
  a?: number;
  send?: number;
  rev?: number;
  /** Riser: sweep the filter frequency exponentially to this value over `dur`. */
  sweepTo?: number;
}

/** Kick voice: pitch sweep with an exponential amplitude envelope. */
export interface KickParams {
  kind: 'kick';
  wave: 'sine' | 'square';
  f0: number;
  f1: number;
  sweep: number;
  dur: number;
  vol: number;
}

export type VoiceParams = ToneParams | NoiseParams | KickParams;

const MAX_OSC = 3;
const SUB = 32;

/**
 * One generic voice. Preallocated; `trigger` resets state without allocating. Renders additively
 * into mono dry/delay/reverb send buffers from a sample offset.
 */
export class Voice {
  private readonly osc = [new Oscillator(), new Oscillator(), new Oscillator()];
  private readonly filter = new Biquad();
  private readonly adsr = new AdsrEnv();
  private readonly exp = new ExpEnv();
  private readonly fRamp = new ExpRamp();
  private readonly pRamp = new ExpRamp();
  private readonly rng: Xorshift;
  private params: VoiceParams | null = null;
  private nOsc = 1;
  private useFilter = false;
  private fEnvActive = false;
  private baseFreq = 0;
  private det = [0, 0, 0];
  private gain = 0;
  private send = 0;
  private rev = 0;
  private wob = false;
  private sub = 0;
  private filterType: BiquadType = 'lowpass';
  private filterQ = 0;
  private cut = 0;
  /** Absolute frame at which the voice starts; samples before it are skipped. */
  startFrame = 0;
  /** Monotonic trigger order, for stealing. */
  age = 0;
  /** True while the voice is a sound source for hit feedback (never stolen by music). */
  reserved = false;

  constructor(
    private readonly sampleRate: number,
    seed: number,
  ) {
    this.rng = new Xorshift(seed);
  }

  get active(): boolean {
    return this.params !== null;
  }

  get releasing(): boolean {
    return this.params !== null && this.params.kind === 'tone' && !this.adsr.active;
  }

  /** Current envelope level estimate, for the stealing heuristic. */
  get level(): number {
    return this.gain;
  }

  trigger(p: VoiceParams, startFrame: number, age: number): void {
    const sr = this.sampleRate;
    this.params = p;
    this.startFrame = startFrame;
    this.age = age;
    this.sub = 0;
    this.filter.reset();
    this.fEnvActive = false;
    this.useFilter = false;
    this.wob = false;
    this.gain = 0;
    this.send = p.kind === 'kick' ? 0 : (p.send ?? 0);
    this.rev = p.kind === 'kick' ? 0 : (p.rev ?? 0);
    switch (p.kind) {
      case 'tone': {
        const det = p.det ?? [0];
        this.nOsc = Math.min(MAX_OSC, det.length);
        for (let i = 0; i < this.nOsc; i++) {
          this.det[i] = det[i]!;
          this.osc[i]!.reset(p.wave);
        }
        this.baseFreq = p.freq;
        this.wob = p.wob === true;
        this.applyFrequencies(0);
        const vol = p.vol / Math.sqrt(det.length);
        const a = p.a ?? 0.005;
        this.adsr.trigger(vol, a, p.d ?? 0.1, p.s ?? 0.7, p.r ?? 0.08, p.dur, sr);
        if (p.cut !== undefined) {
          this.useFilter = true;
          this.filterType = 'lowpass';
          this.filterQ = p.q ?? 0.7;
          this.cut = p.cut;
          if (p.fenv !== undefined) {
            this.fEnvActive = true;
            this.fRamp.set(p.cut + p.fenv, Math.max(60, p.cut), p.fdec ?? 0.2, sr);
            this.filter.set('lowpass', p.cut + p.fenv, sr, this.filterQ);
          } else {
            this.filter.set('lowpass', p.cut, sr, this.filterQ);
          }
        }
        break;
      }
      case 'noise': {
        this.useFilter = true;
        this.filterType = p.type ?? 'highpass';
        this.filterQ = p.q ?? 0.7;
        this.cut = p.f;
        this.filter.set(this.filterType, p.f, sr, this.filterQ);
        if (p.sweepTo !== undefined) {
          this.fEnvActive = true;
          this.fRamp.set(p.f, p.sweepTo, p.dur, sr);
        }
        this.exp.trigger(p.vol, p.a ?? 0.001, p.dur, sr);
        break;
      }
      case 'kick': {
        this.nOsc = 1;
        this.osc[0]!.reset(p.wave);
        this.pRamp.set(p.f0, p.f1, p.sweep, sr);
        this.osc[0]!.setFrequency(p.f0, sr);
        this.exp.trigger(p.vol, 0.004, p.dur, sr);
        break;
      }
    }
  }

  /** Begin release early (stop, steal). Noise and kick voices are cut after a short fade. */
  release(): void {
    if (!this.params) return;
    if (this.params.kind === 'tone') this.adsr.release();
    else this.params = null;
  }

  kill(): void {
    this.params = null;
  }

  private applyFrequencies(wobCents: number): void {
    const sr = this.sampleRate;
    const w = this.wob ? wobCents : 0;
    for (let i = 0; i < this.nOsc; i++) {
      this.osc[i]!.setFrequency(this.baseFreq * Math.pow(2, (this.det[i]! + w) / 1200), sr);
    }
  }

  /**
   * Render frames [from, to) of the block whose first frame is `blockStart`, adding into the
   * buffers. `wobCents` is the mood LFO value for this block.
   */
  render(
    dry: Float32Array,
    delaySend: Float32Array,
    reverbSend: Float32Array,
    blockStart: number,
    nFrames: number,
    wobCents: number,
  ): void {
    const p = this.params;
    if (!p) return;
    const first = Math.max(0, this.startFrame - blockStart);
    if (first >= nFrames) return;
    const inv = 1 / Math.sqrt(this.nOsc);
    for (let i = first; i < nFrames; i++) {
      // Sub-block parameter updates (filter envelope, wobble).
      if (this.sub === 0) {
        if (this.wob) this.applyFrequencies(wobCents);
        if (this.fEnvActive) {
          let f = this.fRamp.next();
          for (let k = 1; k < SUB; k++) f = this.fRamp.next();
          this.filter.set(this.filterType, f, this.sampleRate, this.filterQ);
        }
      }
      this.sub = (this.sub + 1) % SUB;

      let x: number;
      let env: number;
      switch (p.kind) {
        case 'tone': {
          x = 0;
          for (let k = 0; k < this.nOsc; k++) x += this.osc[k]!.next();
          x *= inv;
          env = this.adsr.next();
          if (!this.adsr.active) {
            this.params = null;
            this.gain = 0;
            return;
          }
          break;
        }
        case 'noise':
          x = this.rng.next();
          env = this.exp.next();
          if (!this.exp.active) {
            this.params = null;
            this.gain = 0;
            return;
          }
          break;
        case 'kick': {
          this.osc[0]!.setFrequency(this.pRamp.next(), this.sampleRate);
          x = this.osc[0]!.next();
          env = this.exp.next();
          if (!this.exp.active) {
            this.params = null;
            this.gain = 0;
            return;
          }
          break;
        }
      }
      if (this.useFilter) x = this.filter.process(x);
      const y = x * env;
      this.gain = env;
      dry[i]! += y;
      if (this.send) delaySend[i]! += y * this.send;
      if (this.rev) reverbSend[i]! += y * this.rev;
    }
  }
}
