import { expect, test, type Page } from '@playwright/test';

/**
 * M6 content: daily seed, practice loops, tutorial, achievements, cosmetics and the input latency
 * test. Silent autoplay-bot runs that end a few seconds after the first bar.
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

test.describe('game content', () => {
  test('daily seed: same song for the day, best and streak recorded, achievements earned', async ({
    page,
  }) => {
    await page.goto(`/#${HARNESS}`);
    await waitScreen(page, 'title');
    await page.getByRole('button', { name: 'Daily' }).click();
    await waitScreen(page, 'select');
    const today = new Date().toISOString().slice(0, 10);
    await expect(page.getByRole('textbox', { name: 'Seed' })).toHaveValue(`daily-${today}`);
    await expect(page.getByText(/Daily seed for \d{4}-\d{2}-\d{2}/)).toBeVisible();
    await page.getByRole('button', { name: 'PLAY' }).click();
    await waitScreen(page, 'playing');
    await waitScreen(page, 'results', 40_000);
    await expect(page.getByText(/Daily cleared · 1-day streak/)).toBeVisible();
    const earned = page.getByRole('list', { name: 'Achievements earned' });
    await expect(earned).toBeVisible();
    await expect(earned.getByText('Cleared', { exact: true })).toBeVisible();
    await expect(earned.getByText('Today', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Menu' }).click();
    await waitScreen(page, 'select');
    await expect(page.getByText(/1-day streak · today's best [\d,]+/)).toBeVisible();
    await page.getByRole('button', { name: 'Profile' }).click();
    await waitScreen(page, 'profile');
    await expect(page.getByText('1 day · 1 dailies cleared')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Achievements · [1-9]\d* of 2\d/ }),
    ).toBeVisible();
  });

  test('practice: pick a section and tempo, loop it, finish from pause', async ({ page }) => {
    await page.goto(`/#${HARNESS}&m=chiptune&s=cobalt-42&d=2`);
    await waitScreen(page, 'select');
    await page
      .getByRole('group', { name: 'Mode' })
      .getByRole('button', { name: 'Practice' })
      .click();
    const sections = page.getByRole('group', { name: 'Section' });
    await expect(sections.getByRole('button', { name: /Chorus 1/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await sections.getByRole('button', { name: /Verse 1/ }).click();
    await page.getByRole('group', { name: 'Tempo' }).getByRole('button', { name: '50%' }).click();
    await expect(page.getByText('Practice runs are not scored.')).toBeVisible();
    await page.getByRole('button', { name: 'PLAY' }).click();
    await waitScreen(page, 'playing');
    await expect(page.getByText(/Practice · Verse 1 · loop 1 · 50%/)).toBeVisible({
      timeout: 20_000,
    });
    await page.keyboard.press('Escape');
    await waitScreen(page, 'paused');
    await page.getByRole('button', { name: 'Finish practice' }).click();
    await waitScreen(page, 'results');
    await expect(page.getByText(/Practice · 0 loops · 50% tempo · not scored/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'New seed' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Menu' }).click();
    await waitScreen(page, 'select');
    await expect(page.getByText('Practice runs are not scored.')).toBeVisible();
    await page.getByRole('button', { name: 'Profile' }).click();
    await expect(page.getByText('Practice sessions')).toBeVisible();
  });

  test('practice loops run past the section end', async ({ page }) => {
    // Hard chiptune intro is 4 bars (~6 s), so an 8 s window sees the first loop.
    await page.goto(`/#${HARNESS}&m=chiptune&s=cobalt-42&d=2`);
    await waitScreen(page, 'select');
    await page
      .getByRole('group', { name: 'Mode' })
      .getByRole('button', { name: 'Practice' })
      .click();
    await page
      .getByRole('group', { name: 'Section' })
      .getByRole('button', { name: /Intro/ })
      .click();
    await page.getByRole('group', { name: 'Tempo' }).getByRole('button', { name: '100%' }).click();
    await page.getByRole('button', { name: 'PLAY' }).click();
    await waitScreen(page, 'playing');
    await expect(page.getByText(/Practice · Intro · loop 2 · 100%/)).toBeVisible({
      timeout: 25_000,
    });
    await waitScreen(page, 'results', 30_000);
    await expect(page.getByText(/Practice · 1 loop · 100% tempo/)).toBeVisible();
  });

  test('first run offers the lesson on the title; it can be skipped from pause, then never again', async ({
    page,
  }) => {
    await page.goto(`/#${HARNESS}&tutorial=1`);
    await waitScreen(page, 'title');
    const offer = page.getByRole('region', { name: 'New here?' });
    await expect(offer).toBeVisible();
    await offer.getByRole('button', { name: 'START THE LESSON' }).click();
    await waitScreen(page, 'playing');
    await expect(page.getByText(/Notes fall toward the line/)).toBeVisible();
    await page.keyboard.press('Escape');
    await waitScreen(page, 'paused');
    await page.locator('#pause').getByRole('button', { name: 'Skip tutorial' }).click();
    await waitScreen(page, 'select');
    await expect(page.getByText(/Your first song: pick a mood/)).toBeVisible();
    // Play plays what the player set up, with no lesson in the way.
    await page.getByRole('button', { name: 'PLAY' }).click();
    await waitScreen(page, 'playing');
    await expect(page.getByText(/Notes fall toward the line/)).toHaveCount(0);
    await waitScreen(page, 'results', 40_000);
    await expect(page.getByText(/^Cleared · /)).toBeVisible();
    await page.getByRole('button', { name: 'Menu' }).click();
    await waitScreen(page, 'select');
    await expect(page.getByText(/Your first song: pick a mood/)).toHaveCount(0);
  });

  test('declining the lesson goes straight to song select and never asks again', async ({
    page,
  }) => {
    await page.goto(`/#${HARNESS}&tutorial=1`);
    await waitScreen(page, 'title');
    await page.getByRole('button', { name: 'Skip, I know rhythm games' }).click();
    await waitScreen(page, 'select');
    await expect(page.getByText(/Your first song: pick a mood/)).toBeVisible();
    await page.getByRole('button', { name: 'PLAY' }).click();
    await waitScreen(page, 'playing');
    await expect(page.getByText(/Notes fall toward the line/)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await waitScreen(page, 'paused');
    await page.getByRole('button', { name: 'Quit to menu' }).click();
    await waitScreen(page, 'select');
  });

  test('the lesson completes to results, leads to song select, and is replayable from settings', async ({
    page,
  }) => {
    await page.goto(`/#${HARNESS}&tutorial=1`);
    await waitScreen(page, 'title');
    await page.getByRole('button', { name: 'START THE LESSON' }).click();
    await waitScreen(page, 'playing');
    await waitScreen(page, 'results', 40_000);
    await expect(page.getByText(/Tutorial complete/)).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Achievements earned' }).getByText('First steps'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'PICK A SONG' }).click();
    await waitScreen(page, 'select');
    await expect(page.getByText(/Your first song: pick a mood/)).toBeVisible();
    await page.getByRole('button', { name: 'Settings' }).click();
    await waitScreen(page, 'settings');
    await page.getByRole('button', { name: 'Replay tutorial' }).click();
    await waitScreen(page, 'playing');
    await expect(page.getByText(/Notes fall toward the line/)).toBeVisible();
  });

  test('settings: cosmetics lock by level, menu sounds toggle, input latency test', async ({
    page,
  }) => {
    await page.goto(`/#audio=0&memsave=1`);
    await waitScreen(page, 'title');
    await page.getByRole('button', { name: 'Settings' }).click();
    await waitScreen(page, 'settings');
    const skins = page.getByRole('group', { name: 'Note skin' });
    await expect(skins.getByRole('button', { name: 'Classic' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(skins.getByRole('button', { name: /Neon, unlocks at level 3/ })).toBeDisabled();
    await expect(page.getByRole('switch', { name: 'Menu sounds' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.getByRole('button', { name: 'Start test' }).click();
    const pad = page.getByRole('button', { name: /Latency test pad/ });
    for (let i = 0; i < 8; i++) await pad.click();
    await expect(page.getByText(/Taps reach the game [\d.]+ ms after the touch/)).toBeVisible();
    // Give the save a level that unlocks Neon and check it becomes selectable.
    await page.evaluate(() =>
      window.__seedbeat!.controller.store.update((s) => {
        s.profile.level = 3;
      }),
    );
    await skins.getByRole('button', { name: 'Neon' }).click();
    await expect(skins.getByRole('button', { name: 'Neon' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('no horizontal overflow at 360 px on the new screens', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto(`/#${HARNESS}`);
    await waitScreen(page, 'title');
    await noOverflow(page);
    await page.getByRole('button', { name: 'Practice' }).click();
    await waitScreen(page, 'select');
    await noOverflow(page);
    await page.getByRole('button', { name: 'Profile' }).click();
    await waitScreen(page, 'profile');
    await noOverflow(page);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'PLAY' }).click();
    await waitScreen(page, 'playing');
    await noOverflow(page);
    await waitScreen(page, 'results', 40_000);
    await noOverflow(page);
  });
});
