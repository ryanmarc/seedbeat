import sys, numpy as np, librosa
import os
FIRST = float(os.environ.get('CURATE_FIRST', '0.720'))
BPM = float(os.environ.get('CURATE_BPM', '123.05'))
wav, b0, b1 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
vth = float(sys.argv[4]) if len(sys.argv) > 4 else 0.3
BAR = 4*60/BPM; STEP = BAR/16
off = max(0, FIRST + b0*BAR - 0.05)
y, sr = librosa.load(wav, sr=22050, mono=True, offset=off, duration=(b1-b0)*BAR + 0.1)
hop = 64
f0, vf, vp = librosa.pyin(y, fmin=librosa.note_to_hz('G2'), fmax=librosa.note_to_hz('C6'), sr=sr, frame_length=2048, hop_length=hop)
t = librosa.frames_to_time(np.arange(len(f0)), sr=sr, hop_length=hop) + off
names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
voiced = vf & (vp > vth) & ~np.isnan(f0)
midi = np.where(voiced, librosa.hz_to_midi(np.nan_to_num(f0, nan=1.0)), np.nan)
# segment into notes: consecutive voiced frames; split when rounded pitch changes for >= 3 frames
notes = []
i = 0; n = len(midi)
while i < n:
    if not voiced[i]: i += 1; continue
    j = i; cur = int(round(midi[i])); pitches = []
    while j < n and voiced[j]:
        r = int(round(midi[j]))
        if r != cur:
            # look ahead: is the new pitch stable for 3 frames?
            if j + 2 < n and all(voiced[j+k] and int(round(midi[j+k])) == r for k in range(3)):
                break
        pitches.append(midi[j]); j += 1
    if len(pitches) >= 2:
        notes.append((t[i], t[j-1] - t[i] + hop/sr, float(np.median(pitches))))
    i = j
for (t0, dur, m) in notes:
    step = (t0 - FIRST) / STEP; bar = int(step // 16); s = step - bar*16
    if bar < b0 or bar >= b1: continue
    r = int(round(m))
    print(f"bar {bar:3d} step {s:5.2f} dur {dur/STEP:4.1f}  {names[r%12]}{r//12-1} ({m-r:+.2f})")
