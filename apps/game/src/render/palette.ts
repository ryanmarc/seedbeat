import { MOODS, type MoodId } from '@seedbeat/core';

export type LanePaletteId = 'mood' | 'cb-a' | 'cb-b' | 'high-contrast' | 'guitar';

export interface Palette {
  lane: [number, number, number, number];
  accent: number;
  accent2: number;
  bg: number;
}

export const CHROME = {
  background: 0x0b0912,
  ink: 0xf3effc,
  dim: 0xa39cbd,
  good: 0x7cf29a,
  bad: 0xff5d6c,
  missedGrey: 0x777777,
} as const;

/** Colour-blind safe lane palettes (DESIGN.md §2). */
const CB_A: [number, number, number, number] = [0xe69f00, 0x56b4e9, 0x009e73, 0xcc79a7];
const CB_B: [number, number, number, number] = [0xffffff, 0xffd400, 0x00e5ff, 0xff4fd8];
/** Guitar controller fret colours: green, red, yellow, blue (orange shares the blue lane). */
const GUITAR: [number, number, number, number] = [0x3ddc5a, 0xff3b47, 0xffd60a, 0x3b82ff];

export function hexToNumber(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

export function paletteFor(mood: MoodId, lanes: LanePaletteId = 'mood'): Palette {
  const p = MOODS[mood].palette;
  const moodLanes = p.lane.map(hexToNumber) as [number, number, number, number];
  return {
    lane:
      lanes === 'cb-a'
        ? CB_A
        : lanes === 'cb-b' || lanes === 'high-contrast'
          ? CB_B
          : lanes === 'guitar'
            ? GUITAR
            : moodLanes,
    accent: hexToNumber(p.accent),
    accent2: hexToNumber(p.accent2),
    bg: hexToNumber(p.bg),
  };
}

/** Mix two colours (0..1). */
export function mix(a: number, b: number, t: number): number {
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}
