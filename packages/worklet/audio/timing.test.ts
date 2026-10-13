import { getBar, makeSong, stepTime } from '@seedbeat/core';
import { BLOCK_SIZE, Engine, type VoiceParams } from '@seedbeat/dsp';
import { describe, expect, it } from 'vitest';
import { Sequencer } from '../src/sequencer';
import { SAMPLE_RATE } from './helpers';

/** Engine stand-in that records trigger frames instead of synthesizing. */
class RecordingEngine extends Engine {
  readonly kicks: number[] = [];
  override trigger(params: VoiceParams, startFrame: number, reserved = false): void {
    if (params.kind === 'kick') this.kicks.push(startFrame);
    super.trigger(params, startFrame, reserved);
  }
}

describe('sequencer sample accuracy', () => {
  for (const [seed, mood] of [
    ['amber-11', 'techno'],
    ['cobalt-42', 'chiptune'],
    ['orbit-73', 'lofi'],
  ] as const) {
    it(`${mood} ${seed}: every kick is triggered within ±1 sample of its step time`, () => {
      const sr = SAMPLE_RATE;
      const engine = new RecordingEngine(sr);
      const seq = new Sequencer(engine, sr);
      const song = makeSong(seed, mood, 'song');
      const startFrame = 12345;
      seq.start({ seed, mood, mode: 'song', startFrame });
      const l = new Float32Array(BLOCK_SIZE);
      const r = new Float32Array(BLOCK_SIZE);
      const totalFrames = Math.ceil(song.total! * song.barDur * sr) + startFrame + sr;
      for (let pos = 0; pos < totalFrames; pos += BLOCK_SIZE) seq.process(l, r, BLOCK_SIZE, pos);

      const expected: number[] = [];
      for (let bar = 0; bar < song.total!; bar++) {
        for (const e of getBar(song, bar).ev) {
          if (e.type === 'kick') expected.push(startFrame + stepTime(song, bar, e.step) * sr);
        }
      }
      expect(engine.kicks.length).toBe(expected.length);
      engine.kicks.sort((a, b) => a - b);
      expected.sort((a, b) => a - b);
      for (let i = 0; i < expected.length; i++) {
        expect(Math.abs(engine.kicks[i]! - expected[i]!)).toBeLessThanOrEqual(1);
      }
      expect(seq.hasEnded).toBe(true);
    });
  }

  it('a kick triggered at frame F first sounds at F + limiter latency', () => {
    const sr = SAMPLE_RATE;
    const engine = new Engine(sr);
    engine.configure('techno', 0.12);
    const l = new Float32Array(BLOCK_SIZE);
    const r = new Float32Array(BLOCK_SIZE);
    const F = 1000;
    engine.trigger(
      { kind: 'kick', wave: 'sine', f0: 140, f1: 40, sweep: 0.13, dur: 0.55, vol: 0.8 },
      F,
    );
    let first = -1;
    for (let pos = 0; pos < 4000 && first < 0; pos += BLOCK_SIZE) {
      engine.render(l, r, BLOCK_SIZE, pos);
      for (let i = 0; i < BLOCK_SIZE; i++) {
        if (Math.abs(l[i]!) > 1e-6) {
          first = pos + i;
          break;
        }
      }
    }
    expect(first).toBeGreaterThanOrEqual(F + engine.latencySamples);
    expect(first).toBeLessThanOrEqual(F + engine.latencySamples + 1);
  });

  it('pause freezes the song position and resume continues from it', () => {
    const sr = SAMPLE_RATE;
    const seq = new Sequencer(new Engine(sr), sr);
    seq.start({ seed: 'amber-11', mood: 'synthwave', mode: 'song', startFrame: 0 });
    expect(seq.songFrameAt(48000)).toBe(48000);
    seq.pause(48000);
    expect(seq.songFrameAt(70000)).toBe(48000); // frozen while paused
    seq.resume(96000);
    expect(seq.songFrameAt(96000)).toBe(48000);
    expect(seq.songTimeAt(96000 + sr)).toBeCloseTo(2, 9);
  });

  it('playback rate scales song time (Practice 50 %)', () => {
    const sr = SAMPLE_RATE;
    const seq = new Sequencer(new Engine(sr), sr);
    seq.start({ seed: 'amber-11', mood: 'chiptune', mode: 'song', startFrame: 0, rate: 0.5 });
    expect(seq.songTimeAt(sr * 2)).toBeCloseTo(1, 9);
  });
});
