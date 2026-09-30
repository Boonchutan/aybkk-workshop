from softcards import *
import subprocess, sys
R_=remap
def ws(i): return R_(words[i][0])
def we(i): return R_(words[i][1])
CARDS=[]
def add(i,j,fn,pad_end=0.25):
    CARDS.append([ws(i)-0.12,we(j)+pad_end,fn])
P='photos/GC9A'
add(0,3,img_card(P+'8135.jpg',(0.55,0.35)))
add(4,13,img_card(P+'7574.jpg',(0.8,0.5)))
add(14,21,g_title('📜','2,000 years ago','his story was told long before him',58,32))
add(22,33,g_title('📚','Mahabharata','the great old story book'))
add(34,41,img_card('img/3_boy.jpg',(0.5,0.45)))
add(42,52,img_card('img/4_eight.jpg',(0.5,0.4)))
add(53,65,img_card('img/1_chant.jpg',(0.5,0.6)))
add(66,75,img_card('img/2_angry.jpg',(0.5,0.45)))
add(76,89,img_card('img/5_lap.jpg',(0.5,0.6)))
add(90,106,img_card('img/6_gate.jpg',(0.5,0.6)))
add(107,121,g_quote("Grey hair doesn't make you old.","What you know makes you old.",'the boy, age 12','👴🧠'))
add(122,126,img_card('img/7_hall.jpg',(0.5,0.6)))
add(127,139,img_card('img/8_river.jpg',(0.5,0.55)))
add(140,149,g_eight)
add(150,159,g_quote('"As a child,','I was always ill."','Sharathji','🤒'))
add(160,180,g_title('🏏','back door, then cricket','Amma came searching for him',50,32))
add(181,186,g_title('🙏','Guruji','Sri K. Pattabhi Jois'))
t0=ws(187)-0.12
add(187,208,g_list('from age 19',['stopped running around','practice before dawn','helped Guruji teach','for almost 20 years'],[ws(i)-t0 for i in (187,193,199,205)]))
add(209,214,g_title('6️⃣','all six series','Guruji taught him everything',58,32))
add(215,225,g_quote('"I could feel my body','heal and repair."','Sharathji','💚'))
add(226,233,g_title('📅','2007','Guruji was too weak to teach'))
add(234,249,img_card(P+'7785.jpg',(0.75,0.4)))
add(250,259,g_title('🧘','300 to 400','students every morning in Mysore',60,34))
add(260,268,img_card(P+'8167.jpg',(0.5,0.45)))
add(269,276,img_card(P+'7763.jpg',(0.35,0.4)))
add(277,284,img_card(P+'7807.jpg',(0.5,0.36)),pad_end=1.6)
t0=ws(285)-0.12
add(285,307,g_list('the truth',['a strong body makes the practice','the practice makes the body strong'],[ws(i)-t0 for i in (291,300)],['x','v']))
add(308,328,g_title('🧘','Astavakrasana A and B','Advanced A series',50,34))
t0=ws(329)-0.12
add(329,344,g_list('both',['Ashtavakra: a crooked boy','Sharathji: a sick boy','the practice made them strong'],[ws(i)-t0 for i in (329,334,339)]))
add(345,350,img_card('img/5_lap.jpg',(0.5,0.6)))
add(351,356,img_card(P+'7574.jpg',(0.8,0.5)))
add(357,362,img_card(P+'7554.jpg',(0.5,0.4)))
add(363,365,g_title('🎂🙏','Happy birthday, Sharathji','29 September 1971',48,34),pad_end=0.8)
for k in range(len(CARDS)-1):   # no overlaps: end where the next one starts
    CARDS[k][1]=min(CARDS[k][1],CARDS[k+1][0])
HDR=header()
TW,TH=1080,720      # band placed at screen y=60
CARD_Y=88           # screen y 148..648
def draw_top(t):
    band=Image.new('RGBA',(TW,TH),(0,0,0,0))
    band.alpha_composite(HDR,((TW-HDR.width)//2,10))
    for s,e,fn in CARDS:
        if not (s-0.01<=t<e+0.25): continue
        lt=t-s; dur=e-s
        content=fn(lt,dur) if getattr(fn,'is_img',False) else fn(lt)
        card=soft_card(content)
        pin=ease_out_back(lt/0.35); a_in=smooth(lt/0.2); a_out=1-smooth((t-e)/0.25) if t>e else 1
        sc=0.86+0.14*pin; a=a_in*a_out
        cw,ch=int(CW*sc),int(CH*sc); c=card.resize((cw,ch),Image.LANCZOS)
        if a<1: c.putalpha(c.getchannel('A').point(lambda v: int(v*a)))
        band.alpha_composite(c,((TW-cw)//2,CARD_Y+(CH-ch)//2))
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
