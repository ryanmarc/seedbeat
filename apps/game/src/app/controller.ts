/**
 * The game controller: owns the stage, transport, current run and frame loop, and drives the
 * screen state machine (ARCHITECTURE.md §4). Screens call its methods; it writes signals.
 */
import {
  APPROACH_BASE,
  ChartBuilder,
  CURRENT_GENERATOR_VERSION,
  PracticeBuilder,
  TUTORIAL_MOOD,
  TUTORIAL_SEED,
  appendNotes,
  approachAt,
  buildChart,
  createSession,
  levelAt,
  makeSong,
  repStart,
  songEndTime,
  summarize,
  tutorialChart,
  type ChartNote,
  type Difficulty,
  type PracticeSection,
  type Song,
  type TutorialPrompt,
} from '@seedbeat/core';
import type { UiSound } from '@seedbeat/worklet/protocol';
import { seedFromInput } from './seed';
import { AutoplayBot } from '../engine/bot';
import { KeyMap } from '../engine/input';
import { attachInput, pollGamepads } from '../engine/input-dom';
import { GamepadLanes, type LaneEvent } from '../engine/input';
import { GameLoop, summarizeStats } from '../engine/loop';
import { PlayRun } from '../engine/play';
import { NO_HAPTICS, WebHaptics, hapticFor, type Haptics } from '../platform/haptics';
import { watchPage } from '../platform/lifecycle';
import { WakeLockKeeper } from '../platform/wake-lock';
import { DiagnosticsOverlay, NO_AUDIO_STATS, type AudioStats } from '../render/diagnostics';
import { Stage } from '../render/stage';
import type { Scene } from '../render/scene';
import { TIERS } from '../render/quality';
import { SaveStore, MemoryKV } from '../save/store';
import { songKey, starsFor, type AudioBuffer, type Settings } from '../save/schema';
import { achievementById, newAchievements, type FinishedRun } from './achievements';
import { dailySelection, isDaily, nextStreak, utcDay } from './daily';
import { practiceText, previewStartTime, sectionChoices, sectionText } from './format';
import { HIGHWAY_LIST, NOTE_SKIN_LIST, levelFor, unlocked, xpFromScore } from './progression';
import {
  audioReady,
  countdown,
  firstSongHint,
  hudAcc,
  hudHealth,
  hudProgress,
  hudPrompt,
  hudScore,
  hudSection,
  hudTutorial,
  listening,
  pauseReason,
  results,
  type PauseReason,
  returnStack,
  save as saveSignal,
  screen,
  selection,
  settings as settingsSignal,
  showToast,
  type RunKind,
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
  /** Any harness flag set: the first-run tutorial stays out of the way unless `tutorial=1`. */
  test: boolean;
  tutorial: boolean;
}

export function readHash(): { sel: Partial<Selection>; harness: Harness } {
  const p = new URLSearchParams(location.hash.slice(1));
  const moods = ['lofi', 'synthwave', 'chiptune', 'techno'];
  const m = p.get('m');
  const sel: Partial<Selection> = {};
  if (p.get('s')) sel.seed = seedFromInput(p.get('s')!);
  if (m && moods.includes(m)) sel.mood = m as Selection['mood'];
  if (p.get('d') !== null)
    sel.difficulty = Math.min(3, Math.max(0, Number(p.get('d')))) as Selection['difficulty'];
  if (p.get('mode') === 'endless' || p.get('mode') === 'song')
    sel.mode = p.get('mode') as Selection['mode'];
  const h: Harness = {
    bot: p.get('bot') === '1',
    audio: p.get('audio') !== '0',
    auto: p.get('auto') === '1',
    lock: p.get('lock') === '1',
    noFail: p.get('nofail') === '1',
    touch: p.get('touch') === '1',
    diag: p.get('diag') === '1',
    endAfter: p.get('end') !== null ? Number(p.get('end')) : null,
    memorySave: p.get('memsave') === '1',
    test: false,
    tutorial: p.get('tutorial') === '1',
  };
  h.test = h.bot || h.auto || h.memorySave || !h.audio || h.endAfter !== null;
  return { sel, harness: h };
}

