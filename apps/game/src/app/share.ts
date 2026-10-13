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

/** Share the card via the Web Share API when available, else trigger a download. Returns what happened. */
export async function shareCard(blob: Blob, name: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], name, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    await nav.share({ files: [file], title: 'Seedbeat result' });
    return 'shared';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
