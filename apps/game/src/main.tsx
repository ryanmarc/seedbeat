/**
 * Bootstrap for the play field (M4). M5 replaces this with the real screens; until then the hash
 * configures a run: #s=seed&m=mood&d=0-3&mode=song|endless&bot=1&audio=0&auto=1&diag=1&touch=1
 * The perf harness and screenshot tests use the bot with audio=0 (performance-clock audio source).
 */
import { render } from 'preact';
import {
  APPROACH_BASE,
  CURRENT_GENERATOR_VERSION,
  buildChart,
  makeSong,
  songEndTime,
  type Difficulty,
  type MoodId,
  type Mode,
} from '@seedbeat/core';
import { GameClock, audioSourceFromContext } from './engine/clock';
import { AutoplayBot } from './engine/bot';
import { PerformanceAudioSource } from './engine/fake-audio';
import { KeyMap } from './engine/input';
import { attachInput } from './engine/input-dom';
import { GameLoop, summarizeStats } from './engine/loop';
import { PlayRun } from './engine/play';
import { AudioEngine } from './platform/audio';
import { DiagnosticsOverlay } from './render/diagnostics';
import { Stage } from './render/stage';
import { Title } from './ui/Title';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

interface HashConfig {
  seed: string;
  mood: MoodId;
  difficulty: Difficulty;
  mode: Mode;
  bot: boolean;
  audio: boolean;
  auto: boolean;
  diag: boolean;
  touch: boolean;
  reducedMotion: boolean;
  /** Diagnostics only: skip scene update and render (logic-only heap experiments). */
  noDraw: boolean;
  /** Perf harness: lock the quality tier so the measurement is steady state. */
  lockTier: boolean;
}

function readHash(): HashConfig {
  const p = new URLSearchParams(location.hash.slice(1));
  const moods: MoodId[] = ['lofi', 'synthwave', 'chiptune', 'techno'];
  const m = p.get('m') as MoodId | null;
  return {
    seed: p.get('s') || 'cobalt-42',
    mood: m && moods.includes(m) ? m : 'synthwave',
    difficulty: Math.min(3, Math.max(0, Number(p.get('d') ?? 2))) as Difficulty,
    mode: p.get('mode') === 'endless' ? 'endless' : 'song',
    bot: p.get('bot') === '1',
    audio: p.get('audio') !== '0',
    auto: p.get('auto') === '1',
    diag: p.get('diag') === '1',
    touch: p.get('touch') === '1' || matchMedia('(pointer: coarse)').matches,
    reducedMotion: p.get('rm') === '1' || matchMedia('(prefers-reduced-motion: reduce)').matches,
    noDraw: p.get('nodraw') === '1',
    lockTier: p.get('lock') === '1',
  };
}

declare global {
  interface Window {
    __seedbeatPerf?: {
      summary: () => ReturnType<typeof summarizeStats>;
      reset: () => void;
      session: () => { score: number; combo: number; judged: number; ended: boolean };
      ready: boolean;
    };
  }
}

