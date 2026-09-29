import json
from PIL import ImageFont
FPS=30
words=json.load(open('words.json')); E=json.load(open('edit.json')); keep=E['keep']
TOTAL=sum(b-a for a,b in keep)+E['tail']; N=int(round(TOTAL*FPS))
def remap(t):
    acc=0.0
    for a,b in keep:
        if t<a: return acc
        if t<=b: return acc+(t-a)
        acc+=b-a
    return acc
_fc={}
def mont(size,wg):
    wg=int(round(wg/50)*50); k=(size,wg)
    if k not in _fc:
        f=ImageFont.truetype('Montserrat.ttf',size); f.set_variation_by_axes([wg]); _fc[k]=f
    return _fc[k]
EF=ImageFont.truetype('/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf',109)
from PIL import Image, ImageDraw
_ec={}
def emoji(s,h):
    k=(s,h)
    if k not in _ec:
        im=Image.new('RGBA',(130*max(1,len(s))+40,150),(0,0,0,0)); d=ImageDraw.Draw(im)
        d.text((10,10),s,font=EF,embedded_color=True); im=im.crop(im.getbbox())
        _ec[k]=im.resize((max(1,int(im.width*h/im.height)),h),Image.LANCZOS)
    return _ec[k]
def ease_out_back(x):
    x=max(0,min(1,x)); c1=1.70158; c3=c1+1; return 1+c3*(x-1)**3+c1*(x-1)**2
def smooth(x): x=max(0,min(1,x)); return x*x*(3-2*x)
