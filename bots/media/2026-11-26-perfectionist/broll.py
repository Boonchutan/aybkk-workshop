"""Render The Perfectionist: cut talking track + B-roll boxes (over chest or head) + title for the whole video.
Usage: python3 -I broll.py plan.json out.mp4 [--pieces-only]"""
import json, subprocess, sys, os
from PIL import Image, ImageDraw, ImageFilter
import imageio_ffmpeg
FF = imageio_ffmpeg.get_ffmpeg_exe()
S = '/tmp/claude-0/-home-user-aybkk-workshop/5fef75e8-f96a-51ec-a2b6-837dec39c8e1/scratchpad/perf/'
HLG = ('zscale=tin=arib-std-b67:min=bt2020nc:pin=bt2020:t=linear:npl=100,format=gbrpf32le,exposure=exposure=-1.3,'
       'zscale=p=bt709,tonemap=mobius:param=0.15:desat=2,zscale=t=bt709:m=bt709:r=tv,format=gbrp,'
       "colorchannelmixer=rr=1.03:gg=0.96:bb=0.91,curves=master='0/0 0.1/0.13 0.5/0.54 0.8/0.8 1/0.9',format=yuv420p")
BOX = {'chest': (120, 1094, 840, 556), 'head': (90, 262, 900, 760), 'tall': (270, 1070, 540, 596)}
M, R, BW = 30, 30, 6
CAPY = 1370          # canvas margin for the shadow, corner radius, white border width
FPS = 30
os.makedirs(S + 'work/pieces', exist_ok=True)

def frame_png(w, h):
    p = S + f'work/pieces/frame_{w}x{h}.png'
    if os.path.exists(p): return p
    W, H = w + 2 * M, h + 2 * M
    sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((M - 2, M + 6, M + w + 2, M + h + 10), R + 4, fill=(0, 0, 0, 120))
    sh = sh.filter(ImageFilter.GaussianBlur(12))
    ImageDraw.Draw(sh).rounded_rectangle((M - BW, M - BW, M + w + BW - 1, M + h + BW - 1), R + BW, fill=(255, 255, 255, 255))
    sh.save(p); return p

def mask_png(w, h):
    p = S + f'work/pieces/mask_{w}x{h}.png'
    if os.path.exists(p): return p
    m = Image.new('L', (w, h), 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, w - 1, h - 1), R, fill=255)
    m.save(p); return p

