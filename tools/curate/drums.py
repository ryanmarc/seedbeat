import sys, numpy as np, librosa
import os
FIRST = float(os.environ.get('CURATE_FIRST', '0.720'))
BPM = float(os.environ.get('CURATE_BPM', '123.05'))
wav, b0, b1 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
BAR = 4*60/BPM; STEP = BAR/16
off = max(0, FIRST + b0*BAR - 0.05)
y, sr = librosa.load(wav, sr=22050, mono=True, offset=off, duration=(b1-b0)*BAR + 0.1)
names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
# Bass: pyin on a low-passed copy
yl = librosa.effects.harmonic(y)
f0, vf, vp = librosa.pyin(yl, fmin=librosa.note_to_hz('E1'), fmax=librosa.note_to_hz('E3'), sr=sr, frame_length=4096, hop_length=256)
t = librosa.frames_to_time(np.arange(len(f0)), sr=sr, hop_length=256) + off
# Drums: band energies per 16th
S = np.abs(librosa.stft(y, n_fft=1024, hop_length=128)); fr = librosa.fft_frequencies(sr=sr, n_fft=1024)
ts = librosa.frames_to_time(np.arange(S.shape[1]), sr=sr, hop_length=128) + off
bands = {'kick': (fr>=40)&(fr<110), 'clap': (fr>=1000)&(fr<2500), 'hat': (fr>=6000)&(fr<11000)}
env = {k: S[m].sum(axis=0) for k, m in bands.items()}
for b in range(b0, b1):
    t0 = FIRST + b*BAR
    bass = []; d = {k: [] for k in bands}
    for s in range(16):
        m = (t >= t0 + s*STEP) & (t < t0 + (s+1)*STEP) & vf & (vp > 0.5)
        if m.sum() >= 3:
            r = int(round(float(np.median(librosa.hz_to_midi(f0[m]))))); bass.append(f"{names[r%12]}{r//12-1}")
        else: bass.append('.')
        # onset: energy in the first 40 ms of the step vs the previous 40 ms
        a = (ts >= t0 + s*STEP) & (ts < t0 + s*STEP + 0.04); p = (ts >= t0 + s*STEP - 0.04) & (ts < t0 + s*STEP)
        for k in bands:
            ea = env[k][a].max() if a.any() else 0; ep = env[k][p].mean() if p.any() else 0
            d[k].append(ea / (ep + 1e-6))
    print(f"bar {b:3d} bass | " + ' '.join(f"{x:>3s}" for x in bass))
    for k in bands:
        mx = max(d[k]) or 1
        print(f"        {k:4s} | " + ' '.join(('x' if v > 0.5*mx and v > 2 else ('o' if v > 0.25*mx and v > 1.5 else '.')).rjust(3) for v in d[k]))
