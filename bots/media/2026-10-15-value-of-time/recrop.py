# Boonchu 15 Oct: no white side bars. Fill 4:5 by cutting the bottom, then stamp the photographer's watermark higher (same spot as the other slides).
import json, os, sys, shutil
import numpy as np, cv2
from PIL import Image
from scipy import ndimage
D = os.path.dirname(os.path.abspath(__file__))
INFO = json.load(open(os.path.join(D, 'crop_info.json')))
WY0, WY1, WX0, WX1 = 1385, 1560, 220, 860
SHIFT = 270


def wm_alpha(rgb):
    L = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    bg = cv2.medianBlur(L.astype(np.uint8), 31).astype(np.float32)
    sat = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)[..., 1].astype(np.float32)
    a = np.clip((L - bg - 10) / np.maximum(255 - bg - 10, 30), 0, 1)
    a[sat > 70] = 0
    lab, k = ndimage.label(a > 0.25)
    if k:
        sz = ndimage.sum(np.ones_like(a), lab, range(1, k + 1))
        for i, s in enumerate(sz):
            if s > 4000: a[lab == i + 1] = 0
    return a


for n in sys.argv[1:]:
    info = INFO[n]
    if not os.path.exists(os.path.join(D, 'crop_pad', n + '.jpg')):
        shutil.copy(os.path.join(D, 'crop', n + '.jpg'), os.path.join(D, 'crop_pad', n + '.jpg'))
        shutil.copy(os.path.join(D, 'mask', n + '.png'), os.path.join(D, 'mask_pad', n + '.png'))
    im = Image.open(os.path.join(D, '../dl', n + '.jpg')); im.draft('RGB', (1344, 2016))
    big = np.asarray(im.convert('RGB').resize((1080, 1620), Image.LANCZOS)).copy()
    t = info['t']
    reg = big[WY0:WY1, WX0:WX1]; a = wm_alpha(reg)
    out = big[t:t + 1350].copy()
    o0 = WY0 - t
    if o0 < 1350:
        m = np.zeros(out.shape[:2], np.uint8)
        h = min(WY1 - WY0, 1350 - o0)
        m[o0:o0 + h, WX0:WX1] = (cv2.dilate((a[:h] > 0.05).astype(np.uint8), np.ones((7, 7), np.uint8)) * 255)
        out = cv2.inpaint(out, m, 5, cv2.INPAINT_TELEA)
    y0 = WY0 - SHIFT - t + t
    y0 = WY0 - SHIFT
    dst = out[y0:y0 + (WY1 - WY0), WX0:WX1].astype(np.float32)
    A = a[..., None]
    out[y0:y0 + (WY1 - WY0), WX0:WX1] = (dst * (1 - A) + reg.astype(np.float32) * A).astype(np.uint8)
    Image.fromarray(out).save(os.path.join(D, 'crop', n + '.jpg'), quality=93)
    Image.fromarray((a * 255).astype(np.uint8)).save(os.path.join(D, 'crop_pad', n + '_wm.png'))
    k = (1620 - t) / 1350
    info.update(kind='crop', padx_old=info['padx'], padx=0, k_old=k, wm_top=int(0.875 * 1620 - SHIFT))
    print(n, 'ok', 't', t, 'k', round(k, 3), 'wm alpha px', int((a > 0.5).sum()))
json.dump(INFO, open(os.path.join(D, 'crop_info.json'), 'w'), indent=1)
