# Largest serif layout that fits a given empty box; writes force entries.
import json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import r17
P = json.load(open('lines.json')); A = json.load(open('assign15.json'))
def fit(slot, box):
    k, i = slot[0], int(slot[1:]); L0 = P[k]['lines'][i]; x0, y0, x1, y1 = box; bw, bh = x1 - x0, y1 - y0
    best = None
    for s in list(r17.SIZES) + [38, 36, 34]:
        for w in range(min(bw, 1000), 200, -20):
            L = r17.layout(L0['line'], s, w, L0['credit'])
            if L['tw'] <= bw and L['h'] <= bh and len(L['lines']) <= int(os.environ.get('MAXL', '6')):
                score = (s, -sum(len(t.split()) == 1 for t in L['lines']), -len(L['lines']))
                if best is None or score > best[0]: best = (score, [s, w, x0, y0], L['lines'], L['h'], L['tw'])
        if best and best[0][0] == s: break
    return best
if __name__ == '__main__':
    boxes = json.load(open(sys.argv[1])); F = json.load(open('force17.json'))
    for slot, box in boxes.items():
        b = fit(slot, box); p = A[slot]
        if not b: print(slot, p, 'NO FIT'); continue
        F[p] = b[1]; print(slot, p, b[1], 'h', b[3], 'tw', b[4], b[2])
    json.dump(F, open('force17.json', 'w'))
