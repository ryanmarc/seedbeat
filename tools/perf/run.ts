/**
 * `pnpm perf` (PERFORMANCE.md §5): Playwright + Chromium, Pixel-class viewport, CPU throttled 1×
 * and 4×, autoplay bot on Hard chiptune and techno golden seeds without audio. Records frame
 * intervals, late %, p50/p95, main-thread work, long tasks and sampled heap allocations, then
 * fails against the CI thresholds below (desktop-adjusted; the absolute budgets apply on devices).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { chromium, devices, type CDPSession, type Page } from '@playwright/test';

const PORT = Number(process.env['PERF_PORT'] ?? 4174);
/** PERF_HEADED=1 runs a visible Chromium so the real GPU renders (headless uses SwiftShader). */
const HEADED = process.env['PERF_HEADED'] === '1';
/** PERF_CHANNEL=chrome uses the installed Google Chrome (Playwright's Chromium has no GPU path on macOS). */
const CHANNEL = process.env['PERF_CHANNEL'];
const ALLOC_TOP = process.env['PERF_ALLOC_TOP'] === '1';
const BASE = `http://127.0.0.1:${PORT}`;
const RUN_SEC = Number(process.env['PERF_SECONDS'] ?? 30);
const SEEDS: { mood: string; seed: string }[] = [
  { mood: 'chiptune', seed: 'cobalt-42' },
  { mood: 'techno', seed: 'amber-11' },
];
const THROTTLES = [1, 4];
let gpuLogged = false;

/**
 * Thresholds. JavaScript time, allocations and bot progress are our code and are always
 * enforced. Late frames and long tasks are enforced only when a real GPU renders: under
 * SwiftShader (headless Chromium, CI runners) they measure the software rasteriser, so they are
 * reported but not failed. PERFORMANCE.md's absolute budgets apply on devices.
 */
const LIMITS = {
  workP95Ms: { 1: 4, 4: 12 } as Record<number, number>,
  appAllocPerSec: 8 * 1024,
  minJudged: 10,
  lateMax: { 1: 0.05, 4: 0.2 } as Record<number, number>,
  longTasks: 0,
};
let softwareRenderer = false;

interface Result {
  mood: string;
  seed: string;
  throttle: number;
  fps: number;
  late: number;
  p50: number;
  p95: number;
  work95: number;
  longTasks: number;
  appAllocPerSec: number;
  heapDeltaMB: number;
  judged: number;
  pass: boolean;
  why: string[];
}

function startPreview(): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'pnpm',
      ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
      {
        cwd: join(import.meta.dirname, '..', '..', 'apps', 'game'),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const onData = (d: Buffer): void => {
      if (d.toString().includes(String(PORT))) resolve(child);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', (code) => reject(new Error(`preview exited ${code}`)));
    setTimeout(() => resolve(child), 8000);
  });
}

interface HeapProfileNode {
  callFrame: { functionName: string; url: string };
  selfSize: number;
  children: HeapProfileNode[];
}

function sumAppAllocations(
  node: HeapProfileNode,
  isApp: (url: string) => boolean,
  top?: Map<string, number>,
): number {
  const mine = isApp(node.callFrame.url) ? node.selfSize : 0;
  if (mine && top) {
    const key = node.callFrame.functionName || '(anonymous)';
    top.set(key, (top.get(key) ?? 0) + mine);
  }
  let total = mine;
  for (const c of node.children) total += sumAppAllocations(c, isApp, top);
  return total;
}

async function gpuName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
}

