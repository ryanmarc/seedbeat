import { expect, test, type Page } from '@playwright/test';

/**
 * M7 PWA checks against the production build: manifest and icons, service worker precache and
 * offline play, background pause with the resume count-in, the install prompt, and the screen
 * wake lock. Audio interruptions cannot be simulated headless; see platform.test.ts for the
 * state machine and the device checklist in the README for the real thing.
 */
const HARNESS = 'bot=1&audio=0&end=6&memsave=1';

async function waitScreen(page: Page, name: string, timeout = 30_000): Promise<void> {
  await page.waitForFunction((n) => window.__seedbeat?.screen() === n, name, { timeout });
}

test('manifest, icons and Apple meta are served', async ({ page, request }) => {
  await page.goto('/#memsave=1');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
    'content',
    'yes',
  );
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as {
    name: string;
    display: string;
    start_url: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };
  expect(manifest.name).toBe('Seedbeat');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons) {
    const r = await request.get(icon.src);
    expect(r.ok(), icon.src).toBe(true);
    expect(r.headers()['content-type'], icon.src).toMatch(/^image\//);
  }
  const touch = await request.get('/icons/apple-touch-icon.png');
  expect(touch.ok()).toBe(true);
});

test('service worker precaches the shell; the game loads and plays offline', async ({
  page,
  context,
}) => {
  await page.goto('/#memsave=1');
  expect(await page.evaluate(() => window.__seedbeat?.sw)).toBe('registered');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 30_000,
  });
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const c = await caches.open(keys.find((k) => k.startsWith('seedbeat-'))!);
    return (await c.keys()).length;
  });
  expect(cached).toBeGreaterThan(20);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'SEEDBEAT' })).toBeVisible({ timeout: 15_000 });
  // Same document, new hash: reload so the app boots with the harness flags, still offline.
  await page.goto(`/#${HARNESS}&m=lofi&s=amber-11`);
  await page.reload();
  await waitScreen(page, 'select');
  await page.getByRole('button', { name: 'PLAY' }).click();
  await waitScreen(page, 'playing');
  await waitScreen(page, 'results', 40_000);
  const score = await page.locator('.stats b').first().textContent();
  expect(Number(score!.replace(/,/g, ''))).toBeGreaterThan(0);
  await context.setOffline(false);
});

test('backgrounding pauses with the reason; Resume counts in', async ({ page }) => {
  await page.goto(`/#${HARNESS}&m=synthwave&s=amber-11`);
  await waitScreen(page, 'select');
  await page.getByRole('button', { name: 'PLAY' }).click();
  await waitScreen(page, 'playing');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await waitScreen(page, 'paused');
  await expect(page.getByText(/Paused while Seedbeat was in the background/)).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.getByRole('button', { name: 'RESUME' }).click();
  await waitScreen(page, 'playing');
  // pagehide (iOS lock screen, bfcache) pauses too.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await waitScreen(page, 'paused');
});

test('install prompt is captured and offered on the title screen', async ({ page }) => {
  await page.goto('/#memsave=1');
  await waitScreen(page, 'title');
  await expect(page.getByRole('button', { name: 'Install app' })).toHaveCount(0);
  await page.evaluate(() => {
    const w = window as Window & { __prompted?: number };
    w.__prompted = 0;
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    e.prompt = async () => {
      w.__prompted = (w.__prompted ?? 0) + 1;
    };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });
  const btn = page.getByRole('button', { name: 'Install app' });
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.getByText('Installed. Seedbeat is on your home screen.')).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __prompted?: number }).__prompted)).toBe(
    1,
  );
  await expect(btn).toHaveCount(0);
});

test('screen wake lock is held while playing and released on pause', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as Window & { __wake?: { requests: number; released: number } };
    w.__wake = { requests: 0, released: 0 };
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          w.__wake!.requests++;
          const listeners: (() => void)[] = [];
          return {
            released: false,
            release: async () => {
              w.__wake!.released++;
              for (const l of listeners) l();
            },
            addEventListener: (_t: string, fn: () => void) => listeners.push(fn),
          };
        },
      },
    });
  });
  await page.goto(`/#${HARNESS}&m=chiptune&s=cobalt-42`);
  await waitScreen(page, 'select');
  const wake = () =>
    page.evaluate(
      () => (window as Window & { __wake?: { requests: number; released: number } }).__wake!,
    );
  expect((await wake()).requests).toBe(0);
  await page.getByRole('button', { name: 'PLAY' }).click();
  await waitScreen(page, 'playing');
  await expect.poll(async () => (await wake()).requests).toBe(1);
  await page.keyboard.press('Escape');
  await waitScreen(page, 'paused');
  await expect.poll(async () => (await wake()).released).toBe(1);
  await page.keyboard.press('Escape');
  await waitScreen(page, 'playing');
  await expect.poll(async () => (await wake()).requests).toBe(2);
});
