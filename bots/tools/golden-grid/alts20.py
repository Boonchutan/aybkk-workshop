# Render the best distinct layouts for one slide so a human can pick: python alts20.py spec.json N out.jpg [nalts]
import os, sys, json
from PIL import Image, ImageDraw, ImageFont
import importlib; e = importlib.import_module(os.environ.get('ENG', 'eng20c'))
spec, n, outp = json.load(open(sys.argv[1])), int(sys.argv[2]), sys.argv[3]; na = int(sys.argv[4]) if len(sys.argv) > 4 else 6
s = spec[n - 1]; r = e.best(s); seen = set(); picks = []
for L in r:
    key = (L['t'], L['kind'], L['corner'], L['scorner'])
    if key in seen: continue
    seen.add(key); picks.append(L)
    if len(picks) == na: break
f = ImageFont.truetype(os.path.join(e.GD, 'fonts', 'NimbusSans-Bold.otf'), 24)
sh = Image.new('RGB', (len(picks) * 444 + 12, 600), (236, 234, 228)); d = ImageDraw.Draw(sh)
for i, L in enumerate(picks):
    sh.paste(e.render(L, s['word']).resize((432, 540)), (12 + i * 444, 12))
    d.text((12 + i * 444, 560), f"{i+1}: t {L['t']} {L['kind']} {L['corner']}/{L['scorner']} {L['bs']} {L['score']:.2f}", font=f, fill=(20, 20, 20))
sh.save(outp, quality=85)
json.dump([dict(t=L['t'], kind=L['kind'], pos=L['corner'], spos=L['scorner'], bs=L['bs'], cw=L['cw'], score=round(L['score'], 2)) for L in picks], open(outp + '.json', 'w'))
print(outp)
