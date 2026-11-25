import sys, json, subprocess, numpy as np, imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FF = imageio_ffmpeg.get_ffmpeg_exe()
W, H, K = 1080, 1920, 1.5          # output size, scale from 720x1280 coordinates
FD = '/tmp/claude-0/-home-user-aybkk-workshop/5fef75e8-f96a-51ec-a2b6-837dec39c8e1/scratchpad/wx/fonts/'
BODY = FD + 'ChironGoRoundTCwght900.ttf'
SANS = FD + 'NotoSansSCwght900.ttf'
PUNCT = set('，。、；：！？（）《》“”‘’')
_fc = {}

def font(path, size):
    k = (path, size)
    if k not in _fc:
        _fc[k] = ImageFont.truetype(path, size)
    return _fc[k]

def runs(text, main):
    out, cur, curf = [], '', None
    for ch in text:
        f = SANS if ch in PUNCT else main
        if f != curf and cur:
            out.append((cur, curf)); cur = ''
        cur += ch; curf = f
    if cur: out.append((cur, curf))
    return out

def line_width(text, main, size):
    return sum(font(f, size).getlength(t) for t, f in runs(text, main))

def draw_line(d, x, y, text, main, size, fill, stroke=0, stroke_fill=(0, 0, 0)):
    # x = left edge, y = baseline-free top (anchor 'ls' uses baseline; we use 'lm' middle)
    for t, f in runs(text, main):
        fo = font(f, size)
        d.text((x, y), t, font=fo, fill=fill, anchor='lm', stroke_width=stroke, stroke_fill=stroke_fill)
        x += fo.getlength(t)

