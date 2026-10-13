/**
 * App state as Preact signals. Screens read these; the controller writes them. HUD values are
 * separate primitive signals so the frame loop sets them only when they change (no allocation
 * while values are stable).
 */
import { signal } from '@preact/signals';
import type {
  Difficulty,
  Grade,
  MoodId,
  Mode,
  PracticeRate,
  SessionSummary,
  JudgementEvent,
} from '@seedbeat/core';
import { DEFAULT_SETTINGS, defaultSave, type Save, type Settings } from '../save/schema';

export type Screen =
  | 'boot'
  | 'title'
  | 'select'
  | 'playing'
  | 'paused'
  | 'results'
  | 'settings'
  | 'calibration'
  | 'profile';

export interface Selection {
  mood: MoodId;
  mode: Mode;
  difficulty: Difficulty;
  seed: string;
  /** Practice (PRD §3): loop one section of the Song-mode chart, optionally slowed. */
  practice?: { section: number; rate: PracticeRate };
}

export type RunKind = 'song' | 'endless' | 'daily' | 'practice' | 'tutorial';

export interface RunResult {
  summary: SessionSummary;
  selection: Selection;
  songName: string;
  bpm: number;
  isBest: boolean;
  /** Song time of each judged hit and its signed offset (for the timing graph). */
  events: JudgementEvent[];
  durationSec: number;
  /** Endless: bars survived and peak level. */
  bars?: number;
  peakLevel?: number;
  grade: Grade;
  stars: number;
  kind: RunKind;
  /** Practice: completed loops of the section. */
  loops?: number;
  /** Daily: streak after this run. */
  streak?: number;
  /** Achievement ids earned by this run. */
  achievements: string[];
  /** New player level when this run levelled up. */
  levelUp: number | null;
  /** Score was recorded (not practice, tutorial, no-fail or a failed song). */
  recorded: boolean;
}

export const screen = signal<Screen>('boot');
/** Screens to return to as overlays (settings, calibration, profile) close, innermost last. */
export const returnStack = signal<Screen[]>([]);
export const selection = signal<Selection>({
  mood: 'synthwave',
  mode: 'song',
  difficulty: 1,
  seed: 'amber-11',
});
export const settings = signal<Settings>(DEFAULT_SETTINGS);
export const save = signal<Save>(defaultSave());
export const results = signal<RunResult | null>(null);
export const listening = signal(false);
/** Beats left in the resume countdown (0 = none). */
export const countdown = signal(0);
export const audioReady = signal(false);
export const toast = signal<string | null>(null);

export const hudScore = signal(0);
export const hudAcc = signal('100.0%');
export const hudSection = signal('Get ready');
export const hudHealth = signal(1);
export const hudProgress = signal(0);
/** Tutorial prompt text ('' when none). */
export const hudPrompt = signal('');
/** The current run is the tutorial (HUD shows Skip). */
export const hudTutorial = signal(false);

export function showToast(message: string, ms = 2200): void {
  toast.value = message;
  setTimeout(() => {
    if (toast.value === message) toast.value = null;
  }, ms);
}
