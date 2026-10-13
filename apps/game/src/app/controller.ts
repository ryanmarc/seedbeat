/**
 * The game controller: owns the stage, transport, current run and frame loop, and drives the
 * screen state machine (ARCHITECTURE.md §4). Screens call its methods; it writes signals.
 */
import {
  APPROACH_BASE,
  ChartBuilder,
  CURRENT_GENERATOR_VERSION,
  appendNotes,
  approachAt,
  buildChart,
  createSession,
  levelAt,
  makeSong,
  songEndTime,
  summarize,
  type ChartNote,
  type Song,
} from '@seedbeat/core';
import { AutoplayBot } from '../engine/bot';
import { KeyMap } from '../engine/input';
import { attachInput, pollGamepads } from '../engine/input-dom';
import { GamepadLanes, type LaneEvent } from '../engine/input';
import { GameLoop, summarizeStats } from '../engine/loop';
import { PlayRun } from '../engine/play';
import { DiagnosticsOverlay } from '../render/diagnostics';
import { Stage } from '../render/stage';
import type { Scene } from '../render/scene';
import { TIERS } from '../render/quality';
import { SaveStore, MemoryKV } from '../save/store';
import { songKey, starsFor, type Settings } from '../save/schema';
import { sectionText } from './format';
import {
  audioReady,
  countdown,
  hudAcc,
  hudHealth,
  hudProgress,
  hudScore,
  hudSection,
  listening,
  results,
  returnTo,
  save as saveSignal,
  screen,
  selection,
  settings as settingsSignal,
  type Screen,
  type Selection,
} from './state';
import { SilentTransport, WorkletTransport, type Transport } from './transport';

/** Harness flags from the URL hash (perf, e2e). */
export interface Harness {
  bot: boolean;
  audio: boolean;
  auto: boolean;
  lock: boolean;
  noFail: boolean;
  touch: boolean;
  diag: boolean;
  /** End the run after this many song seconds (e2e). */
  endAfter: number | null;
  memorySave: boolean;
}

export function readHash(): { sel: Partial<Selection>; harness: Harness } {
  const p = new URLSearchParams(location.hash.slice(1));
  const moods = ['lofi', 'synthwave', 'chiptune', 'techno'];
  const m = p.get('m');
  const sel: Partial<Selection> = {};
  if (p.get('s')) sel.seed = p.get('s')!.slice(0, 32);
  if (m && moods.includes(m)) sel.mood = m as Selection['mood'];
  if (p.get('d') !== null)
    sel.difficulty = Math.min(3, Math.max(0, Number(p.get('d')))) as Selection['difficulty'];
  if (p.get('mode') === 'endless' || p.get('mode') === 'song')
    sel.mode = p.get('mode') as Selection['mode'];
  return {
    sel,
    harness: {
      bot: p.get('bot') === '1',
      audio: p.get('audio') !== '0',
      auto: p.get('auto') === '1',
      lock: p.get('lock') === '1',
      noFail: p.get('nofail') === '1',
      touch: p.get('touch') === '1',
      diag: p.get('diag') === '1',
      endAfter: p.get('end') !== null ? Number(p.get('end')) : null,
      memorySave: p.get('memsave') === '1',
    },
  };
}

interface Run {
  song: Song;
  run: PlayRun;
  scene: Scene;
  bot: AutoplayBot | null;
  builder: ChartBuilder | null;
  endTime: number | undefined;
  startedAt: number;
  /** Context time of bar 0 (shifts on resume). */
  songStart: number;
  pausedSongTime: number;
  resumeAt: number;
  beat: number;
  detach: () => void;
  approachBase: number;
  idleHandle: number;
  /** Song time of the last frame (for Endless lookahead and ending). */
  t: number;
}

const IDLE_SESSION = createSession([], { difficulty: 1 });

export class GameController {
  readonly store: SaveStore;
  harness: Harness;
  private canvas: HTMLCanvasElement | null = null;
  private stage: Stage | null = null;
  private transport: Transport | null = null;
  private loop: GameLoop | null = null;
  private diag: DiagnosticsOverlay | null = null;
  private current: Run | null = null;
  private idleScene: Scene | null = null;
  private idleSong: Song | null = null;
  private idleKey = '';
  private readonly keys = new KeyMap();
  private readonly gamepad = new GamepadLanes();
  private hudKey = '';
  private lastEnded = false;
  private unlisten: (() => void) | null = null;
  private idleT0 = 0;

