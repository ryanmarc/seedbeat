/**
 * Daily seed (PRD §3): one seed per UTC day, `daily-YYYY-MM-DD`, with a fixed mood rotation so
 * every player gets the same song. Pure functions of the day string; the controller supplies
 * the date (core never reads the clock).
 */
import { MOOD_IDS, type MoodId } from '@seedbeat/core';
import type { Selection } from './state';

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` in UTC. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Days since the Unix epoch for a `YYYY-MM-DD` string. */
export function dayIndex(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
}

export function previousDay(day: string): string {
  return new Date((dayIndex(day) - 1) * DAY_MS).toISOString().slice(0, 10);
}

export function dailySeed(day: string): string {
  return `daily-${day}`;
}

/** Mood rotates one step per day. */
export function dailyMood(day: string): MoodId {
  return MOOD_IDS[((dayIndex(day) % MOOD_IDS.length) + MOOD_IDS.length) % MOOD_IDS.length]!;
}

/** The selection a Daily button produces (difficulty is the player's). */
export function dailySelection(day: string, sel: Selection): Selection {
  return { ...sel, mood: dailyMood(day), seed: dailySeed(day), mode: 'song' };
}

/** A run counts as the day's daily when seed, mood and mode match (difficulty is free). */
export function isDaily(sel: Selection, day: string): boolean {
  return sel.seed === dailySeed(day) && sel.mood === dailyMood(day) && sel.mode === 'song';
}

/** Streak after completing a daily on `day`: consecutive days extend it, a gap restarts it. */
export function nextStreak(
  streak: { current: number; last: string },
  day: string,
): { current: number; last: string } {
  if (streak.last === day) return streak;
  if (streak.last === previousDay(day)) return { current: streak.current + 1, last: day };
  return { current: 1, last: day };
}

/** Streak as shown today: still alive if the last clear was today or yesterday. */
export function currentStreak(streak: { current: number; last: string }, today: string): number {
  return streak.last === today || streak.last === previousDay(today) ? streak.current : 0;
}
