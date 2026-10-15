# Curating a song from a recording

How `friday` was built from an MP3 on 2026-10-15, as a repeatable workflow. Python tooling only;
nothing here runs in the game. The outputs are the token strings in a `packages/core/src/curated/`
entry, which the generator then plays in every mood.

## Setup (once per machine)

```bash
uv venv aenv --python 3.12 && uv pip install --python aenv/bin/python librosa soundfile numpy scipy
uv venv denv --python 3.12 && uv pip install --python denv/bin/python demucs soundfile
ffmpeg -y -i song.mp3 -ac 1 -ar 22050 song.wav
denv/bin/python -m demucs -n htdemucs -o stems song.wav        # drums / bass / other / vocals
```

Keep recordings and stems out of the repo (`reference/audio/` is gitignored).

## Workflow

1. **Grid.** `aenv/bin/python structure.py song.wav` prints tempo, the first tracked beat, a key
   guess, and an energy and chord map per bar. Confirm which tracked beat is the downbeat with the
   kick-band energy by beat phase (the script prints it). Export the result for every other
   script: `export CURATE_FIRST=0.720 CURATE_BPM=123.05`.
2. **Form.** `repeats.py song.wav` prints, per bar, its most similar other bar and the similarity
   at +1, +2, +4, +8 bars. Loops show up as +2 ≈ 1.00; section edges as dips. Decide the section
   list from this plus the energy map.
3. **Melody (vocal stem).** `onsets.py stems/htdemucs/song/vocals.wav <fromBar> <toBar> 0.3`
   lists each sung note with its fractional step, duration and pitch. Then
   `onsets.py … | tokens.py 0.45` quantises into 16-token bar strings, printing how many notes
   land on 8ths (what Normal charts). `pitch.py` gives a per-step median view and the pitch-class
   share, useful for checking the key and spotting chromatic artefacts.
4. **Harmony.** `chords.py stems/htdemucs/song/no_vocals.wav <from> <to>` (or the `other` stem)
   prints the best two triads per half bar. Two chords per bar is common; the entry supports it.
5. **Bass.** `pitch.py` on the bass stem with the range lowered (see `drums.py`, which does the
   bass range) gives absolute pitches per 16th; write them as absolute note tokens.
6. **Drums.** `drums.py stems/htdemucs/song/drums.wav <from> <to>` prints kick, clap and hat hit
   grids per 16th from band energies.
7. **Riff or chopped material.** Pitch trackers miss chopped vocals and short stabs; use
   `salience.py` (energy-gated harmonic salience on a stem) and expect to tune by ear.
8. **Author** the entry, run `pnpm vitest run --project unit packages/core/src/curated -u` to
   refreeze its snapshot, then `pnpm test && pnpm test:golden`, then Listen in every mood.

## Lessons from friday

- **Separate first.** Pitch tracking on the full mix found almost nothing; on the Demucs vocal
  stem it found the hook cleanly. Four stems beat two (the bass stem gives exact bass pitches).
- **Voicing thresholds hide syllables.** `vprob > 0.5` dropped quiet paired syllables; 0.3 with
  a 2-frame minimum found them. Cross-check with the pitch-class share: a pitch class under 1%
  (the A# in a B minor hook) is a glide artefact, not a note.
- **Vocals sit behind the grid.** Measured onsets ran 0.4–0.7 of a 16th late. Quantising to the
  nearest step puts phrases on odd 16ths, which Normal never charts; subtract the lag first
  (`tokens.py 0.45`), then round.
- **Register.** Write notes as sung and set the entry's `transpose` (friday: +12). Procedural
  leads centre two octaves above the root; a vocal transcribed at pitch sat an octave low.
- **Lone tokens sustain to the next onset.** `.` is not a rest after an undashed note. Use `-`
  runs for the length you mean; a lone note before a long rest becomes a hold on Hard.
- **Fills and breaks.** With an authored section list there are many section ends; the mood
  fills (kick drops, risers, rolls) at each one read as "skipping". Authored drums now fill only
  into a chorus and never drop kicks.
- **Two chords per bar and the real bass figure** did more for recognisability than any melody
  tweak; measure the harmonic rhythm per half bar before authoring progressions.
- **Length.** Curated songs ignore the 105 s target; a 74-bar layout is 2:23 at 124 BPM but 3:26
  in Lo-fi at 86. Decide whether that is acceptable per mood (or set `tempo` per mood).
- **Check density per section** on Normal after authoring (chart notes per bar): the record's
  calm sections stay calm, but a section charting under ~2 notes per bar feels empty; fill its
  long rests with the riff.
