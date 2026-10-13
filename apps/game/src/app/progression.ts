/**
 * Progression (PRD §8): XP from score, a player level, and cosmetics unlocked by level. Nothing
 * here changes gameplay.
 */
import type { HighwayStyle, NoteSkin } from '../save/schema';

export function xpFromScore(score: number): number {
  return Math.round(score / 100);
}

export function levelFor(xp: number): number {
  return 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 500));
}

/** XP at which `level` starts. */
export function xpForLevel(level: number): number {
  return (level - 1) * (level - 1) * 500;
}

export interface Cosmetic<T extends string> {
  id: T;
  name: string;
  desc: string;
  level: number;
}

export const NOTE_SKIN_LIST: readonly Cosmetic<NoteSkin>[] = [
  { id: 'classic', name: 'Classic', desc: 'Rounded gems with a highlight', level: 1 },
  { id: 'neon', name: 'Neon', desc: 'Outlined gems that glow in the lane colour', level: 3 },
  { id: 'pixel', name: 'Pixel', desc: 'Chunky blocks with a hard shadow', level: 6 },
  { id: 'glass', name: 'Glass', desc: 'Translucent gems with a bright rim', level: 10 },
];

export const HIGHWAY_LIST: readonly Cosmetic<HighwayStyle>[] = [
  { id: 'default', name: 'Default', desc: 'Dark lanes, accent edges', level: 1 },
  { id: 'grid', name: 'Grid', desc: 'Lane dividers plus a faint cross grid', level: 4 },
  { id: 'minimal', name: 'Minimal', desc: 'No dividers, just the edges and the line', level: 8 },
];

export function unlocked<T extends string>(c: Cosmetic<T>, level: number): boolean {
  return level >= c.level;
}
