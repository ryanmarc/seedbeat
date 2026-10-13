import { summarizeStats, type FrameStats } from '../engine/loop';

export interface DiagnosticsInput {
  stats: FrameStats;
  pacingHalf: boolean;
  tier: number;
  tierScale: number;
  tierLocked: boolean;
  outputLatencyMs: number;
  audio: AudioStats;
  clockOffsetMs: number | null;
}

/** Latest worklet status, kept by the controller off the frame loop. */
export interface AudioStats {
  voices: number;
  peakVoices: number;
  steals: number;
  periodMs: number;
  maxGapMs: number;
  stalls: number;
  lastStallMs: number;
  maxBusyMs: number;
  /** Song position of the last stall, e.g. 'bar 17 step 4'. */
  lastStallAt: string;
}

export const NO_AUDIO_STATS: AudioStats = {
  voices: 0,
  peakVoices: 0,
  steals: 0,
  periodMs: 0,
  maxGapMs: 0,
  stalls: 0,
  lastStallMs: 0,
  maxBusyMs: 0,
  lastStallAt: '',
};

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
    const a = d.audio;
    this.el.textContent =
      `fps ${s.fps.toFixed(1)}  refresh ${s.refreshHz.toFixed(0)} Hz  late ${(s.late * 100).toFixed(1)}%\n` +
      `frame p50 ${s.p50Ms.toFixed(1)} ms  p95 ${s.p95Ms.toFixed(1)} ms  js p95 ${s.workP95Ms.toFixed(2)} ms\n` +
      `pacing ${d.pacingHalf ? 'half' : 'full'}  tier ${d.tier} (${d.tierScale}x${d.tierLocked ? ', locked' : ''})\n` +
      `audio out ${d.outputLatencyMs.toFixed(0)} ms  clock ${d.clockOffsetMs === null ? '–' : d.clockOffsetMs.toFixed(1) + ' ms'}  voices ${a.voices}/${a.peakVoices}  steals ${a.steals}\n` +
      `audio period ${a.periodMs ? a.periodMs.toFixed(0) : '–'} ms  max gap ${a.maxGapMs.toFixed(0)} ms  busy ${a.maxBusyMs.toFixed(0)} ms  stalls ${a.stalls}${a.stalls ? ` (${a.lastStallMs.toFixed(0)} ms ${a.lastStallAt})` : ''}`;
  }
  destroy(): void {
    this.el.remove();
  }
}
