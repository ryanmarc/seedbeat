/**
 * The play-field scene (RENDERING.md §1, §4). Built once per layout/tier from baked textures;
 * `update` only moves pooled display objects and allocates nothing.
 */
import {
  BitmapFont,
  BitmapText,
  Container,
  Graphics,
  Mesh,
  MeshGeometry,
  Particle,
  ParticleContainer,
  Sprite,
  type Renderer,
} from 'pixi.js';
import {
  INTENSITY,
  RELEASE_WINDOWS,
  sectionFor,
  type Judgement,
  type MoodId,
  type SessionState,
  type Song,
} from '@seedbeat/core';
import { createBackground, type Background } from './backgrounds';
import {
  computeLayout,
  laneCenterX,
  laneEdgeX,
  project,
  type Layout,
  type Projected,
  type ViewportInfo,
} from './layout';
import { CHROME, type Palette } from './palette';
import { buildTextures, type TextureKit } from './textures';
import type { HighwayStyle, NoteSkin } from '../save/schema';

export const DISPLAY_FONT = 'seedbeat-display';
export const DATA_FONT = 'seedbeat-data';
const NOTE_POOL = 96;
const HOLD_POOL = 16;
const BEAT_LINES = 24;
const PARTICLES = 160;
const POP_SEC = 0.6;
const CHORUS_FLASH_SEC = 0.35;
/** Alpha of static highway lines at linear depth u (0 = far end, 1 = near): gone at the far end. */
const farFade = (u: number): number => (u < 0.3 ? u / 0.3 : 1);
const RING_SEC = 0.6;
/** Combo milestones that earn a ring burst (RENDERING.md §3). */
export const COMBO_MILESTONES = [50, 100, 200] as const;

let fontsInstalled = false;
/** Installs the dynamic bitmap fonts once. Bundled font faces arrive in M5; system faces until then. */
export function installFonts(): void {
  if (fontsInstalled) return;
  fontsInstalled = true;
  BitmapFont.install({
    name: DISPLAY_FONT,
    style: {
      fontFamily: '"Rubik Mono One", Impact, "Arial Black", sans-serif',
      fontSize: 72,
      fill: 0xffffff,
    },
    chars: [['0', '9'], ['A', 'Z'], ' ·'],
    resolution: 2,
    padding: 4,
  });
  BitmapFont.install({
    name: DATA_FONT,
    style: {
      fontFamily: '"JetBrains Mono", Menlo, Consolas, monospace',
      fontSize: 32,
      fill: 0xffffff,
      fontWeight: '700',
    },
    chars: [['0', '9'], ['A', 'Z'], ['a', 'z'], ' ·'],
    resolution: 2,
    padding: 2,
  });
}

export interface SceneOptions {
  mood: MoodId;
  song: Song;
  palette: Palette;
  reducedMotion: boolean;
  /** Draw at this resolution scale (quality tier). */
  resolution: number;
  judgementTextSize?: 'small' | 'normal' | 'large';
  showEarlyLate?: boolean;
  /** Battery saver: fewer particles. */
  lowFx?: boolean;
  noteSkin?: NoteSkin;
  highwayStyle?: HighwayStyle;
}

export interface SceneFrame {
  /** Draw time in song seconds (visual offset already applied). */
  t: number;
  /** Wall clock seconds, for feedback animations. */
  perf: number;
  approach: number;
  session: SessionState;
  /** Paused: effects freeze. */
  paused: boolean;
  /** Resume countdown beats to show instead of the count-in (0 = none). */
  countdown?: number;
  /** Menus: no notes, no end banner, dimmed highway. */
  idle?: boolean;
  /** Bar to use for section lookups when the draw clock does not map to song bars (Practice loops). */
  sectionBar?: number;
}

const POP_TEXT: Record<Judgement, string> = {
  perfect: 'PERFECT',
  great: 'GREAT',
  good: 'GOOD',
  rperfect: 'PERFECT',
  rgreat: 'GREAT',
  rgood: 'GOOD',
  miss: 'MISS',
  drop: 'LET GO EARLY',
};

