/**
 * @seedbeat/core
 *
 * Pure, deterministic TypeScript. The same seed, mood, mode and difficulty must produce
 * byte-identical songs and charts on every platform, so this package has no DOM, no audio,
 * no I/O, no `Math.random` and no `Date`. The tsconfig (no DOM lib, no ambient types) and
 * the ESLint rules for this folder enforce that.
 *
 * Generator v1 is a port of the prototype with every random draw in the same order; the golden
 * fixtures in tools/golden prove it. v1 is frozen: changes go into a new generator version.
 */

/** Generator versions that can produce songs. v1 is frozen once shipped; old versions stay playable. */
export const GENERATOR_VERSIONS = [1] as const;
export type GeneratorVersion = (typeof GENERATOR_VERSIONS)[number];

/** The generator version new songs are created with. */
export const CURRENT_GENERATOR_VERSION: GeneratorVersion = 1;

export function isGeneratorVersion(v: number): v is GeneratorVersion {
  return (GENERATOR_VERSIONS as readonly number[]).includes(v);
}

export { hash32, mulberry, rngFor, type Rng } from './rng';
export { SCALES, degToMidi, snap, type Scale, type ScaleName } from './theory';
export {
  MOODS,
  MOOD_IDS,
  DRUMS,
  SECT,
  INTENSITY,
  SECTION_TYPES,
  patternHit,
  type MoodId,
  type MoodDef,
  type SectionType,
  type DrumMode,
  type Progression,
} from './moods';
export {
  makeSong,
  sectionFor,
  stepTime,
  MODES,
  type Mode,
  type Song,
  type SongSection,
  type SectionInfo,
} from './song';
export { getMotif, type Motif, type MotifNote } from './motif';
export { getBar, type Bar, type BarEvent, type EventType, type LeadNote } from './bars';
export {
  buildChart,
  chartBar,
  levelAt,
  approachAt,
  LEVELS,
  APPROACH_BASE,
  DIFFICULTY_NAMES,
  type Chart,
  type ChartNote,
  type Difficulty,
  type DifficultyName,
} from './chart';
export {
  WINDOWS,
  MISS_GRACE,
  SCORE,
  ACCURACY,
  HEALTH,
  EASY_PENALTY_SCALE,
  judgeHit,
  judgeRelease,
  isRelease,
  isBreak,
  multiplier,
  gradeFor,
  type Judgement,
  type HitJudgement,
  type ReleaseJudgement,
  type Grade,
} from './judgement';
export {
  createSession,
  appendNotes,
  press,
  release,
  dropHolds,
  update,
  accuracy,
  grade,
  summarize,
  type SessionState,
  type SessionNote,
  type SessionOptions,
  type SessionSummary,
  type JudgementEvent,
} from './session';
export {
  ReplayRecorder,
  decodeInputs,
  replaySession,
  songEndTime,
  type ReplayV1,
  type ReplayInput,
} from './replay';
