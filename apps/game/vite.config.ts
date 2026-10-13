import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { workletPlugin } from './vite-plugin-worklet.ts';

// AudioWorklet (and the clipboard, Web Share) need a secure context. `pnpm dev:phone` serves https
// with a self-signed certificate so a phone on the LAN can play; accept the certificate warning once.
const https = process.env['SEEDBEAT_HTTPS'] === '1';

const workletEntry = fileURLToPath(new URL('../../packages/worklet/src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [preact(), workletPlugin(workletEntry), ...(https ? [basicSsl()] : [])],
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
