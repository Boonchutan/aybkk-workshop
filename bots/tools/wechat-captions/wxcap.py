#!/usr/bin/env python3
"""Burn timed Chinese captions onto a clean video, frame-exact.
usage: wxcap.py spec.json [--still N[,N...] out.png]   (still = preview frames only, no encode)
spec: {src, out, fps, crf?, events:[{id,text,f0,f1,cy,size,fill?,font?,cx?,stroke?,anim?,line_gap?}]}
 text: lines split by "\n"; {y}..{/} = yellow, {c}..{/} = cream, {w}..{/} = white run colour
 f0 inclusive, f1 exclusive (frame numbers of the source). cy = centre y (0..1 of height). size = em / width.
"""
import sys, os, json, re, subprocess, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, features

HERE = os.path.dirname(os.path.abspath(__file__))
FD = os.path.join(HERE, '..', 'fonts')
FONTS = {
    'body': os.path.join(FD, 'ChironGoRoundTCwght900.ttf'),
    'body800': os.path.join(FD, 'ChironGoRoundTCwght800.ttf'),
    'cta': os.path.join(FD, 'ZCOOLQingKeHuangYou.ttf'),
    'sans': os.path.join(FD, 'NotoSansSCwght900.ttf'),
}
EMOJI = '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf'
COL = {'white': (255, 255, 255), 'w': (255, 255, 255), 'cream': (253, 251, 193), 'c': (253, 251, 193),
       'yellow': (244, 221, 42), 'y': (244, 221, 42), 'black': (16, 16, 16)}
RAQM = features.check('raqm')
EMO_RE = re.compile('([\U0001F000-\U0001FAFF☀-➿⌚-⏿][️\U0001F3FB-\U0001F3FF]?)')
PUNCT = set('，。、；：')
PUNCT_TIGHT = set('，。、；：')   # trailing mainland punctuation sits bottom-left; trim its empty right half
_fc = {}


def font(key, px):
    k = (key, px)
    if k not in _fc:
        _fc[k] = ImageFont.truetype(FONTS[key], px)
    return _fc[k]


_ec = {}


