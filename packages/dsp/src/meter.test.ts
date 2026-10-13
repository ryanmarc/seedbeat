import { describe, expect, it } from 'vitest';
import { measureLoudness, phoneWeight, truePeak } from './meter';

const SR = 48000;

function sine(freq: number, amp: number, seconds: number, sr = SR): Float32Array {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

describe('BS.1770 meter', () => {
  it('a −20 dBFS 1 kHz stereo sine reads −20.0 LUFS (EBU Tech 3341 case 1 convention)', () => {
    const s = sine(1000, 0.1, 5);
    const m = measureLoudness([s, s], SR);
    expect(m.integrated).toBeGreaterThan(-20.1);
    expect(m.integrated).toBeLessThan(-19.9);
    expect(m.samplePeakDb).toBeCloseTo(-20, 1);
    expect(m.nan).toBe(0);
  });

  it('K-weighting boosts high frequencies by about 4 dB and cuts 40 Hz', () => {
    const lo = measureLoudness([sine(40, 0.1, 5)], SR).integrated;
    const mid = measureLoudness([sine(1000, 0.1, 5)], SR).integrated;
    const hi = measureLoudness([sine(10000, 0.1, 5)], SR).integrated;
    expect(hi - mid).toBeGreaterThan(3);
    expect(hi - mid).toBeLessThan(4.5);
    expect(mid - lo).toBeGreaterThan(5);
  });

  it('gates silence: a short burst in long silence is measured by the burst alone', () => {
    const burst = sine(1000, 0.1, 2);
    const padded = new Float32Array(SR * 20);
    padded.set(burst, SR * 9);
    const m = measureLoudness([padded, padded], SR);
    expect(m.integrated).toBeGreaterThan(-22);
    expect(m.integrated).toBeLessThan(-20);
  });

  it('true peak sees inter-sample peaks that sample peak misses', () => {
    // A sine at exactly fs/4 with a 45° phase: every sample sits at 0.707 of the crest.
    const n = 4800;
    const s = new Float32Array(n);
    for (let i = 0; i < n; i++) s[i] = 0.9 * Math.sin((Math.PI / 2) * i + Math.PI / 4);
    const sp = Math.max(...Array.from(s, Math.abs));
    const tp = truePeak([s]);
    expect(sp).toBeLessThan(0.65);
    expect(tp).toBeGreaterThan(0.85);
    expect(tp).toBeLessThan(0.95);
  });

  it('counts NaN and reports DC', () => {
    const s = new Float32Array(SR);
    s.fill(0.01);
    s[10] = NaN;
    const m = measureLoudness([s], SR);
    expect(m.nan).toBe(1);
    expect(m.dcDb).toBeCloseTo(-40, 0);
  });

  it('phone weighting removes bass', () => {
    const bass = sine(60, 0.3, 3);
    const [w] = phoneWeight([bass], SR);
    const before = measureLoudness([bass], SR).integrated;
    const after = measureLoudness([w!], SR).integrated;
    expect(before - after).toBeGreaterThan(15);
  });
});
