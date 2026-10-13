/**
 * PWA install (M7). Chromium browsers fire `beforeinstallprompt`; we stash the event so the
 * title screen can offer an Install button. iOS Safari has no prompt, so there we show the
 * "Share → Add to Home Screen" hint instead, unless the app is already running standalone.
 */
import { signal } from '@preact/signals';

export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** An install prompt is available (Chromium). */
export const installable = signal(false);
/** Running as an installed app (home screen or desktop window). */
export const standalone = signal(false);

let deferred: InstallPromptEvent | null = null;

export interface InstallEnv {
  target: Pick<Window, 'addEventListener'>;
  standalone: () => boolean;
}

export function isStandalone(w: Window = window): boolean {
  const nav = w.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || w.matchMedia('(display-mode: standalone)').matches;
}

export function watchInstall(env: InstallEnv): void {
  standalone.value = env.standalone();
  env.target.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    installable.value = true;
  });
  env.target.addEventListener('appinstalled', () => {
    deferred = null;
    installable.value = false;
    standalone.value = true;
  });
}

/** Show the browser's install dialog. Resolves to the player's choice, or null without a prompt. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | null> {
  const e = deferred;
  if (!e) return null;
  deferred = null;
  installable.value = false;
  await e.prompt();
  // prompt() works once per event; after a dismissal Chromium fires a fresh event later.
  return (await e.userChoice).outcome;
}

/** iOS Safari (not Chrome on iOS, which cannot install): show the manual steps. */
export function iosInstallHint(
  ua: string = navigator.userAgent,
  isStandaloneNow = standalone.value,
): boolean {
  if (isStandaloneNow) return false;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}
