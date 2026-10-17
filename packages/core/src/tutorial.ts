/**
 * Tutorial (PRD §3): a scripted lesson over a fixed song. Taps, then chords, then holds, then a stretch of the song's own Easy chart. Hand-authored notes sit on beats, which
 * every mood's drum pattern marks, so the lesson still follows the music. Pure and deterministic.
 */
import { buildChart, type ChartNote } from './chart';
import type { MoodId } from './moods';
import { stepTime, type Song } from './song';

export const TUTORIAL_SEED = 'first-steps';
export const TUTORIAL_MOOD: MoodId = 'synthwave';

export interface TutorialPrompt {
  /** Bar at which the prompt appears. */
  bar: number;
  text: string;
}

export interface TutorialChart {
  notes: ChartNote[];
  prompts: TutorialPrompt[];
  /** Bars played (the music stops here). */
  totalBars: number;
}

const TAP_BARS = [1, 2, 3, 4];
const CHORD_BARS = [6, 7, 8, 9];
const HOLD_BARS = [11, 12, 13, 14];
const SONG_FROM = 16;
const SONG_BARS = 16;

export function tutorialChart(song: Song): TutorialChart {
  if (song.total === null) throw new Error('tutorial needs a Song-mode song');
  const notes: ChartNote[] = [];
  const laneFree = [-9, -9, -9, -9];
  const put = (bar: number, step: number, lane: number, holdSteps = 0): void => {
    const t = stepTime(song, bar, step);
    if (t < laneFree[lane]!) return;
    const end = holdSteps ? bar * song.barDur + (step + holdSteps) * song.sd : 0;
    notes.push({ t, lane, end });
    laneFree[lane] = end ? end + song.sd * 1.5 : t + song.sd * 0.5;
  };

  // Taps: one note per beat, walking across the lanes.
  TAP_BARS.forEach((bar, i) => {
    for (let beat = 0; beat < 4; beat++) put(bar, beat * 4, (i + beat) % 4);
  });
  // Chords: two notes together on beats 1 and 3.
  CHORD_BARS.forEach((bar, i) => {
    for (const beat of [0, 2]) {
      const a = (i + beat) % 4;
      put(bar, beat * 4, a);
      put(bar, beat * 4, (a + 2) % 4);
    }
  });
  // Holds: a two-beat hold on beat 1; the last two bars add a second on beat 3.
  HOLD_BARS.forEach((bar, i) => {
    put(bar, 0, i % 4, 8);
    if (i >= 2) put(bar, 8, (i + 2) % 4, 8);
  });
  // The song's own Easy chart for a stretch, ending on a section boundary.
  const totalBars = sectionEndAfter(song, SONG_FROM + SONG_BARS);
  const from = SONG_FROM * song.barDur;
  for (const n of buildChart(song, 0, totalBars).notes) {
    if (n.t < from || n.t < laneFree[n.lane]!) continue;
    notes.push(n);
    laneFree[n.lane] = n.end ? n.end + song.sd * 1.5 : n.t + song.sd * 0.5;
  }
  notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
  return {
    notes,
    prompts: [
      {
        bar: 0,
        text: 'Notes fall toward the line. Tap the lane (its pad or key) when one reaches it.',
      },
      { bar: 5, text: 'Chords: two notes arrive together. Tap both lanes at once.' },
      {
        bar: 10,
        text: 'Holds: press on the head and keep holding. The tail pays out as it reaches the line.',
      },
      { bar: 15, text: 'Now a short stretch of the song. You cannot fail here.' },
    ],
    totalBars,
  };
}

/** End (exclusive) of the section containing `bar`, clamped to the song. */
function sectionEndAfter(song: Song, bar: number): number {
  for (const s of song.sections)
    if (bar < s.start + s.len) return Math.min(song.total!, s.start + s.len);
  return song.total!;
}
