import json, numpy as np, subprocess, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
FPS=30
words=json.load(open('words.json')); e=json.load(open('edit.json')); keep=e['keep']
def remap(t):
    acc=0.0
    for a,b in keep:
        if t<a: return acc
        if t<=b: return acc+(t-a)
        acc+=b-a
    return acc
# (first_idx,last_idx,text,key words (lowercase, stripped), emoji)
L=[(0,5,"The demon who stole the rain",["rain"],"🌧️"),
(6,9,"in my last post.",["post."],"📲"),
(10,15,"This is how he was born.",["born."],"🐉"),
(16,21,"His father made one small mistake.",["mistake."],"⚠️"),
(22,25,"An old Sanskrit book,",["book,"],"📜"),
(26,29,"the Paniniya Shiksha warns:",["paniniya","shiksha"],"📖"),
(30,36,"A holy word said wrong",["wrong"],"🗣️"),
(37,39,"becomes a thunderbolt.",["thunderbolt."],"⚡"),
(40,42,"His father, Tvashtr,",["tvashtr,"],"👴"),
(43,49,"had a first son with three heads.",["three","heads."],"3️⃣"),
(50,54,"He was the gods' priest.",["priest."],"🙏"),
(55,62,"But in secret, he fed the demons.",["secret,","demons."],"🤫👹"),
(63,67,"Indra, king of the gods,",["indra,"],"👑"),
(68,70,"saw the danger.",["danger."],"👀"),
(71,76,"So he cut off his head.",["head."],"⚔️"),
(77,80,"Cut off three heads.",["three"],"🐦🐦🐦"),
(81,86,"Tvashtr chanted for a new son,",["chanted"],"🔥"),
(87,93,"the one who wanted to kill Indra.",["kill"],"🎯"),
(94,99,"He wanted to chant indrasha-TRU",["indrasha-tru"],"🎶"),
(100,103,"the killer of Indra.",["killer"],"⚡"),
(104,109,"But he said IN-drashatru,",["in-drashatru,"],"😬"),
(110,113,"the one Indra kills.",["kills."],"🙃"),
(114,119,"I sound a bit funny.",["funny."],"😅"),
(120,125,"If you know the real pronunciation,",["pronunciation,"],"🤓"),
(126,130,"tell me in the comments.",["comments."],"💬"),
(131,136,"So Vritra rose from the fire.",["vritra"],"🔥🐉"),
(137,144,"The demon born to die by Indra's hand.",["indra's","hand."],"⚡"),
(145,149,"So on the practice mat,",["mat,"],"🧘"),
(150,154,"we have the same thunderbolt.",["thunderbolt."],"⚡"),
(155,156,"Supta Vajrasana.",["supta","vajrasana."],"🪷"),
(157,162,"Legs in lotus, hold your feet.",["lotus,"],"🦶"),
(163,165,"You lean back,",["back,"],"↩️"),
(166,171,"touch the head on the floor.",["floor."],"🙃"),
(172,175,"Then you come up.",["up."],"⬆️"),
(176,181,"If you pull with your abs,",["abs,"],"💪"),
(182,187,"your back will push your arms.",["push"],"😣"),
(188,194,"Then your hands slide off your feet.",["slide","off"],"🫳"),
(195,202,"So you try to grab your friend's hand.",["grab"],"🤝"),
(203,208,"Then you squeeze your abs again",["squeeze"],"😤"),
(209,212,"and pull even harder.",["harder."],"🥵"),
(213,215,"It's not success.",["not"],"❌"),
(216,221,"Like Tvashtr chanting louder and louder.",["louder"],"📢"),
(222,227,"Louder doesn't fix the wrong place.",["wrong","place."],"🔇"),
(228,234,"Your hands cannot reach the feet anyway.",["cannot"],"😩"),
(235,241,"Some people don't get it for years.",["years."],"⏳"),
(242,246,"So they start to think,",["think,"],"🤔"),
(247,251,"\"Oh, my arms are so short.\"",["short.\""],"😭"),
(252,256,"But it's the wrong focus.",["focus."],"🎯"),
(257,260,"It isn't strength.",["strength."],"🙅"),
(261,264,"It's not flexibility.",["flexibility."],"🤸"),
(265,269,"It's where you lift from.",["lift","from."],"📍"),
(270,275,"Not the abs, not the hands.",["not"],"🚫"),
(276,279,"You lift the chest,",["chest,"],"🫁"),
(280,285,"you hold the bandha, then breathe,",["bandha,","breathe,"],"🌬️"),
(286,292,"then you come up in one piece.",["one","piece."],"✨"),
(293,296,"Don't use your abs.",["don't"],"🙅"),
(297,303,"So wrong place, you get a demon.",["demon."],"👹"),
(304,310,"The right place, you get a thunderbolt.",["thunderbolt."],"⚡"),
(311,312,"Supta Vajrasana.",["supta","vajrasana."],"🪷"),
(313,316,"Tvashtr got one chance.",["one","chance."],"☝️"),
(317,322,"We get every chance, every morning.",["every","morning."],"🌅")]
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
TOTAL=sum(b-a for a,b in keep)+e['tail']
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
