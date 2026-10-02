import numpy as np, wave, json, sys
SR=44100; FPS=30
HOOK_F=float(sys.argv[1]) if len(sys.argv)>1 else 1.15
ALL_F=float(sys.argv[2]) if len(sys.argv)>2 else 1.0
w=wave.open('audio44.wav'); src=np.frombuffer(w.readframes(w.getnframes()),np.int16).astype(np.float32).reshape(-1,2)/32768
DUR=len(src)/SR; W=json.load(open('words.json'))
x=src.mean(1); hop=int(0.01*SR); n=len(x)//hop
db=20*np.log10(np.sqrt((x[:n*hop].reshape(n,hop)**2).mean(1)+1e-12))
s=db<-55; sil=[]; i=0
while i<n:
    if s[i]:
        j=i
        while j<n and s[j]: j+=1
        if (j-i)*0.01>=0.2: sil.append((i*0.01,j*0.01))
        i=j
    else: i+=1
HOOK_END=W[32][1]
BEATS={W[32][1]:0.45, W[145][1]:0.9, W[323][1]:0.9, W[387][0]:0.5}   # after 'is' (cut-off), after 'take all the eggs', before 'the real answer', before 'you see'
def gap_for(a,b):
    if a<0.05: return 'lead'
    for t,g in BEATS.items():
        if a-0.35<=t<=b+0.05: return g
    d=b-a; return 0.35 if d>=0.55 else min(d,0.28)
cuts=[]
for a,b in sil:
    g=gap_for(a,b)
    if g=='lead': cuts.append((0.0,b-0.10)); continue
    if b>=DUR-0.05: continue
    if b-a>g+0.02: cuts.append((a+min(g/2,0.15),b-(g-min(g/2,0.15))))
q=lambda t: round(t*FPS)/FPS
cuts=[(q(a),q(b)) for a,b in cuts if q(b)>q(a)]
keep=[];cur=0.0
for a,b in cuts:
    if a>cur: keep.append((cur,a))
    cur=b
keep.append((cur,q(min(DUR-0.02,W[-1][1]+0.6))))
# speed: hook part faster
seg=[]
for a,b in keep:
    if b<=HOOK_END+0.2: seg.append((a,b,HOOK_F*ALL_F))
    elif a<HOOK_END+0.2<b: seg+= [(a,q(HOOK_END+0.2),HOOK_F*ALL_F),(q(HOOK_END+0.2),b,ALL_F)]
    else: seg.append((a,b,ALL_F))
seg=[(a,b,f) for a,b,f in seg if b-a>=1/FPS]
json.dump({'keep':seg},open('edit4.json','w'))
tot=sum((b-a)/f for a,b,f in seg)
hook=sum((b-a)/f for a,b,f in seg if b<=HOOK_END+0.21)
print('segments',len(seg),'total',round(tot,1),'s  hook',round(hook,1),'s  raw',round(DUR,1))
