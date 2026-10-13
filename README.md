# Seedbeat

A four-lane rhythm game for phones and desktop browsers. Type any word and get a song: a text seed
deterministically composes a complete track (synthesized live, no audio files) in one of four moods,
and the note chart is written from the song's own melody, so every note you hit is a note you hear.
Share a seed and a friend gets the same song and the same chart.

Moods: Chill Lo-fi, Synthwave, Chiptune, Dark Techno. Modes: Song (about 1.5–2 min) and Endless.

**Status:** early. Web build only for now (installable PWA on mobile and desktop browsers). Native
iOS and Android shells come after the web version is complete.

## Stack

TypeScript (strict), pnpm workspaces, Vite, PixiJS v8 for the play field, Preact for menus and HUD,
one AudioWorklet running our own DSP for all music, IndexedDB for saves. Tests: Vitest, fast-check,
Playwright.

```
packages/core      pure, deterministic: rng, theory, moods, song, bars, chart, judgement, scoring
packages/dsp       pure DSP: oscillators, filters, envelopes, voices, effects, mixer, loudness meter
packages/worklet   AudioWorkletProcessor: sequencer (uses core) + dsp, message protocol
apps/game          the web app: engine (clock, input, session), render (Pixi), ui (Preact), save
tools/golden       frozen generator fixtures and the parity test
tools/size         initial-JS bundle size check
tools/perf         Playwright performance harness
```

## Commands

Requires Node 24 and pnpm 11 (`corepack enable` picks up the pinned version).

| Command            | What it does                                                                    |
| ------------------ | ------------------------------------------------------------------------------- |
| `pnpm install`     | Install (lockfile is authoritative)                                             |
| `pnpm dev`         | Web dev server                                                                  |
| `pnpm build`       | Production build to `apps/game/dist`                                            |
| `pnpm size`        | Initial-JS size (gzip and brotli) against the 300 KB gzip budget; needs a build |
| `pnpm test`        | Unit and property tests, all packages                                           |
| `pnpm test:golden` | Generator parity against the frozen v1 fixtures in `tools/golden/fixtures/v1`   |
| `pnpm test:audio`  | Offline DSP render checks: loudness, true peak, NaN, DC offset                  |
| `pnpm test:e2e`    | Playwright end-to-end (run `pnpm exec playwright install chromium` once first)  |
| `pnpm perf`        | Playwright perf harness: fps, p95 frame time, late-frame %                      |
| `pnpm typecheck`   | `tsc -b` across the workspace                                                   |
| `pnpm lint`        | ESLint and Prettier check (`pnpm format` to fix)                                |

CI runs typecheck, lint, unit, golden, audio, build and the size check on every push and pull request.

## Rules that the repo enforces

1. **Determinism.** `packages/core` is pure TypeScript: no DOM, no audio, no I/O, no `Math.random`,
   no `Date`. Its `tsconfig` has no DOM lib and no ambient types, and `eslint.config.js` bans the
   clock, random and I/O globals in that folder. The same seed, mood, mode and difficulty must give
   byte-identical songs and charts on every platform.
2. **Golden parity.** `pnpm test:golden` must pass against the frozen fixtures. They are never
   regenerated. A change in generator output is a new `generatorVersion` with new fixtures, and old
   versions stay playable so shared seeds keep working.
3. **Timing.** Every input is judged by its event timestamp mapped through the smoothed audio clock,
   never by "now" inside a handler. Notes are never positioned from raw `AudioContext.currentTime`.
4. **Nothing heavy on the frame.** No allocation, audio node creation, chart generation, JSON parsing
   or DOM layout reads inside the render loop. The sequencer runs in the AudioWorklet.
5. **Performance budgets are acceptance criteria.** Initial JS ≤ 300 KB gzip; on a reference
   low-end phone, ≤ 1 % late frames in a Hard chorus, p95 main-thread JS ≤ 4 ms per frame, zero
   steady-state allocations, zero audio underruns.
6. **A hold owns its lane** from its head until 1.5 sixteenth-steps after its tail, across bar
   boundaries. Covered by a property test.
7. **Accessibility ships in v1:** reduced motion, colour-blind lane palettes, remappable keys and a
   no-fail option.
