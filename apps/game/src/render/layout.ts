/**
 * Play-field geometry (RENDERING.md §2), ported from the prototype's `geo()` and `proj()`.
 * Pure functions of the viewport so the renderer and input mapping agree and tests can run headless.
 */
export const PERSPECTIVE_K = 2.4;
export const FAR_WIDTH = 0.28;

export interface ViewportInfo {
  width: number;
  height: number;
  touch: boolean;
  /** CSS px of bottom safe area (notch phones). */
  safeAreaBottom: number;
  /** Touch: raise the hit line further above the pads (settings). */
  hitLineHigh?: boolean;
}

export interface Pad {
  x: number;
  w: number;
}

export interface Layout {
  width: number;
  height: number;
  touch: boolean;
  cx: number;
  horizonY: number;
  hitY: number;
  nearW: number;
  /** Lane width at the hit line. */
  laneW: number;
  /** Bottom of the highway (pad top on touch, screen bottom on desktop). */
  bottom: number;
  /** Highway width at `bottom`. */
  bottomW: number;
  /** Highway width and y at the far end (p = 1). */
  topY: number;
  topW: number;
  padTop: number;
  padBot: number;
  pads: Pad[];
  /**
   * Combo counter: baseline y and right edge x, in the gutter beside the highway so it never
   * covers the lanes (pinned to the screen edge on phones, beside the track on wide screens).
   */
  comboY: number;
  comboX: number;
  /** Horizontal room for the counter between the highway edge and `comboX`. */
  comboMaxW: number;
  /** Centre y of the judgement word (above the hit line, over the track). */
  popY: number;
}

export interface Projected {
  y: number;
  w: number;
  /** Depth scale 0 (horizon) … 1 (hit line). */
  s: number;
}

/** Depth scale for p = time-ahead / approach. p may exceed [0, 1] for notes past the line. */
export function depthScale(p: number): number {
  const K = PERSPECTIVE_K;
  return (1 / (1 + p * K) - 1 / (1 + K)) / (1 - 1 / (1 + K));
}

export function project(l: Layout, p: number, out: Projected): Projected {
  const s = depthScale(p);
  out.s = s;
  out.y = l.horizonY + s * (l.hitY - l.horizonY);
  out.w = l.nearW * (FAR_WIDTH + (1 - FAR_WIDTH) * s);
  return out;
}

/** X of the centre of `lane` at a highway width `w`. */
export function laneCenterX(l: Layout, w: number, lane: number): number {
  return l.cx + ((lane - 1.5) * w) / 4;
}

/** X of the divider at index `edge` (0..4) at highway width `w`. */
export function laneEdgeX(l: Layout, w: number, edge: number): number {
  return l.cx + ((edge - 2) * w) / 4;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function computeLayout(v: ViewportInfo): Layout {
  const { width: W, height: H, touch, safeAreaBottom } = v;
  const raise = touch && v.hitLineHigh ? 72 : 0;
  const horizonY = Math.max(84, H * 0.17);
  let hitY: number;
  let nearW: number;
  let padTop: number;
  let padBot: number;
  let bottom: number;
  if (touch) {
    const padH = clamp(H * 0.2, 104, 180);
    padBot = H - safeAreaBottom - 10;
    padTop = padBot - padH;
    hitY = padTop - 34 - raise;
    nearW = Math.min(W - 24, 540, (hitY - horizonY) * 1.1);
    bottom = padTop - 8;
  } else {
    hitY = H - Math.max(92, H * 0.16);
    nearW = Math.min(W - 24, 540, (hitY - horizonY) * 1.05);
    padTop = H;
    padBot = H;
    bottom = H;
  }
  const sB = (bottom - horizonY) / (hitY - horizonY);
  const bottomW = nearW * (FAR_WIDTH + (1 - FAR_WIDTH) * sB);
  const gap = 8;
  const m = 10;
  const pw = (W - 2 * m - 3 * gap) / 4;
  const pads = [0, 1, 2, 3].map((i) => ({ x: m + i * (pw + gap), w: pw }));
  const top = { y: 0, w: 0, s: 0 };
  const l: Layout = {
    width: W,
    height: H,
    touch,
    cx: W / 2,
    horizonY,
    hitY,
    nearW,
    laneW: nearW / 4,
    bottom,
    bottomW,
    topY: 0,
    topW: 0,
    padTop,
    padBot,
    pads,
    comboY: 0,
    comboX: 0,
    comboMaxW: 0,
    popY: horizonY + (hitY - horizonY) * 0.42 + 56,
  };
  project(l, 1, top);
  l.topY = top.y;
  l.topW = top.w;
  // Combo: a fifth of the way down the highway, where the gutter is still wide.
  const sC = 0.22;
  l.comboY = horizonY + (hitY - horizonY) * sC;
  const gutterX = l.cx + (nearW * (FAR_WIDTH + (1 - FAR_WIDTH) * sC)) / 2 + 14;
  l.comboX = Math.min(W - 12, gutterX + 150);
  l.comboMaxW = l.comboX - gutterX;
  return l;
}
