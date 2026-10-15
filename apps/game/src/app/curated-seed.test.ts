import { canonicalSeed } from '@seedbeat/core';
import { describe, expect, it } from 'vitest';
import { seedFromInput } from './seed';

describe('seed input', () => {
  it('trims, caps at 32 chars, and canonicalises curated seeds', () => {
    expect(seedFromInput('  Friday ')).toBe('friday');
    expect(seedFromInput('FRIDAY')).toBe(canonicalSeed('FRIDAY'));
    expect(seedFromInput('Blue Monday')).toBe('Blue Monday');
    expect(seedFromInput('x'.repeat(40))).toHaveLength(32);
  });
});
