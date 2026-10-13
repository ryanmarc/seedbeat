/**
 * Freeverb-style algorithmic reverb (8 parallel lowpass-feedback combs + 4 series allpasses per
 * channel, stereo spread). Replaces the prototype's 2.2 s decaying-noise convolution.
 * Tuned so RT60 is about 2.2 s at the default room size.
 */

const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNING = [556, 441, 341, 225];
const STEREO_SPREAD = 23;
const REF_RATE = 44100;

class Comb {
  private buf: Float32Array;
  private i = 0;
  private store = 0;
  feedback = 0.84;
  damp = 0.2;
  constructor(size: number) {
    this.buf = new Float32Array(size);
  }
  process(x: number): number {
    const out = this.buf[this.i]!;
    this.store = out * (1 - this.damp) + this.store * this.damp;
    this.buf[this.i] = x + this.store * this.feedback;
    if (++this.i >= this.buf.length) this.i = 0;
    return out;
  }
  clear(): void {
    this.buf.fill(0);
    this.store = 0;
  }
}

class Allpass {
  private buf: Float32Array;
  private i = 0;
  constructor(size: number) {
    this.buf = new Float32Array(size);
  }
  process(x: number): number {
    const b = this.buf[this.i]!;
    const out = -x + b;
    this.buf[this.i] = x + b * 0.5;
    if (++this.i >= this.buf.length) this.i = 0;
    return out;
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

  /** Mono in, stereo out written to `out` as [L, R]. Output is scaled to roughly unity-ish wet level. */
  process(x: number, out: Float32Array): void {
    const input = x * 0.015;
    let l = 0;
    let r = 0;
    for (let i = 0; i < 8; i++) {
      l += this.combL[i]!.process(input);
      r += this.combR[i]!.process(input);
    }
    for (let i = 0; i < 4; i++) {
      l = this.apL[i]!.process(l);
      r = this.apR[i]!.process(r);
    }
    out[0] = l;
    out[1] = r;
  }
}
