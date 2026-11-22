# outsheet.py <ch> <frames comma list> : tiles frames taken from the FINISHED file (tone-mapped if HDR)
import sys, subprocess, io, json, os
from PIL import Image, ImageDraw
J = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
ch = sys.argv[1]; ns = [int(x) for x in sys.argv[2].split(',')]; spec = json.load(open(f'{J}/{ch}.json')); f = os.path.join(J, spec['out'])
tr = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_transfer', '-of', 'csv=p=0', f], capture_output=True, text=True).stdout.strip()
tm = ',zscale=t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=full,format=rgb24' if tr == 'arib-std-b67' else ''
S = Image.new('RGB', (360 * len(ns), 640))
for i, n in enumerate(ns):
    p = subprocess.run(['ffmpeg', '-v', 'error', '-i', f, '-vf', f"select='eq(n,{n})'{tm},scale=360:640:flags=lanczos", '-vsync', '0', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], capture_output=True).stdout
    im = Image.open(io.BytesIO(p)).convert('RGB'); ImageDraw.Draw(im).text((4, 4), f'{n} ({n / 30:.2f}s)', fill=(255, 255, 0)); S.paste(im, (i * 360, 0))
S.save(f'{J}/out/final_{ch}.jpg', quality=88); print('saved', tr or 'sdr')
