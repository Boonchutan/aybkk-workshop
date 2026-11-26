import json, subprocess, os, numpy as np, imageio_ffmpeg
FF = imageio_ffmpeg.get_ffmpeg_exe()
S = '/tmp/claude-0/-home-user-aybkk-workshop/5fef75e8-f96a-51ec-a2b6-837dec39c8e1/scratchpad/perf/'
C = json.load(open(S + 'work/cut.json')); OFF = C['off']; keep = C['keep_mic']
os.makedirs(S + 'work/seg', exist_ok=True)
ZOOM = [1.0, 1.08]
FX, FY = 0.47, 0.33           # face centre (share of the frame) for the punch-in
lst = []
for i, (a, b) in enumerate(keep):
    z = ZOOM[i % 2]; W, H = 1080, 1920
    sw, sh = int(round(W * z / 2) * 2), int(round(H * z / 2) * 2)
    cx = min(max(int(FX * sw - W / 2), 0), sw - W); cy = min(max(int(FY * sh - H / 2), 0), sh - H)
    vf = f'scale={sw}:{sh}:flags=lanczos,crop={W}:{H}:{cx}:{cy},format=yuv420p'
    out = S + f'work/seg/s{i:02d}.mp4'
    n = round((b - a) * 30)
    subprocess.run([FF, '-loglevel', 'error', '-y', '-ss', f'{a + OFF:.4f}', '-i', S + 'src/talk.mp4', '-frames:v', str(n), '-an',
                    '-vf', vf, '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-color_primaries', 'bt709',
                    '-color_trc', 'bt709', '-colorspace', 'bt709', out], check=True)
    lst.append(f"file '{out}'")
open(S + 'work/seg/list.txt', 'w').write('\n'.join(lst))
subprocess.run([FF, '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', S + 'work/seg/list.txt', '-c', 'copy', S + 'work/aroll_video.mp4'], check=True)
# audio from the DJI mic, 6 ms fades at every join
raw = subprocess.run([FF, '-loglevel', 'error', '-i', S + 'src/mic.wav', '-f', 'f32le', '-ac', '1', '-ar', '48000', '-'], capture_output=True).stdout
x = np.frombuffer(raw, np.float32); sr = 48000; parts = []; fl = int(0.006 * sr)
for a, b in keep:
    seg = x[int(round(a * sr)):int(round(b * sr))].copy()
    n = round((b - a) * 30) * sr // 30; seg = seg[:n] if len(seg) >= n else np.pad(seg, (0, n - len(seg)))
    ramp = np.linspace(0, 1, fl, dtype=np.float32); seg[:fl] *= ramp; seg[-fl:] *= ramp[::-1]
    parts.append(seg)
y = np.concatenate(parts); y.astype(np.float32).tofile(S + 'work/aroll_mic.f32')
print('video frames', sum(round((b - a) * 30) for a, b in keep), 'audio s', len(y) / sr)
