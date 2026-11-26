"""Line-drawing stick-figure scenes in the face-only gaps. Output work/stick.mov (1080x300 RGBA), overlaid at y STY.
Each scene: list of polylines in canvas px; they draw on over 'draw' seconds by path length, hold, fade out."""
import math, subprocess, imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFilter, ImageFont
FF = imageio_ffmpeg.get_ffmpeg_exe()
P = '/tmp/claude-0/-home-user-aybkk-workshop/5fef75e8-f96a-51ec-a2b6-837dec39c8e1/scratchpad/perf/'
FONT = '/tmp/claude-0/-home-user-aybkk-workshop/5fef75e8-f96a-51ec-a2b6-837dec39c8e1/scratchpad/fonts_dl/Montserrat.ttf'
W, H, FPS, N, LW = 1080, 300, 30, 2049, 7
def circ(cx, cy, r, a0=0, a1=360, n=28):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]
def fig(x, y, s=1.0, lean=0, arms='down', legs='stand'):
    """x,y = feet centre on the floor. Returns polylines."""
    hip = (x + 10 * lean * s, y - 70 * s); neck = (x + 30 * lean * s, y - 140 * s)
    head = circ(neck[0] + 8 * lean * s, neck[1] - 22 * s, 20 * s)
    out = [head, [hip, neck]]
    if legs == 'stand': out += [[(x - 20 * s, y), hip, (x + 20 * s, y)]]
    elif legs == 'trip': out += [[(x - 35 * s, y - 10 * s), hip, (x + 30 * s, y - 40 * s)]]
    sh = (neck[0] - 4 * lean * s, neck[1] + 18 * s)
    if arms == 'down': out += [[(sh[0] - 25 * s, sh[1] + 50 * s), sh, (sh[0] + 25 * s, sh[1] + 50 * s)]]
    elif arms == 'hips': out += [[(hip[0] - 4, hip[1] - 4), (sh[0] - 30 * s, sh[1] + 25 * s), sh, (sh[0] + 30 * s, sh[1] + 25 * s), (hip[0] + 4, hip[1] - 4)]]
    elif arms == 'up': out += [[(sh[0] - 20 * s, sh[1] - 55 * s), sh, (sh[0] + 35 * s, sh[1] + 40 * s)]]
    elif arms == 'wild': out += [[(sh[0] - 45 * s, sh[1] - 35 * s), sh, (sh[0] + 45 * s, sh[1] - 40 * s)]]
    return out
def mat(x0, y, x1, h=14, ang=0, cx=None):
    pts = [(x0, y), (x1, y), (x1, y - h), (x0, y - h), (x0, y)]
    if ang:
        cx = cx or (x0 + x1) / 2; cy = y - h / 2; a = math.radians(ang)
        pts = [(cx + (px - cx) * math.cos(a) - (py - cy) * math.sin(a), cy + (px - cx) * math.sin(a) + (py - cy) * math.cos(a)) for px, py in pts]
    return [pts]
def wave(x, y0, y1, amp=8, n=3):
    k = 24; return [[(x + amp * math.sin(i / k * n * 2 * math.pi), y0 + (y1 - y0) * i / k) for i in range(k + 1)]]
def qmark(cx, cy, s=1.0):
    return [circ(cx, cy - 22 * s, 18 * s, 200, 400, 16) + [(cx, cy + 6 * s)], circ(cx, cy + 26 * s, 3 * s)]
def bang(cx, cy, s=1.0):
    return [[(cx, cy - 40 * s), (cx, cy + 10 * s)], circ(cx, cy + 26 * s, 3 * s)]
def bulb(cx, cy, s=1.0):
    return [circ(cx, cy, 26 * s, 135, 405, 30), [(cx - 12 * s, cy + 20 * s), (cx - 12 * s, cy + 36 * s), (cx + 12 * s, cy + 36 * s), (cx + 12 * s, cy + 20 * s)],
            [(cx - 42 * s, cy), (cx - 54 * s, cy)], [(cx + 42 * s, cy), (cx + 54 * s, cy)], [(cx, cy - 40 * s), (cx, cy - 52 * s)],
            [(cx - 30 * s, cy - 30 * s), (cx - 38 * s, cy - 38 * s)], [(cx + 30 * s, cy - 30 * s), (cx + 38 * s, cy - 38 * s)]]
FLOOR = 270
S = []
# 1 smell yesterday's tiger balm on the next mat
S.append(dict(t0=0.25, t1=3.15, draw=1.1, lines=fig(400, FLOOR - 16, 1.0, lean=1.6) + mat(300, FLOOR, 520) + mat(560, FLOOR, 780)
              + wave(640, FLOOR - 30, FLOOR - 120) + wave(690, FLOOR - 25, FLOOR - 130) + wave(590, FLOOR - 35, FLOOR - 110)))
# 2 yogi superpower, the mat perfectionist: caped hero on a perfect mat
cape = [[(530, FLOOR - 140), (470, FLOOR - 40), (520, FLOOR - 55), (560, FLOOR - 30), (545, FLOOR - 140)]]
S.append(dict(t0=3.75, t1=7.05, draw=1.2, lines=cape + fig(540, FLOOR - 16, 1.0, arms='hips') + mat(400, FLOOR, 680)
              + [[(372, FLOOR - 130), (382, FLOOR - 118), (372, FLOOR - 106), (362, FLOOR - 118), (372, FLOOR - 130)],
                 [(712, FLOOR - 160), (720, FLOOR - 150), (712, FLOOR - 140), (704, FLOOR - 150), (712, FLOOR - 160)]]))