def soft(path, regions, w, h, n):
    import numpy as np
    m = Image.new('L', (w, h), 0); d = ImageDraw.Draw(m)
    for x0, y0, x1, y1 in regions: d.rounded_rectangle((x0, y0, x1, y1), 12, fill=255)
    m = m.filter(ImageFilter.GaussianBlur(14))
    raw = subprocess.run([FF, '-loglevel', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
    fs = w * h * 3; tmp = path + '.soft.mp4'
    enc = subprocess.Popen([FF, '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{w}x{h}', '-r', str(FPS), '-i', '-',
                            '-c:v', 'libx264', '-crf', '12', '-preset', 'fast', '-pix_fmt', 'yuv420p', tmp], stdin=subprocess.PIPE)
    for k in range(len(raw) // fs):
        im = Image.frombuffer('RGB', (w, h), raw[k * fs:(k + 1) * fs])
        enc.stdin.write(Image.composite(im.filter(ImageFilter.GaussianBlur(16)), im, m).tobytes())
    enc.stdin.close(); enc.wait(); os.replace(tmp, path)

def piece(i, p):
    x, y, w, h = BOX[p['box']] if isinstance(p['box'], str) else p['box']
    src = S + 'src/' + p['clip']; hlg = 'dji' in p['clip']
    SW, SH = (1728, 3072) if hlg else (2160, 3840)
    z = p.get('zoom', 1.0)
    cw = SW / z; ch = cw * h / w
    if ch > SH: ch = SH; cw = ch * w / h
    cx = min(max(p.get('fx', 0.5) * SW - cw / 2, 0), SW - cw); cy = min(max(p.get('fy', 0.5) * SH - ch / 2, 0), SH - ch)
    n = round(p['dur'] * FPS)
    eq = p.get('eq', '')
    if p.get('look'): eq = (eq + ',' if eq else '') + p['look']
    for (bx0, by0, bw0, bh0) in p.get('blur', []):
        eq = (eq + ',' if eq else '') + f'split[m{bx0}][c{bx0}];[c{bx0}]crop={bw0}:{bh0}:{bx0}:{by0},boxblur=10:2[k{bx0}];[m{bx0}][k{bx0}]overlay={bx0}:{by0}'
    if p.get('push'):
        eq = (eq + ',' if eq else '') + f"scale={w*2}:{h*2},zoompan=z='1+{p['push']}*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={w}x{h}:fps={FPS}"
    vf = (p.get('tm', HLG) + ',' if hlg else 'format=yuv420p,') + f'crop={int(cw)//2*2}:{int(ch)//2*2}:{int(cx)//2*2}:{int(cy)//2*2},scale={w}:{h}:flags=lanczos,fps={FPS}' + (',' + eq if eq else '')
    rgb = S + f'work/pieces/p{i:02d}.mp4'
    subprocess.run([FF, '-loglevel', 'error', '-y', '-ss', f"{p['src']:.3f}", '-i', src, '-frames:v', str(n), '-an', '-vf', vf,
                    '-c:v', 'libx264', '-crf', '12', '-preset', 'fast', '-pix_fmt', 'yuv420p', rgb], check=True)
    if p.get('softblur'):
        soft(rgb, p['softblur'], w, h, n)
    fr, mk = frame_png(w, h), mask_png(w, h)
    out = S + f'work/pieces/c{i:02d}.mov'
    subprocess.run([FF, '-loglevel', 'error', '-y', '-i', rgb, '-loop', '1', '-i', mk, '-loop', '1', '-i', fr, '-filter_complex',
                    f'[0:v]format=rgba[v];[1:v]format=gray[m];[v][m]alphamerge[a];[2:v]format=rgba[f];[f][a]overlay={M}:{M}:shortest=1,format=rgba',
                    '-frames:v', str(n), '-c:v', 'png', out], check=True)
    return out, x - M, y - M, n

def main():
    plan = json.load(open(sys.argv[1])); outp = sys.argv[2]
    items = plan['items']
    cans = [piece(i, p) for i, p in enumerate(items)]
    if '--pieces-only' in sys.argv: return
    args = [FF, '-loglevel', 'error', '-y', '-i', S + 'work/aroll_video.mp4', '-i', S + 'work/aroll_audio.wav', '-loop', '1', '-i', S + 'work/title.png']
    for c, _, _, _ in cans: args += ['-i', c]
    fc, last = [], '0:v'
    fd = 0.13
    for k, ((c, cx, cy, n), p) in enumerate(zip(cans, items)):
        d = n / FPS; t0 = p['out']
        nxt = items[k + 1]['out'] if k + 1 < len(items) else None
        fout = '' if (nxt is not None and nxt < t0 + d) or (nxt is None and t0 + d >= 68.29) else f',fade=t=out:st={d - fd:.3f}:d={fd}:alpha=1'
        fc.append(f"[{k + 3}:v]fade=t=in:st=0:d={fd}:alpha=1{fout},setpts=PTS-STARTPTS+{t0:.4f}/TB[b{k}]")
        fc.append(f"[{last}][b{k}]overlay={cx}:{cy}:eof_action=pass:enable='between(t,{t0:.4f},{t0 + d:.4f})'[o{k}]")
        last = f'o{k}'
    if '--stick' in sys.argv:
        args += ['-i', S + 'work/stick.mov']
        fc.append(f"[{last}][{len(cans) + 3}:v]overlay=0:1094:eof_action=pass[os]"); last = 'os'
    if '--caps' in sys.argv:
        args += ['-i', S + 'work/caps.mov']
        fc.append(f"[{last}][{len(cans) + 3 + (1 if '--stick' in sys.argv else 0)}:v]overlay=0:{CAPY}:eof_action=pass[oc]"); last = 'oc'
    fc.append(f"[{last}][2:v]overlay=0:0:shortest=1,format=yuv420p[vout]")
    args += ['-filter_complex', ';'.join(fc), '-map', '[vout]', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17',
             '-r', str(FPS), '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
             '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', '-shortest', outp]
    subprocess.run(args, check=True)
    print('done', outp)

if __name__ == '__main__':
    main()
