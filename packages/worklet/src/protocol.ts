/**
 * Message protocol between the main thread and the AudioWorklet (ARCHITECTURE.md §3).
 * Types only; importable from both sides.
 */
import type { GeneratorVersion, MoodId, Mode } from '@seedbeat/core';
import type { UiSound } from '@seedbeat/dsp';

export type { UiSound };

/** Name the processor registers under; the main thread passes it to AudioWorkletNode. */
export const PROCESSOR_NAME = 'seedbeat';
export const PROTOCOL_VERSION = 1;
export const STATUS_INTERVAL_SEC = 0.25;

export type Judgement = 'perfect' | 'great' | 'good' | 'miss';

export type MainToWorklet =
  | {
      type: 'start';
      seed: string;
      mood: MoodId;
      mode: Mode;
      generatorVersion: GeneratorVersion;
      /** AudioContext time (seconds) of bar 0's downbeat. */
      startTime: number;
      /** Playback rate (Practice: 0.75 or 0.5). Default 1. */
      rate?: number;
      /** Play four count-in clicks before bar 0. */
      countIn?: boolean;
      /** Begin at this bar (Practice loops). Default 0. */
      fromBar?: number;
      /** Stop after this bar (exclusive). Default: song end, or never for endless. */
      toBar?: number;
      /** Practice: on reaching `toBar`, continue seamlessly from `fromBar` instead of ending. */
      loop?: boolean;
    }
  | { type: 'pause' }
  | {
      /** Hardware callback period (AudioContext.baseLatency), so the stall meter need not guess it. */
      type: 'period';
      ms: number;
    }
  | {
      type: 'resume';
      /** AudioContext time at which playback continues from the paused position. */
      atTime: number;
    }
  | { type: 'stop' }
  | {
      /** Calibration: `count` clicks every `interval` seconds from `startTime` (AudioContext seconds). */
      type: 'clicks';
      startTime: number;
      count: number;
      interval: number;
    }
  | { type: 'volumes'; master?: number; music?: number; hit?: number; ui?: number }
  | { type: 'hitSound'; judgement: Judgement }
  /** Menu blip, played now at the UI volume (independent of hit-sound volume). */
  | { type: 'ui'; sound: UiSound };

export interface StatusMessage {
  type: 'status';
  /** Song position in frames at `ctxTime` (frames since bar 0, at the playback rate). */
  frame: number;
  /** AudioContext time of the first frame of the block this status was taken from. */
  ctxTime: number;
  bar: number;
  step: number;
  playing: boolean;
  voices: number;
  peakVoices: number;
  steals: number;
  /** Audio-thread stall detector (stall-meter.ts): learned callback period and gaps above it. */
  periodMs: number;
  maxGapMs: number;
  stalls: number;
  lastStallMs: number;
  maxBusyMs: number;
}

export type WorkletToMain =
  | { type: 'ready'; protocolVersion: number; latencyFrames: number }
  | StatusMessage
  | { type: 'ended' }
  | { type: 'error'; message: string };
