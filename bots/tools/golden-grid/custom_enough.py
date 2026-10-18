# Boonchu 18 Oct: 'enough' on the bright window, right-aligned, at her face level, serif sentence ABOVE the big word.
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
sys.argv = ['x', sys.argv[1]]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gridsys4 as g
R = 1020                                   # right margin line
word, line, credit = 'enough', 'Eat just enough, keep regular hours, never overdo it: body and spirit stay together.', 'Suwen, Chinese medical classic, ch. 1'
fb, fs, fc = g.F('Bold', 178), g.F('Serif', g.SENT), g.F('Bold', g.CRED)
sl = g.wrap(line, fs, R - g.GX[0])
lead = round(g.SENT * 1.12)
cap = fb.getbbox('H')[3] - fb.getbbox('H')[1]
s_base0 = int(sys.argv[2]) if len(sys.argv) > 2 else 318      # first sentence baseline
w_base = s_base0 + (len(sl) - 1) * lead + 26 + cap
c_base = w_base + 26 + g.CRED + 6
def tl(t, f, trk): return g.tlen(t, f, trk)
def put(d, fill, cfill):
    for i, t in enumerate(sl): d.text((R - fs.getlength(t), s_base0 + i * lead), t, font=fs, fill=fill, anchor='ls')
    g.ttext(d, (R - tl(word, fb, g.TRK_BIG), w_base), word, fb, g.TRK_BIG, fill)
    c = credit.upper(); g.ttext(d, (R - tl(c, fc, g.TRK_CRED), c_base), c, fc, g.TRK_CRED, cfill)
img = Image.open('crop/17-214.jpg').convert('RGB'); W, H = img.size
txt = Image.new('L', (W, H), 0); put(ImageDraw.Draw(txt), 255, 255)
sh = Image.new('L', (W, H), 0); sh.paste(txt.filter(ImageFilter.GaussianBlur(7)).point(lambda v: int(min(255, v * 1.5) * 0.4)), (0, 0))
base = Image.alpha_composite(img.convert('RGBA'), Image.merge('RGBA', [Image.new('L', (W, H), c) for c in g.GLOW] + [sh]))
put(ImageDraw.Draw(base), g.DARK + (255,), g.DARK + (235,))
out = base.convert('RGB'); out.save(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'enough_v5.jpg'), quality=93)
g.overlay(out).save(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'enough_v5_grid.jpg'), quality=90)
print('sentence lines', sl, 'word baseline', w_base, 'cap top', w_base - cap, 'credit', c_base)
