"""Burned-in captions for The Perfectionist, Hidden Stories style: Montserrat, lowercase, white, soft dark shadow,
max 2 rows, quick fade in. Output: work/caps.mov (1080x300 RGBA, qtrle), overlaid at y CAPY by broll.py --caps."""
import json, subprocess, imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont, ImageFilter
FF = imageio_ffmpeg.get_ffmpeg_exe()
S = '/tmp/claude-0/-home-user-aybkk-workshop/5fef75e8-f96a-51ec-a2b6-837dec39c8e1/scratchpad/'
P = S + 'perf/'
FONT = S + 'fonts_dl/Montserrat.ttf'
BW, BH, SIZE, GAP, MAXW, FPS, N = 1080, 300, 66, 18, 940, 30, 2049
_f = {}
def mont(wg):
    if wg not in _f:
        f = ImageFont.truetype(FONT, SIZE); f.set_variation_by_axes([wg]); _f[wg] = f
    return _f[wg]
def low(t):
    return ' '.join(w if w.isupper() and len(w) > 1 else w.lower() for w in t.split())
caps = [(a, b, low(t)) for a, b, t in json.load(open(P + 'work/captions.json'))]
def rows(text):
    f = mont(800); ws = text.split()
    if f.getlength(text) <= MAXW: return [text]
    best = None
    for k in range(1, len(ws)):
        a, b = ' '.join(ws[:k]), ' '.join(ws[k:]); m = max(f.getlength(a), f.getlength(b))
        if best is None or m < best[0]: best = (m, [a, b])
    return best[1]
cache = {}
def card(text):
    if text in cache: return cache[text]
    txt = Image.new('RGBA', (BW, BH), (0, 0, 0, 0)); d = ImageDraw.Draw(txt); f = mont(800)
    rs = rows(text); y = 20
    for r in rs:
        d.text(((BW - f.getlength(r)) / 2, y), r, font=f, fill=(255, 255, 255, 255)); y += SIZE + GAP
    sh = Image.new('RGBA', (BW, BH), (0, 0, 0, 0)); sh.paste((0, 0, 0, 190), mask=txt.getchannel('A')); sh = sh.filter(ImageFilter.GaussianBlur(7))
    out = Image.alpha_composite(sh, txt); cache[text] = out; return out
blank = Image.new('RGBA', (BW, BH), (0, 0, 0, 0))
p = subprocess.Popen([FF, '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{BW}x{BH}', '-r', str(FPS), '-i', '-',
                      '-c:v', 'qtrle', P + 'work/caps.mov'], stdin=subprocess.PIPE)
for n in range(N):
    t = n / FPS; cur = [c for c in caps if c[0] <= t < c[1]]
    if not cur: p.stdin.write(blank.tobytes()); continue
    a, b, text = cur[0]; im = card(text)
    k = min(1.0, (t - a) / 0.1)
    if k < 1:
        im = im.copy(); im.putalpha(im.getchannel('A').point(lambda v, k=k: int(v * k)))
    p.stdin.write(im.tobytes())
p.stdin.close(); p.wait()
print('caps', len(caps), 'two-row:', sum(1 for c in caps if len(rows(c[2])) > 1))