interface HoldView {
  /** Two meshes share one geometry: plain body, and the chevron body shown while held. Swapping
   * a mesh's texture makes Pixi rebuild batch data (allocates), toggling visibility does not. */
  mesh: Mesh<MeshGeometry>;
  meshHeld: Mesh<MeshGeometry>;
  cap: Sprite;
  positions: Float32Array;
  uvs: Float32Array;
}

export class Scene {
  readonly root = new Container();
  readonly layout: Layout;
  private readonly kit: TextureKit;
  private readonly background: Background;
  private readonly pal: Palette;
  private readonly song: Song;
  private readonly reducedMotion: boolean;
  private readonly lowFx: boolean;
  private readonly showEarlyLate: boolean;
  private readonly beams: Graphics[] = [];
  private readonly beatLines: Sprite[] = [];
  private readonly notes: Sprite[] = [];
  private readonly holds: HoldView[] = [];
  private readonly labels: BitmapText[] = [];
  private readonly receptorFill: Sprite[] = [];
  private readonly receptorProgress: Sprite[] = [];
  private readonly keyCaps: BitmapText[] = [];
  private readonly padHi: Sprite[] = [];
  private readonly padHolding: BitmapText[] = [];
  private readonly particles: Particle[] = [];
  private readonly pLife = new Float32Array(PARTICLES);
  private readonly pVx = new Float32Array(PARTICLES);
  private readonly pVy = new Float32Array(PARTICLES);
  private pCount = 0;
  private readonly combo: BitmapText;
  private readonly comboLabel: BitmapText;
  private readonly pop: BitmapText;
  private readonly popSub: BitmapText;
  private readonly countdown: BitmapText;
  private readonly endBanner: BitmapText;
  private readonly ring: Sprite;
  private ringAt = -9;
  private milestone = 0;
  private chorusFlashAt = -9;
  private lastSectionStart = -1;
  private endShown = false;
  private readonly flashAt = [-9, -9, -9, -9];
  private readonly wasPressed = [false, false, false, false];
  private lastEvent = 0;
  private renderIndex = 0;
  private lastCombo = -1;
  private lastCountdown = -1;
  private popAt = -9;
  private lastPerf = 0;
  private rng = 1;
  private readonly proj: Projected = { y: 0, w: 0, s: 0 };
  private readonly proj2: Projected = { y: 0, w: 0, s: 0 };

