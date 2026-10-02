import json, os, shutil, sys, re
import render_f as R
R.QF=('fonts/PatrickHand-Regular.ttf',None); R.QS=tuple(range(46,34,-2)); R.QLINES=7
R.PENS=((940,[70],0.0),(470,[50,560],0.06),(360,[40,680],0.22))
SETS={s['sub']:s['slides'] for s in json.load(open('batch2to5.json'))['pick']['sets']}
PLAN=[('b2','again','DO IT AGAIN',['047','012','004','019','005','033','025','030','017','086']),
      ('b3','mistakes','MISTAKES TEACH',['046','052','034','043','048','050','051','054','053','088']),
      ('b4','pieces','PIECES COME TOGETHER',['016','056','059','058','106','062','064','092','067','063']),
      ('b5','body','THE BODY KNOWS',['101','103','003','072','078','080','082','095','105','107'])]
F=json.loads(sys.argv[1]) if len(sys.argv)>1 else {}
only=sys.argv[2:] or [p[0] for p in PLAN]
def shortwho(w):
    w=re.sub(r'\s*\([^)]*\)','',w).replace('  ',' ').strip()
    return w
for key,sub,label,PH in PLAN:
    if key not in only: continue
    R.FORCE.clear(); R.FORCE.update(F.get(key,{}))
    d=f'out/{key}'; shutil.rmtree(d,ignore_errors=True); os.makedirs(d); js=[]
    for i,(x,ph) in enumerate(zip(SETS[sub],PH),1):
        s=dict(who=shortwho(x['who']),quote=x['quote'].replace('’',"'"),meaning=x['meaning'])
        sl=dict(s); sl['counter']=f'{i:02d} / 10  ·  {label}'
        r=R.render_slide(ph,sl,f'{d}/{i:02d}_{ph}.jpg'); print(key,i,ph,r,'END',r[1]+r[3]); js.append(dict(photo=ph,**s))
    json.dump(js,open(f'{d}/slides.json','w'),ensure_ascii=False,indent=1)
    from PIL import Image
    fs=sorted(f for f in os.listdir(d) if f.endswith('.jpg'))
    sh=Image.new('RGB',(5*432,2*540)); [sh.paste(Image.open(f'{d}/{f}').resize((432,540)),((j%5)*432,(j//5)*540)) for j,f in enumerate(fs)]; sh.save(f'{key}_sheet.jpg',quality=88)
