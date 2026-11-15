import numpy as np, wave, sys
SR=44100
def env(n,a=0.005,r=0.1):
    t=np.arange(n)/SR; e=np.ones(n); na=int(a*SR); nr=int(r*SR)
    if na: e[:na]=np.linspace(0,1,na)
    if nr: e[-nr:]*=np.linspace(1,0,nr)
    return e
def save(name,x):
    x=x/ (np.abs(x).max()+1e-9)*0.7
    w=wave.open(OUT+'/'+name+'.wav','w'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((x*32767).astype(np.int16).tobytes()); w.close()
def sweep(f0,f1,dur,wave_='sine'):
    n=int(dur*SR); f=np.geomspace(f0,f1,n); ph=2*np.pi*np.cumsum(f)/SR
    return np.sin(ph) if wave_=='sine' else (2*((ph/(2*np.pi))%1)-1)
def noise(dur): return np.random.default_rng(1).standard_normal(int(dur*SR))
def lp(x,a): 
    y=np.zeros_like(x); s=0.0
    for i,v in enumerate(x): s+=a*(v-s); y[i]=s
    return y
OUT=sys.argv[1]
save('pop', sweep(900,300,0.09)*env(int(0.09*SR),0.002,0.05))
t=np.arange(int(1.2*SR))/SR
save('ding', (np.sin(2*np.pi*1318*t)+0.5*np.sin(2*np.pi*2637*t)+0.3*np.sin(2*np.pi*1976*t))*np.exp(-t*3.5))
b=sweep(180,520,0.45)*np.sin(2*np.pi*14*np.arange(int(0.45*SR))/SR)**2; save('boing', b*env(len(b),0.005,0.15))
n=noise(0.5); save('whoosh', lp(n,0.08)*np.hanning(len(n)))
g=(np.sin(2*np.pi*196*t)+0.6*np.sin(2*np.pi*392.7*t)+0.4*np.sin(2*np.pi*589*t)+0.25*np.sin(2*np.pi*1010*t))*np.exp(-t*1.6)
save('gong', g)
p=sweep(400,120,0.18)*env(int(0.18*SR),0.002,0.08); save('plop',p)
s=lp(noise(0.7),0.2)*(0.5+0.5*np.sin(2*np.pi*9*np.arange(int(0.7*SR))/SR)); save('slurp', s*np.hanning(len(s)))
h=sweep(420,470,0.6,'saw')+0.5*sweep(840,940,0.6,'saw'); save('party_horn', lp(h,0.3)*env(len(h),0.02,0.1))
sp=lp(noise(0.6),0.35)*np.exp(-np.arange(int(0.6*SR))/SR*6); save('splash',sp)
c=sweep(120,420,0.5,'saw')*np.linspace(0.3,1,int(0.5*SR)); c2=sweep(420,140,0.5,'saw')*np.linspace(1,0,int(0.5*SR)); save('car_zoom', lp(np.concatenate([c,c2]),0.25))
# crude animal fallbacks
tt=np.arange(int(1.0*SR))/SR; f=380+260*np.clip(tt*4,0,1)-80*tt; ph=2*np.pi*np.cumsum(f*(1+0.03*np.sin(2*np.pi*7*tt)))/SR
el=(2*((ph/(2*np.pi))%1)-1)+0.4*np.sin(2*ph); save('elephant', lp(el,0.4)*env(len(el),0.03,0.3))
fr=np.zeros(int(0.5*SR)); 
for k in range(0,int(0.5*SR)-80,int(SR/38)): fr[k:k+80]+=np.hanning(80)
save('frog_or_toad', lp(fr,0.3)*np.concatenate([np.ones(int(0.25*SR)),np.zeros(int(0.05*SR)),np.ones(int(0.2*SR))]))
mo=sweep(130,105,1.1,'saw'); save('cow', lp(mo,0.08)*env(len(mo),0.08,0.3))
gr=lp(noise(0.9),0.05)*(0.6+0.4*np.sin(2*np.pi*22*np.arange(int(0.9*SR))/SR)); save('tiger', gr*env(len(gr),0.05,0.3))
rh=lp(noise(0.35),0.15); save('rhino', rh*env(len(rh),0.01,0.15))
print('ok')
