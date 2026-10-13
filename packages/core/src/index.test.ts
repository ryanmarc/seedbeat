import { describe, expect, it } from 'vitest';
import {
  CURRENT_GENERATOR_VERSION,
  GENERATOR_VERSIONS,
  MOOD_IDS,
  isGeneratorVersion,
} from './index';

describe('core package', () => {
  it('ships generator v1 as current', () => {
    expect(CURRENT_GENERATOR_VERSION).toBe(1);
    expect(GENERATOR_VERSIONS).toContain(CURRENT_GENERATOR_VERSION);
  });

  it('recognises only known generator versions', () => {
    expect(isGeneratorVersion(1)).toBe(true);
    expect(isGeneratorVersion(2)).toBe(false);
  });

  it('has the four v1 moods', () => {
    expect(MOOD_IDS).toEqual(['lofi', 'synthwave', 'chiptune', 'techno']);
  });
});
