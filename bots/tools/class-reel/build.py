#!/usr/bin/env python3
"""build.py edl.json [--stills a,b,c out.jpg] [--shots-only]
Cuts a vertical Reel from landscape 4K class clips + a voice-over, with karaoke captions and a title chip.
edl: {fps, W, H, vo, vo_offset, tail, crf, room_db, cap:{...style}, chip:{...style},
      shots:[{id, clip, t0, dur, crop:[x,y,w,h], speed?, room_db?, cap_cy?, chip?}],
      phrases:[{text, cy?}], extra:[{text, from, to, style...}], out}
"""
import sys, os, json, re, subprocess, math
import numpy as np

K = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
E = json.load(open(sys.argv[1]))
FPS, W, H = E.get('fps', 24), E.get('W', 1440), E.get('H', 2560)
SRC = {'D1': f'{K}/src/D1.mov', 'D2': f'{K}/src/D2.mp4', 'D3': f'{K}/src/D3.mp4'}
WD = f'{K}/work/build'; os.makedirs(WD, exist_ok=True)
SR = 48000
TM = ('zscale=tin=arib-std-b67:min=bt2020nc:pin=bt2020:t=linear:npl=100,format=gbrpf32le,'
      'zscale=p=bt709,tonemap=mobius:param=0.15:desat=2,zscale=t=bt709:m=bt709:r=tv,format=gbrp,'
      'colorchannelmixer=rr=1.03:gg=0.96:bb=0.91,eq=gamma=0.94,format=yuv420p')   # D1 is HLG HDR: tone-map, then warm it to match the phone clips

# ---- shot frame plan
shots = E['shots']
cum = 0.0; frames = []
for s in shots:
    a = round(cum * FPS); cum += s['dur']; b = round(cum * FPS)
    s['f0'], s['n'] = a, b - a
TOTALN = shots[-1]['f0'] + shots[-1]['n']


def ease(u):
    return u * u * (3 - 2 * u)


def crop_at(s, k):
    """crop box (float) for frame k of shot s: static 'crop', or eased move from 'crop' to 'crop2'"""
    a = s['crop']; b = s.get('crop2', a)
    u = ease(k / max(1, s['n'] - 1)) if s.get('crop2') else 0.0
    c = [a[j] + (b[j] - a[j]) * u for j in range(4)]
    p = s.get('punch')   # punch-in hit: snap zoom z around a pivot (source px) at 'at' s into the shot, over 'ramp' s, then hold
    if p:
        v = min(1.0, max(0.0, (k - p['at'] * FPS) / max(1.0, p.get('ramp', 0.17) * FPS)))
        z = 1 + (p['z'] - 1) * (1 - (1 - v) ** 3)
        if z > 1:
            px, py = p.get('px', c[0] + c[2] / 2), p.get('py', c[1] + c[3] / 2)
            n = [px - (px - c[0]) / z, py - (py - c[1]) / z, c[2] / z, c[3] / z]
            n[0] = min(max(n[0], c[0]), c[0] + c[2] - n[2]); n[1] = min(max(n[1], c[1]), c[1] + c[3] - n[3])   # stay inside the shot's own frame
            c = n
    return c


def union(s):
    a = s['crop']; b = s.get('crop2', a)
    x0 = min(a[0], b[0]); y0 = min(a[1], b[1]); x1 = max(a[0] + a[2], b[0] + b[2]); y1 = max(a[1] + a[3], b[1] + b[3])
    x0 -= x0 % 2; y0 -= y0 % 2; w = (x1 - x0 + 1) // 2 * 2; h = (y1 - y0 + 1) // 2 * 2
    return x0, y0, min(w, 3840 - x0), min(h, 2160 - y0)


def decode_args(s, t0, nframes):
    ux, uy, uw, uh = union(s)
    sp = s.get('speed', 1.0)
    vf = ([TM] if s['clip'] == 'D1' else []) + ([s['grade']] if s.get('grade') else []) + [f'crop={uw}:{uh}:{ux}:{uy}']
    if sp != 1.0: vf.append(f'setpts=PTS/{sp}')
    vf += ['setpts=PTS-STARTPTS', f'fps={FPS}', 'scale=in_color_matrix=bt709:in_range=tv:flags=lanczos', 'format=rgb24']
    return ['ffmpeg', '-v', 'error', '-ss', f'{t0:.3f}', '-i', SRC[s['clip']], '-vf', ','.join(vf), '-frames:v', str(nframes), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], (ux, uy, uw, uh)


