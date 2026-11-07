# GRID version (Boonchu 7 Nov: small text must follow the grid). sxy x may be a number (left edge), 'R' (right edge on the 1020 margin)
# or 'R413' / 'R667' (right edge on that golden line). Prints a GRID line: the small text column must be 353 or 607 wide and sit on a grid column.
# Optional 4th arg 'grid' also saves <out>_grid.jpg with the grid lines drawn.
# direct20 + a rotated big word + sburn: python direct20r.py spec.json N out.jpg   (run from $WD/tools, env WD and ENG set)
# Extra row fields: wrot 90 = reads bottom to top, -90 = top to bottom (0 or missing = the plain direct20 layout);
# wpos is the top-left of the rotated box, wwidth is the word's length along its reading direction;
# wshadow = strength of the dark shadow behind the white word (engine default 1.0); wburn = soft local darkening behind it (0..0.3).
import sys, json, os, importlib; sys.path.insert(0, os.getcwd())
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFilter
e = importlib.import_module(os.environ.get('ENG', 'eng23'))
s = json.load(open(sys.argv[1]))[int(sys.argv[2]) - 1]
rot = s.get('wrot', 0)
fr = e.frame(s['photo'], s['t'], s.get('wm'), s.get('tight', False), s.get('wmxy'), s.get('wmk', 1.0))
bs = e.size_for(s['word'], s['wwidth']); wg = e.word_geom(s['word'], bs)
ww, wh = wg['w'], wg['asc'] + wg['desc']
x, y = s['wpos']
wr = (x, y, x + wh, y + ww) if rot else (x, y, x + ww, y + wh)
sg = e.sent_geom(s.get('line_br', s['line']), s['credit'], s['cws'][0], lead_k=1.0, sz=s.get('sz', e.SENT))
sx, sy = s['sxy']; sx = ((fr['R'] if sx == 'R' else int(sx[1:])) - sg['w']) if isinstance(sx, str) else sx; sr = (sx, sy, sx + sg['w'], sy + sg['h'])
st = e.Stats(fr)
COLS = [(60, 413), (667, 1020), (60, 667), (413, 1020)]
def grid_check():
    bad = []; cw = s['cws'][0]; L, R = sr[0], sr[2]; T, B = sr[1], sr[3]
    if cw not in (353, 607): bad.append('column width %s, must be 353 or 607' % cw)
    if s.get('sright'):
        if not any(abs(R - c1) <= 1.5 and c1 - c0 == cw for c0, c1 in COLS): bad.append('right edge %d must sit on a column end (413, 667 or 1020) matching its width' % R)
    else:
        if not any(abs(L - c0) <= 1.5 and c1 - c0 == cw for c0, c1 in COLS): bad.append('left edge %d must sit on a column start (60, 413 or 667) matching its width' % L)
    yok = any(abs(T - y) <= 2 for y in (60, 516, 834)) or any(abs(B - y) <= 2 for y in (516, 834, 1120, 1290)) or abs(((T - 60) + 26) % 52 - 26) <= 2
    if not yok: bad.append('top %d / bottom %d: put the top on 60, 516 or 834, or the bottom on 516, 834, 1120 (or 1290 when the watermark is on the other side), or the top on the 52 px baseline grid (60 + 52k)' % (T, B))
    return bad
_g = grid_check(); print('GRID', 'OK' if not _g else 'FAIL: ' + '; '.join(_g))
wl = [v for v in (wr[0], wr[2]) if any(abs(v - g) <= 4 for g in (60, 413, 667, 1020))]
print('word-grid', 'edge on a grid line' if wl else 'no edge on a grid line (prefer one)')
for nm, r, k in (('word', wr, 'w'), ('sent', sr, 's')): print(nm, [round(v) for v in r], st.part(r, k, False))
W, H = e.W, e.H
img = fr['img']
burn = s.get('wburn', 0)
if burn:
    a = np.asarray(img, np.float32); m = np.zeros((H, W), np.float32)
    m[int(wr[1]) - 10:int(wr[3]) + 10, max(0, int(wr[0]) - 30):int(wr[2]) + 10] = 1
    m = cv2.GaussianBlur(m, (0, 0), 28) * burn * (~fr['person']).astype(np.float32)
    img = Image.fromarray((a * (1 - m[..., None])).astype(np.uint8))
sburn = s.get('sburn', 0)   # soft local darkening behind a light sentence block (0..0.4), for readability on busy or bright areas
if sburn:
    a = np.asarray(img, np.float32); m = np.zeros((H, W), np.float32)
    m[max(0, int(sr[1]) - 16):int(sr[3]) + 16, max(0, int(sr[0]) - 24):int(sr[2]) + 24] = 1
    m = cv2.GaussianBlur(m, (0, 0), 30) * sburn
    img = Image.fromarray((a * (1 - m[..., None])).astype(np.uint8))
fr2 = dict(fr, img=img)
L = dict(kind='split', wr=wr, sr=sr, bs=bs, wg=wg, sg=sg, wink=s.get('ink_w', 'light'), sink=s.get('ink_s', 'light'), right=False, sright=s.get('sright', False), fr=fr2)
if not rot:
    out = e.render(L, s['word'], shadow=s.get('shadow', 1.0))
else:
    out = e.render(L, '', shadow=s.get('shadow', 1.0)).convert('RGBA')   # photo + sentence, the word is drawn below
    pad = 30; tmp = Image.new('L', (int(np.ceil(ww)) + 2 * pad, wh + 2 * pad), 0)
    e.ttext(ImageDraw.Draw(tmp), (pad, pad + wg['asc']), s['word'], e.F('Big', bs), e.TRK_BIG, 255, wg.get('sw', 0))
    tmp = tmp.transpose(Image.Transpose.ROTATE_90 if rot > 0 else Image.Transpose.ROTATE_270)
    txt = Image.new('L', (W, H), 0); txt.paste(tmp, (int(round(x)) - pad, int(round(y)) - pad))
    k = s.get('wshadow', 1.0); light = s.get('ink_w', 'light') == 'light'
    sh = Image.new('L', (W, H), 0)
    sh.paste(txt.filter(ImageFilter.GaussianBlur(7 * k)).point(lambda v: int(min(255, v * 1.5 * k) * (0.55 if light else 0.4))), (0, 4 if light else 0))
    col = e.SHADOW if light else e.GLOW
    out = Image.alpha_composite(out, Image.merge('RGBA', [Image.new('L', (W, H), c) for c in col] + [sh]))
    out.paste(Image.new('RGBA', (W, H), (e.LIGHT if light else e.DARK) + (255,)), (0, 0), txt)
    out = out.convert('RGB')
    ys, xs = np.where(np.asarray(txt) > 128); print('ink', [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())])
out.save(sys.argv[3], quality=93)
if len(sys.argv) > 4 and sys.argv[4] == 'grid':
    gv = out.copy(); gd = ImageDraw.Draw(gv)
    for X in (60, 413, 667, 1020): gd.line([(X, 0), (X, H)], fill=(0, 255, 255), width=2)
    for Y in (60, 516, 834, 1120): gd.line([(0, Y), (W, Y)], fill=(255, 0, 255), width=2)
    gv.save(sys.argv[3][:-4] + '_grid.jpg', quality=85)
print('saved', bs, round(ww), 'rot', rot)
