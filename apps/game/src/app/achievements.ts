/**
 * Achievements (PRD §8): about twenty local, checked when a run finishes. Each check is a pure
 * function of the save (after the run was recorded) and the run that just ended.
 */
import { MOOD_IDS, type Grade, type SessionSummary } from '@seedbeat/core';
import type { Save } from '../save/schema';
import { currentStreak } from './daily';
import type { Selection } from './state';

export interface FinishedRun {
  selection: Selection;
  summary: SessionSummary;
  grade: Grade;
  /** Song mode: cleared (not failed, no-fail off). */
  cleared: boolean;
  /** Endless: bars survived. */
  bars: number;
  daily: boolean;
  practice: boolean;
  tutorial: boolean;
  /** UTC day of the run (for streaks). */
  day: string;
}

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  check(save: Save, run: FinishedRun): boolean;
}

const scored = (r: FinishedRun): boolean => !r.practice && !r.tutorial;
const moodOf = (key: string): string => key.split(':')[1] ?? '';
const modeOf = (key: string): string => key.split(':')[2] ?? '';
const diffOf = (key: string): number => Number(key.split(':')[3]);

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'tutorial', name: 'First steps', desc: 'Finish the tutorial', check: (_, r) => r.tutorial },
  {
    id: 'first-clear',
    name: 'Cleared',
    desc: 'Clear a song',
    check: (_, r) => scored(r) && r.cleared,
  },
  {
    id: 'grade-a',
    name: 'A game',
    desc: 'Earn an A on a song',
    check: (_, r) => scored(r) && r.cleared && (r.grade === 'A' || r.grade === 'S'),
  },
  {
    id: 'grade-s',
    name: 'S tier',
    desc: 'Earn an S on a song',
    check: (_, r) => scored(r) && r.cleared && r.grade === 'S',
  },
  {
    id: 'combo-50',
    name: 'Fifty',
    desc: 'Reach a 50 combo',
    check: (_, r) => scored(r) && r.summary.maxCombo >= 50,
  },
  {
    id: 'combo-100',
    name: 'Century',
    desc: 'Reach a 100 combo',
    check: (_, r) => scored(r) && r.summary.maxCombo >= 100,
  },
  {
    id: 'combo-200',
    name: 'Double century',
    desc: 'Reach a 200 combo',
    check: (_, r) => scored(r) && r.summary.maxCombo >= 200,
  },
  {
    id: 'full-combo',
    name: 'Full combo',
    desc: 'Clear a song without a miss',
    check: (_, r) => scored(r) && r.cleared && r.summary.fullCombo,
  },
  {
    id: 'all-perfect',
    name: 'Flawless',
    desc: 'Clear a song with every hit Perfect',
    check: (_, r) => scored(r) && r.cleared && r.summary.allPerfect,
  },
  {
    id: 'endless-32',
    name: 'Marathon',
    desc: 'Survive 32 Endless bars',
    check: (_, r) => scored(r) && r.selection.mode === 'endless' && r.bars >= 32,
  },
  {
    id: 'endless-64',
    name: 'Ultra',
    desc: 'Survive 64 Endless bars',
    check: (_, r) => scored(r) && r.selection.mode === 'endless' && r.bars >= 64,
  },
  {
    id: 'endless-128',
    name: 'Beyond',
    desc: 'Survive 128 Endless bars',
    check: (_, r) => scored(r) && r.selection.mode === 'endless' && r.bars >= 128,
  },
  {
    id: 'expert-clear',
    name: 'Expert',
    desc: 'Clear a song on Expert',
    check: (_, r) => scored(r) && r.cleared && r.selection.difficulty === 3,
  },
  {
    id: 'all-moods',
    name: 'Four worlds',
    desc: 'Clear a song in every mood',
    check: (s) =>
      MOOD_IDS.every((m) =>
        Object.keys(s.bests).some((k) => moodOf(k) === m && modeOf(k) === 'song'),
      ),
  },
  {
    id: 'all-moods-hard',
    name: 'Hard everywhere',
    desc: 'Clear a song in every mood on Hard or Expert',
    check: (s) =>
      MOOD_IDS.every((m) =>
        Object.keys(s.bests).some((k) => moodOf(k) === m && modeOf(k) === 'song' && diffOf(k) >= 2),
      ),
  },
  {
    id: 'seeds-10',
    name: 'Collector',
    desc: 'Set a best on 10 different seeds',
    check: (s) => new Set(Object.keys(s.bests).map((k) => k.split(':')[4])).size >= 10,
  },
  {
    id: 'daily-first',
    name: 'Today',
    desc: 'Clear a daily seed',
    check: (_, r) => r.daily && r.cleared,
  },
  {
    id: 'streak-3',
    name: 'Three in a row',
    desc: 'Keep a 3-day daily streak',
    check: (s, r) => currentStreak(s.streak, r.day) >= 3,
  },
  {
    id: 'streak-7',
    name: 'One week',
    desc: 'Keep a 7-day daily streak',
    check: (s, r) => currentStreak(s.streak, r.day) >= 7,
  },
  {
    id: 'practice',
    name: 'Woodshed',
    desc: 'Finish a practice session',
    check: (_, r) => r.practice,
  },
  { id: 'plays-10', name: 'Regular', desc: 'Play 10 runs', check: (s) => s.profile.plays >= 10 },
  { id: 'plays-100', name: 'Devoted', desc: 'Play 100 runs', check: (s) => s.profile.plays >= 100 },
  {
    id: 'level-5',
    name: 'Level 5',
    desc: 'Reach player level 5',
    check: (s) => s.profile.level >= 5,
  },
  {
    id: 'level-10',
    name: 'Level 10',
    desc: 'Reach player level 10',
    check: (s) => s.profile.level >= 10,
  },
];

/** Ids newly earned by this run (not already in the save). */
export function newAchievements(save: Save, run: FinishedRun): string[] {
  const have = new Set(save.profile.achievements);
  return ACHIEVEMENTS.filter((a) => !have.has(a.id) && a.check(save, run)).map((a) => a.id);
}

export function achievementById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}
