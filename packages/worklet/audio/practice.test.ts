import { getBar, makeSong, stepTime } from '@seedbeat/core';
import { BLOCK_SIZE, Engine, type VoiceParams } from '@seedbeat/dsp';
import { describe, expect, it } from 'vitest';
import { Sequencer } from '../src/sequencer';
import { SAMPLE_RATE } from './helpers';

class RecordingEngine extends Engine {
  readonly kicks: number[] = [];
  readonly clicks: number[] = [];
  readonly reserved: number[] = [];
  override trigger(params: VoiceParams, startFrame: number, reserved = false): void {
    if (params.kind === 'kick') this.kicks.push(startFrame);
    if (params.kind === 'tone' && params.freq === 820) this.clicks.push(startFrame);
    if (reserved) this.reserved.push(startFrame);
    super.trigger(params, startFrame, reserved);
  }
}

function run(seq: Sequencer, frames: number): void {
  const l = new Float32Array(BLOCK_SIZE);
  const r = new Float32Array(BLOCK_SIZE);
  for (let pos = 0; pos < frames; pos += BLOCK_SIZE) seq.process(l, r, BLOCK_SIZE, pos);
}

describe('practice playback', () => {
  const sr = SAMPLE_RATE;
  const seed = 'cobalt-42';
  const mood = 'chiptune';
  const song = makeSong(seed, mood, 'song');
  const sec = song.sections[2]!; // first chorus
  const fromBar = sec.start;
  const toBar = sec.start + sec.len;

  for (const rate of [1, 0.5] as const) {
    it(`loops the section at rate ${rate}: repetition k is shifted by k section lengths`, () => {
      const engine = new RecordingEngine(sr);
      const seq = new Sequencer(engine, sr);
      const startFrame = 4000;
      seq.start({ seed, mood, mode: 'song', startFrame, fromBar, toBar, rate, loop: true });
      const sectionFrames = ((toBar - fromBar) * song.barDur * sr) / rate;
      run(seq, Math.ceil(startFrame + (fromBar * song.barDur * sr) / rate + sectionFrames * 3));
      expect(seq.loopCount).toBeGreaterThanOrEqual(2);
      expect(seq.hasEnded).toBe(false);

      const rep0: number[] = [];
      for (let bar = fromBar; bar < toBar; bar++)
        for (const e of getBar(song, bar).ev)
          if (e.type === 'kick') rep0.push(startFrame + (stepTime(song, bar, e.step) * sr) / rate);
      rep0.sort((a, b) => a - b);
      const got = engine.kicks.sort((a, b) => a - b);
      expect(got.length).toBeGreaterThanOrEqual(rep0.length * 2);
      for (let k = 0; k < 2; k++)
        for (let i = 0; i < rep0.length; i++)
          expect(
            Math.abs(got[k * rep0.length + i]! - (rep0[i]! + k * sectionFrames)),
          ).toBeLessThanOrEqual(2);
    });
  }

  it('plays the count-in on the four beats before fromBar', () => {
    const engine = new RecordingEngine(sr);
    const seq = new Sequencer(engine, sr);
    const startFrame = 0;
    const rate = 0.75;
    seq.start({ seed, mood, mode: 'song', startFrame, fromBar, toBar, rate, countIn: true });
    run(seq, Math.ceil((fromBar * song.barDur * sr) / rate) + sr);
    const beat = (song.sd * 4) / rate;
    const first = (fromBar * song.barDur) / rate;
    expect(engine.clicks.length).toBe(4);
    engine.clicks.forEach((f, i) =>
      expect(Math.abs(f - (first - (4 - i) * beat) * sr)).toBeLessThanOrEqual(1),
    );
  });

  it('ends without looping when loop is off', () => {
    const engine = new RecordingEngine(sr);
    const seq = new Sequencer(engine, sr);
    seq.start({ seed, mood, mode: 'song', startFrame: 0, fromBar, toBar });
    run(seq, Math.ceil(toBar * song.barDur * sr) + sr);
    expect(seq.hasEnded).toBe(true);
    expect(seq.loopCount).toBe(0);
  });

  it('menu blips use the reserved voices and respect the UI gain', () => {
    const engine = new RecordingEngine(sr);
    const seq = new Sequencer(engine, sr);
    seq.uiSound('confirm', 100, 0);
    expect(engine.reserved.length).toBe(0);
    seq.uiSound('confirm', 100, 0.5);
    expect(engine.reserved.length).toBe(2);
    seq.uiSound('unlock', 200, 1);
    expect(engine.reserved.length).toBe(5);
  });
});
