import { expect, test } from '@playwright/test';

test('loads the title screen without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/#memsave=1');
  await expect(page).toHaveTitle('Seedbeat');
  await expect(page.getByRole('heading', { name: 'SEEDBEAT' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('canvas#stage')).toBeVisible();
  expect(errors).toEqual([]);
});
