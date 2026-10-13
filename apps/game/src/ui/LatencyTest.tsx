import { useEffect, useRef, useState } from 'preact/hooks';

const TAPS = 8;

/**
 * Input latency test (PRD §7): how long after a touch or key press the event reaches the game.
 * Judgement uses the event timestamp, so this delay does not change scoring; it tells the player
 * whether an unusual device is delivering input late (TIMING.md §3).
 */
export function LatencyTest() {
  const [delays, setDelays] = useState<number[] | null>(null);
  const pad = useRef<HTMLButtonElement>(null);
  const doneAt = useRef(-Infinity);
  const start = (): void => {
    // The last tap's pointer-up lands on this button once it replaces the pad: not a restart.
    if (performance.now() - doneAt.current < 500) return;
    setDelays([]);
  };
  const tap = (e: Event): void => {
    if (!delays || delays.length >= TAPS) return;
    const d = performance.now() - e.timeStamp;
    if (!(d >= 0 && d < 1000)) return; // synthetic or foreign-origin timestamps
    if (delays.length + 1 >= TAPS) doneAt.current = performance.now();
    setDelays([...delays, d]);
  };
  useEffect(() => {
    if (delays && delays.length < TAPS) pad.current?.focus();
  }, [delays]);
  const done = delays && delays.length >= TAPS;
  const mean = done ? delays.reduce((a, b) => a + b, 0) / delays.length : 0;
  const max = done ? Math.max(...delays) : 0;
  return (
    <div class="setting">
      <div>
        <div class="name">Input latency test</div>
        <div class="desc">
          {done
            ? `Taps reach the game ${mean.toFixed(1)} ms after the touch (max ${max.toFixed(1)} ms). ${
                max > 30
                  ? 'That is high; the game still judges by the touch time, so scoring is unaffected.'
                  : 'That is normal.'
              }`
            : delays
              ? `Tap the pad ${TAPS - delays.length} more time${TAPS - delays.length === 1 ? '' : 's'}.`
              : 'Measures how late touches and keys are delivered. Scoring already uses the touch time.'}
        </div>
      </div>
      {delays && !done ? (
        <button
          ref={pad}
          type="button"
          class="btn primary latency-pad"
          onPointerDown={tap}
          onKeyDown={(e) => {
            if (e.code === 'Space' || e.code === 'Enter') {
              e.preventDefault();
              if (!e.repeat) tap(e);
            }
          }}
          aria-label={`Latency test pad, ${TAPS - delays.length} taps left`}
        >
          TAP
        </button>
      ) : (
        <button type="button" class="btn small" onClick={start}>
          {done ? 'Run again' : 'Start test'}
        </button>
      )}
    </div>
  );
}
