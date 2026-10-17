/**
 * Haptics behind an adapter (ARCHITECTURE.md §8): the web build uses the Vibration API where it
 * exists; native shells can plug in Capacitor Haptics later. Throttled to one pulse per 40 ms.
 * DESIGN.md §6: light tick on Perfect/Great, softer on Good, a double pulse on miss or early
 * release, and only primary buttons in menus.
 */
import type { Judgement } from '@seedbeat/core';

export type HapticKind = 'light' | 'soft' | 'miss' | 'ui';

export interface Haptics {
  readonly available: boolean;
  pulse(kind: HapticKind): void;
}

const PATTERN: Record<HapticKind, number | number[]> = {
  light: 12,
  soft: 7,
  miss: [18, 40, 18],
  ui: 8,
};

export const THROTTLE_MS = 40;

export class WebHaptics implements Haptics {
  readonly available: boolean;
  private last = -Infinity;
  enabled = true;

  constructor(
    private readonly vibrate: ((p: number | number[]) => boolean) | null = vibrateFn(),
    private readonly now: () => number = () => performance.now(),
  ) {
    this.available = vibrate !== null;
  }

  pulse(kind: HapticKind): void {
    if (!this.enabled || !this.vibrate) return;
    const t = this.now();
    if (t - this.last < THROTTLE_MS) return;
    this.last = t;
    try {
      this.vibrate(PATTERN[kind]);
    } catch {
      /* some browsers throw without user activation */
    }
  }
}

export const NO_HAPTICS: Haptics = { available: false, pulse() {} };

export function hapticFor(j: Judgement): HapticKind {
  switch (j) {
    case 'perfect':
    case 'great':
      return 'light';
    case 'good':
      return 'soft';
    default:
      return 'miss';
  }
}

function vibrateFn(): ((p: number | number[]) => boolean) | null {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return null;
  return (p) => navigator.vibrate(p);
}
