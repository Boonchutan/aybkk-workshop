"""Grid carousel layout for the 26 Nov THINKERS / HISTORY sets.
Rules (plato.md): 1080x1350, big word Inter Black 900 at 3/4 (810) or 2/3 (720) width (1/2 only if neither fits), tracking -3.5 %,
on the top or bottom edge, never on faces / main hands / feet / frames; small text IBM Plex Serif 42 px on the 52 px baseline grid,
column 353 or 607 wide starting on 60 / 413 / 667 (or ending on 413 / 667 / 1020), never over students, never on the watermark.
Ink: charcoal on bright areas (median > 140), off-white with a soft shadow on darker areas. No stroke on light ink.
usage: python3 -I lay.py SET N [override.json]  -> out/SET_NN.jpg and a log line
"""
import sys, json, os, itertools
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

D = os.path.dirname(os.path.abspath(__file__))
GG = '/home/user/bots-mem/bots/tools/golden-grid/fonts/'
W, H, M = 1080, 1350, 60
LIGHT, DARK = (250, 248, 243), (30, 30, 30)
TRK = -0.035
SZ, LEAD = 42, 52
COLS = [(60, 413), (667, 1020), (60, 667), (413, 1020)]
WM = (330, 1420, 750, 1540)          # watermark box in the 1080x1620 photo
_F = {}

def big(size):
    k = ('big', size)
    if k not in _F:
        f = ImageFont.truetype(GG + 'Inter-var.ttf', size); f.set_variation_by_axes([32, 900]); _F[k] = f
    return _F[k]

def serif(size):
    k = ('serif', size)
    if k not in _F: _F[k] = ImageFont.truetype(GG + 'IBMPlexSerif-Regular.ttf', size)
    return _F[k]

def cjk(size):
    k = ('cjk', size)
    if k not in _F: _F[k] = ImageFont.truetype(os.path.join(D, 'fonts', 'NotoSerifSC-sub.ttf'), size)
    return _F[k]

def is_cjk(ch): return ord(ch) >= 0x2E80

def smart(t):
    out, open_ = [], True
    for i, ch in enumerate(t):
        if ch == '"':
            out.append('“' if open_ else '”'); open_ = not open_
        elif ch == "'":
            prev = t[i - 1] if i else ' '
            out.append('’' if prev.isalnum() or prev in '.,!?' else '‘')
        else: out.append(ch)
    return ''.join(out)

# ---------- big word ----------
def word_w(word, f):
    adv = sum(f.getlength(c) for c in word); trk = TRK * f.size * (len(word) - 1)
    return adv + trk

def word_size_for(word, width):
    s = 200
    for _ in range(30):
        w = word_w(word, big(s)); s2 = max(20, int(round(s * width / w)))
        if s2 == s: break
        s = s2
    while word_w(word, big(s)) > width + 0.5: s -= 1
    return s

def word_ink_box(word, f):
    """tight ink box (x0, y0, x1, y1) relative to the draw origin (anchor 'ls' at 0,0)."""
    x, xs0, xs1, ys0, ys1 = 0, [], [], [], []
    for c in word:
        bb = f.getbbox(c, anchor='ls')
        if c != ' ':
            xs0.append(x + bb[0]); xs1.append(x + bb[2]); ys0.append(bb[1]); ys1.append(bb[3])
        x += f.getlength(c) + TRK * f.size
    return min(xs0), min(ys0), max(xs1), max(ys1)

def draw_word(L, word, f, ox, oy, fill):
    d = ImageDraw.Draw(L); x = ox
    for c in word:
        d.text((x, oy), c, font=f, fill=fill, anchor='ls'); x += f.getlength(c) + TRK * f.size

# ---------- small text ----------
def tokens(text):
    out, cur = [], ''
    for ch in text:
        if is_cjk(ch):
            if cur: out.append(cur); cur = ''
            out.append(ch)
        elif ch == ' ':
            if cur: out.append(cur); cur = ''
            out.append(' ')
        else: cur += ch
    if cur: out.append(cur)
    return out

def seg_len(s, size):
    return sum((cjk(size) if is_cjk(c) else serif(size)).getlength(c) for c in s)

def wrap(text, width, size=SZ):
    lines, cur = [], ''
    for tk in tokens(text):
        if tk == ' ':
            if cur: cur += ' '
            continue
        cand = cur + tk
        if seg_len(cand.rstrip(), size) <= width or not cur.strip(): cur = cand
        else:
            lines.append(cur.rstrip()); cur = tk
    if cur.strip(): lines.append(cur.rstrip())
    return lines

