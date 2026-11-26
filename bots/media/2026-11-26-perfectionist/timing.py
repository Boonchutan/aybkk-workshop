"""Fix box timing: hide A-roll jump cuts under boxes and close short bare-face gaps between boxes."""
import json, sys
P = '/tmp/claude-0/-home-user-aybkk-workshop/5fef75e8-f96a-51ec-a2b6-837dec39c8e1/scratchpad/perf/work/'
keep = json.load(open(P + 'cut.json'))['keep_mic']
cuts, acc = [], 0
for a, b in keep[:-1]:
    acc += round((b - a) * 30) / 30; cuts.append(round(acc, 4))
plan = json.load(open(sys.argv[1])); it = plan['items']
for x in it:
    s, e = x['out'], x['out'] + x['dur']
    for c in cuts:
        if s - 0.22 <= c <= s + 0.25:          # cut right after the box starts: start the box before the cut
            d = s - (c - 0.17); x['src'] = round(x['src'] - d, 3); s = c - 0.17
        if x['box'] == 'head':
            if e - 0.25 <= c <= e + 0.4:    # head box hides the face: hold it until just after the cut
                e = c + 0.17
        elif e - 0.25 <= c <= e + 0.22:     # chest box cannot hide the face: start its fade on the cut frame
            e = c + 0.13
    x['out'], x['dur'] = round(s, 3), round(e - s, 3)
for a, b in zip(it, it[1:]):
    gap = b['out'] - (a['out'] + a['dur'])
    if gap < 0.6: a['dur'] = max(a['dur'], round(b['out'] + 0.13 - a['out'], 3))
for x in it:
    x['end'] = round(x['out'] + x['dur'], 3)
    near = [c for c in cuts if x['out'] - 0.3 < c < x['end'] + 0.3]
    print('%-20s %6.2f-%6.2f src %.2f  cuts near: %s' % (x['n'], x['out'], x['end'], x['src'], near))
json.dump(plan, open(sys.argv[2], 'w'), indent=1)
bare = []
prev = 0
for x in it:
    if 0 < x['out'] - prev < 0.6 and prev > 0: bare.append((round(prev, 2), x['out']))
    prev = x['end']
print('short bare-face gaps left:', bare)
print('a-roll cuts:', cuts)
