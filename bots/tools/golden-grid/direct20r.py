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
sx, sy = s['sxy']; sx = fr['R'] - sg['w'] if sx == 'R' else sx; sr = (sx, sy, sx + sg['w'], sy + sg['h'])
st = e.Stats(fr)
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
print('saved', bs, round(ww), 'rot', rot)
