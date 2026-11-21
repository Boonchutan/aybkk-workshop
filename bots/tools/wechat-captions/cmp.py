# cmp.py <ch> <ref> <clean frames comma list> : side-by-side (ref | mine) preview
import sys, subprocess, io, json, os
from PIL import Image
J = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
ch, ref, ns = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3].split(',')]
subprocess.run([sys.executable, J + '/tools/wxcap2.py', f'{J}/{ch}.json', '--still', sys.argv[3], f'{J}/out/{ch}_still.png'], check=True)
a = Image.open(f'{J}/out/{ch}_still.png'); W = a.width // len(ns)
fr = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'json', f'{J}/ref/{ref}.mp4'], capture_output=True, text=True).stdout)['streams'][0]['r_frame_rate']
rf = eval(fr)
S = Image.new('RGB', (450 * 2 * len(ns), 800))
for i, n in enumerate(ns):
    k = int(n / 30 * rf)
    p = subprocess.run(['ffmpeg', '-v', 'error', '-i', f'{J}/ref/{ref}.mp4', '-vf', f"select='eq(n,{k})',scale=450:800:flags=lanczos", '-vsync', '0', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], capture_output=True).stdout
    S.paste(Image.open(io.BytesIO(p)).convert('RGB'), (i * 900, 0))
    S.paste(a.crop((i * W, 0, (i + 1) * W, a.height)).resize((450, 800), Image.LANCZOS), (i * 900 + 450, 0))
S.save(f'{J}/out/{ch}_cmp.jpg', quality=90); print('saved', f'{J}/out/{ch}_cmp.jpg')
