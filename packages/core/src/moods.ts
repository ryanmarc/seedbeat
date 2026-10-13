import type { ScaleName } from './theory';

export const MOOD_IDS = ['lofi', 'synthwave', 'chiptune', 'techno'] as const;
export type MoodId = (typeof MOOD_IDS)[number];

export type Progression = readonly [number, number, number, number];

export interface MoodDef {
  label: string;
  bpm: readonly [number, number];
  swing: number;
  scales: readonly ScaleName[];
  root: readonly [number, number];
  sevenths: boolean;
  /** Weight of off-beat 16ths in motif rhythms. */
  g16: number;
  /** Probability a lead note is staccato when it has room. */
  stacc: number;
  progs: readonly Progression[];
  palette: {
    lane: readonly [string, string, string, string];
    accent: string;
    accent2: string;
    bg: string;
  };
  words: { a: readonly string[]; n: readonly string[] };
}

/** Generator v1 mood definitions. Values are frozen with the version. */
export const MOODS: Record<MoodId, MoodDef> = {
  lofi: {
    label: 'Chill Lo-fi',
    bpm: [70, 86],
    swing: 0.17,
    scales: ['dorian', 'major'],
    root: [48, 55],
    sevenths: true,
    g16: 0.12,
    stacc: 0.15,
    progs: [
      [1, 4, 0, 0],
      [1, 4, 0, 5],
      [0, 5, 3, 4],
      [3, 2, 1, 0],
      [5, 3, 1, 4],
    ],
    palette: {
      lane: ['#ffb38a', '#f6d68b', '#9fd8c9', '#c6a5f0'],
      accent: '#ffb38a',
      accent2: '#9fd8c9',
      bg: '#17121f',
    },
    words: {
      a: ['Velvet', 'Sleepy', 'Rainy', 'Dusty', 'Warm', 'Quiet', 'Paper', 'Mellow', 'Soft', 'Late'],
      n: [
        'Window',
        'Tape',
        'Kettle',
        'Sunday',
        'Library',
        'Streetlamp',
        'Cassette',
        'Notebook',
        'Porch',
        'Teacup',
      ],
    },
  },
  synthwave: {
    label: 'Synthwave',
    bpm: [96, 118],
    swing: 0,
    scales: ['minor'],
    root: [45, 52],
    sevenths: false,
    g16: 0.18,
    stacc: 0.2,
    progs: [
      [0, 5, 2, 6],
      [0, 3, 5, 4],
      [0, 6, 5, 6],
      [5, 6, 0, 0],
      [0, 5, 3, 6],
    ],
    palette: {
      lane: ['#ff3fa4', '#ff9a3c', '#3cf0ff', '#b26bff'],
      accent: '#ff3fa4',
      accent2: '#3cf0ff',
      bg: '#0d0221',
    },
    words: {
      a: [
        'Neon',
        'Midnight',
        'Chrome',
        'Electric',
        'Vapor',
        'Crimson',
        'Laser',
        'Turbo',
        'Sunset',
        'Outrun',
      ],
      n: [
        'Highway',
        'Skyline',
        'Arcade',
        'Horizon',
        'Drive',
        'Boulevard',
        'Palms',
        'Cruise',
        'Mirage',
        'Overdrive',
      ],
    },
  },
  chiptune: {
    label: 'Chiptune',
    bpm: [140, 162],
    swing: 0,
    scales: ['major', 'mixolydian'],
    root: [48, 55],
    sevenths: false,
    g16: 0.22,
    stacc: 0.45,
    progs: [
      [0, 4, 5, 3],
      [0, 3, 4, 0],
      [5, 3, 0, 4],
      [0, 5, 3, 4],
      [0, 3, 0, 4],
    ],
    palette: {
      lane: ['#ff5e5e', '#ffd93d', '#4ade80', '#5eb8ff'],
      accent: '#ffd93d',
      accent2: '#5eb8ff',
      bg: '#0a1030',
    },
    words: {
      a: [
        'Pixel',
        'Turbo',
        'Mega',
        'Hyper',
        'Cosmic',
        'Super',
        '8-Bit',
        'Lucky',
        'Rocket',
        'Crystal',
      ],
      n: [
        'Quest',
        'Castle',
        'Dungeon',
        'Warp',
        'Boss',
        'Island',
        'Combo',
        'Cartridge',
        'Level',
        'Powerup',
      ],
    },
  },
  techno: {
    label: 'Dark Techno',
    bpm: [124, 136],
    swing: 0,
    scales: ['phrygian', 'minor'],
    root: [45, 50],
    sevenths: false,
    g16: 0.3,
    stacc: 0.55,
    progs: [
      [0, 0, 0, 0],
      [0, 0, 5, 6],
      [0, 1, 0, 1],
      [0, 6, 5, 6],
    ],
    palette: {
      lane: ['#ff2a3d', '#ff7a3d', '#e8e8f0', '#9a9ab4'],
      accent: '#ff2a3d',
      accent2: '#e8e8f0',
      bg: '#050507',
    },
    words: {
      a: [
        'Concrete',
        'Black',
        'Iron',
        'Cold',
        'Hollow',
        'Static',
        'Steel',
        'Null',
        'Deep',
        'Hidden',
      ],
      n: [
        'Bunker',
        'Signal',
        'Tunnel',
        'Machine',
        'Pulse',
        'Vault',
        'Reactor',
        'Circuit',
        'Basement',
        'Foundry',
      ],
    },
  },
};

