import numpy as np, wave, json
SR=44100; FPS=30
w=wave.open('audio44.wav'); src=np.frombuffer(w.readframes(w.getnframes()),np.int16).astype(np.float32).reshape(-1,2)/32768
DUR=len(src)/SR; W=json.load(open('words.json'))
x=src.mean(1); hop=int(0.01*SR); n=len(x)//hop
db=20*np.log10(np.sqrt((x[:n*hop].reshape(n,hop)**2).mean(1)+1e-12))
s=db<-35; sil=[]; i=0
while i<n:
    if s[i]:
        j=i
        while j<n and s[j]: j+=1
        if (j-i)*0.01>=0.2: sil.append((i*0.01,j*0.01))
        i=j
    else: i+=1
PASSED=W[284][1]   # "...he passed away."
def gap_for(a,b):
    if a<0.05: return 'lead'
    if a-0.3<=PASSED<=b+0.05: return 2.0     # silence for him
    d=b-a; return 0.35 if d>=0.55 else min(d,0.28)
cuts=[]
for a,b in sil:
    g=gap_for(a,b)
    if g=='lead': cuts.append((0.0,b-0.10)); continue
    if b>=DUR-0.05: continue
    if b-a>g+0.02: cuts.append((a+g/2,b-g/2)) if g<1 else cuts.append((a+0.25,b-(g-0.25)))
q=lambda t: round(t*FPS)/FPS
cuts=[(q(a),q(b)) for a,b in cuts if q(b)>q(a)]
keep=[];cur=0.0
for a,b in cuts:
    if a>cur: keep.append((cur,a))
    cur=b
last=W[-1][1]; keep.append((cur,q(min(DUR-0.02,last+0.6))))
# stretch the silence after 'passed away' to 2.0 s (words untouched)
sa,sb=q(PASSED+0.06),q(W[285][0]-0.10); want=2.0-(W[285][0]-PASSED-(sb-sa))
k2=[]
for a,b in keep:
    if a<sa and sb<b: k2+= [(a,sa,1.0),(sa,sb,round(want/(sb-sa),4)),(sb,b,1.0)]
    else: k2.append((a,b,1.0))
keep=k2
TAIL=0.8
fade=int(0.008*SR); parts=[]
for a,b,f in keep:
    seg=src[int(round(a*SR)):int(round(b*SR))].copy()
    if f!=1.0:
        m=int(len(seg)*f); idx=np.linspace(0,len(seg)-1,m); seg=np.stack([np.interp(idx,np.arange(len(seg)),seg[:,c]) for c in (0,1)],1).astype(np.float32)
    ramp=np.linspace(0,1,fade)[:,None]
    seg[:fade]*=ramp; seg[-fade:]*=ramp[::-1]; parts.append(seg)
voice=np.concatenate(parts+[np.zeros((int(TAIL*SR),2),np.float32)])
wv=wave.open('voice.wav','wb'); wv.setnchannels(2); wv.setsampwidth(2); wv.setframerate(SR)
wv.writeframes((np.clip(voice,-1,1)*32767).astype(np.int16).tobytes()); wv.close()
json.dump({'keep':keep,'tail':TAIL},open('edit.json','w'))
tot=sum((b-a)*f for a,b,f in keep)
print('silences',len(sil),'segments',len(keep),'edited',round(tot,2),'+tail',TAIL,'from',round(DUR,2),'passed at',PASSED)
