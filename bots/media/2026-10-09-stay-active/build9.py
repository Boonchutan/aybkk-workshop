import json, os, shutil, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render_f as R
R.QF=('fonts/PatrickHand-Regular.ttf',None); R.QS=tuple(range(46,34,-2)); R.QLINES=7
R.PENS=((940,[70],0.0),(470,[50,560],0.06),(360,[40,680],0.22))
from slides_o9 import *
which=sys.argv[1]; LABEL,S={'1':B1,'2':B2,'3':B3,'4':B4,'5':B5}[which]
if os.path.exists(f'assign_{which}.json'):
    A=json.load(open(f'assign_{which}.json')); S=[(A['photos'][k],)+tuple(S[A['texts'][k]][1:]) for k in range(len(S))]
F=json.loads(sys.argv[2]) if len(sys.argv)>2 else (json.load(open(f'force_{which}.json')) if os.path.exists(f'force_{which}.json') else {})
R.FORCE.clear(); R.FORCE.update({k:tuple(v) for k,v in F.items()})
d=f'out/o9_{which}'; shutil.rmtree(d,ignore_errors=True); os.makedirs(d); js=[]
for i,(ph,who,q,m,x) in enumerate(S,1):
    sl=dict(who=who,quote=q,meaning=m,counter=f'{i:02d} / {len(S)}  ·  {LABEL}')
    if x.get('s'): sl['noquote']=1
    if x.get('pre'): sl.update(pre=x['pre'],pre_font=x.get('pf',TH),pre_size=x.get('ps',72))
    r=R.render_slide(ph,sl,f'{d}/{i:02d}_{ph}.jpg'); print(i,ph,r,'END',r[1]+r[3]); js.append(dict(photo=ph,who=who,quote=q,meaning=m,story=bool(x.get('s'))))
json.dump(js,open(f'{d}/slides.json','w'),ensure_ascii=False,indent=1)
from PIL import Image
fs=sorted(f for f in os.listdir(d) if f.endswith('.jpg'))
sh=Image.new('RGB',(5*432,2*540)); [sh.paste(Image.open(f'{d}/{f}').resize((432,540)),((j%5)*432,(j//5)*540)) for j,f in enumerate(fs)]; sh.save(f'o9_{which}_sheet.jpg',quality=88)
