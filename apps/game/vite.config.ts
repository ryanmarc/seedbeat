import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
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
