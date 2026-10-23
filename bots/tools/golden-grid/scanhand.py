# find any clean sentence spot (fine x/y grid, smaller sizes, tight margins), then the best word spot apart from it
import sys, json, eng23 as e
n, t, line, credit, word = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
t = t if t == 'pad' else int(t); widths = [int(v) for v in sys.argv[6].split(',')] if len(sys.argv) > 6 else [540, 720]
res = []
for tight in (False, True):
    fr = e.frame(n, t, None, tight); st = e.Stats(fr)
    S = []
    for sz in (38, 40, 42, 44, 46):
        for cw in range(280, 660, 40):
            sg = e.sent_geom(line, credit, cw, lead_k=1.0, sz=sz)
            if not sg: continue
            for x in range(fr['L'], int(fr['R'] - sg['w']) + 1, 20):
                for y in range(30, int(1300 - sg['h']), 10):
                    p = st.part((x, y, x + sg['w'], y + sg['h']), 's')
                    if p: S.append((p[0] + sg['pen'] + (46 - sz) * 0.03, sz, cw, x, y, sg, p))
    S.sort(key=lambda r: r[0]); S = S[:200]
    Wd = []
    for tw in widths:
        bs = e.size_for(word, tw); wg = e.word_geom(word, bs); h = wg['asc'] + wg['desc']
        for x in range(fr['L'], int(fr['R'] - wg['w']) + 1, 20):
            for y in range(30, int(1300 - h), 10):
                p = st.part((x, y, x + wg['w'], y + h), 'w')
                if p: Wd.append((p[0], tw, x, y, wg, p))
    Wd.sort(key=lambda r: r[0]); Wd = Wd[:300]
    for ws in Wd:
        wr = (ws[2], ws[3], ws[2] + ws[4]['w'], ws[3] + ws[4]['asc'] + ws[4]['desc'])
        for ss in S:
            sr = (ss[3], ss[4], ss[3] + ss[5]['w'], ss[4] + ss[5]['h'])
            if not (wr[2] + 40 < sr[0] or sr[2] + 40 < wr[0] or wr[3] + 40 < sr[1] or sr[3] + 40 < wr[1]): continue
            res.append((round(ws[0] + ss[0], 2), tight, ws[1], ws[2], ws[3], ws[5][1], round(ws[5][2]['person'], 2), ss[1], ss[2], ss[3], ss[4], ss[6][1], len(ss[5]['sl'])))
res.sort(); print(len(res))
for r in res[:8]: print(r)
