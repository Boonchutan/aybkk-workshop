import numpy as np, json, wave
from common import remap, words
import build_audio as BA   # re-uses voice assembly + synth lib (runs once, writes mixed.wav; we overwrite below)
SR=44100
def rdw(p):
    w=wave.open(p); x=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(np.float32)/32768; return x
HF={n:rdw(f'hf/{n}.wav') for n in ['pop','whoosh','sparkle','chime','ping','impact-bass-1','impact-bass-2','error','click-soft']}
SYN={'rumble':BA.thunder_rumble,'crack':BA.thunder_crack}
# (word idx, sound) -> punch on that word, sound 0.4 s after word end
PUNCH=[(5,'rumble'),(21,'impact-bass-1'),(39,'crack'),(49,'pop'),(70,'ping'),(80,'whoosh'),(103,'impact-bass-1'),
 (109,'error'),(119,'pop'),(136,'impact-bass-2'),(144,'crack'),(156,'sparkle'),(194,'whoosh'),(212,'impact-bass-1'),
 (221,'ping'),(227,'error'),(251,'pop'),(260,'whoosh'),(279,'sparkle'),(292,'chime'),(303,'impact-bass-1'),(310,'crack'),(322,'chime')]
voice=BA.voice
sfx=np.zeros(len(voice),np.float32); log=[]; punches=[]
for i,snd in PUNCH:
    s=HF[snd] if snd in HF else SYN[snd]()
    s=s/np.max(np.abs(s))*0.89*0.40
    ws,we=remap(words[i][0]),remap(words[i][1])
    st=int((we+0.4)*SR); en=min(len(sfx),st+len(s)); sfx[st:en]+=s[:en-st]
    punches.append([round(ws,3),round(max(we+0.5,ws+0.9),3)]); log.append((round(we+0.4,2),snd,words[i][2]))
mix=voice+sfx[:,None]; pk=np.max(np.abs(mix))
if pk>0.99: mix*=0.99/pk
w=wave.open('mixed2.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
w.writeframes((np.clip(mix,-1,1)*32767).astype(np.int16).tobytes()); w.close()
# merge overlapping punches
P=[]
for a,b in sorted(punches):
    if P and a<=P[-1][1]+0.2: P[-1][1]=max(P[-1][1],b)
    else: P.append([a,b])
json.dump(P,open('punches2.json','w')); print(len(P),'punches'); [print(l) for l in log]