# 3 your mat is crooked?
S.append(dict(t0=20.5, t1=21.62, draw=0.5, lines=mat(380, FLOOR - 40, 700, h=40, ang=-9) + [[(300, FLOOR), (780, FLOOR)]] + qmark(760, FLOOR - 120)))
# 4 one wrinkle... jump through... everything is ruined / and this is exactly why
wr = [[(330, FLOOR), (470, FLOOR), (490, FLOOR - 22), (510, FLOOR), (750, FLOOR)]]
S.append(dict(t0=26.4, t1=27.9, draw=0.6, lines=wr + fig(520, FLOOR - 30, 1.0, lean=2.2, arms='wild', legs='trip') + bang(660, FLOOR - 140)))
S.append(dict(t0=28.0, t1=29.9, draw=0.8, lines=mat(400, FLOOR, 680) + fig(540, FLOOR - 16, 1.0, arms='up')
              + [circ(640, FLOOR - 190, 10), [(640, FLOOR - 210), (640, FLOOR - 222)], [(660, FLOOR - 190), (672, FLOOR - 190)], [(620, FLOOR - 190), (608, FLOOR - 190)]]))
# 5 right side tighter than the left, by how much, in centimeter: ruler with R short, L long
ruler = [[(300, FLOOR - 40), (780, FLOOR - 40), (780, FLOOR - 100), (300, FLOOR - 100), (300, FLOOR - 40)]] + \
        [[(300 + 24 * i, FLOOR - 100), (300 + 24 * i, FLOOR - 100 + (30 if i % 5 == 0 else 16))] for i in range(1, 20)]
S.append(dict(t0=33.35, t1=37.05, draw=1.2, lines=ruler + [[(300, FLOOR - 140), (560, FLOOR - 140)], [(545, FLOOR - 150), (560, FLOOR - 140), (545, FLOOR - 130)],
              [(300, FLOOR - 190), (660, FLOOR - 190)], [(645, FLOOR - 200), (660, FLOOR - 190), (645, FLOOR - 180)]],
              labels=[('R', 250, FLOOR - 160), ('L', 250, FLOOR - 210), ('cm', 795, FLOOR - 95)]))
# 6 seventh rib? anatomy: spine + 7 ribs, rib 7 marked
spine = [[(540, 40), (540, 260)]]
ribs = []
for i in range(7):
    y = 60 + i * 28; w = 150 - i * 10
    ribs += [[(540, y), (540 - w * 0.6, y + 6), (540 - w, y + 24)], [(540, y), (540 + w * 0.6, y + 6), (540 + w, y + 24)]]
S.append(dict(t0=43.15, t1=46.38, draw=1.3, lines=spine + ribs + [[(760, 240), (700, 235)], [(712, 226), (700, 235), (712, 244)]],
              labels=[('7', 772, 216)]))
# 7 they come and ask, they find out
S.append(dict(t0=48.35, t1=50.1, draw=0.6, lines=fig(430, FLOOR, 1.0, arms='up') + qmark(560, FLOOR - 160)))
S.append(dict(t0=50.1, t1=51.78, draw=0.6, lines=fig(430, FLOOR, 1.0, arms='down') + bulb(570, FLOOR - 160)))
def plen(pl): return sum(math.dist(a, b) for a, b in zip(pl, pl[1:]))
font = ImageFont.truetype(FONT, 46); font.set_variation_by_axes([800])
def render(sc, t):
    k = min(1.0, (t - sc['t0']) / sc['draw']); total = sum(plen(l) for l in sc['lines']); budget = total * k
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    for pl in sc['lines']:
        if budget <= 0: break
        L = plen(pl); pts = [pl[0]]; acc = 0
        for a, b in zip(pl, pl[1:]):
            seg = math.dist(a, b)
            if acc + seg <= budget: pts.append(b); acc += seg
            else:
                r = (budget - acc) / seg if seg else 0; pts.append((a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r)); acc = budget; break
        budget -= L
        if len(pts) > 1: d.line(pts, fill=(255, 255, 255, 255), width=LW, joint='curve')
        for p in (pts[0], pts[-1]): d.ellipse((p[0] - LW / 2, p[1] - LW / 2, p[0] + LW / 2, p[1] + LW / 2), fill=(255, 255, 255, 255))
    if k >= 1:
        for txt, x, y in sc.get('labels', []): d.text((x, y), txt, font=font, fill=(255, 255, 255, 255))
    sh = Image.new('RGBA', (W, H), (0, 0, 0, 0)); sh.paste((0, 0, 0, 200), mask=img.getchannel('A').filter(ImageFilter.MaxFilter(5)))
    sh = sh.filter(ImageFilter.GaussianBlur(6))
    out = Image.alpha_composite(sh, img)
    fo = min(1.0, (sc['t1'] - t) / 0.15)
    if fo < 1: out.putalpha(out.getchannel('A').point(lambda v: int(v * max(fo, 0))))
    return out
blank = Image.new('RGBA', (W, H), (0, 0, 0, 0)).tobytes()
p = subprocess.Popen([FF, '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-', '-c:v', 'qtrle', P + 'work/stick.mov'], stdin=subprocess.PIPE)
for n in range(N):
    t = n / FPS; cur = [s for s in S if s['t0'] <= t < s['t1']]
    p.stdin.write(render(cur[0], t).tobytes() if cur else blank)
p.stdin.close(); p.wait(); print('scenes', len(S))
