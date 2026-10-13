import { useComputed } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import {
  CURRENT_GENERATOR_VERSION,
  MOODS,
  MOOD_IDS,
  makeSong,
  type Difficulty,
  type MoodId,
  type Mode,
} from '@seedbeat/core';
import { controller } from '../app/controller';
import { DIFF_LABEL, MOOD_LABEL, randomSeed, songMeta } from '../app/format';
import { listening, save, selection } from '../app/state';
import { songKey } from '../save/schema';
import { Segmented } from './components';

export function SelectScreen() {
  const h = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    h.current?.focus();
  }, []);
  const sel = selection.value;
  const song = useComputed(() => {
    const s = selection.value;
    return makeSong(s.seed || 'amber-11', s.mood, s.mode);
  }).value;
  const best =
    save.value.bests[
      songKey(CURRENT_GENERATOR_VERSION, sel.mood, sel.mode, sel.difficulty, sel.seed)
    ];
  const fav = save.value.favourites.includes(sel.seed);
  const set = (patch: Partial<typeof sel>): void => {
    selection.value = { ...selection.value, ...patch };
    void controller.ensureIdle();
    if (listening.value) void controller.listen(false);
  };
  return (
    <section class="screen" id="select" aria-labelledby="select-title">
      <div class="panel">
        <header class="brand">
          <h1 id="select-title" ref={h} tabIndex={-1}>
            SEEDBEAT
          </h1>
          <p class="lede">Pick a mood, type a seed, play the song it makes.</p>
        </header>
        <fieldset>
          <legend>Mood</legend>
          <div class="moods">
            {MOOD_IDS.map((m: MoodId) => (
              <button
                key={m}
                type="button"
                class="mood"
                aria-pressed={m === sel.mood}
                onClick={() => set({ mood: m })}
              >
                <strong>{MOOD_LABEL[m]}</strong>
                <small>
                  {MOODS[m].bpm[0]}–{MOODS[m].bpm[1]} BPM · {MOODS[m].scales.join('/')}
                </small>
                <span class="sw" aria-hidden="true">
                  {MOODS[m].palette.lane.map((c) => (
                    <i key={c} style={{ background: c }} />
                  ))}
                </span>
              </button>
            ))}
          </div>
        </fieldset>
        <div class="row2">
          <Segmented<Mode>
            label="Mode"
            value={sel.mode}
            options={[
              { value: 'song', label: 'Song' },
              { value: 'endless', label: 'Endless' },
            ]}
            onChange={(mode) => set({ mode })}
          />
          <Segmented<Difficulty>
            label="Difficulty"
            value={sel.difficulty}
            options={DIFF_LABEL.map((l, i) => ({ value: i as Difficulty, label: l }))}
            onChange={(difficulty) => set({ difficulty })}
          />
        </div>
        <fieldset>
          <legend>
            <label for="seed">Seed</label>
          </legend>
          <div class="seedrow">
            <input
              id="seed"
              type="text"
              maxLength={32}
              autocomplete="off"
              spellcheck={false}
              value={sel.seed}
              onInput={(e) => set({ seed: (e.target as HTMLInputElement).value.trim() })}
            />
            <button type="button" class="btn" onClick={() => set({ seed: randomSeed() })}>
              Shuffle
            </button>
            <button
              type="button"
              class="btn"
              aria-pressed={fav}
              aria-label={fav ? 'Remove from favourites' : 'Add to favourites'}
              onClick={() => controller.store.toggleFavourite(sel.seed)}
            >
              {fav ? '★' : '☆'}
            </button>
          </div>
        </fieldset>
        <div class="readout" aria-live="polite">
          <div class="name">{song.name}</div>
          <div class="meta">{songMeta(song)}</div>
          <div class="best">
            {best
              ? `Best ${best.score.toLocaleString()} · ${best.grade} · ${(best.acc * 100).toFixed(1)}%${best.fc ? ' · FC' : ''}`
              : 'No score yet on this seed.'}
          </div>
        </div>
        <div class="actions">
          <button type="button" class="btn primary" onClick={() => void controller.startRun()}>
            PLAY
          </button>
          <button
            type="button"
            class="btn"
            aria-pressed={listening.value}
            onClick={() => void controller.listen(!listening.value)}
          >
            {listening.value ? 'Stop' : 'Listen'}
          </button>
          <button type="button" class="btn" onClick={() => controller.openOverlay('calibration')}>
            Calibrate
          </button>
        </div>
        {(save.value.recents.length > 0 || save.value.favourites.length > 0) && (
          <fieldset>
            <legend>Recent and favourite seeds</legend>
            <div class="chips">
              {[...new Set([...save.value.favourites, ...save.value.recents])]
                .slice(0, 24)
                .map((s) => (
                  <button
                    key={s}
                    type="button"
                    class="chip"
                    aria-pressed={s === sel.seed}
                    onClick={() => set({ seed: s })}
                  >
                    {save.value.favourites.includes(s) ? '★ ' : ''}
                    {s}
                  </button>
                ))}
            </div>
          </fieldset>
        )}
        <div class="menurow">
          <button
            type="button"
            class="btn small"
            onClick={() => controller.openOverlay('settings')}
          >
            Settings
          </button>
          <button type="button" class="btn small" onClick={() => controller.openOverlay('profile')}>
            Profile
          </button>
        </div>
        <p class="hint">
          Keys <kbd>D</kbd> <kbd>F</kbd> <kbd>J</kbd> <kbd>K</kbd> or the arrows hit the four lanes.
          Hold long notes and let go when the RELEASE cap reaches the line. <kbd>Esc</kbd> pauses.
        </p>
      </div>
    </section>
  );
}