def draw_lines(L, lines, x, top, size, fill, right=None):
    d = ImageDraw.Draw(L)
    for i, ln in enumerate(lines):
        y = top + i * LEAD + int(size * 0.92)      # baseline
        xx = x if right is None else right - seg_len(ln, size)
        for c in ln:
            fo = cjk(size) if is_cjk(c) else serif(size)
            d.text((xx, y), c, font=fo, fill=fill, anchor='ls'); xx += fo.getlength(c)

# ---------- zones and scoring ----------
def zones_for(pid, t):
    z = ZONES[pid]
    def sh(b): return (b['x0'], b['y0'] - t, b['x1'], b['y1'] - t)
    out = {'face': [sh(b) for b in z['faces']],
           'mhf': [sh(b) for b in z['hands'] + z['feet'] if b['who'] == 'main'],
           'bhf': [sh(b) for b in z['hands'] + z['feet'] if b['who'] != 'main'],
           'main': [sh(b) for b in z['main_body']],
           'bg': [sh(b) for b in z['background_bodies']],
           'frame': [sh(b) for b in z['frames']],
           'free': [sh(b) for b in z['free_areas']]}
    wm = (WM[0], WM[1] - t, WM[2], WM[3] - t)
    out['wm'] = [wm]
    return out

def ov(a, b):
    w = min(a[2], b[2]) - max(a[0], b[0]); h = min(a[3], b[3]) - max(a[1], b[1])
    return max(0, w) * max(0, h)

WT_WORD = {'face': 1e5, 'mhf': 3e4, 'bhf': 60, 'main': 12, 'bg': 1.5, 'frame': 1e5, 'wm': 1e5, 'free': -1.0}
WT_TEXT = {'face': 1e5, 'mhf': 3e4, 'bhf': 400, 'main': 120, 'bg': 40, 'frame': 1e5, 'wm': 1e5, 'free': -1.5}

def rect_cost(r, Z, wt, lum):
    c = 0.0
    for k, w in wt.items():
        for b in Z[k]: c += w * ov(r, b)
    x0, y0, x1, y1 = [int(round(v)) for v in r]
    x0, y0 = max(0, x0), max(0, y0); x1, y1 = min(W, x1), min(H, y1)
    patch = lum[y0:y1, x0:x1]
    if patch.size:
        c += patch.std() * patch.size * 0.08            # calm areas first
        med = np.median(patch); c += patch.size * 0.15 * (1 - abs(med - 128) / 128)   # very bright or very dark first
    return c

def crop_t(pid):
    z = ZONES[pid]
    keys = z['main_body'] + z['faces'] + [b for b in z['hands'] + z['feet'] if b['who'] == 'main']
    top = min(b['y0'] for b in keys); bot = max(b['y1'] for b in keys)
    t_hi = min(270, top - 12)                   # cut ceiling, keep the top of the body
    t_lo = max(0, bot + 12 - H)
    t = max(t_lo, min(t_hi, 270))
    return int(max(0, min(270, t)))

