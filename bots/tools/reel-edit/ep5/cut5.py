import numpy as np, wave, json
SR=44100; FPS=30; ALL_F=1.1
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
BEATS={W[95][1]:0.9, W[150][1]:0.6, W[179][0]:0.6, W[16][1]:0.4}
FORCED=[(W[131][1]+0.15, 63.92)]   # drop the restart 'Surasa bless her.'
def gap_for(a,b):
    if a<0.05: return 'lead'
    for t,g in BEATS.items():
        if a-0.35<=t<=b+0.05: return g
    d=b-a; return 0.35 if d>=0.55 else min(d,0.28)
cuts=[]
for a,b in sil:
    if any(fa-0.05<=a and b<=fb+0.05 for fa,fb in FORCED): continue
    g=gap_for(a,b)
    if g=='lead': cuts.append((0.0,b-0.10)); continue
    if b>=DUR-0.05: continue
    if b-a>g+0.02: cuts.append((a+min(g/2,0.15),b-(g-min(g/2,0.15))))
cuts+=FORCED
q=lambda t: round(t*FPS)/FPS
cuts=sorted((q(a),q(b)) for a,b in cuts if q(b)>q(a))
m=[]
for a,b in cuts:
    if m and a<=m[-1][1]: m[-1]=(m[-1][0],max(m[-1][1],b))
    else: m.append((a,b))
keep=[];cur=0.0
for a,b in m:
    if a>cur: keep.append((cur,a))
    cur=max(cur,b)
keep.append((cur,q(min(DUR-0.02,W[-1][1]+0.7))))
seg=[(a,b,ALL_F) for a,b in keep if b-a>=1/FPS]
json.dump({'keep':seg},open('edit5.json','w'))
print('segments',len(seg),'total',round(sum((b-a)/f for a,b,f in seg),1),'raw',round(DUR,1))
# ffmpeg filter
L=[]
for k,(a,b,f) in enumerate(seg):
    d=b-a
    L.append(f"[0:v]trim=start={a:.4f}:end={b:.4f},setpts=(PTS-STARTPTS)/{f}[v{k}]")
    L.append(f"[1:a]atrim=start={a:.4f}:end={b:.4f},asetpts=PTS-STARTPTS,afade=t=in:d=0.008,afade=t=out:st={max(0,d-0.008):.4f}:d=0.008,atempo={f}[a{k}]")
L.append(''.join(f'[v{k}][a{k}]' for k in range(len(seg)))+f'concat=n={len(seg)}:v=1:a=1[v][a]')
open('fc_cut.txt','w').write(';\n'.join(L))
