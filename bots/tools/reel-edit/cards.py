from common import *
from PIL import Image, ImageDraw, ImageFilter
import numpy as np, subprocess, sys
CW,CH=586,346; R=24
NAVY1,NAVY2=(36,50,104),(18,27,66); GOLD=(227,185,76); CREAM=(243,233,210); RED=(226,92,92); GREEN=(92,196,140)
def rounded_mask(w,h,r):
    m=Image.new('L',(w,h),0); ImageDraw.Draw(m).rounded_rectangle((0,0,w-1,h-1),r,fill=255); return m
MASK=rounded_mask(CW,CH,R)
def frame_card(content):
    """content: RGB/RGBA CWxCH -> RGBA card with border"""
    c=Image.new('RGBA',(CW,CH),(0,0,0,0)); c.paste(content.convert('RGBA'),(0,0),MASK)
    ImageDraw.Draw(c).rounded_rectangle((1,1,CW-2,CH-2),R,outline=(235,235,240,230),width=4)
    return c
def navy_bg():
    g=np.linspace(0,1,CH)[:,None,None]; a=np.array(NAVY1)[None,None,:]*(1-g)+np.array(NAVY2)[None,None,:]*g
    return Image.fromarray(np.repeat(a,CW,1).astype('uint8'),'RGB')
def ctext(d,y,s,size,wg,fill,x=None):
    f=mont(size,wg); w=d.textlength(s,font=f); d.text(((CW-w)/2 if x is None else x,y),s,font=f,fill=fill); return w
def img_src(path,box=None):
    im=Image.open(path).convert('RGB')
    if box: im=im.crop(box)
    return im