def frame_out(buf, s, k, U, size):
    from PIL import Image
    ux, uy, uw, uh = U
    im = Image.frombuffer('RGB', (uw, uh), buf, 'raw', 'RGB', 0, 1)
    x, y, w, h = crop_at(s, k)
    return im.resize(size, Image.LANCZOS, box=(x - ux, y - uy, x - ux + w, y - uy + h))


def shot_key(s):
    return json.dumps({k: s.get(k) for k in ('clip', 't0', 'n', 'crop', 'crop2', 'punch', 'speed', 'grade')} | {'tm': TM if s['clip'] == 'D1' else '', 'W': W, 'H': H, 'v': 3}, sort_keys=True)


def render_shot(i, s):
    out = f'{WD}/shot{i:02d}.mp4'
    kf = out + '.key'
    if os.path.exists(kf) and open(kf).read() == shot_key(s) and os.path.exists(out):
        return out
    if os.path.exists(kf): os.remove(kf)
    dec, U = decode_args(s, s['t0'], s['n'])
    fsz = U[2] * U[3] * 3
    enc = ['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
           '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setsar=1', '-c:v', 'libx264', '-preset', 'fast', '-crf', '8',
           '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', out]
    pd = subprocess.Popen(dec, stdout=subprocess.PIPE)
    pe = subprocess.Popen(enc, stdin=subprocess.PIPE)
    k = 0; last = None
    while k < s['n']:
        buf = pd.stdout.read(fsz)
        if len(buf) < fsz:
            if last is None: raise SystemExit(f'shot {i}: no frames decoded')
            buf = last   # source ran short: hold the last frame (reported below)
            print(f'WARNING shot {i} {s.get("id")}: source short, held frame {k}')
        last = buf
        pe.stdin.write(frame_out(buf, s, k, U, (W, H)).tobytes()); k += 1
    pd.stdout.close(); pd.wait(); pe.stdin.close(); pe.wait()
    if pe.returncode: raise SystemExit(f'encode failed shot {i}')
    open(kf, 'w').write(shot_key(s))
    return out


