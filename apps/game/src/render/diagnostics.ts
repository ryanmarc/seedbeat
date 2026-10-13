import { summarizeStats, type FrameStats } from '../engine/loop';

export interface DiagnosticsInput {
  stats: FrameStats;
  pacingHalf: boolean;
  tier: number;
  tierScale: number;
  tierLocked: boolean;
  outputLatencyMs: number;
  audioVoices: number;
  audioSteals: number;
  clockOffsetMs: number | null;
}

/**
 * Developer-mode overlay (PERFORMANCE.md §5). Plain DOM, updated at most twice a second with a
 * single textContent write; never touched inside the frame work.
 */
export class DiagnosticsOverlay {
  private readonly el: HTMLElement;
  private lastUpdate = 0;
  constructor(parent: HTMLElement) {
    const el = document.createElement('pre');
    el.id = 'diag';
    el.style.cssText =
      'position:fixed;top:8px;left:8px;margin:0;padding:6px 8px;font:11px/1.4 ui-monospace,Menlo,monospace;color:#f3effc;background:rgba(13,10,22,.84);border-radius:6px;pointer-events:none;z-index:50;white-space:pre';
    parent.appendChild(el);
    this.el = el;
  }
  set visible(v: boolean) {
    this.el.hidden = !v;
  }
  get visible(): boolean {
    return !this.el.hidden;
  }
  update(nowMs: number, d: DiagnosticsInput): void {
    if (this.el.hidden || nowMs - this.lastUpdate < 500) return;
    this.lastUpdate = nowMs;
    const s = summarizeStats(d.stats);
    this.el.textContent =
      `fps ${s.fps.toFixed(1)}  refresh ${s.refreshHz.toFixed(0)} Hz  late ${(s.late * 100).toFixed(1)}%\n` +
      `frame p50 ${s.p50Ms.toFixed(1)} ms  p95 ${s.p95Ms.toFixed(1)} ms  js p95 ${s.workP95Ms.toFixed(2)} ms\n` +
      `pacing ${d.pacingHalf ? 'half' : 'full'}  tier ${d.tier} (${d.tierScale}x${d.tierLocked ? ', locked' : ''})\n` +
      `audio out ${d.outputLatencyMs.toFixed(0)} ms  voices ${d.audioVoices}  steals ${d.audioSteals}  clock ${d.clockOffsetMs === null ? '–' : d.clockOffsetMs.toFixed(1) + ' ms'}`;
  }
  destroy(): void {
    this.el.remove();
  }
}
