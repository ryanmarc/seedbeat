/**
 * Rasterises apps/game/public/icons/icon.svg into the PNG sizes the manifest and iOS need.
 * Uses Playwright's Chromium so the output matches what browsers draw. Run `pnpm icons` after
 * editing the SVG; the PNGs are committed.
 *
 * Maskable icons keep everything inside the central 80% safe zone, so the maskable variant is the
 * same artwork drawn at 80% over the background colour.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const svgPath = fileURLToPath(new URL('../../apps/game/public/icons/icon.svg', import.meta.url));
const outDir = fileURLToPath(new URL('../../apps/game/public/icons/', import.meta.url));

const TARGETS: { file: string; size: number; maskable: boolean }[] = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: true },
];

async function main(): Promise<void> {
  const { readFileSync } = await import('node:fs');
  const svg = readFileSync(svgPath, 'utf8');
  const browser = await chromium.launch();
  try {
    for (const t of TARGETS) {
      const page = await browser.newPage({ viewport: { width: t.size, height: t.size } });
      const scale = t.maskable ? 0.8 : 1;
      const inset = ((1 - scale) / 2) * 100;
      await page.setContent(
        `<!doctype html><html><body style="margin:0;background:${t.maskable ? '#0b0912' : 'transparent'}">
          <div style="position:absolute;inset:${inset}%">${svg.replace(/width="512" height="512"/, 'width="100%" height="100%"')}</div>
        </body></html>`,
      );
      const png = await page.screenshot({
        type: 'png',
        omitBackground: !t.maskable,
        clip: { x: 0, y: 0, width: t.size, height: t.size },
      });
      writeFileSync(outDir + t.file, png);
      console.log(`${t.file}: ${t.size}×${t.size}, ${(png.length / 1024).toFixed(1)} KB`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

void main();
