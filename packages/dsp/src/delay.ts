import { Biquad } from './biquad';

/** Mono feedback delay with a lowpass in the loop, as the prototype's delay send. */
export class FeedbackDelay {
  private buf: Float32Array;
  private w = 0;
  private len = 1;
  private feedback = 0.32;
  private lp = new Biquad();

  constructor(
    private sampleRate: number,
    maxSeconds = 2,
  ) {
    this.buf = new Float32Array(Math.ceil(maxSeconds * sampleRate) + 1);
  }

  configure(seconds: number, feedback: number, lowpassHz: number): void {
    this.len = Math.max(1, Math.min(this.buf.length - 1, Math.round(seconds * this.sampleRate)));
    this.feedback = feedback;
    this.lp.set('lowpass', lowpassHz, this.sampleRate, 0);
  }

  reset(): void {
    this.buf.fill(0);
    this.w = 0;
    this.lp.reset();
  }

  /** Feed one input sample; returns the wet (filtered, delayed) sample. */
  process(x: number): number {
    const r = (this.w - this.len + this.buf.length) % this.buf.length;
    const delayed = this.lp.process(this.buf[r]!);
    this.buf[this.w] = x + delayed * this.feedback;
    this.w = (this.w + 1) % this.buf.length;
    return delayed;
  }

  /**
   * Block form: wet[i] for input[i], i < n. When the delay is at least a block long (always, for
   * musical delay times) the reads never touch this block's writes, so the lowpass runs over the
   * whole block at once; otherwise fall back to the per-sample loop.
   */
  processBlock(input: Float32Array, wet: Float64Array, n: number): void {
    const buf = this.buf;
    const L = buf.length;
    const len = this.len;
    if (len < n) {
      for (let i = 0; i < n; i++) wet[i] = this.process(input[i]!);
      return;
    }
    let w = this.w;
    for (let i = 0; i < n; i++) wet[i] = buf[(w + i - len + L) % L]!;
    this.lp.processBlock(wet, 0, n);
    const fb = this.feedback;
    for (let i = 0; i < n; i++) {
      buf[w] = input[i]! + wet[i]! * fb;
      w = (w + 1) % L;
    }
    this.w = w;
  }
}
