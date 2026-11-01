import softcards2 as SC
SC.HEADER_TEXT='Hidden Stories of Ashtanga · Ep. 5'
from softcards2 import *
import subprocess, sys
def ws(i): return words[i][0]
def we(i): return words[i][1]
CARDS=[]
def add(i,j,fn,pad_end=0.25):
    CARDS.append([ws(i)-0.12,we(j)+pad_end,fn])
G='pics/g'
add(0,13,img_card('pics/s27-294.jpg'))
add(14,17,g_title('📖','I tell you why','a story from the Ramayana',62,34))
add(18,21,img_card(G+'1.jpg'))
add(22,26,g_title('🧘','Hanumanasana','named after Hanuman',66,36))
add(27,34,img_card(G+'2.jpg'))
add(35,50,img_card(G+'3.jpg'))
add(51,64,g_quote('"To pass, you must','go into my mouth."','Surasa','🐍'))
add(65,74,img_card(G+'4.jpg'))
add(75,95,img_card(G+'5.jpg'))
add(96,100,g_title('💡','Hanuman has an idea','',62))
add(101,118,img_card(G+'6.jpg'))
add(119,131,g_title('✅','he keeps her rule','and still he passes',58,34))
add(132,147,img_card(G+'7.jpg'))
add(148,157,img_card('pics/s31-155.jpg'))
add(158,162,g_title('🤷','bigger and bigger','nobody wins',62,36))
add(163,171,g_title('🤏','go small','a tiny bit deeper · stay · breathe',66,34))
add(172,177,g_title('🙏',"Hanuman's trick",'Hidden Stories of Ashtanga · Ep. 5',54,32),pad_end=0.8)
for k in range(len(CARDS)-1):
    CARDS[k][1]=min(CARDS[k][1],CARDS[k+1][0])
HDR=header()
TW,TH=1080,740
YMID=380
def draw_top(t):
    band=Image.new('RGBA',(TW,TH),(0,0,0,0))
    band.alpha_composite(HDR,((TW-HDR.width)//2,10))
    for s,e,fn in CARDS:
        if not (s-0.01<=t<e+0.25): continue
        lt=t-s; dur=e-s
        content=fn(lt,dur) if getattr(fn,'is_img',False) else fn(lt)
        card=round_card(content); xc=getattr(fn,'xc',540)
        pin=ease_out_back(lt/0.35); a_in=smooth(lt/0.2); a_out=1-smooth((t-e)/0.25) if t>e else 1
        sc=(0.86+0.14*pin)*(1.0+0.03*min(1,lt/max(dur,0.1))); a=a_in*a_out
        cw,ch=int(card.width*sc),int(card.height*sc); c=card.resize((cw,ch),Image.LANCZOS)
        if a<1: c.putalpha(c.getchannel('A').point(lambda v: int(v*a)))
        x=int(xc-cw/2); y=int(YMID-ch/2)
        sh=Image.new('RGBA',(cw+60,ch+60),(0,0,0,0)); ImageDraw.Draw(sh).rounded_rectangle((30,40,30+cw,40+ch),RAD,fill=(0,0,0,int(110*a)))
        band.alpha_composite(sh.filter(ImageFilter.GaussianBlur(14)),(x-30,y-30)); band.alpha_composite(c,(x,y))
    return band
if __name__=='__main__':
    if len(sys.argv)>1:
        for t in sys.argv[1:]: draw_top(float(t)).save(f'top_{t}.png')
        sys.exit()
    p=subprocess.Popen(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgba','-s',f'{TW}x{TH}','-r',str(FPS),'-i','-','-c:v','qtrle','top.mov'],stdin=subprocess.PIPE)
    for n in range(N):
        p.stdin.write(draw_top(n/FPS).tobytes())
        if n%600==0: print(n,N,flush=True)
    p.stdin.close(); p.wait(); print('done')
