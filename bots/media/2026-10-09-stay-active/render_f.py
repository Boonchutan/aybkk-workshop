import numpy as np, json, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from scipy import ndimage
W,H=1080,1350; WM_TOP=1195
GOLD=(224,181,43); WHITE=(255,255,255); CREAM=(255,247,232)
_fc={}
def font(path,size,wg=None):
    k=(path,size,wg)
    if k not in _fc:
        f=ImageFont.truetype(path,size)
        if wg: f.set_variation_by_axes([wg])
        _fc[k]=f
    return _fc[k]
def wrap(text,f,maxw):
    words=text.split(); lines=[]; cur=''
    for w in words:
        t=(cur+' '+w).strip()
        if f.getlength(t)<=maxw: cur=t
        else: lines.append(cur); cur=w
    if cur: lines.append(cur)
    return lines
MANUAL={'063':[(330,300,820,1080)]}
def weighted_mask(n):
    m=(np.asarray(Image.open(f'mask/{n}.png'))>127)
    for x0,y0,x1,y1 in MANUAL.get(n,[]): m[y0:y1,x0:x1]=True
    lab,k=ndimage.label(m); wm=m.astype(np.float32)
    if k:
        sizes=ndimage.sum(m,lab,range(1,k+1)); big=np.argmax(sizes)+1
        wm[lab==big]=4.0
    return wm
QF=('caveat.ttf',700); QS=(66,60,54,48,44,40)
QLINES=5
PENS=((940,[70],0.0),(470,[50,560],0.02),(360,[40,680],0.05))
def layout(slide,width,qmax=66):
    qf=None
    for qs in [q for q in QS if q<=qmax]:
        f=font(QF[0],qs,QF[1]); ql=wrap(slide['quote'] if slide.get('noquote') else '“'+slide['quote']+'”',f,width)
        if len(ql)<=QLINES: qf=f; break
    qf=qf or f
    af=font('Montserrat.ttf',25,650); al=wrap(slide['who'].upper(),af,width)
    inf=font('Montserrat.ttf',33,700); il=wrap(slide['meaning'],inf,width)
    cf=font('Montserrat.ttf',22,700)
    h=30+ len(ql)*int(qf.size*1.08) +14+ len(al)*32 +18+ len(il)*44
    pf=font(slide['pre_font'],slide.get('pre_size',72)) if slide.get('pre') else None
    if pf: h+=int(pf.size*1.5)
    return dict(qf=qf,ql=ql,af=af,al=al,inf=inf,il=il,cf=cf,h=h,w=width,pf=pf)
def choose(n,slide):
    wm=weighted_mask(n); best=None
    for width,xs,pen in PENS:
        L=layout(slide,width); h=L['h']+50
        for x0 in xs:
            for y0 in range(30,WM_TOP-h,15):
                box=wm[y0:y0+h, x0-20:x0+width+20]
                s=box.mean()+pen+ y0/1350*0.01
                if best is None or s<best[0]: best=(s,x0,y0,L)
    return best
def render(n,slide,out,override=None):
    img=Image.open(f'crop/{n}.jpg').convert('RGBA')
    s,x0,y0,L=choose(n,slide) if not override else override
    # scrim
    sc=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(sc)
    d.rounded_rectangle((x0-40,y0-10,x0+L['w']+40,y0+L['h']+40),60,fill=(12,8,16,150))
    sc=sc.filter(ImageFilter.GaussianBlur(45)); img=Image.alpha_composite(img,sc)
    txt=Image.new('RGBA',(W,H),(0,0,0,0)); t=ImageDraw.Draw(txt)
    y=y0+10
    ctr=slide['counter']
    if L['cf'].getlength(ctr)>L['w']: ctr=ctr.split('·')[0].strip()
    t.text((x0,y),ctr,font=L['cf'],fill=GOLD+(255,)); y+=34
    if L.get('pf'): t.text((x0,y),slide['pre'],font=L['pf'],fill=CREAM+(255,)); y+=int(L['pf'].size*1.5)
    for l in L['ql']: t.text((x0,y),l,font=L['qf'],fill=CREAM+(255,)); y+=int(L['qf'].size*1.08)
    y+=14
    for l in L['al']: t.text((x0,y),l,font=L['af'],fill=GOLD+(255,)); y+=32
    y+=18
    for l in L['il']: t.text((x0,y),l,font=L['inf'],fill=WHITE+(255,)); y+=44
    sh=Image.new('RGBA',(W,H),(0,0,0,0)); sh.paste((0,0,0,210),mask=txt.getchannel('A')); sh=sh.filter(ImageFilter.GaussianBlur(4))
    img=Image.alpha_composite(img,sh); img=Image.alpha_composite(img,txt)
    img.convert('RGB').save(out,quality=92)
    return (x0,y0,L['w'],L['h'],round(float(s),3))
if __name__=='__main__':
    demo=dict(counter='01 / 12  ·  FROM WEAK TO STRONG',quote='Fire tests gold, suffering tests brave men.',who='Seneca, On Providence',
              meaning='Hard days are not the end. They show what you are made of.')
    import glob,os
    for n in sys.argv[1:]: print(n,render(n,demo,f'test_{n}.jpg'))

FORCE={}   # photo -> (width, x0, y0)
def render_slide(n,slide,out):
    if n in FORCE:
        w,x0,y0,*q=FORCE[n]; L=layout(slide,w,*q); return render(n,slide,out,override=(0,x0,y0,L))
    return render(n,slide,out)
