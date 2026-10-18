# Golden-ratio grid v2 (Boonchu 18 Oct, from his reference): big tight Helvetica word, serif italic sentence, small tracked caps credit.
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
SCALE = [178, 110, 68, 42, 26]             # each step x 1.618
COLS = {'left wide': (M, GX[1]), 'right wide': (GX[0], W - M), 'left narrow': (M, GX[0]), 'right narrow': (GX[1], W - M)}
ANCHORS = ['top margin', 'golden line 1', 'golden line 2']
CREAM, WHITE, SHADOW = (255, 246, 208), (255, 255, 255), (48, 48, 48)
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
    elif anchor == 'top 2': base = M + SCALE[2] + cap
    else: base = GY[0] if anchor == 'golden line 1' else GY[1]
    top = base - cap
    sy = base + SCALE[4] + round(SENT * 0.78)    # first sentence baseline
    cr = credit.upper()
    cl = [cr] if tlen(cr, fc, TRK_CRED) <= cw else [p.strip() for p in cr.split('·')]
    cy = sy + (len(sl) - 1) * lead + SCALE[4] + CRED + 6
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
    if crit[a].mean() > 0.002 or main[a].mean() > 0.002: return None
    lum = np.asarray(Image.open(f'crop/{n}.jpg').convert('L'), np.float32)[a].mean()
    return (SCALE.index(L['bs']), round(bg[a].mean() * 3 + max(0, lum - 110) / 60, 3))

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

def draw(img, L):
    base = img.convert('RGBA')
    fb, fs, fc = F('Bold', L['bs']), F('Serif', SENT), F('Bold', CRED)
    def put(d, fill, cfill):
        ttext(d, (L['x0'], L['base']), L['word'], fb, TRK_BIG, fill)
        for i, t in enumerate(L['sl']): d.text((L['x0'], L['sy'] + i * L['lead']), t, font=fs, fill=fill, anchor='ls')
        for j, c in enumerate(L['cl']): ttext(d, (L['x0'], L['cy'] + j * round(CRED * 1.7)), c, fc, TRK_CRED, cfill)
    txt = Image.new('L', (W, H), 0); put(ImageDraw.Draw(txt), 255, 255)
    halo = txt.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(2.5)).point(lambda v: int(min(255, v * 2.6) * 0.9))
    base = Image.alpha_composite(base, Image.merge('RGBA', [Image.new('L', (W, H), c) for c in SHADOW] + [halo]))
    sh = Image.new('L', (W, H), 0); sh.paste(txt.filter(ImageFilter.GaussianBlur(1)).point(lambda v: int(v * 0.9)), (1, 2))
    base = Image.alpha_composite(base, Image.merge('RGBA', [Image.new('L', (W, H), c) for c in SHADOW] + [sh]))
    put(ImageDraw.Draw(base), CREAM + (255,), WHITE + (235,))
    return base.convert('RGB')

def overlay(img, L=None):
    o = img.convert('RGBA'); g = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(g)
    for y in range(M, H - M + 1, SCALE[4]): d.line([(M, y), (W - M, y)], fill=(255, 255, 255, 28))
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
    S = json.load(open(os.path.join(GD, 'demos.json'))); out = []
    for k, s in enumerate(S):
        c = best(s['photo'], s['word'], s['line'], s['credit'])
        if s.get('force'): c = [(None, layout(s['word'], s['line'], s['credit'], *s['force']))] + c
        if not c: print(s['photo'], 'NO SPOT'); continue
        L = c[0][1]; print(s['photo'], L['col'], L['anchor'], 'word', L['bs'], 'lines', len(L['sl']), 'others', [(t[1]['col'], t[1]['anchor'], t[1]['bs']) for t in c[1:4]])
        im = Image.open(f"crop/{s['photo']}.jpg").convert('RGB'); clean = draw(im, L)
        clean.save(os.path.join(GD, f'v2demo{k+1}.jpg'), quality=93); overlay(clean, L).save(os.path.join(GD, f'v2demo{k+1}_grid.jpg'), quality=90)
