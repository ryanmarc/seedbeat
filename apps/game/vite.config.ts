import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { workletPlugin } from './vite-plugin-worklet.ts';

const workletEntry = fileURLToPath(new URL('../../packages/worklet/src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [preact(), workletPlugin(workletEntry)],
  build: {
    target: 'es2022',
    // Written to dist/.vite/manifest.json; tools/size walks it from the entry to measure initial JS.
    manifest: true,
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
});
