# Golden-ratio grid, locked magazine style (Boonchu 18 Oct): big tight Helvetica word, serif italic sentence, tracked caps credit,
# no stroke (soft shadow only), soft off-white ink on darker areas, charcoal ink on bright areas, words may sit on bodies but never on faces or hands.
import os, sys, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
GD = os.path.dirname(os.path.abspath(__file__))
WD = sys.argv[1]  # oct17 work dir (crops, masks, zones)
sys.path.insert(0, WD); os.chdir(WD)
import place17
PHI = (1 + 5 ** .5) / 2
W, H = 1080, 1350
M = 60                                     # margin = 1080 / phi^6
GX = [round(W / PHI ** 2), round(W / PHI)]  # 413, 667
GY = [round(H / PHI ** 2), round(H / PHI)]  # 516, 834
SCALE = [288, 178, 110, 68, 42, 26]        # each step x 1.618
COLS = {'left wide': (M, GX[1]), 'right wide': (GX[0], W - M), 'left narrow': (M, GX[0]), 'right narrow': (GX[1], W - M)}
ANCHORS = ['top margin', 'golden line 1', 'golden line 2']
LIGHT, DARK, SHADOW, GLOW = (250, 248, 243), (30, 30, 30), (40, 40, 40), (255, 255, 255)
def F(w, s):
    if w == 'Serif': return ImageFont.truetype(os.path.join(GD, 'fonts', 'InstrumentSerif-Italic.ttf'), s)
    return ImageFont.truetype(os.path.join(GD, 'fonts', f'NimbusSans-{w}.otf'), s)
SENT, CRED = 54, 22                         # serif italic needs more size than sans to read on photos
TRK_BIG, TRK_CRED = -0.035, 0.14            # tight headline, airy caps label (as in his reference)
def tlen(t, f, trk): return f.getlength(t) + trk * f.size * max(0, len(t) - 1)
def ttext(d, xy, t, f, trk, fill):
    x, y = xy
    for i, ch in enumerate(t):
        d.text((x, y), ch, font=f, fill=fill, anchor='ls')
        x += f.getlength(t[:i + 1]) - f.getlength(t[:i]) + trk * f.size

def wrap(text, f, width, trk=0):
    out, cur = [], ''
    for w in text.split():
        t = (cur + ' ' + w).strip()
        if tlen(t, f, trk) <= width or not cur: cur = t
        else: out.append(cur); cur = w
    return out + [cur]

def layout(word, line, credit, col, anchor, big=None):
    x0, x1 = COLS[col]; cw = x1 - x0
    sizes = [big] if big else SCALE[:3]
    for bs in sizes:
        fb = F('Bold', bs)
        if tlen(word, fb, TRK_BIG) <= cw: break
    else:
        return None
    fs, fc = F('Serif', SENT), F('Bold', CRED)
    sl = wrap(line, fs, cw)
    cap = fb.getbbox('H')[3] - fb.getbbox('H')[1]
    lead = round(SENT * 1.12)
    if anchor == 'top margin': base = M + cap
    elif anchor == 'top 2': base = M + 68 + cap
    else: base = GY[0] if anchor == 'golden line 1' else GY[1]
    top = base - cap
    sy = base + 26 + round(SENT * 0.78)    # first sentence baseline
    cr = credit.upper()
    cl = [cr] if tlen(cr, fc, TRK_CRED) <= cw else [p.strip() for p in cr.split('·')]
    cy = sy + (len(sl) - 1) * lead + 26 + CRED + 6
    bottom = cy + (len(cl) - 1) * round(CRED * 1.7) + 8
    return dict(word=word, bs=bs, x0=x0, x1=x1, base=base, top=top, sl=sl, sy=sy, lead=lead, cy=cy, cl=cl, bottom=bottom,
                tw=max([tlen(word, fb, TRK_BIG)] + [fs.getlength(t) for t in sl] + [tlen(c, fc, TRK_CRED) for c in cl]), col=col, anchor=anchor)

def score(n, L):
    main, bg, crit = place17.masks(n)
    info = place17.INFO[n]
    y0, y1 = int(L['top']) - 12, int(L['bottom']) + 12; x0, x1 = L['x0'] - 12, int(L['x0'] + L['tw']) + 12
    if y0 < 20 or y1 > H - 20 or x1 > W - 20: return None
    if y1 > info['wm_top'] - 14 and x1 > 320 and x0 < 760: return None
    a = (slice(y0, y1), slice(x0, x1))
    if crit[a].mean() > 0.002: return None
    g = np.asarray(Image.open(f'crop/{n}.jpg').convert('L'), np.float32)[a]
    return (SCALE.index(L['bs']), round(main[a].mean() * 1.5 + bg[a].mean() + g.std() / 45 - abs(g.mean() - 128) / 128, 3))

