# Put 30 photos on 30 slides (3 carousels x 10): python assign23.py spec_all.json fit.json people.json out.json
# cost = layout score (cover x1.6) + person rules + class-time mix, solved by simulated annealing from many starts
import sys, json, math, random
spec = json.load(open(sys.argv[1])); M = json.load(open(sys.argv[2])); P = json.load(open(sys.argv[3]))
N = len(spec); photos = sorted({p for r in M.values() for p in r}); K = N // 10
groups = [set(g['ids']) for g in P['groups']]
big_group = max(range(len(groups)), key=lambda i: len(groups[i])) if groups else -1   # the adjusting teacher may need 3 in one post
rank = {p: i for i, p in enumerate(sorted(photos, key=lambda p: int(p.split('-')[1])))}
decile = {p: rank[p] * 10 // len(photos) for p in photos}
AVOID_COVER = set(sys.argv[5].split(',')) if len(sys.argv) > 5 and sys.argv[5] else set()
def sc(i, p):
    v = M[str(i)].get(p); base = 50.0 if v is None else v
    return base * (1.6 if i % 10 == 0 else 1.0) + (3.0 if (i % 10 == 0 and p in AVOID_COVER) else 0)
def post_cost(sl):
    c = 0.0
    for gi, g in enumerate(groups):
        n = sum(1 for p in sl if p in g)
        if n > 2: c += 1.5 if (gi == big_group and n == 3) else 4.0 * (n - 2)
        for a, b in zip(sl, sl[1:]):
            if a in g and b in g: c += 6.0
    ds = [decile[p] for p in sl]; c += 0.6 * (len(ds) - len(set(ds)))
    return c
def total(A):
    return sum(sc(i, p) for i, p in enumerate(A)) + sum(post_cost(A[k * 10:(k + 1) * 10]) for k in range(K))
best = None
for seed in range(25):
    random.seed(seed); A = photos[:]; random.shuffle(A); cur = total(A); T = 3.0
    for it in range(40000):
        i, j = random.randrange(N), random.randrange(N)
        if i == j: continue
        A[i], A[j] = A[j], A[i]; nc = total(A)
        if nc <= cur or random.random() < math.exp((cur - nc) / T): cur = nc
        else: A[i], A[j] = A[j], A[i]
        T = max(0.02, T * 0.9998)
    if best is None or cur < best[0]: best = (cur, A[:])
cost, A = best
out = [dict(slot=i + 1, post='ABC'[i // 10], n=i % 10 + 1, photo=p, score=M[str(i)].get(p), word=spec[i]['word']) for i, p in enumerate(A)]
json.dump(dict(cost=round(cost, 2), slots=out), open(sys.argv[4], 'w'), indent=1)
print('cost', round(cost, 2))
for k in range(K):
    sl = A[k * 10:(k + 1) * 10]; print('ABC'[k], 'person-cost', round(post_cost(sl), 2))
    for i in range(k * 10, (k + 1) * 10): print('  ', i % 10 + 1, spec[i]['word'].ljust(10), A[i], M[str(i)].get(A[i]), 'dec', decile[A[i]], [gi for gi, g in enumerate(groups) if A[i] in g])
