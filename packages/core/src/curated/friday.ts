import type { CuratedSong } from './build';

/**
 * "Friday" (Riton × Nightcrawlers ft. Mufasa & Hypeman, Dopamine re-edit). 123 BPM, B minor.
 * Melodies transcribed from the separated vocal stem (pyin, 16th grid, 2026-10-15); edit the
 * bar strings to correct notes. Tokens: note name, `.` rest, `-` extend the previous note.
 * Chorus = the main hook (track bars 11–18), verse = the second phrase (19–22),
 * bridge = the middle-section vocal line (51–58). Intro reuses verse, outro reuses chorus.
 */
export const FRIDAY: CuratedSong = {
  title: 'Friday',
  bpm: 123,
  scale: 'minor',
  root: 47, // B2
  // Vocal pitches are written as sung (4th octave); the synth leads sit an octave higher.
  transpose: 12,
  // Four on the floor, claps on 2 and 4, hats on the offbeats (drum stem).
  drums: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.' },
  // Bass stem, 2-bar figure in absolute pitches.
  bass: [
    '.   B1  -   .   .   .   .   F#1 -   .   F#2 -   .   F#2 -   .',
    '.   .   G1  .   .   .   .   D2  -   .   D2  -   .   D2  -   .',
  ],
  // Two chords per bar, a 2-bar loop: Bm | F# ‖ G | D.
  progs: {
    chorus: [
      [0, 4],
      [5, 2],
    ],
    verse: [
      [0, 4],
      [5, 2],
    ],
    bridge: [
      [0, 4],
      [5, 2],
    ],
  },
  melody: {
    // Main hook, track bars 11–14 (repeats 15–18 with small variations).
    chorus: [
      '.   .   .   .   .   .   .   F#4 E4  -   D4  .   .   C#4 D4  -',
      '.   E4  -   .   B3  C#4 -   B3  A3  -   .   A3  -   B3  -   -',
      '.   .   .   .   A3  -   -   .   .   A4  .   .   .   .   .   F#4',
      'F#4 D4  -   E4  -   D4  -   .   .   .   .   .   D4  E4  -   .',
    ],
    // Second phrase, track bars 19–22.
    verse: [
      '.   C#4 -   .   .   C#4 .   .   .   B3  -   .   .   F#4 -   .',
      '.   C#4 -   -   B3  .   A3  -   -   .   .   .   .   F#4 -   -',
      '.   .   C#4 -   -   -   .   .   .   .   B3  .   .   .   .   .',
      '.   F#4 -   .   C#4 -   -   -   .   A3  -   -   .   A3  -   .',
    ],
    // Middle-section vocal line, track bars 51–54 (repeats 55–58 sparser).
    bridge: [
      '.   .   .   .   .   E4  .   .   .   .   .   C#4 .   .   C#4 .',
      '.   C#4 D4  .   .   D4  -   .   .   .   .   .   .   .   .   .',
      '.   .   .   F#4 .   F#4 -   .   C#4 -   .   C#4 .   .   C#4 -',
      '.   .   D4  .   .   D4  -   .   A4  .   .   .   .   .   .   .',
    ],
  },
};
