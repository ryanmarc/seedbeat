import { describe, expect, it } from 'vitest';
import { platformDefaults } from '../platform/defaults';
import { DEFAULT_SETTINGS, defaultSave, migrate, songKey, starsFor } from './schema';
import { MemoryKV, SaveStore } from './store';

describe('save schema', () => {
  it('migrates garbage and partial saves to a full v1', () => {
    expect(migrate(null)).toEqual(defaultSave());
    expect(migrate('x')).toEqual(defaultSave());
    const m = migrate({
      v: 1,
      settings: { noteSpeed: 9, keys: ['a'] },
      recents: ['a', 3, 'b'],
      bests: { k: { score: 1 } },
    });
    expect(m.settings.noteSpeed).toBe(2);
    expect(m.settings.keys).toEqual(DEFAULT_SETTINGS.keys);
    expect(m.settings.hitSounds).toBe(false);
    expect(m.recents).toEqual(['a', 'b']);
    expect(m.bests['k']?.score).toBe(1);
    expect(m.profile.level).toBe(1);
  });
  it('validates the guitar mode and lane palette', () => {
    expect(migrate({ v: 1, settings: { guitarMode: 'tap' } }).settings.guitarMode).toBe('tap');
    expect(migrate({ v: 1, settings: { guitarMode: 'x' } }).settings.guitarMode).toBe('strum');
    expect(migrate({ v: 1, settings: { lanePalette: 'guitar' } }).settings.lanePalette).toBe(
      'guitar',
    );
    expect(migrate({ v: 1, settings: { lanePalette: 'nope' } }).settings.lanePalette).toBe('mood');
  });
  it('song keys and stars', () => {
    expect(songKey(1, 'lofi', 'song', 2, 'amber-11')).toBe('1:lofi:song:2:amber-11');
    expect(starsFor('B', false, false, false)).toBe(1);
    expect(starsFor('A', false, false, false)).toBe(2);
    expect(starsFor('S', false, false, false)).toBe(3);
    expect(starsFor('S', true, false, false)).toBe(4);
    expect(starsFor('S', true, true, false)).toBe(5);
    expect(starsFor('S', true, true, true)).toBe(0);
  });
});

describe('save store', () => {
  it('persists changes and reloads them', async () => {
    const kv = new MemoryKV();
    const a = new SaveStore(kv);
    await a.load();
    a.setSettings({ audioOffsetMs: -60, keys: ['KeyA', 'KeyS', 'KeyK', 'KeyL'] });
    a.addRecent('orbit-73');
    a.addRecent('amber-11');
    a.addRecent('orbit-73');
    a.toggleFavourite('amber-11');
    expect(
      a.recordBest('k', { score: 100, acc: 0.9, grade: 'A', fc: false, stars: 2, at: 1 }),
    ).toBe(true);
    expect(a.recordBest('k', { score: 50, acc: 0.95, grade: 'S', fc: true, stars: 4, at: 2 })).toBe(
      false,
    );
    await a.flush();
    const b = new SaveStore(kv);
    const s = await b.load();
    expect(s.settings.audioOffsetMs).toBe(-60);
    expect(s.settings.keys[0]).toBe('KeyA');
    expect(s.recents).toEqual(['orbit-73', 'amber-11']);
    expect(s.favourites).toEqual(['amber-11']);
    expect(s.bests['k']).toMatchObject({ score: 100, stars: 4 }); // stars upgrade without a score best
  });

  it('caps recents at 20 and round-trips export/import', async () => {
    const a = new SaveStore(new MemoryKV());
    await a.load();
    for (let i = 0; i < 25; i++) a.addRecent(`seed-${i}`);
    expect(a.save.recents).toHaveLength(20);
    expect(a.save.recents[0]).toBe('seed-24');
    const json = a.exportJSON();
    const b = new SaveStore(new MemoryKV());
    await b.load();
    b.importJSON(json);
    expect(b.save.recents).toEqual(a.save.recents);
    expect(() => b.importJSON('{not json')).toThrow();
    b.reset();
    expect(b.save.recents).toEqual([]);
  });
});

describe('platform defaults', () => {
  it('prefer the 20 ms audio buffer on touch devices and the lowest on desktop', () => {
    expect(platformDefaults(true).audioBuffer).toBe('balanced');
    expect(platformDefaults(false).audioBuffer).toBe('low');
    expect(migrate(null, platformDefaults(true)).settings.audioBuffer).toBe('balanced');
    // A stored choice wins over the platform default.
    expect(
      migrate({ v: 1, settings: { audioBuffer: 'low' } }, platformDefaults(true)).settings
        .audioBuffer,
    ).toBe('low');
  });
});

describe('reset and import keep device defaults', () => {
  it('a reset save on a touch device persists the balanced audio buffer', async () => {
    const kv = new MemoryKV();
    const store = new SaveStore(kv);
    await store.load();
    store.setSettings({ audioBuffer: 'stable' });
    store.reset();
    const expected = platformDefaults().audioBuffer;
    expect(store.save.settings.audioBuffer).toBe(expected);
    const again = new SaveStore(kv);
    await again.load();
    expect(again.save.settings.audioBuffer).toBe(expected);
    store.importJSON(JSON.stringify({ v: 1, settings: { noteSpeed: 1.5 } }));
    expect(store.save.settings.audioBuffer).toBe(expected);
    expect(store.save.settings.noteSpeed).toBe(1.5);
  });
});
