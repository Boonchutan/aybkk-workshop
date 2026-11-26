"""Talking-head cut list for The Perfectionist. Mic time -> video time = mic + OFF. Gaps longer than their target are shortened
by cutting the middle of the silence (tail kept after the last word, head kept before the next word). Cuts snap to video frames."""
import json
OFF = 0.7565
FPS = 30
S = '/tmp/claude-0/-home-user-aybkk-workshop/5fef75e8-f96a-51ec-a2b6-837dec39c8e1/scratchpad/perf/work/'
TARGET = {3.12: 0.75, 5.34: 0.5, 7.53: 0.75, 11.03: 0.55, 14.46: 0.55, 18.27: 0.4, 19.45: 0.55, 20.58: 0.5, 22.90: 0.6,
          25.26: 0.5, 27.17: 0.55, 31.37: 0.55, 33.47: 0.75, 37.41: 0.55, 40.52: 0.45, 43.33: 0.55, 45.23: 0.4, 47.66: 0.5,
          50.89: 0.7, 52.65: 0.6, 55.54: 0.75, 57.58: 0.4, 58.93: 0.45, 60.51: 0.5, 62.70: 0.5, 65.79: 0.75, 68.83: 0.55,
          70.93: 0.5, 73.97: 0.45, 74.96: 0.65, 78.16: 0.75, 80.30: 0.6, 81.78: 0.55}
START, END = 0.10, 84.30

def snap(mic_t):
    return round((mic_t + OFF) * FPS) / FPS - OFF

gaps = json.load(open(S + 'speech.json'))['gaps']
keep, cur = [], START
for g0, g1, d in gaps:
    k = round(g0, 2)
    tg = next((v for kk, v in TARGET.items() if abs(kk - k) < 0.03), None)
    if tg is None or d <= tg + 0.05: continue
    tail = min(0.25, 0.5 * tg); head = tg - tail
    a, b = snap(g0 + tail), snap(g1 - head)
    keep.append([round(snap(cur), 4), round(a, 4)]); cur = b
keep.append([round(snap(cur), 4), round(snap(END), 4)])
tot = sum(b - a for a, b in keep)
json.dump({'off': OFF, 'fps': FPS, 'keep_mic': keep}, open(S + 'cut.json', 'w'), indent=1)
print(len(keep), 'segments, output length %.2f s' % tot)
for a, b in keep: print('%6.3f-%6.3f (%.2f)' % (a, b, b - a))
