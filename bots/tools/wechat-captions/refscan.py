#!/usr/bin/env python3
"""refscan.py ref.mp4 clean.mp4 outdir
Aligns the English reference with the clean file frame by frame (handles 24 vs 30 fps), isolates the burned-in captions,
finds every frame where the on-screen caption changes, and writes:
  outdir/changes.json  : segments [{seg, ref_f0, ref_f1, t0, t1, clean_f0, clean_f1, bbox:[y0,y1,x0,x1] (0..1), area}]
  outdir/sheet_XX.jpg  : contact sheets of the reference caption zone, one tile per segment (label = seg id + time)
  outdir/map.png       : rows x frames activity map
"""
import sys, os, json, subprocess, numpy as np
from PIL import Image, ImageDraw
ref, clean, out = sys.argv[1:4]
os.makedirs(out, exist_ok=True)
W, H = 240, 426
def probe(f):
    s = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate,nb_frames', '-of', 'json', f], capture_output=True, text=True).stdout)['streams'][0]
    a, b = s['r_frame_rate'].split('/'); return float(a) / float(b), int(s['nb_frames'])
def rd(f):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', f, '-vf', f'scale={W}:{H}:flags=area,format=gray', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], capture_output=True).stdout
    return np.frombuffer(r, np.uint8).reshape(-1, H, W)
fr, nr = probe(ref); fc, nc = probe(clean)
A = rd(ref); B = rd(clean); nr, nc = len(A), len(B)
q = np.linspace(0, 100, 65)
def match(b, a):  # map clean tones onto ref tones (handles HDR/SDR and grading differences)
    return np.interp(b.astype(np.float32), np.percentile(b, q), np.percentile(a, q))
D = np.zeros((nr, H, W), bool); cmap = np.zeros(nr, int)
for k in range(nr):
    c0 = int(round(k / fr * fc)); best = None
    for c in range(max(0, c0 - 2), min(nc, c0 + 3)) if abs(fr - fc) > 0.01 else [min(k, nc - 1)]:
        d = np.abs(A[k].astype(np.float32) - match(B[c], A[k]))
        s = np.sort(d.ravel())[: int(d.size * 0.8)].mean()   # ignore the 20% most different pixels (the captions)
        if best is None or s < best[0]: best = (s, c, d)
    cmap[k] = best[1]; D[k] = best[2] > 34
# clean up specks: need >=3 active neighbours in 3x3
Df = D.astype(np.uint8)
nb = sum(np.roll(np.roll(Df, i, 1), j, 2) for i in (-1, 0, 1) for j in (-1, 0, 1))
M = (Df == 1) & (nb >= 4)
zone = np.zeros(H, bool); zone[int(H * 0.10):int(H * 0.93)] = True
M[:, ~zone, :] = False
area = M.reshape(nr, -1).sum(1)
np.save(os.path.join(out, 'mask_bits.npy'), np.packbits(M, axis=None)); np.save(os.path.join(out, 'cmap.npy'), cmap)
act = M.mean(2)
Image.fromarray((np.clip(act.T * 6, 0, 1) * 255).astype(np.uint8)).save(os.path.join(out, 'map.png'))
# change points
chg = [0]
for k in range(1, nr):
    x = np.logical_xor(M[k], M[k - 1]).sum()
    if x > max(45, 0.10 * max(area[k], area[k - 1])): chg.append(k)
# merge bursts (animation frames): keep first of a run, mark settle = last of run
segs = []; i = 0
while i < len(chg):
    j = i
    while j + 1 < len(chg) and chg[j + 1] - chg[j] <= 2: j += 1
    segs.append([chg[i], chg[j]]); i = j + 1
res = []
for si, (s0, settle) in enumerate(segs):
    e = segs[si + 1][0] if si + 1 < len(segs) else nr
    mid = min(e - 1, settle + max(0, (e - settle) // 2))
    m = M[settle:e].mean(0) > 0.5 if e > settle else M[settle]
    ys, xs = np.where(m)
    bbox = [round(ys.min() / H, 4), round((ys.max() + 1) / H, 4), round(xs.min() / W, 4), round((xs.max() + 1) / W, 4)] if len(ys) > 30 else None
    res.append({'seg': si, 'ref_f0': int(s0), 'ref_settle': int(settle), 'ref_f1': int(e), 't0': round(s0 / fr, 3), 't1': round(e / fr, 3),
                'clean_f0': int(cmap[s0]), 'clean_f1': int(cmap[e]) if e < nr else nc, 'area': int(m.sum()), 'bbox': bbox, 'view_ref_frame': int(mid)})
json.dump({'ref_fps': fr, 'clean_fps': fc, 'ref_frames': nr, 'clean_frames': nc, 'segments': res}, open(os.path.join(out, 'changes.json'), 'w'), indent=0)
# contact sheets from the reference (full width, rows 12%..92%), 6 x 3 tiles per sheet
RW, RH = 480, 854
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', ref, '-vf', f'scale={RW}:{RH}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
F = np.frombuffer(raw, np.uint8).reshape(-1, RH, RW, 3)
y0, y1 = int(RH * 0.12), int(RH * 0.92); th = y1 - y0
per = 12
for p in range(0, len(res), per):
    S = Image.new('RGB', (RW * 6, th * 2), (30, 30, 30))
    for j, r in enumerate(res[p:p + per]):
        im = Image.fromarray(F[min(r['view_ref_frame'], len(F) - 1)][y0:y1])
        d = ImageDraw.Draw(im); d.rectangle([0, 0, 250, 15], fill=(0, 0, 0)); d.text((3, 2), f"seg {r['seg']}  {r['t0']:.2f}-{r['t1']:.2f}s  area {r['area']}", fill=(255, 255, 0))
        S.paste(im, ((j % 6) * RW, (j // 6) * th))
    S.save(os.path.join(out, f'sheet_{p // per:02d}.jpg'), quality=88)
print(out, 'ref', nr, 'frames @', fr, '| clean', nc, '@', fc, '| segments', len(res), '| sheets', (len(res) + per - 1) // per)
