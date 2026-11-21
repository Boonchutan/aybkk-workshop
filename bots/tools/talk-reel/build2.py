# build2.py plan.json out.mp4 -- Nov21 talk Reel, frame-exact
import sys, json, subprocess, os, wave, numpy as np
P = json.load(open(sys.argv[1])); OUT = sys.argv[2]
W = os.path.dirname(os.path.abspath(sys.argv[1])); SRC = os.path.join(W, '..', 'src'); A1080 = os.path.join(W, 'after_1080.mov')
FPS = 24000/1001; FD = 1/FPS; SR = 48000
fr = lambda t: int(round(t / FD))
# main keep: apply cuts/adds to base keep
def norm(iv):
    iv = sorted([list(x) for x in iv if x[1] - x[0] > 0.02]); out = []
    for s, e in iv:
        if out and s <= out[-1][1] + 1e-6: out[-1][1] = max(out[-1][1], e)
        else: out.append([s, e])
    return out
keep = norm(P['keep'] + P.get('add', []))
for a, b in P.get('cut', []):
    nk = []
    for s, e in keep:
        if b <= s or a >= e: nk.append([s, e]); continue
        if s < a: nk.append([s, a])
        if e > b: nk.append([b, e])
    keep = nk
keep = [k for k in norm(keep) if fr(k[1]) - fr(k[0]) >= 3]
pre = P.get('pre', [])
segs = [(fr(s), fr(e)) for s, e in pre] + [(fr(s), fr(e)) for s, e in keep]
kind = ['pre'] * len(pre) + ['main'] * len(keep)
for ins in P.get('inserts', []):
    target = fr(ins['after_src']); best = None
    for i in range(len(pre), len(segs)):
        if kind[i] != 'main': continue
        d = abs(segs[i][1] - target)
        if best is None or d < best[0]: best = (d, i)
    i = best[1]; a, b = segs[i]
    segs.insert(i + 1, (max(0, b - ins['frames']), max(0, b - ins['frames']) + ins['frames'])); kind.insert(i + 1, ins)
PRE_N = sum(b - a for a, b in segs[:len(pre)])
cum = []; n = 0
for a, b in segs: cum.append(n); n += b - a
TOTALN = n; TOTAL = n * FD
def s2n(x):  # source time -> output frame (main part)
    off = len(pre)
    best = None
    for i in range(off, len(segs)):
        if kind[i] != 'main': continue
        a, b = segs[i]; c = cum[i]; fx = x / FD
        if a - 0.5 <= fx <= b + 0.5: return int(round(c + min(max(fx - a, 0), b - a)))
        for sx, ox in ((a, c), (b, c + b - a)):
            d = abs(fx - sx)
            if best is None or d < best[0]: best = (d, ox)
    return int(best[1])
json.dump({'segs': segs, 'cum': cum, 'totaln': TOTALN, 'pre_n': PRE_N}, open(os.path.join(W, 'timeline2.json'), 'w'))
tmp = os.path.join(W, 'b2'); os.makedirs(tmp, exist_ok=True)
# A-roll: concat frame ranges in order (pre may be out of source order) via trim+concat
fc = []
for i, (a, b) in enumerate(segs):
    fc.append(f'[0:v]trim=start_frame={a}:end_frame={b},setpts=PTS-STARTPTS[s{i}]')
fc.append(''.join(f'[s{i}]' for i in range(len(segs))) + f'concat=n={len(segs)}:v=1:a=0[v]')
open(os.path.join(tmp, 'aroll.txt'), 'w').write(';\n'.join(fc))
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', A1080, '-filter_complex_script', os.path.join(tmp, 'aroll.txt'), '-map', '[v]',
                '-c:v', 'libx264', '-preset', 'fast', '-crf', '15', '-r', '24000/1001', os.path.join(tmp, 'aroll.mp4')], check=True)
# audio
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', os.path.join(SRC, 'after.mov'), '-vn', '-ac', '2', '-ar', str(SR), '-f', 's16le', '-'], capture_output=True).stdout
A = np.frombuffer(raw, np.int16).reshape(-1, 2).astype(np.float32)
for s, e, db in P.get('gains', []):
    i0, i1 = int(s * SR), int(e * SR); g = 10 ** (db / 20); R = int(0.03 * SR)
    env = np.ones(i1 - i0) * g; env[:R] = np.linspace(1, g, R); env[-R:] = np.linspace(g, 1, R)
    A[i0:i1] *= env[:, None]
