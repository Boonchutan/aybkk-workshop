# usage: qa_timing.py clean.mp4 out.mp4 spec.json  -> checks each caption turns on/off on the planned frame
import sys, json, subprocess, numpy as np
clean, out, specf = sys.argv[1:4]
spec = json.load(open(specf))
W, H = 360, 640
def rd(f):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', f, '-vf', f'scale={W}:{H}:flags=area,format=gray', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], capture_output=True).stdout
    return np.frombuffer(r, np.uint8).reshape(-1, H, W).astype(np.float32)
A, B = rd(out), rd(clean)
print('frames out/clean', len(A), len(B))
n = min(len(A), len(B)); D = np.abs(A[:n] - B[:n]) > 24
bad = 0
for e in spec['events']:
    lines = e['text'].count('\n') + 1
    hh = e['size'] * (W / H) * (0.42 * lines + 0.1)   # half height as fraction of H (core of glyphs)
    r0, r1 = int((e['cy'] - hh) * H), int((e['cy'] + hh) * H)
    c0, c1 = int(W * 0.30), int(W * 0.70)
    act = D[:, r0:r1, c0:c1].mean((1, 2))
    f0, f1 = e['f0'], min(e['f1'], n)
    inside = act[f0:f1]; thr = 0.25 * np.percentile(inside, 60)
    on = np.where(act > thr)[0]
    # first/last active frame within a window around the plan
    first = next((i for i in range(max(0, f0 - 15), f1) if act[i] > thr), None)
    before = act[max(0, f0 - 6):f0]
    after = act[f1:f1 + 6]
    shared = any(o['f1'] > f0 - 15 and o['f0'] < f0 and abs(o['cy'] - e['cy']) < 0.08 and o['id'] != e['id'] for o in spec['events'])
    ok_start = (first == f0) or e.get('anim') or shared
    ok_before = (len(before) == 0) or (before.max() < thr) or any(o['f1'] > f0 - 6 and o['f0'] < f0 and abs(o['cy'] - e['cy']) < 0.08 and o['id'] != e['id'] for o in spec['events'])
    ok_end = (len(after) == 0) or (after.max() < thr) or any(o['f0'] <= f1 + 6 and o['f1'] > f1 and abs(o['cy'] - e['cy']) < 0.08 and o['id'] != e['id'] for o in spec['events'])
    cover = (inside > thr).mean()
    flag = '' if (ok_start and ok_before and ok_end and cover > 0.9) else '  <-- CHECK'
    bad += bool(flag)
    print(f"{e['id']:4s} plan {f0}-{f1}  first_on {first}  cover {cover:.2f}  before_clear {bool(ok_before)}  after_clear {bool(ok_end)}{flag}")
print('PROBLEMS' if bad else 'ALL OK', bad)
