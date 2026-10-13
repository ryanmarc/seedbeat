import { expect, test, type Page } from '@playwright/test';

/**
 * Touch input: a finger sliding from one lane to another without lifting releases the lane it
 * left and presses the new one (TIMING.md §3). Driven with real touch events through CDP on the
 * phone profile; the lane events the controller receives are recorded by wrapping its handler.
 */
async function waitScreen(page: Page, name: string, timeout = 30_000): Promise<void> {
  await page.waitForFunction((n) => window.__seedbeat?.screen() === n, name, { timeout });
}

test('sliding a finger across lanes releases the old lane and presses the new one', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone-chromium', 'touch profile only');
  await page.goto('/#audio=0&memsave=1&touch=1&lock=1&m=lofi&s=amber-11&d=1');
  await waitScreen(page, 'select');
  await page.getByRole('button', { name: 'PLAY' }).click();
  await waitScreen(page, 'playing');
  await page.evaluate(() => {
    const w = window as Window & { __lanes?: string[] };
    w.__lanes = [];
    const c = window.__seedbeat!.controller as unknown as {
      onInput: (e: { lane: number; down: boolean; source: string }) => void;
    };
    const orig = c.onInput.bind(c);
    c.onInput = (e) => {
      if (e.source === 'pointer') w.__lanes!.push(`${e.down ? 'down' : 'up'} ${e.lane}`);
      orig(e);
    };
  });
  const width = page.viewportSize()!.width;
  const laneX = (lane: number): number => Math.round(((lane + 0.5) * width) / 4);
  const y = Math.round(page.viewportSize()!.height * 0.6);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
    });
  await touch('touchStart', laneX(0));
  // A slow slide: several moves through lane 1 into lane 2, then lift.
  for (const x of [laneX(0) + 20, laneX(1) - 10, laneX(1) + 10, laneX(2) - 10, laneX(2)])
    await touch('touchMove', x);
  await touch('touchEnd', 0);
  const lanes = await page.evaluate(() => (window as Window & { __lanes?: string[] }).__lanes);
  expect(lanes).toEqual(['down 0', 'up 0', 'down 1', 'up 1', 'down 2', 'up 2']);
});
