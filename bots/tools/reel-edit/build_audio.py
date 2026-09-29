import numpy as np, json, wave
from scipy.signal import butter, sosfilt
SR=44100; FPS=30
def rd(p):
    w=wave.open(p); x=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(np.float32)/32768
    return x.reshape(-1,w.getnchannels())
src=rd('audio44.wav'); DUR=len(src)/SR
sil=json.load(open('silences.json'))
def gap_for(s,e):
    d=e-s
    if s<0.1: return None
    if s<=51.5<=e: return 1.2
    if s<=100.4<=e: return 0.9
    if 37.9<=s<=38.9 or 42.7<=s<=43.3: return 0.45
    if 123.7<=s<=124.0: return 0.5
    return 0.35 if d>=0.55 else min(d,0.28)
cuts=[]
for s,e in sil:
    g=gap_for(s,e)
    if g is None: cuts.append((0.0,s+ (e-s) -0.10)); continue
    if e-s>g+0.02: cuts.append((s+g/2,e-g/2))
q=lambda t: round(t*FPS)/FPS
cuts=[(q(a),q(b)) for a,b in cuts if q(b)>q(a)]
keep=[];cur=0.0
for a,b in cuts:
    if a>cur: keep.append((cur,a))
    cur=b
endt=q(DUR-0.02); keep.append((cur,endt))
def remap(t):
    acc=0.0
    for a,b in keep:
        if t<a: return acc
        if t<=b: return acc+(t-a)
        acc+=b-a
    return acc
# audio assembly with 8ms crossfade edges
fade=int(0.008*SR); parts=[]
for a,b in keep:
    seg=src[int(round(a*SR)):int(round(b*SR))].copy()
    ramp=np.linspace(0,1,fade)[:,None]
    seg[:fade]*=ramp; seg[-fade:]*=ramp[::-1]
    parts.append(seg)
voice=np.concatenate(parts)
TAIL=1.0
voice=np.concatenate([voice,np.zeros((int(TAIL*SR),2),np.float32)])
# --- SFX synthesis ---
rng=np.random.default_rng(7)
def env(n,att,dec):
    t=np.arange(n)/SR; e=np.minimum(1,t/max(att,1e-3))*np.exp(-np.maximum(0,t-att)/dec); return e
def lp(x,f,o=4): return sosfilt(butter(o,f,'low',fs=SR,output='sos'),x)
def hp(x,f,o=4): return sosfilt(butter(o,f,'high',fs=SR,output='sos'),x)
def bp(x,f1,f2,o=2): return sosfilt(butter(o,[f1,f2],'band',fs=SR,output='sos'),x)
def thunder_rumble():
    n=int(2.6*SR); x=lp(rng.standard_normal(n),160)*env(n,0.35,0.9); return x
def thunder_crack():
    n=int(2.2*SR); c=hp(rng.standard_normal(n),1500)*env(n,0.005,0.08)
    r=lp(rng.standard_normal(n),220)*env(n,0.05,0.8); return 0.6*c+r
def low_drum():
    n=int(0.9*SR); t=np.arange(n)/SR; f=50+40*np.exp(-t/0.05)
    return np.sin(2*np.pi*np.cumsum(f)/SR)*env(n,0.003,0.25)
def boom():
    n=int(1.8*SR); t=np.arange(n)/SR; f=38+30*np.exp(-t/0.1)
    return np.sin(2*np.pi*np.cumsum(f)/SR)*env(n,0.01,0.6)+0.5*lp(rng.standard_normal(n),120)*env(n,0.01,0.5)
def bell(f0=392):
    n=int(3.0*SR); t=np.arange(n)/SR; x=np.zeros(n)
    for r,a,d in [(1,1,1.6),(2.0,.5,1.1),(2.76,.35,.8),(5.4,.2,.4),(8.93,.08,.25)]:
        x+=a*np.sin(2*np.pi*f0*r*t)*np.exp(-t/d)
    return x*env(n,0.004,5)
def chime(): return bell(880)[:int(1.6*SR)]*np.linspace(1,0,int(1.6*SR))
def whoosh(rise=True,dur=0.9):
    n=int(dur*SR); x=rng.standard_normal(n); out=np.zeros(n); k=8; L=n//k
    for i in range(k):
        f=(300+i*350) if rise else (3000-i*330)
        seg=bp(x,max(80,f*0.7),min(f*1.4,18000))[i*L:(i+1)*L]; out[i*L:(i+1)*L]=seg
    e=np.sin(np.pi*np.arange(n)/n)**2; return lp(out,6000)*e
def fire():
    n=int(1.4*SR); x=lp(rng.standard_normal(n),900)*np.sin(np.pi*np.arange(n)/n)
    cr=np.zeros(n); idx=rng.integers(0,n-400,40)
    for i in idx: cr[i:i+200]+=hp(rng.standard_normal(200),2000)*np.exp(-np.arange(200)/40)
    return x+0.8*cr
def drop():
    n=int(0.45*SR); t=np.arange(n)/SR; f=600*np.exp(-t/0.18)+120
    return np.sin(2*np.pi*np.cumsum(f)/SR)*env(n,0.005,0.15)
LIB={'rumble':thunder_rumble,'crack':thunder_crack,'drum':low_drum,'boom':boom,'bell':bell,'chime':chime,
     'rise':lambda: whoosh(True),'fire':fire,'drop':drop}
EVENTS=[(1.86,'rumble','rain'),(7.18,'drum','mistake'),(15.30,'crack','thunderbolt'),(20.18,'chime','three heads'),
 (41.82,'bell','killer of Indra'),(46.12,'drum','the one Indra kills'),(54.28,'fire','fire'),(57.76,'boom','Indra hands'),
 (63.04,'crack','Supta Vajrasana'),(76.66,'drop','slide off your feet'),(89.12,'drum','wrong place'),(91.68,'drop','cannot reach'),
 (101.90,'bell','It isn\'t strength'),(109.84,'rise','lift the chest'),(113.18,'chime','one piece'),(117.68,'boom','demon'),
 (121.62,'crack','thunderbolt Supta Vajrasana'),(126.72,'bell','every morning')]
VOL=0.40
sfx=np.zeros_like(voice[:,0]); log=[]
for t0,kind,word in EVENTS:
    s=LIB[kind](); s=s/np.max(np.abs(s))*0.89*VOL
    st=int((remap(t0)+0.4)*SR); en=min(len(sfx),st+len(s)); sfx[st:en]+=s[:en-st]
    log.append((round(remap(t0)+0.4,2),kind,word))
mix=voice+sfx[:,None]
pk=np.max(np.abs(mix)); 
if pk>0.99: mix*=0.99/pk
w=wave.open('mixed.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
w.writeframes((np.clip(mix,-1,1)*32767).astype(np.int16).tobytes()); w.close()
json.dump({'keep':keep,'tail':TAIL,'sfx':log},open('edit.json','w'),indent=1)
tot=sum(b-a for a,b in keep)
print('segments',len(keep),'edited length',round(tot,2),'+tail',TAIL,'orig',round(DUR,2),'peak',round(float(pk),3))
for l in log: print(l)
