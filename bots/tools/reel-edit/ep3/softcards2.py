# Cards v3 (30 Sep): NO blur edge, NO stroke, nothing cropped. Whole picture fitted, rounded corners.
# Portrait photos: smaller and a bit to the side.
from common import *
from PIL import Image, ImageDraw, ImageFilter, ImageOps
import numpy as np, os
FIT_W,FIT_H=1000,560; PORT_H=520; PORT_X=770; RAD=26
CW,CH=1000,500; SAFE=900; OFF=0          # graphic cards
NAVY1,NAVY2=(36,50,104),(18,27,66); GOLD=(227,185,76); CREAM=(243,233,210)
def fit(im,maxw,maxh):
    s=min(maxw/im.width,maxh/im.height); return im.resize((max(1,round(im.width*s)),max(1,round(im.height*s))),Image.LANCZOS)
def navy_bg():
    g=np.linspace(0,1,CH)[:,None,None]; a=np.array(NAVY1)[None,None,:]*(1-g)+np.array(NAVY2)[None,None,:]*g
    return Image.fromarray(np.repeat(a,CW,1).astype('uint8'),'RGB')
def ctext(d,y,s,size,wg,fill):
    while size>22 and d.textlength(s,font=mont(size,wg))>SAFE: size-=2
    f=mont(size,wg); w=d.textlength(s,font=f); d.text(((CW-w)/2,y+OFF),s,font=f,fill=fill); return w
def fade(col,a,bg=NAVY1): return tuple(int(c*a+n*(1-a)) for c,n in zip(col,bg))
_src={}
def img_card(path,focus=None,box=None):
    key=(path,box)
    if key not in _src:
        im=ImageOps.exif_transpose(Image.open(path)).convert('RGB')
        if box: im=im.crop(box)
        port=im.height>im.width
        _src[key]=(fit(im,FIT_W,PORT_H) if port else fit(im,FIT_W,FIT_H), port)
    im,port=_src[key]
    def f(lt,dur): return im
    f.is_img=True; f.xc=PORT_X if port else 540; return f
_fr={}
def anim_card(t0,t1,folder='ig/fr',fps=30):
    def f(lt,dur):
        k=int(min(t1,t0+lt)*fps)+1
        if k not in _fr: _fr[k]=fit(Image.open(f'{folder}/{k:04d}.jpg').convert('RGB'),FIT_W,FIT_H)
        return _fr[k]
    f.is_img=True; f.xc=540; return f
def _wb(im,k=0.75):
    a=np.asarray(im).astype(np.float32); m=a.reshape(-1,3).mean(0); g=(m.mean()/m)**k
    return Image.fromarray(np.clip(a*g,0,255).astype('uint8'))
_sj={}
def clip_card(parts,folder='sj',t_offset=3.5,fps=30):
    n=len(os.listdir(folder))
    def f(lt,dur):
        p=[x for x in parts if x[0]<=lt][-1]; t=p[1]+(lt-p[0])
        k=max(1,min(n,int((t-t_offset)*fps)+1))
        if k not in _sj:
            im=Image.open(f'{folder}/{k:04d}.jpg').convert('RGB'); im=im.crop((0,0,int(im.width*0.965),im.height))
            _sj[k]=fit(_wb(im),FIT_W,FIT_H)
        return _sj[k]
    f.is_img=True; f.xc=540; return f
def g_title(emo,title,sub,tsize=60,ssize=36):
    def f(lt):
        im=navy_bg(); d=ImageDraw.Draw(im)
        if emo: e=emoji(emo,100); im.paste(e,((CW-e.width)//2,88),e)
        ctext(d,205,title,tsize,800,GOLD)
        if sub: ctext(d,205+tsize+16,sub,ssize,500,CREAM)
        return im
    return f
def g_quote(q1,q2,who,emo=None):
    def f(lt):
        im=navy_bg(); d=ImageDraw.Draw(im); y=120
        if emo: e=emoji(emo,76); im.paste(e,((CW-e.width)//2,82),e); y=180
        ctext(d,y,q1,46,800,GOLD)
        if q2: ctext(d,y+60,q2,46,800,GOLD)
        ctext(d,y+(130 if q2 else 70),who,30,500,CREAM); return im
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
                    im.paste(e,(int(x0-58),y+6),e)
                d.text((x0,y+2),it,font=mont(fs,600),fill=col)
            y+=56
        return im
    return f
def g_eight(lt):
    im=navy_bg(); d=ImageDraw.Draw(im)
    ctext(d,110,'ashta = 8',56,800,GOLD); ctext(d,185,'vakra = crooked',56,800,GOLD)
    a=smooth((lt-0.6)/0.3)
    if a>0: ctext(d,275,'Ashtavakra',44,600,fade(CREAM,a))
    return im
_masks={}
def round_card(content):
    w,h=content.size
    if (w,h) not in _masks:
        m=Image.new('L',(w,h),0); ImageDraw.Draw(m).rounded_rectangle((0,0,w-1,h-1),RAD,fill=255); _masks[(w,h)]=m
    c=Image.new('RGBA',(w,h),(0,0,0,0)); c.paste(content.convert('RGBA'),(0,0),_masks[(w,h)]); return c
HEADER_TEXT='Hidden Stories of Ashtanga · Ep. 3'
def header():
    f=mont(38,600); tmp=ImageDraw.Draw(Image.new('RGB',(1,1))); w=tmp.textlength(HEADER_TEXT,font=f)
    pw,ph=int(w+80),78; im=Image.new('RGBA',(pw,ph),(0,0,0,0)); d=ImageDraw.Draw(im)
    d.rounded_rectangle((0,0,pw-1,ph-1),ph//2,fill=(22,30,48,205)); d.text((40,17),HEADER_TEXT,font=f,fill=(255,255,255,255)); return im
