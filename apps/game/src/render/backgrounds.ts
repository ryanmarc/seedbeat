/**
 * Per-mood backgrounds (RENDERING.md §3). Static parts are drawn once into a texture; moving
 * parts are small pools of sprites updated in place. Nothing allocates in `update`.
 */
import { Container, Graphics, Rectangle, Sprite, type Renderer, type Texture } from 'pixi.js';
import { mulberry, type MoodId } from '@seedbeat/core';
import type { Layout } from './layout';
import type { TextureKit } from './textures';

export interface BackgroundFrame {
  /** Song time, seconds. */
  t: number;
  /** exp(−5·beatPhase), already scaled by reduced motion. */
  pulse: number;
  /** Section intensity 0.45–1. */
  intensity: number;
  beatSec: number;
  bpm: number;
  isChorus: boolean;
  reducedMotion: boolean;
}

export interface Background {
  readonly container: Container;
  update(f: BackgroundFrame): void;
  destroy(): void;
}

/** Deterministic scenery so screenshots are stable across runs (prototype used mulberry(77)). */
function scenery(l: Layout) {
  const r = mulberry(77);
  const W = l.width;
  const buildings: { x: number; w: number; h: number; win: number[] }[] = [];
  for (let x = -10; x < W + 10;) {
    const w = 26 + r() * 54;
    const h = 0.12 + r() * 0.3;
    const win: number[] = [];
    for (let i = 0; i < 40; i++) win.push(r());
    buildings.push({ x, w, h, win });
    x += w + 2 + r() * 6;
  }
  const mount: number[] = [];
  for (let i = 0; i <= 24; i++) mount.push(0.25 + r() * 0.75 * (1 - Math.abs(i - 12) / 14));
  const rain = Array.from({ length: 70 }, () => ({
    x: r(),
    y: r(),
    v: 0.25 + r() * 0.4,
    l: 8 + r() * 14,
  }));
  const stars = Array.from({ length: 120 }, (_, i) => ({
    x: r(),
    y: r(),
    l: i % 3,
    c: Math.floor(r() * 6),
  }));
  const hills: number[] = [];
  for (let i = 0; i < Math.ceil(W / 16) + 1; i++) hills.push(Math.floor(r() * 4));
  return { buildings, mount, rain, stars, hills };
}

/**
 * Bakes a background's static layer into a texture the size of the screen. The frame matters:
 * without it, generateTexture sizes the texture to the drawing's bounds, and the synthwave floor
 * lines and techno fog circles reach well outside the viewport. The texture then started off-screen
 * (the sprite sits at 0,0), which shifted the whole picture sideways, and it cost several times the
 * screen's worth of GPU memory.
 */
function bakeStatic(
  renderer: Renderer,
  l: Layout,
  draw: (g: Graphics) => void,
  resolution: number,
): Texture {
  const g = new Graphics();
  draw(g);
  const tex = renderer.generateTexture({
    target: g,
    frame: new Rectangle(0, 0, l.width, l.height),
    resolution: Math.min(resolution, 1.5),
    antialias: true,
  });
  g.destroy();
  return tex;
}

function gradientRect(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  stops: [number, number][],
  steps = 48,
): void {
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    let a = stops[0]!;
    let b = stops[stops.length - 1]!;
    for (let k = 0; k < stops.length - 1; k++) {
      if (t >= stops[k]![0] && t <= stops[k + 1]![0]) {
        a = stops[k]!;
        b = stops[k + 1]!;
        break;
      }
    }
    const u = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
    g.rect(x, y + (h * i) / steps, w, h / steps + 1).fill(mixColor(a[1], b[1], u));
  }
}