async function measure(
  page: Page,
  cdp: CDPSession,
  mood: string,
  seed: string,
  throttle: number,
): Promise<Result> {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await page.goto(`${BASE}/#s=${seed}&m=${mood}&d=2&bot=1&audio=0&auto=1&touch=1&lock=1`);
  await page.waitForFunction(() => window.__seedbeatPerf?.ready === true, null, { timeout: 20000 });
  if (!gpuLogged) {
    gpuLogged = true;
    const name = await gpuName(page);
    softwareRenderer = /swiftshader|llvmpipe|software/i.test(name);
    console.log(
      `renderer: ${name} (${HEADED ? 'headed' : 'headless'}${softwareRenderer ? ', software: late frames and long tasks reported only' : ''})`,
    );
  }
  // Long tasks observer.
  await page.evaluate(() => {
    const w = window as unknown as { __longTasks: number };
    w.__longTasks = 0;
    new PerformanceObserver((list) => {
      w.__longTasks += list.getEntries().length;
    }).observe({ entryTypes: ['longtask'] });
  });
  // Let the count-in and first bars settle, then measure a steady window.
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__seedbeatPerf!.reset());
  await page.evaluate(() => ((window as unknown as { __longTasks: number }).__longTasks = 0));
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const heap0 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
  const sampling = process.env['PERF_SAMPLING'] !== '0';
  if (sampling) await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096 });
  await page.waitForTimeout(RUN_SEC * 1000);
  const profile = sampling
    ? (await cdp.send('HeapProfiler.stopSampling')).profile
    : { head: { callFrame: { functionName: '', url: '' }, selfSize: 0, children: [] } };
  await cdp.send('HeapProfiler.collectGarbage');
  const heap1 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
  const summary = await page.evaluate(() => window.__seedbeatPerf!.summary());
  const session = await page.evaluate(() => window.__seedbeatPerf!.session());
  const longTasks = await page.evaluate(
    () => (window as unknown as { __longTasks: number }).__longTasks,
  );
  const top = ALLOC_TOP ? new Map<string, number>() : undefined;
  const appAlloc = sumAppAllocations(
    profile.head as HeapProfileNode,
    (url) => url.includes('/assets/index-'),
    top,
  );
  if (top) {
    const rows = [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log(
      `  top app allocators (${mood} ${throttle}×): ` +
        rows.map(([k, v]) => `${k} ${(v / 1024).toFixed(0)} KB`).join(' · '),
    );
  }

  const why: string[] = [];
  if (summary.workP95Ms > LIMITS.workP95Ms[throttle]!)
    why.push(`js p95 ${summary.workP95Ms.toFixed(2)} ms > ${LIMITS.workP95Ms[throttle]} ms`);
  if (appAlloc / RUN_SEC > LIMITS.appAllocPerSec)
    why.push(`app allocations ${(appAlloc / RUN_SEC / 1024).toFixed(1)} KB/s > 8 KB/s`);
  if (session.judged < LIMITS.minJudged) why.push(`bot judged only ${session.judged} notes`);
  if (!softwareRenderer) {
    if (summary.late > LIMITS.lateMax[throttle]!)
      why.push(`late ${(summary.late * 100).toFixed(1)}% > ${LIMITS.lateMax[throttle]! * 100}%`);
    if (longTasks > LIMITS.longTasks) why.push(`${longTasks} long tasks`);
  }
  return {
    mood,
    seed,
    throttle,
    fps: summary.fps,
    late: summary.late,
    p50: summary.p50Ms,
    p95: summary.p95Ms,
    work95: summary.workP95Ms,
    longTasks,
    appAllocPerSec: appAlloc / RUN_SEC,
    heapDeltaMB: (heap1 - heap0) / 1048576,
    judged: session.judged,
    pass: why.length === 0,
    why,
  };
}

async function main(): Promise<void> {
  const preview = await startPreview();
  const browser = await chromium.launch({
    headless: !HEADED,
    ...(CHANNEL ? { channel: CHANNEL } : {}),
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--js-flags=--expose-gc',
      '--ignore-gpu-blocklist',
      ...(process.env['PERF_GPU_ARGS'] ? process.env['PERF_GPU_ARGS'].split(' ') : []),
    ],
  });
  const results: Result[] = [];
  try {
    for (const throttle of THROTTLES) {
      for (const { mood, seed } of SEEDS) {
        const context = await browser.newContext({ ...devices['Pixel 7'], hasTouch: true });
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        results.push(await measure(page, cdp, mood, seed, throttle));
        await context.close();
      }
    }
  } finally {
    await browser.close();
    preview.kill();
  }
  const rows = results.map(
    (r) =>
      `${r.mood.padEnd(9)} ${r.seed.padEnd(10)} cpu ${r.throttle}×  fps ${r.fps.toFixed(1).padStart(5)}  late ${(r.late * 100).toFixed(1).padStart(4)}%  p50 ${r.p50.toFixed(1)} ms  p95 ${r.p95.toFixed(1)} ms  js p95 ${r.work95.toFixed(2)} ms  long ${r.longTasks}  alloc ${(r.appAllocPerSec / 1024).toFixed(1)} KB/s  heap Δ ${r.heapDeltaMB.toFixed(2)} MB  judged ${r.judged}  ${r.pass ? 'PASS' : 'FAIL: ' + r.why.join(', ')}`,
  );
  console.log(rows.join('\n'));
  if (process.env['GITHUB_STEP_SUMMARY']) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(
      process.env['GITHUB_STEP_SUMMARY'],
      '### perf\n```\n' + rows.join('\n') + '\n```\n',
    );
  }
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
