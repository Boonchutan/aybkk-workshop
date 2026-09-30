from common import *
from PIL import Image, ImageDraw, ImageFilter, ImageOps
import numpy as np
CW,CH=1080,640; FEATHER=70; SAFE=880; OFF=70
NAVY1,NAVY2=(36,50,104),(18,27,66); GOLD=(227,185,76); CREAM=(243,233,210); RED=(226,92,92); GREEN=(92,196,140)
def _soft_mask(f=FEATHER):
    m=Image.new('L',(CW,CH),0); ImageDraw.Draw(m).rounded_rectangle((f,f,CW-f,CH-f),60,fill=255)
    return m.filter(ImageFilter.GaussianBlur(f*0.55))
MASK=_soft_mask()
def soft_card(content):
    c=Image.new('RGBA',(CW,CH),(0,0,0,0)); c.paste(content.convert('RGBA'),(0,0),MASK); return c
def navy_bg():
    g=np.linspace(0,1,CH)[:,None,None]; a=np.array(NAVY1)[None,None,:]*(1-g)+np.array(NAVY2)[None,None,:]*g
    return Image.fromarray(np.repeat(a,CW,1).astype('uint8'),'RGB')
def ctext(d,y,s,size,wg,fill):
    while size>22 and d.textlength(s,font=mont(size,wg))>SAFE: size-=2
    f=mont(size,wg); w=d.textlength(s,font=f); d.text(((CW-w)/2,y+OFF),s,font=f,fill=fill); return w
def fade(col,a,bg=NAVY1): return tuple(int(c*a+n*(1-a)) for c,n in zip(col,bg))
def cover(im,zoom,focus=(0.5,0.5)):
    ar=CW/CH; w,h=im.size
    if w/h>ar:
        nw=int(h*ar); x=int((w-nw)*focus[0]); im=im.crop((x,0,x+nw,h))
    else:
        nh=int(w/ar); y=int((h-nh)*focus[1]); im=im.crop((0,y,w,y+nh))
    w,h=im.size; zw,zh=w/zoom,h/zoom
    im=im.crop(((w-zw)/2,(h-zh)/2,(w+zw)/2,(h+zh)/2)); return im.resize((CW,CH),Image.LANCZOS)
_src={}
def img_card(path,focus=(0.5,0.5),box=None):
    if path not in _src:
        im=ImageOps.exif_transpose(Image.open(path)).convert('RGB'); im.thumbnail((2400,2400)); _src[path]=im
    src=_src[path].crop(box) if box else _src[path]
    def f(lt,dur): return cover(src,1.0+0.07*(lt/max(dur,0.1)),focus)
    f.is_img=True; return f
def g_title(emo,title,sub,tsize=60,ssize=36):
    def f(lt):
        im=navy_bg(); d=ImageDraw.Draw(im)
        if emo: e=emoji(emo,100); im.paste(e,((CW-e.width)//2,88+OFF),e)
        ctext(d,205,title,tsize,800,GOLD)
        if sub: ctext(d,205+tsize+16,sub,ssize,500,CREAM)
        return im
    return f
def g_quote(q1,q2,who,emo=None):
    def f(lt):
        im=navy_bg(); d=ImageDraw.Draw(im); y=120
        if emo: e=emoji(emo,76); im.paste(e,((CW-e.width)//2,82+OFF),e); y=180
        ctext(d,y,q1,46,800,GOLD)
        if q2: ctext(d,y+60,q2,46,800,GOLD)
        ctext(d,y+(128 if q2 else 70),who,30,500,CREAM); return im
    return f
def g_list(title,items,times,marks=None):
    def f(lt):
        im=navy_bg(); d=ImageDraw.Draw(im); ctext(d,90,title,40,800,GOLD); y=148
        for i,(it,t) in enumerate(zip(items,times)):
            a=smooth((lt-t)/0.25)
            if a>0:
                col=fade(CREAM,a); fs=38
                while fs>24 and mont(fs,600).getlength(it)>SAFE-70: fs-=2
                x0=(CW-mont(fs,600).getlength(it))/2
                if marks:
                    e=emoji({'x':'❌','v':'✅'}[marks[i]],40)
                    if a<1: e=e.copy(); e.putalpha(e.getchannel('A').point(lambda v: int(v*a)))
                    im.paste(e,(int(x0-58),y+6+OFF),e)
                d.text((x0,y+2+OFF),it,font=mont(fs,600),fill=col)
            y+=56
        return im
    return f
def g_eight(lt):
    im=navy_bg(); d=ImageDraw.Draw(im)
    ctext(d,110,'ashta = 8',56,800,GOLD); ctext(d,185,'vakra = crooked',56,800,GOLD)
    a=smooth((lt-0.6)/0.3)
    if a>0: ctext(d,275,'Ashtavakra',44,600,fade(CREAM,a))
    return im
def g_numbers(lines,emo):
    def f(lt):
        im=navy_bg(); d=ImageDraw.Draw(im)
        e=emoji(emo,90); im.paste(e,((CW-e.width)//2,90),e); y=200
        for i,(txt,size,col) in enumerate(lines):
            ctext(d,y,txt,size,800 if col==GOLD else 500,col); y+=size+16
        return im
    return f
HEADER_TEXT='Hidden Stories of Ashtanga · Ep. 3'
def header():
    f=mont(38,600); tmp=ImageDraw.Draw(Image.new('RGB',(1,1))); w=tmp.textlength(HEADER_TEXT,font=f)
    pw,ph=int(w+80),78; im=Image.new('RGBA',(pw,ph),(0,0,0,0)); d=ImageDraw.Draw(im)
    d.rounded_rectangle((0,0,pw-1,ph-1),ph//2,fill=(22,30,48,205)); d.text((40,17),HEADER_TEXT,font=f,fill=(255,255,255,255)); return im

CREAMBG=(236,233,226)
_fr={}
def anim_card(t0,t1,folder='ig/fr',fps=30,scale=0.76):
    def frame(k):
        if k not in _fr:
            im=Image.open(f'{folder}/{k:04d}.jpg').convert('RGB')
            w=int(CW*scale); h=int(im.height*w/im.width); im=im.resize((w,h),Image.LANCZOS)
            bg=Image.new('RGB',(CW,CH),CREAMBG); bg.paste(im,((CW-w)//2,(CH-h)//2)); _fr[k]=bg
        return _fr[k]
    def f(lt,dur):
        t=min(t1,t0+lt); return frame(int(t*fps)+1)
    f.is_img=True; return f
