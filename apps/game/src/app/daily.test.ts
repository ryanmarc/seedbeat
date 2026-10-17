import { describe, expect, it } from 'vitest';
import {
  currentStreak,
  dailyMood,
  dailySeed,
  dailySelection,
  dayIndex,
  isDaily,
  nextStreak,
  previousDay,
  utcDay,
} from './daily';
import { ACHIEVEMENTS, newAchievements, type FinishedRun } from './achievements';
import {
  HIGHWAY_LIST,
  NOTE_SKIN_LIST,
  levelFor,
  unlocked,
  xpForLevel,
  xpFromScore,
} from './progression';
import { defaultSave } from '../save/schema';
import type { Selection } from './state';
import { WebHaptics, hapticFor } from '../platform/haptics';

describe('daily seed', () => {
  it('derives the seed from the UTC day and rotates moods daily', () => {
    expect(utcDay(new Date('2026-10-13T23:59:00Z'))).toBe('2026-10-13');
    expect(utcDay(new Date('2026-10-13T23:59:00-05:00'))).toBe('2026-10-14');
    expect(dailySeed('2026-10-13')).toBe('daily-2026-10-13');
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(dayIndex('1970-01-02')).toBe(1);
    const moods = ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'].map(dailyMood);
    expect(new Set(moods).size).toBe(4);
    expect(dailyMood('2026-10-17')).toBe(moods[0]);
  });
  it('recognises the daily selection regardless of difficulty', () => {
    const base: Selection = { mood: 'lofi', mode: 'endless', difficulty: 2, seed: 'x' };
    const d = dailySelection('2026-10-13', base);
    expect(d.mode).toBe('song');
    expect(isDaily(d, '2026-10-13')).toBe(true);
    expect(isDaily({ ...d, difficulty: 0 }, '2026-10-13')).toBe(true);
    expect(isDaily({ ...d, seed: 'y' }, '2026-10-13')).toBe(false);
    expect(isDaily(d, '2026-10-14')).toBe(false);
  });
  it('streaks extend on consecutive days and restart after a gap', () => {
    let s = { current: 0, last: '' };
    s = nextStreak(s, '2026-10-13');
    expect(s).toEqual({ current: 1, last: '2026-10-13' });
    expect(nextStreak(s, '2026-10-13')).toEqual(s);
    s = nextStreak(s, '2026-10-14');
    expect(s.current).toBe(2);
    expect(currentStreak(s, '2026-10-15')).toBe(2);
    expect(currentStreak(s, '2026-10-16')).toBe(0);
    expect(nextStreak(s, '2026-10-20')).toEqual({ current: 1, last: '2026-10-20' });
  });
});

describe('progression', () => {
  it('levels from XP and unlocks cosmetics by level', () => {
    expect(xpFromScore(123_456)).toBe(1235);
    expect(levelFor(0)).toBe(1);
    expect(levelFor(499)).toBe(1);
    expect(levelFor(500)).toBe(2);
    expect(levelFor(xpForLevel(7))).toBe(7);
    expect(NOTE_SKIN_LIST[0]!.level).toBe(1);
    expect(unlocked(NOTE_SKIN_LIST[1]!, 2)).toBe(false);
    expect(unlocked(NOTE_SKIN_LIST[1]!, 3)).toBe(true);
    expect(HIGHWAY_LIST.map((h) => h.id)).toEqual(['default', 'grid', 'minimal']);
  });
});

describe('achievements', () => {
  const run = (over: Partial<FinishedRun> = {}): FinishedRun => ({
    selection: { mood: 'chiptune', mode: 'song', difficulty: 2, seed: 'a' },
    summary: {
      score: 1000,
      accuracy: 0.9,
      grade: 'A',
      maxCombo: 60,
      counts: { perfect: 1, great: 1, good: 1, miss: 0, holds: 0 },
      failed: false,
      fullCombo: true,
      allPerfect: false,
      lateInputs: 0,
    },
    grade: 'A',
    cleared: true,
    bars: 0,
    daily: false,
    practice: false,
    tutorial: false,
    day: '2026-10-13',
    ...over,
  });
  it('has about twenty with unique ids', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
  it('awards run-based ones once and skips practice and tutorial runs', () => {
    const save = defaultSave();
    const got = newAchievements(save, run());
    expect(got).toEqual(
      expect.arrayContaining(['first-clear', 'grade-a', 'combo-50', 'full-combo']),
    );
    expect(got).not.toContain('grade-s');
    save.profile.achievements = got;
    expect(newAchievements(save, run())).toEqual([]);
    expect(newAchievements(defaultSave(), run({ practice: true }))).toEqual(['practice']);
    expect(newAchievements(defaultSave(), run({ tutorial: true }))).toEqual(['tutorial']);
  });
  it('reads save-wide conditions', () => {
    const save = defaultSave();
    for (const m of ['lofi', 'synthwave', 'chiptune', 'techno'])
      save.bests[`1:${m}:song:2:seed-${m}`] = {
        score: 1,
        acc: 1,
        grade: 'S',
        fc: true,
        stars: 4,
        at: 0,
      };
    save.streak = { current: 3, last: '2026-10-13' };
    save.profile.level = 5;
    const got = newAchievements(
      save,
      run({
        selection: { mood: 'lofi', mode: 'endless', difficulty: 0, seed: 'z' },
        bars: 70,
        cleared: false,
      }),
    );
    expect(got).toEqual(
      expect.arrayContaining([
        'all-moods',
        'all-moods-hard',
        'streak-3',
        'level-5',
        'endless-32',
        'endless-64',
      ]),
    );
    expect(got).not.toContain('endless-128');
    expect(got).not.toContain('first-clear');
  });
});

describe('haptics', () => {
  it('maps judgements to pulses and throttles to one per 40 ms', () => {
    expect(hapticFor('perfect')).toBe('light');
    expect(hapticFor('good')).toBe('soft');
    expect(hapticFor('miss')).toBe('miss');
    const calls: (number | number[])[] = [];
    let now = 0;
    const h = new WebHaptics(
      (p) => (calls.push(p), true),
      () => now,
    );
    expect(h.available).toBe(true);
    h.pulse('light');
    h.pulse('miss');
    expect(calls).toEqual([12]);
    now = 45;
    h.pulse('miss');
    expect(calls).toEqual([12, [18, 40, 18]]);
    h.enabled = false;
    now = 100;
    h.pulse('light');
    expect(calls.length).toBe(2);
    expect(new WebHaptics(null).available).toBe(false);
  });
});