interface Run {
  kind: RunKind;
  song: Song;
  /** Song the scene draws with (tempo-scaled for Practice). */
  sceneSong: Song;
  run: PlayRun;
  scene: Scene;
  bot: AutoplayBot | null;
  /** Endless and Practice: generate more notes ahead of the playhead. */
  lookahead: { needMore(t: number): boolean; next(): ChartNote[] } | null;
  peakLevel: () => number;
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
  /** Song time of the last frame (for lookahead and ending). */
  t: number;
  /** Practice: the looped section, its chip label and rate. */
  practice: (PracticeSection & { label: string; len: number }) | null;
  prompts: TutorialPrompt[];
  difficulty: Difficulty;
  noFail: boolean;
  /** Index into session.events of the first event not yet fed back (haptics). */
  fedBack: number;
}

const IDLE_SESSION = createSession([], { difficulty: 1 });

export class GameController {
  readonly store: SaveStore;
  harness: Harness;
  haptics: Haptics = NO_HAPTICS;
  /** Screen Wake Lock while playing (M7). */
  readonly wakeLock = new WakeLockKeeper();
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
  /** Latest worklet status (voices, steals, stalls); updated by message, read by the overlay. */
  private audioStats: AudioStats = { ...NO_AUDIO_STATS };
  /** Injectable clock for the daily seed (tests). */
  now: () => Date = () => new Date();

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
    const h = new WebHaptics();
    this.haptics = h;
    h.enabled = s.settings.haptics;
    await document.fonts?.ready;
    this.diag = new DiagnosticsOverlay(document.body);
    this.diag.visible = s.settings.diagnostics || this.harness.diag;
    window.addEventListener('keydown', (e) => this.onGlobalKey(e));
    // Backgrounding (app switch, lock screen, bfcache) pauses the run; the lock is re-taken on return.
    watchPage({
      hidden: () => {
        if (screen.value === 'playing') this.pause('background');
        this.wakeLock.onVisibility();
      },
      visible: () => this.wakeLock.onVisibility(),
    });
    window.addEventListener('resize', () => this.onResize());
    // Menu sounds and primary-button haptics (DESIGN.md §6), one delegated listener.
    document.getElementById('ui')?.addEventListener('click', (e) => {
      const b = (e.target as Element | null)?.closest?.('button');
      if (!b || screen.value === 'playing') return;
      const primary = b.classList.contains('primary');
      this.ui(primary ? 'confirm' : 'tap');
      if (primary) this.haptics.pulse('ui');
    });
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
      void this.resume();
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
    const level = this.store.save.profile.level;
    const skin = NOTE_SKIN_LIST.find((c) => c.id === s.noteSkin);
    const hw = HIGHWAY_LIST.find((c) => c.id === s.highwayStyle);
    return {
      mood,
      song,
      lanes: s.lanePalette,
      reducedMotion: this.reducedMotion(),
      judgementTextSize: s.judgementTextSize,
      showEarlyLate: s.showEarlyLate,
      lowFx: s.quality === 'battery',
      noteSkin: skin && unlocked(skin, level) ? skin.id : ('classic' as const),
      highwayStyle: hw && unlocked(hw, level) ? hw.id : ('default' as const),
    };
  }

  /** Menu background: the selected mood's world behind the panel, pulsing on wall time. */
  async ensureIdle(): Promise<void> {
    if (this.current) return;
    const stage = await this.ensureStage();
    const sel = selection.value;
    const s = this.settings;
    const key = `${sel.mood}|${sel.seed}|${sel.mode}|${s.noteSkin}|${s.highwayStyle}|${s.lanePalette}`;
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
    const t = this.harness.audio
      ? await WorkletTransport.create(latencyHintFor(this.settings.audioBuffer))
      : new SilentTransport();
    this.transport = t;
    t.onStatus((s) => {
      const a = this.audioStats;
      if (s.stalls > a.stalls) {
        a.lastStallAt = `@${s.bar}.${s.step}`;
        console.warn(
          `[audio] stall ${s.lastStallMs.toFixed(0)} ms (period ${s.periodMs.toFixed(0)} ms, voices ${s.voices}) at bar ${s.bar} step ${s.step}`,
        );
      }
      a.voices = s.voices;
      a.peakVoices = s.peakVoices;
      a.steals = s.steals;
      a.periodMs = s.periodMs;
      a.maxGapMs = s.maxGapMs;
      a.stalls = s.stalls;
      a.lastStallMs = s.lastStallMs;
      a.maxBusyMs = s.maxBusyMs;
    });
    t.watchState({
      interrupted: () => this.onAudioInterrupted(),
      running: () => {},
      closed: () => this.onAudioClosed(),
    });
    t.setVolumes(this.volumes());
    t.clock.audioOffset = this.settings.audioOffsetMs / 1000;
    audioReady.value = true;
    return t;
  }

  private volumes(): { master: number; music: number; hit: number; ui: number } {
    const s = this.settings;
    return {
      master: s.masterVolume,
      music: s.musicVolume,
      hit: s.hitSounds ? s.hitVolume : 0,
      ui: s.menuSounds ? 0.9 : 0,
    };
  }

  /** Create the transport, or explain why audio cannot start (insecure page, no worklet). */
  private async transportOrToast(): Promise<Transport | null> {
    try {
      return await this.ensureTransport();
    } catch (err) {
      const insecure = typeof window !== 'undefined' && !window.isSecureContext;
      showToast(
        insecure
          ? 'Sound needs a secure page: open the game over https or on localhost (pnpm dev:phone for phones).'
          : `Audio could not start: ${err instanceof Error ? err.message : String(err)}`,
        5000,
      );
      return null;
    }
  }

  /** The OS took the output (call, Siri, another app): pause and wait for a tap to resume. */
  private onAudioInterrupted(): void {
    if (screen.value === 'playing') {
      this.pause('audio');
    } else if (listening.value) {
      void this.listen(false);
    }
  }

  /** The context is gone for good (rare): drop the engine; the next Play rebuilds it. */
  private onAudioClosed(): void {
    this.transport = null;
    audioReady.value = false;
    if (this.current) {
      this.teardownRun();
      screen.value = 'select';
      void this.ensureIdle();
      showToast('Sound stopped. Press Play to start the song again.', 5000);
    }
  }

  /**
   * The buffer-size setting needs a new AudioContext. Between runs, drop the current one so the
   * next gesture (Play, Listen) creates it with the new hint.
   */
  private async syncAudioBuffer(): Promise<void> {
    const t = this.transport;
    if (!t || t.kind !== 'worklet' || this.current) return;
    if (t.latencyHint === latencyHintFor(this.settings.audioBuffer)) return;
    this.transport = null;
    audioReady.value = false;
    listening.value = false;
    await t.close();
  }

  /** Start the audio engine from a menu gesture so the first song starts faster and menus blip. */
  warmAudio(): void {
    if (this.transport) return;
    void this.ensureTransport().catch(() => {
      /* reported when Play is pressed */
    });
  }

  applyVolumes(): void {
    this.transport?.setVolumes(this.volumes());
    if (this.transport) this.transport.clock.audioOffset = this.settings.audioOffsetMs / 1000;
    if (this.haptics instanceof WebHaptics) this.haptics.enabled = this.settings.haptics;
  }

  /** Menu blip (DESIGN.md §6); silent until the audio engine exists. */
  ui(sound: UiSound): void {
    if (this.settings.menuSounds) this.transport?.ui(sound);
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
    const t = await this.transportOrToast();
    if (!t) return;
    const sel = selection.value;
    const song = this.idleSong ?? makeSong(sel.seed, sel.mood, sel.mode);
    const from = 4;
    const start = previewStartTime(t.now(), song.barDur, from);
    t.start({
      seed: sel.seed,
      mood: sel.mood,
      mode: sel.mode,
      startTime: start,
      countIn: false,
      fromBar: from,
    });
    t.clock.startSong(start);
    listening.value = true;
    this.unlisten = t.onEnded(() => void this.listen(false));
  }

  /* ----------------------------------------------------------- daily, practice, tutorial */
  /** Today's UTC day. */
  today(): string {
    return utcDay(this.now());
  }

  /** Select today's daily seed and go to song select. */
  goDaily(): void {
    selection.value = dailySelection(this.today(), selection.value);
    screen.value = 'select';
    void this.ensureIdle();
  }

  /** Switch song select into Practice (first chorus, 75%). */
  goPractice(): void {
    const sel = selection.value;
    const song = makeSong(sel.seed, sel.mood, 'song');
    const chorus = song.sections.findIndex((x) => x.type === 'chorus');
    selection.value = {
      ...sel,
      mode: 'song',
      practice: sel.practice ?? { section: Math.max(0, chorus), rate: 0.75 },
    };
    screen.value = 'select';
    void this.ensureIdle();
  }

  /** A fresh save is offered the lesson on the title screen (PRD §3); harness runs skip it. */
  needsTutorial(): boolean {
    return !this.store.save.profile.tutorialDone && (!this.harness.test || this.harness.tutorial);
  }

  startTutorial(): Promise<void> {
    return this.startRun(true);
  }

  /** "I know rhythm games": never offer the lesson again and go pick a song. */
  declineTutorial(): void {
    this.store.update((s) => {
      s.profile.tutorialDone = true;
    });
    this.toFirstSong();
  }

  /** Leave the lesson early (HUD or pause). */
  skipTutorial(): void {
    if (this.current?.kind !== 'tutorial') return;
    this.store.update((s) => {
      s.profile.tutorialDone = true;
    });
    this.teardownRun();
    this.toFirstSong();
  }

  /** Song select with the one-time seed hint. */
  toFirstSong(): void {
    firstSongHint.value = true;
    screen.value = 'select';
    void this.ensureIdle();
  }

  /** Practice: end the loop now and show the results. */
  stopRun(): void {
    if (!this.current) return;
    if (screen.value === 'paused') screen.value = 'playing';
    this.finish();
  }

  /* ----------------------------------------------------------- run lifecycle */
  async startRun(tutorial = false): Promise<void> {
    this.teardownRun();
    await this.listen(false);
    await this.syncAudioBuffer();
    const stage = await this.ensureStage();
    const t = await this.transportOrToast();
    if (!t) return;
    const s = this.settings;
    const sel: Selection = tutorial
      ? { mood: TUTORIAL_MOOD, mode: 'song', difficulty: 0, seed: TUTORIAL_SEED }
      : selection.value;
    const practice = !tutorial && sel.practice ? sel.practice : null;
    const kind: RunKind = tutorial
      ? 'tutorial'
      : practice
        ? 'practice'
        : sel.mode === 'endless'
          ? 'endless'
          : isDaily(sel, this.today())
            ? 'daily'
            : 'song';
    const song = makeSong(sel.seed, sel.mood, sel.mode);
    const noFail =
      s.noFail ||
      this.harness.noFail ||
      this.harness.bot ||
      kind === 'practice' ||
      kind === 'tutorial';
    let notes: ChartNote[];
    let lookahead: Run['lookahead'] = null;
    let peakLevel: () => number = () => 0;
    let endTime: number | undefined;
    let prompts: TutorialPrompt[] = [];
    let sceneSong = song;
    let practiceInfo: Run['practice'] = null;
    let toBar: number | undefined;
    let rate = 1;
    let fromBar = 0;
    const approachBase = APPROACH_BASE[sel.difficulty] / s.noteSpeed;
    if (kind === 'tutorial') {
      const tc = tutorialChart(song);
      notes = tc.notes;
      prompts = tc.prompts;
      toBar = tc.totalBars;
      endTime = songEndTime(tc.totalBars, song.barDur);
    } else if (practice) {
      const choices = sectionChoices(song);
      const choice = choices[Math.min(practice.section, choices.length - 1)]!;
      const sec = song.sections[choice.index]!;
      const p: PracticeSection = {
        fromBar: sec.start,
        toBar: sec.start + sec.len,
        rate: practice.rate,
      };
      const b = new PracticeBuilder(song, sel.difficulty, p);
      notes = [...b.next(), ...b.next()];
      lookahead = {
        needMore: (now) => repStart(song, p, b.nextRep) < now + approachBase + 5,
        next: () => b.next(),
      };
      rate = p.rate;
      fromBar = p.fromBar;
      toBar = p.toBar;
      practiceInfo = { ...p, label: choice.label, len: sec.len };
      sceneSong = { ...song, sd: song.sd / rate, barDur: song.barDur / rate, bpm: song.bpm * rate };
    } else if (song.total !== null) {
      const chart = buildChart(song, sel.difficulty);
      notes = chart.notes;
      peakLevel = () => chart.peakLevel;
      endTime = songEndTime(song.total, song.barDur);
    } else {
      const b = new ChartBuilder(song, sel.difficulty);
      notes = [];
      for (let i = 0; i < 12; i++) notes.push(...b.next());
      lookahead = {
        needMore: (now) => b.nextBar * song.barDur < now + approachBase + 5,
        next: () => b.next(),
      };
      peakLevel = () => b.peakLevel;
    }
    // Harness: end the run `end` seconds after the first bar played (Practice starts mid-song).
    if (this.harness.endAfter !== null)
      endTime = (fromBar * song.barDur) / rate + this.harness.endAfter;
    const beat = (song.sd * 4) / rate;
    // Count-in: four beats before the first bar played; bar 0 of the clock sits before that.
    const songStart = t.now() + 0.35 + 4 * beat - (fromBar * song.barDur) / rate;
    t.start({
      seed: sel.seed,
      mood: sel.mood,
      mode: sel.mode,
      startTime: songStart,
      countIn: true,
      ...(fromBar ? { fromBar } : {}),
      ...(toBar !== undefined ? { toBar } : {}),
      ...(rate !== 1 ? { rate } : {}),
      ...(practice ? { loop: true } : {}),
    });
    t.clock.startSong(songStart);

    const scene = stage.setScene(this.sceneOptions(sceneSong, sel.mood));
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
        bars: song.total ?? 0,
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
      kind,
      song,
      sceneSong,
      run,
      scene,
      bot,
      lookahead,
      peakLevel,
      endTime,
      startedAt: performance.now(),
      songStart,
      pausedSongTime: 0,
      resumeAt: 0,
      beat,
      detach,
      approachBase,
      idleHandle: 0,
      t: (fromBar * song.barDur) / rate - 4 * beat,
      practice: practiceInfo,
      prompts,
      difficulty: sel.difficulty,
      noFail,
      fedBack: 0,
    };
    this.hudKey = '';
    this.lastEnded = false;
    hudScore.value = 0;
    hudAcc.value = '100.0%';
    hudHealth.value = 1;
    hudProgress.value = 0;
    hudSection.value = 'Get ready';
    hudPrompt.value = prompts[0]?.text ?? '';
    hudTutorial.value = kind === 'tutorial';
    countdown.value = 0;
    pauseReason.value = 'user';
    firstSongHint.value = false;
    screen.value = 'playing';
    void this.wakeLock.hold();
    if (kind !== 'tutorial') this.store.addRecent(sel.seed);
    this.ensureLoop();
    this.applyFrameCap();
    if (lookahead) this.scheduleLookahead();
    this.exposePerfHooks();
  }

  private onInput(e: LaneEvent): void {
    const c = this.current;
    if (!c || screen.value !== 'playing' || countdown.value) return;
    c.run.input(e);
    this.feedback(c, true);
  }

  /**
   * Feedback for judgements not yet fed back: hit sound (only straight from an input, so it keeps
   * the one-block latency budget) and haptics. Misses declared by the frame loop get haptics only.
   */
  private feedback(c: Run, fromInput: boolean): void {
    const ev = c.run.session.events;
    for (; c.fedBack < ev.length; c.fedBack++) {
      const j = ev[c.fedBack]!.judgement;
      if (fromInput && this.settings.hitSounds && this.transport)
        this.transport.hitSound(
          j === 'miss' || j === 'drop'
            ? 'miss'
            : (j.replace(/^r/, '') as 'perfect' | 'great' | 'good'),
        );
      if (this.settings.haptics) this.haptics.pulse(hapticFor(j));
    }
  }

  private scheduleLookahead(): void {
    const c = this.current;
    if (!c || !c.lookahead) return;
    const cb = (): void => {
      const cur = this.current;
      if (!cur || cur !== c || !cur.lookahead) return;
      // Keep notes charted up to approach + 5 s ahead of the playhead (ARCHITECTURE.md §3).
      while (cur.lookahead.needMore(cur.t)) {
        const notes = cur.lookahead.next();
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
        const lt = listening.value && this.transport ? this.transport.clock.songTime(now) : t;
        scene.update({
          t: lt,
          perf: now / 1000,
          approach: APPROACH_BASE[1],
          session: IDLE_SESSION,
          paused: false,
          idle: true,
        });
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
      this.feedback(c, false);
    }
    c.t = t;
    const song = c.song;
    // Song bar at the draw clock; Practice wraps it into the looped section.
    const rawBar = Math.max(0, Math.floor(t / c.sceneSong.barDur));
    const p = c.practice;
    const loop = p ? Math.max(0, Math.floor((rawBar - p.fromBar) / p.len)) : 0;
    const bar = p && rawBar >= p.fromBar ? p.fromBar + ((rawBar - p.fromBar) % p.len) : rawBar;
    const approach =
      song.total === null
        ? approachAt(song, c.difficulty, bar) / this.settings.noteSpeed
        : c.approachBase;
    // Practice starts mid-song, so the scene cannot infer the count-in from t < 0: pass it.
    const sectionStart = p ? (p.fromBar * song.barDur) / p.rate : 0;
    const preCount =
      p && t < sectionStart && !paused ? Math.min(4, Math.ceil((sectionStart - t) / c.beat)) : 0;
    c.scene.update({
      t: t - this.settings.visualOffsetMs / 1000,
      perf: now / 1000,
      approach,
      session: c.run.session,
      paused,
      countdown: countdown.value || preCount,
      ...(p ? { sectionBar: bar } : {}),
    });
    this.stage!.render();
    this.updateHud(t, bar, loop);
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

  private updateHud(t: number, bar: number, loop: number): void {
    const c = this.current!;
    const s = c.run.session;
    const acc = s.accN ? (s.accSum / s.accN) * 100 : 100;
    const key = `${s.score}|${acc.toFixed(1)}|${t < 0 ? -1 : bar}|${loop}`;
    if (key !== this.hudKey) {
      this.hudKey = key;
      hudScore.value = s.score;
      hudAcc.value = `${acc.toFixed(1)}%`;
      const p = c.practice;
      const started = p ? t >= (p.fromBar * c.song.barDur) / p.rate : t >= 0;
      hudSection.value = !started
        ? 'Get ready'
        : p
          ? practiceText(p.label, loop, p.rate)
          : sectionText(
              c.song,
              t,
              c.song.total === null ? levelAt(c.song, c.difficulty, bar) : undefined,
            );
      if (c.prompts.length) {
        let text = c.prompts[0]!.text;
        if (t >= 0) for (const pr of c.prompts) if (bar >= pr.bar) text = pr.text;
        if (text !== hudPrompt.value) hudPrompt.value = text;
      }
    }
    const hp = Math.round(s.health * 2) / 200;
    if (hp !== hudHealth.value) hudHealth.value = hp;
    let pv = 0;
    if (c.endTime) pv = t / c.endTime;
    else if (c.practice) {
      const barsIn = (t * c.practice.rate) / c.song.barDur - c.practice.fromBar;
      pv = barsIn < 0 ? 0 : (barsIn % c.practice.len) / c.practice.len;
    }
    pv = Math.round(Math.min(1, Math.max(0, pv)) * 400) / 400;
    if (pv !== hudProgress.value) hudProgress.value = Math.min(1, Math.max(0, pv));
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
      audio: this.audioStats,
      clockOffsetMs:
        this.transport?.clock.offset == null ? null : this.transport.clock.offset * 1000,
    });
  }

  pause(reason: PauseReason = 'user'): void {
    const c = this.current;
    if (!c || screen.value !== 'playing') return;
    c.pausedSongTime = countdown.value ? c.pausedSongTime : c.t;
    countdown.value = 0;
    c.run.pause();
    this.transport!.pause();
    pauseReason.value = reason;
    screen.value = 'paused';
    void this.wakeLock.release();
  }

  /**
   * Resume with a 3-beat countdown synced to the music (PRD §2). First brings the AudioContext
   * back if the OS suspended it (this runs from the Resume tap, which iOS requires).
   */
  async resume(): Promise<void> {
    const c = this.current;
    if (!c || screen.value !== 'paused') return;
    const t = this.transport!;
    if (!(await t.ensureRunning())) {
      showToast('Sound is paused. Tap Resume again.');
      return;
    }
    if (this.current !== c || screen.value !== 'paused') return;
    const beatsAhead = 3;
    const resumeAt = t.now() + beatsAhead * c.beat + 0.05;
    c.resumeAt = resumeAt;
    c.songStart = resumeAt - c.pausedSongTime;
    t.resume(resumeAt);
    t.clock.startSong(c.songStart);
    countdown.value = beatsAhead;
    screen.value = 'playing';
    void this.wakeLock.hold();
  }

  restart(): void {
    const tutorial = this.current?.kind === 'tutorial';
    const sel = selection.value;
    this.teardownRun();
    selection.value = { ...sel };
    void this.startRun(tutorial);
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
    void this.wakeLock.release();
    hudPrompt.value = '';
    hudTutorial.value = false;
  }

  private finish(): void {
    const c = this.current;
    if (!c) return;
    const sel = selection.value;
    const kind = c.kind;
    const summary = summarize(c.run.session);
    const gen = CURRENT_GENERATOR_VERSION;
    const key = songKey(gen, sel.mood, sel.mode, sel.difficulty, sel.seed);
    const endless = kind === 'endless';
    const scored = kind !== 'practice' && kind !== 'tutorial';
    const bars = endless ? Math.max(0, Math.floor(c.t / c.song.barDur)) : undefined;
    const loops = c.practice
      ? Math.max(
          0,
          Math.floor(
            ((c.t * c.practice.rate) / c.song.barDur - c.practice.fromBar) / c.practice.len,
          ),
        )
      : undefined;
    const stars = starsFor(
      summary.grade,
      summary.fullCombo,
      summary.allPerfect,
      summary.failed && !endless,
    );
    const noFailUsed = this.settings.noFail || this.harness.noFail;
    // A failed Song run never records a best (prototype behaviour); Endless always can.
    const eligible = scored && !noFailUsed && (endless || !summary.failed);
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
    const day = this.today();
    const cleared = !endless && !summary.failed && !noFailUsed && scored;
    const levelBefore = this.store.save.profile.level;
    let streak: number | undefined;
    this.store.update((s) => {
      s.profile.plays++;
      s.profile.playSec += Math.round((performance.now() - c.startedAt) / 1000);
      if (scored) {
        s.profile.xp += xpFromScore(summary.score);
        s.profile.level = levelFor(s.profile.xp);
      }
      if (kind === 'practice') s.profile.practiceRuns++;
      if (kind === 'tutorial') s.profile.tutorialDone = true;
      if (kind === 'daily' && eligible) {
        const prev = s.daily[day];
        if (!prev || summary.score > prev.score)
          s.daily[day] = { score: summary.score, grade: summary.grade, difficulty: sel.difficulty };
        s.streak = nextStreak(s.streak, day);
        streak = s.streak.current;
      }
    });
    const finished: FinishedRun = {
      selection: sel,
      summary,
      grade: summary.grade,
      cleared,
      bars: bars ?? 0,
      daily: kind === 'daily',
      practice: kind === 'practice',
      tutorial: kind === 'tutorial',
      day,
    };
    const earned = newAchievements(this.store.save, finished);
    if (earned.length) {
      this.store.update((s) => s.profile.achievements.push(...earned));
      this.ui('unlock');
      showToast(
        `Achievement${earned.length > 1 ? 's' : ''}: ${earned.map((id) => achievementById(id)?.name ?? id).join(', ')}`,
        4000,
      );
    }
    const levelAfter = this.store.save.profile.level;
    results.value = {
      summary,
      selection: sel,
      songName: c.song.name,
      bpm: c.song.bpm,
      isBest,
      events: c.run.session.events,
      durationSec: endless || c.practice ? c.t : (c.endTime ?? c.t),
      ...(bars !== undefined ? { bars, peakLevel: c.peakLevel() } : {}),
      grade: endless ? summary.grade : summary.failed ? 'F' : summary.grade,
      stars,
      kind,
      ...(loops !== undefined ? { loops } : {}),
      ...(streak !== undefined ? { streak } : {}),
      achievements: earned,
      levelUp: levelAfter > levelBefore ? levelAfter : null,
      recorded: eligible,
    };
    this.teardownRun();
    screen.value = 'results';
  }

  /* ----------------------------------------------------------- overlays */
  openOverlay(which: 'settings' | 'calibration' | 'profile'): void {
    if (screen.value === 'playing') this.pause();
    // Overlays nest (Settings → Calibration): remember where each one opened from.
    returnStack.value = [...returnStack.value, screen.value];
    screen.value = which;
  }

  closeOverlay(): void {
    const stack = returnStack.value;
    const back = stack.at(-1) ?? 'select';
    returnStack.value = stack.slice(0, -1);
    this.applyVolumes();
    this.applyFrameCap();
    if (this.stage) {
      this.stage.hitLineHigh = this.settings.hitLineHigh;
      this.onResize();
    }
    if (this.diag) this.diag.visible = this.settings.diagnostics;
    screen.value = back;
    if (back === 'select' || back === 'title') {
      this.idleKey = ''; // cosmetics or palette may have changed
      void this.ensureIdle();
      void this.syncAudioBuffer();
    }
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
      audio: () => ({ ...this.audioStats }),
      ready: true,
    };
  }

  /** e2e hooks. */
  get currentScreen(): Screen {
    return screen.value;
  }

  get currentKind(): RunKind | null {
    return this.current?.kind ?? null;
  }
}

function latencyHintFor(b: AudioBuffer): AudioContextLatencyCategory {
  return b === 'low' ? 'interactive' : b === 'balanced' ? 'balanced' : 'playback';
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