def layout(s, ov_):
    pid = s['photo']; t = ov_.get('t', crop_t(pid))
    img = Image.open(os.path.join(D, 'w', pid + '.jpg')).convert('RGB').crop((0, t, W, t + H))
    if ov_.get('wb'):
        a = np.asarray(img).astype(np.float32) / 255; lin = a ** 2.2
        lin *= np.array(ov_['wb'], np.float32); img = Image.fromarray((np.clip(lin, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8))
    if t < 190 and ov_.get('restamp', True):
        src = Image.open(os.path.join(D, 'w', pid + '.jpg')).convert('L')
        patch = np.asarray(src.crop(WM)).astype(np.float32)
        bgm = np.asarray(Image.fromarray(patch.astype(np.uint8)).filter(ImageFilter.MedianFilter(21))).astype(np.float32)
        a = np.clip((patch - bgm - 18) / 50, 0, 1)
        A = Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))
        nx, ny, k = ov_.get('wm_at', [WM[0], H - (WM[3] - WM[1]) - 70, 1.0])
        if k != 1.0: A = A.resize((int(A.width * k), int(A.height * k)), Image.LANCZOS)
        img.paste(Image.new('RGB', A.size, (252, 250, 245)), (int(nx), int(ny)), A)
        ov_['_wm_new'] = (nx, ny, nx + A.width, ny + A.height)
    lum = np.asarray(img.convert('L')).astype(np.float32)
    Z = zones_for(pid, t)
    if '_wm_new' in ov_: Z['wm'] = [ov_['_wm_new']]
    word, text = s['word'], smart(s['text'])
    best = None
    if 'fixed' in ov_:
        fx = ov_['fixed']; ww = fx['ww']; sz = word_size_for(word, ww); f = big(sz); ib = word_ink_box(word, f)
        wwid, whgt = ib[2] - ib[0], ib[3] - ib[1]
        wx = 60 if fx['wx'] == 'L' else (1020 - wwid if fx['wx'] == 'R' else fx['wx'])
        wy = fx['wy'] if isinstance(fx['wy'], (int, float)) else (60 if fx['wy'] == 'top' else int(fx['wy'][1:]) - whgt)
        wr = (wx, wy, wx + wwid, wy + whgt)
        cw = fx['cw']; lines = wrap(text, cw)
        if 'roww' in fx:      # per-row max widths (short rows where a body comes close); keeps the exact text
            rw = {int(k): v for k, v in fx['roww'].items()}; lines, cur, r = [], '', 1
            for tk in tokens(text):
                if tk == ' ':
                    if cur: cur += ' '
                    continue
                lim = rw.get(r, cw); cand = cur + tk
                if seg_len(cand.rstrip(), SZ) <= lim or not cur.strip(): cur = cand
                else: lines.append(cur.rstrip()); cur = tk; r += 1
            if cur.strip(): lines.append(cur.rstrip())
        bh = len(lines) * LEAD
        c0 = fx['c0']; col = (c0, c0 + cw)
        top = fx['top'] if 'top' in fx else fx['bottom'] - bh
        return img, lum, Z, (0, dict(t=t, sz=sz, wr=wr, ib=ib, cw=cw, col=col, top=top, lines=lines, wc=0, sc=0))
    widths = ov_.get('widths', [810, 720, 540])
    for wi, ww in enumerate(widths):
        sz = word_size_for(word, ww); f = big(sz); ib = word_ink_box(word, f)
        wwid, whgt = ib[2] - ib[0], ib[3] - ib[1]
        if whgt > 520: continue
        xs = [60, 1020 - wwid]
        wm_top = WM[1] - t
        ys = [60, min(1290, wm_top - 30) - whgt]
        for wx, wy in itertools.product(xs, ys):
            if 'wpos' in ov_ and (wx, wy) != tuple(ov_['wpos']) and ov_['wpos'][0] != 'any': pass
            wr = (wx, wy, wx + wwid, wy + whgt)
            if 'wedge' in ov_ and ov_['wedge'] != ('top' if wy == 60 else 'bottom'): continue
            if 'wside' in ov_ and ov_['wside'] != ('left' if wx == 60 else 'right'): continue
            wc = rect_cost(wr, Z, WT_WORD, lum) + wi * 4000
            for cw in ov_.get('cols', [607, 353]):
                lines = wrap(text, cw); bh = len(lines) * LEAD
                for c0, c1 in COLS:
                    if c1 - c0 != cw: continue
                    for top in range(60, 1291 - bh + 1, LEAD):
                        if 'stop' in ov_ and top != ov_['stop']: continue
                        sr = (c0, top, c1, top + bh)
                        if ov(sr, (wr[0] - 30, wr[1] - 36, wr[2] + 30, wr[3] + 36)) > 0: continue
                        sc = rect_cost(sr, Z, WT_TEXT, lum) + (0 if cw == 607 else 2500)
                        tot = wc + sc
                        if best is None or tot < best[0]:
                            best = (tot, dict(t=t, sz=sz, wr=wr, ib=ib, cw=cw, col=(c0, c1), top=top, lines=lines, wc=wc, sc=sc))
    return img, lum, Z, best

def ink_for(lum, r):
    x0, y0, x1, y1 = [int(round(v)) for v in r]
    p = lum[max(0, y0):min(H, y1), max(0, x0):min(W, x1)]
    return 'dark' if np.median(p) > 140 else 'light'

