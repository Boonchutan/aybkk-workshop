"""Per-piece grade measured on the ungraded piece. Flat clips (std < 40): levels stretch, black to 0.06, median to 0.40,
p99 to 0.80, white capped at 0.88. Others: midtone pull + highlight roll-off only if too bright (mean > 115 or p95 > 205)."""
import json, subprocess, numpy as np, imageio_ffmpeg, sys
FF = imageio_ffmpeg.get_ffmpeg_exe(); P = '/tmp/claude-0/-home-user-aybkk-workshop/5fef75e8-f96a-51ec-a2b6-837dec39c8e1/scratchpad/perf/'
plan = json.load(open(P + 'work/plan.json')); it = plan['items']
def luma(path):
    raw = subprocess.run([FF, '-loglevel', 'error', '-i', path, '-vf', 'fps=4,scale=180:-2,format=gray', '-f', 'rawvideo', '-'], capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).astype(float) / 255
def curve(pts): return "curves=master='" + ' '.join('%.3f/%.3f' % p for p in pts) + "'"
for i, x in enumerate(it):
    x.pop('eq', None); x.pop('look', None)
    y = luma(P + f'work/pieces/p{i:02d}.mp4')
    p1, med, p99, std = np.percentile(y, 1), np.median(y), np.percentile(y, 99), y.std() * 255
    if (std < 40 or x.get('stretch')) and not x.get('nostretch'):
        pts = [(0, 0), (max(p1, 0.01), x.get('black', 0.06)), (med, x.get('med', 0.40)), (min(p99, 0.97), 0.80), (1, 0.88)]
        pts = sorted(set(pts)); xs = [a for a, _ in pts]
        if all(b > a + 0.02 for a, b in zip(xs, xs[1:])):
            x['eq'] = curve(pts) + (',eq=saturation=%.2f' % x['sat'] if x.get('sat') else ''); print(i, x['n'], 'stretch', ['%.2f' % a for a in xs]); continue
    m, p95 = y.mean() * 255, np.percentile(y, 95) * 255
    if m > 115 or p95 > 205:
        best = 1.0
        for s in np.arange(1.0, 0.55, -0.02):
            ptsS = [(0, 0), (0.2, 0.2 * s), (0.5, 0.5 * s), (0.8, min(0.8 * s + 0.03, 0.78)), (1, 0.88)]
            z = np.interp(y, [a for a, _ in ptsS], [b for _, b in ptsS]) * 255
            best = ptsS
            if z.mean() <= 112 and np.percentile(z, 95) <= 200: break
        x['eq'] = curve(best); print(i, x['n'], 'pull', '%.2f' % (best[2][1] / 0.5))
json.dump(plan, open(P + 'work/plan.json', 'w'), indent=1)
