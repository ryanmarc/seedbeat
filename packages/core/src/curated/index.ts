/**
 * Curated seeds: authored songs behind specific seed words (any letter case). Part of
 * generator v1; only these seeds differ from the procedural output.
 */
import type { CuratedSong } from './build';
import { FRIDAY } from './friday';

export const CURATED: Readonly<Record<string, CuratedSong>> = {
  friday: FRIDAY,
};

function keyOf(seed: string): string {
  return seed.trim().toLowerCase();
}

/** Own keys only: a seed like `constructor` must not reach Object.prototype. */
function entry(key: string): CuratedSong | null {
  return Object.hasOwn(CURATED, key) ? CURATED[key]! : null;
}

export function findCurated(seed: string): CuratedSong | null {
  return entry(keyOf(seed));
}

/** The registry key when `seed` is curated, otherwise `seed` unchanged. */
export function canonicalSeed(seed: string): string {
  const k = keyOf(seed);
  return entry(k) ? k : seed;
}

export { FRIDAY };
export {
  parseMelody,
  tempoFor,
  noteToMidi,
  midiToDegree,
  type CuratedSong,
  type AuthoredNote,
  type CuratedBarChord,
  type CuratedProgression,
} from './build';