def render(s, ov_, out):
    img, lum, Z, b = layout(s, ov_)
    _, L = b
    word = s['word']; f = big(L['sz']); ib = L['ib']; wr = L['wr']
    ox, oy = wr[0] - ib[0], wr[1] - ib[1]
    ink_w = ov_.get('ink_w') or ink_for(lum, wr)
    sr = (L['col'][0], L['top'], L['col'][1], L['top'] + len(L['lines']) * LEAD)
    ink_s = ov_.get('ink_s') or ink_for(lum, sr)
    base = img.convert('RGBA')
    # soft local darkening behind light small text on busy areas
    if ink_s == 'light' and ov_.get('sburn', 0.25) > 0:
        m = Image.new('L', (W, H), 0); ImageDraw.Draw(m).rectangle((sr[0] - 30, sr[1] - 24, sr[2] + 30, sr[3] + 24), fill=int(255 * ov_.get('sburn', 0.25)))
        m = m.filter(ImageFilter.GaussianBlur(40)); base = Image.composite(Image.new('RGBA', (W, H), (0, 0, 0, 255)), base, m)
    if ink_w == 'light':
        S = Image.new('RGBA', (W, H), (0, 0, 0, 0)); draw_word(S, word, f, ox, oy + 3, (35, 35, 35, int(140 * ov_.get('wshadow', 1.0))))
        base = Image.alpha_composite(base, S.filter(ImageFilter.GaussianBlur(max(4, L['sz'] * 0.035))))
    Wl = Image.new('RGBA', (W, H), (0, 0, 0, 0)); draw_word(Wl, word, f, ox, oy, (LIGHT if ink_w == 'light' else DARK) + (255,))
    base = Image.alpha_composite(base, Wl)
    lines = L['lines']; right = L['col'][1] if ov_.get('sright') else None
    if ink_s == 'light':
        S = Image.new('RGBA', (W, H), (0, 0, 0, 0)); draw_lines(S, lines, L['col'][0], L['top'] + 2, SZ, (30, 30, 30, 170), right)
        base = Image.alpha_composite(base, S.filter(ImageFilter.GaussianBlur(3)))
    T = Image.new('RGBA', (W, H), (0, 0, 0, 0)); draw_lines(T, lines, L['col'][0], L['top'], SZ, (LIGHT if ink_s == 'light' else DARK) + (255,), right)
    base = Image.alpha_composite(base, T)
    base.convert('RGB').save(out, quality=93)
    hits = {k: sum(ov(sr, bx) for bx in Z[k]) for k in ('face', 'mhf', 'main', 'bg', 'frame', 'wm')}
    whits = {k: sum(ov(wr, bx) for bx in Z[k]) for k in ('face', 'mhf', 'main', 'bg', 'frame', 'wm')}
    T_, B_ = sr[1], sr[3]
    yok = any(abs(T_ - y) <= 2 for y in (60, 516, 834)) or any(abs(B_ - y) <= 2 for y in (516, 834, 1120, 1290)) or (T_ >= 58 and abs(((T_ - 60) + 26) % 52 - 26) <= 2)
    gridok = L['cw'] in (353, 607) and tuple(L['col']) in [(60, 413), (667, 1020), (60, 667), (413, 1020)] and yok and T_ >= 58 and B_ <= 1292
    return dict(n=s['n'], photo=s['photo'], word=word, t=L['t'], word_box=[round(v) for v in wr], word_size=L['sz'], ink_w=ink_w,
                text_box=[round(v) for v in sr], col=L['cw'], ink_s=ink_s, lines=len(lines), grid='OK' if gridok else 'FAIL',
                text_hits={k: round(v) for k, v in hits.items() if v}, word_hits={k: round(v) for k, v in whits.items() if v})

ZONES = {}
if __name__ == '__main__' and len(sys.argv) > 1 and sys.argv[1] == '--one':
    ZONES.update({z['id']: z for z in json.load(open(os.path.join(D, 'zones.json')))})
    SL = json.load(open(os.path.join(D, 'slides.json')))
    st, n, specp, out = sys.argv[2], int(sys.argv[3]), sys.argv[4], sys.argv[5]
    s_ = [x for x in SL[st] if x['n'] == n][0]
    r = render(s_, json.load(open(specp)), out)
    print(json.dumps(r, ensure_ascii=False)); sys.exit(0)
if __name__ == '__main__':
    ZONES.update({z['id']: z for z in json.load(open(os.path.join(D, 'zones.json')))})
    SL = json.load(open(os.path.join(D, 'slides.json')))
    OV = json.load(open(os.path.join(D, 'over.json'))) if os.path.exists(os.path.join(D, 'over.json')) else {}
    os.makedirs(os.path.join(D, 'out'), exist_ok=True)
    sets = [sys.argv[1]] if len(sys.argv) > 1 else ['S1', 'S2']
    only = [int(x) for x in sys.argv[2].split(',')] if len(sys.argv) > 2 else None
    log = []
    for st in sets:
        for s in SL[st]:
            if only and s['n'] not in only: continue
            key = f"{st}_{s['n']:02d}"
            r = render(s, OV.get(key, {}), os.path.join(D, 'out', key + '.jpg'))
            r['key'] = key; log.append(r); print(json.dumps(r, ensure_ascii=False))
    json.dump(log, open(os.path.join(D, 'out', 'log_%s.json' % '_'.join(sets)), 'w'), indent=1, ensure_ascii=False)
