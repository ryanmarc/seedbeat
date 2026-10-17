/**
 * Guitar controller → lane events (TIMING.md §3). DOM-free: `GuitarLanes` consumes parsed
 * reports (gip.ts) and emits the same `LaneEvent`s as keys and pointers, so judgement, holds
 * and replays need no guitar-specific code.
 *
 * Strum mode (Guitar Hero rules): a note is hit by strumming while its fret is held. Per held
 * fret on a strum: not down → press; down and sustaining a hold with no note due in that lane →
 * leave it (extended sustain); otherwise release + press at the strum time (repeated notes, or a
 * sustain running straight into its lane's next note). Lifting a fret releases its lane.
 * Tap mode: frets behave like keys and the strum bar is ignored.
 */
import type { GuitarReport } from './gip';
import type { InputSink } from './input';

export type GuitarMode = 'strum' | 'tap';

/** Lane per fret, GRYBO order: green, red, yellow, blue fill the four lanes; orange doubles blue. */
export const FRET_LANES: readonly number[] = [0, 1, 2, 3, 3];

/** Chart context for the re-strum rule, evaluated only when a strum lands on a held lane. */
export type LaneQuery = (lane: number) => { holding: boolean; noteNear: boolean };

export class GuitarLanes {
  /** Lanes whose fret is currently held, strummed or not: lights the receptor (Guitar Hero). */
  readonly held: readonly boolean[] = [false, false, false, false];
  private readonly down = [false, false, false, false];
  private strumUp = false;
  private strumDown = false;

  constructor(private mode: GuitarMode) {}

  get currentMode(): GuitarMode {
    return this.mode;
  }

  /** Changing mode releases held lanes first so every press the session saw gets its release. */
  setMode(mode: GuitarMode, perfMs: number, sink: InputSink): void {
    if (mode === this.mode) return;
    for (let lane = 0; lane < 4; lane++) {
      if (this.down[lane]) {
        this.down[lane] = false;
        sink({ lane, down: false, perfMs, source: 'guitar' });
      }
    }
    this.mode = mode;
  }

  /** Forget state without emitting (run start, disconnect). */
  reset(): void {
    this.down.fill(false);
    (this.held as boolean[]).fill(false);
    this.strumUp = false;
    this.strumDown = false;
  }

  /**
   * Feed one report. Returns true when the report is a "tap" for screens outside play, such as
   * calibration: a strum (fret or not) in strum mode, a fret going down in tap mode.
   */
  update(r: GuitarReport, perfMs: number, sink: InputSink, query: LaneQuery): boolean {
    const held = this.held as boolean[];
    lanesHeld(r.upper | r.solo, held);
    for (let lane = 0; lane < 4; lane++) {
      if (this.down[lane] && !held[lane]) {
        this.down[lane] = false;
        sink({ lane, down: false, perfMs, source: 'guitar' });
      }
    }
    if (this.mode === 'tap') {
      let tapped = false;
      for (let lane = 0; lane < 4; lane++) {
        if (held[lane] && !this.down[lane]) {
          this.down[lane] = true;
          tapped = true;
          sink({ lane, down: true, perfMs, source: 'guitar' });
        }
      }
      return tapped;
    }
    // A strum is the bar leaving neutral in either direction, or flipping direction.
    const strummed = (r.strumUp && !this.strumUp) || (r.strumDown && !this.strumDown);
    this.strumUp = r.strumUp;
    this.strumDown = r.strumDown;
    if (!strummed) return false;
    for (let lane = 0; lane < 4; lane++) {
      if (!held[lane]) continue;
      if (this.down[lane]) {
        const q = query(lane);
        if (q.holding && !q.noteNear) continue;
        sink({ lane, down: false, perfMs, source: 'guitar' });
      }
      this.down[lane] = true;
      sink({ lane, down: true, perfMs, source: 'guitar' });
    }
    return true;
  }
}

/** Fret mask → per-lane held flags, written in place (no allocation per report). */
function lanesHeld(frets: number, out: boolean[]): void {
  out.fill(false);
  for (let fret = 0; fret < FRET_LANES.length; fret++) {
    if (frets & (1 << fret)) out[FRET_LANES[fret]!] = true;
  }
}