export const SECTION_TYPES = ['intro', 'verse', 'chorus', 'bridge', 'outro'] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export type DrumMode = 'light' | 'full' | 'big' | 'break';

/** Lead density and drum mode per section type. */
export const SECT: Record<SectionType, { lead: number; drums: DrumMode }> = {
  intro: { lead: 0.34, drums: 'light' },
  verse: { lead: 0.52, drums: 'full' },
  chorus: { lead: 0.8, drums: 'big' },
  bridge: { lead: 0.42, drums: 'break' },
  outro: { lead: 0.3, drums: 'light' },
};

/** Background pulse intensity per section (RENDERING.md §3). */
export const INTENSITY: Record<SectionType, number> = {
  intro: 0.45,
  verse: 0.7,
  chorus: 1,
  bridge: 0.55,
  outro: 0.45,
};

/** 16-step drum patterns: `x` = full hit, `o` = soft (0.55), `.` = rest. */
export interface DrumKit {
  kick: readonly string[];
  snare: readonly string[];
  hat: readonly string[];
  /** Techno only: closed-hat layers for full/big sections. */
  ch?: readonly string[];
  /** Techno only: rim patterns alternating by bar parity. */
  rim?: readonly string[];
}

export const DRUMS: Record<MoodId, DrumKit> = {
  lofi: {
    kick: ['x.....x...x.....', 'x......x.x......', 'x.....x..x...x..'],
    snare: ['....x.......x...', '....x.......x..o'],
    hat: ['x.x.x.x.x.x.x.x.', 'xox.xox.xox.xox.'],
  },
  synthwave: {
    kick: ['x...x...x...x...', 'x...x...x...x.x.'],
    snare: ['....x.......x...', '....x.......x..o'],
    hat: ['..x...x...x...x.', 'oxoxoxoxoxoxoxox'],
  },
  chiptune: {
    kick: ['x.....x.x.......', 'x...x...x...x...', 'x.....x...x.x...'],
    snare: ['....x.......x...', '....x..o....x.x.'],
    hat: ['x.x.x.x.x.x.x.x.', 'xoxoxoxoxoxoxoxo'],
  },
  techno: {
    kick: ['x...x...x...x...'],
    snare: ['....x.......x...'],
    hat: ['..x...x...x...x.'],
    ch: ['oooooooooooooooo', 'xoxoxoxoxoxoxoxo'],
    rim: ['...x..x....x..x.', '..x..x..x...x...'],
  },
};

/** Pattern character at step i → velocity (1, 0.55 or 0). */
export function patternHit(pattern: string, i: number): number {
  const c = pattern[i];
  return c === 'x' ? 1 : c === 'o' ? 0.55 : 0;
}
