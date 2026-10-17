/**
 * Save schema (ARCHITECTURE.md §7). Versioned; `migrate` upgrades any older shape to the current
 * one. Everything is local; export/import moves the whole object as JSON.
 */
import type { Difficulty, Grade, MoodId, Mode } from '@seedbeat/core';

export const SAVE_VERSION = 1;
export type LanePalette = 'mood' | 'cb-a' | 'cb-b' | 'high-contrast' | 'guitar';
export const LANE_PALETTES: readonly LanePalette[] = [
  'mood',
  'cb-a',
  'cb-b',
  'high-contrast',
  'guitar',
];
/** Guitar controller: 'strum' needs a strum with the fret held (Guitar Hero); 'tap' treats frets as keys. */
export type GuitarMode = 'strum' | 'tap';
export const GUITAR_MODES: readonly GuitarMode[] = ['strum', 'tap'];
export type QualityMode = 'auto' | 'high' | 'battery';
export type FrameCap = 'auto' | 60 | 30;
/** AudioContext buffer: 'low' = interactive (tightest), 'balanced', 'stable' = playback (largest). */
export type AudioBuffer = 'low' | 'balanced' | 'stable';
export const AUDIO_BUFFERS: readonly AudioBuffer[] = ['low', 'balanced', 'stable'];
export type NoteSkin = 'classic' | 'neon' | 'pixel' | 'glass';
export type HighwayStyle = 'default' | 'grid' | 'minimal';
export const NOTE_SKINS: readonly NoteSkin[] = ['classic', 'neon', 'pixel', 'glass'];
export const HIGHWAY_STYLES: readonly HighwayStyle[] = ['default', 'grid', 'minimal'];

export interface Settings {
  /** Note speed multiplier 0.75–2 (scales approach time inversely). */
  noteSpeed: number;
  noFail: boolean;
  hitLineHigh: boolean;
  lanePalette: LanePalette;
  showEarlyLate: boolean;
  judgementTextSize: 'small' | 'normal' | 'large';
  audioOffsetMs: number;
  visualOffsetMs: number;
  masterVolume: number;
  musicVolume: number;
  hitVolume: number;
  hitSounds: boolean;
  haptics: boolean;
  keys: [string, string, string, string];
  guitarMode: GuitarMode;
  reducedMotion: 'system' | 'on' | 'off';
  quality: QualityMode;
  frameCap: FrameCap;
  /** Output buffer size; larger absorbs scheduling hiccups on phones at the cost of latency (calibration compensates). */
  audioBuffer: AudioBuffer;
  diagnostics: boolean;
  /** Menu blips from the synth. */
  menuSounds: boolean;
  /** Cosmetics unlocked by level (PRD §8); no gameplay effect. */
  noteSkin: NoteSkin;
  highwayStyle: HighwayStyle;
}

export interface Best {
  score: number;
  acc: number;
  grade: Grade;
  fc: boolean;
  stars: number;
  at: number;
  /** Endless: bars survived. */
  bars?: number;
}

export interface SaveV1 {
  v: 1;
  settings: Settings;
  calibration: {
    audioOffsetMs: number;
    visualOffsetMs: number;
    measuredAt: number;
    device: string;
  } | null;
  bests: Record<string, Best>;
  recents: string[];
  favourites: string[];
  daily: Record<string, { score: number; grade: Grade; difficulty: Difficulty }>;
  /** Consecutive UTC days with a daily clear; `last` is the most recent day (YYYY-MM-DD). */
  streak: { current: number; last: string };
  profile: {
    xp: number;
    level: number;
    plays: number;
    playSec: number;
    achievements: string[];
    tutorialDone: boolean;
    practiceRuns: number;
  };
  quality: { tier: number; lockedThisDevice: boolean };
}

export type Save = SaveV1;

export const DEFAULT_SETTINGS: Settings = {
  noteSpeed: 1,
  noFail: false,
  hitLineHigh: false,
  lanePalette: 'mood',
  showEarlyLate: true,
  judgementTextSize: 'normal',
  audioOffsetMs: 0,
  visualOffsetMs: 0,
  masterVolume: 1,
  musicVolume: 1,
  hitVolume: 0.8,
  hitSounds: false,
  haptics: true,
  keys: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
  guitarMode: 'strum',
  reducedMotion: 'system',
  quality: 'auto',
  frameCap: 'auto',
  audioBuffer: 'low',
  diagnostics: false,
  menuSounds: true,
  noteSkin: 'classic',
  highwayStyle: 'default',
};