F = int(0.006 * SR); parts = []
for (a, b), kd in zip(segs, kind):
    if isinstance(kd, dict):
        au_ = kd['audio']; n_ = int(round((b - a) * FD * SR))
        r_ = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f"{au_['t0']:.3f}", '-i', os.path.join(SRC, au_['file']), '-t', f'{(b - a) * FD + 0.1:.3f}', '-vn', '-ac', '2', '-ar', str(SR), '-f', 's16le', '-'], capture_output=True).stdout
        seg = np.frombuffer(r_, np.int16).reshape(-1, 2).astype(np.float32)[:n_].copy() * 10 ** (au_.get('gain_db', 0) / 20)
        if len(seg) < n_: seg = np.concatenate([seg, np.zeros((n_ - len(seg), 2), np.float32)])
        R_ = int(0.08 * SR); seg[:R_] *= np.linspace(0, 1, R_)[:, None]; seg[-R_:] *= np.linspace(1, 0, R_)[:, None]
        parts.append(seg); continue
    seg = A[int(round(a * FD * SR)):int(round(b * FD * SR))].copy()
    if len(seg) > 2 * F:
        r = np.linspace(0, 1, F)[:, None]; seg[:F] *= r; seg[-F:] *= r[::-1]
    parts.append(seg)
au = np.concatenate(parts)
fo = P.get('fade_out', 0)
if fo: n_ = int(fo * SR); au[-n_:] *= np.linspace(1, 0, n_)[:, None]
au = np.clip(au, -32768, 32767).astype(np.int16)
wf = wave.open(os.path.join(tmp, 'a.wav'), 'wb'); wf.setnchannels(2); wf.setsampwidth(2); wf.setframerate(SR); wf.writeframes(au.tobytes()); wf.close()
# overlays: zoom on alternate A-roll segments, then B-roll
inputs = ['-i', os.path.join(tmp, 'aroll.mp4')]; fc = []
br = []
for b in P.get('broll', []):
    if 'out_n' in b: n0, n1 = b['out_n']
    else: n0, n1 = s2n(b['src_at']), s2n(b['src_end'])
    if n1 - n0 >= 6: br.append((n0, n1, b))
for i, kd in enumerate(kind):
    if isinstance(kd, dict) and kd.get('broll'): br.append((cum[i], cum[i] + segs[i][1] - segs[i][0], kd['broll']))
covered = lambda a, b: any(n0 <= a and b <= n1 for n0, n1, _ in br)
shots = []
for i, (a, b) in enumerate(segs):
    o0, o1 = cum[i], cum[i] + b - a
    if shots and i > len(pre) and segs[i - 1][1] == a and shots[-1][1] == o0: shots[-1][1] = o1
    else: shots.append([o0, o1])
zw = []; state = False
for o0, o1 in shots:
    if covered(o0, o1): continue
    if o1 - o0 >= 12: state = not state
    if state: zw.append((o0, o1 - 1))
last = '0:v'
if zw:
    expr = '+'.join(f'between(n,{a},{b})' for a, b in zw)
    fc.append(f"[0:v]split[za][zb];[zb]scale=1210:2150,crop=1080:1920:65:{P.get('zoom_y', 80)}[zz];[za][zz]overlay=0:0:enable='{expr}'[vz]")
    last = 'vz'