async function startRun(cfg: HashConfig): Promise<void> {
  const song = makeSong(cfg.seed, cfg.mood, cfg.mode);
  const bars = song.total ?? 96;
  const chart = buildChart(song, cfg.difficulty, bars);
  const endTime = song.total !== null ? songEndTime(song.total, song.barDur) : undefined;

  const stage = await Stage.create({ canvas, resolution: 2 });
  stage.touch = cfg.touch;
  const scene = stage.setScene(cfg.mood, song, 'mood', cfg.reducedMotion);
  const diag = new DiagnosticsOverlay(document.body);
  diag.visible = cfg.diag;

  // Audio: real worklet, or a performance-clock source when running silent.
  let audio: AudioEngine | null = null;
  let songStartCtx: number;
  const leadIn = 0.3 + 4 * song.sd * 4; // count-in: four beats
  if (cfg.audio) {
    audio = await AudioEngine.create();
    songStartCtx = audio.ctx.currentTime + leadIn;
    audio.send({
      type: 'start',
      seed: cfg.seed,
      mood: cfg.mood,
      mode: cfg.mode,
      generatorVersion: CURRENT_GENERATOR_VERSION,
      startTime: songStartCtx,
      countIn: true,
    });
  } else {
    songStartCtx = performance.now() / 1000 + leadIn;
  }
  const source = audio ? audioSourceFromContext(audio.ctx) : new PerformanceAudioSource();
  const clock = new GameClock(source, () => performance.now());
  clock.startSong(songStartCtx);
  if (audio) audio.on('status', (s) => clock.sampleFromWorklet(s.ctxTime));

  const run = new PlayRun(
    clock,
    {
      seed: cfg.seed,
      mood: cfg.mood,
      mode: cfg.mode,
      difficulty: cfg.difficulty,
      generatorVersion: CURRENT_GENERATOR_VERSION,
      speed: 1,
      noFail: cfg.bot,
      ...(endTime !== undefined ? { endTime } : {}),
      bars,
    },
    chart.notes,
  );
  const approach = APPROACH_BASE[cfg.difficulty];
  const bot = cfg.bot ? new AutoplayBot(chart.notes) : null;
  const toPerfMs = (songT: number): number => (songT + songStartCtx - (clock.offset ?? 0)) * 1000;

  const keys = new KeyMap();
  const detach = attachInput(
    {
      canvas,
      keys,
      layout: () => ({
        touch: scene.layout.touch,
        width: scene.layout.width,
        highwayLeft: scene.layout.cx - scene.layout.nearW / 2,
        highwayWidth: scene.layout.nearW,
      }),
    },
    (e) => run.input(e),
  );
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') diag.visible = !diag.visible;
  });

  let sceneRef = scene;
  let lastDiag = 0;
  const loop = new GameLoop(
    {
      frame(now) {
        const t = run.frame(now);
        if (bot) bot.drain(t, toPerfMs, (e) => run.input(e));
        sceneRef.update({
          t,
          perf: now / 1000,
          approach,
          session: run.session,
          playing: !run.session.ended,
        });
        stage.render();
        if (diag.visible && now - lastDiag > 500) {
          lastDiag = now;
          diag.update(now, {
            stats: loop.stats,
            pacingHalf: loop.pacing.half,
            tier: loop.quality.state.tier,
            tierScale: loop.quality.resolutionScale,
            tierLocked: loop.quality.state.locked,
            outputLatencyMs: (audio?.outputLatency ?? 0) * 1000,
            audioVoices: 0,
            audioSteals: 0,
            clockOffsetMs: clock.offset === null ? null : clock.offset * 1000,
          });
        }
      },
      inGap(gapSec) {
        const s = run.session;
        if (s.holds.some(Boolean)) return false;
        const t = s.time;
        for (let i = s.cursor; i < s.notes.length && s.notes[i]!.t < t + gapSec; i++)
          if (!s.notes[i]!.judged) return false;
        return true;
      },
      applyTier(tier) {
        stage.applyResolution(loop.quality.resolutionScale);
        sceneRef = stage.scene!;
        void tier;
      },
    },
    0,
  );
  if (cfg.lockTier) loop.quality.state.locked = true;
  window.addEventListener('resize', () => {
    sceneRef = stage.rebuild();
  });

  window.__seedbeatPerf = {
    summary: () => summarizeStats(loop.stats),
    reset: () => loop.resetStats(),
    session: () => ({
      score: run.session.score,
      combo: run.session.combo,
      judged: run.session.accN,
      ended: run.session.ended,
    }),
    ready: true,
  };
  loop.start();
  void detach;
}

function PlayOverlay({ cfg, onPlay }: { cfg: HashConfig; onPlay: () => void }) {
  return (
    <main style={{ display: 'grid', placeItems: 'center', height: '100%', textAlign: 'center' }}>
      <div>
        <Title generatorVersion={CURRENT_GENERATOR_VERSION} />
        <p style={{ color: '#a39cbd' }}>
          {cfg.mood} · {cfg.seed} · difficulty {cfg.difficulty} · {cfg.mode}
        </p>
        <button
          id="play"
          onClick={onPlay}
          style={{
            font: '700 18px system-ui',
            padding: '12px 28px',
            borderRadius: 12,
            border: 0,
            background: '#ff3fa4',
            color: '#0b0912',
          }}
        >
          Play
        </button>
        <p style={{ color: '#a39cbd', fontSize: 12 }}>D F J K or arrows · F3 diagnostics</p>
      </div>
    </main>
  );
}

const cfg = readHash();
const begin = (): void => {
  render(null, ui);
  void startRun(cfg).catch((err) => {
    ui.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
  });
};
if (cfg.auto && !cfg.audio) begin();
else render(<PlayOverlay cfg={cfg} onPlay={begin} />, ui);
