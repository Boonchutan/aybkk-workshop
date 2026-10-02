import json
from PIL import ImageFont, Image, ImageDraw
FPS=30
words=json.load(open('cwords.json'))
DUR=119.8; TAIL=0.8
TOTAL=DUR+TAIL; N=int(round(TOTAL*FPS))
keep=[(0.0,DUR,1.0)]
def remap(t): return t
_fc={}
def mont(size,wg):
    wg=int(round(wg/50)*50); k=(size,wg)
    if k not in _fc:
        f=ImageFont.truetype('Montserrat.ttf',size); f.set_variation_by_axes([wg]); _fc[k]=f
    return _fc[k]
EF=ImageFont.truetype('/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf',109)
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
