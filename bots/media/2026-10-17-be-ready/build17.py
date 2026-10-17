# Render all 40 slides + one contact sheet per post. force15.json can pin [size, width, x0, y0] per photo.
import json, os, sys, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import r17 as r15
from PIL import Image, ImageDraw, ImageFont
D = os.path.dirname(os.path.abspath(__file__))
P = json.load(open(os.path.join(D, 'lines.json'))); C = json.load(open(os.path.join(D, os.environ.get('COSTFILE', 'cost15.json'))))
A = json.load(open(os.path.join(D, 'assign15.json')))
GRAD = json.load(open(os.path.join(D, 'grad17.json'))) if os.path.exists(os.path.join(D, 'grad17.json')) else {}
F = json.load(open(os.path.join(D, os.environ.get('FORCEFILE', 'force15.json')))) if os.path.exists(os.path.join(D, os.environ.get('FORCEFILE', 'force15.json'))) else {}
for k in (sys.argv[1:] or sorted(P)):
    d = os.path.join(D, os.environ.get('OUTDIR', 'out'), k); shutil.rmtree(d, ignore_errors=True); os.makedirs(d); js = []
    for i in range(10):
        s = f'{k}{i}'; p = A[s]; L0 = P[k]['lines'][i]
        if p is None:
            Image.new('RGB', (1080, 1350), (60, 60, 60)).save(os.path.join(d, f'{i+1:02d}_EMPTY.jpg')); js.append(dict(slide=i + 1, photo='EMPTY', id=L0['id'], line=L0['line'])); continue
        size, width, x0, y0 = F.get(p) or C[p][s][1:5]
        L = r15.layout(L0['line'], size, width, L0['credit'], hook=(i == 0))
        I = json.load(open(os.path.join(D, 'crop_info.json')))[p]
        src = Image.open(os.path.join(D, 'crop', p + '.jpg')).convert('RGB')
        if p in GRAD:  # darken a blown-out top like a graduated filter, so cream text reads
            import numpy as np
            gk, gY = GRAD[p]; a = np.asarray(src, dtype=np.float32); yy = np.arange(1350, dtype=np.float32)
            gf = 1 - gk * np.clip(1 - yy / gY, 0, 1) ** 1.5
            src = Image.fromarray((a * gf[:, None, None]).clip(0, 255).astype('uint8'))
        img = r15.draw_text(src, L, L0['credit'], x0, y0, padx=I['padx'] if I['kind'] == 'pad' else 0)
        fn = f'{i+1:02d}_{p}.jpg'; img.save(os.path.join(d, fn), quality=92)
        js.append(dict(slide=i + 1, photo=p, id=L0['id'], line=L0['line'], credit=L0['credit'], size=size, width=width, x0=x0, y0=y0))
    json.dump(js, open(os.path.join(d, 'slides.json'), 'w'), ensure_ascii=False, indent=1)
    sh = Image.new('RGB', (5 * 432, 2 * 540))
    for j, e in enumerate(js):
        sh.paste(Image.open(os.path.join(d, f"{e['slide']:02d}_{e['photo']}.jpg")).resize((432, 540)), ((j % 5) * 432, (j // 5) * 540))
    sh.save(os.path.join(D, f"sheet{os.environ.get('SHEETTAG', '')}_{k}.jpg"), quality=88); print(k, 'ok')
