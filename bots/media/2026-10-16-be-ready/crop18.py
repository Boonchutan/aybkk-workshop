# 4:5 frames, no white bars: keep the top (30 px above the body), cut the bottom, and stamp the photographer's watermark at the usual spot.
import json, os
import numpy as np, cv2
from PIL import Image
from scipy import ndimage
from ai_edge_litert.interpreter import Interpreter
D = os.path.dirname(os.path.abspath(__file__))
it = Interpreter(model_path=os.path.join(D, 'deeplab.tflite')); it.allocate_tensors()
inp = it.get_input_details()[0]; outd = it.get_output_details()[0]
WY0, WY1, WX0, WX1, SHIFT = 1385, 1560, 220, 860, 270


def mask(img, size):
    x = np.asarray(img.convert('RGB').resize((257, 257)), dtype=np.float32) / 127.5 - 1
    it.set_tensor(inp['index'], x[None]); it.invoke()
    m = (np.argmax(it.get_tensor(outd['index'])[0], -1) == 15).astype(np.uint8) * 255
    return np.asarray(Image.fromarray(m).resize(size, Image.BILINEAR)) > 127


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


OV = json.load(open(os.path.join(D, 'top_override.json'))) if os.path.exists(os.path.join(D, 'top_override.json')) else {}
info = {}
for f in sorted(os.listdir(os.path.join(D, '../dl'))):
    n = f[:-4]; im = Image.open(os.path.join(D, '../dl', f)); im.draft('RGB', (1344, 2016))
    big = np.asarray(im.convert('RGB').resize((1080, 1620), Image.LANCZOS)).copy()
    m = mask(Image.fromarray(big), (1080, 1620)); lab, k = ndimage.label(m)
    if k:
        sz = ndimage.sum(m, lab, range(1, k + 1)); main = [i + 1 for i, s in enumerate(sz) if s >= 0.3 * sz.max()]
        top = int(np.where(np.isin(lab, main))[0].min())
    else:
        top = 270
    t = OV.get(n, max(0, min(270, top - 30)))
    out = big[t:t + 1350].copy(); moved = False
    if t < 270:
        reg = big[WY0:WY1, WX0:WX1]; a = wm_alpha(reg)
        if (a > 0.5).sum() > 800:
            o0 = WY0 - t
            if o0 < 1350:
                mm = np.zeros(out.shape[:2], np.uint8); h = min(WY1 - WY0, 1350 - o0)
                mm[o0:o0 + h, WX0:WX1] = cv2.dilate((a[:h] > 0.05).astype(np.uint8), np.ones((7, 7), np.uint8)) * 255
                out = cv2.inpaint(out, mm, 5, cv2.INPAINT_TELEA)
            y0 = WY0 - SHIFT; dst = out[y0:y0 + (WY1 - WY0), WX0:WX1].astype(np.float32); A = a[..., None]
            out[y0:y0 + (WY1 - WY0), WX0:WX1] = (dst * (1 - A) + reg.astype(np.float32) * A).astype(np.uint8); moved = True
    Image.fromarray(out).save(os.path.join(D, 'crop', n + '.jpg'), quality=93)
    fm = mask(Image.fromarray(out), (1080, 1350)); Image.fromarray((fm * 255).astype(np.uint8)).save(os.path.join(D, 'mask', n + '.png'))
    info[n] = dict(t=t, kind='crop', padx=0, wm_top=int(0.875 * 1620 - SHIFT), body_top=top, wm_moved=moved)
    print(n, info[n], flush=True)
json.dump(info, open(os.path.join(D, 'crop_info.json'), 'w'), indent=1)
