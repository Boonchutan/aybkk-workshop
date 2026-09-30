import json, numpy as np, subprocess, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from common import remap, words, keep, TOTAL
FPS=30
e={'tail':json.load(open('edit.json'))['tail']}
L=[(0,3,"Yesterday was Sharathji's birthday.",[],"🎂"),
(4,8,"Everyone knows his life story,",[],"📖"),
(9,13,"but you probably don't know.",[],"🤫"),
(14,21,"His life story was written 2,000 years ago.",[],"📜"),
(22,29,"In the great old story book, the Mahabharata,",[],"📚"),
(30,33,"the story goes:",[],"👇"),
(34,41,"A boy was born crooked in 8 places.",[],"👶"),
(42,47,"His feet, his knees, his hands,",[],"🦶✋"),
(48,52,"his chest and his head.",[],"🫁"),
(53,61,"Before he was born, he heard his father chanting.",[],"🎶"),
(62,65,"He heard the mistakes.",[],"👂"),
(66,69,"His father got angry",[],"😠"),
(70,75,"and the baby was born crooked.",[],"👶"),
(76,83,"So his grandfather raised him on his lap.",[],"👴"),
(84,89,"And his grandfather was his mentor.",[],"📖"),
(90,98,"At 12, the boy walked to the king's court.",[],"🚶"),
(99,106,"The guard said, \"Go home. You're too young.\"",[],"✋"),
(107,115,"The boy said, \"Grey hair doesn't make you old.",[],"👴"),
(116,121,"What you know makes you old.\"",[],"🧠"),
(122,126,"Then he won the contest.",[],"🏆"),
(127,132,"Then he stepped into a river",[],"🌊"),
(133,139,"and his crooked body came out straight.",[],"✨"),
(140,143,"His name was Ashtavakra.",[],"🪷"),
(144,149,"Ashta means 8. Vakra means crooked.",[],"8️⃣"),
(150,152,"Sharathji always said,",[],"🗣️"),
(153,159,"as a child, he was always ill.",[],"🤒"),
(160,168,"He said, \"I would run out the back door",[],"🚪"),
(169,172,"and go play cricket.",[],"🏏"),
(173,175,"Amma, my grandmother,",[],"👵"),
(176,180,"would come searching for me.\"",[],"🔎"),
(181,186,"His grandfather was Guruji, Pattabhi Jois.",[],"🙏"),
(187,192,"At 19, he stopped running around.",[],"🛑"),
(193,198,"Before dawn, he did the practice.",[],"🌅"),
(199,204,"Then he helped his grandfather teach.",[],"🤝"),
(205,208,"For almost 20 years,",[],"⏳"),
(209,214,"Guruji taught him all six series.",[],"6️⃣"),
(215,217,"And he wrote,",[],"✍️"),
(218,225,"\"I could feel my body heal and repair.\"",[],"💚"),
(226,233,"In 2007, Guruji was too weak to teach.",[],"📅"),
(234,241,"Sharathji took the whole shala on his shoulders.",[],"💪"),
(242,249,"I can only imagine how heavy it felt.",[],"🪨"),
(250,254,"Every morning in Mysore,",[],"🌄"),
(255,259,"300 to 400 students came.",[],"🧘"),
(260,268,"When I hosted him in Bangkok, 500 people came.",[],"🙌"),
(269,276,"He came back to Bangkok in May 2024.",[],"✈️"),
(277,284,"And in November that year, he passed away.",[],"🕯️"),
(285,290,"Maybe your body feels crooked today.",[],"😣"),
(291,299,"It isn't a strong body that makes the practice.",[],"❌"),
(300,307,"It's the practice that makes the body strong.",[],"✅"),
(308,312,"Astavakrasana A and B",[],"🧘"),
(313,318,"are in the Advanced A series.",[],"📘"),
(319,322,"The body twists, folds,",[],"🌀"),
(323,328,"you stay up on your arms.",[],"💪"),
(329,333,"Ashtavakra was a crooked boy.",[],"🪷"),
(334,338,"Sharathji was a sick boy.",[],"🤒"),
(339,344,"The practice made them both strong.",[],"✨"),
(345,350,"The boy on his grandfather's lap",[],"👴"),
(351,356,"became the teacher of the world.",[],"🌍"),
(357,362,"Yesterday, Sharathji would have turned 55.",[],"🎂"),
(363,365,"Happy birthday, Sharathji.",[],"🙏")]
# timings
lines=[]
for i,(a,b,text,keys,emo) in enumerate(L):
    ws=text.split(); src=words[a:b+1]
    st=[remap(w[0]) for w in src]; en=[remap(w[1]) for w in src]
    if len(ws)==len(src): wt=list(zip(st,en))
    else:
        s0,s1=st[0],en[-1]; d=(s1-s0)/len(ws); wt=[(s0+k*d,s0+(k+1)*d) for k in range(len(ws))]
    lines.append(dict(ws=ws,wt=wt,keys=keys,emo=emo,start=wt[0][0]-0.08))
