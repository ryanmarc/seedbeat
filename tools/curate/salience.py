import sys, numpy as np, librosa
import os
FIRST = float(os.environ.get('CURATE_FIRST', '0.720'))
BPM = float(os.environ.get('CURATE_BPM', '123.05'))
wav, b0, b1 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
BAR = 4*60/BPM; STEP = BAR/16
off = max(0, FIRST + b0*BAR - 0.05)
y, sr = librosa.load(wav, sr=22050, mono=True, offset=off, duration=(b1-b0)*BAR + 0.1)
hop = 128
C = np.abs(librosa.cqt(y, sr=sr, hop_length=hop, fmin=librosa.note_to_hz('C2'), n_bins=60, bins_per_octave=12))
rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=hop)[0]
t = librosa.frames_to_time(np.arange(C.shape[1]), sr=sr, hop_length=hop) + off
names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
gate = np.percentile(rms, 60)
for b in range(b0, b1):
    t0 = FIRST + b*BAR; cells = []
    for s in range(16):
        m = (t >= t0 + s*STEP) & (t < t0 + (s+1)*STEP)
        if not m.any() or rms[m].max() < gate: cells.append('.'); continue
        fr = C[:, m].mean(axis=1)
        sal = fr.copy()
        for p in range(60):
            if p+12 < 60: sal[p] += 0.5*fr[p+12]
            if p+19 < 60: sal[p] += 0.33*fr[p+19]
            if p-12 >= 0: sal[p] -= 0.4*fr[p-12]
        lo, hi = 19, 48  # G3 .. C6 (C2 = bin 0)
        p = lo + int(np.argmax(sal[lo:hi])); mm = p + 36
        cells.append(f"{names[mm%12]}{mm//12-1}")
    print(f"bar {b:3d} | " + ' '.join(f"{c:>4s}" for c in cells))
