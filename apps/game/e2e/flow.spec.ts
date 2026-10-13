import { expect, test, type Page } from '@playwright/test';

/**
 * Game flow (M5 "Done when"): every screen and the full play loop for each mode, keyboard-only
 * navigation, and no layout overflow at 360 px. Runs silent with the autoplay bot; runs end after
 * `end` song seconds so a loop takes about 20 s.
 */
const HARNESS = 'bot=1&audio=0&end=8&memsave=1';

async function waitScreen(page: Page, name: string, timeout = 30_000): Promise<void> {
  await page.waitForFunction((n) => window.__seedbeat?.screen() === n, name, { timeout });
}

async function noOverflow(page: Page): Promise<void> {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over, 'horizontal overflow px').toBeLessThanOrEqual(0);
  // Button labels must fit their boxes, and every control must stay inside the viewport.
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#ui button')]
      .filter((b) => b.offsetParent !== null)
      .filter(
        (b) =>
          b.scrollWidth > b.clientWidth + 1 ||
          b.getBoundingClientRect().right > window.innerWidth + 1,
      )
      .map((b) => (b.textContent?.trim() || b.getAttribute('aria-label') || '?').slice(0, 30)),
  );
  expect(clipped, 'clipped or off-screen buttons').toEqual([]);
}

