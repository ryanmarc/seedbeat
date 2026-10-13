import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const FIXTURE_DIR = join(import.meta.dirname, 'fixtures', 'v1');

export type Mood = 'lofi' | 'synthwave' | 'chiptune' | 'techno';
export type Mode = 'song' | 'endless';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface IndexRow {
  file: string;
  mood: Mood;
  mode: Mode;
  seed: string;
  bpm: number;
  name: string;
  totalBars: number | null;
  eventBars: number;
  notes: Record<Difficulty, number>;
}

export interface Section {
  type: 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro';
  len: number;
  start: number;
}

export interface FixtureMeta {
  generatorVersion: number;
  seed: string;
  mood: Mood;
  mode: Mode;
  bpm: number;
  scale: string;
  rootMidi: number;
  swing: number;
  stepSec: number;
  barSec: number;
  totalBars: number | null;
  name: string;
  progressions: Record<string, number[]>;
  patternIdx: Record<string, number>;
  stabSteps: number[];
  sections: Section[];
}

export interface LeadNote {
  step: number;
  deg: number;
  len: number;
  lane: number;
}

export interface BarEvent {
  step: number;
  type: string;
  [k: string]: unknown;
}

export interface FixtureBar {
  bar: number;
  section: { type: string; len: number; barIn: number; cycle: number; transpose: number };
  lead: LeadNote[];
  events: BarEvent[];
}

/** [timeSec, lane, tailSec or 0] */
export type ChartNote = [number, number, number];

export interface Fixture {
  meta: FixtureMeta;
  bars: FixtureBar[];
  charts: Record<Difficulty, ChartNote[]>;
}

export function readIndex(): IndexRow[] {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, 'index.json'), 'utf8')) as IndexRow[];
}

export function readFixture(file: string): Fixture {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8')) as Fixture;
}

export function listFixtureFiles(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .sort();
}
