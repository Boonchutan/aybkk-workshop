from common import *
import captions as C
from PIL import Image, ImageDraw, ImageFilter
import subprocess, sys
BW,BH=1080,400; SIZE=66; EH=118; MAXW=860
def low(w): return w if any(c.isupper() for c in w[1:]) and '-' in w else w.lower()
lines=[]
for l in C.lines:
    lines.append(dict(ws=[low(w) for w in l['ws']],wt=l['wt'],emo=l['emo'],start=l['start'],end=l['end']))
def layout(ws,emo_w):
    f=mont(SIZE,800); sp=f.getlength(' ')
    toks=list(ws); wid=[f.getlength(x) for x in toks]; lim=1000-emo_w-22
    def rw(a,b): return sum(wid[a:b])+sp*(b-a-1)
    if rw(0,len(toks))<=lim: return [toks]
    best=None
    for k in range(1,len(toks)):
        m=max(rw(0,k),rw(k,len(toks)))
        if best is None or m<best[0]: best=(m,[toks[:k],toks[k:]])
    if best[0]<=lim: return best[1]
    for k in range(1,len(toks)-1):
        for j in range(k+1,len(toks)):
            m=max(rw(0,k),rw(k,j),rw(j,len(toks)))
            if m<best[0]: best=(m,[toks[:k],toks[k:j],toks[j:]])
    return best[1]
def draw(t):
    img=Image.new('RGBA',(BW,BH),(0,0,0,0))
    cur=[l for l in lines if l['start']<=t<l['end']]
    if not cur: return img
    l=cur[0]; em=emoji(l['emo'],EH)
    p=ease_out_back((t-l['start'])/0.3); emh=max(8,int(EH*p)) if p<1 else EH
    em2=em if emh==EH else em.resize((max(1,int(em.width*emh/EH)),emh))
    rows=layout(l['ws'],em.width)
    txt=Image.new('RGBA',(BW,BH),(0,0,0,0)); td=ImageDraw.Draw(txt)
    y=20; emo_pos=None
    rstart=[]; k=0
    for row in rows:
        rstart.append(l['wt'][k][0]); k+=len(row)
    sp=mont(SIZE,700).getlength(' ')
    widths=[sum(mont(SIZE,800).getlength(x) for x in row)+sp*(len(row)-1) for row in rows]
    block=max(widths); gap=22; shift=(em.width+gap)/2
    for ri,row in enumerate(rows):
        if ri+1<len(rows): on=smooth((t-rstart[ri])/0.14)*(1-smooth((t-rstart[ri+1])/0.14))
        else: on=smooth((t-rstart[ri])/0.14)
        wg=300+500*on
        tw=sum(mont(SIZE,wg).getlength(x) for x in row)+sp*(len(row)-1)
        x0=(BW-tw)/2-shift
        for x in row:
            td.text((x0,y),x,font=mont(SIZE,wg),fill=(255,255,255,255)); x0+=mont(SIZE,wg).getlength(x)+sp
        y+=SIZE+22
    bh=len(rows)*(SIZE+22)-22
    ex=(BW+block)/2-shift+gap; emo_pos=(int(ex+(em.width-em2.width)/2),int(20+bh/2-em2.height/2+6))
    sh=Image.new('RGBA',(BW,BH),(0,0,0,0)); sh.paste((0,0,0,170),mask=txt.getchannel('A')); sh=sh.filter(ImageFilter.GaussianBlur(7))
    img=Image.alpha_composite(img,sh); img=Image.alpha_composite(img,txt)
    if emo_pos: img.alpha_composite(em2,emo_pos)
    return img
if __name__=='__main__':
    if len(sys.argv)>1:
        for t in sys.argv[1:]: draw(float(t)).save(f'cap3_{t}.png')
        sys.exit()
    p=subprocess.Popen(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgba','-s',f'{BW}x{BH}','-r',str(FPS),'-i','-','-c:v','qtrle','caps3.mov'],stdin=subprocess.PIPE)
    for n in range(N):
        p.stdin.write(draw(n/FPS).tobytes())
        if n%300==0: print(n,N,flush=True)
    p.stdin.close(); p.wait(); print('done')
