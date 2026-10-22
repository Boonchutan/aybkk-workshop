# Oct 20 magazine engine v2 (rules locked 18 Oct). Full width, the 4:5 window only moves up or down, the whole student stays in
# frame (white bars only as wide as needed when a crop would cut them). Big Nimbus word + Instrument Serif sentence + caps credit,
# stacked or split, snapped to the golden grid, on the calmest brightest or darkest area. Never on faces, hands or the main feet.
import os, sys, json, importlib.util
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage
GD = os.path.dirname(os.path.abspath(__file__)); WD = os.environ['WD']
spec = importlib.util.spec_from_file_location('c18', os.path.join(WD, 'crop18_lib.py')); c18 = importlib.util.module_from_spec(spec); spec.loader.exec_module(c18)
W, H, M = 1080, 1350, 60
GX, GY = (413, 667), (516, 834)
LIGHT, DARK, SHADOW, GLOW = (250, 248, 243), (30, 30, 30), (40, 40, 40), (255, 255, 255)
SENT, CRED = 54, 22
TRK_BIG, TRK_CRED = -0.035, 0.14
SIZES = (288, 178, 110)
TARGET_W = (720, 540)   # Boonchu 21 Oct: the big word is exactly 1/2 or 2/3 of the slide width
def size_for(word, width): return max(20, round(width / tlen(word, F('Bold', 100), TRK_BIG) * 100))
def size_pen(wg): return 0.0 if wg['w'] > 700 else 0.35
ZONES = {z['id']: z for z in json.load(open(os.path.join(WD, 'zones20.json')))}
_FC = {}
def F(w, s):
    if (w, s) not in _FC: _FC[w, s] = ImageFont.truetype(os.path.join(GD, 'fonts', 'InstrumentSerif-Italic.ttf' if w == 'Serif' else f'NimbusSans-{w}.otf'), s)
    return _FC[w, s]
CJK = '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'   # Chinese and Japanese in credits (Nimbus has no CJK glyphs)
def _cjk(ch): return ord(ch) >= 0x2E80
def _fc(f, ch):
    if not _cjk(ch): return f
    k = ('CJK', f.size)
    if k not in _FC: _FC[k] = ImageFont.truetype(CJK, f.size)
    return _FC[k]
def tlen(t, f, trk):
    if not any(_cjk(c) for c in t): return f.getlength(t) + trk * f.size * max(0, len(t) - 1)
    return sum(_fc(f, c).getlength(c) for c in t) + trk * f.size * max(0, len(t) - 1)
def ttext(d, xy, t, f, trk, fill):
    x, y = xy; mixed = any(_cjk(c) for c in t)
    for i, ch in enumerate(t):
        d.text((x, y), ch, font=_fc(f, ch), fill=fill, anchor='ls')
        x += (_fc(f, ch).getlength(ch) if mixed else f.getlength(t[:i + 1]) - f.getlength(t[:i])) + trk * f.size
WEAK = {'a', 'an', 'the', 'of', 'to', 'and', 'in', 'on', 'at', 'for', 'but', 'so', 'or'}
def _greedy(words, f, width):
    out, cur = [], []
    for w in words:
        if not cur or f.getlength(' '.join(cur + [w])) <= width: cur.append(w)
        else:
            if len(cur) > 1 and cur[-1].lower() in WEAK: out.append(' '.join(cur[:-1])); cur = [cur[-1], w]
            else: out.append(' '.join(cur)); cur = [w]
    return out + [' '.join(cur)]
def wrap(text, f, width):
    words = text.split(); best = _greedy(words, f, width)
    if len(best) < 2: return best
    lo, hi = width * 0.55, width          # narrowest width that keeps the same line count = balanced lines
    for _ in range(14):
        mid = (lo + hi) / 2; tr = _greedy(words, f, mid)
        if len(tr) == len(best) and max(f.getlength(x) for x in tr) <= width: hi = mid
        else: lo = mid
    cand = _greedy(words, f, hi)
    if len(cand) == len(best) and max(f.getlength(x) for x in cand) <= width: best = cand
    return best
