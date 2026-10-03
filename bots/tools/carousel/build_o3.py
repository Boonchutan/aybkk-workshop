import json, os, shutil, sys
import render_f as R
R.QF=('fonts/PatrickHand-Regular.ttf',None); R.QS=tuple(range(46,34,-2)); R.QLINES=7
R.PENS=((940,[70],0.0),(470,[50,560],0.06),(360,[40,680],0.22))
LABEL='SMALL STEPS'
S=[
('176',"Laozi · Tao Te Ching 64, tr. James Legge, 1891",
 "The tree which fills the arms grew from the tiniest sprout; ... the journey of a thousand li commenced with a single step.",
 "A huge tree began as a tiny sprout. A very long trip begins with one step. Every big thing starts small."),
('062',"Hesiod · Works and Days, tr. Hugh G. Evelyn-White, 1914",
 "...if you add only a little to a little and do this often, soon that little will become great.",
 "Put a little on a little, again and again, and it grows big. Hesiod was a Greek farmer-poet who lived about 2,700 years ago."),
('147',"John Wooden · Wooden on Leadership, 2005",
 "When you derive pleasure and pride in perfecting seemingly \"minor\" details... big things eventually start falling into place.",
 "This basketball coach won 10 US college titles. At his first team meeting, he showed his players how to put on their socks, so they would not get blisters."),
('155',"Xunzi · An Encouragement to Study, tr. Homer H. Dubs, 1928",
 "...unless a person adds steps and half-steps to each other, he cannot go a thousand li; unless little streams are gathered, rivers and seas cannot be formed.",
 "No long road without many small steps. No sea without many small streams. A li is about half a kilometre."),
('025',"The Buddha · Samyutta Nikaya 22.101, tr. Bhikkhu Sujato",
 "They don't know how much of the handle was worn away today, how much yesterday... They just know what has been worn away.",
 "A builder never sees his tool handle wear down in one day, but the marks of his fingers end up in the wood. Daily practice changes you the same way."),
('053',"Confucius · Analects IX, tr. James Legge",
 "Though but one basketful is thrown at a time, the advancing with it is my own going forward.",
 "Build a hill one basket of earth at a time. Each basket moves you forward, and if you stop, only you stopped you."),
('186',"Ninomiya Sontoku · in R. C. Armstrong, Just Before the Dawn, 1912",
 "Great things are the result of an accumulation of little things. ... When you cultivate many acres of land, you do so spadeful by spadeful.",
 "A big field is dug one spadeful at a time. As a poor orphan boy in Japan, Ninomiya planted rice seedlings that farmers had thrown away, and grew his first bag of rice."),
('104',"Pliny the Elder on the painter Apelles · Natural History 35.84, 1855 translation",
 "...never to let any day pass, however busy he might be, without exercising himself by tracing some outline or other...",
 "Apelles, the most famous painter of ancient Greece, drew at least one line every day, even on busy days. The saying 'no day without a line' comes from him."),
('070',"Anthony Trollope · An Autobiography, 1883",
 "A small daily task, if it be really daily, will beat the labours of a spasmodic Hercules. It is the tortoise which always catches the hare.",
 "A small job done every day beats a huge effort done now and then. For years, Trollope wrote every morning from 5:30, before breakfast."),
('161',"The Buddha · Dhammapada 239, tr. E. W. Burlingame, 1921",
 "One after another, little by little, time after time, a wise man should blow away his own impurities, even as a smith blows away the impurities of silver.",
 "A silversmith cleans silver a tiny bit at a time, until it shines. A wise person cleans their own habits the same way."),
]
F=json.loads(sys.argv[1]) if len(sys.argv)>1 else {}
R.FORCE.clear(); R.FORCE.update(F)
d='out/o3'; shutil.rmtree(d,ignore_errors=True); os.makedirs(d); js=[]
for i,(ph,who,q,m) in enumerate(S,1):
    sl=dict(who=who,quote=q,meaning=m,counter=f'{i:02d} / 10  ·  {LABEL}')
    r=R.render_slide(ph,sl,f'{d}/{i:02d}_{ph}.jpg'); print(i,ph,r,'END',r[1]+r[3]); js.append(dict(photo=ph,who=who,quote=q,meaning=m))
json.dump(js,open(f'{d}/slides.json','w'),ensure_ascii=False,indent=1)
from PIL import Image
fs=sorted(f for f in os.listdir(d) if f.endswith('.jpg'))
sh=Image.new('RGB',(5*432,2*540)); [sh.paste(Image.open(f'{d}/{f}').resize((432,540)),((j%5)*432,(j//5)*540)) for j,f in enumerate(fs)]; sh.save('o3_sheet.jpg',quality=88)
