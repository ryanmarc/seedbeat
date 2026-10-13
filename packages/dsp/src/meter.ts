import { Biquad } from './biquad';
import { TWO_PI, gainToDb } from './util';

/**
 * ITU-R BS.1770-4 integrated loudness (K-weighting, 400 ms blocks with 75 % overlap, absolute
 * −70 LUFS gate and relative −10 LU gate) and true peak (4× oversampled, dBTP).
 * Pure TypeScript so `pnpm test:audio` can run it in Node on offline renders.
 */

/** K-weighting stage 1 (high shelf +4 dB) and stage 2 (RLB high pass) for any sample rate. */
function kWeighting(sampleRate: number): [Biquad, Biquad] {
  // Derived from the BS.1770 reference filters (specified at 48 kHz) by re-solving the analogue
  // prototypes at the target rate, as in common open-source meters.
  const shelf = new Biquad();
  {
    const f0 = 1681.974450955533;
    const G = 3.999843853973347;
    const Q = 0.7071752369554196;
    const K = Math.tan((Math.PI * f0) / sampleRate);
    const Vh = Math.pow(10, G / 20);
    const Vb = Math.pow(Vh, 0.4996667741545416);
    const a0 = 1 + K / Q + K * K;
    const b0 = (Vh + (Vb * K) / Q + K * K) / a0;
    const b1 = (2 * (K * K - Vh)) / a0;
    const b2 = (Vh - (Vb * K) / Q + K * K) / a0;
    const a1 = (2 * (K * K - 1)) / a0;
    const a2 = (1 - K / Q + K * K) / a0;
    shelf.setCoefficients(b0, b1, b2, a1, a2);
  }
  const hp = new Biquad();
  {
    const f0 = 38.13547087602444;
    const Q = 0.5003270373238773;
    const K = Math.tan((Math.PI * f0) / sampleRate);
    const a0 = 1 + K / Q + K * K;
    const a1 = (2 * (K * K - 1)) / a0;
    const a2 = (1 - K / Q + K * K) / a0;
    hp.setCoefficients(1, -2, 1, a1, a2);
  }
  return [shelf, hp];
}

export interface LoudnessResult {
  /** Integrated loudness in LUFS, or -Infinity if everything was gated out. */
  integrated: number;
  /** Max true peak in dBTP across channels. */
  truePeakDb: number;
  /** Max sample peak in dBFS. */
  samplePeakDb: number;
  /** Mean DC offset in dBFS (of the absolute mean), per channel max. */
  dcDb: number;
  nan: number;
}

/** Measure a stereo (or mono) buffer. Channels are Float32Arrays of equal length. */
export function measureLoudness(channels: Float32Array[], sampleRate: number): LoudnessResult {
  const n = channels[0]!.length;
  const nc = channels.length;
  const blockLen = Math.round(0.4 * sampleRate);
  const hop = Math.round(0.1 * sampleRate);

  // K-weight every channel into a power series, then block-sum.
  const filters = channels.map(() => kWeighting(sampleRate));
  const weighted = channels.map(() => new Float32Array(n));
  let nan = 0;
  let samplePeak = 0;
  const dc = new Array<number>(nc).fill(0);
  for (let c = 0; c < nc; c++) {
    const [sh, hp] = filters[c]!;
    const src = channels[c]!;
    const dst = weighted[c]!;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const x = src[i]!;
      if (!Number.isFinite(x)) {
        nan++;
        continue;
      }
      const a = Math.abs(x);
      if (a > samplePeak) samplePeak = a;
      sum += x;
      const y = hp.process(sh.process(x));
      dst[i] = y * y;
    }
    dc[c] = Math.abs(sum / n);
  }

  // Block loudness values.
  const blocks: number[] = [];
  for (let start = 0; start + blockLen <= n; start += hop) {
    let z = 0;
    for (let c = 0; c < nc; c++) {
      const w = weighted[c]!;
      let s = 0;
      for (let i = start; i < start + blockLen; i++) s += w[i]!;
      z += s / blockLen; // channel weights are 1 for L/R
    }
    blocks.push(-0.691 + 10 * Math.log10(Math.max(z, 1e-20)));
  }
  const gated = (list: number[], gate: number): number[] => list.filter((l) => l > gate);
  const meanPower = (list: number[]): number =>
    list.reduce((acc, l) => acc + Math.pow(10, (l + 0.691) / 10), 0) / Math.max(list.length, 1);
  const abs = gated(blocks, -70);
  let integrated = -Infinity;
  if (abs.length) {
    const relGate = -0.691 + 10 * Math.log10(meanPower(abs)) - 10;
    const rel = gated(abs, relGate);
    if (rel.length) integrated = -0.691 + 10 * Math.log10(meanPower(rel));
  }

  return {
    integrated,
    truePeakDb: gainToDb(truePeak(channels)),
    samplePeakDb: gainToDb(samplePeak),
    dcDb: gainToDb(Math.max(...dc)),
    nan,
  };
}

/** 4× oversampled peak using a windowed-sinc polyphase interpolator (BS.1770 Annex 2 style). */
export function truePeak(channels: Float32Array[]): number {
  const taps = 48; // per phase: 12 taps × 4 phases
  const phases = 4;
  const perPhase = taps / phases;
  // Build polyphase windowed-sinc coefficients.
  const coef: Float32Array[] = [];
  for (let p = 0; p < phases; p++) {
    const arr = new Float32Array(perPhase);
    for (let k = 0; k < perPhase; k++) {
      const t = k - perPhase / 2 + 1 - p / phases;
      const x = Math.PI * t;
      const sinc = t === 0 ? 1 : Math.sin(x) / x;
      const win = 0.5 * (1 + Math.cos((TWO_PI * (k + 1 - p / phases - perPhase / 2)) / perPhase));
      arr[k] = sinc * Math.max(win, 0);
    }
    coef.push(arr);
  }
  let peak = 0;
  for (const ch of channels) {
    const n = ch.length;
    for (let i = 0; i < n; i++) {
      for (let p = 0; p < phases; p++) {
        const c = coef[p]!;
        let acc = 0;
        for (let k = 0; k < perPhase; k++) {
          const idx = i - k + perPhase / 2 - 1;
          if (idx >= 0 && idx < n) acc += ch[idx]! * c[k]!;
        }
        const a = Math.abs(acc);
        if (a > peak) peak = a;
      }
    }
  }
  return peak;
}

/** Simulated phone speaker: high pass at 220 Hz, as AUDIO.md §3's phone check. */
export function phoneWeight(channels: Float32Array[], sampleRate: number): Float32Array[] {
  return channels.map((src) => {
    const hp = new Biquad();
    hp.set('highpass', 220, sampleRate, 0);
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) out[i] = hp.process(src[i]!);
    return out;
  });
}
