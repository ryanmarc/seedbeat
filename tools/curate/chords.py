import sys, numpy as np, librosa
import os
FIRST = float(os.environ.get('CURATE_FIRST', '0.720'))
BPM = float(os.environ.get('CURATE_BPM', '123.05'))
wav, b0, b1 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
BAR = 4*60/BPM
off = FIRST + b0*BAR
y, sr = librosa.load(wav, sr=22050, mono=True, offset=off, duration=(b1-b0)*BAR)
C = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=512, bins_per_octave=36)
t = librosa.frames_to_time(np.arange(C.shape[1]), sr=sr, hop_length=512) + off
names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
def best(c):
    c = c/(c.sum()+1e-9); out=[]
    for r in range(12):
        for q, iv in (('', [0,4,7]), ('m', [0,3,7])):
            tpl = np.zeros(12); tpl[[(r+i)%12 for i in iv]] = 1; tpl[r] += 0.5
            out.append((float(c@tpl), names[r]+q))
    out.sort(reverse=True); return out[:2]
for b in range(b0, b1):
    row=[]
    for h in range(2):
        t0 = FIRST + b*BAR + h*BAR/2; m = (t>=t0)&(t<t0+BAR/2)
        (s1,n1),(s2,n2) = best(C[:, m].mean(axis=1))
        row.append(f"{n1:4s}({s1:.2f}) {n2:4s}({s2:.2f})")
    print(f"bar {b:3d} | " + ' | '.join(row))
