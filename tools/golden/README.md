# Golden fixtures (generator v1)

`fixtures/v1/` holds 16 songs exported from the original prototype (4 moods × 3 Song seeds + 1 Endless
seed) plus `index.json`. They are the proof that the generator port is exact: `pnpm test:golden`
must reproduce every bar event, every chart note and every metadata value, with times compared to 1e-9 s.

These files are frozen. Never regenerate or hand-edit them to make a test pass. A change in generator
output is a new `generatorVersion` with its own fixture set, and v1 stays playable so shared seeds keep
working.

Fixture shape, per file: `{ meta, bars, charts }`

- `meta`: generatorVersion, seed, mood, mode, bpm, scale, rootMidi, swing, stepSec, barSec,
  totalBars (null for endless), name, progressions, patternIdx, stabSteps, sections.
- `bars[]`: `{ bar, section, lead[], events[] }` — every bar for the `amber-11` songs, the first 16
  bars for Endless, empty for the other Song seeds.
- `charts.easy|normal|hard`: arrays of `[timeSec, lane, tailSec or 0]`, cross-bar lane reservation
  applied. Endless charts cover the first 96 bars.
