/**
 * Baked textures (RENDERING.md §1). Everything static is drawn once with Graphics and turned into
 * a texture; the frame loop only moves sprites. Rebuilt on resize or tier change, never per frame.
 */
import { Graphics, type Renderer, type Texture } from 'pixi.js';
import type { Layout } from './layout';
import type { Palette } from './palette';
import { CHROME } from './palette';
import type { NoteSkin } from '../save/schema';

export interface TextureKit {
  /** Per-lane note gem with its lane notch. */
  gem: Texture[];
  gemMissed: Texture;
  /** Tail caps: normal (dark), near (white), missed (grey). */
  tailCap: Texture;
  tailCapNear: Texture;
  tailCapMissed: Texture;
  /** Hold body strips (16×64, repeat-wrapped): plain edges, and with chevrons for an active hold. */
  holdBody: Texture;
  holdBodyChevron: Texture;
  /** 1×1 white, tinted for lines, beams and particles. */
  white: Texture;
  particle: Texture;
  /** Receptor outlines, hit line and key labels, from `stripY` to the bottom. */
  strip: Texture;
  stripY: number;
  /** Receptor pressed/filled overlay for one lane. */
  receptorFill: Texture;
  /** Touch pad backing (full width) and one pad highlight. */
  pads: Texture | null;
  padHighlight: Texture | null;
  glow: Texture;
  /** Ring outline for combo milestones (RENDERING.md §3). */
  ring: Texture;
  destroy(): void;
}

const NOTE_H = 21;
const CAP_H = 14;
/** Notch positions per lane as a fraction of the gem width (DESIGN.md §2). */
const NOTCH_X = [0.18, 0.4, 0.6, 0.82];

function bake(renderer: Renderer, draw: (g: Graphics) => void, resolution: number): Texture {
  const g = new Graphics();
  draw(g);
  const tex = renderer.generateTexture({ target: g, resolution, antialias: true });
  g.destroy();
  return tex;
}

/** Draws one lane's gem in a skin (PRD §8 cosmetics). Every skin keeps the lane notch. */
export function drawGem(g: Graphics, skin: NoteSkin, col: number, lane: number, w: number): void {
  const nx = NOTCH_X[lane]! * w;
  switch (skin) {
    case 'neon':
      g.roundRect(1.5, 1.5, w - 3, NOTE_H - 3, 6)
        .fill({ color: col, alpha: 0.28 })
        .stroke({ color: col, width: 2.5 });
      g.roundRect(4, 4, w - 8, NOTE_H - 8, 4).stroke({ color: 0xffffff, width: 1, alpha: 0.5 });
      g.rect(nx - 1.5, NOTE_H - 7, 3, 5).fill({ color: 0xffffff, alpha: 0.9 });
      break;
    case 'pixel':
      g.rect(3, 3, w - 3, NOTE_H - 3).fill({ color: 0x000000, alpha: 0.5 });
      g.rect(0, 0, w - 3, NOTE_H - 3).fill(col);
      g.rect(2, 2, w - 7, 4).fill({ color: 0xffffff, alpha: 0.5 });
      g.rect(nx - 2, NOTE_H - 9, 4, 4).fill({ color: 0x000000, alpha: 0.6 });
      break;
    case 'glass':
      g.roundRect(0, 0, w, NOTE_H, 9)
        .fill({ color: col, alpha: 0.55 })
        .stroke({ color: 0xffffff, width: 1.5, alpha: 0.85 });
      g.roundRect(3, 2, w - 6, NOTE_H * 0.45, 5).fill({ color: 0xffffff, alpha: 0.35 });
      g.rect(nx - 1.5, NOTE_H - 7, 3, 5).fill({ color: 0x000000, alpha: 0.5 });
      break;
    default:
      g.roundRect(0, 0, w, NOTE_H, 7).fill(col);
      g.roundRect(3, 2, w - 6, 5, 3).fill({ color: 0xffffff, alpha: 0.6 });
      g.rect(nx - 1.5, NOTE_H - 7, 3, 5).fill({ color: 0x000000, alpha: 0.45 });
  }
}

