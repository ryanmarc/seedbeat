import { describe, expect, it } from 'vitest';
import { buildChart, type Difficulty } from './chart';
import { MOOD_IDS, type MoodId } from './moods';
import { rngFor } from './rng';
import { makeSong } from './song';
import { createSession, press, release, summarize, update } from './session';
import { ReplayRecorder, decodeInputs, replaySession, songEndTime, type ReplayV1 } from './replay';

/**
 * A deterministic bot: hits every note with a seeded timing error (some Great/Good, a few
 * misses), releases holds near the tail, with a couple of early releases. Inputs are fed to a
 * live session frame by frame (60 Hz) and recorded; the replay must re-score identically.
 */
function botRun(seed: string, mood: MoodId, difficulty: Difficulty) {
  const song = makeSong(seed, mood, 'song');
  const chart = buildChart(song, difficulty).notes;
  const endTime = songEndTime(song.total!, song.barDur);
  const r = rngFor(seed, mood, 'bot', difficulty);
  const inputs: { lane: number; down: boolean; t: number }[] = [];
  for (const n of chart) {
    const roll = r.f();
    const err = roll < 0.04 ? 0.3 : (r.f() - 0.5) * 0.2; // 4 % misses, else ±100 ms
    const down = n.t + err;
    inputs.push({ lane: n.lane, down: true, t: down });
    const releaseAt = n.end ? n.end + (r.f() < 0.1 ? -0.4 : (r.f() - 0.5) * 0.1) : down + 0.05;
    inputs.push({ lane: n.lane, down: false, t: Math.max(releaseAt, down + 0.001) });
  }
  inputs.sort((a, b) => a.t - b.t);

  const live = createSession(chart, { difficulty, endTime });
  const rec = new ReplayRecorder();
  let i = 0;
  for (let t = 0; t <= endTime + 1 / 60; t += 1 / 60) {
    update(live, t);
    while (i < inputs.length && inputs[i]!.t <= t) {
      const inp = inputs[i++]!;
      if (inp.down) press(live, inp.lane, inp.t);
      else release(live, inp.lane, inp.t);
      rec.record(inp.lane, inp.down, inp.t);
    }
  }
  const replay: ReplayV1 = {
    v: 1,
    generatorVersion: 1,
    seed,
    mood,
    mode: 'song',
    difficulty,
    settings: { speed: 1, noFail: false },
    inputs: rec.toArray(),
  };
  return { live: summarize(live), replay, chartLength: chart.length };
}

describe('replay', () => {
  it('round-trips inputs through the Int32 packing at microsecond precision', () => {
    const rec = new ReplayRecorder();
    rec.record(2, true, 1.2345678);
    rec.record(2, false, 1.5);
    const back = decodeInputs(rec.toArray());
    expect(back).toEqual([
      { lane: 2, down: true, t: 1.234568 },
      { lane: 2, down: false, t: 1.5 },
    ]);
  });

  for (const mood of MOOD_IDS) {
    for (const difficulty of [0, 2] as Difficulty[]) {
      it(`${mood} hard=${difficulty}: a bot run re-scores identically from its replay`, () => {
        const { live, replay, chartLength } = botRun('cobalt-42', mood, difficulty);
        const again = replaySession(replay);
        expect(again).toEqual(live);
        expect(live.lateInputs).toBe(0);
        expect(
          live.counts.perfect + live.counts.great + live.counts.good + live.counts.miss,
        ).toBeGreaterThanOrEqual(chartLength);
        expect(live.counts.miss).toBeGreaterThan(0);
        expect(live.counts.perfect).toBeGreaterThan(0);
      });
    }
  }
});