function mixColor(a: number, b: number, t: number): number {
  const ch = (s: number): number =>
    Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/* ------------------------------------------------------------------ synthwave */
class SynthwaveBackground implements Background {
  readonly container = new Container();
  private readonly staticTex: Texture;
  private readonly lines: Sprite[] = [];
  private readonly glowLine: Sprite;
  private readonly hy: number;
  private readonly H: number;
  constructor(renderer: Renderer, l: Layout, kit: TextureKit, resolution: number) {
    const W = l.width;
    const H = (this.H = l.height);
    const hy = l.horizonY + 8;
    this.hy = hy;
    const sc = scenery(l);
    this.staticTex = bakeStatic(
      renderer,
      l,
      (g) => {
        gradientRect(g, 0, 0, W, hy, [
          [0, 0x0d0221],
          [0.65, 0x2b0b4a],
          [1, 0x7a1660],
        ]);
        const R = Math.min(W * 0.3, hy * 0.9);
        // Sun: stacked slices give the gradient and the stripes.
        for (let i = 0; i < 24; i++) {
          const y0 = hy - R + (R * i) / 24;
          const col = mixColor(0xffd36e, 0xff3fa4, i / 24);
          const half = Math.sqrt(Math.max(0, R * R - (hy - y0 - R / 24) * (hy - y0 - R / 24)));
          g.rect(l.cx - half, y0, half * 2, R / 24 + 1).fill(col);
        }
        // Cuts thicken toward the horizon but never fill their slot, so a band of sun always
        // sits directly on the horizon glow.
        const slot = (R * 0.55) / 7;
        for (let i = 0; i < 7; i++) {
          const yy = hy - R * 0.55 + i * slot;
          g.rect(l.cx - R, yy, R * 2, Math.min(1 + i * 1.4, slot - 4)).fill(0x4a0f62);
        }
        const n = sc.mount.length - 1;
        const pts: number[] = [0, hy];
        for (let i = 0; i <= n; i++)
          pts.push(
            (i / n) * W,
            hy - sc.mount[i]! * hy * 0.28 * (Math.abs(i - n / 2) > 3 ? 1 : 0.08),
          );
        pts.push(W, hy);
        g.poly(pts).fill(0x1a0633);
        g.rect(0, hy, W, H - hy).fill(0x0b0018);
        for (let k = -14; k <= 14; k++)
          g.moveTo(l.cx + k * 8, hy)
            .lineTo(l.cx + k * W * 0.12, H)
            .stroke({ color: 0xff3fa4, alpha: 0.3, width: 1.2 });
        g.rect(0, hy - 1, W, 2).fill({ color: 0xff3fa4, alpha: 0.35 });
      },
      resolution,
    );
    this.container.addChild(new Sprite(this.staticTex));
    for (let i = 0; i < 26; i++) {
      const s = new Sprite(kit.white);
      s.tint = 0xff3fa4;
      s.width = W;
      s.height = 1.2;
      this.lines.push(s);
      this.container.addChild(s);
    }
    this.glowLine = new Sprite(kit.white);
    this.glowLine.tint = 0xffd36e;
    this.glowLine.width = W;
    this.glowLine.height = 3;
    this.glowLine.y = hy - 2;
    this.container.addChild(this.glowLine);
  }
  update(f: BackgroundFrame): void {
    const H = this.H;
    const hy = this.hy;
    const scroll = ((f.t * f.bpm) / 60) * 0.5;
    const frac = scroll - Math.floor(scroll);
    const alpha = 0.25 + f.pulse * 0.45 * f.intensity;
    // Depth 1/z, rescaled so the farthest line (z = 27) sits on the horizon: the lines bunch into a
    // glow that starts at the foot of the sun instead of a little below it.
    const Z = 27;
    const far = 1 / Z;
    for (let i = 0; i < 26; i++) {
      const z = i + 1 - frac;
      const s = this.lines[i]!;
      const y = hy + ((H - hy) * 0.8 * (1 / z - far)) / (1 - far);
      s.y = y;
      const hidden = z <= 0 || y > H;
      s.visible = !hidden;
      if (!hidden) s.alpha = alpha;
    }
    this.glowLine.alpha = f.pulse * 0.3 * f.intensity;
  }
  destroy(): void {
    this.container.destroy({ children: true });
    this.staticTex.destroy(true);
  }
}

/* ------------------------------------------------------------------ lofi */
class LofiBackground implements Background {
  readonly container = new Container();
  private readonly staticTex: Texture;
  private readonly glow: Sprite;
  private readonly rain: Sprite[] = [];
  private readonly drops: { x: number; y: number; v: number; l: number }[];
  private readonly W: number;
  private readonly H: number;
  constructor(renderer: Renderer, l: Layout, kit: TextureKit, resolution: number) {
    const W = (this.W = l.width);
    const H = (this.H = l.height);
    const sc = scenery(l);
    this.drops = sc.rain;
    const mx = W * 0.8;
    const my = H * 0.16;
    this.staticTex = bakeStatic(
      renderer,
      l,
      (g) => {
        gradientRect(g, 0, 0, W, H, [
          [0, 0x16121f],
          [0.55, 0x3a2a45],
          [1, 0x7a4a55],
        ]);
        g.circle(mx, my, 30).fill(0xffe9c7);
        g.circle(mx + 12, my - 6, 26).fill(0x3a2a45);
        for (const b of sc.buildings) g.rect(b.x, H - b.h * H, b.w, b.h * H).fill(0x120e1a);
        for (const b of sc.buildings) {
          const y = H - b.h * H;
          let k = 0;
          for (let wy = y + 10; wy < H - 8 && k < 40; wy += 14) {
            for (let wx = b.x + 6; wx < b.x + b.w - 8 && k < 40; wx += 11, k++) {
              const v = b.win[k]!;
              if (v > 0.62)
                g.rect(wx, wy, 5, 7).fill({ color: 0xffcf8a, alpha: 0.35 + 0.4 * (v - 0.62) });
            }
          }
        }
      },
      resolution,
    );
    this.container.addChild(new Sprite(this.staticTex));
    this.glow = new Sprite(kit.glow);
    this.glow.anchor.set(0.5);
    this.glow.position.set(mx, my);
    this.glow.alpha = 0.3;
    this.container.addChildAt(this.glow, 1);
    for (let i = 0; i < 70; i++) {
      const s = new Sprite(kit.white);
      s.tint = 0xd9caff;
      s.alpha = 0.16;
      s.width = 1;
      s.height = this.drops[i]!.l;
      s.rotation = Math.atan2(this.drops[i]!.l * 0.18, this.drops[i]!.l);
      this.rain.push(s);
      this.container.addChild(s);
    }
  }
  update(f: BackgroundFrame): void {
    this.glow.alpha = 0.3 + f.pulse * 0.12 * f.intensity;
    const step = f.reducedMotion ? 2 : 1;
    const { W, H } = this;
    for (let i = 0; i < 70; i++) {
      const d = this.drops[i]!;
      const s = this.rain[i]!;
      if (i % step) {
        s.visible = false;
        continue;
      }
      s.visible = true;
      const y = (((d.y * H + f.t * d.v * H) % H) + H) % H;
      const x = (((d.x * W + f.t * d.v * H * 0.18) % W) + W) % W;
      s.x = x;
      s.y = y;
    }
  }
  destroy(): void {
    this.container.destroy({ children: true });
    this.staticTex.destroy(true);
  }
}

/* ------------------------------------------------------------------ chiptune */
class ChiptuneBackground implements Background {
  readonly container = new Container();
  private readonly staticTex: Texture;
  private readonly stars: Sprite[] = [];
  private readonly starData: { x: number; y: number; l: number; c: number }[];
  private readonly rims: Sprite[] = [];
  private readonly H: number;
  constructor(
    renderer: Renderer,
    l: Layout,
    kit: TextureKit,
    resolution: number,
    laneColours: readonly number[],
  ) {
    const W = l.width;
    const H = (this.H = l.height);
    const sc = scenery(l);
    this.starData = sc.stars;
    const base = l.horizonY + (l.hitY - l.horizonY) * 0.35;
    this.staticTex = bakeStatic(
      renderer,
      l,
      (g) => {
        gradientRect(g, 0, 0, W, H, [
          [0, 0x070b24],
          [1, 0x1d2a6b],
        ]);
      },
      resolution,
    );
    this.container.addChild(new Sprite(this.staticTex));
    const sz = [2, 3, 4];
    for (let i = 0; i < 120; i++) {
      const st = sc.stars[i]!;
      const s = new Sprite(kit.white);
      s.width = s.height = sz[st.l]!;
      s.tint = st.c < 4 ? 0xffffff : laneColours[st.c - 4]!;
      s.x = Math.floor(st.x * W);
      this.stars.push(s);
      this.container.addChild(s);
    }
    // Hills: static bodies baked, rims pulse.
    const hillsTex = bakeStatic(
      renderer,
      l,
      (g) => {
        for (let i = 0; i < sc.hills.length; i++) {
          const h = (sc.hills[i]! + 1) * 16;
          g.rect(i * 16, base - h, 16, H - base + h).fill(0x141f55);
        }
      },
      resolution,
    );
    this.container.addChild(new Sprite(hillsTex));
    for (let i = 0; i < sc.hills.length; i++) {
      const h = (sc.hills[i]! + 1) * 16;
      const s = new Sprite(kit.white);
      s.tint = 0x5eb8ff;
      s.x = i * 16;
      s.y = base - h;
      s.width = 16;
      s.height = 3;
      this.rims.push(s);
      this.container.addChild(s);
    }
  }
  update(f: BackgroundFrame): void {
    const sp = [12, 26, 48];
    const H = this.H;
    for (let i = 0; i < 120; i++) {
      const st = this.starData[i]!;
      const s = this.stars[i]!;
      s.y = Math.floor((((st.y * H + f.t * sp[st.l]!) % H) + H) % H);
      if (st.c < 4) s.alpha = st.l === 2 ? 0.45 + 0.55 * f.pulse * f.intensity : 0.55;
    }
    const rimAlpha = 0.12 + 0.15 * f.pulse * f.intensity;
    for (const r of this.rims) r.alpha = rimAlpha;
  }
  destroy(): void {
    this.container.destroy({ children: true });
    this.staticTex.destroy(true);
  }
}

/* ------------------------------------------------------------------ techno */
/** One expanding beat frame: four thin edge sprites, so fill cost is the perimeter, not the area. */
interface Frame {
  edges: [Sprite, Sprite, Sprite, Sprite];
}

class TechnoBackground implements Background {
  readonly container = new Container();
  private readonly staticTex: Texture;
  private readonly frames: Frame[] = [];
  private readonly strobe: Sprite;
  private readonly cx: number;
  private readonly cy: number;
  private readonly M: number;
  constructor(renderer: Renderer, l: Layout, kit: TextureKit, resolution: number) {
    const W = l.width;
    const H = l.height;
    this.cx = l.cx;
    this.cy = l.horizonY + (l.hitY - l.horizonY) * 0.25;
    this.M = Math.max(W, H);
    this.staticTex = bakeStatic(
      renderer,
      l,
      (g) => {
        g.rect(0, 0, W, H).fill(0x050507);
        for (let i = 10; i >= 1; i--)
          g.circle(l.cx, H, (this.M * 0.7 * i) / 10).fill({ color: 0xff2a3d, alpha: 0.018 });
        for (let y = 0; y < H; y += 4) g.rect(0, y, W, 1).fill({ color: 0xffffff, alpha: 0.025 });
      },
      resolution,
    );
    this.container.addChild(new Sprite(this.staticTex));
    for (let k = 0; k < 6; k++) {
      const edges = [0, 1, 2, 3].map(() => {
        const s = new Sprite(kit.white);
        s.tint = 0xff2a3d;
        s.visible = false;
        this.container.addChild(s);
        return s;
      }) as [Sprite, Sprite, Sprite, Sprite];
      this.frames.push({ edges });
    }
    this.strobe = new Sprite(kit.white);
    this.strobe.tint = 0xff2a3d;
    this.strobe.width = W;
    this.strobe.height = H;
    this.strobe.alpha = 0;
    this.strobe.visible = false;
    this.container.addChild(this.strobe);
  }
  update(f: BackgroundFrame): void {
    const b0 = Math.floor(f.t / f.beatSec);
    const T = 2;
    for (let k = 0; k < 6; k++) {
      const age = (f.t - (b0 - k) * f.beatSec) / f.beatSec;
      const a = Math.max(0, 1 - age / 6) * 0.4 * f.intensity;
      const w = age * this.M * 0.22 * 2;
      const h = age * this.M * 0.22 * 1.2;
      const x0 = this.cx - w / 2;
      const y0 = this.cy - h / 2;
      const [top, bottom, left, right] = this.frames[k]!.edges;
      const show = a > 0.002 && w > T;
      top.visible = bottom.visible = left.visible = right.visible = show;
      if (!show) continue;
      top.position.set(x0, y0);
      top.width = w;
      top.height = T;
      bottom.position.set(x0, y0 + h - T);
      bottom.width = w;
      bottom.height = T;
      left.position.set(x0, y0);
      left.width = T;
      left.height = h;
      right.position.set(x0 + w - T, y0);
      right.width = T;
      right.height = h;
      top.alpha = bottom.alpha = left.alpha = right.alpha = a;
    }
    const strobe = !f.reducedMotion && f.isChorus && b0 % 4 === 0 ? f.pulse * 0.09 : 0;
    this.strobe.alpha = strobe;
    this.strobe.visible = strobe > 0.002;
  }
  destroy(): void {
    this.container.destroy({ children: true });
    this.staticTex.destroy(true);
  }
}

export function createBackground(
  mood: MoodId,
  renderer: Renderer,
  l: Layout,
  kit: TextureKit,
  resolution: number,
  laneColours: readonly number[],
): Background {
  switch (mood) {
    case 'synthwave':
      return new SynthwaveBackground(renderer, l, kit, resolution);
    case 'lofi':
      return new LofiBackground(renderer, l, kit, resolution);
    case 'chiptune':
      return new ChiptuneBackground(renderer, l, kit, resolution, laneColours);
    case 'techno':
      return new TechnoBackground(renderer, l, kit, resolution);
  }
}