def cover(im,zoom):
    # crop to card aspect then zoom
    ar=CW/CH; w,h=im.size
    if w/h>ar: nw=int(h*ar); im=im.crop(((w-nw)//2,0,(w-nw)//2+nw,h))
    else: nh=int(w/ar); im=im.crop((0,(h-nh)//2,w,(h-nh)//2+nh))
    w,h=im.size; zw,zh=w/zoom,h/zoom
    im=im.crop(((w-zw)/2,(h-zh)/2,(w+zw)/2,(h+zh)/2)); return im.resize((CW,CH),Image.LANCZOS)
# ---- graphic cards (items appear at local times) ----
def g_part2(lt):
    im=navy_bg(); d=ImageDraw.Draw(im)
    e=emoji('⚡',120); im.paste(e,((CW-e.width)//2,40),e)
    ctext(d,185,'Part 2',54,800,GOLD); ctext(d,255,'the Vajrasana story',38,600,CREAM); return im
def g_book(lt):
    im=navy_bg(); d=ImageDraw.Draw(im)
    e=emoji('📜',120); im.paste(e,((CW-e.width)//2,38),e)
    ctext(d,185,'Paniniya Shiksha',46,800,GOLD); ctext(d,250,'an old guide to Vedic chanting',30,500,CREAM); return im
def g_accent(big,hi_first,meaning):
    def f(lt):
        im=navy_bg(); d=ImageDraw.Draw(im)
        # word with stressed part
        pre,stress,post=big
        fs=62; fb=mont(fs,800); fl=mont(fs,400)
        w=d.textlength(pre,font=fl)+d.textlength(stress,font=fb)+d.textlength(post,font=fl); x=(CW-w)/2; y=110
        d.text((x,y),pre,font=fl,fill=CREAM); x+=d.textlength(pre,font=fl)
        sx=x; d.text((x,y),stress,font=fb,fill=GOLD); sw=d.textlength(stress,font=fb); x+=sw
        d.text((x,y),post,font=fl,fill=CREAM)
        # up arrow over stressed part, bouncing
        b=6*np.sin(lt*6); ax=sx+sw/2; ay=70+b
        d.polygon([(ax,ay-30),(ax-22,ay),(ax+22,ay)],fill=GOLD); d.rectangle((ax-7,ay,ax+7,ay+22),fill=GOLD)
        ctext(d,225,'= '+meaning,40,600,CREAM); return im
    return f
def g_comment(lt):
    im=navy_bg(); d=ImageDraw.Draw(im); e=emoji('💬',120); im.paste(e,((CW-e.width)//2,45),e)
    ctext(d,190,'Know the real way?',44,800,GOLD); ctext(d,252,'tell me in the comments',34,500,CREAM); return im
def g_supta(lt):
    im=navy_bg(); d=ImageDraw.Draw(im); e=emoji('🪷⚡',110); im.paste(e,((CW-e.width)//2,45),e)
    ctext(d,185,'Supta Vajrasana',50,800,GOLD); ctext(d,252,'the sleeping thunderbolt',34,500,CREAM); return im
def g_list(title,items,times,marks=None,colors=None):
    def f(lt):
        im=navy_bg(); d=ImageDraw.Draw(im); ctext(d,26,title,36,800,GOLD); y=86
        for i,(it,t) in enumerate(zip(items,times)):
            a=smooth((lt-t)/0.25)
            if a<=0: y+=62; continue
            col=tuple(int(c*a+n*(1-a)) for c,n in zip(CREAM,NAVY1))
            if marks:
                m={'✗':'❌','✓':'✅'}[marks[i]]; e=emoji(m,40)
                if a<1: e=e.copy(); e.putalpha(e.getchannel('A').point(lambda v: int(v*a)))
                im.paste(e,(66,y+6),e); d.text((130,y+2),it,font=mont(38,600),fill=col)
            else:
                d.text((70,y),f'{i+1}',font=mont(40,900),fill=GOLD); d.text((130,y+2),it,font=mont(38,600),fill=col)
            y+=62
        return im
    return f
def g_versus(lt):
    im=navy_bg(); d=ImageDraw.Draw(im)
    a=smooth(lt/0.3); b=smooth((lt-remap(118.58)+remap(115.6))/0.3)
    ctext(d,40,'wrong place',44,700,tuple(int(c*a+n*(1-a)) for c,n in zip(CREAM,NAVY1)))
    if a>0: e=emoji('👹',90); im.paste(e,((CW-e.width)//2,95),e)
    if b>0:
        ctext(d,195,'right place',44,700,tuple(int(c*b+n*(1-b)) for c,n in zip(GOLD,NAVY1)))
        e=emoji('⚡🪷',80); im.paste(e,((CW-e.width)//2,252),e)
    return im
def g_morning(lt):
    im=navy_bg(); d=ImageDraw.Draw(im)
    ctext(d,40,'Tvashtr: one chance',42,700,CREAM)
    b=smooth((lt-(remap(124.92)-remap(122.6)))/0.3)
    if b>0:
        ctext(d,125,'you: every morning',46,800,tuple(int(c*b+n*(1-b)) for c,n in zip(GOLD,NAVY1)))
        e=emoji('🌅',110); im.paste(e,((CW-e.width)//2,210),e)
    return im
def img_card(path,box=None):
    src=img_src(path,box)
    def f(lt,dur): return cover(src,1.0+0.07*(lt/max(dur,0.1)))
    return f
R_=remap
def span(a,b): return (R_(a),R_(b))
CARDS=[]
def add(a,b,fn,is_img=False): s,e=span(a,b); CARDS.append((s,e,fn,is_img))
add(0.0,7.6,g_part2)
add(8.0,15.5,g_book)
add(16.0,18.3,img_card('his/6242.jpg'),True)
add(18.3,25.5,img_card('his/6248.jpg'),True)
add(25.6,28.6,img_card('his/6246.jpg',(0,100,780,560)),True)
add(28.7,32.3,img_card('his/6247.jpg'),True)
add(32.5,36.6,img_card('his/6249.jpg',(0,60,1000,648)),True)
add(37.0,42.1,g_accent(('indrasha-','TRU',''),False,'killer of Indra'))
add(42.2,46.6,g_accent(('','IN','-drashatru'),True,'the one Indra kills'))
add(47.0,51.6,g_comment)
add(52.1,54.6,img_card('his/6249.jpg'),True)
add(54.8,58.0,img_card('his/6246.jpg'),True)
add(58.2,64.0,g_supta)
st=[R_(x)-R_(64.2) for x in (64.24,65.72,67.14,70.06)]
add(64.2,71.0,g_list('Supta Vajrasana',['legs in lotus','hold your feet','lean back, head down','come up'],st))
st=[R_(x)-R_(71.6) for x in (71.68,73.78,75.36,77.52)]
add(71.6,81.9,g_list('coming up the hard way',['pull with the abs','back pushes the arms','hands slide off','grab a friend\'s hand'],st,['✗','✗','✗','✗'],[RED]*4))
add(84.1,86.6,img_card('his/6249.jpg',(0,60,1000,648)),True)
add(87.4,89.3,g_list('louder...',['does not fix','the wrong place'],[0,0.4]))
st=[R_(x)-R_(100.9) for x in (100.98,103.04)]
add(100.9,104.2,g_list('it is not',['strength','flexibility'],st,['✗','✗'],[RED,RED]))
st=[R_(x)-R_(104.3) for x in (106.66,107.8,109.3,110.1)]
add(104.3,113.4,g_list('lift from',['the abs','the hands','the chest','bandha + breath'],st,['✗','✗','✓','✓'],[RED,RED,GREEN,GREEN]))
add(115.6,121.7,g_versus)
add(122.6,127.0,g_morning)
# header pill
def header():
    f=mont(38,600); s='Hidden Stories of Ashtanga · Ep. 2'
    tmp=ImageDraw.Draw(Image.new('RGB',(1,1))); w=tmp.textlength(s,font=f)
    pw,ph=int(w+80),78; im=Image.new('RGBA',(pw,ph),(0,0,0,0)); d=ImageDraw.Draw(im)
    d.rounded_rectangle((0,0,pw-1,ph-1),ph//2,fill=(22,30,48,205)); d.text((40,17),s,font=f,fill=(255,255,255,255)); return im
HDR=header()
TW,TH=1080,620   # top band placed at y=90
CARD_Y=128  # within band => screen y 218
def draw_top(t):
    band=Image.new('RGBA',(TW,TH),(0,0,0,0))
    band.alpha_composite(HDR,((TW-HDR.width)//2,10))
    for s,e,fn,is_img in CARDS:
        if not (s-0.01<=t<e+0.25): continue
        lt=t-s; dur=e-s
        content=fn(lt,dur) if is_img else fn(lt)
        card=frame_card(content)
        pin=ease_out_back(lt/0.35); a_in=smooth(lt/0.2); a_out=1-smooth((t-e)/0.25) if t>e else 1
        sc=0.82+0.18*pin; a=a_in*a_out
        cw,ch=int(CW*sc),int(CH*sc); c=card.resize((cw,ch),Image.LANCZOS)
        if a<1: c.putalpha(c.getchannel('A').point(lambda v: int(v*a)))
        sh=Image.new('RGBA',(cw+60,ch+60),(0,0,0,0)); ImageDraw.Draw(sh).rounded_rectangle((30,36,30+cw,36+ch),R,fill=(0,0,0,int(120*a)))
        sh=sh.filter(ImageFilter.GaussianBlur(14))
        x=(TW-cw)//2; y=CARD_Y+(CH-ch)//2
        band.alpha_composite(sh,(x-30,y-30)); band.alpha_composite(c,(x,y))
    return band
if __name__=='__main__':
    if len(sys.argv)>1:
        for t in sys.argv[1:]: draw_top(float(t)).save(f'top_{t}.png')
        sys.exit()
    p=subprocess.Popen(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgba','-s',f'{TW}x{TH}','-r',str(FPS),'-i','-','-c:v','qtrle','top.mov'],stdin=subprocess.PIPE)
    for n in range(N):
        p.stdin.write(draw_top(n/FPS).tobytes())
        if n%300==0: print(n,N,flush=True)
    p.stdin.close(); p.wait(); print('done')
