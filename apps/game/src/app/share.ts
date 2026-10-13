import type { RunResult } from './state';
import { DIFF_LABEL, MOOD_LABEL } from './format';

/** Deep link for a seed (PRD §6): `#s=<seed>&m=<mood>&d=<diff>&mode=<mode>`. */
export function deepLink(sel: RunResult['selection']): string {
  const p = new URLSearchParams({
    s: sel.seed,
    m: sel.mood,
    d: String(sel.difficulty),
    mode: sel.mode,
  });
  return `${location.origin}${location.pathname}#${p.toString()}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Draws a 1080×1350 result card (canvas 2D, off the frame loop) and returns it as a PNG blob. */
export async function resultCard(
  r: RunResult,
  accent: string,
  accent2: string,
  bg: string,
): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 1350;
  const x = c.getContext('2d')!;
  x.fillStyle = bg;
  x.fillRect(0, 0, c.width, c.height);
  const g = x.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, 'rgba(255,255,255,0.06)');
  g.addColorStop(1, 'rgba(0,0,0,0.3)');
  x.fillStyle = g;
  x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#f3effc';
  x.font = '400 72px "Rubik Mono One", Impact, sans-serif';
  x.fillText('SEEDBEAT', 80, 150);
  x.font = '400 360px "Rubik Mono One", Impact, sans-serif';
  x.fillStyle = r.grade === 'F' ? '#ff5d6c' : accent;
  x.fillText(r.grade, 80, 560);
  x.fillStyle = '#f3effc';
  x.font = '700 64px "Chakra Petch", system-ui, sans-serif';
  x.fillText(r.songName, 80, 680);
  x.fillStyle = '#a39cbd';
  x.font = '500 36px "JetBrains Mono", monospace';
  x.fillText(
    `${MOOD_LABEL[r.selection.mood]} · ${DIFF_LABEL[r.selection.difficulty]} · ${r.selection.mode} · seed ${r.selection.seed}`,
    80,
    740,
  );
  x.fillStyle = accent2;
  x.fillRect(80, 780, 920, 6);
  const rows: [string, string][] = [
    ['SCORE', r.summary.score.toLocaleString()],
    ['ACCURACY', `${(r.summary.accuracy * 100).toFixed(1)}%`],
    ['MAX COMBO', String(r.summary.maxCombo)],
    [
      'PERFECT / GREAT / GOOD / MISS',
      `${r.summary.counts.perfect} / ${r.summary.counts.great} / ${r.summary.counts.good} / ${r.summary.counts.miss}`,
    ],
  ];
  let y = 860;
  for (const [k, v] of rows) {
    x.fillStyle = '#a39cbd';
    x.font = '600 26px "Chakra Petch", system-ui, sans-serif';
    x.fillText(k, 80, y);
    x.fillStyle = '#f3effc';
    x.font = '700 56px "JetBrains Mono", monospace';
    x.fillText(v, 80, y + 64);
    y += 120;
  }
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );
}

/** The subset of `navigator` sharing needs, so the decision logic is testable in Node. */
export interface ShareNav {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  clipboard?: { writeText(text: string): Promise<void> };
}

export interface SharePayload {
  title: string;
  text: string;
  url: string;
  file: File | null;
}

export type ShareOutcome = 'shared' | 'cancelled' | 'copied' | 'copied+downloaded' | 'failed';

/**
 * Web Share first (M7): the result card and the link together where files are supported (Android
 * Chrome, iOS Safari), the link alone otherwise; without Web Share, copy the link and download
 * the card. The deep link rides in `text` beside the file because some share targets drop `url`
 * when files are attached.
 */
export async function shareWith(
  nav: ShareNav,
  p: SharePayload,
  download: (file: File) => void,
): Promise<ShareOutcome> {
  if (nav.share) {
    try {
      if (p.file && nav.canShare?.({ files: [p.file] })) {
        await nav.share({ files: [p.file], title: p.title, text: `${p.text} ${p.url}` });
      } else {
        await nav.share({ title: p.title, text: p.text, url: p.url });
      }
      return 'shared';
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
      /* NotAllowedError (no gesture) or unsupported data: fall through to the copy path */
    }
  }
  let copied = false;
  if (nav.clipboard) {
    try {
      await nav.clipboard.writeText(p.url);
      copied = true;
    } catch {
      /* clipboard refused (no gesture, permissions) */
    }
  }
  if (p.file) download(p.file);
  if (!copied) return 'failed';
  return p.file ? 'copied+downloaded' : 'copied';
}

export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const SHARE_MESSAGE: Record<ShareOutcome, string> = {
  shared: 'Shared.',
  cancelled: 'Share cancelled.',
  copied: 'Link copied.',
  'copied+downloaded': 'Link copied and result card downloaded.',
  failed: 'Could not share or copy the link here.',
};

/** Share a finished run: deep link plus the result card image. Returns the message to show. */
export async function shareRun(
  r: RunResult,
  accent: string,
  accent2: string,
  bg: string,
): Promise<string> {
  let file: File | null = null;
  try {
    const blob = await resultCard(r, accent, accent2, bg);
    file = new File([blob], `seedbeat-${r.selection.seed}.png`, { type: 'image/png' });
  } catch {
    /* no canvas: share the link alone */
  }
  const outcome = await shareWith(
    navigator as ShareNav,
    {
      title: 'Seedbeat',
      text: `${r.songName}: grade ${r.grade}, ${r.summary.score.toLocaleString()} points on Seedbeat. Same seed, same song:`,
      url: deepLink(r.selection),
      file,
    },
    downloadFile,
  );
  return SHARE_MESSAGE[outcome];
}
