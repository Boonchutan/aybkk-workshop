# Magazine carousel engine (Boonchu 18 Oct): golden grid, big Helvetica word + serif italic sentence + caps credit,
# block goes on the brightest or darkest calm area, the photo may move up or down (full width) to make room,
# empty areas get used, words may sit on bodies but never on faces or hands.
import os, sys, json, importlib.util
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage
GD = os.path.dirname(os.path.abspath(__file__)); WD = sys.argv[1]
sys.argv = [sys.argv[0], WD]
sys.path.insert(0, GD)
import gridsys4 as g
spec = importlib.util.spec_from_file_location('c18', os.path.join(WD, 'crop18_lib.py')); c18 = importlib.util.module_from_spec(spec); spec.loader.exec_module(c18)
W, H, M = 1080, 1350, 60
ZONES = json.load(open(os.path.join(WD, 'zones15.json'))); INFO = json.load(open(os.path.join(WD, 'crop_info.json')))
WM_X0, WM_X1, WM_TOP = 320, 760, 1133
BOTTOM = 1120

WM_LEFT_SHIFT = -305   # moves the watermark text (x 365-718) to start on the 60 px margin

def crop_at(n, t, wm='center'):
    src = Image.open(os.path.join(WD, '../dl', n + '.jpg')).convert('RGB')
    big = np.asarray(src.resize((1080, 1620), Image.LANCZOS)).copy()
    out = big[t:t + 1350].copy()
    if t < 190 or wm == 'left':  # watermark cut or moved: clean the original, stamp it at the usual height
        reg = big[c18.WY0:c18.WY1, c18.WX0:c18.WX1]; a = c18.wm_alpha(reg); o0 = c18.WY0 - t
        if o0 < 1350:
            mm = np.zeros(out.shape[:2], np.uint8); h = min(c18.WY1 - c18.WY0, 1350 - o0)
            mm[o0:o0 + h, c18.WX0:c18.WX1] = cv2.dilate((a[:h] > 0.05).astype(np.uint8), np.ones((7, 7), np.uint8)) * 255
            out = cv2.inpaint(out, mm, 5, cv2.INPAINT_TELEA)
        y0 = c18.WY0 - c18.SHIFT
        if wm == 'left':
            cut = -(c18.WX0 + WM_LEFT_SHIFT); reg, a = reg[:, cut:], a[:, cut:]; xa = 0
        else:
            xa = c18.WX0
        dst = out[y0:y0 + reg.shape[0], xa:xa + reg.shape[1]].astype(np.float32); A = a[..., None]
        out[y0:y0 + reg.shape[0], xa:xa + reg.shape[1]] = (dst * (1 - A) + reg.astype(np.float32) * A).astype(np.uint8)
    img = Image.fromarray(out)
    person = c18.mask(img, (1080, 1350))
    crit = np.zeros((H, W), bool); sh = INFO[n]['t'] - t
    for b in ZONES[n]['faces'] + ZONES[n]['hands_feet']:
        y0, y1 = max(0, b['y0'] + sh - 20), min(H, b['y1'] + sh + 20)
        if y1 > y0: crit[y0:y1, max(0, b['x0'] - 20):b['x1'] + 20] = True
    return img, ndimage.binary_dilation(person, iterations=8), crit

def block(word, line, credit, bs, cw, order):
    fb, fs, fc = g.F('Bold', bs), g.F('Serif', g.SENT), g.F('Bold', g.CRED)
    if g.tlen(word, fb, g.TRK_BIG) > cw: return None
    sl = g.wrap(line, fs, cw); lead = round(g.SENT * 1.12)
    cap = fb.getbbox('H')[3] - fb.getbbox('H')[1]; asc = round(g.SENT * 0.78)
    cr = credit.upper(); cl = [cr] if g.tlen(cr, fc, g.TRK_CRED) <= cw else [p.strip() for p in cr.split('·')]
    items = []; y = 0                                   # (kind, text, baseline offset from block top)
    if order == 'word_top':
        y += cap; items.append(('w', word, y)); y += 26 + asc
        for t in sl: items.append(('s', t, y)); y += lead
        y += -lead + 26 + g.CRED
    else:
        y += asc
        for t in sl: items.append(('s', t, y)); y += lead
        y += -lead + 26 + cap; items.append(('w', word, y)); y += 26 + g.CRED
    for c in cl: items.append(('c', c, y)); y += round(g.CRED * 1.7)
    h = y - round(g.CRED * 1.7) + 8
    widths = {'w': lambda t: g.tlen(t, fb, g.TRK_BIG), 's': lambda t: fs.getlength(t), 'c': lambda t: g.tlen(t, fc, g.TRK_CRED)}
    return dict(items=items, h=h, w=max(widths[k](t) for k, t, _ in items), bs=bs, fonts=(fb, fs, fc), widths=widths, order=order)

