import { Application } from 'pixi.js';

/** Chrome background token from DESIGN.md §1. */
const BACKGROUND = 0x0b0912;

/**
 * Boots the PixiJS application on the given canvas. M4 builds the real scene on top of this.
 * Settings follow ARCHITECTURE.md §6: autoDensity, no antialias, high-performance GPU.
 */
export async function bootStage(canvas: HTMLCanvasElement): Promise<Application> {
  const app = new Application();
  await app.init({
    canvas,
    resizeTo: window,
    autoDensity: true,
    antialias: false,
    powerPreference: 'high-performance',
    background: BACKGROUND,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
  return app;
}
