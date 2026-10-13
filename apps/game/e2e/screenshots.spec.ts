import { expect, test } from '@playwright/test';

/**
 * Design-review screenshots: each mood mid-chorus with the bot playing, phone layout, no audio.
 * Written to e2e/screenshots/<mood>.png (gitignored).
 */
const MOODS = ['lofi', 'synthwave', 'chiptune', 'techno'] as const;

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
    await page.screenshot({ path: `e2e/screenshots/${mood}.png` });
  });
}