export function defaultSave(): SaveV1 {
  return {
    v: 1,
    settings: { ...DEFAULT_SETTINGS, keys: [...DEFAULT_SETTINGS.keys] },
    calibration: null,
    bests: {},
    recents: [],
    favourites: [],
    daily: {},
    streak: { current: 0, last: '' },
    profile: {
      xp: 0,
      level: 1,
      plays: 0,
      playSec: 0,
      achievements: [],
      tutorialDone: false,
      practiceRuns: 0,
    },
    quality: { tier: 0, lockedThisDevice: false },
  };
}

/** `${generatorVersion}:${mood}:${mode}:${difficulty}:${seed}` */
export function songKey(
  gen: number,
  mood: MoodId,
  mode: Mode,
  difficulty: Difficulty,
  seed: string,
): string {
  return `${gen}:${mood}:${mode}:${difficulty}:${seed}`;
}

/**
 * Upgrade any stored value to the current schema. Unknown or corrupt input yields defaults;
 * known fields are kept, missing ones filled, so adding a setting never breaks old saves.
 */
/**
 * Upgrade any stored shape to the current one. `platform` supplies device-dependent defaults for
 * settings the stored save does not have yet (see platform/defaults.ts).
 */
export function migrate(raw: unknown, platform: Partial<Settings> = {}): SaveV1 {
  const d = defaultSave();
  Object.assign(d.settings, platform);
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<SaveV1> & { v?: number };
  // v0 (prototype localStorage) or v1: same shape as far as we read it.
  const settings = { ...d.settings, ...(isObject(r.settings) ? r.settings : {}) } as Settings;
  if (!Array.isArray(settings.keys) || settings.keys.length !== 4)
    settings.keys = [...DEFAULT_SETTINGS.keys];
  settings.noteSpeed = clampNum(settings.noteSpeed, 0.75, 2, 1);
  settings.masterVolume = clampNum(settings.masterVolume, 0, 1, 1);
  settings.musicVolume = clampNum(settings.musicVolume, 0, 1, 1);
  settings.hitVolume = clampNum(settings.hitVolume, 0, 1, 0.8);
  settings.audioOffsetMs = clampNum(settings.audioOffsetMs, -500, 500, 0);
  settings.visualOffsetMs = clampNum(settings.visualOffsetMs, -500, 500, 0);
  if (!NOTE_SKINS.includes(settings.noteSkin)) settings.noteSkin = 'classic';
  if (!LANE_PALETTES.includes(settings.lanePalette)) settings.lanePalette = 'mood';
  if (!GUITAR_MODES.includes(settings.guitarMode)) settings.guitarMode = 'strum';
  if (!HIGHWAY_STYLES.includes(settings.highwayStyle)) settings.highwayStyle = 'default';
  if (!AUDIO_BUFFERS.includes(settings.audioBuffer)) settings.audioBuffer = 'low';
  const profile = isObject(r.profile)
    ? { ...d.profile, ...(r.profile as Partial<SaveV1['profile']>) }
    : d.profile;
  if (!Array.isArray(profile.achievements)) profile.achievements = [];
  return {
    v: 1,
    settings,
    calibration: isObject(r.calibration) ? (r.calibration as SaveV1['calibration']) : null,
    bests: isObject(r.bests) ? (r.bests as Record<string, Best>) : {},
    recents: Array.isArray(r.recents)
      ? r.recents.filter((x): x is string => typeof x === 'string').slice(0, 20)
      : [],
    favourites: Array.isArray(r.favourites)
      ? r.favourites.filter((x): x is string => typeof x === 'string')
      : [],
    daily: isObject(r.daily) ? (r.daily as SaveV1['daily']) : {},
    streak: isObject(r.streak) ? { ...d.streak, ...(r.streak as SaveV1['streak']) } : d.streak,
    profile,
    quality: isObject(r.quality)
      ? { ...d.quality, ...(r.quality as SaveV1['quality']) }
      : d.quality,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

/** Mastery stars for a result (PRD §8): clear 1, A 2, S 3, full combo 4, all Perfect 5. */
export function starsFor(
  grade: Grade,
  fullCombo: boolean,
  allPerfect: boolean,
  failed: boolean,
): number {
  if (failed) return 0;
  if (allPerfect) return 5;
  if (fullCombo) return 4;
  if (grade === 'S') return 3;
  if (grade === 'A') return 2;
  return 1;
}
