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
}
