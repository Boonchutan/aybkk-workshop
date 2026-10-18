# Boonchu 18 Oct fixes for post I: pad = full photo with white side bars; zoom = tighter crop with the bottom near hands and feet; crop = 4:5 window at row t.
import json, os, sys
import numpy as np, cv2
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
D = os.path.dirname(os.path.abspath(__file__))
import importlib.util
spec = importlib.util.spec_from_file_location('c18', os.path.join(D, 'crop18_lib.py')); c18 = importlib.util.module_from_spec(spec); spec.loader.exec_module(c18)
WY0, WY1, WX0, WX1, SHIFT = c18.WY0, c18.WY1, c18.WX0, c18.WX1, c18.SHIFT
S = json.load(open(sys.argv[1])); info = {}
for n, s in S.items():
    src = Image.open(os.path.join(D, '../dl', n + '.jpg')).convert('RGB')
    big = np.asarray(src.resize((1080, 1620), Image.LANCZOS)).copy()
    reg = big[WY0:WY1, WX0:WX1]; a = c18.wm_alpha(reg)
    k = src.width / 1080
    if s['mode'] == 'pad':
        out = np.full((1350, 1080, 3), 255, np.uint8)
        out[:, 90:990] = np.asarray(src.resize((900, 1350), Image.LANCZOS))
        info[n] = dict(t=0, kind='pad', padx=90, wm_top=int(WY0 * 1350 / 1620) + 7, mode='pad')
    else:
        if s['mode'] == 'zoom':
            x0, y0, w = s['x0'], s['y0'], s['w']; h = w * 1.25
        else:
            x0, y0, w, h = 0, s['t'], 1080, 1350
        out = np.asarray(src.crop((int(x0 * k), int(y0 * k), int((x0 + w) * k), int((y0 + h) * k))).resize((1080, 1350), Image.LANCZOS)).copy()
        sc = 1080 / w; o0 = int((WY0 - y0) * sc)
        if y0 + h <= WY0 + 5 or o0 >= 1350:
            pass
        else:
            mm = np.zeros(out.shape[:2], np.uint8)
            m1 = cv2.resize((a > 0.05).astype(np.uint8), (int((WX1 - WX0) * sc), int((WY1 - WY0) * sc)))
            xa = int((WX0 - x0) * sc); hh = min(m1.shape[0], 1350 - o0)
            mm[o0:o0 + hh, xa:xa + m1.shape[1]] = cv2.dilate(m1[:hh], np.ones((7, 7), np.uint8)) * 255
        stamp = not (s['mode'] == 'crop' and s['t'] >= 190)  # from t=190 the photographer's own watermark text is still fully inside the frame
        if stamp:
            if y0 + h > WY0 + 5 and o0 < 1350: out = cv2.inpaint(out, mm, 5, cv2.INPAINT_TELEA)
            yy = WY0 - SHIFT; dst = out[yy:yy + (WY1 - WY0), WX0:WX1].astype(np.float32); A = a[..., None]
            out[yy:yy + (WY1 - WY0), WX0:WX1] = (dst * (1 - A) + reg.astype(np.float32) * A).astype(np.uint8)
        info[n] = dict(t=int(y0), kind='crop', padx=0, wm_top=int(0.875 * 1620 - SHIFT), mode=s['mode'], spec=s, wm_moved=stamp)
    Image.fromarray(out).save(os.path.join(D, os.environ.get('OUT', 'v2'), 'crop', n + '.jpg'), quality=93)
    fm = c18.mask(Image.fromarray(out), (1080, 1350))
    if info[n]['kind'] == 'pad': fm[:, :90] = False; fm[:, 990:] = False
    Image.fromarray((fm * 255).astype(np.uint8)).save(os.path.join(D, os.environ.get('OUT', 'v2'), 'mask', n + '.png'))
    print(n, info[n], flush=True)
json.dump(info, open(os.path.join(D, os.environ.get('OUT', 'v2'), 'crop_info.json'), 'w'), indent=1)
