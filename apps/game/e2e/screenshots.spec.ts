import { expect, test } from '@playwright/test';

/**
 * Design-review screenshots: each mood mid-chorus with the bot playing, phone layout, no audio.
 * Written to e2e/screenshots/<mood>.png (gitignored).
 */
const MOODS = ['lofi', 'synthwave', 'chiptune', 'techno'] as const;

/** Stage clear colour (render/stage.ts BACKGROUND). A baked background must cover it. */
const CLEAR = '#0b0912';

for (const mood of MOODS) {
  test(`${mood} play field screenshot`, async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-chromium', 'phone layout only');
    await page.goto(
      `/#s=amber-11&m=${mood}&d=2&bot=1&audio=0&auto=1&touch=1&diag=1&lock=1&memsave=1`,
    );
    await page.waitForFunction(() => window.__seedbeatPerf?.ready === true);
    await page.waitForTimeout(14_000);
    const judged = await page.evaluate(() => window.__seedbeatPerf!.session().judged);
    expect(judged).toBeGreaterThan(5);
    const png = await page.screenshot({ path: `e2e/screenshots/${mood}.png` });

    // The static background is baked into a screen-sized texture drawn at (0,0). When the bake was
    // sized to the drawing's bounds instead, the picture shifted sideways and the left edge of the
    // play field showed the bare stage colour. Sample a column near the left edge, mid-screen.
    const colours = await page.evaluate(
      async (data) => {
        const img = new Image();
        img.src = data;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const x = c.getContext('2d')!;
        x.drawImage(img, 0, 0);
        const hex = (px: number, py: number): string => {
          const d = x.getImageData(px, py, 1, 1).data;
          return '#' + [d[0]!, d[1]!, d[2]!].map((v) => v.toString(16).padStart(2, '0')).join('');
        };
        const px = Math.round(img.width * 0.01);
        return [0.35, 0.45, 0.55].map((f) => hex(px, Math.round(img.height * f)));
      },
      'data:image/png;base64,' + png.toString('base64'),
    );
    for (const colour of colours) expect(colour, `${mood} left edge`).not.toBe(CLEAR);
  });
}