def candidates(word, line, credit, pos=None, wm='center'):
    out = []
    for side in ('left', 'right'):
        for cw in (607, 587, 560, 500, 353):
            for order in ('word_top', 'sent_top'):
                for bs in (288, 178, 110):
                    B = block(word, line, credit, bs, cw, order)
                    if not B: continue
                    bot = 1316 if (wm == 'left' and side == 'right' and 1020 - B['w'] > 718 + WM_LEFT_SHIFT + 20) else BOTTOM
                    for vert, top in (('top', M), ('g1', 516), ('g2', 834 - B['h']), ('bottom', bot - B['h'])):
                        corner = ('top' if top + B['h'] / 2 < 675 else 'bottom') + '-' + side
                        if pos and corner != pos: continue
                        x0 = M if side == 'left' else 1020 - B['w']
                        out.append(dict(B, side=side, cw=cw, vert=vert, x0=int(x0), y0=int(top), corner=corner))
    return out

def score(img, person, crit, C, wm='center'):
    x0, y0, x1, y1 = C['x0'] - 14, C['y0'] - 14, int(C['x0'] + C['w']) + 14, int(C['y0'] + C['h']) + 14
    if y0 < 20 or y1 > H - 20 or x0 < 20 or x1 > W - 20: return None
    wx0, wx1 = (WM_X0, WM_X1) if wm == 'center' else (40, 718 + WM_LEFT_SHIFT + 20)
    if y1 > WM_TOP and x1 > wx0 and x0 < wx1: return None
    a = (slice(y0, y1), slice(x0, x1))
    if crit[a].mean() > 0.001: return None
    gr = np.asarray(img.convert('L'), np.float32)[a]
    med, std, pf = float(np.median(gr)), float(gr.std()), float(person[a].mean())
    size_rank = (288, 178, 110).index(C['bs'])
    return size_rank * 1.2 + pf * 2.5 + std / 40 - abs(med - 128) / 70, dict(med=med, std=std, person=pf)

def render(img, C):
    ink = 'dark' if C['stats']['med'] > 140 else 'light'
    fb, fs, fc = C['fonts']
    def put(d, fill, cfill):
        for k, t, yb in C['items']:
            w = C['widths'][k](t); x = C['x0'] if C['side'] == 'left' else 1020 - w
            if k == 's': d.text((x, C['y0'] + yb), t, font=fs, fill=fill, anchor='ls')
            elif k == 'w': g.ttext(d, (x, C['y0'] + yb), t, fb, g.TRK_BIG, fill)
            else: g.ttext(d, (x, C['y0'] + yb), t, fc, g.TRK_CRED, cfill)
    txt = Image.new('L', (W, H), 0); put(ImageDraw.Draw(txt), 255, 255)
    col = g.SHADOW if ink == 'light' else g.GLOW
    sh = Image.new('L', (W, H), 0); sh.paste(txt.filter(ImageFilter.GaussianBlur(7)).point(lambda v: int(min(255, v * 1.5) * (0.55 if ink == 'light' else 0.4))), (0, 4 if ink == 'light' else 0))
    base = Image.alpha_composite(img.convert('RGBA'), Image.merge('RGBA', [Image.new('L', (W, H), c) for c in col] + [sh]))
    c = g.LIGHT if ink == 'light' else g.DARK
    put(ImageDraw.Draw(base), c + (255,), c + (235,))
    return base.convert('RGB'), ink

def best(s):
    lo, hi = t_range(s['photo'])
    ts = [s['t']] if 't' in s else sorted({t for t in [270, 225, 180, 135, 90, 45, 0, lo, hi] if lo <= t <= hi}, reverse=True)
    res = []
    for t in ts:
        img, person, crit = crop_at(s['photo'], t, s.get('wm', 'center'))
        for C in candidates(s['word'], s['line'], s['credit'], s.get('pos'), s.get('wm', 'center')):
            r = score(img, person, crit, C, s.get('wm', 'center'))
            if r: res.append((r[0] + (270 - t) / 900, t, C, r[1], img))   # tiny preference to keep the current crop
    res.sort(key=lambda r: r[0])
    return res

if __name__ == '__main__':
    S = json.load(open(os.path.join(GD, os.environ.get('DEMOS', 'demos5.json'))))
    for k, s in enumerate(S):
        r = best(s)
        if not r: print(s['photo'], 'NO SPOT'); continue
        sc, t, C, st, img = r[0]; C['stats'] = st
        out, ink = render(img, C)
        out.save(os.path.join(GD, f"v5demo{k+1}.jpg"), quality=93); g.overlay(out).save(os.path.join(GD, f"v5demo{k+1}_grid.jpg"), quality=90)
        print(s['photo'], 't', t, C['corner'], C['side'], C['cw'], C['vert'], C['order'], 'word', C['bs'], 'ink', ink, {k2: round(v, 1) for k2, v in st.items()}, 'score', round(sc, 2))