def smart(t):
    out = []
    for i, ch in enumerate(t):
        if ch == "'":
            prev = t[i - 1] if i else ' '
            out.append('\u2019' if prev.isalnum() or prev in '.,!?' else '\u2018')
        else: out.append(ch)
    return ''.join(out)
_BIG = {}
def big(n):
    if n not in _BIG: _BIG[n] = np.asarray(Image.open(os.path.join(WD, 'full', n + '.jpg')).convert('RGB')).copy()
    return _BIG[n]
def boxes(n, keys, who=None):
    return [b for k in keys for b in ZONES[n].get(k, []) if who is None or b.get('who', 'main') == who]
def body_span(n):
    bx = boxes(n, ['main_body']) + boxes(n, ['faces', 'hands', 'feet'], 'main')
    return min(b['y0'] for b in bx), max(b['y1'] for b in bx)
def t_range(n):
    top, bot = body_span(n)
    for gap in (28, 12):   # the gap can never be more than the photographer left
        lo, hi = max(0, min(1620, bot + gap) - 1350), min(270, max(0, top - gap))
        if lo <= hi: break
    return lo, hi
def pad_geom(n):
    ytop = max(0, body_span(n)[0] - 28); k = H / (1620 - ytop); pw = round(W * k)
    return ytop, k, (W - pw) // 2, pw

# watermark text sits at x 360-720, y 1450-1530 of the 1080x1620 photo (inside the band WX0..WX1, WY0..WY1)
FR_ = {}
def frames_of(n):
    if not FR_:
        p = os.path.join(WD, 'frames20.json')
        if os.path.exists(p):
            for z in json.load(open(p)): FR_[z['id']] = z['items']
    return FR_.get(n, [])
_CLEAN = {}
def clean(n):
    if n not in _CLEAN:
        B = big(n); reg = B[c18.WY0:c18.WY1, c18.WX0:c18.WX1].copy(); a = c18.wm_alpha(reg)
        mm = np.zeros(B.shape[:2], np.uint8)
        mm[c18.WY0:c18.WY1, c18.WX0:c18.WX1] = cv2.dilate((a > 0.05).astype(np.uint8), np.ones((7, 7), np.uint8)) * 255
        _CLEAN[n] = (cv2.inpaint(B, mm, 5, cv2.INPAINT_TELEA), reg, a)
    return _CLEAN[n]

