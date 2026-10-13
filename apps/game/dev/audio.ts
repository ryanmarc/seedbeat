import { CURRENT_GENERATOR_VERSION, makeSong, type MoodId, type Mode } from '@seedbeat/core';
import { AudioEngine } from '../src/platform/audio';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const seedEl = $<HTMLInputElement>('seed');
const moodEl = $<HTMLSelectElement>('mood');
const modeEl = $<HTMLSelectElement>('mode');
const rateEl = $<HTMLSelectElement>('rate');
const fromBarEl = $<HTMLInputElement>('fromBar');
const statusEl = $<HTMLPreElement>('status');
const playBtn = $<HTMLButtonElement>('play');
const pauseBtn = $<HTMLButtonElement>('pause');
const stopBtn = $<HTMLButtonElement>('stop');
const hitBtn = $<HTMLButtonElement>('hit');

const WORDS = [
  'amber',
  'cobalt',
  'lantern',
  'harbor',
  'meteor',
  'velvet',
  'orbit',
  'ember',
  'glacier',
  'signal',
  'tidal',
  'prism',
];
let engine: AudioEngine | null = null;
let paused = false;
let lastStatus = '';

function log(lines: string): void {
  statusEl.textContent = lines;
}

$<HTMLButtonElement>('shuffle').onclick = () => {
  seedEl.value = `${WORDS[Math.floor(Math.random() * WORDS.length)]}-${10 + Math.floor(Math.random() * 90)}`;
};

playBtn.onclick = async () => {
  try {
    engine ??= await AudioEngine.create();
  } catch (e) {
    log(`Audio failed: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  const seed = seedEl.value.trim() || 'amber-11';
  const mood = moodEl.value as MoodId;
  const mode = modeEl.value as Mode;
  const rate = Number(rateEl.value);
  const fromBar = Math.max(0, Number(fromBarEl.value) || 0);
  const song = makeSong(seed, mood, mode);
  const lead = 0.15;
  engine.send({ type: 'stop' });
  engine.send({
    type: 'start',
    seed,
    mood,
    mode,
    generatorVersion: CURRENT_GENERATOR_VERSION,
    startTime: engine.ctx.currentTime + lead + (fromBar * song.barDur) / rate,
    rate,
    countIn: fromBar === 0,
    fromBar,
  });
  paused = false;
  pauseBtn.disabled = stopBtn.disabled = hitBtn.disabled = false;
  pauseBtn.textContent = 'Pause';
  const header = `${song.name} · ${song.bpm} BPM · ${song.scaleName} · ${song.total ?? '∞'} bars · output latency ${(engine.outputLatency * 1000).toFixed(0)} ms · limiter ${(engine.latencySec * 1000).toFixed(1)} ms`;
  engine.on('status', (s) => {
    lastStatus = `${header}\nbar ${s.bar} step ${s.step} · song ${(s.frame / engine!.ctx.sampleRate).toFixed(2)} s · voices ${s.voices} (peak ${s.peakVoices}, steals ${s.steals}) · ${s.playing ? 'playing' : 'paused'}`;
    log(lastStatus);
  });
  engine.on('ended', () => log(`${lastStatus}\nended`));
  engine.on('error', (m) => log(`worklet error: ${m}`));
  log(header);
};

pauseBtn.onclick = () => {
  if (!engine) return;
  if (!paused) {
    engine.send({ type: 'pause' });
    paused = true;
    pauseBtn.textContent = 'Resume';
  } else {
    engine.send({ type: 'resume', atTime: engine.ctx.currentTime + 0.05 });
    paused = false;
    pauseBtn.textContent = 'Pause';
  }
};

stopBtn.onclick = () => {
  engine?.send({ type: 'stop' });
  pauseBtn.disabled = stopBtn.disabled = hitBtn.disabled = true;
  log('stopped');
};

hitBtn.onclick = () => {
  const js = ['perfect', 'great', 'good', 'miss'] as const;
  engine?.send({ type: 'hitSound', judgement: js[Math.floor(Math.random() * js.length)]! });
};
