# Contact sheet of a post: each slide with its number, plus a small view of the full photo showing what the crop cut.
import os, sys, json
from PIL import Image, ImageDraw, ImageFont
WD = os.environ['WD']; out_dir = sys.argv[1]; title = sys.argv[2] if len(sys.argv) > 2 else ''
log = [l for l in json.load(open(os.path.join(out_dir, 'log.json'))) if not l.get('fail')]
f = ImageFont.truetype(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fonts', 'NimbusSans-Bold.otf'), 30)
TW, TH = 432, 540; FW = 160; cols = 3
cell_w = TW + FW + 24; rows = (len(log) + cols - 1) // cols
sh = Image.new('RGB', (cols * cell_w + 24, rows * (TH + 60) + 80), (236, 234, 228)); d = ImageDraw.Draw(sh)
d.text((24, 22), title, font=f, fill=(20, 20, 20))
for i, l in enumerate(log):
    x, y = 24 + (i % cols) * cell_w, 80 + (i // cols) * (TH + 60)
    sl = Image.open(os.path.join(out_dir, f"{l['n']:02d}.jpg")).resize((TW, TH)); sh.paste(sl, (x, y))
    full = Image.open(os.path.join(WD, 'full', l['photo'] + '.jpg')).resize((FW, 240)); dd = ImageDraw.Draw(full)
    k = 240 / 1620; tt = 0 if l['t'] == 'pad' else l['t']; dd.rectangle([1, tt * k, FW - 2, (tt + (1620 if l['t'] == 'pad' else 1350)) * k], outline=(40, 200, 40) if l['t'] == 'pad' else (255, 40, 40), width=3)
    sh.paste(full, (x + TW + 8, y))
    d.text((x, y + TH + 8), f"{l['n']}  ·  {l['photo'][3:]}  ·  t {l['t']}", font=f, fill=(20, 20, 20))
sh.save(os.path.join(out_dir, 'sheet.jpg'), quality=86)
print(os.path.join(out_dir, 'sheet.jpg'))
