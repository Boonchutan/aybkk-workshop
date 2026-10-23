import sys, json, eng23 as e
line, credit = 'The archer betting gold shoots worse than the one betting tiles.', 'Zhuangzi 19 · tr. Legge, 1891'
for n in sys.argv[1].split(','):
    lo, hi = e.t_range(n); ts = ['pad'] if lo > hi else sorted({t for t in list(range(0, 271, 30)) + [lo, hi] if lo <= t <= hi})
    out = []
    for t in ts:
        for tight in (False, True):
            fr = e.frame(n, t, None, tight); st = e.Stats(fr); nw = ns = 0
            for tw in (540, 720):
                bs = e.size_for('FOCUS', tw); wg = e.word_geom('FOCUS', bs)
                for xn, x in e.XS(fr, wg['w']):
                    for yn, y in e.ys(wg['asc'] + wg['desc'], fine=True):
                        if st.part((x, y, x + wg['w'], y + wg['asc'] + wg['desc']), 'w'): nw += 1
            for cw in e.CW:
                sg = e.sent_geom(line, credit, cw, lead_k=1.0)
                if not sg: continue
                for xn, x in e.XS(fr, sg['w']):
                    for yn, y in e.ys(sg['h'], fine=True):
                        if st.part((x, y, x + sg['w'], y + sg['h']), 's'): ns += 1
            out.append('%s%s:w%d/s%d' % (t, 'T' if tight else '', nw, ns))
    print(n, (lo, hi), ' '.join(out))
