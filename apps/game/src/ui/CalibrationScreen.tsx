import { useEffect, useRef, useState } from 'preact/hooks';
import { controller } from '../app/controller';
import { settings, showToast } from '../app/state';
import { eventMs } from '../engine/clock';
import { CLICK_COUNT, CLICK_INTERVAL, estimateOffset, tapDeviation } from '../engine/calibration';
import { Screen } from './components';

/**
 * Audio calibration (TIMING.md §5): 24 clicks at 100 BPM, taps measured against the clock.
 * Visual calibration: a marker crosses a line at 100 BPM while the line flashes; adjust the
 * visual offset until they coincide.
 */
export function CalibrationScreen() {
  const s = settings.value;
  const [status, setStatus] = useState('Ready');
  const [devs, setDevs] = useState<number[]>([]);
  const [running, setRunning] = useState(false);
  const [noAudio, setNoAudio] = useState(false);
  const startRef = useRef<number | null>(null);
  const dot = useRef<HTMLDivElement>(null);
  const note = useRef<HTMLDivElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  const est = estimateOffset(devs);

  const start = async (): Promise<void> => {
    const t = await controller.startClicks();
    if (t === null) {
      setNoAudio(true);
      setStatus('Audio is not available here. Use the visual step below.');
      return;
    }
    startRef.current = t;
    setDevs([]);
    setRunning(true);
    setStatus('Tap on each click');
  };
  const tap = (e: Event): void => {
    if (!running || startRef.current === null) return;
    if ((e.target as HTMLElement).closest('button')) return;
    const heard = controller.heardAt(eventMs(e.timeStamp, performance.now()));
    const d = tapDeviation(heard - startRef.current);
    if (d !== null) setDevs((x) => [...x, d]);
  };
  useEffect(() => {
    let raf = 0;
    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame);
      // Visual step: marker at phase, flash on the beat. Marker uses the visual offset.
      const t = now / 1000;
      const ph = (((t / CLICK_INTERVAL) % 1) + 1) % 1;
      const phV = ((((t - s.visualOffsetMs / 1000) / CLICK_INTERVAL) % 1) + 1) % 1;
      if (note.current) note.current.style.transform = `translateY(${phV * 120 - 14}px)`;
      if (flash.current) flash.current.style.opacity = String(Math.exp(-ph * 9));
      if (running && startRef.current !== null) {
        const heard = controller.heardAt(now) - startRef.current;
        const phase = heard < 0 ? 1 : (heard / CLICK_INTERVAL) % 1;
        const p = Math.exp(-phase * 6);
        if (dot.current) {
          dot.current.style.transform = `scale(${1 + p * 0.3})`;
          dot.current.style.background = `color-mix(in srgb, var(--accent) ${Math.round(p * 100)}%, transparent)`;
        }
        if (heard > CLICK_COUNT * CLICK_INTERVAL + 0.4) {
          setRunning(false);
          controller.stopClicks();
          setStatus(devs.length >= 6 ? 'Done. Measured offset' : 'Too few taps. Try again');
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running, devs.length, s.visualOffsetMs]);
  useEffect(() => () => controller.stopClicks(), []);
  const adjust = (key: 'audioOffsetMs' | 'visualOffsetMs', delta: number): void =>
    controller.store.setSettings({ [key]: s[key] + delta });
  return (
    <div
      onPointerDown={tap}
      onKeyDown={(e) => !(e.target as HTMLElement).closest('button') && tap(e)}
    >
      <Screen
        id="calibration"
        title="Timing calibration"
        lede="You will hear 24 clicks at 100 BPM; the first four are a warm-up. Tap the screen or press any key on each click. Seedbeat averages how early or late your taps land and shifts the judgement window to match your speakers and screen."
      >
        <div class="cal-stage">
          <div class="cal-dot" ref={dot} aria-hidden="true" />
          <div class="cal-read" aria-live="polite">
            <span>{status}</span>
            <br />
            <b>{devs.length ? `${Math.round(est.offset * 1000)} ms` : '—'}</b>
            <br />
            <span>
              {devs.length
                ? `${devs.length} taps · varied by about ±${Math.round(est.spread * 1000)} ms`
                : ''}
            </span>
          </div>
        </div>
        <div>
          <div class="cal-dots" aria-hidden="true">
            {devs.map((d, i) => (
              <i
                key={i}
                style={{ left: `${50 + (Math.max(-0.15, Math.min(0.15, d)) / 0.15) * 50}%` }}
              />
            ))}
          </div>
          <div class="cal-axis">
            <span>−150 ms early</span>
            <span>on beat</span>
            <span>late +150 ms</span>
          </div>
        </div>
        <div class="offset-row">
          <span class="lbl">Audio offset</span>
          <button
            type="button"
            class="btn small"
            aria-label="Decrease audio offset by 5 milliseconds"
            onClick={() => adjust('audioOffsetMs', -5)}
          >
            −5
          </button>
          <output>{s.audioOffsetMs} ms</output>
          <button
            type="button"
            class="btn small"
            aria-label="Increase audio offset by 5 milliseconds"
            onClick={() => adjust('audioOffsetMs', 5)}
          >
            +5
          </button>
          <button
            type="button"
            class="btn small"
            disabled={devs.length < 6}
            onClick={() =>
              controller.store.setSettings({ audioOffsetMs: Math.round(est.offset * 1000) })
            }
          >
            Use measured
          </button>
        </div>
        <div class="btnrow">
          <button type="button" class="btn primary" disabled={running} onClick={() => void start()}>
            {noAudio ? 'AUDIO UNAVAILABLE' : 'START CLICKS'}
          </button>
        </div>
        <h3>Visual offset</h3>
        <p class="hint">
          The bar should reach the line exactly when the line flashes. Adjust until they coincide;
          this shifts drawing only.
        </p>
        <div class="vis-track" aria-hidden="true">
          <div class="vis-flash" ref={flash} />
          <div class="vis-line" />
          <div class="vis-note" ref={note} />
        </div>
        <div class="offset-row">
          <span class="lbl">Visual offset</span>
          <button
            type="button"
            class="btn small"
            aria-label="Decrease visual offset by 5 milliseconds"
            onClick={() => adjust('visualOffsetMs', -5)}
          >
            −5
          </button>
          <output>{s.visualOffsetMs} ms</output>
          <button
            type="button"
            class="btn small"
            aria-label="Increase visual offset by 5 milliseconds"
            onClick={() => adjust('visualOffsetMs', 5)}
          >
            +5
          </button>
        </div>
        <div class="btnrow">
          <button
            type="button"
            class="btn primary"
            onClick={() => {
              controller.stopClicks();
              if (devs.length >= 6) showToast('Calibration saved.');
              controller.closeOverlay();
            }}
          >
            DONE
          </button>
        </div>
      </Screen>
    </div>
  );
}
