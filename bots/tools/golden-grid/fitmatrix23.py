# score every (line, photo) pair in one post: python fitmatrix.py spec.json out.json
import os, sys, json
from multiprocessing import Pool
import importlib; e = importlib.import_module(os.environ.get('ENG', 'eng20f'))
spec = json.load(open(sys.argv[1])); photos = [s['photo'] for s in spec]
OPTS = json.load(open(os.environ['OPTS'])) if os.environ.get('OPTS') else {}
def run(args):
    i, p = args
    s = {k: spec[i][k] for k in ('word', 'line', 'credit')}; s['photo'] = p
    s.update(OPTS.get(p, {}))
    r = e.best(s)
    return i, p, (round(r[0]['score'], 2) if r else None)
if __name__ == '__main__':
    onlyp = os.environ.get('ONLYP', '').split(',') if os.environ.get('ONLYP') else photos
    jobs = [(i, p) for i in range(len(spec)) for p in photos if p in onlyp]
    with Pool(8) as pool: res = pool.map(run, jobs)
    M = json.load(open(sys.argv[2])) if (os.environ.get('ONLYP') and os.path.exists(sys.argv[2])) else {}
    for i, p, sc in res: M.setdefault(str(i), {})[p] = sc
    json.dump(M, open(sys.argv[2], 'w'), indent=1)
    for i in range(len(spec)): print(i + 1, spec[i]['word'].ljust(10), ' '.join(f"{(M[str(i)][p] if M[str(i)][p] is not None else 'X'):>5}" for p in photos))
    print('photos', photos)