def text_layer(lines, main, size, fill, stroke_ratio, shadow, cx, cy, line_gap=1.3, align='center', left=None):
    """RGBA full-frame layer with the lines centred on (cx, cy) in output pixels."""
    L = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(L)
    st = max(1, round(size * stroke_ratio)) if stroke_ratio else 0
    n = len(lines)
    ys = [cy + (i - (n - 1) / 2) * size * line_gap for i in range(n)]
    widths = [line_width(t, main, size) for t in lines]
    xs = []
    for t, w in zip(lines, widths):
        xs.append(left if align == 'left' else cx - w / 2)
    if shadow:
        S = Image.new('RGBA', (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(S)
        for t, x, y in zip(lines, xs, ys):
            draw_line(sd, x + size * 0.04, y + size * 0.06, t, main, size, (0, 0, 0, 170), st + 2, (0, 0, 0, 170))
        S = S.filter(ImageFilter.GaussianBlur(size * 0.08))
        L = Image.alpha_composite(L, S); d = ImageDraw.Draw(L)
    for t, x, y in zip(lines, xs, ys):
        draw_line(d, x, y, t, main, size, fill, st, (20, 20, 20, 255))
    return L, (min(xs), min(ys) - size, max(x + w for x, w in zip(xs, widths)), max(ys) + size)

def hook_layers(h):
    x0, y0, x1, y1 = [v * K for v in h['box']]
    pad = 4
    box = (int(x0 - pad), int(y0 - pad), int(x1 + pad), int(y1 + pad))
    bw, bh = box[2] - box[0], box[3] - box[1]
    lines = h['lines']
    size = int(h.get('size', 54))
    while max(line_width(t, SANS, size) for t in lines) > bw - 60 or len(lines) * size * 1.28 > bh - 20:
        size -= 1
    T = Image.new('RGBA', (bw, bh), (0, 0, 0, 0)); d = ImageDraw.Draw(T)
    n = len(lines)
    for i, t in enumerate(lines):
        y = bh / 2 + (i - (n - 1) / 2) * size * 1.28
        draw_line(d, bw / 2 - line_width(t, SANS, size) / 2, y, t, SANS, size, (15, 15, 15, 255))
    M = Image.new('L', (bw, bh), 0)
    ImageDraw.Draw(M).rounded_rectangle((0, 0, bw - 1, bh - 1), radius=int(14 * K), fill=255)
    return box, T, M, size

def main(spec_path):
    sp = json.load(open(spec_path))
    src, out = sp['src'], sp['out']
    nfr = sp['frames']
    hook = sp.get('hook')
    if hook:
        hbox, hT, hM, hsize = hook_layers(hook)
        print('hook size', hsize)
    layers = []
    for s in sp['subs']:
        L, bb = text_layer(s['lines'], BODY, int(s['size']), tuple(s.get('fill', [255, 255, 255])) + (255,),
                           s.get('stroke', 0.10), s.get('shadow', True), s['cx'] * W, s['cy'] * H,
                           s.get('line_gap', 1.3))
        layers.append((s['f0'], s['f1'], L, s.get('fade', 3)))
    dec = subprocess.Popen([FF, '-loglevel', 'error', '-i', src, '-vf', f'scale={W}:{H}:flags=lanczos', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
    enc = subprocess.Popen([FF, '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', '30', '-i', '-',
                            '-i', src, '-map', '0:v', '-map', '1:a?', '-c:v', 'libx264', '-preset', 'slow', '-crf', str(sp.get('crf', 16)),
                            '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
                            '-c:a', 'copy', '-movflags', '+faststart', '-shortest', out], stdin=subprocess.PIPE)
    fsz = W * H * 3
    for fi in range(nfr):
        raw = dec.stdout.read(fsz)
        if len(raw) < fsz: break
        im = Image.frombuffer('RGB', (W, H), raw).convert('RGBA')
        if hook:
            gone, fade = hook['gone'], hook.get('fade', 8)
            a = 1.0 if fi <= gone else max(0.0, 1 - (fi - gone) / fade)
            if a > 0:
                reg = im.crop(hbox).filter(ImageFilter.GaussianBlur(20))
                white = Image.new('RGBA', reg.size, (255, 255, 255, 255))
                card = Image.blend(reg, white, hook.get('white', 0.86))
                card = Image.alpha_composite(card, hT)
                m = hM if a >= 1 else hM.point(lambda v: int(v * a))
                im.paste(card, hbox[:2], m)
        for f0, f1, L, fd in layers:
            if f0 <= fi < f1:
                a = min(1.0, (fi - f0 + 1) / fd, (f1 - fi) / fd)
                if a < 1:
                    L2 = L.copy(); L2.putalpha(L.getchannel('A').point(lambda v, a=a: int(v * a))); L = L2
                im = Image.alpha_composite(im, L)
        enc.stdin.write(im.convert('RGB').tobytes())
    enc.stdin.close(); enc.wait(); dec.wait()
    print('done', out)

def still(spec_path, frames, out):
    sp = json.load(open(spec_path))
    tmp = dict(sp); tiles = []
    for f in frames:
        raw = subprocess.run([FF, '-loglevel', 'error', '-i', sp['src'], '-vf', f"select=eq(n\\,{f}),scale={W}:{H}:flags=lanczos", '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
        im = Image.frombuffer('RGB', (W, H), raw).convert('RGBA')
        if sp.get('hook') and f <= sp['hook']['gone']:
            hbox, hT, hM, _ = hook_layers(sp['hook'])
            reg = im.crop(hbox).filter(ImageFilter.GaussianBlur(20))
            card = Image.alpha_composite(Image.blend(reg, Image.new('RGBA', reg.size, (255, 255, 255, 255)), sp['hook'].get('white', 0.86)), hT)
            im.paste(card, hbox[:2], hM)
        for s in sp['subs']:
            if s['f0'] <= f < s['f1']:
                L, _ = text_layer(s['lines'], BODY, int(s['size']), tuple(s.get('fill', [255, 255, 255])) + (255,), s.get('stroke', 0.10), s.get('shadow', True), s['cx'] * W, s['cy'] * H, s.get('line_gap', 1.3))
                im = Image.alpha_composite(im, L)
        tiles.append(im.convert('RGB').resize((W // 3, H // 3)))
    sheet = Image.new('RGB', (len(tiles) * W // 3, H // 3))
    for i, t in enumerate(tiles): sheet.paste(t, (i * W // 3, 0))
    sheet.save(out, quality=88)

if __name__ == '__main__':
    if sys.argv[1] == '--still':
        still(sys.argv[2], [int(x) for x in sys.argv[3].split(',')], sys.argv[4])
    else:
        main(sys.argv[1])
