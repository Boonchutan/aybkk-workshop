import softcards2 as SC
SC.HEADER_TEXT='Hidden Stories of Ashtanga · Ep. 4'
from softcards2 import *
import subprocess, sys
def ws(i): return words[i][0]
def we(i): return words[i][1]
CARDS=[]
def add(i,j,fn,pad_end=0.25):
    CARDS.append([ws(i)-0.12,we(j)+pad_end,fn])
G='pics/g'
add(0,7,img_card('pics/s4.jpg'))
add(8,27,g_title('🩹','the healing way','you do it anyway'))
add(28,32,g_title('❓','the real answer is...','',62))
add(33,53,g_title('🌧️','Bangkok, rain again','we raced home, afraid of a flood',58,34))
add(54,67,g_title('📚','Panchatantra','an old Indian book of animal stories',62,34))
add(68,96,img_card(G+'2.jpg'))
add(97,112,img_card(G+'8.jpg'))
add(113,128,g_quote('"What a proud little bird.','Let me test him."','the sea','🌊'))
add(129,158,img_card(G+'1.jpg'))
add(159,191,img_card(G+'6.jpg'))
add(192,197,img_card(G+'5.jpg'))
add(198,204,img_card(G+'4.jpg'))
add(205,223,g_title('🙏','Vishnu','the great god',66,36))
add(224,236,img_card(G+'7.jpg'))
add(237,244,g_title('📖','tittibha = a bird','in Sanskrit dictionaries',58,34))
add(245,259,img_card(G+'3.jpg'))
add(260,286,img_card('pics/s2.jpg'))
add(287,309,img_card('pics/s3.jpg'))
add(310,324,img_card(G+'6.jpg'))
add(325,340,g_title('💡',"don't fight the sea alone",'even the little bird needed help',54,34))
add(341,358,img_card('../oct2/raw/012.jpg'))
add(359,369,img_card('pics/s1.jpg'))
add(370,386,img_card('../oct2/raw/092.jpg'))
add(387,401,img_card(G+'7.jpg'))
add(402,414,g_title('😨','your fear','takes something, and teaches you',62,34))
add(415,421,g_title('🪷','one day, it becomes your wisdom','Hidden Stories of Ashtanga · Ep. 4',46,32),pad_end=0.8)
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
