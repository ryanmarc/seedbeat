import type { CuratedSong } from './build';

/**
 * "Friday" (Riton × Nightcrawlers ft. Mufasa & Hypeman, Dopamine re-edit). 123 BPM, B minor.
 * Melodies transcribed from the separated vocal stem on 2026-10-15 and tuned by ear; edit the
 * bar strings to correct notes. Tokens: note name, `.` rest, `-` extend the previous note.
 * Chorus = the main hook (track bars 11–18), verse = the second phrase (19–22),
 * bridge = the middle-section vocal line (51–58). Intro reuses verse, outro reuses chorus.
 */
export const FRIDAY: CuratedSong = {
  title: 'Friday',
  bpm: 123,
  scale: 'minor',
  root: 47, // B2
  progs: {
    chorus: [0, 0, 0, 5],
    verse: [0, 0, 5, 6],
    bridge: [0, 5, 2, 6],
  },
  melody: {
    chorus: [
      '.   .   .   .   .   .   E4  F#4 E4  -   D4  -   B3  C#4 D4  -',
      'D4  E4  -   -   B3  C#4 B3  A#3 A3  -   -   -   -   B3  -   A#3',
      '.   .   .   A3  -   -   -   -   .   A4  F#4 -   E4  -   -   F#4',
      'F#4 D4  -   E4  -   D4  -   .   .   .   .   F#4 D4  E4  -   -',
    ],
    verse: [
      '.   C#4 -   -   B3  C#4 A3  .   A3  B3  -   .   E4  F#4 -   -',
      'C#4 -   -   -   B3  C#4 A3  -   -   B3  -   .   E4  F#4 -   -',
    ],
    bridge: [
      'E4  F#4 -   .   .   E4  -   .   .   .   C#4 -   -   -   -   -',
      'C#4 -   D4  -   -   -   -   .   .   .   A3  -   .   A3  -   -',
    ],
  },
};