  constructor(renderer: Renderer, viewport: ViewportInfo, o: SceneOptions) {
    installFonts();
    const l = (this.layout = computeLayout(viewport));
    this.pal = o.palette;
    this.song = o.song;
    this.reducedMotion = o.reducedMotion;
    this.lowFx = o.lowFx === true;
    this.showEarlyLate = o.showEarlyLate !== false;
    const kit = (this.kit = buildTextures(renderer, l, o.palette, o.resolution, o.noteSkin));
    const style: HighwayStyle = o.highwayStyle ?? 'default';
    this.background = createBackground(o.mood, renderer, l, kit, o.resolution, o.palette.lane);
    this.root.addChild(this.background.container);

    // ---- highway (static)
    const hw = new Graphics();
    const steps = 24;
    for (let i = 0; i < steps; i++) {
      const u0 = i / steps;
      const u1 = (i + 1) / steps;
      const y0 = l.topY + (l.bottom - l.topY) * u0;
      const y1 = l.topY + (l.bottom - l.topY) * u1;
      const w0 = l.topW + (l.bottomW - l.topW) * u0;
      const w1 = l.topW + (l.bottomW - l.topW) * u1;
      const a = u0 < 0.25 ? (u0 / 0.25) * 0.72 : 0.72 + ((u0 - 0.25) / 0.75) * 0.16;
      hw.poly([
        l.cx - w0 / 2,
        y0,
        l.cx + w0 / 2,
        y0,
        l.cx + w1 / 2,
        y1 + 0.5,
        l.cx - w1 / 2,
        y1 + 0.5,
      ]).fill({ color: 0x06040c, alpha: a });
    }
    // Lines along the highway dissolve over the far third, like the fill, so the track sinks
    // into the background instead of stopping on a hard edge at the spawn line.
    const strokeAlong = (e: number, color: number, alpha: number): void => {
      for (let i = 0; i < steps; i++) {
        const u0 = i / steps;
        const u1 = (i + 1) / steps;
        const a = alpha * farFade((u0 + u1) / 2);
        if (a < 0.004) continue;
        hw.moveTo(
          laneEdgeX(l, l.topW + (l.bottomW - l.topW) * u0, e),
          l.topY + (l.bottom - l.topY) * u0,
        )
          .lineTo(
            laneEdgeX(l, l.topW + (l.bottomW - l.topW) * u1, e),
            l.topY + (l.bottom - l.topY) * u1 + 0.5,
          )
          .stroke({ color, alpha: a, width: 1 });
      }
    };
    if (style !== 'minimal') for (let e = 1; e < 4; e++) strokeAlong(e, 0xffffff, 0.1);
    if (style === 'grid') {
      // Faint static cross lines, denser toward the horizon like the beat lines.
      for (let i = 1; i < 12; i++) {
        const q = project(l, i / 12, this.proj);
        hw.moveTo(l.cx - q.w / 2, q.y)
          .lineTo(l.cx + q.w / 2, q.y)
          .stroke({ color: o.palette.accent2, alpha: 0.08 * farFade(q.s), width: 1 });
      }
    }
    for (const e of [0, 4]) strokeAlong(e, o.palette.accent, 0.55);
    this.root.addChild(hw);

    // ---- lane beams (stacked so they dissolve at the far end too)
    for (let lane = 0; lane < 4; lane++) {
      const g = new Graphics();
      for (let i = 0; i < steps; i++) {
        const u0 = i / steps;
        const u1 = (i + 1) / steps;
        const w0 = l.topW + (l.bottomW - l.topW) * u0;
        const w1 = l.topW + (l.bottomW - l.topW) * u1;
        const y0 = l.topY + (l.bottom - l.topY) * u0;
        const y1 = l.topY + (l.bottom - l.topY) * u1 + 0.5;
        g.poly([
          laneEdgeX(l, w0, lane),
          y0,
          laneEdgeX(l, w0, lane + 1),
          y0,
          laneEdgeX(l, w1, lane + 1),
          y1,
          laneEdgeX(l, w1, lane),
          y1,
        ]).fill({ color: 0xffffff, alpha: farFade((u0 + u1) / 2) });
      }
      g.tint = o.palette.lane[lane]!;
      g.alpha = 0;
      g.visible = false;
      this.beams.push(g);
      this.root.addChild(g);
    }

    // ---- beat lines
    for (let i = 0; i < BEAT_LINES; i++) {
      const s = new Sprite(kit.white);
      s.anchor.set(0.5, 0.5);
      s.visible = false;
      this.beatLines.push(s);
      this.root.addChild(s);
    }

    // ---- notes layer: holds (meshes + caps) under gems
    const noteLayer = new Container();
    this.root.addChild(noteLayer);
    for (let i = 0; i < HOLD_POOL; i++) {
      const positions = new Float32Array(8);
      const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
      const geometry = new MeshGeometry({
        positions,
        uvs,
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      });
      const mesh = new Mesh({ geometry, texture: kit.holdBody });
      mesh.visible = false;
      const meshHeld = new Mesh({ geometry, texture: kit.holdBodyChevron });
      meshHeld.visible = false;
      const cap = new Sprite(kit.tailCap);
      cap.anchor.set(0.5);
      cap.visible = false;
      noteLayer.addChild(mesh, meshHeld);
      this.holds.push({ mesh, meshHeld, cap, positions: geometry.positions, uvs: geometry.uvs });
    }
    for (const h of this.holds) noteLayer.addChild(h.cap);
    for (let i = 0; i < NOTE_POOL; i++) {
      const s = new Sprite(kit.gem[0]);
      s.anchor.set(0.5);
      s.visible = false;
      this.notes.push(s);
      noteLayer.addChild(s);
    }
    for (let i = 0; i < 4; i++) {
      const t = new BitmapText({ text: 'RELEASE', style: { fontFamily: DATA_FONT, fontSize: 12 } });
      t.anchor.set(0.5, 1);
      t.visible = false;
      this.labels.push(t);
      noteLayer.addChild(t);
    }
    if (l.touch) {
      const mask = new Graphics().rect(0, 0, l.width, l.padTop - 6).fill(0xffffff);
      noteLayer.mask = mask;
      this.root.addChild(mask);
    }

    // ---- receptor strip
    const strip = new Sprite(kit.strip);
    strip.y = kit.stripY;
    this.root.addChild(strip);
    for (let lane = 0; lane < 4; lane++) {
      const cx = laneCenterX(l, l.nearW, lane);
      const fill = new Sprite(kit.receptorFill);
      fill.tint = o.palette.lane[lane]!;
      fill.position.set(cx - l.laneW * 0.42, l.hitY - 10);
      fill.alpha = 0;
      fill.visible = false;
      this.receptorFill.push(fill);
      this.root.addChild(fill);
      const prog = new Sprite(kit.receptorFill);
      prog.tint = o.palette.lane[lane]!;
      prog.position.set(cx - l.laneW * 0.42, l.hitY - 10);
      prog.visible = false;
      this.receptorProgress.push(prog);
      this.root.addChild(prog);
      if (!l.touch) {
        const cap = new BitmapText({
          text: 'DFJK'[lane]!,
          style: { fontFamily: DATA_FONT, fontSize: 13 },
        });
        cap.anchor.set(0.5, 0);
        cap.position.set(cx, l.hitY + 26);
        cap.alpha = 0.35;
        this.keyCaps.push(cap);
        this.root.addChild(cap);
      }
    }

    // ---- touch pads
    if (l.touch && kit.pads && kit.padHighlight) {
      const pads = new Sprite(kit.pads);
      pads.y = l.padTop - 14;
      this.root.addChild(pads);
      for (let lane = 0; lane < 4; lane++) {
        const p = l.pads[lane]!;
        const hi = new Sprite(kit.padHighlight);
        hi.tint = o.palette.lane[lane]!;
        hi.position.set(p.x, l.padTop);
        hi.alpha = 0;
        hi.visible = false;
        this.padHi.push(hi);
        this.root.addChild(hi);
        const txt = new BitmapText({
          text: 'HOLDING',
          style: { fontFamily: DATA_FONT, fontSize: 11 },
        });
        txt.anchor.set(0.5);
        txt.position.set(p.x + p.w / 2, (l.padTop + l.padBot) / 2);
        txt.visible = false;
        this.padHolding.push(txt);
        this.root.addChild(txt);
      }
    }

    // ---- particles
    const pc = new ParticleContainer({
      dynamicProperties: {
        position: true,
        color: true,
        scale: false,
        rotation: false,
        uvs: false,
        vertex: false,
      },
    });
    for (let i = 0; i < PARTICLES; i++) {
      const p = new Particle({
        texture: kit.particle,
        x: 0,
        y: 0,
        anchorX: 0.5,
        anchorY: 0.5,
        alpha: 0,
      });
      this.particles.push(p);
      pc.addParticle(p);
    }
    this.root.addChild(pc);

    // ---- text
    // Sized so three digits fit the gutter beside the highway (Rubik Mono One is ~0.8 em wide).
    const comboSize = Math.round(Math.max(22, Math.min(56, l.width * 0.12, l.comboMaxW / 2.4)));
    this.combo = new BitmapText({
      text: '',
      style: { fontFamily: DISPLAY_FONT, fontSize: comboSize },
    });
    this.combo.anchor.set(1, 1);
    this.combo.position.set(l.comboX, l.comboY);
    this.combo.alpha = 0.85;
    this.comboLabel = new BitmapText({
      text: 'C O M B O',
      style: { fontFamily: DATA_FONT, fontSize: 11 },
    });
    this.comboLabel.anchor.set(1, 0);
    this.comboLabel.position.set(l.comboX, l.comboY + 6);
    this.comboLabel.tint = o.palette.accent2;
    this.comboLabel.visible = false;
    const popSize =
      o.judgementTextSize === 'small' ? 16 : o.judgementTextSize === 'large' ? 30 : 22;
    this.pop = new BitmapText({ text: '', style: { fontFamily: DISPLAY_FONT, fontSize: popSize } });
    this.pop.anchor.set(0.5);
    this.pop.position.set(l.cx, l.popY);
    this.popSub = new BitmapText({ text: '', style: { fontFamily: DATA_FONT, fontSize: 12 } });
    this.popSub.anchor.set(0.5);
    this.popSub.position.set(l.cx, l.popY + 20);
    this.popSub.alpha = 0.7;
    this.countdown = new BitmapText({
      text: '',
      style: { fontFamily: DISPLAY_FONT, fontSize: Math.round(Math.min(90, l.width * 0.2)) },
    });
    this.countdown.anchor.set(0.5);
    this.countdown.position.set(l.cx, l.horizonY + (l.hitY - l.horizonY) * 0.45);
    this.countdown.alpha = 0.9;
    this.countdown.visible = false;
    this.endBanner = new BitmapText({
      text: '',
      style: { fontFamily: DISPLAY_FONT, fontSize: Math.round(Math.min(48, l.width * 0.11)) },
    });
    this.endBanner.anchor.set(0.5);
    this.endBanner.position.set(l.cx, l.horizonY + (l.hitY - l.horizonY) * 0.3);
    this.endBanner.visible = false;
    this.ring = new Sprite(kit.ring);
    this.ring.anchor.set(0.5);
    this.ring.position.set(l.comboX - comboSize * 1.1, l.comboY - comboSize * 0.4);
    this.ring.tint = o.palette.accent;
    this.ring.visible = false;
    this.root.addChild(this.ring);
    this.root.addChild(
      this.combo,
      this.comboLabel,
      this.pop,
      this.popSub,
      this.countdown,
      this.endBanner,
    );
  }

