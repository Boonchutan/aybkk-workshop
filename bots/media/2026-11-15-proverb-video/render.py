import sys,json,os,subprocess,wave,numpy as np,imageio_ffmpeg
from PIL import Image,ImageDraw,ImageFont
D=sys.argv[1]; MODE=sys.argv[2] if len(sys.argv)>2 else 'full'
FF=imageio_ffmpeg.get_ffmpeg_exe(); W,H,FPS=1080,1920,30
T=json.load(open(D+'/timeline.json'))
SFX_OK=json.load(open(D+'/sfx_ok.json')) if os.path.exists(D+'/sfx_ok.json') else {}
FB=D+'/fonts/Mali-Bold.ttf'
def font(s): return ImageFont.truetype(FB,s)
YEL=(255,216,77); BLK=(20,16,16)
def text_img(txt,size,fill,stroke,sw,maxw=980,align='center',lh=1.18):
    f=font(size); words=txt.split(' '); lines=[]; cur=''
    for w_ in words:
        t2=(cur+' '+w_).strip()
        if f.getlength(t2)<=maxw or not cur: cur=t2
        else: lines.append(cur); cur=w_
    lines.append(cur)
    asc,desc=f.getmetrics(); lh_px=int(size*lh)
    wmax=int(max(f.getlength(l) for l in lines))+2*sw+20
    im=Image.new('RGBA',(wmax,lh_px*len(lines)+int(size*0.45)+2*sw),(0,0,0,0)); d=ImageDraw.Draw(im)
    for i,l in enumerate(lines):
        lw=f.getlength(l); x=(wmax-lw)/2 if align=='center' else sw+10
        d.text((x,sw+i*lh_px),l,font=f,fill=fill,stroke_width=sw,stroke_fill=stroke)
    return im.crop(im.getbbox())
