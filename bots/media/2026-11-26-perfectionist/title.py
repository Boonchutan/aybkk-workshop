from PIL import Image, ImageDraw, ImageFont
B = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'
R = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
W, H = 1080, 1920
L1, L2 = 'Yogi superpower #1: The Perfectionist', 'Every shala has one.'
s1 = 52
while ImageFont.truetype(B, s1).getlength(L1) > 900: s1 -= 1
f1 = ImageFont.truetype(B, s1); f2 = ImageFont.truetype(B, round(s1 * 0.78))
w1, w2 = f1.getlength(L1), f2.getlength(L2)
padx, pady, gap = 30, 20, 12
a1 = f1.getbbox(L1); a2 = f2.getbbox(L2)
h1 = a1[3] - a1[1]; h2 = a2[3] - a2[1]
bw = int(max(w1, w2) + 2 * padx); bh = int(h1 + h2 + gap + 2 * pady)
cy = 170
x0 = (W - bw) // 2; y0 = cy - bh // 2
im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
d.rounded_rectangle((x0, y0, x0 + bw, y0 + bh), radius=14, fill=(255, 255, 255, 128))
d.text((W / 2 - w1 / 2, y0 + pady - a1[1]), L1, font=f1, fill=(0, 0, 0, 255))
d.text((W / 2 - w2 / 2, y0 + pady + h1 + gap - a2[1]), L2, font=f2, fill=(0, 0, 0, 255))
im.save('/tmp/claude-0/-home-user-aybkk-workshop/5fef75e8-f96a-51ec-a2b6-837dec39c8e1/scratchpad/perf/work/title.png')
print('size', s1, round(s1 * 0.78), 'box', x0, y0, x0 + bw, y0 + bh)