  destroy(): void {
    this.background.destroy();
    this.root.destroy({ children: true });
    this.kit.destroy();
  }

  private laneX(w: number, lane: number): number {
    return this.layout.cx + ((lane - 1.5) * w) / 4;
  }

  private nextRandom(): number {
    // Tiny LCG for particle spread; not gameplay, so determinism is a nicety, not a rule.
    this.rng = (this.rng * 1664525 + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }

  private burst(lane: number, colour: number): void {
    const l = this.layout;
    const x = laneCenterX(l, l.nearW, lane);
    const n = this.reducedMotion ? 4 : this.lowFx ? 6 : 12;
    for (let i = 0; i < n && this.pCount < PARTICLES; i++) {
      const k = this.pCount++;
      const p = this.particles[k]!;
      p.x = x;
      p.y = l.hitY;
      p.tint = i % 3 ? colour : 0xffffff;
      p.alpha = 1;
      this.pVx[k] = (this.nextRandom() - 0.5) * 320;
      this.pVy[k] = -120 - this.nextRandom() * 320;
      this.pLife[k] = 0.35 + this.nextRandom() * 0.3;
    }
  }

  update(f: SceneFrame): void {
    const l = this.layout;
    const s = f.session;
    const song = this.song;
    const pal = this.pal;
    const t = f.t;
    const dt = this.lastPerf ? Math.min(0.05, f.perf - this.lastPerf) : 0;
    this.lastPerf = f.perf;

    // ---- background
    const beat = song.sd * 4;
    const ph = (((t / beat) % 1) + 1) % 1;
    const pulse = (this.reducedMotion ? 0.4 : 1) * Math.exp(-ph * 5);
    const bar = f.sectionBar ?? Math.max(0, Math.floor(t / song.barDur));
    const sec = sectionFor(song, bar);
    // Chorus start: a short flash across all lanes (PRD §9; none in reduced motion).
    const secStart = bar - sec.barIn;
    if (secStart !== this.lastSectionStart) {
      const fresh = this.lastSectionStart >= 0 && t >= 0;
      this.lastSectionStart = secStart;
      if (fresh && sec.type === 'chorus' && !this.reducedMotion && !f.idle && !f.paused)
        this.chorusFlashAt = f.perf;
    }
    // No camera bob: the sky (sun, moon, stars) must hold still; the beat is shown by the
    // backgrounds' own pulses and the grid scroll.
    this.background.update({
      t,
      pulse,
      intensity: INTENSITY[sec.type],
      beatSec: beat,
      bpm: song.bpm,
      isChorus: sec.type === 'chorus',
      reducedMotion: this.reducedMotion,
    });

    // ---- feedback from new judgement events
    for (; this.lastEvent < s.events.length; this.lastEvent++) {
      const e = s.events[this.lastEvent]!;
      const j = e.judgement;
      const isBreak = j === 'miss' || j === 'drop';
      if (!isBreak) this.burst(e.lane, pal.lane[e.lane]!);
      this.pop.text = POP_TEXT[j];
      this.pop.tint =
        j === 'perfect' || j === 'rperfect'
          ? pal.accent2
          : j === 'great' || j === 'rgreat'
            ? pal.accent
            : isBreak
              ? CHROME.bad
              : 0xd7d0ee;
      const timing =
        j === 'great' || j === 'good' || j === 'rgreat' || j === 'rgood'
          ? e.dt > 0
            ? 'early'
            : 'late'
          : '';
      const rel = j === 'rperfect' || j === 'rgreat' || j === 'rgood';
      this.popSub.text = rel
        ? timing
          ? `release · ${timing}`
          : 'release'
        : j === 'drop'
          ? 'hold until the tail reaches the line'
          : timing;
      this.popAt = f.perf;
    }

    // ---- lane press state → beams, receptors, pads
    for (let lane = 0; lane < 4; lane++) {
      const on = s.pressed[lane]! > 0;
      if (on && !this.wasPressed[lane]) this.flashAt[lane] = f.perf;
      this.wasPressed[lane] = on;
      const age = f.perf - this.flashAt[lane]!;
      const beam = this.beams[lane]!;
      const flashAge = f.perf - this.chorusFlashAt;
      const flash = flashAge < CHORUS_FLASH_SEC ? 0.3 * (1 - flashAge / CHORUS_FLASH_SEC) : 0;
      const beamAlpha = Math.max(flash, on ? 0.22 : age < 0.25 ? 0.22 * (1 - age / 0.25) : 0);
      beam.alpha = beamAlpha;
      beam.visible = beamAlpha > 0;
      this.receptorFill[lane]!.alpha = on ? 0.45 : 0;
      this.receptorFill[lane]!.visible = on;
      if (this.keyCaps[lane]) this.keyCaps[lane]!.alpha = on ? 1 : 0.35;
      const h = s.holds[lane];
      const prog = this.receptorProgress[lane]!;
      if (h) {
        prog.visible = true;
        prog.scale.x = Math.min(1, Math.max(0, (t - h.t) / (h.end - h.t)));
      } else prog.visible = false;
      if (this.padHi.length) {
        const fl = on ? 1 : Math.max(0, 1 - age / 0.2);
        this.padHi[lane]!.alpha = 0.32 * fl;
        this.padHi[lane]!.visible = fl > 0;
        this.padHolding[lane]!.visible = !!h;
      }
    }

    // ---- beat lines
    let bl = 0;
    for (let k = Math.ceil(t / beat); bl < BEAT_LINES; k++) {
      const p = (k * beat - t) / f.approach;
      if (p > 1) break;
      if (p < 0) continue;
      const q = project(l, p, this.proj);
      const sp = this.beatLines[bl++]!;
      sp.visible = true;
      sp.position.set(l.cx, q.y);
      sp.width = q.w;
      sp.height = k % 4 === 0 ? 2 : 1;
      sp.tint = k % 4 === 0 ? pal.accent2 : 0xffffff;
      sp.alpha = (k % 4 === 0 ? 0.35 : 0.1) * (1 - p);
    }
    for (; bl < BEAT_LINES; bl++)
      if (this.beatLines[bl]!.visible) this.beatLines[bl]!.visible = false;

    // ---- notes
    const notes = s.notes;
    while (this.renderIndex < notes.length) {
      const n = notes[this.renderIndex]!;
      const endT = n.end || n.t;
      if (endT < t - 0.6 && (n.judged || t > n.t + 0.6)) this.renderIndex++;
      else break;
    }
    let hi = this.renderIndex;
    while (hi < notes.length && notes[hi]!.t < t + f.approach * 1.02) hi++;
    let ni = 0;
    let hiIdx = 0;
    let labelIdx = 0;
    for (let i = hi - 1; i >= this.renderIndex; i--) {
      const n = notes[i]!;
      const missed = n.judged === 'miss' || n.dropped;
      if (n.judged && !n.end && !missed) continue;
      if (n.end && n.judged && !n.holding && !missed) continue;
      let p = (n.t - t) / f.approach;
      if (n.holding) p = 0;
      if (p < -0.25 && !n.end) continue;
      const fade = p > 0.85 ? (1 - p) / 0.15 : 1;
      const colour = missed ? CHROME.missedGrey : pal.lane[n.lane]!;

      if (n.end) {
        const ptRaw = (n.end - t) / f.approach;
        const pt = Math.min(1, ptRaw);
        if (pt < -0.2) continue;
        if (hiIdx >= HOLD_POOL) continue;
        const a = project(l, Math.max(p, -0.2), this.proj);
        const b = project(l, pt, this.proj2);
        const xa = this.laneX(a.w, n.lane);
        const xb = this.laneX(b.w, n.lane);
        const wa = (a.w / 4) * 0.36;
        const wb = (b.w / 4) * 0.36;
        const hv = this.holds[hiIdx++]!;
        const pos = hv.positions;
        pos[0] = xa - wa;
        pos[1] = a.y;
        pos[2] = xa + wa;
        pos[3] = a.y;
        pos[4] = xb + wb;
        pos[5] = b.y;
        pos[6] = xb - wb;
        pos[7] = b.y;
        hv.mesh.geometry.getBuffer('aPosition').update();
        const len = Math.max(1, (a.y - b.y) / 64);
        const scroll = n.holding && !this.reducedMotion ? (t * 1.4) % 1 : 0;
        const uv = hv.uvs;
        uv[1] = uv[3] = len - scroll;
        uv[5] = uv[7] = -scroll;
        hv.mesh.geometry.getBuffer('aUV').update();
        hv.mesh.texture = n.holding ? this.kit.holdBodyChevron : this.kit.holdBody;
        hv.mesh.tint = colour;
        hv.mesh.alpha = missed
          ? 0.22
          : (n.holding ? 0.55 : 0.32) * Math.min(1, fade + 0.4) + (n.holding ? 0.25 : 0);
        hv.mesh.visible = true;
        const cap = hv.cap;
        if (ptRaw <= 1.02) {
          const near = Math.abs(n.end - t) <= RELEASE_WINDOWS.great;
          cap.texture = missed
            ? this.kit.tailCapMissed
            : near
              ? this.kit.tailCapNear
              : this.kit.tailCap;
          cap.tint = near && !missed ? colour : 0xffffff;
          cap.position.set(xb, b.y);
          cap.width = (b.w / 4) * 0.86;
          cap.height = Math.max(5, 14 * b.s + 3);
          cap.alpha = missed ? 0.3 : fade;
          cap.visible = true;
          if (n.holding && labelIdx < 4) {
            const lab = this.labels[labelIdx++]!;
            lab.text = near ? 'LET GO' : 'RELEASE';
            lab.tint = near ? 0xffffff : colour;
            lab.position.set(xb, b.y - cap.height / 2 - 4);
            lab.scale.set(Math.max(0.75, b.s + 0.25));
            lab.visible = true;
          }
        } else cap.visible = false;
        if (n.holding) continue; // the receptor shows progress instead of a gem
      }
      if (ni >= NOTE_POOL) continue;
      const q = project(l, p, this.proj);
      const sp = this.notes[ni++]!;
      sp.texture = missed ? this.kit.gemMissed : this.kit.gem[n.lane]!;
      sp.position.set(this.laneX(q.w, n.lane), q.y);
      sp.width = (q.w / 4) * 0.86;
      sp.height = Math.max(5, 18 * q.s + 3);
      sp.alpha = fade * (missed ? 0.3 : 1);
      sp.visible = true;
    }
    for (; ni < NOTE_POOL; ni++) if (this.notes[ni]!.visible) this.notes[ni]!.visible = false;
    for (; hiIdx < HOLD_POOL; hiIdx++) {
      const hv = this.holds[hiIdx]!;
      if (hv.mesh.visible) hv.mesh.visible = false;
      if (hv.meshHeld.visible) hv.meshHeld.visible = false;
      if (hv.cap.visible) hv.cap.visible = false;
    }
    for (; labelIdx < 4; labelIdx++)
      if (this.labels[labelIdx]!.visible) this.labels[labelIdx]!.visible = false;

    // ---- particles
    const step = f.paused ? 0 : dt;
    for (let i = 0; i < this.pCount; i++) {
      this.pLife[i]! -= step;
      if (this.pLife[i]! <= 0) {
        // swap-remove: move the last live particle into this slot
        const last = --this.pCount;
        const p = this.particles[i]!;
        const q = this.particles[last]!;
        p.x = q.x;
        p.y = q.y;
        p.tint = q.tint;
        p.alpha = q.alpha;
        this.pVx[i] = this.pVx[last]!;
        this.pVy[i] = this.pVy[last]!;
        this.pLife[i] = this.pLife[last]!;
        q.alpha = 0;
        i--;
        continue;
      }
      const p = this.particles[i]!;
      p.x += this.pVx[i]! * step;
      p.y += this.pVy[i]! * step;
      this.pVy[i]! += 500 * step;
      p.alpha = Math.min(1, this.pLife[i]! * 2.5);
    }

    // ---- combo and pop text
    const combo = s.combo >= 4 ? s.combo : 0;
    if (combo !== this.lastCombo) {
      this.lastCombo = combo;
      this.combo.text = combo ? String(combo) : '';
      this.comboLabel.visible = combo > 0;
    }
    // Combo milestones: ring burst at 50 / 100 / 200, once per climb.
    if (s.combo < this.milestone) this.milestone = 0;
    for (const m of COMBO_MILESTONES) {
      if (s.combo >= m && this.milestone < m) {
        this.milestone = m;
        if (!f.idle) {
          this.ringAt = f.perf;
          if (!this.reducedMotion)
            for (let lane = 0; lane < 4; lane++) this.burst(lane, pal.accent);
        }
      }
    }
    const ringAge = f.perf - this.ringAt;
    if (ringAge < RING_SEC) {
      const k = ringAge / RING_SEC;
      this.ring.scale.set(this.reducedMotion ? 1.6 : 0.6 + k * 2.4);
      this.ring.alpha = 1 - k;
      this.ring.visible = true;
    } else if (this.ring.visible) this.ring.visible = false;
    const popAge = f.perf - this.popAt;
    if (popAge < POP_SEC) {
      const sc = 1 + Math.max(0, 0.15 - popAge) * 2;
      this.pop.scale.set(sc);
      this.pop.alpha = 1 - popAge / POP_SEC;
      this.popSub.alpha = 0.7 * (1 - popAge / POP_SEC);
      this.pop.visible = this.popSub.visible = true;
    } else if (this.pop.visible) {
      this.pop.visible = this.popSub.visible = false;
    }

    // ---- end of run (until the results screen exists)
    if (s.ended && !this.endShown && !f.idle) {
      this.endShown = true;
      this.endBanner.text = s.failed ? 'FAILED' : 'COMPLETE';
      this.endBanner.tint = s.failed ? CHROME.bad : pal.accent2;
      this.endBanner.visible = true;
    }

    // ---- count-in
    const cd = f.countdown
      ? f.countdown
      : t < 0 && !f.paused && !s.ended && !f.idle
        ? Math.ceil(-t / beat)
        : 0;
    const show = cd > 0 && cd <= 4 ? cd : 0;
    if (show !== this.lastCountdown) {
      this.lastCountdown = show;
      this.countdown.visible = show > 0;
      if (show) this.countdown.text = String(show);
    }
  }
}
