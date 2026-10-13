export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
} as const;

export type ScaleName = keyof typeof SCALES;
export type Scale = readonly number[];

/** Scale degree (any integer, octaves wrap) to MIDI note above `root`. */
export function degToMidi(scale: Scale, root: number, deg: number): number {
  return root + Math.floor(deg / 7) * 12 + scale[((deg % 7) + 7) % 7]!;
}

/** Snap a degree to the nearest chord tone (searching ±2 octaves), ties keep the first found. */
export function snap(deg: number, chordTones: readonly number[]): number {
  let best = deg;
  let bd = 99;
  for (const c of chordTones) {
    for (let k = -2; k <= 2; k++) {
      const v = c + 7 * k;
      const dd = Math.abs(v - deg);
      if (dd < bd) {
        bd = dd;
        best = v;
      }
    }
  }
  return best;
}
