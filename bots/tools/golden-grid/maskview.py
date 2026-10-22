import sys, numpy as np, eng20f as e
from PIL import Image, ImageDraw
n, t, out = sys.argv[1], sys.argv[2], sys.argv[3]; t = t if t == 'pad' else int(t)
fr = e.frame(n, t, None, len(sys.argv) > 4)
img = np.asarray(fr['img'].convert('RGB')).copy().astype(float)
for k, col in (('crit',(255,0,0)),('bgc',(255,160,0)),('feet',(0,0,255)),('bfeet',(0,120,255)),('wm',(0,255,0))):
    m = np.asarray(fr[k], bool); img[m] = img[m]*0.5 + np.array(col)*0.5
im = Image.fromarray(img.astype(np.uint8)); d = ImageDraw.Draw(im)
for y in range(0, 1350, 100): d.line([(0,y),(18,y)], fill=(255,255,0), width=3); d.text((22,y-6), str(y), fill=(255,255,0))
for x in range(0, 1080, 100): d.line([(x,0),(x,18)], fill=(255,255,0), width=3); d.text((x+3,20), str(x), fill=(255,255,0))
im.resize((540,675)).save(out); print(fr['L'], fr['R'], fr['wmode'])
