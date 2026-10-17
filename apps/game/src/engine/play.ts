/**
 * Glue for one run: clock → session → replay recorder. No DOM, no rendering; the renderer reads
 * `session` and the HUD reads `summarize(session)`. `frame` is the only per-frame entry point and
 * allocates nothing.
 */
import {
  ReplayRecorder,
  createSession,
  dropHolds,
  noteNear,
  press,
  release,
  update,
  type ChartNote,
  type Difficulty,
  type GeneratorVersion,
  type Mode,
  type MoodId,
  type ReplayV1,
  type SessionState,
} from '@seedbeat/core';
import type { GameClock } from './clock';
import type { LaneEvent } from './input';

export interface RunConfig {
  seed: string;
  mood: MoodId;
  mode: Mode;
  difficulty: Difficulty;
  generatorVersion: GeneratorVersion;
  speed: number;
  noFail: boolean;
  endTime?: number;
  /** Endless: bars charted so far (kept in step with appended notes by the caller). */
  bars?: number;
}

export class PlayRun {
  readonly session: SessionState;
  private readonly recorder = new ReplayRecorder();
  private lastFrameSongTime = -Infinity;

  constructor(
    private readonly clock: GameClock,
    private readonly config: RunConfig,
    notes: readonly ChartNote[],
  ) {
    this.session = createSession(notes, {
      difficulty: config.difficulty,
      noFail: config.noFail,
      ...(config.endTime !== undefined ? { endTime: config.endTime } : {}),
    });
  }

  /** Per rendered frame: returns the song time to draw at (before visual offset). */
  frame(frameTimeMs: number): number {
    this.clock.sample();
    const t = this.clock.songTime(frameTimeMs);
    update(this.session, t);
    this.lastFrameSongTime = t;
    return t;
  }

  /** Every input is judged at its own timestamp, never at "now". */
  input(e: LaneEvent): void {
    const t = this.clock.songTime(e.perfMs);
    this.recorder.record(e.lane, e.down, t);
    if (e.down) press(this.session, e.lane, t);
    else release(this.session, e.lane, t);
  }

  /** Chart context at an input's timestamp (guitar strum rules): hold active, next note due. */
  laneContext(lane: number, perfMs: number): { holding: boolean; noteNear: boolean } {
    const s = this.session;
    return {
      holding: !!s.holds[lane],
      noteNear: noteNear(s, lane, this.clock.songTime(perfMs)),
    };
  }

  /** Pause: active sustains end here and pay what was held (TIMING.md §4). */
  pause(): void {
    dropHolds(this.session, this.lastFrameSongTime);
    this.clock.reset();
  }

  replay(): ReplayV1 {
    const c = this.config;
    return {
      v: 1,
      generatorVersion: c.generatorVersion,
      seed: c.seed,
      mood: c.mood,
      mode: c.mode,
      difficulty: c.difficulty,
      settings: { speed: c.speed, noFail: c.noFail },
      ...(c.bars !== undefined ? { bars: c.bars } : {}),
      inputs: this.recorder.toArray(),
    };
  }
}
