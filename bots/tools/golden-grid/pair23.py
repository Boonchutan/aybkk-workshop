import json, os, sys
from multiprocessing import Pool
import eng23 as e
W = os.environ['WD']; S = json.load(open(W + '/out/spec_all.json')); row = {s['word']: s for s in S}
pairs = [(w, p) for w in ('ZERO',) for p in ('23-114',)] + [(w, p) for w in ('SPORT', 'COOK', 'SKY') for p in ('23-048', '23-075', '23-205')] + [(w, p) for w in ('POTTER', 'QUALITY', 'SCORE') for p in ('23-134', '23-179', '23-188')]
def run(a):
    w, p = a; s = {k: row[w][k] for k in ('word', 'line', 'credit')}; s.update(photo=p, wmain=float(sys.argv[1]), tight=True)
    r = e.best(s)
    if not r: return w, p, None
    L = r[0]; return w, p, (round(L['score'], 2), L['t'], L['ws']['main'], L['ws']['person'], L['corner'], L['scorner'])
if __name__ == '__main__':
    with Pool(8) as pool:
        for w, p, v in pool.map(run, pairs): print(w.ljust(8), p, v)
