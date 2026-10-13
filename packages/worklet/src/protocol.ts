/**
 * Message protocol between the main thread and the AudioWorklet.
 * Importable from both sides; contains types only, no runtime code beyond constants.
 * The full set of messages lands in M2 (start, pause, resume, stop, volumes, hitSound, status, rate).
 */
import type { GeneratorVersion, MoodId, Mode } from '@seedbeat/core';

export const PROTOCOL_VERSION = 1;

export type MainToWorklet =
  | {
      type: 'start';
      seed: string;
      mood: MoodId;
      mode: Mode;
      generatorVersion: GeneratorVersion;
      /** AudioContext time of bar 0's downbeat. */
      startTime: number;
    }
  | { type: 'stop' };

export type WorkletToMain =
  | { type: 'ready'; protocolVersion: number }
  | { type: 'status'; frame: number; ctxTime: number; bar: number };
