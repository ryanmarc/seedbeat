import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { build, type Plugin } from 'vite';

/**
 * Emits `dist/sw.js` after the app build: bundles `sw/sw.ts` with the list of shell files to
 * precache baked in. Only files the browser actually loads are listed (no source maps, no legacy
 * .woff beside their .woff2), so the offline shell stays about 1 MB. Production builds only: the
 * dev server serves unbundled modules the worker could not enumerate, and `platform/sw.ts` does
 * not register it there.
 */
const SW_ENTRY = new URL('./sw/sw.ts', import.meta.url);

const SKIP = [/\.map$/, /\.woff$/, /^sw\.js$/, /^\.vite\//];

/** Which emitted files belong in the precache, as URL paths under `base` (e.g. '/' or '/seedbeat/'). */
export function precacheList(files: string[], base = '/'): string[] {
  const keep = files.filter((f) => !SKIP.some((re) => re.test(f)));
  return [...new Set(keep.map((f) => base + f.replace(/\\/g, '/')))].sort();
}

export function precacheVersion(list: string[]): string {
  return createHash('sha256').update(list.join('\n')).digest('hex').slice(0, 12);
}

function walk(dir: string, root = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, root));
    else out.push(relative(root, p));
  }
  return out;
}

export function swPlugin(): Plugin {
  let root = '';
  let base = '/';
  let outDir = '';
  let building = false;
  return {
    name: 'seedbeat-sw',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      base = config.base;
      outDir = resolve(config.root, config.build.outDir);
      building = !config.build.lib; // the nested worklet/SW builds use lib mode
    },
    async closeBundle() {
      if (!building) return;
      const list = precacheList(walk(outDir), base);
      const version = precacheVersion(list);
      await build({
        configFile: false,
        root,
        logLevel: 'warn',
        define: {
          __PRECACHE__: JSON.stringify(list),
          __VERSION__: JSON.stringify(version),
          __BASE__: JSON.stringify(base),
        },
        build: {
          outDir,
          emptyOutDir: false,
          minify: true,
          sourcemap: false,
          target: 'es2022',
          lib: { entry: SW_ENTRY.pathname, formats: ['es'], fileName: () => 'sw.js' },
        },
      });
      console.log(`sw.js: precaching ${list.length} files (version ${version})`);
    },
  };
}