export function buildTextures(
  renderer: Renderer,
  l: Layout,
  pal: Palette,
  resolution: number,
  skin: NoteSkin = 'classic',
): TextureKit {
  const gemW = Math.max(8, Math.ceil(l.laneW * 0.86));
  const gem = pal.lane.map((col, lane) =>
    bake(renderer, (g) => drawGem(g, skin, col, lane, gemW), resolution),
  );
  const gemMissed = bake(
    renderer,
    (g) => g.roundRect(0, 0, gemW, NOTE_H, 7).fill(CHROME.missedGrey),
    resolution,
  );

  const capW = gemW;
  const cap = (fill: number, fillAlpha: number, stroke: number, tick: number | null): Texture =>
    bake(
      renderer,
      (g) => {
        g.roundRect(1.5, 1.5, capW - 3, CAP_H - 3, 3)
          .fill({ color: fill, alpha: fillAlpha })
          .stroke({ color: stroke, width: 2.5 });
        if (tick !== null) g.rect(capW * 0.25, CAP_H / 2 - 1, capW * 0.5, 2).fill(tick);
      },
      resolution,
    );
  const tailCap = cap(0x0a0812, 0.9, 0xffffff, 0xffffff);
  const tailCapNear = cap(0xffffff, 1, 0xffffff, null);
  const tailCapMissed = cap(0x0a0812, 0.9, 0x888888, null);

  // Hold body: a 16 × 64 strip (power of two so it can repeat), chevrons pointing down toward
  // the hit line; the mesh scrolls them by UV offset while the hold is active.
  const bodyRes = resolution >= 1.5 ? 2 : 1;
  const holdBody = bake(
    renderer,
    (g) => {
      g.rect(0, 0, 16, 64).fill({ color: 0xffffff, alpha: 0.45 });
      g.rect(0, 0, 1.5, 64).fill({ color: 0xffffff, alpha: 1 });
      g.rect(14.5, 0, 1.5, 64).fill({ color: 0xffffff, alpha: 1 });
    },
    bodyRes,
  );
  const holdBodyChevron = bake(
    renderer,
    (g) => {
      g.rect(0, 0, 16, 64).fill({ color: 0xffffff, alpha: 0.6 });
      g.rect(0, 0, 1.5, 64).fill({ color: 0xffffff, alpha: 1 });
      g.rect(14.5, 0, 1.5, 64).fill({ color: 0xffffff, alpha: 1 });
      g.moveTo(3, 20).lineTo(8, 28).lineTo(13, 20).stroke({ color: 0xffffff, width: 2, alpha: 1 });
      g.moveTo(3, 52).lineTo(8, 60).lineTo(13, 52).stroke({ color: 0xffffff, width: 2, alpha: 1 });
    },
    bodyRes,
  );
  for (const t of [holdBody, holdBodyChevron]) t.source.addressMode = 'repeat';

  const white = bake(renderer, (g) => g.rect(0, 0, 2, 2).fill(0xffffff), 1);
  const particle = bake(renderer, (g) => g.rect(0, 0, 4, 4).fill(0xffffff), resolution);
  const glow = bake(
    renderer,
    (g) => {
      for (let i = 12; i >= 1; i--)
        g.circle(120, 120, i * 9).fill({ color: 0xffe9c7, alpha: 0.08 });
    },
    1,
  );

  const ring = bake(
    renderer,
    (g) => g.circle(34, 34, 30).stroke({ color: 0xffffff, width: 4, alpha: 1 }),
    resolution,
  );

  // Receptor strip: hit line, receptor outlines, key caps (desktop).
  const stripY = Math.floor(l.hitY - 14);
  const strip = bake(
    renderer,
    (g) => {
      g.rect(0, 0, l.width, l.height - stripY).fill({ color: 0, alpha: 0.001 });
      g.moveTo(l.cx - l.nearW / 2, l.hitY - stripY)
        .lineTo(l.cx + l.nearW / 2, l.hitY - stripY)
        .stroke({ color: pal.accent2, width: 2, alpha: 0.4 });
      for (let lane = 0; lane < 4; lane++) {
        const cx = l.cx + (lane - 1.5) * l.laneW;
        g.roundRect(cx - l.laneW * 0.42, l.hitY - stripY - 10, l.laneW * 0.84, 20, 8).stroke({
          color: pal.lane[lane]!,
          width: 2,
          alpha: 0.6,
        });
      }
    },
    resolution,
  );
  const receptorFill = bake(
    renderer,
    (g) =>
      g
        .roundRect(0, 0, l.laneW * 0.84, 20, 8)
        .fill({ color: 0xffffff, alpha: 1 })
        .stroke({ color: 0xffffff, width: 2 }),
    resolution,
  );

  let pads: Texture | null = null;
  let padHighlight: Texture | null = null;
  if (l.touch) {
    const h = l.padBot - l.padTop;
    pads = bake(
      renderer,
      (g) => {
        g.rect(0, 14, l.width, l.height - l.padTop).fill({ color: 0x07050d, alpha: 0.96 });
        for (let i = 0; i < 14; i++)
          g.rect(0, i, l.width, 1).fill({ color: 0x07050d, alpha: (0.96 * i) / 14 });
        for (let lane = 0; lane < 4; lane++) {
          const p = l.pads[lane]!;
          g.roundRect(p.x, 14, p.w, h, 14)
            .fill({ color: pal.lane[lane]!, alpha: 0.1 })
            .stroke({ color: pal.lane[lane]!, width: 2, alpha: 0.45 });
          g.roundRect(p.x + p.w * 0.2, 14 + 10, p.w * 0.6, 4, 2).fill({
            color: pal.lane[lane]!,
            alpha: 0.7,
          });
        }
      },
      resolution,
    );
    padHighlight = bake(
      renderer,
      (g) => g.roundRect(0, 0, l.pads[0]!.w, h, 14).fill({ color: 0xffffff, alpha: 1 }),
      resolution,
    );
  }

  const all = [
    ...gem,
    gemMissed,
    tailCap,
    tailCapNear,
    tailCapMissed,
    holdBody,
    holdBodyChevron,
    white,
    particle,
    glow,
    strip,
    receptorFill,
    pads,
    padHighlight,
    ring,
  ];
  return {
    gem,
    gemMissed,
    tailCap,
    tailCapNear,
    tailCapMissed,
    holdBody,
    holdBodyChevron,
    white,
    particle,
    strip,
    stripY,
    receptorFill,
    pads,
    padHighlight,
    glow,
    ring,
    destroy() {
      for (const t of all) t?.destroy(true);
    },
  };
}
