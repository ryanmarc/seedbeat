/**
 * Initial-JS bundle size check (PERFORMANCE.md §4 and §4.1).
 *
 * Walks dist/.vite/manifest.json from the HTML entry, summing the entry chunk and everything it
 * imports statically. Dynamic imports (and the AudioWorklet bundle) are not initial JS and are
 * listed separately. Prints gzip and brotli; fails on gzip above the budget.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

export const BUDGET_GZIP_BYTES = 300 * 1024;

interface ManifestChunk {
  file: string;
  src?: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
}
type Manifest = Record<string, ManifestChunk>;

export interface SizeReport {
  initialFiles: string[];
  lazyFiles: string[];
  raw: number;
  gzip: number;
  brotli: number;
}

export function measureInitialJs(distDir: string, manifest: Manifest): SizeReport {
  const entries = Object.keys(manifest).filter((k) => manifest[k]?.isEntry);
  const initial = new Set<string>();
  const lazy = new Set<string>();
  const visit = (key: string, isInitial: boolean): void => {
    const chunk = manifest[key];
    if (!chunk) return;
    const target = isInitial ? initial : lazy;
    if (target.has(chunk.file)) return;
    target.add(chunk.file);
    for (const dep of chunk.imports ?? []) visit(dep, isInitial);
    for (const dep of chunk.dynamicImports ?? []) visit(dep, false);
  };
  for (const e of entries) visit(e, true);
  for (const f of initial) lazy.delete(f);

  let raw = 0;
  let gzip = 0;
  let brotli = 0;
  for (const f of initial) {
    if (!f.endsWith('.js')) continue;
    const buf = readFileSync(join(distDir, f));
    raw += buf.length;
    gzip += gzipSync(buf, { level: 9 }).length;
    brotli += brotliCompressSync(buf, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length;
  }
  return {
    initialFiles: [...initial].filter((f) => f.endsWith('.js')).sort(),
    lazyFiles: [...lazy].filter((f) => f.endsWith('.js')).sort(),
    raw,
    gzip,
    brotli,
  };
}

const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;

export function formatReport(r: SizeReport): string {
  const lines = [
    `Initial JS: ${r.initialFiles.length} file(s)`,
    ...r.initialFiles.map((f) => `  ${f}`),
    `  raw ${kb(r.raw)} | gzip ${kb(r.gzip)} | brotli ${kb(r.brotli)}`,
    `  budget gzip ${kb(BUDGET_GZIP_BYTES)} → ${r.gzip <= BUDGET_GZIP_BYTES ? 'PASS' : 'FAIL'} (${kb(BUDGET_GZIP_BYTES - r.gzip)} headroom)`,
  ];
  if (r.lazyFiles.length) lines.push(`Lazy (not counted): ${r.lazyFiles.join(', ')}`);
  return lines.join('\n');
}

function main(): void {
  const distDir = resolve(
    process.argv[2] ?? join(import.meta.dirname, '..', '..', 'apps', 'game', 'dist'),
  );
  const manifestPath = join(distDir, '.vite', 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`No manifest at ${manifestPath}. Run \`pnpm build\` first.`);
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  const report = measureInitialJs(distDir, manifest);
  console.log(formatReport(report));
  if (process.env['GITHUB_STEP_SUMMARY']) {
    appendFileSync(
      process.env['GITHUB_STEP_SUMMARY'],
      `### Initial JS\n| raw | gzip | brotli | budget (gzip) |\n|---|---|---|---|\n| ${kb(report.raw)} | ${kb(report.gzip)} | ${kb(report.brotli)} | ${kb(BUDGET_GZIP_BYTES)} |\n`,
    );
  }
  process.exit(report.gzip <= BUDGET_GZIP_BYTES ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
