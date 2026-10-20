# Review sheet: slides at a readable size, numbered, with the photo id
import os, sys, json
from PIL import Image, ImageDraw, ImageFont
D = sys.argv[1]; log = json.load(open(os.path.join(D, 'log.json')))
f = ImageFont.truetype(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fonts', 'NimbusSans-Bold.otf'), 26)
cols = 5 if len(log) == 10 else 4; TW, TH = 432, 540
sh = Image.new('RGB', (cols * (TW + 12) + 12, ((len(log) + cols - 1) // cols) * (TH + 46) + 12), (236, 234, 228)); d = ImageDraw.Draw(sh)
for i, l in enumerate(log):
    x, y = 12 + (i % cols) * (TW + 12), 12 + (i // cols) * (TH + 46)
    sh.paste(Image.open(os.path.join(D, f"{l['n']:02d}.jpg")).resize((TW, TH), Image.LANCZOS), (x, y))
    d.text((x, y + TH + 8), f"{l['n']}  ·  {l['photo'][3:]}  ·  {'full photo' if l['t'] == 'pad' else 'crop'}", font=f, fill=(20, 20, 20))
sh.save(os.path.join(D, 'big.jpg'), quality=86); print(os.path.join(D, 'big.jpg'))