test.describe('game flow', () => {
  test('title → select → song run → results → retry → menu', async ({ page }) => {
    await page.goto(`/#${HARNESS}`);
    await waitScreen(page, 'title');
    await expect(page.getByRole('heading', { name: 'SEEDBEAT' })).toBeVisible();
    await page.getByRole('button', { name: 'PLAY' }).click();
    await waitScreen(page, 'select');
    await page.getByRole('button', { name: /Chiptune/ }).click();
    await page
      .getByRole('group', { name: 'Difficulty' })
      .getByRole('button', { name: 'Hard' })
      .click();
    await page.getByRole('textbox', { name: 'Seed' }).fill('cobalt-42');
    await expect(page.getByText('Mega Castle')).toBeVisible();
    await page.getByRole('button', { name: 'PLAY' }).click();
    await waitScreen(page, 'playing');
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await waitScreen(page, 'results', 40_000);
    await expect(page.getByRole('heading', { name: 'Mega Castle' })).toBeVisible();
    await expect(page.getByText('New best for this seed')).toBeVisible();
    await expect(page.getByRole('img', { name: /Timing graph/ })).toBeVisible();
    const score = await page.locator('.stats b').first().textContent();
    expect(Number(score!.replace(/,/g, ''))).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'RETRY' }).click();
    await waitScreen(page, 'playing');
    await page.keyboard.press('Escape');
    await waitScreen(page, 'paused');
    await page.getByRole('button', { name: 'Quit to menu' }).click();
    await waitScreen(page, 'select');
    await expect(page.getByText(/Best [\d,]+ · /)).toBeVisible();
  });

  test('endless run ends on health (no-fail off) and reports bars survived', async ({ page }) => {
    await page.goto(`/#audio=0&end=10&memsave=1&m=techno&s=signal-90&mode=endless&d=1`);
    await waitScreen(page, 'select');
    await expect(
      page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Endless' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'PLAY' }).click();
    await waitScreen(page, 'playing');
    await waitScreen(page, 'results', 40_000);
    await expect(page.getByText(/Survived .* bars · peak level/)).toBeVisible();
  });

  test('pause and resume count in with the music; settings open from pause', async ({ page }) => {
    await page.goto(`/#${HARNESS}&m=lofi&s=amber-11`);
    await waitScreen(page, 'select');
    await page.getByRole('button', { name: 'PLAY' }).click();
    await waitScreen(page, 'playing');
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: 'Pause' }).click();
    await waitScreen(page, 'paused');
    await page.getByRole('button', { name: 'Settings' }).click();
    await waitScreen(page, 'settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await page.keyboard.press('Escape'); // overlays close on Escape; returns to the pause screen
    await waitScreen(page, 'paused');
    await page.getByRole('button', { name: 'RESUME' }).click();
    await waitScreen(page, 'playing');
    await expect(page.getByText(/Resuming in/)).toBeVisible();
    await expect(page.getByText(/Resuming in/)).toBeHidden({ timeout: 10_000 });
  });

  test('settings persist across reload', async ({ page }) => {
    await page.goto(`/#audio=0`);
    await waitScreen(page, 'title');
    await page.getByRole('button', { name: 'Settings' }).click();
    await waitScreen(page, 'settings');
    const noFail = page.getByRole('switch', { name: 'No-fail' });
    await expect(noFail).toHaveAttribute('aria-checked', 'false');
    await noFail.click();
    await expect(noFail).toHaveAttribute('aria-checked', 'true');
    await page
      .getByRole('group', { name: 'Lane colours' })
      .getByRole('button', { name: 'CB A' })
      .click();
    await page.getByRole('button', { name: 'DONE' }).click();
    await waitScreen(page, 'title');
    await page.reload();
    await waitScreen(page, 'title');
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('switch', { name: 'No-fail' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(
      page.getByRole('group', { name: 'Lane colours' }).getByRole('button', { name: 'CB A' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('calibration and profile screens', async ({ page }) => {
    await page.goto(`/#audio=0&memsave=1`);
    await waitScreen(page, 'title');
    await page.getByRole('button', { name: 'PLAY' }).click();
    await waitScreen(page, 'select');
    await page.getByRole('button', { name: 'Calibrate' }).click();
    await waitScreen(page, 'calibration');
    await page.getByRole('button', { name: 'Increase visual offset by 5 milliseconds' }).click();
    await expect(page.getByText('5 ms', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'DONE' }).click();
    await waitScreen(page, 'select');
    await page.getByRole('button', { name: 'Profile' }).click();
    await waitScreen(page, 'profile');
    await expect(page.getByText('Plays')).toBeVisible();
    await page.keyboard.press('Escape');
    await waitScreen(page, 'select');
  });

  test('calibration opened from settings returns to settings, then DONE leaves settings', async ({
    page,
  }) => {
    await page.goto(`/#audio=0&memsave=1`);
    await waitScreen(page, 'title');
    await page.getByRole('button', { name: 'Settings' }).click();
    await waitScreen(page, 'settings');
    await page.getByRole('button', { name: 'Run calibration' }).click();
    await waitScreen(page, 'calibration');
    await page.getByRole('button', { name: 'DONE' }).click();
    await waitScreen(page, 'settings');
    await page.getByRole('button', { name: 'DONE' }).click();
    await waitScreen(page, 'title');
    // Profile from select, then Settings from profile's return path.
    await page.getByRole('button', { name: 'PLAY' }).click();
    await waitScreen(page, 'select');
    await page.getByRole('button', { name: 'Profile' }).click();
    await waitScreen(page, 'profile');
    await page.keyboard.press('Escape');
    await waitScreen(page, 'select');
  });

  test('keyboard only: Tab and Enter reach a run', async ({ page }) => {
    await page.goto(`/#${HARNESS}`);
    await waitScreen(page, 'title');
    // Heading is focused on entry; the first Tab lands on PLAY.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'PLAY' })).toBeFocused();
    await page.keyboard.press('Enter');
    await waitScreen(page, 'select');
    // Tab through the mood grid and controls to PLAY without a mouse.
    for (let i = 0; i < 40; i++) {
      const name = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
      if (name === 'PLAY') break;
      await page.keyboard.press('Tab');
    }
    await expect(page.getByRole('button', { name: 'PLAY' })).toBeFocused();
    await page.keyboard.press('Enter');
    await waitScreen(page, 'playing');
  });

  test('screens expose headings and named controls (screen reader pass)', async ({ page }) => {
    await page.goto(`/#audio=0&memsave=1`);
    await waitScreen(page, 'title');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('SEEDBEAT');
    await page.getByRole('button', { name: 'PLAY' }).click();
    await waitScreen(page, 'select');
    await expect(page.getByRole('group', { name: 'Mood' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Seed' })).toBeVisible();
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll('#ui button')]
        .filter((b) => !(b.textContent?.trim() || b.getAttribute('aria-label')))
        .map((b) => b.outerHTML.slice(0, 160)),
    );
    expect(unnamed, 'buttons without an accessible name').toEqual([]);
  });

  test('no horizontal overflow at 360 px on every screen', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto(`/#${HARNESS}`);
    await waitScreen(page, 'title');
    await noOverflow(page);
    await page.getByRole('button', { name: 'PLAY' }).click();
    await waitScreen(page, 'select');
    await noOverflow(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await waitScreen(page, 'settings');
    await noOverflow(page);
    await page.getByRole('button', { name: 'DONE' }).click();
    await page.getByRole('button', { name: 'Calibrate' }).click();
    await waitScreen(page, 'calibration');
    await noOverflow(page);
    await page.getByRole('button', { name: 'DONE' }).click();
    await page.getByRole('button', { name: 'PLAY' }).click();
    await waitScreen(page, 'playing');
    await noOverflow(page);
    await page.keyboard.press('Escape');
    await waitScreen(page, 'paused');
    await noOverflow(page);
    await page.keyboard.press('Escape');
    await waitScreen(page, 'playing');
    await waitScreen(page, 'results', 40_000);
    await noOverflow(page);
  });
});
