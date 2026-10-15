# Sets 2-3 (Boonchu 15 Oct evening): back to the serif (Merriweather Black) on all slides, pastel yellow, shorter shadow.
import os, re, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
D = os.path.dirname(os.path.abspath(__file__))
MUSTARD = (255, 236, 153)
TOP = 96
HALO_BLUR = 2.5
SIZES = (96, 88, 80, 72, 66, 60, 54, 48, 44, 40)
WIDTHS = (1000, 920, 840, 760, 680, 600, 520, 460, 400, 340, 300, 260)
CREDIT = 25
_fc = {}


def font(path, size, var=None):
    k = (path, size, var)
    if k not in _fc:
        f = ImageFont.truetype(path, size)
        if var:
            f.set_variation_by_name(var)
        _fc[k] = f
    return _fc[k]


def qfont(size): return font(os.path.join(D, 'fonts/Merriweather[opsz,wdth,wght].ttf'), size, 'Black')
def cfont(): return font(os.path.join(D, 'fonts/Montserrat.ttf'), CREDIT, 'Medium')
def thfont(): return font(os.path.join(D, 'fonts/anuphan-th.ttf'), CREDIT + 4)
def cjkfont(): return font('/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', CREDIT)


def sp(f): return f.getlength(' ') + 0.04 * f.size


def tlen(t, f):
    ws = t.split(); return sum(f.getlength(w) for w in ws) + sp(f) * (len(ws) - 1)


def put_line(d, x, y, t, f, fill):
    for w in t.split():
        d.text((x, y), w, font=f, fill=fill); x += f.getlength(w) + sp(f)


def wrap(text, f, width):
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if tlen(t, f) <= width or not cur:
            cur = t
        else:
            lines.append(cur); cur = w
    if cur:
        lines.append(cur)
    return lines


def cwidth(t): return sum(fn.getlength(s) for s, fn in segs(t))


def credit_lines(credit, width):
    if cwidth(credit) <= width or ' · ' not in credit: return [credit]
    a, b = credit.split(' · ', 1); return [a, b]


def layout(line, size, width, credit='', hook=False):
    f = qfont(size); ql = wrap(line, f, width)
    lh = int(size * 1.13)
    cl = credit_lines(credit, width) if credit else ['']
    tw = max([tlen(l, f) for l in ql] + [cwidth(c) for c in cl])
    h = len(ql) * lh + 18 + int(CREDIT * 1.5) * len(cl)
    return dict(size=size, width=width, lines=ql, lh=lh, h=h, tw=int(tw), credit=cl)


def segs(text):
    out = []
    for m in re.finditer(r'[฀-๿][฀-๿\s]*|[ᄀ-ᇿ㄰-㆏가-힯぀-ヿ一-鿿][ᄀ-ᇿ㄰-㆏가-힯぀-ヿ一-鿿\s]*|[^฀-๿ᄀ-ᇿ㄰-㆏가-힯぀-ヿ一-鿿]+', text):
        s = m.group(0); c = s.strip()[:1] if s.strip() else ''
        f = thfont() if c and '฀' <= c <= '๿' else (cjkfont() if c and ord(c) > 0x1000 else cfont())
        out.append((s, f))
    return out


def draw_text(img, L, credit, x0, y0, align='left', padx=0):
    """img: RGB 1080x1350. Draws halo, shadow, mustard lines and white credit."""
    base = img.convert('RGBA'); W, H = base.size
    txt = Image.new('L', (W, H), 0); dt = ImageDraw.Draw(txt)
    f = qfont(L['size']); y = y0; pos = []
    for l in L['lines']:
        lw = tlen(l, f); x = x0 if align == 'left' else x0 + (L['width'] - lw) / 2
        put_line(dt, x, y, l, f, 255); pos.append((x, y, l)); y += L['lh']
    cy0 = y + 18 - int(L['size'] * 0.13)
    cx = pos[0][0]
    cls = L.get('credit') or credit_lines(credit, L['width'])
    for j, c in enumerate(cls):
        xx = cx; cy = cy0 + j * int(CREDIT * 1.5)
        for s, fn in segs(c):
            dt.text((xx, cy), s, font=fn, fill=255); xx += fn.getlength(s)
    halo = txt.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(HALO_BLUR))
    halo = halo.point(lambda v: int(min(255, v * 2.6) * 0.9))
    if padx:
        clip = Image.new('L', (W, H), 0); ImageDraw.Draw(clip).rectangle([padx, 0, W - padx - 1, H], fill=255)
        from PIL import ImageChops
        halo = ImageChops.multiply(halo, clip)
    base = Image.alpha_composite(base, Image.merge('RGBA', [Image.new('L', (W, H), 0)] * 3 + [halo]))
    sh = txt.filter(ImageFilter.GaussianBlur(1)).point(lambda v: int(v * 0.9))
    shifted = Image.new('L', (W, H), 0); shifted.paste(sh, (1, 2))
    if padx: shifted = ImageChops.multiply(shifted, clip)
    base = Image.alpha_composite(base, Image.merge('RGBA', [Image.new('L', (W, H), 0)] * 3 + [shifted]))
    d = ImageDraw.Draw(base)
    for x, y, l in pos:
        put_line(d, x, y, l, f, MUSTARD + (255,))
    for j, c in enumerate(cls):
        xx = cx; cy = cy0 + j * int(CREDIT * 1.5)
        for s, fn in segs(c):
            d.text((xx, cy), s, font=fn, fill=(255, 255, 255, 235)); xx += fn.getlength(s)
    return base.convert('RGB')