def frame(n, t, wm=None, tight=False, wmxy=None):
    """t = int (crop window top in the 1080x1620 photo) or 'pad'. Returns the slide photo and its masks."""
    B = big(n)
    if t == 'pad':
        ytop, k, px, pw = pad_geom(n)
        tf = lambda x, y: (px + x * k, (y - ytop) * k); L, R = max(M, px + 44), min(W - M, px + pw - 44)
        def build(src):
            img = np.full((H, W, 3), 255, np.uint8); img[:, px:px + pw] = np.asarray(Image.fromarray(src[ytop:]).resize((pw, H), Image.LANCZOS)); return img
        orig_r = (px + 360 * k, (1450 - ytop) * k, px + 720 * k, (1530 - ytop) * k)
    else:
        tf = lambda x, y: (x, y - t); L, R = M, W - M; px, pw = 0, W
        build = lambda src: src[t:t + H].copy()
        orig_r = (360, 1450 - t, 720, 1530 - t) if t >= 185 else None
    fp, hp = (20, 20) if tight else (30, 30)   # tight: the old margins, only for very crowded frames
    crit = paint(boxes(n, ['faces']), tf, fp, top_extra=0 if tight else 30) | paint(boxes(n, ['hands']), tf, hp) | paint([f for f in frames_of(n) if f['kind'] in ('portrait_of_teacher', 'statue_or_deity', 'framed_picture')], tf, 6)
    feet_m = paint(boxes(n, ['feet'], 'main'), tf, 26); feet_b = paint(boxes(n, ['feet'], 'background'), tf, 20)
    keep = crit | feet_m | feet_b      # the watermark may not sit on any of these either
    def hit(r, pad=8):
        a_ = keep[max(0, int(r[1]) - pad):min(H, int(r[3]) + pad), max(0, int(r[0]) - pad):min(W, int(r[2]) + pad)]
        return a_.size > 0 and a_.mean() > 0.0
    if orig_r is not None and wm in (None, 'orig') and not wmxy and not hit(orig_r):
        img = build(B); wmode = 'orig'; wmr = orig_r
    else:
        src, reg, a = clean(n); img = build(src)
        main = paint(boxes(n, ['main_body']), tf, 0); g = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY).astype(np.float32)
        xs = {'center': (W - 360) // 2, 'left': max(M, px + 30), 'right': min(W - M, px + pw - 30) - 360}
        opts = []
        for xn, x0 in xs.items():
            for yi, y0 in enumerate((1180, 1215, 1250)):
                r = (x0, y0, x0 + 360, y0 + 80)
                if wm and wm not in ('orig', xn): continue
                sl = (slice(y0, y0 + 80), slice(x0, x0 + 360))
                c = (10 if hit(r) else 0) + 2 * main[sl].mean() + 0.6 * float(g[sl].mean()) / 255 + 0.08 * yi + (0 if xn == 'center' else 0.12)
                opts.append((c, xn, r))
        c, wmode, wmr = min(opts)
        if wmxy: wmode, wmr = 'hand', (wmxy[0], wmxy[1], wmxy[0] + 360, wmxy[1] + 80)
        tx, ty = int(wmr[0]), int(wmr[1])
        # soft dark backing so the thin lines read on a light floor (the original has the photographer's dark gradient)
        lum = float(g[ty:ty + 80, tx:tx + 360].mean()); strength = float(np.clip((lum - 60) / 110, 0, 1)) * 0.5
        if strength > 0:
            m = np.zeros((H, W), np.float32); m[ty - 22:ty + 102, tx - 40:tx + 400] = 1; m = cv2.GaussianBlur(m, (0, 0), 26) * strength
            img = (img.astype(np.float32) * (1 - m[..., None])).astype(np.uint8)
        ox, oy = tx - 140, ty - 65; ra, aa = reg, a
        if ox < 0: ra, aa = ra[:, -ox:], aa[:, -ox:]; ox = 0
        if ox + ra.shape[1] > W: ra, aa = ra[:, :W - ox], aa[:, :W - ox]
        if oy + ra.shape[0] > H: ra, aa = ra[:H - oy], aa[:H - oy]
        dst = img[oy:oy + ra.shape[0], ox:ox + ra.shape[1]].astype(np.float32); A = aa[..., None]
        img[oy:oy + ra.shape[0], ox:ox + ra.shape[1]] = (dst * (1 - A) + np.full_like(dst, 248) * A).astype(np.uint8)
    im = Image.fromarray(img)
    person = np.zeros((H, W), bool); person[:, px:px + pw] = ndimage.binary_dilation(c18.mask(im.crop((px, 0, px + pw, H)), (pw, H)), iterations=8)
    mainb = person & paint(boxes(n, ['main_body']), tf, 10)
    wmm = np.zeros((H, W), bool); wmm[max(0, int(wmr[1]) - 24):int(wmr[3]) + 20, max(0, int(wmr[0]) - 24):int(wmr[2]) + 24] = True
    if t == 'pad': wmm[:, :px + 20] = True; wmm[:, px + pw - 20:] = True
    return dict(img=im, person=person, main=mainb, crit=crit, feet=feet_m, bfeet=feet_b, wm=wmm, L=L, R=R, t=t, wmode=wmode)

def paint(bl, tf, pad, top_extra=0):
    m = np.zeros((H, W), bool)
    for b in bl:
        x0, y0 = tf(b['x0'], b['y0']); x1, y1 = tf(b['x1'], b['y1'])
        y0, y1 = max(0, int(y0) - pad - top_extra), min(H, int(y1) + pad)
        if y1 > y0: m[y0:y1, max(0, int(x0) - pad):min(W, int(x1) + pad)] = True
    return m

class Stats:
    def __init__(self, fr):
        g = np.asarray(fr['img'].convert('L'), np.float64)
        arrs = dict(g=g, g2=g * g, bd=(g < 125), bl=(g > 155), p=fr['person'], m=fr['main'], c=fr['crit'], f=fr['feet'] | fr['bfeet'], w=fr['wm'])
        self.I = {k: np.pad(np.asarray(v, np.float64).cumsum(0).cumsum(1), ((1, 0), (1, 0))) for k, v in arrs.items()}
    def mean(self, k, r):
        x0, y0, x1, y1 = [int(round(v)) for v in r]; x0, y0, x1, y1 = max(0, x0), max(0, y0), min(W, x1), min(H, y1)
        if x1 <= x0 or y1 <= y0: return 1.0
        I = self.I[k]; return (I[y1, x1] - I[y0, x1] - I[y1, x0] + I[y0, x0]) / ((x1 - x0) * (y1 - y0))
    def part(self, r, kind, allow_feet=False):
        r = (r[0] - 14, r[1] - 12, r[2] + 14, r[3] + 12)
        if r[0] < 20 or r[1] < 20 or r[2] > W - 20 or r[3] > H - 20: return None
        if self.mean('c', r) > 0.001 or self.mean('w', r) > 0.0: return None
        fp = self.mean('f', r)
        if fp > 0.001 and not allow_feet: return None
        bd, bl = self.mean('bd', r), self.mean('bl', r); ink = 'dark' if bd < bl else 'light'; bad = min(bd, bl)
        mu = self.mean('g', r); std = max(0.0, self.mean('g2', r) - mu * mu) ** .5; pf = self.mean('p', r); mf = self.mean('m', r)
        ring = self.mean('m', (r[0] - 30, r[1] - 30, r[2] + 30, r[3] + 30))
        tangent = 0.6 if (mf < 0.01 and ring > 0.006) else 0          # text that just touches a body looks like an accident
        s = (3 * bad + std / 90 + 0.6 * pf + 2.5 * mf) if kind == 'w' else (5 * bad + std / 45 + 1.0 * pf + 2.0 * mf)
        s += tangent
        return s + fp * 6, ink, dict(bad=round(bad, 3), std=round(std, 1), person=round(pf, 2), main=round(mf, 2), feet=round(fp, 3), mean=round(mu))

def word_geom(word, bs):
    fb = F('Bold', bs); l, t, r, b = fb.getbbox(word, anchor='ls')
    return dict(w=tlen(word, fb, TRK_BIG), asc=-t, desc=max(0, b), bs=bs)
def sent_geom(line, credit, cw, lead_k=1.12, sz=SENT):
    fs, fc = F('Serif', sz), F('Bold', CRED)
    sl = wrap(smart(line), fs, cw); cr = credit.upper()
    cl = [cr] if tlen(cr, fc, TRK_CRED) <= cw else [p.strip() for p in cr.split('·')]
    cl2 = []
    for c in cl:   # a credit part still too long for the column wraps by words
        cur = ''
        for w in c.split():
            t = (cur + ' ' + w).strip()
            if tlen(t, fc, TRK_CRED) <= cw or not cur: cur = t
            else: cl2.append(cur); cur = w
        cl2.append(cur)
    cl = cl2
    if any(tlen(c, fc, TRK_CRED) > cw for c in cl) or any(fs.getlength(x) > cw for x in sl): return None
    lead = round(sz * lead_k); asc = round(sz * 0.78)
    base = [asc + i * lead for i in range(len(sl))]; cy = base[-1] + 26 + CRED
    cbase = [cy + j * round(CRED * 1.7) for j in range(len(cl))]
    w = max([fs.getlength(x) for x in sl] + [tlen(c, fc, TRK_CRED) for c in cl])
    pen = 0.25 * max(0, len(sl) - 4) + 0.3 * max(0, len(cl) - 2)    # tall thin columns and ragged credits look messy
    return dict(sl=sl, cl=cl, base=base, cbase=cbase, h=cbase[-1] + 8, w=w, cw=cw, sz=sz, pen=pen)

def XS(fr, w):
    out = [('L', fr['L']), ('R', fr['R'] - w)]
    if GX[0] + w <= fr['R']: out.append(('G0', GX[0]))
    if GX[1] - w >= fr['L']: out.append(('G1r', GX[1] - w))
    if GX[0] - w >= fr['L']: out.append(('G0r', GX[0] - w))
    if GX[1] + w <= fr['R']: out.append(('G1', GX[1]))
    return out
def ys(h, fine=False):
    out = [('top', M), ('g1', GY[0]), ('g2', GY[1]), ('g1b', GY[0] - h), ('g2b', GY[1] - h), ('bot', 1120 - h), ('foot', H - M - h)]
    if fine: out += [('b%d' % y, y) for y in range(M + 52, H - M - int(h), 52)]   # baseline grid, used when the golden lines are all blocked
    return out
def corner(x, w, y, h): return ('top' if y + h / 2 < H / 2 else 'bottom') + '-' + ('left' if x + w / 2 < W / 2 else 'right')
CW = (607, 587, 560, 500, 413, 353)

def layouts(fr, st, word, line, credit, allow_feet=False, want=None):
    out = []; want = want or {}; SZ = want.get('sz', SENT)
    WG = {}
    for tw in want.get('widths', TARGET_W):
        bs = size_for(word, tw); WG[bs] = word_geom(word, bs)
    # stacked: word on top of the sentence or under it, one column, one alignment
    CWS = want.get('cws', CW)
    for cw in CWS:
        sg = sent_geom(line, credit, cw, sz=SZ)
        if not sg: continue
        for bs in WG:
            wg = WG[bs]
            if wg['w'] > fr['R'] - fr['L']: continue
            for order in ('word_top', 'sent_top'):
                if order == 'word_top': wy, sy = 0, wg['asc'] + wg['desc'] + 26; h = sy + sg['h']
                else: sy = 0; wy = sg['h'] + 18; h = wy + wg['asc'] + wg['desc'] + 8
                bw = max(wg['w'], sg['w'])
                for xn, x in XS(fr, bw):
                    for yn, y in ys(h):
                        right = xn in ('R', 'G1r', 'G0r'); xe = x + bw
                        wx = xe - wg['w'] if right else x; sx = xe - sg['w'] if right else x
                        wr = (wx, y + wy, wx + wg['w'], y + wy + wg['asc'] + wg['desc'])
                        sr = (sx, y + sy, sx + sg['w'], y + sy + sg['h'])
                        a = st.part(wr, 'w', allow_feet); b = a and st.part(sr, 's', allow_feet)
                        if not b: continue
                        c = corner(x, bw, y, h)
                        if want.get('pos') and c != want['pos']: continue
                        sc = sg['pen'] + a[0] + b[0] + size_pen(wg) + (0.4 if a[1] != b[1] else 0)
                        out.append(dict(kind='stack', score=sc, wr=wr, sr=sr, bs=bs, wink=a[1], sink=b[1], right=right, sg=sg, wg=wg, corner=c, scorner=c, cw=cw, order=order, x=xn, y=yn, ws=a[2], ss=b[2]))
    # split: big word in one place, dense sentence in another
    if want.get('layout') == 'split': out = []
    if want.get('layout') != 'stack':
        W_ = []
        for bs in WG:
            wg = WG[bs]
            for xn, x in XS(fr, wg['w']):
                for yn, y in ys(wg['asc'] + wg['desc'], fine=True):
                    wr = (x, y, x + wg['w'], y + wg['asc'] + wg['desc']); a = st.part(wr, 'w', allow_feet)
                    if a: W_.append((a[0] + size_pen(wg) + (0.15 if yn.startswith('b') else 0), wr, bs, a, corner(x, wg['w'], y, wr[3] - wr[1]), xn in ('R', 'G1r', 'G0r')))
        S_ = []
        for cw in CWS:
            sg = sent_geom(line, credit, cw, lead_k=1.0, sz=SZ)
            if not sg: continue
            for xn, x in XS(fr, sg['w']):
                for yn, y in ys(sg['h'], fine=True):
                    sr = (x, y, x + sg['w'], y + sg['h']); b = st.part(sr, 's', allow_feet)
                    if b: S_.append((b[0] + sg['pen'] + (0.15 if yn.startswith('b') else 0), sr, sg, b, corner(x, sg['w'], y, sg['h']), xn in ('R', 'G1r', 'G0r')))
        W_.sort(key=lambda r: r[0]); S_.sort(key=lambda r: r[0])
        for wsc, wr, bs, a, wc, wright in W_[:40]:
            for ssc, sr, sg, b, sc_, sright in S_[:60]:
                if not (wr[2] + 50 < sr[0] or sr[2] + 50 < wr[0] or wr[3] + 60 < sr[1] or sr[3] + 60 < wr[1]): continue
                if wc == sc_: continue
                if want.get('pos') and wc != want['pos']: continue
                if want.get('spos') and sc_ != want['spos']: continue
                out.append(dict(kind='split', score=wsc + ssc + 0.25, wr=wr, sr=sr, bs=bs, wink=a[1], sink=b[1], right=wright, sright=sright, sg=sg, wg=WG[bs], corner=wc, scorner=sc_, cw=sg['cw'], ws=a[2], ss=b[2]))
    if want.get('layout') == 'split': out = [o for o in out if o['kind'] == 'split']
    return out

def best(s, prev_corner=None):
    n = s['photo']; lo, hi = t_range(n)
    ts = ['pad'] if (lo > hi or s.get('t') == 'pad') else ([s['t']] if 't' in s else sorted({t for t in list(range(0, 271, 30)) + [lo, hi] if lo <= t <= hi}))
    top, bot = body_span(n); res = []
    for allow_feet in (False, True):
        for t in ts:
            fr = frame(n, t, s.get('wm'), s.get('tight', False), s.get('wmxy')); st = Stats(fr)
            frame_pen = 0 if t == 'pad' else max(0, (t + H) - bot - 90) / 350
            for L in layouts(fr, st, s['word'], s['line'], s['credit'], allow_feet, s):
                L['score'] += frame_pen + (0.35 if prev_corner and L['corner'] == prev_corner else 0); L['t'] = t; L['fr'] = fr
                res.append(L)
        if res: break
    res.sort(key=lambda r: r['score'])
    return res

def render(L, word, ink_w=None, ink_s=None, shadow=1.0):
    fr = L['fr']; img = fr['img']; fb, fs, fc = F('Bold', L['bs']), F('Serif', L['sg']['sz']), F('Bold', CRED)
    wi, si = ink_w or L['wink'], ink_s or L['sink']; sg = L['sg']
    def dw(d, fill):
        ttext(d, (L['wr'][0], L['wr'][1] + L['wg']['asc']), word, fb, TRK_BIG, fill)
    def ds(d, fill):
        x0, x1 = L['sr'][0], L['sr'][2]; right = L.get('sright', L['right'])
        for i, t in enumerate(sg['sl']):
            yb = L['sr'][1] + sg['base'][i]; ws = t.split()
            last = i == len(sg['sl']) - 1
            if False:
                gap = (sg['w'] - sum(fs.getlength(w) for w in ws)) / (len(ws) - 1)
                if gap - fs.getlength(' ') <= 14:
                    x = x0
                    for w in ws: d.text((x, yb), w, font=fs, fill=fill, anchor='ls'); x += fs.getlength(w) + gap
                    continue
            x = x1 - fs.getlength(t) if right else x0
            d.text((x, yb), t, font=fs, fill=fill, anchor='ls')
        for j, c in enumerate(sg['cl']):
            x = x1 - tlen(c, fc, TRK_CRED) if right else x0
            ttext(d, (x, L['sr'][1] + sg['cbase'][j]), c, fc, TRK_CRED, fill)
    def layer(base, fn, ink):
        txt = Image.new('L', (W, H), 0); fn(ImageDraw.Draw(txt), 255)
        col = SHADOW if ink == 'light' else GLOW
        a_l, a_d = (0.55, 0.4) if fn is dw else (0.68, 0.6)
        sh = Image.new('L', (W, H), 0); sh.paste(txt.filter(ImageFilter.GaussianBlur(7 * k)).point(lambda v: int(min(255, v * 1.5 * k) * (a_l if ink == 'light' else a_d))), (0, 4 if ink == 'light' else 0))
        base = Image.alpha_composite(base, Image.merge('RGBA', [Image.new('L', (W, H), c) for c in col] + [sh]))
        fn(ImageDraw.Draw(base), (LIGHT if ink == 'light' else DARK) + (255,)); return base
    k = 1.0; base = layer(img.convert('RGBA'), dw, wi); k = shadow; base = layer(base, ds, si)
    return base.convert('RGB')

if __name__ == '__main__':
    spec_path, out_dir = sys.argv[1], sys.argv[2]
    S = json.load(open(spec_path)); os.makedirs(out_dir, exist_ok=True)
    only = os.environ.get('ONLY'); logp = os.path.join(out_dir, 'log.json')
    log = {l['n']: l for l in json.load(open(logp))} if (only and os.path.exists(logp)) else {}
    prev = None
    for k, s in enumerate(S):
        if only and str(k + 1) not in only.split(','): prev = log.get(k + 1, {}).get('corner'); continue
        r = best(s, prev)
        if not r: print(k + 1, s['photo'], 'NO SPOT'); log[k + 1] = dict(n=k + 1, photo=s['photo'], fail=True); continue
        L = r[0]
        if s.get('sxy'):    # hand placement of the sentence block (top-left corner)
            x, y = s['sxy']; w_, h_ = L['sr'][2] - L['sr'][0], L['sr'][3] - L['sr'][1]
            if x == 'R': x = W - M - w_; L['sright'] = True     # right-aligned on the margin
            L['sr'] = (x, y, x + w_, y + h_)
            if s.get('ink_s'): L['sink'] = s['ink_s']
        if s.get('wscale'):  # shrink the keyword in place: same baseline, same aligned edge
            old = L['wg']; nb = round(L['bs'] * s['wscale']); wg = word_geom(s['word'], nb); base = L['wr'][1] + old['asc']
            right = L['right']; x0 = L['wr'][2] - wg['w'] if right else L['wr'][0]
            L['wr'] = (x0, base - wg['asc'], x0 + wg['w'], base + wg['desc']); L['wg'] = wg; L['bs'] = nb
        if s.get('wpos'):   # hand placement of the keyword (x of its right edge, y of its top), for frames the search cannot solve
            if s.get('wwidth'): b_ = size_for(s['word'], s['wwidth']); L['wg'] = word_geom(s['word'], b_); L['bs'] = b_
            wg = L['wg']; xr, y = s['wpos']
            if xr == 'L': xr = M + wg['w']; L['right'] = False
            L['wr'] = (xr - wg['w'], y, xr, y + wg['asc'] + wg['desc']); L['wink'] = s.get('ink_w', 'light')
        out = render(L, s['word'], s.get('ink_w'), s.get('ink_s'), s.get('shadow', 1.0))
        out.save(os.path.join(out_dir, f"{k+1:02d}.jpg"), quality=93)
        lo, hi = t_range(s['photo'])
        info = dict(n=k + 1, photo=s['photo'], t=L['t'], lo=lo, hi=hi, wm=L['fr']['wmode'], kind=L['kind'], corner=L['corner'], scorner=L['scorner'], bs=L['bs'], cw=L['cw'], wink=L['wink'], sink=L['sink'], lines=len(L['sg']['sl']), score=round(L['score'], 2), ws=L['ws'], ss=L['ss'])
        log[k + 1] = info; prev = L['corner']; print(json.dumps(info))
    json.dump([log[k] for k in sorted(log)], open(logp, 'w'), indent=1)
