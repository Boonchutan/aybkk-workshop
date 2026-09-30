import json, os, shutil
import render as R
P={d['photo']:d for d in json.load(open('phil.json'))}
Hs={d['photo']:d for d in json.load(open('hist.json'))}
Hs['009']=dict(photo='009',who='Booker T. Washington · Up from Slavery, 1901',
  quote='I have learned that success is to be measured not so much by the position that one has reached in life as by the obstacles which he has overcome while trying to succeed.',
  meaning='Born a slave, he went 500 miles to find a school. In 1881 he opened his own school.')
json.dump(list(Hs.values()),open('hist.json','w'),ensure_ascii=False,indent=1)
ALL={**P,**Hs}
A=['009','146','158','159','145','096','073','057','119','069']
B=['063','112','160','033','126','103','162','029','031','060']
C=['121','147','142','085']
R.FORCE.update({'147':(940,70,15),'009':(940,70,20,48),'119':(520,40,20),'073':(940,70,15),'112':(310,30,440),'142':(520,40,20),'031':(860,180,30),'126':(940,70,10),'162':(425,615,30)})
for name,order in (('postA',A),('postB',B),('postC',C)):
    d=f'out/{name}'; shutil.rmtree(d,ignore_errors=True); os.makedirs(d)
    js=[]
    for i,n in enumerate(order,1):
        sl=dict(ALL[n]); sl['counter']=f'{i:02d} / {len(order)}  ·  FROM WEAK TO STRONG'
        r=R.render_slide(n,sl,f'{d}/{i:02d}_{n}.jpg'); print(name,i,n,r, 'END', r[1]+r[3]); js.append(ALL[n])
    json.dump(js,open(f'{d}/slides.json','w'),ensure_ascii=False,indent=1)
