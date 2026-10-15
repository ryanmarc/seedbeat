import sys, numpy as np, librosa
import os
FIRST = float(os.environ.get('CURATE_FIRST', '0.720'))
BPM = float(os.environ.get('CURATE_BPM', '123.05'))
wav, b0, b1 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
BAR = 4*60/BPM; STEP = BAR/16
off = max(0, FIRST + b0*BAR - 0.05)
y, sr = librosa.load(wav, sr=22050, mono=True, offset=off, duration=(b1-b0)*BAR + 0.1)
f0, vflag, vprob = librosa.pyin(y, fmin=librosa.note_to_hz('G2'), fmax=librosa.note_to_hz('C6'), sr=sr, frame_length=2048, hop_length=128)
t = librosa.frames_to_time(np.arange(len(f0)), sr=sr, hop_length=128) + off
names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
pcs = np.zeros(12)
for b in range(b0, b1):
    t0 = FIRST + b*BAR; cells = []
    for s in range(16):
        m = (t >= t0 + s*STEP) & (t < t0 + (s+1)*STEP) & vflag & (vprob > 0.5)
        if m.sum() >= 2:
            midi = librosa.hz_to_midi(f0[m]); med = float(np.median(midi)); r = int(round(med))
            pcs[r % 12] += m.sum()
            cells.append(f"{names[r%12]}{r//12-1}{med-r:+.1f}")
        else: cells.append('.')
    print(f"bar {b:3d} | " + ' '.join(f"{c:>8s}" for c in cells))
tot = pcs.sum() or 1
print("pitch-class share: " + ', '.join(f"{names[i]} {100*pcs[i]/tot:.0f}%" for i in np.argsort(pcs)[::-1][:8]))
