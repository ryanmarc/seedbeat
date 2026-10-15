import sys, numpy as np, librosa
y, sr = librosa.load(sys.argv[1], sr=22050, mono=True)
dur = len(y)/sr
# Tempo and beats
onset = librosa.onset.onset_strength(y=y, sr=sr)
tempo, beats = librosa.beat.beat_track(onset_envelope=onset, sr=sr, units='time', start_bpm=120)
tempo = float(np.atleast_1d(tempo)[0])
bt = np.asarray(beats)
ibi = np.diff(bt)
print(f"duration {dur:.1f}s  tempo {tempo:.2f} bpm  beats {len(bt)}  median IBI {np.median(ibi):.4f}s -> {60/np.median(ibi):.2f} bpm  first beat {bt[0]:.3f}s")
# Key: Krumhansl-Schmuckler on chroma
chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
prof = chroma.mean(axis=1)
maj = np.array([6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88])
mnr = np.array([6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17])
names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
scores = []
for i in range(12):
    scores.append((np.corrcoef(prof, np.roll(maj, i))[0,1], names[i]+' major'))
    scores.append((np.corrcoef(prof, np.roll(mnr, i))[0,1], names[i]+' minor'))
scores.sort(reverse=True)
print("key candidates:", ", ".join(f"{n} {s:.2f}" for s, n in scores[:5]))
# Bar energy map (assume 4/4, bar = 4 beats from first beat)
rms = librosa.feature.rms(y=y)[0]
t_rms = librosa.frames_to_time(np.arange(len(rms)), sr=sr)
bar_len = 4*np.median(ibi)
nbars = int((dur - bt[0]) / bar_len)
print(f"bar length {bar_len:.3f}s, {nbars} bars from {bt[0]:.2f}s")
rows = []
for b in range(nbars):
    t0 = bt[0] + b*bar_len; t1 = t0 + bar_len
    m = (t_rms >= t0) & (t_rms < t1)
    e = float(rms[m].mean()) if m.any() else 0
    # chord estimate: chroma averaged per bar matched to major/minor triads
    f0 = librosa.time_to_frames(t0, sr=sr); f1 = librosa.time_to_frames(t1, sr=sr)
    c = chroma[:, f0:f1].mean(axis=1); c = c/ (c.sum()+1e-9)
    best = (-1, '')
    for r in range(12):
        for q, iv in (('', [0,4,7]), ('m', [0,3,7])):
            tpl = np.zeros(12); tpl[[(r+i)%12 for i in iv]] = 1
            s = float(c @ tpl)
            if s > best[0]: best = (s, names[r]+q)
    rows.append((b, t0, e, best[1]))
emax = max(r[2] for r in rows)
for b, t0, e, ch in rows:
    bar = '#' * int(40*e/emax)
    print(f"bar {b:3d} {t0:6.2f}s {ch:4s} {bar}")
