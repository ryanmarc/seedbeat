import { buildChart, type Difficulty } from './chart';
import { makeSong, type Mode } from './song';
import type { MoodId } from './moods';
import { createSession, press, release, summarize, update, type SessionSummary } from './session';
import type { GeneratorVersion } from './index';

/**
 * Replay v1 (ARCHITECTURE.md §5): everything needed to re-score a run. Inputs are packed as
 * Int32 triples: lane (0–3), 1 for down / 0 for up, and song time in microseconds. Song time is
 * already mapped through the clock and audio offset, so a replay needs no device information.
 */
export interface ReplayV1 {
  v: 1;
  generatorVersion: GeneratorVersion;
  seed: string;
  mood: MoodId;
  mode: Mode;
  difficulty: Difficulty;
  settings: { speed: number; noFail: boolean };
  /** Endless: how many bars were charted. Song mode: ignored (whole song). */
  bars?: number;
  inputs: Int32Array;
}

export interface ReplayInput {
  lane: number;
  down: boolean;
  /** Song time in seconds. */
  t: number;
}

export class ReplayRecorder {
  private readonly buf: number[] = [];
  record(lane: number, down: boolean, t: number): void {
    this.buf.push(lane, down ? 1 : 0, Math.round(t * 1e6));
  }
  get count(): number {
    return this.buf.length / 3;
  }
  toArray(): Int32Array {
    return Int32Array.from(this.buf);
  }
}

export function decodeInputs(inputs: Int32Array): ReplayInput[] {
  const out: ReplayInput[] = [];
  for (let i = 0; i + 2 < inputs.length; i += 3) {
    out.push({ lane: inputs[i]!, down: inputs[i + 1] === 1, t: inputs[i + 2]! / 1e6 });
  }
  return out;
}

/** Song-mode end time: the prototype finishes 1.2 s after the last bar. */
export function songEndTime(totalBars: number, barDur: number): number {
  return totalBars * barDur + 1.2;
}

/**
 * Re-score a replay from scratch. Inputs are applied in timestamp order, with the frame update
 * run to each input's time first, exactly as a live run whose inputs were delivered on time.
 */
export function replaySession(r: ReplayV1): SessionSummary {
  const song = makeSong(r.seed, r.mood, r.mode);
  const bars = song.total ?? r.bars ?? 0;
  const chart = buildChart(song, r.difficulty, bars).notes;
  const endTime = song.total !== null ? songEndTime(song.total, song.barDur) : undefined;
  const s = createSession(chart, {
    difficulty: r.difficulty,
    noFail: r.settings.noFail,
    ...(endTime !== undefined ? { endTime } : {}),
  });
  const inputs = decodeInputs(r.inputs).sort((a, b) => a.t - b.t);
  for (const inp of inputs) {
    update(s, inp.t);
    if (inp.down) press(s, inp.lane, inp.t);
    else release(s, inp.lane, inp.t);
  }
  update(s, endTime ?? (inputs.at(-1)?.t ?? 0) + 10);
  return summarize(s);
}