  constructor() {
    const { sel, harness } = readHash();
    this.harness = harness;
    this.store = new SaveStore(harness.memorySave ? new MemoryKV() : undefined);
    selection.value = { ...selection.value, ...sel };
  }

  /* ----------------------------------------------------------- boot */
  async boot(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;
    const s = await this.store.load();
    saveSignal.value = s;
    settingsSignal.value = s.settings;
    this.keys.set(0, s.settings.keys[0]);
    this.keys.set(1, s.settings.keys[1]);
    this.keys.set(2, s.settings.keys[2]);
    this.keys.set(3, s.settings.keys[3]);
    this.store.subscribe((sv) => {
      saveSignal.value = { ...sv };
      settingsSignal.value = { ...sv.settings };
    });
    await document.fonts?.ready;
    this.diag = new DiagnosticsOverlay(document.body);
    this.diag.visible = s.settings.diagnostics || this.harness.diag;
    window.addEventListener('keydown', (e) => this.onGlobalKey(e));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && screen.value === 'playing') this.pause();
    });
    window.addEventListener('resize', () => this.onResize());
    const hasDeepLink = Object.keys(readHash().sel).length > 0;
    if (this.harness.auto && !this.harness.audio) {
      await this.startRun();
    } else {
      screen.value = hasDeepLink ? 'select' : 'title';
      await this.ensureIdle();
    }
  }

  private onGlobalKey(e: KeyboardEvent): void {
    if (e.code === 'F3') {
      this.setDiagnostics(!this.diag!.visible);
      return;
    }
    const sc = screen.value;
    if (
      sc === 'playing' &&
      (e.code === 'Escape' || e.code === 'KeyP' || (e.code === 'Space' && !countdown.value))
    ) {
      e.preventDefault();
      this.pause();
    } else if (sc === 'paused' && e.code === 'Escape') {
      e.preventDefault();
      this.resume();
    } else if (
      (sc === 'settings' || sc === 'profile' || sc === 'calibration') &&
      e.code === 'Escape'
    ) {
      this.closeOverlay();
    }
  }

  setDiagnostics(on: boolean): void {
    if (this.diag) this.diag.visible = on;
    this.store.setSettings({ diagnostics: on });
  }

  /* ----------------------------------------------------------- stage & idle scene */
  private async ensureStage(): Promise<Stage> {
    if (this.stage) return this.stage;
    const st = await Stage.create({ canvas: this.canvas!, resolution: this.startTier() });
    st.touch = this.harness.touch || matchMedia('(pointer: coarse)').matches;
    st.hitLineHigh = this.settings.hitLineHigh;
    this.stage = st;
    return st;
  }

  private startTier(): number {
    const q = this.settings.quality;
    if (q === 'battery') return 1;
    if (q === 'high') return 2;
    const saved = this.store.save.quality.tier;
    // Start one tier higher than last time so a device can recover (RENDERING.md §5).
    return TIERS[Math.max(0, saved - 1)]!;
  }

  get settings(): Settings {
    return this.store.save.settings;
  }

  private reducedMotion(): boolean {
    const r = this.settings.reducedMotion;
    return r === 'on' || (r === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  private sceneOptions(song: Song, mood: Selection['mood']) {
    const s = this.settings;
    return {
      mood,
      song,
      lanes: s.lanePalette,
      reducedMotion: this.reducedMotion(),
      judgementTextSize: s.judgementTextSize,
      showEarlyLate: s.showEarlyLate,
      lowFx: s.quality === 'battery',
    };
  }

  /** Menu background: the selected mood's world behind the panel, pulsing on wall time. */
  async ensureIdle(): Promise<void> {
    if (this.current) return;
    const stage = await this.ensureStage();
    const sel = selection.value;
    const key = `${sel.mood}|${sel.seed}|${sel.mode}`;
    if (this.idleKey !== key || !this.idleScene) {
      this.idleKey = key;
      this.idleSong = makeSong(sel.seed, sel.mood, sel.mode);
      this.idleScene = stage.setScene(this.sceneOptions(this.idleSong, sel.mood));
      this.idleT0 = performance.now() / 1000;
    }
    this.ensureLoop();
  }

  private ensureLoop(): void {
    if (this.loop) return;
    this.loop = new GameLoop({
      frame: (now) => this.frame(now),
      inGap: (gap) => this.inGap(gap),
      applyTier: () => this.applyTier(),
    });
    this.applyFrameCap();
    this.loop.start();
  }

  private applyFrameCap(): void {
    if (!this.loop) return;
    const s = this.settings;
    this.loop.frameCapHz = s.frameCap === 'auto' ? (s.quality === 'battery' ? 30 : 0) : s.frameCap;
    this.loop.quality.state.locked = this.harness.lock || s.quality !== 'auto';
  }

  private onResize(): void {
    if (!this.stage) return;
    const scene = this.stage.rebuild();
    if (this.current) this.current.scene = scene;
    else this.idleScene = scene;
  }

  private applyTier(): void {
    if (!this.stage || !this.loop) return;
    this.stage.applyResolution(this.loop.quality.resolutionScale);
    this.store.update((s) => {
      s.quality.tier = this.loop!.quality.state.tier;
      s.quality.lockedThisDevice = this.loop!.quality.state.locked;
    });
    const scene = this.stage.scene!;
    if (this.current) this.current.scene = scene;
    else this.idleScene = scene;
  }

  private inGap(gapSec: number): boolean {
    const c = this.current;
    if (!c) return true;
    const s = c.run.session;
    if (s.holds.some(Boolean)) return false;
    for (let i = s.cursor; i < s.notes.length && s.notes[i]!.t < s.time + gapSec; i++)
      if (!s.notes[i]!.judged) return false;
    return true;
  }

  /* ----------------------------------------------------------- transport */
  private async ensureTransport(): Promise<Transport> {
    if (this.transport) {
      if (this.transport instanceof WorkletTransport) await this.transport.resumeContext();
      return this.transport;
    }
    const t = this.harness.audio ? await WorkletTransport.create() : new SilentTransport();
    this.transport = t;
    const s = this.settings;
    t.setVolumes({
      master: s.masterVolume,
      music: s.musicVolume,
      hit: s.hitSounds ? s.hitVolume : 0,
    });
    t.clock.audioOffset = s.audioOffsetMs / 1000;
    audioReady.value = true;
    return t;
  }

  applyVolumes(): void {
    const s = this.settings;
    this.transport?.setVolumes({
      master: s.masterVolume,
      music: s.musicVolume,
      hit: s.hitSounds ? s.hitVolume : 0,
    });
    if (this.transport) this.transport.clock.audioOffset = s.audioOffsetMs / 1000;
  }

  /* ----------------------------------------------------------- listen preview */
  async listen(on: boolean): Promise<void> {
    if (!on) {
      this.transport?.stop();
      this.unlisten?.();
      this.unlisten = null;
      listening.value = false;
      return;
    }
    const t = await this.ensureTransport();
    const sel = selection.value;
    t.start({
      seed: sel.seed,
      mood: sel.mood,
      mode: sel.mode,
      startTime: t.now() + 0.1,
      countIn: false,
      fromBar: 4,
    });
    t.clock.startSong(t.now() + 0.1 - 4 * (this.idleSong?.barDur ?? 2));
    listening.value = true;
    this.unlisten = t.onEnded(() => void this.listen(false));
  }

  /* ----------------------------------------------------------- run lifecycle */
  async startRun(): Promise<void> {
    await this.listen(false);
    const stage = await this.ensureStage();
    const t = await this.ensureTransport();
    const sel = selection.value;
    const s = this.settings;
    const song = makeSong(sel.seed, sel.mood, sel.mode);
    const noFail = s.noFail || this.harness.noFail || this.harness.bot;
    let notes: ChartNote[];
    let builder: ChartBuilder | null = null;
    if (song.total !== null) {
      notes = buildChart(song, sel.difficulty).notes;
    } else {
      builder = new ChartBuilder(song, sel.difficulty);
      notes = [];
      for (let i = 0; i < 12; i++) notes.push(...builder.next());
    }
    const endTime =
      this.harness.endAfter !== null
        ? this.harness.endAfter
        : song.total !== null
          ? songEndTime(song.total, song.barDur)
          : undefined;
    const beat = song.sd * 4;
    const leadIn = 0.35 + 4 * beat;
    const songStart = t.now() + leadIn;
    t.start({
      seed: sel.seed,
      mood: sel.mood,
      mode: sel.mode,
      startTime: songStart,
      countIn: true,
    });
    t.clock.startSong(songStart);

    const scene = stage.setScene(this.sceneOptions(song, sel.mood));
    this.idleScene = null;
    this.idleKey = '';
    const run = new PlayRun(
      t.clock,
      {
        seed: sel.seed,
        mood: sel.mood,
        mode: sel.mode,
        difficulty: sel.difficulty,
        generatorVersion: CURRENT_GENERATOR_VERSION,
        speed: s.noteSpeed,
        noFail,
        ...(endTime !== undefined ? { endTime } : {}),
        bars: builder ? builder.nextBar : (song.total ?? 0),
      },
      notes,
    );
    const bot = this.harness.bot ? new AutoplayBot(notes) : null;
    const detach = attachInput(
      {
        canvas: this.canvas!,
        keys: this.keys,
        layout: () => ({
          touch: stage.touch,
          width: scene.layout.width,
          highwayLeft: scene.layout.cx - scene.layout.nearW / 2,
          highwayWidth: scene.layout.nearW,
        }),
        onTouchDetected: () => {
          if (!stage.touch) {
            stage.touch = true;
            this.onResize();
          }
        },
      },
      (e) => this.onInput(e),
    );
    this.current = {
      song,
      run,
      scene,
      bot,
      builder,
      endTime,
      startedAt: performance.now(),
      songStart,
      pausedSongTime: 0,
      resumeAt: 0,
      beat,
      detach,
      approachBase: APPROACH_BASE[sel.difficulty] / s.noteSpeed,
      idleHandle: 0,
      t: -leadIn,
    };
    this.hudKey = '';
    this.lastEnded = false;
    hudScore.value = 0;
    hudAcc.value = '100.0%';
    hudHealth.value = 1;
    hudProgress.value = 0;
    hudSection.value = 'Get ready';
    countdown.value = 0;
    screen.value = 'playing';
    this.store.addRecent(sel.seed);
    this.ensureLoop();
    this.applyFrameCap();
    if (builder) this.scheduleLookahead();
    this.exposePerfHooks();
  }

  private onInput(e: LaneEvent): void {
    const c = this.current;
    if (!c || screen.value !== 'playing' || countdown.value) return;
    c.run.input(e);
    if (e.down && this.settings.hitSounds && this.transport) {
      const ev = c.run.session.events.at(-1);
      if (ev && Math.abs(ev.t - c.run.session.time) < 0.2)
        this.transport.hitSound(
          ev.judgement === 'miss' || ev.judgement === 'drop'
            ? 'miss'
            : (ev.judgement.replace(/^r/, '') as 'perfect' | 'great' | 'good'),
        );
    }
  }

  private scheduleLookahead(): void {
    const c = this.current;
    if (!c || !c.builder) return;
    const cb = (): void => {
      const cur = this.current;
      if (!cur || cur !== c || !cur.builder) return;
      // Keep bars charted up to approach + 5 s ahead of the playhead (ARCHITECTURE.md §3).
      while (cur.builder.nextBar * cur.song.barDur < cur.t + cur.approachBase + 5) {
        const notes = cur.builder.next();
        appendNotes(cur.run.session, notes);
        cur.bot?.append(notes);
      }
      cur.idleHandle = idle(cb);
    };
    c.idleHandle = idle(cb);
  }

  private frame(now: number): void {
    const c = this.current;
    const sc = screen.value;
    if (!c) {
      const scene = this.idleScene;
      if (scene) {
        const t = performance.now() / 1000 - this.idleT0;
        const song = this.idleSong!;
        const lt = listening.value && this.transport ? this.transport.clock.songTime(now) : t;
        scene.update({
          t: lt,
          perf: now / 1000,
          approach: APPROACH_BASE[1],
          session: IDLE_SESSION,
          paused: false,
          idle: true,
        });
        void song;
        this.stage?.render();
      }
      return;
    }
    const paused = sc === 'paused';
    let t: number;
    if (paused) {
      t = c.pausedSongTime;
    } else if (countdown.value) {
      const left = c.resumeAt - this.transport!.now();
      const beats = Math.ceil(left / c.beat);
      if (left <= 0) {
        countdown.value = 0;
        t = c.run.frame(now);
      } else {
        if (beats !== countdown.value) countdown.value = Math.min(3, Math.max(1, beats));
        t = c.pausedSongTime;
        this.transport!.clock.sample();
      }
    } else {
      t = c.run.frame(now);
      if (c.bot)
        c.bot.drain(
          t,
          (songT) => this.songTimeToPerfMs(songT),
          (e) => c.run.input(e),
        );
      if (this.gamepadActive()) pollGamepads(this.gamepad, now, (e) => this.onInput(e));
    }
    c.t = t;
    const song = c.song;
    const bar = Math.max(0, Math.floor(t / song.barDur));
    const approach =
      song.total === null
        ? approachAt(song, selection.value.difficulty, bar) / this.settings.noteSpeed
        : c.approachBase;
    c.scene.update({
      t: t - this.settings.visualOffsetMs / 1000,
      perf: now / 1000,
      approach,
      session: c.run.session,
      paused,
      countdown: countdown.value,
    });
    this.stage!.render();
    this.updateHud(t, bar);
    if (this.diag?.visible && this.loop) this.updateDiag(now);
    if (c.run.session.ended && !this.lastEnded) {
      this.lastEnded = true;
      // Let the last judgement pop breathe, then show results.
      setTimeout(() => this.finish(), 700);
    }
  }

  private songTimeToPerfMs(songT: number): number {
    const c = this.current!;
    const clk = this.transport!.clock;
    return (songT + c.songStart + clk.audioOffset - (clk.offset ?? 0)) * 1000;
  }

  private gamepadActive(): boolean {
    return (
      typeof navigator.getGamepads === 'function' && navigator.getGamepads().some((g) => g !== null)
    );
  }

  private updateHud(t: number, bar: number): void {
    const c = this.current!;
    const s = c.run.session;
    const acc = s.accN ? (s.accSum / s.accN) * 100 : 100;
    const key = `${s.score}|${acc.toFixed(1)}|${t < 0 ? -1 : bar}`;
    if (key !== this.hudKey) {
      this.hudKey = key;
      hudScore.value = s.score;
      hudAcc.value = `${acc.toFixed(1)}%`;
      hudSection.value = sectionText(
        c.song,
        t,
        c.song.total === null ? levelAt(c.song, selection.value.difficulty, bar) : undefined,
      );
    }
    const hp = Math.round(s.health * 2) / 200;
    if (hp !== hudHealth.value) hudHealth.value = hp;
    const pv = c.song.total
      ? Math.round(Math.min(1, Math.max(0, t / (c.song.total * c.song.barDur))) * 400) / 400
      : 0;
    if (pv !== hudProgress.value) hudProgress.value = pv;
  }

  private updateDiag(now: number): void {
    const loop = this.loop!;
    this.diag!.update(now, {
      stats: loop.stats,
      pacingHalf: loop.pacing.half,
      tier: loop.quality.state.tier,
      tierScale: loop.quality.resolutionScale,
      tierLocked: loop.quality.state.locked,
      outputLatencyMs: (this.transport?.outputLatency ?? 0) * 1000,
      audioVoices: 0,
      audioSteals: 0,
      clockOffsetMs:
        this.transport?.clock.offset == null ? null : this.transport.clock.offset * 1000,
    });
  }

  pause(): void {
    const c = this.current;
    if (!c || screen.value !== 'playing') return;
    c.pausedSongTime = countdown.value ? c.pausedSongTime : c.t;
    countdown.value = 0;
    c.run.pause();
    this.transport!.pause();
    screen.value = 'paused';
  }

  /** Resume with a 3-beat countdown synced to the music (PRD §2). */
  resume(): void {
    const c = this.current;
    if (!c || screen.value !== 'paused') return;
    const t = this.transport!;
    const beatsAhead = 3;
    const resumeAt = t.now() + beatsAhead * c.beat + 0.05;
    c.resumeAt = resumeAt;
    c.songStart = resumeAt - c.pausedSongTime;
    t.resume(resumeAt);
    t.clock.startSong(c.songStart);
    countdown.value = beatsAhead;
    screen.value = 'playing';
  }

  restart(): void {
    const sel = selection.value;
    this.teardownRun();
    selection.value = { ...sel };
    void this.startRun();
  }

  quit(): void {
    this.teardownRun();
    screen.value = 'select';
    void this.ensureIdle();
  }

  private teardownRun(): void {
    const c = this.current;
    if (!c) return;
    cancelIdle(c.idleHandle);
    c.detach();
    this.transport?.stop();
    this.current = null;
    countdown.value = 0;
  }

  private finish(): void {
    const c = this.current;
    if (!c) return;
    const sel = selection.value;
    const summary = summarize(c.run.session);
    const gen = CURRENT_GENERATOR_VERSION;
    const key = songKey(gen, sel.mood, sel.mode, sel.difficulty, sel.seed);
    const endless = c.song.total === null;
    const bars = endless ? Math.max(0, Math.floor(c.t / c.song.barDur)) : undefined;
    const stars = starsFor(
      summary.grade,
      summary.fullCombo,
      summary.allPerfect,
      summary.failed && !endless,
    );
    const noFailUsed = this.settings.noFail || this.harness.noFail;
    // A failed Song run never records a best (prototype behaviour); Endless always can.
    const eligible = !noFailUsed && (endless || !summary.failed);
    const isBest =
      eligible &&
      this.store.recordBest(key, {
        score: summary.score,
        acc: summary.accuracy,
        grade: summary.grade,
        fc: summary.fullCombo,
        stars,
        at: Date.now(),
        ...(bars !== undefined ? { bars } : {}),
      });
    this.store.update((s) => {
      s.profile.plays++;
      s.profile.playSec += Math.round((performance.now() - c.startedAt) / 1000);
      s.profile.xp += Math.round(summary.score / 100);
      s.profile.level = 1 + Math.floor(Math.sqrt(s.profile.xp / 500));
    });
    results.value = {
      summary,
      selection: sel,
      songName: c.song.name,
      bpm: c.song.bpm,
      isBest,
      events: c.run.session.events,
      durationSec: endless ? c.t : c.song.total! * c.song.barDur,
      ...(bars !== undefined ? { bars, peakLevel: c.builder?.peakLevel ?? 0 } : {}),
      grade: endless ? summary.grade : summary.failed ? 'F' : summary.grade,
      stars,
    };
    this.teardownRun();
    screen.value = 'results';
  }

  /* ----------------------------------------------------------- overlays */
  openOverlay(which: 'settings' | 'calibration' | 'profile'): void {
    const sc = screen.value;
    if (sc === 'playing') this.pause();
    returnTo.value = screen.value === 'paused' ? 'paused' : sc === 'playing' ? 'paused' : sc;
    screen.value = which;
  }

  closeOverlay(): void {
    const back = returnTo.value;
    this.applyVolumes();
    this.applyFrameCap();
    if (this.stage) {
      this.stage.hitLineHigh = this.settings.hitLineHigh;
      this.onResize();
    }
    if (this.diag) this.diag.visible = this.settings.diagnostics;
    screen.value = back;
    if (back === 'select' || back === 'title') void this.ensureIdle();
  }

  /* ----------------------------------------------------------- calibration */
  /** Starts 24 clicks at 100 BPM; returns the context time of the first click, or null without audio. */
  async startClicks(): Promise<number | null> {
    const t = await this.ensureTransport();
    if (t.kind !== 'worklet') return null;
    await this.listen(false);
    t.clock.reset();
    const start = t.now() + 1;
    t.clicks(start, 24, 0.6);
    return start;
  }

  stopClicks(): void {
    this.transport?.stop();
  }

  /** Heard time (context seconds) of an input at performance ms. */
  heardAt(perfMs: number): number {
    return this.transport?.clock.heardAt(perfMs) ?? 0;
  }

  /* ----------------------------------------------------------- misc */
  setKey(lane: number, code: string): void {
    this.keys.set(lane, code);
    const keys = [...this.settings.keys] as Settings['keys'];
    keys[lane] = code;
    this.store.setSettings({ keys });
  }

  private exposePerfHooks(): void {
    const loop = this.loop!;
    window.__seedbeatPerf = {
      summary: () => summarizeStats(loop.stats),
      reset: () => loop.resetStats(),
      session: () => {
        const s = this.current?.run.session;
        return s
          ? { score: s.score, combo: s.combo, judged: s.accN, ended: s.ended }
          : { score: 0, combo: 0, judged: 0, ended: true };
      },
      ready: true,
    };
  }

  /** e2e hooks. */
  get currentScreen(): Screen {
    return screen.value;
  }
}

function idle(cb: () => void): number {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
  };
  return w.requestIdleCallback
    ? w.requestIdleCallback(cb, { timeout: 150 })
    : (setTimeout(cb, 40) as unknown as number);
}
function cancelIdle(h: number): void {
  const w = window as Window & { cancelIdleCallback?: (h: number) => void };
  if (w.cancelIdleCallback) w.cancelIdleCallback(h);
  else clearTimeout(h);
}

export const controller = new GameController();
