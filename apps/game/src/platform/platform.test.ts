import { describe, expect, it, vi } from 'vitest';
import { installable, promptInstall, standalone, watchInstall, iosInstallHint } from './install';
import { watchAudio, watchPage } from './lifecycle';
import { WakeLockKeeper, type WakeLockSentinelLike } from './wake-lock';

class Target {
  private readonly fns = new Map<string, Set<(e: Event) => void>>();
  state = 'running';
  hidden = false;
  addEventListener(type: string, fn: (e: Event) => void): void {
    if (!this.fns.has(type)) this.fns.set(type, new Set());
    this.fns.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (e: Event) => void): void {
    this.fns.get(type)?.delete(fn);
  }
  fire(type: string, e: Partial<Event> = {}): void {
    for (const fn of this.fns.get(type) ?? []) fn({ type, preventDefault() {}, ...e } as Event);
  }
  count(): number {
    let n = 0;
    for (const s of this.fns.values()) n += s.size;
    return n;
  }
}

describe('watchPage', () => {
  it('maps visibility, pagehide, freeze and pageshow to hidden/visible', () => {
    const doc = new Target();
    const win = new Target();
    const hidden = vi.fn();
    const visible = vi.fn();
    const off = watchPage({ hidden, visible }, doc, win);
    doc.hidden = true;
    doc.fire('visibilitychange');
    expect(hidden).toHaveBeenCalledTimes(1);
    doc.hidden = false;
    doc.fire('visibilitychange');
    expect(visible).toHaveBeenCalledTimes(1);
    win.fire('pagehide');
    doc.fire('freeze');
    expect(hidden).toHaveBeenCalledTimes(3);
    win.fire('pageshow');
    expect(visible).toHaveBeenCalledTimes(2);
    off();
    expect(doc.count() + win.count()).toBe(0);
  });
});

describe('watchAudio', () => {
  it('reports interruptions, recovery and closure once per change', () => {
    const ctx = new Target();
    const interrupted = vi.fn();
    const running = vi.fn();
    const closed = vi.fn();
    watchAudio(ctx, { interrupted, running, closed });
    ctx.fire('statechange'); // still running: no change
    expect(running).not.toHaveBeenCalled();
    ctx.state = 'interrupted';
    ctx.fire('statechange');
    ctx.fire('statechange');
    expect(interrupted).toHaveBeenCalledTimes(1);
    expect(interrupted).toHaveBeenCalledWith('interrupted');
    ctx.state = 'running';
    ctx.fire('statechange');
    expect(running).toHaveBeenCalledTimes(1);
    ctx.state = 'suspended';
    ctx.fire('statechange');
    expect(interrupted).toHaveBeenLastCalledWith('suspended');
    ctx.state = 'closed';
    ctx.fire('statechange');
    expect(closed).toHaveBeenCalledTimes(1);
  });
});

describe('WakeLockKeeper', () => {
  function fakeApi() {
    const sentinels: (WakeLockSentinelLike & { fire(): void })[] = [];
    const api = {
      requests: 0,
      request: vi.fn(async () => {
        api.requests++;
        const listeners: (() => void)[] = [];
        const s = {
          released: false,
          async release() {
            s.released = true;
            for (const l of listeners) l();
          },
          addEventListener(_t: 'release', fn: () => void) {
            listeners.push(fn);
          },
          fire() {
            s.released = true;
            for (const l of listeners) l();
          },
        };
        sentinels.push(s);
        return s;
      }),
    };
    return { api, sentinels };
  }

  it('holds once, releases, and re-acquires after the browser dropped it', async () => {
    const { api, sentinels } = fakeApi();
    let visible = true;
    const k = new WakeLockKeeper(api, () => visible);
    expect(k.available).toBe(true);
    await k.hold();
    await k.hold();
    expect(api.requests).toBe(1);
    expect(k.held).toBe(true);
    // Page hidden: the browser releases the sentinel itself.
    visible = false;
    sentinels[0]!.fire();
    expect(k.held).toBe(false);
    k.onVisibility();
    expect(api.requests).toBe(1); // not visible yet
    visible = true;
    k.onVisibility();
    await Promise.resolve();
    await Promise.resolve();
    expect(api.requests).toBe(2);
    expect(k.held).toBe(true);
    await k.release();
    expect(k.held).toBe(false);
    expect(sentinels[1]!.released).toBe(true);
    k.onVisibility();
    expect(api.requests).toBe(2); // released on purpose: stays released
  });

  it('is a no-op without the API or when the request is denied', async () => {
    const none = new WakeLockKeeper(null, () => true);
    expect(none.available).toBe(false);
    await none.hold();
    expect(none.held).toBe(false);
    const denied = new WakeLockKeeper(
      { request: () => Promise.reject(new Error('no')) },
      () => true,
    );
    await denied.hold();
    expect(denied.held).toBe(false);
  });

  it('releases a lock that resolves after release() was called', async () => {
    const { api, sentinels } = fakeApi();
    const k = new WakeLockKeeper(api, () => true);
    const p = k.hold();
    await k.release();
    await p;
    expect(k.held).toBe(false);
    expect(sentinels[0]!.released).toBe(true);
  });
});

describe('install', () => {
  it('captures beforeinstallprompt, prompts once per event, and tracks installation', async () => {
    const win = new Target();
    watchInstall({ target: win, standalone: () => false });
    expect(standalone.value).toBe(false);
    expect(installable.value).toBe(false);
    expect(await promptInstall()).toBeNull();
    const prompt = vi.fn(async () => {});
    const event = (outcome: 'accepted' | 'dismissed') =>
      ({ prompt, userChoice: Promise.resolve({ outcome }) }) as unknown as Partial<Event>;
    win.fire('beforeinstallprompt', event('dismissed'));
    expect(installable.value).toBe(true);
    expect(await promptInstall()).toBe('dismissed');
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(installable.value).toBe(false);
    expect(await promptInstall()).toBeNull(); // the used event is gone until Chromium sends another
    win.fire('beforeinstallprompt', event('accepted'));
    expect(installable.value).toBe(true);
    expect(await promptInstall()).toBe('accepted');
    expect(installable.value).toBe(false);
    win.fire('appinstalled');
    expect(standalone.value).toBe(true);
  });

  it('shows the iOS hint only in Safari on iOS and not when installed', () => {
    const safari =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const chromeIos =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1';
    const android =
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36';
    expect(iosInstallHint(safari, false)).toBe(true);
    expect(iosInstallHint(safari, true)).toBe(false);
    expect(iosInstallHint(chromeIos, false)).toBe(false);
    expect(iosInstallHint(android, false)).toBe(false);
  });
});
