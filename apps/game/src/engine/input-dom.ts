import {
  eventMs,
  type InputSink,
  GamepadLanes,
  KeyMap,
  PointerLanes,
  laneFromX,
  laneFromXSticky,
} from './input';

export interface InputLayout {
  touch: boolean;
  width: number;
  highwayLeft: number;
  highwayWidth: number;
}

export interface InputOptions {
  canvas: HTMLElement;
  keys: KeyMap;
  layout: () => InputLayout;
  /** Called when a touch pointer is seen, so the layout can switch to the touch strip. */
  onTouchDetected?: () => void;
}

/**
 * Wires pointer and keyboard events to an InputSink (TIMING.md §3). Handlers do nothing heavy:
 * map the event to a lane and timestamp and hand it on. Returns a detach function.
 */
export function attachInput(opts: InputOptions, sink: InputSink): () => void {
  const { canvas, keys } = opts;
  const pointers = new PointerLanes();
  const now = (): number => performance.now();

  const onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') opts.onTouchDetected?.();
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* some browsers throw for synthetic pointers */
    }
    const lane = laneFromX(e.clientX, opts.layout());
    pointers.down(e.pointerId, lane);
    sink({ lane, down: true, perfMs: eventMs(e.timeStamp, now()), source: 'pointer' });
  };
  const onPointerUp = (e: PointerEvent): void => {
    const lane = pointers.up(e.pointerId);
    if (lane < 0) return;
    sink({ lane, down: false, perfMs: eventMs(e.timeStamp, now()), source: 'pointer' });
  };
  // Slides: a finger that moves into another lane without lifting releases the lane it was on
  // and presses the new one, with the same timestamp, so holds end and the next note is hit.
  const onPointerMove = (e: PointerEvent): void => {
    const current = pointers.laneOf(e.pointerId);
    if (current < 0) return;
    const lane = laneFromXSticky(e.clientX, opts.layout(), current);
    const left = pointers.move(e.pointerId, lane);
    if (left < 0) return;
    const perfMs = eventMs(e.timeStamp, now());
    sink({ lane: left, down: false, perfMs, source: 'pointer' });
    sink({ lane, down: true, perfMs, source: 'pointer' });
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    const lane = keys.laneFor(e.code);
    if (lane < 0) return;
    e.preventDefault();
    sink({ lane, down: true, perfMs: eventMs(e.timeStamp, now()), source: 'key' });
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    const lane = keys.laneFor(e.code);
    if (lane < 0) return;
    sink({ lane, down: false, perfMs: eventMs(e.timeStamp, now()), source: 'key' });
  };

  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  };
}

/** Poll connected gamepads once per frame. */
export function pollGamepads(lanes: GamepadLanes, nowMs: number, sink: InputSink): void {
  const pads = navigator.getGamepads?.() ?? [];
  const pressed: boolean[] = [];
  for (const pad of pads) {
    if (!pad) continue;
    pad.buttons.forEach((b, i) => {
      pressed[i] = pressed[i] || b.pressed;
    });
  }
  lanes.poll(pressed, nowMs, sink);
}
