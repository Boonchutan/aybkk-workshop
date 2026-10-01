import json, os, shutil, sys
import render as R
from breath_slides import POSTS
PH={'A':['042','015','070','020','048','028','044','085','057'],
    'B':['083','005','075','047','082','037','024','080','059'],
    'C':['014','041','008','054','073','016','067','078','040','007']}
POSTS={'A':[x for i,x in enumerate(POSTS['A']) if i!=2],'B':[x for i,x in enumerate(POSTS['B']) if i!=7],'C':POSTS['C']}
LBL={'A':'STRONG HEART, STRONG LUNGS','B':'CALM MIND, GOOD SLEEP','C':'EVERY BODY, EVERY AGE'}
F=json.loads(sys.argv[1]) if len(sys.argv)>1 else {}
R.FORCE.update(F)
for k in sys.argv[2:] or ['A','B']:
    d=f'out/breath{k}'; shutil.rmtree(d,ignore_errors=True); os.makedirs(d)
    for i,(n,s) in enumerate(zip(PH[k],POSTS[k]),1):
        sl=dict(s); sl['counter']=f'{i:02d} / {len(PH[k])}  ·  {LBL[k]}'
        r=R.render_slide(n,sl,f'{d}/{i:02d}_{n}.jpg'); print(k,i,n,r,'END',r[1]+r[3])
    json.dump([dict(photo=n,**s) for n,s in zip(PH[k],POSTS[k])],open(f'{d}/slides.json','w'),ensure_ascii=False,indent=1)
    from PIL import Image
    fs=sorted(f for f in os.listdir(d) if f.endswith('.jpg'))
    sh=Image.new('RGB',(5*432,2*540)); [sh.paste(Image.open(f'{d}/{f}').resize((432,540)),((j%5)*432,(j//5)*540)) for j,f in enumerate(fs)]; sh.save(f'breath{k}_sheet.jpg',quality=88)
