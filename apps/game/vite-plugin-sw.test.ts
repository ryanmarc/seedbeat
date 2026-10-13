import { describe, expect, it } from 'vitest';
import { precacheList, precacheVersion } from './vite-plugin-sw';

describe('precacheList', () => {
  it('keeps the shell files and drops maps and legacy woff', () => {
    const list = precacheList([
      'index.html',
      'manifest.webmanifest',
      'assets/index-abc.js',
      'assets/index-abc.js.map',
      'assets/index-abc.css',
      'assets/font-latin-400-normal-x.woff2',
      'assets/font-latin-400-normal-y.woff',
      'icons/icon-192.png',
      'sw.js',
      '.vite/manifest.json',
    ]);
    expect(list).toEqual([
      '/assets/font-latin-400-normal-x.woff2',
      '/assets/index-abc.css',
      '/assets/index-abc.js',
      '/icons/icon-192.png',
      '/index.html',
      '/manifest.webmanifest',
    ]);
  });
  it('is stable: same files give the same version regardless of order', () => {
    const a = precacheVersion(precacheList(['a.js', 'b.css']));
    const b = precacheVersion(precacheList(['b.css', 'a.js']));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(precacheVersion(precacheList(['a.js']))).not.toBe(a);
  });
  it('prefixes the site base for a project-site deploy', () => {
    expect(precacheList(['index.html', 'assets/a.js'], '/seedbeat/')).toEqual([
      '/seedbeat/assets/a.js',
      '/seedbeat/index.html',
    ]);
  });
});
