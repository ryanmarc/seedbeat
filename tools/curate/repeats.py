import sys, numpy as np, librosa
import os
FIRST = float(os.environ.get('CURATE_FIRST', '0.720'))
BPM = float(os.environ.get('CURATE_BPM', '123.05'))
y, sr = librosa.load(sys.argv[1], sr=22050, mono=True)
BAR = 4*60/BPM
chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=512)
mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=512)
t = librosa.frames_to_time(np.arange(chroma.shape[1]), sr=sr, hop_length=512)
nb = int((len(y)/sr - FIRST)/BAR)
feats = []
for b in range(nb):
    m = (t >= FIRST + b*BAR) & (t < FIRST + (b+1)*BAR)
    # 4 sub-bar chroma slices + mfcc mean
    idx = np.where(m)[0]; q = np.array_split(idx, 4)
    f = np.concatenate([chroma[:, s].mean(axis=1) for s in q] + [mfcc[1:, idx].mean(axis=1)/50])
    feats.append(f/ (np.linalg.norm(f)+1e-9))
F = np.array(feats); S = F @ F.T
# For each bar, the best-matching earlier bar
print("bar -> most similar other bar (sim), and sim to bar+1,+2,+4,+8 (periodicity)")
for b in range(nb):
    row = S[b].copy(); row[b] = -1
    j = int(np.argmax(row))
    per = ' '.join(f"+{k}:{S[b,b+k]:.2f}" if b+k < nb else f"+{k}:  --" for k in (1,2,4,8))
    print(f"bar {b:3d} ~ bar {j:3d} ({row[j]:.2f})   {per}")
