/**
 * The game clock (TIMING.md §2). Maps performance-clock milliseconds to "heard" audio time
 * through a smoothed offset, so notes move at a steady speed even though phones report the
 * audio clock in irregular bursts. Headless-testable: the audio source and `now` are injected.
 */

export interface AudioTimeSource {
  readonly state: 'suspended' | 'running' | 'closed';
  readonly currentTime: number;
  /** Seconds between the audio clock and the speaker; 0 when unknown. */
  readonly outputLatency: number;
  getOutputTimestamp?(): { contextTime?: number; performanceTime?: number };
}

export const RING_SIZE = 48;
/** Maximum glide per frame, seconds. */
export const GLIDE_MAX = 0.0005;
export const GLIDE_RATE = 0.1;
/** Re-snap when the target moves more than this (resume, device change), seconds. */
export const SNAP_THRESHOLD = 0.15;

export class GameClock {
  private readonly ring = new Float64Array(RING_SIZE);
  private ri = 0;
  private rn = 0;
  private off: number | null = null;
  /** Song start in audio-context seconds, set by `startSong`. */
  private songStartCtx = 0;
  /** Audio offset from calibration, seconds (positive = taps land late, judge earlier). */
  audioOffset = 0;

  constructor(
    private readonly audio: AudioTimeSource,
    /** performance.now() in milliseconds. */
    private readonly now: () => number,
  ) {}

  /** Forget the offset (pause, resume): the next sample re-snaps. */
  reset(): void {
    this.off = null;
    this.rn = 0;
    this.ri = 0;
  }

  get offset(): number | null {
    return this.off;
  }

  /** Take one sample. Call once per rendered frame, and when the worklet posts a status. */
  sample(): void {
    if (this.audio.state !== 'running') {
      this.reset();
      return;
    }
    const nowSec = this.now() / 1000;
    let ctxT = 0;
    let perfT = 0;
    if (this.audio.getOutputTimestamp) {
      const ts = this.audio.getOutputTimestamp();
      if (
        ts.contextTime !== undefined &&
        ts.performanceTime !== undefined &&
        ts.contextTime > 0 &&
        ts.performanceTime > 0 &&
        Math.abs(ts.performanceTime / 1000 - nowSec) < 1
      ) {
        ctxT = ts.contextTime;
        perfT = ts.performanceTime / 1000;
      }
    }
    if (!perfT) {
      ctxT = this.audio.currentTime - this.audio.outputLatency;
      perfT = nowSec;
    }
    this.push(ctxT - perfT);
  }

  /**
   * Extra sample from the worklet: `ctxTime` was exact when the block was rendered, and the
   * message hop only makes the sample look earlier, which the max-of-ring already tolerates.
   */
  sampleFromWorklet(ctxTime: number): void {
    if (this.audio.state !== 'running') return;
    this.push(ctxTime - this.audio.outputLatency - this.now() / 1000);
  }

  private push(o: number): void {
    this.ring[this.ri] = o;
    this.ri = (this.ri + 1) % RING_SIZE;
    if (this.rn < RING_SIZE) this.rn++;
    let target = -Infinity;
    for (let i = 0; i < this.rn; i++) if (this.ring[i]! > target) target = this.ring[i]!;
    if (this.off === null || Math.abs(target - this.off) > SNAP_THRESHOLD) this.off = target;
    else {
      const step = (target - this.off) * GLIDE_RATE;
      this.off += step < -GLIDE_MAX ? -GLIDE_MAX : step > GLIDE_MAX ? GLIDE_MAX : step;
    }
  }

  /** Audio time (seconds) at which the sound heard at performance time `perfMs` left the speaker. */
  heardAt(perfMs: number): number {
    if (this.audio.state !== 'running') return this.audio.currentTime - this.audio.outputLatency;
    if (this.off === null) this.sample();
    return perfMs / 1000 + (this.off ?? 0);
  }

  startSong(startCtx: number): void {
    this.songStartCtx = startCtx;
  }

  /** Song time (0 = bar 0 downbeat) heard at performance time `perfMs`, with the audio offset applied. */
  songTime(perfMs: number): number {
    return this.heardAt(perfMs) - this.songStartCtx - this.audioOffset;
  }
}

/**
 * Timestamp of an input event in performance-clock ms (TIMING.md §3): the event's own stamp when
 * it is within the last 300 ms and not in the future, else "now".
 */
export function eventMs(timeStamp: number, nowMs: number): number {
  return timeStamp > 0 && timeStamp <= nowMs + 2 && nowMs - timeStamp < 300 ? timeStamp : nowMs;
}
