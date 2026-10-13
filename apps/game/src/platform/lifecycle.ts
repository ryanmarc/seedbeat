/**
 * Page and audio lifecycle (M7): one place that turns the browser's many "you are not the
 * foreground thing any more" signals into `hidden` / `visible`, and the AudioContext's state
 * changes into `interrupted` / `running`. iOS Safari reports a phone call or Siri as the
 * non-standard `interrupted` state; Android pauses the context as `suspended` when another app
 * takes the audio focus. Targets are injected so this runs in Node.
 */
export interface LifecycleTarget {
  addEventListener(type: string, fn: (e: Event) => void): void;
  removeEventListener(type: string, fn: (e: Event) => void): void;
}

export interface LifecycleHooks {
  hidden: () => void;
  visible: () => void;
}

export function watchPage(
  hooks: LifecycleHooks,
  doc: LifecycleTarget & {
    readonly visibilityState?: string;
    readonly hidden?: boolean;
  } = document,
  win: LifecycleTarget = window,
): () => void {
  const isHidden = (): boolean => doc.hidden === true || doc.visibilityState === 'hidden';
  const onVis = (): void => (isHidden() ? hooks.hidden() : hooks.visible());
  const onHide = (): void => hooks.hidden();
  doc.addEventListener('visibilitychange', onVis);
  // iOS Safari (lock, app switch) and bfcache: pagehide/freeze can fire without visibilitychange.
  win.addEventListener('pagehide', onHide);
  doc.addEventListener('freeze', onHide);
  win.addEventListener('pageshow', onVis);
  doc.addEventListener('resume', onVis);
  return () => {
    doc.removeEventListener('visibilitychange', onVis);
    win.removeEventListener('pagehide', onHide);
    doc.removeEventListener('freeze', onHide);
    win.removeEventListener('pageshow', onVis);
    doc.removeEventListener('resume', onVis);
  };
}

export type AudioState = 'running' | 'suspended' | 'interrupted' | 'closed';

export interface AudioHooks {
  /** The OS took the output (call, Siri, another app, device change on some phones). */
  interrupted: (state: AudioState) => void;
  running: () => void;
  closed: () => void;
}

export function watchAudio(
  ctx: LifecycleTarget & { readonly state: string },
  hooks: AudioHooks,
): () => void {
  let last = ctx.state;
  const on = (): void => {
    const s = ctx.state as AudioState;
    if (s === last) return;
    last = s;
    if (s === 'running') hooks.running();
    else if (s === 'closed') hooks.closed();
    else hooks.interrupted(s);
  };
  ctx.addEventListener('statechange', on);
  return () => ctx.removeEventListener('statechange', on);
}
