/**
 * Keeps the screen on during play with the Screen Wake Lock API (M7). The browser releases the
 * lock whenever the page is hidden, so the keeper re-requests it on the next `hold()` after the
 * page is visible again. Everything is injected so it runs headless in tests.
 */
export interface WakeLockSentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', fn: () => void): void;
}

export interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

export class WakeLockKeeper {
  readonly available: boolean;
  private sentinel: WakeLockSentinelLike | null = null;
  private wanted = false;
  private pending: Promise<void> | null = null;

  constructor(
    private readonly api: WakeLockLike | null = wakeLockApi(),
    private readonly visible: () => boolean = () =>
      typeof document === 'undefined' || document.visibilityState === 'visible',
  ) {
    this.available = api !== null;
  }

  get held(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  /** Ask for the lock (idempotent). Safe to call every time play starts or the page returns. */
  hold(): Promise<void> {
    this.wanted = true;
    if (!this.api || this.held || !this.visible()) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = this.api
      .request('screen')
      .then((s) => {
        if (!this.wanted) return s.release();
        this.sentinel = s;
        s.addEventListener('release', () => {
          if (this.sentinel === s) this.sentinel = null;
        });
      })
      .catch(() => {
        /* denied (low battery, not visible): play continues without it */
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  /** Let the screen dim again (menus, results, pause). */
  release(): Promise<void> {
    this.wanted = false;
    const s = this.sentinel;
    this.sentinel = null;
    return s && !s.released ? s.release().catch(() => {}) : Promise.resolve();
  }

  /** Call on visibilitychange: re-acquire when the page comes back while play wants it. */
  onVisibility(): void {
    if (this.wanted && this.visible() && !this.held) void this.hold();
  }
}

function wakeLockApi(): WakeLockLike | null {
  if (typeof navigator === 'undefined') return null;
  const n = navigator as Navigator & { wakeLock?: WakeLockLike };
  return n.wakeLock && typeof n.wakeLock.request === 'function' ? n.wakeLock : null;
}
