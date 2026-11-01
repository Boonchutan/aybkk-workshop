import numpy as np, json, wave
from scipy.signal import butter, sosfilt
from common import words, TAIL
SR=44100
rng=np.random.default_rng(7)
def env(n,att,dec):
    t=np.arange(n)/SR; return np.minimum(1,t/max(att,1e-3))*np.exp(-np.maximum(0,t-att)/dec)
def lp(x,f,o=4): return sosfilt(butter(o,f,'low',fs=SR,output='sos'),x)
def bp(x,a,b,o=2): return sosfilt(butter(o,[a,b],'band',fs=SR,output='sos'),x)
def tone(f,d,att=0.005,dec=0.3,harm=(1,)):
    n=int(d*SR); t=np.arange(n)/SR; x=sum(np.sin(2*np.pi*f*h*t)/(i+1) for i,h in enumerate(harm)); return x*env(n,att,dec)
def sweep(f0,f1,d):
    n=int(d*SR); t=np.arange(n)/SR; f=f0*(f1/f0)**(t/d); return np.sin(2*np.pi*np.cumsum(f)/SR)
HF={}
HF['pop']=sweep(900,300,0.09)*env(int(0.09*SR),0.002,0.03)
HF['click-soft']=lp(rng.standard_normal(int(0.04*SR)),3000)*env(int(0.04*SR),0.001,0.008)
HF['whoosh']=bp(rng.standard_normal(int(0.7*SR)),400,3000)*np.hanning(int(0.7*SR))
HF['whoosh-short']=bp(rng.standard_normal(int(0.35*SR)),600,4000)*np.hanning(int(0.35*SR))
HF['ping']=tone(1760,0.6,dec=0.18,harm=(1,2.01))
HF['chime']=sum(np.pad(tone(f,1.0,dec=0.35,harm=(1,2.76)),(int(k*0.06*SR),0))[:int(1.0*SR)] for k,f in enumerate((1318,1568,2093)))
sp=np.zeros(int(0.9*SR))
for k in range(9):
    st=int(k*0.07*SR); s=tone(2000+rng.uniform(0,2500),0.25,dec=0.06); sp[st:st+len(s)]+=s[:len(sp)-st]
HF['sparkle']=sp
HF['impact-bass-1']=sweep(110,45,0.6)*env(int(0.6*SR),0.003,0.18)+0.3*lp(rng.standard_normal(int(0.6*SR)),400)*env(int(0.6*SR),0.001,0.05)
HF['impact-bass-2']=sweep(80,35,0.8)*env(int(0.8*SR),0.003,0.28)+0.4*lp(rng.standard_normal(int(0.8*SR)),300)*env(int(0.8*SR),0.001,0.08)
e1=tone(220,0.18,dec=0.08,harm=(1,1.5,2)); e2=tone(185,0.25,dec=0.1,harm=(1,1.5,2))
HF['error']=np.concatenate([e1,e2])
HF={k:v.astype(np.float32) for k,v in HF.items()}
w=wave.open('voice_norm.wav'); voice=np.frombuffer(w.readframes(w.getnframes()),np.int16).astype(np.float32).reshape(-1,2)/32768
voice=np.concatenate([voice,np.zeros((int(TAIL*SR),2),np.float32)])
PUNCH=[(4,'impact-bass-1'),(13,'error'),(17,'click-soft'),(21,'chime'),(26,'ping'),(34,'whoosh'),(46,'impact-bass-2'),
 (64,'pop'),(69,'pop'),(74,'pop'),(78,'pop'),(83,'pop'),(89,'pop'),(93,'pop'),(95,'error'),(100,'ping'),(109,'sparkle'),
 (118,'whoosh-short'),(131,'chime'),(147,'sparkle'),(157,'impact-bass-1'),(162,'error'),(165,'ping'),(169,'click-soft'),(174,'chime'),(177,'sparkle')]
REF=float(np.percentile(np.abs(voice).max(1),99.9))   # Boonchu 1 Nov: effects at 40% of his voice level, tones a bit softer
TONAL={'ping','chime','sparkle'}
sfx=np.zeros(len(voice),np.float32); punches=[]; log=[]
for i,snd in PUNCH:
    s=HF[snd]; s=s/np.max(np.abs(s))*REF*0.40*(0.7 if snd in TONAL else 1.0)
    ws,we=words[i][0],words[i][1]
    st=int((we+0.4)*SR); en=min(len(sfx),st+len(s)); sfx[st:en]+=s[:en-st]
    punches.append([round(ws,3),round(max(we+0.5,ws+0.9),3)]); log.append((round(we+0.4,2),snd,words[i][2]))
mix=voice+sfx[:,None]; pk=np.max(np.abs(mix))
if pk>0.99: mix*=0.99/pk
o=wave.open('mixed.wav','wb'); o.setnchannels(2); o.setsampwidth(2); o.setframerate(SR)
o.writeframes((np.clip(mix,-1,1)*32767).astype(np.int16).tobytes()); o.close()
P=[]
for a,b in sorted(punches):
    if P and a<=P[-1][1]+0.2: P[-1][1]=max(P[-1][1],b)
    else: P.append([a,b])
json.dump(P,open('punches.json','w')); print(len(P),'punches')
