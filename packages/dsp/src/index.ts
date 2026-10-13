/**
 * @seedbeat/dsp
 *
 * Pure DSP with no Web Audio types, so the same code renders offline in Node for tests
 * and inside the AudioWorklet in the browser. Filled in during M2.
 */

/** Render block size used by AudioWorklet; the sequencer and voice pool are sized around it. */
export const BLOCK_SIZE = 128;

/** Clamp a sample to the [-1, 1] range. */
export function clampSample(x: number): number {
  return x < -1 ? -1 : x > 1 ? 1 : x;
}