def pill(txt,size,fg,bg,pad=(34,16),maxw=940):
    t=text_img(txt,size,fg,bg[:3],0,maxw)
    w,h=t.size; im=Image.new('RGBA',(w+2*pad[0],h+2*pad[1]),(0,0,0,0)); d=ImageDraw.Draw(im)
    d.rounded_rectangle([0,0,im.width-1,im.height-1],radius=min(40,im.height//2),fill=bg)
    im.alpha_composite(t,(pad[0],pad[1])); return im
STK={}
def stk(name,size):
    k=(name,size)
    if k not in STK:
        im=Image.open(f'{D}/stk512/{name}.png').convert('RGBA'); im=im.crop(im.getbbox())
        s=size/max(im.size); STK[k]=im.resize((max(1,int(im.width*s)),max(1,int(im.height*s))),Image.LANCZOS)
    return STK[k]
def ease(x): x=min(max(x,0),1); return 1-(1-x)**3
def popscale(dt,dur=0.32):
    if dt<0: return 0
    if dt>=dur: return 1.0
    x=dt/dur; return 1.18*np.sin(x*np.pi/2) if x<0.7 else 1.18-0.18*((x-0.7)/0.3)
# pre-render
TITLE_BIG=text_img(T['title'].replace('ต่อคำ','\nต่อคำ').replace('\n',' '),88,(255,255,255),BLK,8,maxw=900)
TITLE_SMALL=pill(T['title'],44,(255,255,255),(20,16,16,165))
for it in T['items']:
    it['_mom']=pill('แม่: '+it['mom'],52,(30,24,24),(255,255,255,238))
    it['_ans']=text_img(it['ans'],88,YEL,BLK,9)
    it['_real']=text_img('ของจริง: '+it['real'],44,(255,255,255),BLK,5,maxw=1000)
    if 'momok' in it: it['_momok']=pill(it['momok'][1].replace(' 😂',''),52,(30,24,24),(255,255,255,238))
def paste_c(fr,im,cx,cy,scale=1.0,alpha=1.0):
    if scale<=0.01 or alpha<=0.01: return
    if abs(scale-1)>0.01: im=im.resize((max(1,int(im.width*scale)),max(1,int(im.height*scale))),Image.LANCZOS)
    if alpha<1: a=im.getchannel('A').point(lambda v:int(v*alpha)); im=im.copy(); im.putalpha(a)
    fr.alpha_composite(im,(int(cx-im.width/2),int(cy-im.height/2)))
MAIN=(850,430); ROWY=205
def overlay(fr,t):
    # title
    if t<3.0:
        s=popscale(t-0.05); paste_c(fr,TITLE_BIG,W/2,210,s)
    else:
        a=ease((t-3.0)/0.25); paste_c(fr,TITLE_SMALL,W/2,92,1.0,a)
    for it in T['items']:
        if not (it['q']<=t<it['end']+0.25): continue
        fade=1.0 if t<it['end'] else max(0,1-(t-it['end'])/0.25)
        pass
    # stickers (global: may run past their item's end; the newest sticker owns the main spot)
    ALL=[]
    for k,it in enumerate(T['items']):
        for s in it['stk']: ALL.append((k,s,max(it['end'],s[1]+1.4)))
    act=[(k,s,h) for k,s,h in ALL if s[1]<=t<h+0.25]
    if act:
        kk=max(k for k,s,h in act if True) if False else None
        newest=max(act,key=lambda x:x[1][1]); kk=newest[0]
        grp=[x for x in act if x[0]==kk]
        for i,(k,s,h) in enumerate(grp):
            fade=1.0 if t<h else max(0,1-(t-h)/0.25)
            newer=[x for x in grp[i+1:]]
            if not newer:
                sc=popscale(t-s[1]); bob=6*np.sin((t-s[1])*4.0)
                paste_c(fr,stk(s[0],300),MAIN[0],MAIN[1]+bob,sc,fade)
            else:
                tm=ease((t-newer[0][1][1])/0.3); slot=i
                tx=1000-slot*125; ty=ROWY
                cx=MAIN[0]+(tx-MAIN[0])*tm; cy=MAIN[1]+(ty-MAIN[1])*tm; sz=1-(1-110/300)*tm
                paste_c(fr,stk(s[0],300),cx,cy,sz,fade)
    for it in T['items']:
        if not (it['q']<=t<it['end']+0.25): continue
        fade=1.0 if t<it['end'] else max(0,1-(t-it['end'])/0.25)
        # mom pill
        mp=it['_mom']
        if 'momok' in it and t>=it['momok'][0]: mp=it['_momok']
        up=ease((t-it['q'])/0.22); paste_c(fr,mp,W/2,1250+40*(1-up),1.0,up*fade)
        if t>=it['a']:
            paste_c(fr,it['_ans'],W/2,1250+mp.height/2+30+it['_ans'].height/2,popscale(t-it['a']),fade)
            rt=it['a']+0.9
            if t>=rt: paste_c(fr,it['_real'],W/2,1810,1.0,ease((t-rt)/0.25)*fade)
def frames():
    p=subprocess.Popen([FF,'-loglevel','error','-i',D+'/src/src.mp4','-vf',f'scale={W}:{H}:flags=lanczos','-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE)
    n=W*H*3
    while True:
        b=p.stdout.read(n)
        if len(b)<n: break
        yield Image.frombuffer('RGB',(W,H),b,'raw','RGB',0,1)
if MODE=='preview':
    ts=[float(x) for x in sys.argv[3].split(',')]; os.makedirs(D+'/prev',exist_ok=True)
    for t in ts:
        subprocess.run([FF,'-y','-loglevel','error','-ss',str(min(t,84.7)),'-i',D+'/src/src.mp4','-frames:v','1','-vf',f'scale={W}:{H}',D+'/prev/raw.png'],check=True)
        fr=Image.open(D+'/prev/raw.png').convert('RGBA'); overlay(fr,t); fr.convert('RGB').save(D+'/prev/t%05.1f.jpg'%t,quality=85)
    sys.exit()
# audio mix
subprocess.run([FF,'-y','-loglevel','error','-i',D+'/src/src.mp4','-vn','-ac','2','-ar','44100',D+'/orig.wav'],check=True)
w=wave.open(D+'/orig.wav'); a=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).reshape(-1,2).astype(np.float32)/32768; SR=44100
a=np.concatenate([a,np.zeros((int(T['freeze']*SR)+SR,2),np.float32)])
def rd(p):
    ww=wave.open(p); x=np.frombuffer(ww.readframes(ww.getnframes()),dtype=np.int16).astype(np.float32)/32768
    if ww.getnchannels()==2: x=x.reshape(-1,2).mean(1)
    if ww.getframerate()!=SR:
        n=int(len(x)*SR/ww.getframerate()); x=np.interp(np.linspace(0,len(x)-1,n),np.arange(len(x)),x)
    return x/(np.abs(x).max()+1e-9)
def arms(x):
    f=int(0.02*SR); r=np.sqrt(np.mean(x[:len(x)//f*f].reshape(-1,f)**2,1)); r=np.sort(r)[::-1]; return float(np.sqrt(np.mean(r[:max(1,len(r)//2)]**2)))
def load(key):
    syn=f'{D}/sfx_synth/{key}.wav'
    if not os.path.exists(syn): syn=f'{D}/sfx_synth/pop.wav'
    if SFX_OK.get(key) and os.path.exists(f'{D}/sfx/{key}.wav'):
        x=rd(f'{D}/sfx/{key}.wav'); ref=SYN_RMS.get(key) or arms(rd(syn))
        return x*min(ref/(arms(x)+1e-9),1.0)
    return rd(syn)
SYN_RMS=json.load(open(D+'/synth_rms.json')) if os.path.exists(D+'/synth_rms.json') else {}
GAIN={'pop':0.35,'ding':0.4,'gong':0.5}; G6=T.get('sfx_gain',1.0)
for it in T['items']:
    for s in it['stk']:
        x=load(s[2])*GAIN.get(s[2],0.55)*G6; i0=int((s[3] if len(s)>3 else s[1])*SR); i1=min(len(a),i0+len(x)); a[i0:i1]+=x[:i1-i0,None]
pk=np.abs(a).max();
if pk>0.98: a=a/pk*0.98
ww=wave.open(D+'/mix.wav','w'); ww.setnchannels(2); ww.setsampwidth(2); ww.setframerate(SR); ww.writeframes((a*32767).astype(np.int16).tobytes()); ww.close()
if MODE=='audio':
    subprocess.run([FF,'-y','-loglevel','error','-i',sys.argv[3],'-i',D+'/mix.wav','-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart',D+'/out.mp4'],check=True); print('audio remux done'); sys.exit()
enc=subprocess.Popen([FF,'-y','-loglevel','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-i',D+'/mix.wav','-c:v','libx264','-preset','medium','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart',D+'/out.mp4'],stdin=subprocess.PIPE)
last=None; i=0
for fr in frames():
    t=i/FPS; f2=fr.convert('RGBA'); overlay(f2,t); last=f2.convert('RGB'); enc.stdin.write(last.tobytes()); i+=1
    if i%300==0: print('frame',i,flush=True)
nf=int(T['freeze']*FPS)
for k in range(nf):
    t=i/FPS; f2=fr.convert('RGBA'); overlay(f2,t); enc.stdin.write(f2.convert('RGB').tobytes()); i+=1
enc.stdin.close(); enc.wait(); print('done',i,'frames')
