#!/usr/bin/env python3
"""wxcap2.py spec.json [--still N,N,... out.png]
Block model for captions that build up word by word without moving.
spec: {src, out, crf?, audio?, defaults:{...}, blocks:[{id, layout, states:[{f0,f1,text}], font, size, stroke, shadow, fill,
       align ('center'|'left'), cx | lx, cy, line_gap}]}
 layout = the block's final full text (plain or with markup); every state text is a prefix of it (markup aside).
 Markup in state text: {y}..{/} yellow, {c}..{/} cream, {w}..{/} white.
 shadow: {dx, dy, blur, alpha} in em units (blur 0 = hard drop shadow). stroke in em (0 = none).
 SDR sources -> H.264 (source range/matrix kept). HLG HDR sources -> HEVC Main10 HLG, graphics at HDR reference white.
"""
import sys, os, json, re, subprocess, io
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import wxcap as W1

W1.FONTS['serif'] = os.path.join(W1.FD, 'NotoSerifSCwght900.ttf')
SS = 2
strip = lambda s: re.sub(r'\{(y|c|w|/)\}', '', s)


def items_of(line, base):
    """visible items of one line: list of (kind, value, colour)"""
    out = []
    for kind, s, c in W1.parse_runs(line, base):
        if kind == 't':
            out += [('t', ch, c) for ch in s]
        else:
            out.append(('e', s, c))
    return out


class Block:
    def __init__(self, b, W, H):
        self.b, self.W, self.H = b, W, H
        self.em = em = b['size'] * W * SS
        self.f = W1.font(b.get('font', 'body'), int(round(em)))
        self.fp = W1.font(b.get('punct_font', 'sans' if b.get('font', 'body') != 'serif' else 'serif'), int(round(em)))
        self.base = W1.COL[b.get('fill', 'white')]
        self.sw = int(round(em * b.get('stroke', 0.085)))
        self.asc, self.desc = self.f.getmetrics()
        self.lh = em * b.get('line_gap', 1.12)
        full = strip(b['layout']).split('\n')
        self.lines = []
        maxw = 0
        for ln in full:
            x = 0.0
            pos = []
            for kind, v, _ in items_of(ln, self.base):
                if kind == 't':
                    ff = self.fp if v in W1.PUNCT else self.f
                    w = ff.getlength(v)
                    if v in W1.PUNCT_TIGHT and b.get('font', 'body') != 'serif':
                        w *= 0.62
                    if v == ' ':
                        w = em * 0.28
                    pos.append((x, ff, w))
                    x += w
                else:
                    e = W1.emoji_img(v, int(round(em * 1.02)))
                    pos.append((x + em * 0.06, e, e.width))
                    x += e.width + em * 0.10
            self.lines.append((pos, x))
            maxw = max(maxw, x)
        self.maxw = maxw
        sh = b.get('shadow') or {}
        self.pad = int(self.sw * 3 + em * 0.3 + abs(sh.get('dx', 0)) * em + abs(sh.get('dy', 0)) * em + sh.get('blur', 0) * em * 3)
        self.LW = int(maxw + 2 * self.pad)
        self.LH = int(self.lh * (len(full) - 1) + self.asc + self.desc + 2 * self.pad)
        self.cache = {}

    def render(self, text):
        if text in self.cache:
            return self.cache[text]
        b, em = self.b, self.em
        outline = Image.new('L', (self.LW, self.LH), 0)
        fill = Image.new('RGBA', (self.LW, self.LH), (0, 0, 0, 0))
        do, df = ImageDraw.Draw(outline), ImageDraw.Draw(fill)
        emo = []
        for i, ln in enumerate(text.split('\n')):
            pos, w = self.lines[i]
            x0 = self.pad + ((self.maxw - w) / 2 if b.get('align', 'center') == 'center' else 0)
            y0 = self.pad + i * self.lh
            for k, (kind, v, c) in enumerate(items_of(ln, self.base)):
                x, ff, _ = pos[k]
                if kind == 't':
                    if v == ' ':
                        continue
                    do.text((x0 + x, y0), v, font=ff, fill=255, stroke_width=self.sw, stroke_fill=255)
                    df.text((x0 + x, y0), v, font=ff, fill=c + (255,))
                else:
                    emo.append((ff, int(x0 + x), int(y0 + self.asc - ff.height * 0.86)))
        layer = Image.new('RGBA', (self.LW, self.LH), (0, 0, 0, 0))
        sh = b.get('shadow')
        if sh:
            m = outline.filter(ImageFilter.GaussianBlur(sh['blur'] * em)) if sh.get('blur') else outline
            s = Image.new('RGBA', (self.LW, self.LH), (0, 0, 0, 0))
            s.paste(tuple(sh.get('color', (8, 8, 12))) + (int(255 * sh.get('alpha', 1.0)),), (int(round(sh.get('dx', 0) * em)), int(round(sh.get('dy', 0) * em))), m)
            layer = Image.alpha_composite(layer, s)
        if self.sw > 0:
            ol = Image.new('RGBA', (self.LW, self.LH), W1.COL['black'] + (0,))
            ol.putalpha(outline)
            layer = Image.alpha_composite(layer, ol)
        layer = Image.alpha_composite(layer, fill)
        for e, x, y in emo:
            layer.alpha_composite(e, (x, y))
        w, h = max(1, round(self.LW / SS)), max(1, round(self.LH / SS))
        im = layer.resize((w, h), Image.LANCZOS)
        if 'lx' in b:
            px = int(round(b['lx'] * self.W - self.pad / SS))
        else:
            px = int(round(b.get('cx', 0.5) * self.W - w / 2))
        py = int(round(b['cy'] * self.H - h / 2))
        self.cache[text] = (im, px, py)
        return self.cache[text]