# ---- additions 18 Oct (2): keep the whole student in frame; split layout (big word in one corner, dense justified sentence in another)
def t_range(n, gap=24):
    sh = INFO[n]['t']; z = ZONES[n]
    boxes = z['main_body'] + [b for b in z['faces'] + z['hands_feet'] if b.get('who') == 'main']
    top = min(b['y0'] for b in boxes) + sh; bot = max(b['y1'] for b in boxes) + sh
    return max(0, bot + gap - 1350), min(270, max(0, top - gap))

def justify(d, x0, x1, y, words, f, fill, last):
    if last or len(words) == 1:
        d.text((x0, y), ' '.join(words), font=f, fill=fill, anchor='ls'); return
    wsum = sum(f.getlength(w) for w in words); gap = (x1 - x0 - wsum) / (len(words) - 1); x = x0
    for w in words:
        d.text((x, y), w, font=f, fill=fill, anchor='ls'); x += f.getlength(w) + gap

def render_split(img, word, line, credit, word_size, sent_x0, sent_x1, sent_bottom, word_ink=None, sent_ink=None, lead_k=1.0, sent_size=None, just_max=14):
    SZ = sent_size or g.SENT
    fb, fs, fc = g.F('Bold', word_size), g.F('Serif', SZ), g.F('Bold', g.CRED)
    cap = fb.getbbox('H')[3] - fb.getbbox('H')[1]; wbase = M + cap
    sl = g.wrap(line, fs, sent_x1 - sent_x0); lead = round(SZ * lead_k)
    cr = credit.upper(); cw = sent_x1 - sent_x0
    cl = [cr] if g.tlen(cr, fc, g.TRK_CRED) <= cw else [p.strip() for p in cr.split('·')]
    ch = (len(cl) - 1) * round(g.CRED * 1.7)
    cy0 = sent_bottom - ch                         # last credit baseline = sent_bottom
    sy_last = cy0 - g.CRED - 26
    sy0 = sy_last - (len(sl) - 1) * lead
    gray = np.asarray(img.convert('L'), np.float32)
    wb = (slice(M, wbase), slice(M, int(M + g.tlen(word, fb, g.TRK_BIG))))
    sb = (slice(int(sy0 - SZ), int(sent_bottom)), slice(sent_x0, sent_x1))
    word_ink = word_ink or ('dark' if np.median(gray[wb]) > 140 else 'light')
    sent_ink = sent_ink or ('dark' if np.median(gray[sb]) > 140 else 'light')
    def layer(base, draw_fn, ink):
        txt = Image.new('L', (W, H), 0); draw_fn(ImageDraw.Draw(txt), 255)
        col = g.SHADOW if ink == 'light' else g.GLOW
        sh = Image.new('L', (W, H), 0); sh.paste(txt.filter(ImageFilter.GaussianBlur(7)).point(lambda v: int(min(255, v * 1.5) * (0.55 if ink == 'light' else 0.4))), (0, 4 if ink == 'light' else 0))
        base = Image.alpha_composite(base, Image.merge('RGBA', [Image.new('L', (W, H), c) for c in col] + [sh]))
        c = g.LIGHT if ink == 'light' else g.DARK
        draw_fn(ImageDraw.Draw(base), c + (255,)); return base
    def dw(d, fill): g.ttext(d, (M, wbase), word, fb, g.TRK_BIG, fill)
    def ds(d, fill):
        for i, t in enumerate(sl):
            ws = t.split(); gap = (sent_x1 - sent_x0 - sum(fs.getlength(w) for w in ws)) / max(1, len(ws) - 1) - fs.getlength(' ')
            justify(d, sent_x0, sent_x1, sy0 + i * lead, ws, fs, fill, i == len(sl) - 1 or gap > just_max)   # only justify when the gaps stay tight
        for j, c in enumerate(cl): g.ttext(d, (sent_x0, cy0 + j * round(g.CRED * 1.7)), c, fc, g.TRK_CRED, fill)
    base = layer(img.convert('RGBA'), dw, word_ink); base = layer(base, ds, sent_ink)
    boxes = dict(word=(M, M, int(M + g.tlen(word, fb, g.TRK_BIG)), wbase + 10), sent=(sent_x0, int(sy0 - SZ * 0.8), sent_x1, sent_bottom + 8))
    return base.convert('RGB'), boxes, (word_ink, sent_ink), len(sl)
