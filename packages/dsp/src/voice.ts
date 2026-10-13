import { Biquad, type BiquadType } from './biquad';
import { AdsrEnv, ExpEnv, ExpRamp } from './env';
import { Oscillator, type Wave } from './osc';
import { BLOCK_SIZE, Xorshift } from './util';

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
/** Default detune set; shared so a trigger does not allocate. */
const DET0: readonly number[] = [0];
const SUB = 32;

// Scratch for one voice at a time (voices render sequentially). Float64 so intermediate values
// keep double precision exactly as the per-sample chain did.
const X = new Float64Array(BLOCK_SIZE);
const ENV = new Float64Array(BLOCK_SIZE);
const HZ = new Float64Array(BLOCK_SIZE);

/**
 * One generic voice. Preallocated; `trigger` resets state without allocating. Renders additively
 * into mono dry/delay/reverb send buffers from a sample offset.
 *
 * Rendering is block-based: sources, envelope and filter each fill or process a scratch block in
 * their own loop, and the mix loop here combines them. The per-sample order of operations is the
 * one the original sample-by-sample chain used, so the output is bit-identical; the point is
 * that no fraction crosses a function boundary per sample (PERFORMANCE.md §3).
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
  /** Envelope level at the last rendered sample (stealing heuristic). */
  private readonly gain = new Float64Array(1);
  private send = 0;
  private rev = 0;
  private wob = false;
  /** Samples into the current 32-sample sub-block (filter envelope and wobble update rate). */
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
    return this.gain[0]!;
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
    this.gain[0] = 0;
    this.send = p.kind === 'kick' ? 0 : (p.send ?? 0);
    this.rev = p.kind === 'kick' ? 0 : (p.rev ?? 0);
    switch (p.kind) {
      case 'tone': {
        const det = p.det ?? DET0;
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
   * Render frames [first, nFrames) of the block whose first frame is `blockStart`, adding into the
   * buffers. `wobCents` is the mood LFO value for this block. Works in sub-blocks of SUB samples
   * aligned to the voice's own counter, because the filter envelope and wobble update there.
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
    const sr = this.sampleRate;
    const inv = 1 / Math.sqrt(this.nOsc);
    const x = X;
    const env = ENV;
    let i = first;
    while (i < nFrames) {
      if (this.sub === 0) {
        if (this.wob) this.applyFrequencies(wobCents);
        if (this.fEnvActive) {
          const f = this.fRamp.advance(SUB);
          this.filter.set(this.filterType, f, sr, this.filterQ);
        }
      }
      const seg = Math.min(SUB - this.sub, nFrames - i);
      const end = i + seg;
      // Envelope first: where it ends, the voice stops, and the sources only need to run that far.
      let valid: number;
      switch (p.kind) {
        case 'tone': {
          valid = this.adsr.render(env, i, end);
          this.osc[0]!.render(x, i, valid, false, null, sr);
          for (let k = 1; k < this.nOsc; k++) this.osc[k]!.render(x, i, valid, true, null, sr);
          for (let j = i; j < valid; j++) x[j] = x[j]! * inv;
          break;
        }
        case 'noise': {
          valid = this.exp.render(env, i, end);
          // The sample-by-sample chain drew the noise before it saw the envelope end, so the
          // generator advances one extra step when the voice ends inside this block.
          this.rng.fill(x, i, Math.min(end, valid + 1));
          break;
        }
        case 'kick': {
          valid = this.exp.render(env, i, end);
          this.pRamp.render(HZ, i, valid);
          this.osc[0]!.render(x, i, valid, false, HZ, sr);
          break;
        }
      }
      if (valid > i) {
        if (this.useFilter) this.filter.processBlock(x, i, valid);
        const send = this.send;
        const rev = this.rev;
        for (let j = i; j < valid; j++) {
          const y = x[j]! * env[j]!;
          dry[j] = dry[j]! + y;
          if (send) delaySend[j] = delaySend[j]! + y * send;
          if (rev) reverbSend[j] = reverbSend[j]! + y * rev;
        }
        this.gain[0] = env[valid - 1]!;
      }
      if (valid < end) {
        this.params = null;
        this.gain[0] = 0;
        return;
      }
      this.sub = (this.sub + seg) % SUB;
      i = end;
    }
  }
}
