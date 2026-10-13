import { describe, expect, it } from 'vitest';
import { Biquad } from './biquad';
import { AdsrEnv, ExpEnv } from './env';
import { Oscillator, type Wave } from './osc';
import { Compressor, Limiter } from './dynamics';
import { Engine, BLOCK_SIZE, VOICE_POOL } from './engine';
import { eventTriggers, hitSoundTriggers, type Trigger } from './presets';
import { dbToGain } from './util';

const SR = 48000;

describe('oscillators', () => {
  for (const wave of ['sine', 'sawtooth', 'square', 'pulse25', 'pulse12', 'triangle'] as Wave[]) {
    it(`${wave}: bounded, near zero mean, correct period`, () => {
      const o = new Oscillator();
      o.reset(wave);
      o.setFrequency(100, SR);
      const n = SR; // 100 cycles
      let sum = 0;
      let max = 0;
      const buf = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const v = o.next();
        buf[i] = v;
        sum += v;
        max = Math.max(max, Math.abs(v));
      }
      expect(max).toBeLessThanOrEqual(1.25);
      expect(max).toBeGreaterThan(0.5);
      expect(Math.abs(sum / n)).toBeLessThan(0.02);
      // Periodicity: sample 480 cycles later should match (period = 480 samples).
      let err = 0;
      for (let i = 1000; i < 2000; i++) err += Math.abs(buf[i]! - buf[i + 480]!);
      expect(err / 1000).toBeLessThan(0.05);
    });
  }
});

describe('biquad', () => {
  it('lowpass attenuates above cutoff and passes below', () => {
    const gainAt = (hz: number): number => {
      const f = new Biquad();
      f.set('lowpass', 1000, SR, 0);
      let peak = 0;
      for (let i = 0; i < SR; i++) {
        const y = f.process(Math.sin((2 * Math.PI * hz * i) / SR));
        if (i > SR / 2) peak = Math.max(peak, Math.abs(y));
      }
      return peak;
    };
    expect(gainAt(100)).toBeGreaterThan(0.95);
    expect(gainAt(10000)).toBeLessThan(0.02);
  });

  it('bandpass peaks at centre', () => {
    const f = new Biquad();
    const resp = (hz: number): number => {
      f.set('bandpass', 1400, SR, 1);
      f.reset();
      let peak = 0;
      for (let i = 0; i < SR / 4; i++) {
        const y = f.process(Math.sin((2 * Math.PI * hz * i) / SR));
        if (i > SR / 8) peak = Math.max(peak, Math.abs(y));
      }
      return peak;
    };
    expect(resp(1400)).toBeGreaterThan(resp(300));
    expect(resp(1400)).toBeGreaterThan(resp(8000));
  });
});

describe('envelopes', () => {
  it('ADSR rises linearly to the peak, decays toward sustain, releases to silence', () => {
    const e = new AdsrEnv();
    e.trigger(1, 0.01, 0.1, 0.5, 0.05, 0.2, SR);
    const at = (sec: number): number => {
      let v = 0;
      for (let i = 0; i < Math.round(sec * SR); i++) v = e.next();
      return v;
    };
    expect(at(0.005)).toBeCloseTo(0.5, 1); // halfway up the attack
    expect(at(0.005)).toBeCloseTo(1, 1); // peak
    expect(at(0.15)).toBeCloseTo(0.5, 1); // settled at sustain
    expect(at(0.05)).toBeLessThan(0.5);
    expect(at(0.5)).toBe(0);
    expect(e.active).toBe(false);
  });

  it('exp env peaks at a and is back at the floor at dur', () => {
    const e = new ExpEnv();
    e.trigger(0.8, 0.004, 0.3, SR);
    let v = 0;
    for (let i = 0; i < Math.round(0.004 * SR); i++) v = e.next();
    expect(v).toBeCloseTo(0.8, 2);
    for (let i = 0; i < Math.round(0.296 * SR) - 1; i++) v = e.next();
    expect(v).toBeLessThan(0.001);
    for (let i = 0; i < 10; i++) e.next();
    expect(e.active).toBe(false);
  });
});

