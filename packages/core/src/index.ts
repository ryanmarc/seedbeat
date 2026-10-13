/**
 * @seedbeat/core
 *
 * Pure, deterministic TypeScript. The same seed, mood, mode and difficulty must produce
 * byte-identical songs and charts on every platform, so this package has no DOM, no audio,
 * no I/O, no `Math.random` and no `Date`. The tsconfig (no DOM lib, no ambient types) and
 * the ESLint rules for this folder enforce that.
 */

/** Generator versions that can produce songs. v1 is frozen once shipped; old versions stay playable. */
export const GENERATOR_VERSIONS = [1] as const;
export type GeneratorVersion = (typeof GENERATOR_VERSIONS)[number];

/** The generator version new songs are created with. */
export const CURRENT_GENERATOR_VERSION: GeneratorVersion = 1;

export const MOOD_IDS = ['lofi', 'synthwave', 'chiptune', 'techno'] as const;
export type MoodId = (typeof MOOD_IDS)[number];

export const MODES = ['song', 'endless'] as const;
export type Mode = (typeof MODES)[number];

export function isGeneratorVersion(v: number): v is GeneratorVersion {
  return (GENERATOR_VERSIONS as readonly number[]).includes(v);
}
