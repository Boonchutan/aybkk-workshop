from common import *
import captions as C
from PIL import Image, ImageDraw, ImageFilter
import subprocess, sys
BW,BH=1080,400; SIZE=70; EH=100; MAXW=880
def low(w): return w if any(c.isupper() for c in w[1:]) and '-' in w else w.lower()
lines=[]
for l in C.lines:
    lines.append(dict(ws=[low(w) for w in l['ws']],wt=l['wt'],emo=l['emo'],start=l['start'],end=l['end']))
def layout(ws,emo_w):
    f=mont(SIZE,700); sp=f.getlength(' ')
    toks=ws+['<E>']; wid=[emo_w if x=='<E>' else f.getlength(x) for x in toks]
    tot=sum(wid)+sp*(len(toks)-1)
    if tot<=MAXW: return [toks]
    best=None
    for k in range(1,len(toks)):
        a=sum(wid[:k])+sp*(k-1); b=sum(wid[k:])+sp*(len(toks)-k-1)
        m=max(a,b)
        if best is None or m<best[0]: best=(m,k)
    k=best[1]; return [toks[:k],toks[k:]]
def draw(t):
    img=Image.new('RGBA',(BW,BH),(0,0,0,0))
    cur=[l for l in lines if l['start']<=t<l['end']]
    if not cur: return img
    l=cur[0]; em=emoji(l['emo'],EH)
    p=ease_out_back((t-l['start'])/0.3); emh=max(8,int(EH*p)) if p<1 else EH
    em2=em if emh==EH else em.resize((max(1,int(em.width*emh/EH)),emh))
    rows=layout(l['ws'],em.width)
    txt=Image.new('RGBA',(BW,BH),(0,0,0,0)); td=ImageDraw.Draw(txt)
    y=20; idx=0; emo_pos=None
    for row in rows:
        items=[]
        for x in row:
            if x=='<E>': items.append(('<E>',None)); continue
            ws,we=l['wt'][idx]; k=smooth((t-ws)/0.14); idx+=1
            items.append((x,300+400*k))
        sp=mont(SIZE,700).getlength(' ')
        tw=sum(em.width if x=='<E>' else mont(SIZE,wg).getlength(x) for x,wg in items)+sp*(len(items)-1)
        x0=(BW-tw)/2
        for x,wg in items:
            if x=='<E>': emo_pos=(int(x0+(em.width-em2.width)/2),int(y+SIZE*0.55-em2.height/2+8)); x0+=em.width+sp; continue
            td.text((x0,y),x,font=mont(SIZE,wg),fill=(255,255,255,255)); x0+=mont(SIZE,wg).getlength(x)+sp
        y+=SIZE+16
    sh=Image.new('RGBA',(BW,BH),(0,0,0,0)); sh.paste((0,0,0,170),mask=txt.getchannel('A')); sh=sh.filter(ImageFilter.GaussianBlur(7))
    img=Image.alpha_composite(img,sh); img=Image.alpha_composite(img,txt)
    if emo_pos: img.alpha_composite(em2,emo_pos)
    return img
if __name__=='__main__':
    if len(sys.argv)>1:
        for t in sys.argv[1:]: draw(float(t)).save(f'cap_{t}.png')
        sys.exit()
    p=subprocess.Popen(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgba','-s',f'{BW}x{BH}','-r',str(FPS),'-i','-','-c:v','qtrle','caps2.mov'],stdin=subprocess.PIPE)
    for n in range(N):
        p.stdin.write(draw(n/FPS).tobytes())
        if n%300==0: print(n,N,flush=True)
    p.stdin.close(); p.wait(); print('done')
