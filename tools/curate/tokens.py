import sys, re
# Reads onsets.py output on stdin; prints 16-token bar strings with the vocal lag removed.
LAG = float(sys.argv[1]) if len(sys.argv) > 1 else 0.45
rows = []
for line in sys.stdin:
    m = re.match(r'bar\s+(\d+) step\s+([\d.]+) dur\s+([\d.]+)\s+([A-G]#?\d)', line)
    if m: rows.append((int(m[1]), float(m[2]), float(m[3]), m[4]))
bars = {}
for bar, x, dur, note in rows:
    step = round(x - LAG); b = bar
    if step < 0: step = 0
    if step > 15: b += 1; step -= 16
    d = max(1, min(12, round(dur)))
    cell = bars.setdefault(b, {})
    if step in cell and cell[step][1] >= d: continue   # keep the longer note on a collision
    cell[step] = (note, d)
for b in sorted(bars):
    cell = bars[b]; toks = ['.'] * 16
    for step in sorted(cell):
        note, d = cell[step]; toks[step] = note
        for k in range(1, d):
            if step + k < 16 and (step + k) not in cell: toks[step + k] = '-'
            else: break
    even = sum(1 for s in cell if s % 2 == 0)
    print(f"bar {b:3d} | " + ' '.join(f"{t:<3s}" for t in toks) + f"   | notes {len(cell)}  on-8ths {even}")