describe('dynamics', () => {
  it('compressor leaves quiet signals alone and reduces loud ones by the ratio', () => {
    const c = new Compressor(SR, {
      threshold: -18,
      knee: 0,
      ratio: 4,
      attack: 0.001,
      release: 0.1,
    });
    let g = 1;
    for (let i = 0; i < SR; i++) g = c.gain(dbToGain(-30));
    expect(g).toBeCloseTo(1, 3);
    for (let i = 0; i < SR; i++) g = c.gain(dbToGain(-6));
    // 12 dB over threshold at 4:1 → output −15 dB → gain −9 dB.
    expect(20 * Math.log10(g)).toBeCloseTo(-9, 1);
  });

  it('limiter never lets the output exceed the ceiling', () => {
    const lim = new Limiter(SR, -1.5, 0.0015, 0.08);
    const out = new Float32Array(2);
    let peak = 0;
    for (let i = 0; i < SR; i++) {
      const x = 2 * Math.sin((2 * Math.PI * 200 * i) / SR) * (i % 9000 < 4500 ? 1 : 0.1);
      lim.process(x, x, out);
      peak = Math.max(peak, Math.abs(out[0]!));
    }
    expect(peak).toBeLessThanOrEqual(dbToGain(-1.5) + 1e-6);
  });
});

describe('engine', () => {
  it('renders silence when idle and never allocates past the pool', () => {
    const e = new Engine(SR);
    e.configure('techno', 0.12);
    const l = new Float32Array(BLOCK_SIZE);
    const r = new Float32Array(BLOCK_SIZE);
    e.render(l, r, BLOCK_SIZE, 0);
    expect(Math.max(...l)).toBe(0);
    const triggers: Trigger[] = [];
    for (let i = 0; i < 200; i++)
      eventTriggers('techno', { type: 'stab', midis: [60, 64, 67], len: 4 }, 0.12, triggers);
    e.triggerAll(triggers, 0);
    expect(e.stats.steals).toBeGreaterThan(0);
    e.render(l, r, BLOCK_SIZE, 0);
    expect(e.stats.voices).toBeLessThanOrEqual(VOICE_POOL);
    expect(l.every(Number.isFinite)).toBe(true);
  });

  it('hit sounds use the reserve and do not steal music voices', () => {
    const e = new Engine(SR);
    e.configure('chiptune', 0.1);
    const triggers: Trigger[] = [];
    for (let i = 0; i < 56; i++)
      eventTriggers('chiptune', { type: 'arp', midi: 72, len: 1 }, 0.1, triggers);
    e.triggerAll(triggers, 0);
    const stealsBefore = e.stats.steals;
    const hits: Trigger[] = [];
    hitSoundTriggers('perfect', hits);
    e.triggerAll(hits, 0, true);
    expect(e.stats.steals).toBe(stealsBefore);
  });

  it('every event type of every mood produces at least one voice', () => {
    const types = [
      'kick',
      'snare',
      'clap',
      'hat',
      'rim',
      'crash',
      'riser',
      'bass',
      'drone',
      'lead',
      'keys',
      'pad',
      'arp',
      'stab',
    ];
    for (const mood of ['lofi', 'synthwave', 'chiptune', 'techno'] as const) {
      for (const type of types) {
        const out: Trigger[] = [];
        eventTriggers(mood, { type, midi: 60, midis: [60, 64, 67], len: 4, vel: 1 }, 0.12, out);
        expect(out.length, `${mood} ${type}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('lo-fi crackle lifecycle', () => {
  it('only hisses while the transport is playing', () => {
    const e = new Engine(SR);
    e.configure('lofi', 0.14);
    const l = new Float32Array(BLOCK_SIZE);
    const r = new Float32Array(BLOCK_SIZE);
    const peak = (): number => {
      let m = 0;
      for (let i = 0; i < 40; i++) {
        e.render(l, r, BLOCK_SIZE, i * BLOCK_SIZE);
        for (let k = 0; k < BLOCK_SIZE; k++) m = Math.max(m, Math.abs(l[k]!));
      }
      return m;
    };
    expect(peak()).toBe(0); // configured but not playing: silent
    e.setTransport(true);
    expect(peak()).toBeGreaterThan(0.0005);
    e.setTransport(false);
    // The 8 Hz DC blocker rings for ~100 ms after the last click; let it settle, then silence.
    peak();
    peak();
    expect(peak()).toBeLessThan(1e-4);
  });
});