for j, (n0, n1, b) in enumerate(br):
    x, y, w, h = b['crop']; nf = n1 - n0 + 2
    pf = os.path.join(tmp, f'br{j:02d}.mp4')
    if 'image' in b:
        cx = b.get('crop_x', 134)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', b['image'], '-vf',
            f"crop=1449:2576:{cx}:0,scale=2160:3840:flags=lanczos,zoompan=z='1+0.05*on/{nf}':d={nf}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=24000/1001,format=yuv420p",
            '-frames:v', str(nf), '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', pf], check=True)
    else:
     subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f"{max(0, b['t0'] - 1):.3f}", '-i', os.path.join(SRC, b['file']), '-ss', '1' if b['t0'] >= 1 else f"{b['t0']:.3f}",
                    '-frames:v', str(nf), '-vf', f'crop={w}:{h}:{x}:{y},scale=1080:1920:flags=lanczos,fps=24000/1001,format=yuv420p', '-an',
                    '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', pf], check=True)
    ii = len(inputs) // 2
    inputs += ['-i', pf]
    fc.append(f'[{ii}:v]setpts=PTS-STARTPTS+{n0}/(24000/1001)/TB[p{j}]')
    fc.append(f"[{last}][p{j}]overlay=0:0:eof_action=repeat:enable='between(n,{n0},{n1 - 1})'[v{j}]")
    last = f'v{j}'
# captions
import math
def ts(x):
    c = int(math.floor(max(0, x) * 100 + 1e-6)); s_, cs = divmod(c, 100)
    return f'{s_ // 3600}:{s_ % 3600 // 60:02d}:{s_ % 60:02d}.{cs:02d}'
ZHF = r"{\fnWenQuanYi Zen Hei\fs52\b0}"
st = P['style']
ass = ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '', '[V4+ Styles]',
       'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
       f"Style: CAP,Liberation Sans,{st['en']},&H00121212,&H00121212,&HFFFFFFFF,&H80FFFFFF,-1,0,0,0,100,100,0,0,4,14,0,2,70,170,{st['mv']},1",
       f"Style: TITLE,Liberation Sans,{st['title']},&H00121212,&H00121212,&HFFFFFFFF,&H80FFFFFF,-1,0,0,0,100,100,0,0,4,14,0,8,70,170,{st['title_mv']},1",
       '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']
if P.get('title'):
    ass.append(f"Dialogue: 0,{ts(0)},{ts(TOTAL)},TITLE,,0,0,0,,{P['title']['en']}\\N{ZHF.replace('52', str(st['title_zh']))}{P['title']['zh']}")
caps = []
for c in P['captions']:
    if 'out_n' in c: n0, n1 = c['out_n']
    else: n0, n1 = s2n(c['src0']), s2n(c['src1'])
    caps.append([n0 * FD, n1 * FD, c])
for i, kd in enumerate(kind):
    if isinstance(kd, dict) and kd.get('caption'): caps.append([cum[i] * FD, (cum[i] + segs[i][1] - segs[i][0]) * FD, kd['caption']])
caps.sort(key=lambda z: z[0])
for i in range(len(caps)):
    nxt = caps[i + 1][0] if i + 1 < len(caps) else TOTAL
    caps[i][1] = min(max(caps[i][1], caps[i][0] + 1.0), nxt)
    if nxt - caps[i][1] < 0.5: caps[i][1] = nxt
for o0, o1, c in caps:
    txt = c['en'] + ("\\N" + ZHF + c['zh'] if c.get('zh') else '')
    ass.append(f"Dialogue: 0,{ts(o0)},{ts(o1)},CAP,,0,0,0,,{txt}")
open(os.path.join(tmp, 'caps.ass'), 'w').write('\n'.join(ass) + '\n')
assp = os.path.join(tmp, 'caps.ass').replace(':', r'\:')
fc.append(f"[{last}]subtitles='{assp}':fontsdir=/usr/share/fonts/truetype[vout]")
ai = len(inputs) // 2; inputs += ['-i', os.path.join(tmp, 'a.wav')]
open(os.path.join(tmp, 'final.txt'), 'w').write(';\n'.join(fc))
subprocess.run(['ffmpeg', '-v', 'error', '-y'] + inputs + ['-filter_complex_script', os.path.join(tmp, 'final.txt'), '-map', '[vout]', '-map', f'{ai}:a',
       '-af', 'alimiter=limit=0.89:level=false', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-r', '24000/1001', '-pix_fmt', 'yuv420p',
       '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', '-frames:v', str(TOTALN), OUT], check=True)
print('TOTAL', round(TOTAL, 2), 'segs', len(segs), 'broll', len(br), 'zoomwins', len(zw), 'caps', len(caps))
