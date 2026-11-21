#!/usr/bin/env python3
"""stepfind.py <scan_dir> <ref.mp4> <t0> <t1> [y0,y1,x0,x1]
Frame-by-frame look at one time window of the reference: prints, for every reference frame, the time, the matching CLEAN frame
number, and how many caption pixels are lit inside the box (0..1 fractions of the frame; default = whole caption zone), with the
change from the previous frame. A jump in "area" = a word or line appeared or disappeared on that frame.
Also saves <scan_dir>/steps_<t0>_<t1>.jpg: one tile per reference frame (max 48 frames, cropped to the box rows) to read the text.
"""
import sys, os, json, subprocess, numpy as np
from PIL import Image, ImageDraw
sd, ref, t0, t1 = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
box = [float(x) for x in sys.argv[5].split(',')] if len(sys.argv) > 5 else [0.10, 0.93, 0.0, 1.0]
meta = json.load(open(os.path.join(sd, 'changes.json'))); fr = meta['ref_fps']; nr = meta['ref_frames']
W, H = 240, 426
M = np.unpackbits(np.load(os.path.join(sd, 'mask_bits.npy')))[: nr * H * W].reshape(nr, H, W).astype(bool)
cmap = np.load(os.path.join(sd, 'cmap.npy'))
k0, k1 = max(0, int(round(t0 * fr))), min(nr, int(round(t1 * fr)) + 1)
r0, r1, c0, c1 = int(box[0] * H), int(box[1] * H), int(box[2] * W), int(box[3] * W)
prev = None
for k in range(k0, k1):
    a = int(M[k, r0:r1, c0:c1].sum())
    print(f'ref_frame {k:5d}  t={k / fr:7.3f}s  clean_frame {int(cmap[k]):5d}  area {a:5d}  {"" if prev is None else f"({a - prev:+d})"}')
    prev = a
n = min(48, k1 - k0)
RW, RH = 480, 854
y0, y1 = int(RH * max(0, box[0] - 0.02)), int(RH * min(1, box[1] + 0.02)); th = y1 - y0
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', ref, '-vf', f"select='between(n,{k0},{k0 + n - 1})',scale={RW}:{RH}", '-vsync', '0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
F = np.frombuffer(raw, np.uint8).reshape(-1, RH, RW, 3)
cols = 6; rows = (len(F) + cols - 1) // cols
S = Image.new('RGB', (RW * cols, th * rows), (30, 30, 30))
for i, f in enumerate(F):
    im = Image.fromarray(f[y0:y1]); d = ImageDraw.Draw(im); d.rectangle([0, 0, 150, 13], fill=(0, 0, 0)); d.text((3, 1), f'ref {k0 + i}  {(k0 + i) / fr:.3f}s', fill=(255, 255, 0))
    S.paste(im, ((i % cols) * RW, (i // cols) * th))
o = os.path.join(sd, f'steps_{t0:.2f}_{t1:.2f}.jpg'); S.save(o, quality=85); print('saved', o)
