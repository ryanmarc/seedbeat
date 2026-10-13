/**
 * Freeverb-style algorithmic reverb (8 parallel lowpass-feedback combs + 4 series allpasses per
 * channel, stereo spread). Replaces the prototype's 2.2 s decaying-noise convolution.
 * Tuned so RT60 is about 2.2 s at the default room size. Processes whole blocks: each stage runs
 * its own loop with local state, so no fraction crosses a function boundary per sample.
 */
import { BLOCK_SIZE } from './util';

const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNING = [556, 441, 341, 225];
const STEREO_SPREAD = 23;
const REF_RATE = 44100;

class Comb {
  private buf: Float32Array;
  private i = 0;
  private readonly store = new Float64Array(1);
  feedback = 0.84;
  damp = 0.2;
  constructor(size: number) {
    this.buf = new Float32Array(size);
  }
  /** acc[j] += comb(input[j]) for j < n. */
  processBlock(input: Float64Array, acc: Float64Array, n: number): void {
    const buf = this.buf;
    const len = buf.length;
    const damp = this.damp;
    const fb = this.feedback;
    let i = this.i;
    let store = this.store[0]!;
    for (let j = 0; j < n; j++) {
      const out = buf[i]!;
      store = out * (1 - damp) + store * damp;
      buf[i] = input[j]! + store * fb;
      if (++i >= len) i = 0;
      acc[j] = acc[j]! + out;
    }
    this.i = i;
    this.store[0] = store;
  }
  clear(): void {
    this.buf.fill(0);
    this.store[0] = 0;
  }
}

class Allpass {
  private buf: Float32Array;
  private i = 0;
  constructor(size: number) {
    this.buf = new Float32Array(size);
  }
  /** In place over sig[0, n). */
  processBlock(sig: Float64Array, n: number): void {
    const buf = this.buf;
    const len = buf.length;
    let i = this.i;
    for (let j = 0; j < n; j++) {
      const x = sig[j]!;
      const b = buf[i]!;
      sig[j] = -x + b;
      buf[i] = x + b * 0.5;
      if (++i >= len) i = 0;
    }
    this.i = i;
  }
  clear(): void {
    this.buf.fill(0);
  }
}

export class Reverb {
  private combL: Comb[];
  private combR: Comb[];
  private apL: Allpass[];
  private apR: Allpass[];
  private readonly inBuf = new Float64Array(BLOCK_SIZE);
  private readonly accL = new Float64Array(BLOCK_SIZE);
  private readonly accR = new Float64Array(BLOCK_SIZE);

  constructor(sampleRate: number, roomSize = 0.86, damp = 0.25) {
    const scale = sampleRate / REF_RATE;
    const sz = (n: number): number => Math.max(1, Math.round(n * scale));
    this.combL = COMB_TUNING.map((n) => new Comb(sz(n)));
    this.combR = COMB_TUNING.map((n) => new Comb(sz(n + STEREO_SPREAD)));
    this.apL = ALLPASS_TUNING.map((n) => new Allpass(sz(n)));
    this.apR = ALLPASS_TUNING.map((n) => new Allpass(sz(n + STEREO_SPREAD)));
    this.configure(roomSize, damp);
  }

  configure(roomSize: number, damp: number): void {
    for (const c of [...this.combL, ...this.combR]) {
      c.feedback = roomSize;
      c.damp = damp;
    }
  }

  reset(): void {
    for (const c of [...this.combL, ...this.combR]) c.clear();
    for (const a of [...this.apL, ...this.apR]) a.clear();
  }

  /** Mono in, stereo out for one sample (tests). */
  process(x: number, out: Float32Array): void {
    this.inBuf[0] = x;
    this.processBlock(this.inBuf, out, out.subarray(1), 1);
  }

  /** Mono input[0, n) to stereo outL/outR. Output is scaled to roughly unity-ish wet level. */
  processBlock(input: ArrayLike<number>, outL: Float32Array, outR: Float32Array, n: number): void {
    const inBuf = this.inBuf;
    const accL = this.accL;
    const accR = this.accR;
    for (let i = 0; i < n; i++) {
      inBuf[i] = input[i]! * 0.015;
      accL[i] = 0;
      accR[i] = 0;
    }
    for (let i = 0; i < 8; i++) {
      this.combL[i]!.processBlock(inBuf, accL, n);
      this.combR[i]!.processBlock(inBuf, accR, n);
    }
    for (let i = 0; i < 4; i++) {
      this.apL[i]!.processBlock(accL, n);
      this.apR[i]!.processBlock(accR, n);
    }
    for (let i = 0; i < n; i++) {
      outL[i] = accL[i]!;
      outR[i] = accR[i]!;
    }
  }
}
