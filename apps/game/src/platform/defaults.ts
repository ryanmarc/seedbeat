import type { AudioBuffer } from '../save/schema';

/**
 * Settings whose best default depends on the device, applied when a save has no value yet.
 * Audio buffer: phones run the audio callback every 4–5 ms at the lowest setting, and V8's
 * occasional memory-reducing collection on the worklet thread (5–12 ms measured on a Galaxy S24)
 * then drops a buffer; the 20 ms buffer absorbs it and calibration absorbs the latency. Desktops
 * keep the tightest setting.
 */
export function platformDefaults(
  touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
): { audioBuffer: AudioBuffer } {
  return { audioBuffer: touch ? 'balanced' : 'low' };
}
