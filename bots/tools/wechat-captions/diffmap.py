# usage: diffmap.py ref.mp4 clean.mp4 out_prefix  -> per-frame row activity of (ref - clean) = burned captions
import sys, subprocess, numpy as np
from PIL import Image
ref, clean, out = sys.argv[1:4]
W, H = 240, 426
def rd(f, extra=''):
    vf = f'scale={W}:{H}:flags=area,format=gray' + extra
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', f, '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], capture_output=True).stdout
    return np.frombuffer(r, np.uint8).reshape(-1, H, W).astype(np.float32)
A = rd(ref); B = rd(clean)
n = min(len(A), len(B)); print('frames ref/clean', len(A), len(B))
A, B = A[:n], B[:n]
# global gain/offset match per frame (ref may be re-graded/limited range)
D = np.empty_like(A)
for i in range(n):
    a, b = A[i], B[i]
    p = np.polyfit(b.ravel(), a.ravel(), 1)
    D[i] = np.abs(a - (p[0] * b + p[1]))
np.save(out + '_D.npy', (D > 28).astype(np.uint8))
act = (D > 28).mean(2)  # frames x rows: fraction of active pixels per row
np.save(out + '_act.npy', act)
img = (np.clip(act.T * 6, 0, 1) * 255).astype(np.uint8)  # rows (y) x frames (x)
Image.fromarray(img).resize((n * 2, H * 2), Image.NEAREST).save(out + '_map.png')
print('saved', img.shape)
