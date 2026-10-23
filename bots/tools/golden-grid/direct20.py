# Render one slide with fully hand-set positions (no search): python direct20.py spec.json N out.jpg
import sys, json, os
import importlib; e = importlib.import_module(os.environ.get('ENG', 'eng20f'))
s = json.load(open(sys.argv[1]))[int(sys.argv[2]) - 1]
fr = e.frame(s['photo'], s['t'], s.get('wm'), s.get('tight', False), s.get('wmxy'), s.get('wmk', 1.0))
bs = e.size_for(s['word'], s['wwidth']); wg = e.word_geom(s['word'], bs)
x, y = s['wpos']; x = fr['L'] if x == 'L' else (fr['R'] - wg['w'] if x == 'R' else x); wr = (x, y, x + wg['w'], y + wg['asc'] + wg['desc'])
sg = e.sent_geom(s.get('line_br', s['line']), s['credit'], s['cws'][0], lead_k=1.0, sz=s.get('sz', e.SENT))
sx, sy = s['sxy']; sx = fr['R'] - sg['w'] if sx == 'R' else sx; sr = (sx, sy, sx + sg['w'], sy + sg['h'])
st = e.Stats(fr)
for nm, r, k in (('word', wr, 'w'), ('sent', sr, 's')): print(nm, [round(v) for v in r], st.part(r, k, False))
L = dict(kind='split', wr=wr, sr=sr, bs=bs, wg=wg, sg=sg, wink=s.get('ink_w', 'light'), sink=s.get('ink_s', 'light'), right=False, sright=s.get('sright', False), fr=fr)
e.render(L, s['word'], shadow=s.get('shadow', 1.0)).save(sys.argv[3], quality=93)
print('saved', bs, round(wg['w']))
