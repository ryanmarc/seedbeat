import { describe, expect, it } from 'vitest';
import { makeSong } from '@seedbeat/core';
import { fmtTime, keyName, previewStartTime, sectionText, songMeta } from './format';

describe('format helpers', () => {
  it('preview start puts bar `fromBar` 100 ms ahead, not bar 0', () => {
    const song = makeSong('amber-11', 'lofi', 'song');
    const start = previewStartTime(10, song.barDur, 4);
    expect(start + 4 * song.barDur).toBeCloseTo(10.1, 9);
    expect(start).toBeLessThan(10);
  });
  it('formats time, key and song meta', () => {
    expect(fmtTime(65)).toBe('1:05');
    expect(keyName(57, 'minor')).toBe('A minor');
    const song = makeSong('amber-11', 'lofi', 'song');
    expect(songMeta(song)).toContain('71 BPM');
    expect(songMeta(song)).toContain('swing 17%');
    expect(sectionText(song, -1)).toBe('Get ready');
    expect(sectionText(song, 0)).toBe('Intro · bar 1/32');
  });
});
