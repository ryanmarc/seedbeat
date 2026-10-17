/**
 * Input mapping (TIMING.md §3), kept free of DOM so it can be tested headless. `attachInput` in
 * input-dom.ts wires real events to `InputSink`.
 */
import { eventMs } from './clock';

export interface LaneEvent {
  lane: number;
  down: boolean;
  /** Performance-clock milliseconds, already passed through the timestamp rule. */
  perfMs: number;
  source: 'pointer' | 'key' | 'gamepad' | 'guitar';
}

export type InputSink = (e: LaneEvent) => void;

export const DEFAULT_KEYS: readonly [string, string, string, string] = [
  'KeyD',
  'KeyF',
  'KeyJ',
  'KeyK',
];
const ARROWS: Record<string, number> = { ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 };

export class KeyMap {
  private keys: string[];
  constructor(keys: readonly string[] = DEFAULT_KEYS) {
    this.keys = [...keys];
  }
  set(lane: number, code: string): void {
    this.keys[lane] = code;
  }
  get codes(): readonly string[] {
    return this.keys;
  }
  /** Lane for a KeyboardEvent.code, or -1. Arrow keys always work. */
  laneFor(code: string): number {
    const i = this.keys.indexOf(code);
    return i >= 0 ? i : (ARROWS[code] ?? -1);
  }
}

/** Lane from an x coordinate: touch layouts use full-width quarters, desktop the highway's near width. */
export function laneFromX(
  x: number,
  layout: { touch: boolean; width: number; highwayLeft: number; highwayWidth: number },
): number {
  const { touch, width, highwayLeft, highwayWidth } = layout;
  const rel = touch ? x / width : (x - highwayLeft) / highwayWidth;
  const lane = Math.floor(rel * 4);
  return lane < 0 ? 0 : lane > 3 ? 3 : lane;
}

/** Fraction of a lane a sliding finger must cross into the next lane before it switches. */
export const SLIDE_HYSTERESIS = 0.12;

/**
 * Lane for a pointer that is already down on `current`: the same mapping as `laneFromX`, but the
 * finger has to travel SLIDE_HYSTERESIS of a lane past the boundary before the lane changes, so a
 * thumb resting near a divider does not flicker between lanes (and drop a hold).
 */
export function laneFromXSticky(
  x: number,
  layout: { touch: boolean; width: number; highwayLeft: number; highwayWidth: number },
  current: number,
): number {
  if (current < 0) return laneFromX(x, layout);
  const { touch, width, highwayLeft, highwayWidth } = layout;
  const f = (touch ? x / width : (x - highwayLeft) / highwayWidth) * 4;
  if (f >= current - SLIDE_HYSTERESIS && f < current + 1 + SLIDE_HYSTERESIS) return current;
  return laneFromX(x, layout);
}

/** Tracks pointerId → lane so multi-touch and holds release the lane they pressed. */
export class PointerLanes {
  private readonly map = new Map<number, number>();
  down(pointerId: number, lane: number): void {
    this.map.set(pointerId, lane);
  }
  /** Lane this pointer is on, or -1 if it is not down. */
  laneOf(pointerId: number): number {
    return this.map.get(pointerId) ?? -1;
  }
  /**
   * A down pointer slid to `lane`. Returns the lane it left, or -1 when nothing changed (not down,
   * or still on the same lane). The caller releases the old lane and presses the new one.
   */
  move(pointerId: number, lane: number): number {
    const prev = this.map.get(pointerId);
    if (prev === undefined || prev === lane) return -1;
    this.map.set(pointerId, lane);
    return prev;
  }
  /** Returns the lane this pointer pressed, or -1 if unknown. */
  up(pointerId: number): number {
    const lane = this.map.get(pointerId);
    this.map.delete(pointerId);
    return lane ?? -1;
  }
  get active(): number {
    return this.map.size;
  }
}

/** Gamepad buttons → lanes: face buttons and shoulders (PRD §7). Polled in rAF, judged at poll time. */
export const GAMEPAD_LANES: readonly (readonly number[])[] = [
  [14, 2, 4], // d-pad left, X/square, L1
  [13, 0], // d-pad down, A/cross
  [12, 3], // d-pad up, Y/triangle
  [15, 1, 5], // d-pad right, B/circle, R1
];

export class GamepadLanes {
  private readonly state = [false, false, false, false];
  /** Feed the pressed state of all buttons; emits lane transitions. */
  poll(pressed: readonly boolean[], nowMs: number, sink: InputSink): void {
    for (let lane = 0; lane < 4; lane++) {
      const on = GAMEPAD_LANES[lane]!.some((b) => pressed[b]);
      if (on !== this.state[lane]) {
        this.state[lane] = on;
        sink({ lane, down: on, perfMs: nowMs, source: 'gamepad' });
      }
    }
  }
}

export { eventMs };
