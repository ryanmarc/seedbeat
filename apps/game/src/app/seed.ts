import { canonicalSeed } from '@seedbeat/core';

/** Seed as typed or linked → the seed we play and score: trimmed, capped, curated keys lowercased. */
export function seedFromInput(raw: string): string {
  return canonicalSeed(raw.trim().slice(0, 32));
}
