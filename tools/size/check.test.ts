import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUDGET_GZIP_BYTES, formatReport, measureInitialJs } from './check.ts';

describe('bundle size check', () => {
  it('counts the entry and static imports, not dynamic imports', () => {
    const dist = mkdtempSync(join(tmpdir(), 'seedbeat-size-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'assets', 'index.js'), 'console.log("entry");'.repeat(50));
    writeFileSync(join(dist, 'assets', 'vendor.js'), 'console.log("vendor");'.repeat(50));
    writeFileSync(join(dist, 'assets', 'lazy.js'), 'console.log("lazy");'.repeat(50));
    const manifest = {
      'index.html': {
        file: 'assets/index.js',
        isEntry: true,
        imports: ['_vendor'],
        dynamicImports: ['src/lazy.ts'],
      },
      _vendor: { file: 'assets/vendor.js' },
      'src/lazy.ts': { file: 'assets/lazy.js' },
    };
    const r = measureInitialJs(dist, manifest);
    expect(r.initialFiles).toEqual(['assets/index.js', 'assets/vendor.js']);
    expect(r.lazyFiles).toEqual(['assets/lazy.js']);
    expect(r.gzip).toBeGreaterThan(0);
    expect(r.gzip).toBeLessThan(r.raw);
    expect(r.brotli).toBeGreaterThan(0);
    expect(formatReport(r)).toContain('PASS');
  });

  it('budget is 300 KB gzip per PERFORMANCE.md', () => {
    expect(BUDGET_GZIP_BYTES).toBe(307200);
  });
});
