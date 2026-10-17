import type { JudgementEvent } from '@seedbeat/core';

const LIMIT = 135;
const COLOURS: Record<string, string> = {
  perfect: 'var(--accent2)',
  great: 'var(--accent)',
  good: '#d7d0ee',
  miss: 'var(--bad)',
  drop: 'var(--bad)',
};

function colour(j: string): string {
  return COLOURS[j.replace(/^r/, '')] ?? '#fff';
}

/** Each hit's offset over the song: x = song time, y = early/late ms within ±135 ms (PRD §5). */
export function TimingGraph({ events, duration }: { events: JudgementEvent[]; duration: number }) {
  const W = 520;
  const H = 150;
  const hits = events.filter((e) => e.judgement !== 'miss');
  const y = (ms: number): number =>
    H / 2 - (Math.max(-LIMIT, Math.min(LIMIT, ms)) / LIMIT) * (H / 2 - 8);
  return (
    <svg
      class="graph"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Timing graph: ${hits.length} hits, offsets over the song`}
    >
      <rect x={0} y={y(45)} width={W} height={y(-45) - y(45)} fill="rgba(255,255,255,0.05)" />
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="var(--line)" />
      <text x={6} y={14} fill="var(--dim)" font-size="10" font-family="var(--font-num)">
        early
      </text>
      <text x={6} y={H - 6} fill="var(--dim)" font-size="10" font-family="var(--font-num)">
        late
      </text>
      {hits.map((e, i) => (
        <circle
          key={i}
          cx={(Math.max(0, e.t) / Math.max(duration, 1)) * W}
          cy={y(e.dt * 1000)}
          r={2.2}
          fill={colour(e.judgement)}
        />
      ))}
    </svg>
  );
}

/** Early/late histogram in 15 ms bins. */
export function Histogram({ events }: { events: JudgementEvent[] }) {
  const bins = 18;
  const counts = new Array<number>(bins).fill(0);
  for (const e of events) {
    if (e.judgement === 'miss') continue;
    const ms = Math.max(-LIMIT, Math.min(LIMIT - 0.001, e.dt * 1000));
    counts[Math.floor(((ms + LIMIT) / (2 * LIMIT)) * bins)]!++;
  }
  const max = Math.max(1, ...counts);
  const W = 520;
  const H = 80;
  const bw = W / bins;
  return (
    <svg class="graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Early and late histogram">
      {counts.map((c, i) => (
        <rect
          key={i}
          x={i * bw + 1}
          y={H - 12 - (c / max) * (H - 18)}
          width={bw - 2}
          height={(c / max) * (H - 18)}
          fill={Math.abs(i - bins / 2 + 0.5) < 2 ? 'var(--accent2)' : 'var(--accent)'}
          opacity={0.85}
        />
      ))}
      <text x={4} y={H - 2} fill="var(--dim)" font-size="10" font-family="var(--font-num)">
        −135 ms early
      </text>
      <text
        x={W - 4}
        y={H - 2}
        fill="var(--dim)"
        font-size="10"
        font-family="var(--font-num)"
        text-anchor="end"
      >
        late +135 ms
      </text>
    </svg>
  );
}