def best(n, word, line, credit):
    c = []
    for col in COLS:
        for an in ANCHORS + ['top 2']:
          for bs in SCALE[:3]:
            L = layout(word, line, credit, col, an, bs)
            if L:
                s = score(n, L)
                if s: c.append((s, L))
    c.sort(key=lambda t: t[0])
    return c

def ink(img, L):
    # judge by the sentence lines: the thin italic is what must read
    y0 = int(L['sy'] - SENT); y1 = int(L['cy'] + 10)
    g = np.asarray(img.convert('L'), np.float32)[y0:y1, L['x0']:int(L['x0'] + L['tw'])]
    return 'dark' if np.median(g) > 140 else 'light'

def draw(img, L, mode=None):
    mode = mode or ink(img, L); L['ink'] = mode
    base = img.convert('RGBA')
    fb, fs, fc = F('Bold', L['bs']), F('Serif', SENT), F('Bold', CRED)
    def put(d, fill, cfill):
        ttext(d, (L['x0'], L['base']), L['word'], fb, TRK_BIG, fill)
        for i, t in enumerate(L['sl']): d.text((L['x0'], L['sy'] + i * L['lead']), t, font=fs, fill=fill, anchor='ls')
        for j, c in enumerate(L['cl']): ttext(d, (L['x0'], L['cy'] + j * round(CRED * 1.7)), c, fc, TRK_CRED, cfill)
    txt = Image.new('L', (W, H), 0); put(ImageDraw.Draw(txt), 255, 255)
    col = SHADOW if mode == 'light' else GLOW
    sh = Image.new('L', (W, H), 0); sh.paste(txt.filter(ImageFilter.GaussianBlur(7)).point(lambda v: int(min(255, v * 1.5) * (0.55 if mode == 'light' else 0.4))), (0, 4 if mode == 'light' else 0))
    base = Image.alpha_composite(base, Image.merge('RGBA', [Image.new('L', (W, H), c) for c in col] + [sh]))
    c = LIGHT if mode == 'light' else DARK
    put(ImageDraw.Draw(base), c + (255,), c + (235,))
    return base.convert('RGB')

def overlay(img, L=None):
    o = img.convert('RGBA'); g = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(g)
    for y in range(M, H - M + 1, 26): d.line([(M, y), (W - M, y)], fill=(255, 255, 255, 28))
    d.rectangle([M, M, W - M, H - M], outline=(0, 230, 255, 200), width=3)
    for x in GX: d.line([(x, 0), (x, H)], fill=(255, 64, 160, 230), width=4)
    for y in GY: d.line([(0, y), (W, y)], fill=(255, 64, 160, 230), width=4)
    if L:
        d.rectangle([L['x0'], L['top'] - 8, L['x1'], L['bottom'] + 8], outline=(255, 214, 0, 255), width=5)
        d.line([(L['x0'] - 30, L['base']), (L['x1'] + 10, L['base'])], fill=(255, 214, 0, 255), width=3)
    f = F('Bold', 30)
    d.text((GX[0] + 10, 14), '0.382', font=f, fill=(255, 64, 160, 255)); d.text((GX[1] + 10, 14), '0.618', font=f, fill=(255, 64, 160, 255))
    d.text((14, GY[0] - 40), '0.382', font=f, fill=(255, 64, 160, 255)); d.text((14, GY[1] - 40), '0.618', font=f, fill=(255, 64, 160, 255))
    return Image.alpha_composite(o, g).convert('RGB')

if __name__ == '__main__':
    S = json.load(open(os.path.join(GD, os.environ.get('DEMOS', 'demos.json')))); out = []
    for k, s in enumerate(S):
        c = best(s['photo'], s['word'], s['line'], s['credit'])
        if s.get('force'): c = [(None, layout(s['word'], s['line'], s['credit'], *s['force']))] + c
        if not c: print(s['photo'], 'NO SPOT'); continue
        L = c[0][1]; im0 = Image.open(f"crop/{s['photo']}.jpg").convert('RGB'); print(s['photo'], L['col'], L['anchor'], 'word', L['bs'], 'lines', len(L['sl']), 'ink', ink(im0, L), 'others', [(t[1]['col'], t[1]['anchor'], t[1]['bs']) for t in c[1:4]])
        im = Image.open(f"crop/{s['photo']}.jpg").convert('RGB'); clean = draw(im, L)
        clean.save(os.path.join(GD, f"v4demo{k+1}.jpg"), quality=93); overlay(clean, L).save(os.path.join(GD, f"v4demo{k+1}_grid.jpg"), quality=90)
