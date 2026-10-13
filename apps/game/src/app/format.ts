import { SCALES, sectionFor, type Song, type ScaleName } from '@seedbeat/core';

const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const SECTION_LABEL: Record<string, string> = {
  intro: 'Intro',
  verse: 'Verse',
  chorus: 'Chorus',
  bridge: 'Bridge',
  outro: 'Outro',
};
export const MOOD_LABEL = {
  lofi: 'Chill Lo-fi',
  synthwave: 'Synthwave',
  chiptune: 'Chiptune',
  techno: 'Dark Techno',
} as const;
export const DIFF_LABEL = ['Easy', 'Normal', 'Hard', 'Expert'] as const;

export function keyName(root: number, scale: ScaleName): string {
  return `${NOTE_NAMES[((root % 12) + 12) % 12]} ${scale}`;
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function songMeta(song: Song): string {
  const parts = [`${song.bpm} BPM`, keyName(song.root, song.scaleName), '4/4'];
  if (song.swing) parts.push(`swing ${Math.round(song.swing * 100)}%`);
  parts.push(
    song.total === null ? 'endless' : `${song.total} bars · ${fmtTime(song.total * song.barDur)}`,
  );
  return parts.join(' · ');
}

export function sectionText(song: Song, t: number, level?: number): string {
  if (t < 0) return 'Get ready';
  const bar = Math.max(0, Math.floor(t / song.barDur));
  const sec = sectionFor(song, bar);
  const label = SECTION_LABEL[sec.type] ?? sec.type;
  return song.total === null
    ? `${label} · bar ${bar + 1}${level !== undefined ? ` · level ${level.toFixed(1)}` : ''}`
    : `${label} · bar ${Math.min(bar + 1, song.total)}/${song.total}`;
}

export const SEED_WORDS = [
  'amber',
  'cobalt',
  'lantern',
  'harbor',
  'meteor',
  'velvet',
  'orbit',
  'ember',
  'glacier',
  'signal',
  'tidal',
  'prism',
  'quartz',
  'nimbus',
  'saffron',
  'echo',
  'marble',
  'juniper',
];

/** Random seed for the Shuffle button (UI only; generation itself never uses Math.random). */
export function randomSeed(): string {
  return `${SEED_WORDS[Math.floor(Math.random() * SEED_WORDS.length)]}-${10 + Math.floor(Math.random() * 90)}`;
}

export const SCALE_NAMES = Object.keys(SCALES) as ScaleName[];
