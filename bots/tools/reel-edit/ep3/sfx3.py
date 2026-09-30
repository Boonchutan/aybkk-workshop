import numpy as np, json, wave
from common import remap, words
SR=44100
def rdw(p):
    w=wave.open(p); x=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(np.float32)/32768
    return x.reshape(-1,w.getnchannels()).mean(1) if w.getnchannels()>1 else x
w=wave.open('voice.wav'); voice=np.frombuffer(w.readframes(w.getnframes()),np.int16).astype(np.float32).reshape(-1,2)/32768
HF={n:rdw(f'hf/{n}.wav') for n in ['pop','whoosh','sparkle','chime','ping','impact-bass-1','impact-bass-2','error','click-soft']}
PUNCH=[(2,'pop'),(19,'whoosh'),(38,'impact-bass-1'),(69,'error'),(103,'click-soft'),(110,'ping'),(124,'sparkle'),
 (139,'chime'),(143,'impact-bass-2'),(159,'error'),(172,'pop'),(188,'whoosh'),(213,'ping'),(223,'sparkle'),
 (241,'impact-bass-1'),(266,'impact-bass-2'),(302,'chime'),(316,'ping'),(344,'impact-bass-1'),(353,'sparkle'),(363,'chime')]
sfx=np.zeros(len(voice),np.float32); log=[]; punches=[]
for i,snd in PUNCH:
    s=HF[snd]; s=s/np.max(np.abs(s))*0.89*0.40
    ws,we=remap(words[i][0]),remap(words[i][1])
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
