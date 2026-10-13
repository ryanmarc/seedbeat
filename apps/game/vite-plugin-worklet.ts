import { build, type Plugin } from 'vite';

/**
 * Serves the AudioWorklet processor as ONE self-contained module.
 *
 * In production `?worker&url` already bundles it. In dev, Vite serves workers unbundled and
 * prefixes every dependency with its HMR client, which cannot run in an AudioWorkletGlobalScope
 * (no `window`, no WebSocket): the module "loads" but never registers the processor. So in dev
 * this plugin bundles the entry with Vite's library build on demand and serves it from
 * `/__seedbeat/worklet.js`. Import `virtual:seedbeat-worklet-url` to get the URL either way.
 */
const VIRTUAL = 'virtual:seedbeat-worklet-url';
const RESOLVED = '\0' + VIRTUAL;
const DEV_PATH = '/__seedbeat/worklet.js';

export function workletPlugin(entry: string): Plugin {
  let isServe = false;
  return {
    name: 'seedbeat-worklet',
    configResolved(config) {
      isServe = config.command === 'serve';
    },
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      if (isServe) return `export default ${JSON.stringify(DEV_PATH)};`;
      return `import url from ${JSON.stringify(entry + '?worker&url')};\nexport default url;`;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(DEV_PATH)) return next();
        try {
          const result = await build({
            configFile: false,
            logLevel: 'warn',
            build: {
              write: false,
              minify: false,
              sourcemap: 'inline',
              target: 'es2022',
              lib: { entry, formats: ['es'], fileName: () => 'worklet.js' },
            },
          });
          const outputs = Array.isArray(result) ? result : [result];
          const first = outputs[0];
          const chunk =
            first && 'output' in first ? first.output.find((o) => o.type === 'chunk') : undefined;
          if (!chunk || chunk.type !== 'chunk') throw new Error('worklet build produced no chunk');
          res.setHeader('Content-Type', 'text/javascript');
          res.setHeader('Cache-Control', 'no-store');
          res.end(chunk.code);
        } catch (err) {
          res.statusCode = 500;
          res.end(`// worklet build failed\n${err instanceof Error ? err.stack : String(err)}`);
        }
      });
    },
  };
}
