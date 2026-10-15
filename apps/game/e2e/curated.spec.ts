import { expect, test, type Page } from '@playwright/test';

/** Curated seeds: typed and linked seeds agree, and typing is never rewritten mid-word. */
const HARNESS = 'bot=1&audio=0&end=8&memsave=1';

async function waitScreen(page: Page, name: string, timeout = 30_000): Promise<void> {
  await page.waitForFunction((n) => window.__seedbeat?.screen() === n, name, { timeout });
}

test.describe('curated seeds', () => {
  test('typing past a curated word is not rewritten; committing a case variant canonicalises', async ({
    page,
  }) => {
    await page.goto(`/#${HARNESS}`);
    await waitScreen(page, 'title');
    await page.getByRole('button', { name: 'PLAY' }).click();
    await waitScreen(page, 'select');
    const seed = page.locator('#seed');
    await seed.fill('');
    await seed.pressSequentially('Fridays');
    await expect(seed).toHaveValue('Fridays');
    await seed.fill('');
    await seed.pressSequentially('Friday');
    await seed.press('Tab'); // commit
    await expect(seed).toHaveValue('friday');
    await expect(page.locator('.name')).toHaveText('Friday');
  });

  test('a link with a case variant opens the curated song under its canonical seed', async ({
    page,
  }) => {
    await page.goto(`/#s=FRIDAY&m=techno&${HARNESS}`);
    await waitScreen(page, 'select');
    await expect(page.locator('#seed')).toHaveValue('friday');
    await expect(page.locator('.name')).toHaveText('Friday');
  });
});
