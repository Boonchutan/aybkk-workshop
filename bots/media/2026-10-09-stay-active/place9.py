# Find text boxes that never touch a face, hand or foot (zones.json), then match texts to photos.
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from scipy.optimize import linear_sum_assignment
import render_f as R
R.QF=('fonts/PatrickHand-Regular.ttf',None); R.QS=tuple(range(46,34,-2)); R.QLINES=7
from slides_o9 import *
b=sys.argv[1]; LABEL,S={'1':B1,'2':B2,'3':B3,'4':B4,'5':B5}[b]
photos=json.load(open('order.json'))[b]
Z=json.load(open('zones.json')); EXTRA=json.load(open('extra_zones.json')) if os.path.exists('extra_zones.json') else {}
WIDTHS=list(range(940,249,-10))
def slide(t,i):
    ph,who,q,m,x=t; sl=dict(who=who,quote=q,meaning=m,counter=f'{i:02d} / {len(S)}  ·  {LABEL}')
    if x.get('s'): sl['noquote']=1
    if x.get('pre'): sl.update(pre=x['pre'],pre_font=x.get('pf',TH),pre_size=x.get('ps',72))
    return sl
def integ(a): return np.pad(a.cumsum(0).cumsum(1),((1,0),(1,0)))
def rsum(I,x0,y0,x1,y1): return I[y1,x1]-I[y0,x1]-I[y1,x0]+I[y0,x0]
cache={}
def prep(p):
    if p not in cache:
        wm=R.weighted_mask(p); fb=np.zeros((1350,1080),np.float32)
        sb=np.zeros((1350,1080),np.float32)
        WMZ=[dict(who='main',kind='wm',x0=345,y0=1175,x1=735,y1=1350)]
        for z in Z.get(p,[])+EXTRA.get(p,[])+WMZ:
            m=8 if z['who']=='main' else 4
            hard=z['who']=='main' or z['kind']=='face'
            (fb if hard else sb)[max(0,int(z['y0'])-m):int(z['y1'])+m, max(0,int(z['x0'])-m):int(z['x1'])+m]=1
        cache[p]=(integ(wm),integ(fb),integ(sb))
    return cache[p]
def best(p,sl):
    Iw,If,Is=prep(p); out=None
    for w in WIDTHS:
      for qm in (46,42,38):
        L=R.layout(sl,w,qm); h=L['h']+12
        for x0 in range(20,1061-w,5):
            ys=np.arange(15,1335-h,5)
            if not len(ys): continue
            rx0,rx1=x0-14,x0+w+14; ry0=ys; ry1=ys+h
            coll=If[ry1,rx1]-If[ry0,rx1]-If[ry1,rx0]+If[ry0,rx0]
            body=(Iw[ry1,rx1]-Iw[ry0,rx1]-Iw[ry1,rx0]+Iw[ry0,rx0])/((rx1-rx0)*h)
            soft=(Is[ry1,rx1]-Is[ry0,rx1]-Is[ry1,rx0]+Is[ry0,rx0])>0
            sc=body+0.3*(940-w)/640+0.02*ys/1350+1.5*soft+0.12*(46-qm)/8
            sc[coll>0]=np.inf; k=int(np.argmin(sc))
            if np.isfinite(sc[k]) and (out is None or sc[k]<out[0]): out=(float(sc[k]),w,x0,int(ys[k]),h,qm)
    return out
n=len(S); C=np.full((n,n),1e6); P={}
for i,t in enumerate(S):
    sl=slide(t,i+1)
    for j,p in enumerate(photos):
        if (i==0)!=(j==0): continue
        r=best(p,sl)
        if r: C[i,j]=r[0]; P[i,j]=r
ri,ci=linear_sum_assignment(C)
pairs=sorted(zip(ri,ci)); bad=[(S[i][1][:40],photos[j]) for i,j in pairs if C[i,j]>=1e6]
print('infeasible:',bad)
A={'texts':[int(i) for i,_ in pairs],'photos':[photos[j] for _,j in pairs]}
F={photos[j]:[P[i,j][1],P[i,j][2],P[i,j][3],P[i,j][5]] for i,j in pairs if (i,j) in P}
json.dump(A,open(f'assign_{b}.json','w')); json.dump(F,open(f'force_{b}.json','w'))
for i,j in pairs: print(i+1,photos[j],S[i][1][:45],P.get((i,j)))
print('feasible per text:',[int((C[i]<1e6).sum()) for i in range(n)])
