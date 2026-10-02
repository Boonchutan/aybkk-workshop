import numpy as np, json, wave
from scipy.signal import butter, sosfilt
from common import words, TAIL
SR=44100
def rdw(p):
    w=wave.open(p); x=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(np.float32)/32768
    return x.reshape(-1,w.getnchannels()).mean(1) if w.getnchannels()>1 else x
w=wave.open('voicecut.wav'); voice=np.frombuffer(w.readframes(w.getnframes()),np.int16).astype(np.float32).reshape(-1,2)/32768
voice=np.concatenate([voice,np.zeros((int(TAIL*SR),2),np.float32)])
HF={n:rdw(f'hf/{n}.wav') for n in ['pop','whoosh','whoosh-short','sparkle','chime','ping','impact-bass-1','impact-bass-2','error','click-soft']}
rng=np.random.default_rng(7)
def env(n,att,dec):
    t=np.arange(n)/SR; return np.minimum(1,t/max(att,1e-3))*np.exp(-np.maximum(0,t-att)/dec)
def lp(x,f,o=4): return sosfilt(butter(o,f,'low',fs=SR,output='sos'),x)
HF['rumble']=(lp(rng.standard_normal(int(2.6*SR)),160)*env(int(2.6*SR),0.35,0.9)).astype(np.float32)
PUNCH=[(7,'impact-bass-1'),(19,'chime'),(31,'click-soft'),(37,'rumble'),(46,'whoosh-short'),(62,'pop'),(72,'pop'),
 (96,'ping'),(100,'impact-bass-1'),(127,'error'),(146,'whoosh'),(152,'impact-bass-2'),(166,'impact-bass-1'),(180,'whoosh-short'),
 (200,'whoosh'),(214,'chime'),(230,'impact-bass-2'),(236,'sparkle'),(252,'sparkle'),(259,'pop'),(277,'error'),(300,'error'),
 (333,'impact-bass-1'),(340,'ping'),(349,'pop'),(384,'chime'),(401,'sparkle'),(421,'chime')]
sfx=np.zeros(len(voice),np.float32); punches=[]; log=[]
for i,snd in PUNCH:
    s=HF[snd]; s=s/np.max(np.abs(s))*0.89*0.40
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
json.dump(P,open('punches.json','w')); print(len(P),'punches'); [print(l) for l in log]
