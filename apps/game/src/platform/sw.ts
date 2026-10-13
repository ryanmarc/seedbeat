/**
 * Registers the service worker that precaches the app shell (built by vite-plugin-sw.ts).
 * Production only: the dev server serves unbundled modules. Resolves to what happened so the
 * caller can tell the player when a new build has been installed behind the running one.
 */
export type SwOutcome = 'unsupported' | 'skipped' | 'registered' | 'failed';

export interface SwHooks {
  /** A newer build was installed while this one is running; it is used on the next load. */
  onUpdate?: () => void;
}

export async function registerServiceWorker(
  hooks: SwHooks = {},
  enabled = import.meta.env.PROD,
): Promise<SwOutcome> {
  if (!enabled) return 'skipped';
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported';
  try {
    const base = import.meta.env.BASE_URL;
    const reg = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
    const hadController = navigator.serviceWorker.controller !== null;
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && hadController) hooks.onUpdate?.();
      });
    });
    return 'registered';
  } catch {
    return 'failed';
  }
}
