# Usage: move.py <batch> '<json list of [slide_no, region]>'  region in tr, tl, br, bl
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
b=sys.argv[1]; REQ=json.loads(sys.argv[2])
sys.argv=['x',b]
exec(open('place9.py').read().split("n=len(S)")[0])
SOFTBG=set(os.environ.get('SOFTBG','').split(','))
for _p in SOFTBG:
    for _b in Z.get(_p,[]):
        if _b['who']=='background' and _b['kind']=='face': _b['kind']='softface'
A=json.load(open(f'assign_{b}.json'))
def bars(p):
    e=EXTRA.get(p,[]); return (e[0]['x1'] if e else 0, e[1]['x0'] if e else 1080)
def cond(region,p):
    L0,R0=bars(p)
    return {'tr':lambda x,y,w,h: x+w+14>=R0-60 and x>=430 and y<=40,
            'tl':lambda x,y,w,h: x-14<=L0+60 and y<=40,
            'br':lambda x,y,w,h: x+w+14>=R0-60 and y+h>=1150,
            'bl':lambda x,y,w,h: x-14<=L0+60 and x+w<=640 and y+h>=1100}[region]
def best_c(p,sl,c):
    Iw,If,Is=prep(p); out=None
    for w in WIDTHS:
      for qm in (46,42,38):
        L=R.layout(sl,w,qm); h=L['h']+12
        for x0 in range(20,1061-w,5):
            for y0 in range(15,1335-h,5):
                if not c(x0,y0,w,h): continue
                rx0,rx1=x0-14,x0+w+14; ry0,ry1=y0,y0+h
                if If[ry1,rx1]-If[ry0,rx1]-If[ry1,rx0]+If[ry0,rx0]>0: continue
                body=(Iw[ry1,rx1]-Iw[ry0,rx1]-Iw[ry1,rx0]+Iw[ry0,rx0])/((rx1-rx0)*h)
                soft=(Is[ry1,rx1]-Is[ry0,rx1]-Is[ry1,rx0]+Is[ry0,rx0])>0
                sc=body+0.3*(940-w)/640+1.5*soft+0.12*(46-qm)/8
                if out is None or sc<out[0]: out=(round(float(sc),3),w,x0,y0,h,qm)
    return out
F=json.load(open(f'force_{b}.json'))
for k,region in REQ:
    p=A['photos'][k-1]; t=S[A['texts'][k-1]]
    r=best_c(p,slide(t,k),cond(region,p))
    print(k,p,region,r)
    if r: F[p]=[r[1],r[2],r[3],r[5]]
json.dump(F,open(f'force_{b}.json','w'))
