# Photos to slides: low text cost, random-looking mix, never the same person on two slides in a row.
import json, os, sys
import numpy as np
from scipy.optimize import linear_sum_assignment
D = os.path.dirname(os.path.abspath(__file__))
C = json.load(open(os.path.join(D, 'cost15.json')))
G = json.load(open(os.path.join(D, 'groups15.json')))
OV = json.load(open(os.path.join(D, 'assign_override.json'))) if os.path.exists(os.path.join(D, 'assign_override.json')) else {}
EX = json.load(open(os.path.join(D, 'exclude15.json'))) if os.path.exists(os.path.join(D, 'exclude15.json')) else []
photos = [p for p in sorted(C) if p not in EX]; KEYS = sorted(json.load(open(os.path.join(D, 'lines.json')))); slots = [f'{k}{i}' for k in KEYS for i in range(10)]

def cost(s, p):
    if p is None: return 50.0 if s[1] in '09' else 3.0
    v = C[p][s]
    if not v: return 99.0
    return v[0] + (10 if (s[1] in '09' and v[6]) else 0)
rng = np.random.default_rng(int(sys.argv[1]) if len(sys.argv) > 1 else 15)
# Boonchu 16 Oct: every post mixes early and late class photos. Each post gets the 10 time-deciles in a shuffled order.
rank = {p: i for i, p in enumerate(sorted(photos, key=lambda p: int(p.split('-')[1])))}
dec = {p: min(9, rank[p] * 10 // len(photos)) for p in photos}
target = {}
for k in KEYS:
    for i, d in enumerate(rng.permutation(10)): target[f'{k}{i}'] = int(d)
TW = 1.0
M = np.array([[cost(s, p) + TW * abs(dec[p] - target[s]) + rng.uniform(0, 0.25) for p in photos] for s in slots])
for s, p in OV.items(): M[slots.index(s), :] += 50; M[slots.index(s), photos.index(p)] -= 50
r, c = linear_sum_assignment(M)
A = {s: None for s in slots}
A.update({slots[i]: photos[j] for i, j in zip(r, c)})
def bad(A):
    out = []
    for k in KEYS:
        for i in range(9):
            a, b = A[f'{k}{i}'], A[f'{k}{i+1}']
            if a and b and any(a in g and b in g for g in G): out.append(f'{k}{i+1}')
        for g in G:
            hits = [f'{k}{i}' for i in range(10) if A[f'{k}{i}'] in g]
            out += hits[2:]
    return out
for _ in range(200):
    v = bad(A)
    if not v: break
    s = v[0]; best = None
    for t in slots:
        if t == s or t in OV or s in OV: continue
        B = dict(A); B[s], B[t] = A[t], A[s]
        if len(bad(B)) >= len(v): continue
        d = cost(s, B[s]) + cost(t, B[t]) - cost(s, A[s]) - cost(t, A[t])
        if best is None or d < best[0]: best = (d, B)
    if best is None: break
    A = best[1]
tot = sum(cost(s, A[s]) for s in slots)
print('empty slot:', [s for s in slots if A[s] is None])
for k in KEYS: print(k, 'time deciles', sorted(dec[A[f'{k}{i}']] for i in range(10) if A[f'{k}{i}']))
print('violations', bad(A), 'total', round(tot, 2), 'worst', sorted(((round(cost(s, A[s]), 2), s, A[s]) for s in slots))[-6:])
json.dump(A, open(os.path.join(D, 'assign15.json'), 'w'), indent=1)
