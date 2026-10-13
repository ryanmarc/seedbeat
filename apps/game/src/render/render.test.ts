import { describe, expect, it } from 'vitest';
import { computeLayout, depthScale, laneCenterX, project } from './layout';
import { paletteFor, mix } from './palette';
import { QualityController, TIERS } from './quality';

describe('layout', () => {
  it('projection matches the prototype formula at the ends', () => {
    expect(depthScale(0)).toBeCloseTo(1, 12);
    expect(depthScale(1)).toBeCloseTo(0, 12);
    expect(depthScale(0.5)).toBeCloseTo(0.2273, 3); // perspective: far half compresses
  });

  it('desktop layout: hit line above the bottom, lanes centred', () => {
    const l = computeLayout({ width: 1200, height: 800, touch: false, safeAreaBottom: 0 });
    expect(l.hitY).toBe(800 - 128);
    expect(l.horizonY).toBe(136);
    expect(l.nearW).toBe(540);
    expect(laneCenterX(l, l.nearW, 0)).toBe(600 - 1.5 * 135);
    expect(laneCenterX(l, l.nearW, 3)).toBe(600 + 1.5 * 135);
    const far = project(l, 1, { y: 0, w: 0, s: 0 });
    expect(far.y).toBe(l.horizonY);
    expect(far.w).toBeCloseTo(540 * 0.28, 9);
    expect(l.padTop).toBe(800);
  });

  it('touch layout: pads at the bottom, hit line 34 px above them, full-width pads', () => {
    const l = computeLayout({ width: 390, height: 844, touch: true, safeAreaBottom: 34 });
    const padH = Math.min(180, Math.max(104, 844 * 0.2));
    expect(l.padBot).toBe(844 - 34 - 10);
    expect(l.padTop).toBe(l.padBot - padH);
    expect(l.hitY).toBe(l.padTop - 34);
    expect(l.nearW).toBeLessThanOrEqual(390 - 24);
    expect(l.pads).toHaveLength(4);
    expect(l.pads[3]!.x + l.pads[3]!.w).toBeCloseTo(390 - 10, 9);
  });
});

describe('palette', () => {
  it('maps mood colours and colour-blind alternatives', () => {
    expect(paletteFor('synthwave').lane[0]).toBe(0xff3fa4);
    expect(paletteFor('synthwave', 'cb-a').lane).toEqual([0xe69f00, 0x56b4e9, 0x009e73, 0xcc79a7]);
    expect(paletteFor('techno').bg).toBe(0x050507);
    expect(mix(0x000000, 0xffffff, 0.5)).toBe(0x808080);
  });
});

describe('quality controller', () => {
  const run = (
    q: QualityController,
    seconds: number,
    interval: number,
    work: number,
    from = 0,
  ): number => {
    let t = from;
    for (let i = 0; i < seconds / interval; i++) {
      t += interval;
      q.record(t, interval, work);
    }
    return t;
  };

  it('drops a tier after two slow windows and keeps it when frames improve', () => {
    const q = new QualityController(0);
    const t = run(q, 2.5, 0.025, 0.004);
    expect(q.state.pending).toBe(1);
    expect(q.tierToApply(t, () => false)).toBeNull();
    expect(q.tierToApply(t, () => true)).toBe(1);
    expect(q.resolutionScale).toBe(TIERS[1]);
    run(q, 2.5, 0.016, 0.004, t); // 36 % faster → keep
    expect(q.state.pending).toBeNull();
    expect(q.state.locked).toBe(false);
  });

  it('restores and locks when lower tiers do not help (capped device)', () => {
    const q = new QualityController(0);
    let t = run(q, 2.5, 0.033, 0.002);
    expect(q.tierToApply(t, () => true)).toBe(1);
    t = run(q, 2.5, 0.033, 0.002, t); // no improvement → try one more
    expect(q.state.pending).toBe(2);
    expect(q.tierToApply(t, () => true)).toBe(2);
    t = run(q, 2.5, 0.033, 0.002, t); // still nothing → restore and lock
    expect(q.state.pending).toBe(0);
    expect(q.state.locked).toBe(true);
    expect(q.tierToApply(t, () => true)).toBe(0);
    run(q, 5, 0.033, 0.002, t);
    expect(q.state.pending).toBeNull();
  });

  it('settles for a short gap after waiting 5 s', () => {
    const q = new QualityController(0);
    const t = run(q, 2.5, 0.025, 0.004);
    expect(q.state.pending).toBe(1);
    const gaps: number[] = [];
    const check = (g: number): boolean => {
      gaps.push(g);
      return g < 0.5;
    };
    expect(q.tierToApply(t, check)).toBeNull();
    expect(q.tierToApply(t + 6, check)).toBe(1);
    expect(gaps).toEqual([0.8, 0.3]);
  });
});