# sRGB graphics -> HLG BT.2020 signal with white at HDR reference white (75% HLG)
def to_hlg(rgba):
    a = rgba.astype(np.float32)
    c = a[..., :3] / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.6274, 0.3293, 0.0433], [0.0691, 0.9195, 0.0114], [0.0164, 0.0880, 0.8956]], np.float32)
    lin = np.clip(lin @ M.T, 0, 1) * 0.2646          # scene-linear value whose HLG signal is 0.75
    A, B, C = 0.17883277, 0.28466892, 0.55991073
    sig = np.where(lin <= 1 / 12, np.sqrt(3 * lin), A * np.log(np.maximum(12 * lin - B, 1e-6)) + C)
    out = a.copy()
    out[..., :3] = np.clip(sig, 0, 1) * 255.0
    return out.round().astype(np.uint8)


def main():
    spec = json.load(open(sys.argv[1]))
    base = os.path.dirname(os.path.abspath(sys.argv[1]))
    src = os.path.join(base, spec['src'])
    st = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,nb_frames,pix_fmt,color_range,color_transfer', '-of', 'json', src], capture_output=True, text=True).stdout)['streams'][0]
    W, H, N = st['width'], st['height'], int(st['nb_frames'])
    num, den = st['r_frame_rate'].split('/')
    hdr = st.get('color_transfer') == 'arib-std-b67'
    dflt = spec.get('defaults', {})
    blocks = [Block({**dflt, **b}, W, H) for b in spec['blocks']]
    for g in spec.get('groups', []):          # blocks of one sentence share a left edge, centred by the widest line
        bs = [B for B in blocks if B.b['id'] in g]
        mw = max(B.maxw for B in bs) / SS
        for B in bs:
            B.b['lx'] = 0.5 - mw / 2 / W
    # frame -> list of (block index, text)
    table = {}
    for bi, B in enumerate(blocks):
        for s in B.b['states']:
            for n in range(max(0, s['f0']), min(N, s['f1'])):
                table.setdefault(n, []).append((bi, s['text']))
    cache = {}

    def frame(n):
        key = tuple(table.get(n, ()))
        if key in cache:
            return key, cache[key]
        cache.clear()
        canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        for bi, text in key:
            im, x, y = blocks[bi].render(text)
            canvas.alpha_composite(im, (x, y)) if (0 <= x and 0 <= y and x + im.width <= W and y + im.height <= H) else canvas.paste(im, (x, y), im)
        cache[key] = canvas
        return key, canvas

    if len(sys.argv) > 2 and sys.argv[2] == '--still':
        ns = [int(x) for x in sys.argv[3].split(',')]
        tiles = []
        for n in ns:
            vf = f"select='eq(n,{n})'" + (',zscale=t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=full,format=rgb24' if hdr else '')
            p = subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-vf', vf, '-vsync', '0', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], capture_output=True).stdout
            bg = Image.open(io.BytesIO(p)).convert('RGBA')
            _, ov = frame(n)
            tiles.append(Image.alpha_composite(bg, ov).convert('RGB'))
        S = Image.new('RGB', (W * len(tiles), H))
        for i, t in enumerate(tiles):
            S.paste(t, (i * W, 0))
        S.save(sys.argv[4])
        return

    out = os.path.join(base, spec['out'])
    au = spec.get('audio')
    if not au:
        AUD = ['-map', '0:a?', '-c:a', 'copy']
    elif au.get('file'):
        AUD = ['-map', '2:a', '-c:a', 'aac', '-b:a', '256k']
    else:
        AUD = ['-map', '0:a?', '-af', f"volume={au['gain_db']}dB,alimiter=limit={au.get('limit', 0.84)}:level=false:attack=5:release=80", '-c:a', 'aac', '-b:a', '256k']
    inputs = ['-i', src, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{W}x{H}', '-r', f'{num}/{den}', '-i', '-']
    if au and au.get('file'):
        inputs += ['-i', os.path.join(base, au['file'])]
    if hdr:
        fc = "[1:v]scale=out_color_matrix=bt2020:out_range=limited,format=yuva420p10le[ov];[0:v][ov]overlay=0:0:format=yuv420p10:eof_action=pass,format=yuv420p10le[v]"
        VID = ['-c:v', 'libx265', '-preset', 'medium', '-crf', str(spec.get('crf', 16)), '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1',
               '-x265-params', 'colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc:range=limited:log-level=error',
               '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc', '-color_range', 'tv']
    else:
        full = st.get('color_range') == 'pc' or st.get('pix_fmt', '').startswith('yuvj')
        pixfmt = 'yuvj420p' if full else 'yuv420p'
        fc = f"[1:v]scale=out_color_matrix=bt709:out_range={'full' if full else 'limited'},format=yuva420p[ov];[0:v][ov]overlay=0:0:format=yuv420:eof_action=pass,format={pixfmt}[v]"
        VID = ['-c:v', 'libx264', '-preset', 'slow', '-crf', str(spec.get('crf', 14)), '-profile:v', 'high',
               '-color_range', 'pc' if full else 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709']
    cmd = ['ffmpeg', '-v', 'error', '-y'] + inputs + ['-filter_complex', fc, '-map', '[v]'] + AUD + VID + ['-r', f'{num}/{den}', '-movflags', '+faststart', out]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    last_key, last_bytes = None, None
    for n in range(N):
        key, canvas = frame(n)
        if key != last_key:
            arr = np.asarray(canvas)
            last_bytes = (to_hlg(arr) if hdr else arr).tobytes()
            last_key = key
        p.stdin.write(last_bytes)
    p.stdin.close()
    print('encoded', out, 'rc', p.wait(), 'frames', N, 'HDR' if hdr else 'SDR')


if __name__ == '__main__':
    main()