if '--plan' in sys.argv:
    # planning sheet: 3 frames per shot (first, middle, last) at the real crop, 3 shots per row
    from PIL import Image, ImageDraw, ImageFont
    from concurrent.futures import ThreadPoolExecutor
    outp = sys.argv[sys.argv.index('--plan') + 1]
    only = sys.argv[sys.argv.index('--plan') + 2].split(',') if len(sys.argv) > sys.argv.index('--plan') + 2 and not sys.argv[sys.argv.index('--plan') + 2].startswith('--') else None
    TW, TH = 216, 384
    sel = [s for s in shots if not only or s.get('id') in only]
    def tiles(s):
        res = []
        for k in (0, s['n'] // 2, s['n'] - 1):
            t = s['t0'] + k / FPS * s.get('speed', 1.0)
            dec, U = decode_args(s, t, 1)
            buf = subprocess.run(dec, capture_output=True).stdout
            res.append(frame_out(buf, s, k, U, (TW, TH)))
        return res
    with ThreadPoolExecutor(4) as ex: allt = list(ex.map(tiles, sel))
    per = 3; rows = (len(sel) + per - 1) // per
    S = Image.new('RGB', (per * (3 * TW + 12), rows * (TH + 30)), 'white'); d = ImageDraw.Draw(S); fnt = ImageFont.load_default(size=18)
    for j, (s, ts) in enumerate(zip(sel, allt)):
        cx = (j % per) * (3 * TW + 12); cy = (j // per) * (TH + 30)
        d.text((cx + 4, cy + 4), f"{s.get('id')} {s['clip']} {s['t0']:.2f}+{s['dur']:.2f}  out {s['f0']/FPS:.2f}", fill='black', font=fnt)
        for c, im in enumerate(ts): S.paste(im, (cx + c * TW, cy + 28))
    S.save(outp, quality=86); print('plan', outp, S.size); sys.exit(0)

# ---- video
from concurrent.futures import ThreadPoolExecutor
with ThreadPoolExecutor(3) as ex:
    paths = list(ex.map(lambda a: render_shot(*a), enumerate(shots)))
open(f'{WD}/list.txt', 'w').write(''.join(f"file '{p}'\n" for p in paths))
ASM = f'{WD}/assembled.mp4'
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', f'{WD}/list.txt', '-c', 'copy', ASM], check=True)
print('assembled', TOTALN, 'frames', TOTALN / FPS, 's')
if '--shots-only' in sys.argv: sys.exit(0)

# ---- audio
def load(path, t0=0.0, dur=None, ch=2):
    cmd = ['ffmpeg', '-v', 'error', '-ss', f'{t0:.3f}', '-i', path] + (['-t', f'{dur:.3f}'] if dur else []) + ['-vn', '-ac', str(ch), '-ar', str(SR), '-f', 'f32le', '-']
    a = np.frombuffer(subprocess.run(cmd, capture_output=True).stdout, np.float32)
    return a.reshape(-1, ch).copy()

N = int(round(TOTALN / FPS * SR))
mix = np.zeros((N, 2), np.float32)
F = int(0.06 * SR)
for s in shots:
    g = 10 ** (s.get('room_db', E.get('room_db', -22)) / 20)
    if g <= 0.0005: continue
    sp = s.get('speed', 1.0)
    seg = load(SRC[s['clip']], s['t0'], s['n'] / FPS * sp + 0.2)
    if sp != 1.0:   # slow-motion: stretch room sound by resampling (pitch drops; it is low anyway)
        idx = np.arange(0, len(seg) - 1, sp); seg = np.stack([np.interp(idx, np.arange(len(seg)), seg[:, c]) for c in (0, 1)], 1)
    a = int(round(s['f0'] / FPS * SR)); n = min(int(round(s['n'] / FPS * SR)), len(seg), N - a)
    seg = seg[:n] * g
    r = min(F, n // 2); seg[:r] *= np.linspace(0, 1, r)[:, None]; seg[-r:] *= np.linspace(1, 0, r)[:, None]
    mix[a:a + n] += seg
vo = load(f"{K}/{E['vo']}", 0, None, 1)[:, 0]
vo *= 10 ** (E.get('vo_db', 0) / 20)
if E.get('vo_fade'):   # fade the VO alone (clicks after the last word)
    f0_, f1_ = (int(x * SR) for x in E['vo_fade']); vo[f0_:f1_] *= np.linspace(1, 0, f1_ - f0_); vo[f1_:] = 0
a = int(round(E.get('vo_offset', 0) * SR)); n = min(len(vo), N - a)
mix[a:a + n] += vo[:n, None]
if E.get('fade_out'):
    r = int(E['fade_out'] * SR); mix[-r:] *= np.linspace(1, 0, r)[:, None]
WAV = f'{WD}/mix_raw.wav'
import wave
with wave.open(WAV, 'wb') as wf:
    wf.setnchannels(2); wf.setsampwidth(2); wf.setframerate(SR)
    wf.writeframes((np.clip(mix, -1, 1) * 32767).astype(np.int16).tobytes())
# loudness to target with limiter
meas = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', WAV, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
I = float(re.findall(r'I:\s+(-?[\d.]+) LUFS', meas)[-1])
gain = E.get('lufs', -14.0) - I + 0.4
MIX = f'{WD}/mix.wav'
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', WAV, '-af', f'volume={gain:.2f}dB,alimiter=limit=0.84:level=false:attack=5:release=60', '-ar', str(SR), '-c:a', 'pcm_s16le', MIX], check=True)
print(f'audio: measured {I:.1f} LUFS, gain {gain:+.1f} dB')

# ---- captions (karaoke, newest word yellow) + chip + extras -> wxcap2 spec
W_ = json.load(open(f"{K}/{E.get('words', 'work/vo_words.json')}"))
norm = lambda s: re.sub(r'[^a-z0-9]', '', s.lower())
wi = 0
blocks = []
off = E.get('vo_offset', 0.0)
cap = E.get('cap', {})
phr = E['phrases']
timed = []
for p in phr:
    toks = []
    for ln_i, ln in enumerate(p['text'].split('\n')):
        for tk in ln.split(' '):
            target = norm(tk); acc = ''; s0 = None; e1 = None
            while wi < len(W_) and len(acc) < len(target):
                if s0 is None: s0 = W_[wi]['s']
                acc += norm(W_[wi]['w']); e1 = W_[wi]['e']; wi += 1
            if acc != target: raise SystemExit(f'caption word mismatch: {tk!r} vs {acc!r}')
            toks.append((ln_i, tk, s0 + off, e1 + off))
    timed.append((p, toks))
for k, (p, toks) in enumerate(timed):
    nxt = timed[k + 1][1][0][2] if k + 1 < len(timed) else TOTALN / FPS
    end = min(nxt, toks[-1][3] + p.get('hold', 0.6)) if nxt - toks[-1][3] > 0.6 else nxt
    if k + 1 == len(timed): end = TOTALN / FPS
    f_ = lambda t: int(round(t * FPS))
    states = []
    for j, (li, tk, s0, e1) in enumerate(toks):
        a = f_(s0 - 0.04)
        b = f_(toks[j + 1][2] - 0.04) if j + 1 < len(toks) else f_(end)
        txt = ''
        for jj in range(j + 1):
            lj, tj = toks[jj][0], toks[jj][1]
            if jj > 0: txt += '\n' if lj != toks[jj - 1][0] else ' '
            txt += ('{y}' + tj + '{/}') if (jj == j and p.get('karaoke', True)) else tj
        if b > a: states.append({'f0': a, 'f1': b, 'text': txt})
    # make the block hold the full text in white for its last part if the last word ended early
    sh = next((s for s in shots if s['f0'] <= states[0]['f0'] < s['f0'] + s['n']), shots[-1])
    cy = p.get('cy', sh.get('cap_cy', cap.get('cy', 0.70)))
    blocks.append({**cap, 'id': f'p{k:02d}', 'layout': p['text'], 'cy': cy, 'states': states})
# one phrase per frame: a phrase ends where the next begins; gaps under 6 frames are closed
for k in range(len(blocks) - 1):
    last = blocks[k]['states'][-1]; nf0 = blocks[k + 1]['states'][0]['f0']
    last['f1'] = nf0 if nf0 - last['f1'] < 6 else min(last['f1'], nf0)
    assert all(st['f1'] > st['f0'] for st in blocks[k]['states']), blocks[k]['id']
# chips: consecutive shots with the same chip text form one block
ch = E.get('chip', {})
run = None
for s in shots + [{'chip': None, 'f0': TOTALN, 'n': 0}]:
    t = s.get('chip')
    if run and t != run['text']:
        blocks.append({**ch, 'id': f"chip{len(blocks)}", 'layout': run['text'], 'states': [{'f0': run['a'], 'f1': s['f0'], 'text': run['text']}]}); run = None
    if t and not run: run = {'text': t, 'a': s['f0']}
for x in E.get('extra', []):
    blocks.append({**x.get('style', {}), 'id': x['id'], 'layout': x['text'], 'states': [{'f0': int(round(x['from'] * FPS)), 'f1': int(round(x['to'] * FPS)) if x.get('to') else TOTALN, 'text': x['text']}]})
spec = {'src': ASM, 'out': f"{K}/{E['out']}", 'crf': E.get('crf', 16), 'audio': {'file': MIX}, 'defaults': {}, 'blocks': blocks}
json.dump(spec, open(f'{WD}/caps.json', 'w'), ensure_ascii=False, indent=1)
if '--no-caps' in sys.argv: sys.exit(0)
subprocess.run([sys.executable, f'{K}/tools/wxcap2.py', f'{WD}/caps.json'], check=True)
print('done', E['out'])
