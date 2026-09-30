# Chinese Weight Shift captions (same timing as the English lines), bigger emoji than the English cut.
from common import *
import captions as C
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import json, subprocess, sys
ZH=json.load(open('zh.json'))['lines']; assert len(ZH)==len(C.lines)
BW,BH=1080,400; SIZE=64; EH=150; GAP=24
_zf={}
def zf(wg):
    wg=int(round(wg/50)*50)
    if wg not in _zf:
        f=ImageFont.truetype('NotoSansSC.ttf',SIZE); f.set_variation_by_axes([wg]); _zf[wg]=f
    return _zf[wg]
NOSTART=set('，。！？、；：」”』）》…,.!?')
def rows_for(txt,limit):
    f=zf(800)
    if f.getlength(txt)<=limit: return [txt]
    for n in (2,3):
        L=len(txt); best=None
        cuts=[round(L*k/n) for k in range(1,n)]
        # nudge cuts so a row never starts with punctuation
        cuts=[c+1 if c<L and txt[c] in NOSTART else c for c in cuts]
        parts=[txt[a:b] for a,b in zip([0]+cuts,cuts+[L])]
        if max(f.getlength(p) for p in parts)<=limit: return parts
    return parts
lines=[]
for l,zh in zip(C.lines,ZH):
    em=emoji(l['emo'],EH); rows=rows_for(zh,1000-em.width-GAP)
    n=len(l['wt']); starts=[l['wt'][min(n-1,round(k*n/len(rows)))][0] for k in range(len(rows))]
    lines.append(dict(rows=rows,starts=starts,emo=l['emo'],start=l['start'],end=l['end']))
def draw(t):
    img=Image.new('RGBA',(BW,BH),(0,0,0,0))
    cur=[l for l in lines if l['start']<=t<l['end']]
    if not cur: return img
    l=cur[0]; em=emoji(l['emo'],EH)
    p=ease_out_back((t-l['start'])/0.3); emh=max(8,int(EH*p)) if p<1 else EH
    em2=em if emh==EH else em.resize((max(1,int(em.width*emh/EH)),emh))
    txt=Image.new('RGBA',(BW,BH),(0,0,0,0)); td=ImageDraw.Draw(txt)
    block=max(zf(800).getlength(r) for r in l['rows']); shift=(em.width+GAP)/2
    y=24; rh=SIZE+24
    for ri,row in enumerate(l['rows']):
        rs=l['starts']
        on=smooth((t-rs[ri])/0.14)*(1-smooth((t-rs[ri+1])/0.14)) if ri+1<len(rs) else smooth((t-rs[ri])/0.14)
        wg=300+500*on; tw=zf(wg).getlength(row)
        td.text(((BW-tw)/2-shift,y),row,font=zf(wg),fill=(255,255,255,255)); y+=rh
    bh=len(l['rows'])*rh-24
    ex=(BW+block)/2-shift+GAP
    sh=Image.new('RGBA',(BW,BH),(0,0,0,0)); sh.paste((0,0,0,170),mask=txt.getchannel('A')); sh=sh.filter(ImageFilter.GaussianBlur(7))
    img=Image.alpha_composite(img,sh); img=Image.alpha_composite(img,txt)
    img.alpha_composite(em2,(int(ex+(em.width-em2.width)/2),int(24+bh/2-em2.height/2+4)))
    return img
if __name__=='__main__':
    if len(sys.argv)>1:
        for t in sys.argv[1:]: draw(float(t)).save(f'capzh_{t}.png')
        sys.exit()
    p=subprocess.Popen(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgba','-s',f'{BW}x{BH}','-r',str(FPS),'-i','-','-c:v','qtrle','caps_zh.mov'],stdin=subprocess.PIPE)
    for n in range(N):
        p.stdin.write(draw(n/FPS).tobytes())
        if n%300==0: print(n,N,flush=True)
    p.stdin.close(); p.wait(); print('done')
