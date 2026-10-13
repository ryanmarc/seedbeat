import { Application, type Renderer } from 'pixi.js';
import type { MoodId, Song } from '@seedbeat/core';
import { Scene } from './scene';
import { paletteFor, type LanePaletteId } from './palette';
import type { ViewportInfo } from './layout';

/** Chrome background token from DESIGN.md §1. */
const BACKGROUND = 0x0b0912;

export interface StageOptions {
  canvas: HTMLCanvasElement;
  /** Device pixel scale cap for the current quality tier. */
  resolution: number;
}

/**
 * Owns the PixiJS Application and the current Scene. Rendering is manual (`render()`), driven by
 * the game loop, so the ticker never competes with it. Rebuilds the scene on resize or tier change.
 */
export class Stage {
  readonly app: Application;
  scene: Scene | null = null;
  private resolution: number;
  private sceneOpts: {
    mood: MoodId;
    song: Song;
    lanes: LanePaletteId;
    reducedMotion: boolean;
  } | null = null;
  touch = false;

  private constructor(app: Application, resolution: number) {
    this.app = app;
    this.resolution = resolution;
  }

  static async create(o: StageOptions): Promise<Stage> {
    const app = new Application();
    await app.init({
      canvas: o.canvas,
      resizeTo: window,
      autoDensity: true,
      antialias: false,
      powerPreference: 'high-performance',
      background: BACKGROUND,
      resolution: Math.min(window.devicePixelRatio || 1, o.resolution),
      autoStart: false,
      sharedTicker: false,
    });
    app.ticker.stop();
    return new Stage(app, o.resolution);
  }

  get renderer(): Renderer {
    return this.app.renderer;
  }

  viewport(): ViewportInfo {
    const sab =
      Number(
        getComputedStyle(document.documentElement).getPropertyValue('--sab').replace('px', ''),
      ) || 0;
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      touch: this.touch,
      safeAreaBottom: sab,
    };
  }

  /** Build (or rebuild) the scene for a song. */
  setScene(mood: MoodId, song: Song, lanes: LanePaletteId, reducedMotion: boolean): Scene {
    this.sceneOpts = { mood, song, lanes, reducedMotion };
    return this.rebuild();
  }

  rebuild(): Scene {
    if (!this.sceneOpts) throw new Error('no scene configured');
    if (this.scene) {
      this.app.stage.removeChild(this.scene.root);
      this.scene.destroy();
    }
    const o = this.sceneOpts;
    const scene = new Scene(this.app.renderer, this.viewport(), {
      mood: o.mood,
      song: o.song,
      palette: paletteFor(o.mood, o.lanes),
      reducedMotion: o.reducedMotion,
      resolution: this.resolution,
    });
    this.app.stage.addChild(scene.root);
    this.scene = scene;
    return scene;
  }

  /** Apply a quality tier: change renderer resolution and rebake. Call only in a chart gap. */
  applyResolution(scale: number): void {
    this.resolution = scale;
    this.app.renderer.resolution = Math.min(window.devicePixelRatio || 1, scale);
    this.app.resize();
    if (this.sceneOpts) this.rebuild();
  }

  render(): void {
    this.app.render();
  }
}
