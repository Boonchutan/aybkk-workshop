# qa2.py <ch> : verify every caption state in the finished file starts and ends on its planned frame
import sys, json, subprocess, os, numpy as np
J = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
ch = sys.argv[1]; spec = json.load(open(f'{J}/{ch}.json'))
W, H = 360, 640
def rd(f):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', f, '-vf', f'scale={W}:{H}:flags=area,format=gray', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], capture_output=True).stdout
    return np.frombuffer(r, np.uint8).reshape(-1, H, W).astype(np.float32)
A = rd(os.path.join(J, spec['out'])); B = rd(os.path.join(J, spec['src']))
n = min(len(A), len(B)); print(ch, 'frames out/clean', len(A), len(B))
D = (np.abs(A[:n] - B[:n]) > 22)
area = D.reshape(n, -1).sum(1).astype(float)
# planned: number of visible characters per frame (0 = no caption)
import re
strip = lambda s: re.sub(r'\{(y|c|w|/)\}|\s', '', s)
plan = np.zeros(n)
for b in spec['blocks']:
    for s in b['states']:
        plan[s['f0']:min(n, s['f1'])] += len(strip(s['text']))
on_plan = plan > 0; on_real = area > 25
mism = np.where(on_plan != on_real)[0]
print('  frames where caption on/off differs from plan:', len(mism), mism[:20].tolist())
# every planned change in visible character count should show as a change in lit area on that exact frame
chg = [f for f in range(1, n) if plan[f] != plan[f - 1]]
bad = []
for f in chg:
    d = abs(area[f] - area[f - 1]); base = np.abs(np.diff(area[max(1, f - 4):f])).max() if f > 5 else 0
    if d < max(12, 2.0 * base) and not (plan[f] > 0 and plan[f - 1] > 0 and abs(plan[f] - plan[f - 1]) == 0): bad.append((f, int(plan[f - 1]), int(plan[f]), int(area[f - 1]), int(area[f])))
print('  planned changes:', len(chg), '| not clearly seen on the exact frame:', len(bad), bad[:12])