def emoji_img(ch, px):
    k = (ch, px)
    if k not in _ec:
        f = ImageFont.truetype(EMOJI, 109)
        im = Image.new('RGBA', (300, 160), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        s = ch if RAQM else ch[0]
        d.text((10, 10), s, font=f, embedded_color=True)
        bb = im.getbbox()
        im = im.crop(bb)
        sc = px / 128.0
        _ec[k] = im.resize((max(1, round(im.width * sc)), max(1, round(im.height * sc))), Image.LANCZOS)
    return _ec[k]


def parse_runs(line, base):
    """-> list of (kind, text, colour) ; kind 't' or 'e'"""
    out = []
    col = base
    pos = 0
    for m in re.finditer(r'\{(y|c|w|/)\}', line):
        seg = line[pos:m.start()]
        if seg:
            out.append((seg, col))
        col = base if m.group(1) == '/' else COL[m.group(1)]
        pos = m.end()
    if line[pos:]:
        out.append((line[pos:], col))
    runs = []
    for seg, c in out:
        for part in EMO_RE.split(seg):
            if not part:
                continue
            runs.append(('e' if EMO_RE.fullmatch(part) else 't', part, c))
    return runs


def render_event(ev, W, H, SS=2):
    """Render one caption block to an RGBA layer (supersampled then reduced). Returns (img, x, y) top-left on frame."""
    em = ev['size'] * W * SS
    fkey = ev.get('font', 'body')
    f = font(fkey, int(round(em)))
    fp = font(ev.get('punct_font', 'sans'), int(round(em)))
    base = COL[ev.get('fill', 'white')]
    sw = max(1, int(round(em * ev.get('stroke', 0.085))))
    track = ev.get('track', 0.0) * em
    lines = ev['text'].split('\n')
    asc, desc = f.getmetrics()
    lh = em * ev.get('line_gap', 1.12)
    laid = []
    maxw = 0
    for ln in lines:
        x = 0.0
        items = []
        for kind, s, c in parse_runs(ln, base):
            if kind == 't':
                for chx in s:
                    ff = fp if chx in PUNCT else f
                    w = ff.getlength(chx)
                    if chx in PUNCT_TIGHT: w *= 0.62
                    items.append(('t', chx, c, x, ff))
                    x += w + track
            else:
                e = emoji_img(s, int(round(em * ev.get('emoji_scale', 1.02))))
                x += em * 0.06
                items.append(('e', e, None, x, None))
                x += e.width + em * 0.04
        x -= track
        laid.append((items, x))
        maxw = max(maxw, x)
    pad = int(sw * 3 + em * 0.25)
    LW = int(maxw + 2 * pad)
    LH = int(lh * (len(lines) - 1) + asc + desc + 2 * pad)
    outline = Image.new('L', (LW, LH), 0)
    fill = Image.new('RGBA', (LW, LH), (0, 0, 0, 0))
    do, df = ImageDraw.Draw(outline), ImageDraw.Draw(fill)
    emo = []
    for i, (items, w) in enumerate(laid):
        x0 = pad + (maxw - w) / 2
        y0 = pad + i * lh
        for kind, s, c, x, ff in items:
            if kind == 't':
                do.text((x0 + x, y0), s, font=ff, fill=255, stroke_width=sw, stroke_fill=255)
                df.text((x0 + x, y0), s, font=ff, fill=c + (255,))
            else:
                ey = y0 + asc - s.height * 0.86
                emo.append((s, int(x0 + x), int(ey)))
    layer = Image.new('RGBA', (LW, LH), (0, 0, 0, 0))
    # soft shadow under the outline
    sh = outline.filter(ImageFilter.GaussianBlur(em * 0.045))
    sh_off = int(em * 0.035)
    shadow = Image.new('RGBA', (LW, LH), (0, 0, 0, 0))
    shadow.paste((0, 0, 0, 150), (0, sh_off), sh)
    layer = Image.alpha_composite(layer, shadow)
    ol = Image.new('RGBA', (LW, LH), COL['black'] + (0,))
    ol.putalpha(outline)
    layer = Image.alpha_composite(layer, ol)
    layer = Image.alpha_composite(layer, fill)
    for e, x, y in emo:
        layer.alpha_composite(e, (x, y))
    return layer  # supersampled


def place(layer, ev, W, H, SS=2, scale=1.0, rot=0.0):
    im = layer
    if rot:
        im = im.rotate(rot, resample=Image.BICUBIC, expand=True)
    w, h = max(1, round(im.width * scale / SS)), max(1, round(im.height * scale / SS))
    im = im.resize((w, h), Image.LANCZOS)
    cx = ev.get('cx', 0.5) * W
    cy = ev['cy'] * H
    return im, int(round(cx - w / 2)), int(round(cy - h / 2))


# "phone ringing" entrance copied from the reference (frames relative to f0): (scale, rotation deg) or None = hidden
RING = ([(0.45, 0), (0.75, 0), (0.95, 0), (1.12, 0), (1.3, -6), (1.3, -2), (1.3, -4), (1.3, -7), (1.3, -5), (1.3, 8), (1.3, -4), (1.3, -6), (1.3, -5), (1.3, -3), None,
         (0.45, 0), (0.75, 0), (0.92, 0), (1.08, 0), (1.25, -6), (1.3, -3), (1.3, -6), None,
         (0.45, 0), (0.75, 0), (0.92, 0), (1.08, 0), (1.25, -6), (1.3, -5), (1.3, -3), (1.3, -6), (1.3, -5), (1.3, 8), (1.3, -4), (1.3, -6), (1.3, -5), (1.25, -3), (1.15, -5), (1.05, 0)])


def state(ev, n):
    if not (ev['f0'] <= n < ev['f1']):
        return None
    if ev.get('anim') == 'ring':
        k = n - ev['f0']
        if k < len(RING):
            return RING[k]
    return (1.0, 0.0)


def main():
    spec = json.load(open(sys.argv[1]))
    base = os.path.dirname(os.path.abspath(sys.argv[1]))
    src = os.path.join(base, spec['src'])
    pr = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,nb_frames,pix_fmt,color_range', '-of', 'json', src], capture_output=True, text=True)
    st = json.loads(pr.stdout)['streams'][0]
    W, H, N = st['width'], st['height'], int(st['nb_frames'])
    num, den = st['r_frame_rate'].split('/')
    evs = spec['events']
    layers = {e['id']: render_event(e, W, H) for e in evs}
    cache = {}

    def frame(n):
        key = tuple((e['id'], state(e, n)) for e in evs if state(e, n) is not None)
        if key in cache:
            return key, cache[key]
        cache.clear()
        canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        for e in evs:
            s = state(e, n)
            if s is None:
                continue
            im, x, y = place(layers[e['id']], e, W, H, scale=s[0], rot=s[1])
            canvas.alpha_composite(im, (x, y)) if (0 <= x and 0 <= y and x + im.width <= W and y + im.height <= H) else canvas.paste(im, (x, y), im)
        cache[key] = canvas
        return key, canvas

    if len(sys.argv) > 2 and sys.argv[2] == '--still':
        ns = [int(x) for x in sys.argv[3].split(',')]
        tiles = []
        for n in ns:
            p = subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-vf', f"select='eq(n,{n})'", '-vsync', '0', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], capture_output=True).stdout
            import io
            bg = Image.open(io.BytesIO(p)).convert('RGBA')
            _, ov = frame(n)
            tiles.append(Image.alpha_composite(bg, ov).convert('RGB'))
        S = Image.new('RGB', (W * len(tiles), H))
        for i, t in enumerate(tiles):
            S.paste(t, (i * W, 0))
        S.save(sys.argv[4])
        return

    out = os.path.join(base, spec['out'])
    full = st.get('color_range') == 'pc' or st.get('pix_fmt', '').startswith('yuvj')
    pixfmt = 'yuvj420p' if full else 'yuv420p'
    rng = 'full' if full else 'limited'
    au = spec.get('audio')
    AUD = ['-c:a', 'copy'] if not au else ['-af', f"volume={au['gain_db']}dB,alimiter=limit={au.get('limit', 0.84)}:level=false:attack=5:release=80", '-c:a', 'aac', '-b:a', '256k']
    cmd = ['ffmpeg', '-v', 'error', '-y', '-i', src, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{W}x{H}', '-r', f'{num}/{den}', '-i', '-',
           '-filter_complex', f"[1:v]scale=out_color_matrix=bt709:out_range={rng},format=yuva420p[ov];[0:v][ov]overlay=0:0:format=yuv420:eof_action=pass,format={pixfmt}[v]",
           '-map', '[v]', '-map', '0:a?'] + AUD + ['-c:v', 'libx264', '-preset', 'slow', '-crf', str(spec.get('crf', 14)), '-profile:v', 'high',
           '-color_range', 'pc' if full else 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
           '-r', f'{num}/{den}', '-movflags', '+faststart', out]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    last_key, last_bytes = None, None
    for n in range(N):
        key, canvas = frame(n)
        if key != last_key:
            last_bytes = canvas.tobytes()
            last_key = key
        p.stdin.write(last_bytes)
    p.stdin.close()
    rc = p.wait()
    print('encoded', out, 'rc', rc, 'frames', N)


if __name__ == '__main__':
    main()
