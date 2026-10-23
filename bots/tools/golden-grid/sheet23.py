import sys, os
from PIL import Image, ImageDraw
d = sys.argv[1]; out = sys.argv[2]
c = Image.new('RGB', (5 * 436 + 10, 2 * 550 + 20), 'white'); dr = ImageDraw.Draw(c)
for i in range(10):
    p = os.path.join(d, '%02d.jpg' % (i + 1)); x = 10 + (i % 5) * 436; y = 10 + (i // 5) * 555
    if os.path.exists(p): c.paste(Image.open(p).resize((432, 540)), (x, y))
    else: dr.rectangle((x, y, x + 432, y + 540), outline=(200, 0, 0), width=4)
    dr.text((x + 6, y + 6), str(i + 1), fill=(255, 0, 0))
c.save(out, quality=88)