for i,l in enumerate(lines):
    l['end']=(lines[i+1]['start'] if i+1<len(lines) else l['wt'][-1][1]+1.0)
    if 'passed' in l['ws']: l['end']=l['wt'][-1][1]+0.6   # clean silence for him
pass
N=int(round(TOTAL*FPS))
BW,BH=1080,560; Y0=1180
FONT='dmsans.ttf'; SIZE=72
fcache={}
def font(wg):
    wg=int(round(wg/100)*100)
    if wg not in fcache:
        f=ImageFont.truetype(FONT,SIZE); f.set_variation_by_axes([wg]); fcache[wg]=f
    return fcache[wg]
EF=ImageFont.truetype('/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf',109)
ecache={}
def emoji_img(s,h):
    k=(s,h)
    if k not in ecache:
        im=Image.new('RGBA',(109*len(s)+60,140),(0,0,0,0)); d=ImageDraw.Draw(im)
        d.text((10,5),s,font=EF,embedded_color=True); bb=im.getbbox(); im=im.crop(bb)
        r=h/im.height; ecache[k]=im.resize((max(1,int(im.width*r)),h),Image.LANCZOS)
    return ecache[k]
GOLD=(224,181,43); WHITE=(255,255,255)
def layout(ws):
    # wrap using bold width
    f=font(800); sp=f.getlength(' '); rows=[[]]; w=0
    for x in ws:
        lw=f.getlength(x)
        if rows[-1] and w+sp+lw>940: rows.append([]); w=0
        rows[-1].append(x); w+= (sp if w else 0)+lw
    return rows
def ease(x): x=max(0,min(1,x)); return x*x*(3-2*x)
def draw_frame(t):
    img=Image.new('RGBA',(BW,BH),(0,0,0,0))
    cur=[l for l in lines if l['start']<=t<l['end']]
    if not cur: return img
    l=cur[0]; rows=layout(l['ws']); d=ImageDraw.Draw(img)
    # emoji pop
    p=ease((t-l['start'])/0.18); eh=int(150*(0.6+0.4*p)) if p<1 else 150
    em=emoji_img(l['emo'],eh)
    ex=(BW-em.width)//2; ey=150-em.height
    txt=Image.new('RGBA',(BW,BH),(0,0,0,0)); td=ImageDraw.Draw(txt)
    idx=0; y=175
    for row in rows:
        # measure with final weights
        wlist=[]
        for x in row:
            ws,we=l['wt'][idx]; k=ease((t-ws)/0.15)
            wg=300+500*k; col=GOLD if x.lower() in l['keys'] else WHITE
            alpha=int(150+105*k); wlist.append((x,wg,col,alpha)); idx+=1
        sp=font(800).getlength(' ')
        tw=sum(font(wg).getlength(x) for x,wg,_,_ in wlist)+sp*(len(wlist)-1)
        x0=(BW-tw)/2
        for x,wg,col,al in wlist:
            td.text((x0,y),x,font=font(wg),fill=col+(al,)); x0+=font(wg).getlength(x)+sp
        y+=SIZE+14
    sh=Image.new('RGBA',(BW,BH),(0,0,0,0)); sh.paste((0,0,0,210),mask=txt.split()[3]); sh=sh.filter(ImageFilter.GaussianBlur(5))
    img=Image.alpha_composite(img,sh); img=Image.alpha_composite(img,txt)
    img.alpha_composite(em,(ex,ey))
    return img
if __name__=='__main__':
    if len(sys.argv)>1:
        t=float(sys.argv[1]); draw_frame(t).save('capprev.png'); sys.exit()
    p=subprocess.Popen(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgba','-s',f'{BW}x{BH}','-r',str(FPS),'-i','-',
        '-c:v','qtrle','captions.mov'],stdin=subprocess.PIPE)
    last=None; lastkey=None
    for n in range(N):
        t=n/FPS
        im=draw_frame(t); p.stdin.write(im.tobytes())
        if n%300==0: print(n,N,flush=True)
    p.stdin.close(); p.wait(); print('done',N)
    json.dump([(l['start'],l['end'],' '.join(l['ws'])) for l in lines],open('caplines.json','w'))
