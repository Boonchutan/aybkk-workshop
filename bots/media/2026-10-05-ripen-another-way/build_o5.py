import json, os, shutil, sys
import render_f as R
R.QF=('fonts/PatrickHand-Regular.ttf',None); R.QS=tuple(range(46,34,-2)); R.QLINES=7
R.PENS=((940,[70],0.0),(470,[50,560],0.06),(360,[40,680],0.22))
A=('ONE WAY. LET IT RIPEN',[
('036',"Japanese proverb · Ishi no ue ni mo sannen",
 "Three years, even on a stone.",
 "Stay long enough, and even a cold stone gets warm."),
('060',"Mencius · Mengzi 2A2, tr. James Legge, 1861",
 "There was a man of Sung, who was grieved that his growing corn was not longer, and so he pulled it up. ... 'I have been helping the corn to grow long.' His son ran to look at it, and found the corn all withered.",
 "He pulled his young plants up to help them grow faster. Soon they had all dried up."),
('013',"Confucius · Analects 13.17, tr. James Legge, 1861",
 "Do not be desirous to have things done quickly... Desire to have things done quickly prevents their being done thoroughly.",
 "If you want things done fast, they will not be done well."),
('023',"Kabir · couplet on patience, 15th century, tr. from Hindi",
 "Slowly, slowly, O mind; everything happens slowly. The gardener pours a hundred pots of water, but fruit comes when its season comes.",
 "A hundred pots of water won't bring the fruit early. It comes in its season."),
('058',"Seneca · Letters to Lucilius 2, tr. Richard M. Gummere, 1917",
 "Everywhere means nowhere... nothing hinders a cure so much as frequent change of medicine; no wound will heal when one salve is tried after another; a plant which is often moved can never grow strong.",
 "If you keep changing the method, nothing has time to work. A plant moved too often never grows strong."),
('004',"Laozi · Dao De Jing 15, tr. James Legge, 1891",
 "Who can (make) the muddy water (clear)? Let it be still, and it will gradually become clear. Who can secure the condition of rest? Let movement go on, and the condition of rest will gradually arise.",
 "Leave muddy water still, and it slowly clears. Keep moving gently, and calm slowly comes."),
('051',"Krishna · Bhagavad Gita 2.47, tr. K. T. Telang, 1882",
 "Your business is with action alone; not by any means with fruit. Let not the fruit of action be your motive (to action).",
 "Your job is the doing. Don't do it for the result. The result is not your business."),
('027',"Henri Poincaré · Science and Method, 1908, tr. G. B. Halsted, 1913",
 "Disgusted with my failure, I went to spend a few days at the seaside, and thought of something else. One morning, walking on the bluff, the idea came to me...",
 "He stopped forcing the problem and rested by the sea. Then the answer came by itself."),
('020',"Russian proverb · V. I. Dal's collection, 1862",
 "The slower you go, the farther you get.",
 "Slow and steady goes farther than a rush."),
('065',"Rainer Maria Rilke · Letters to a Young Poet, 1903, tr. M. D. Herter Norton, 1934",
 "...ripening like the tree which does not force its sap and stands confident in the storms of spring without the fear that after them may come no summer. It does come. But it comes only to the patient...",
 "Grow like a tree that does not rush. Summer will come, but only to people who wait."),
])
B=('FIND ANOTHER WAY',[
('009',"The Buddha · Majjhima Nikaya 36, tr. Bhikkhu Sujato, 2018",
 "But I have not achieved any superhuman distinction... by this severe, grueling work. Could there be another path to awakening?",
 "Pushing harder and harder did not work. So he asked: is there another way? He found a gentler one."),
('014',"Thomas Edison, as told by Walter S. Mallory · Dyer & Martin, 1910",
 "Results! Why, man, I have gotten a lot of results! I know several thousand things that won't work.",
 "Every failed test showed him one more way that does not work. No test was wasted."),
('019',"Confucius · Analects 11.21, tr. James Legge, 1893",
 "Ch'iu is retiring and slow; therefore, I urged him forward. Yu has more than his own share of energy; therefore, I kept him back.",
 "Same question, two answers. He pushed the shy student forward and held the eager one back."),
('049',"Nanyue Huairang to his student Mazu · tr. D. T. Suzuki, 1927",
 "It is like driving a cart; when it moveth not, wilt thou whip the cart or the ox?",
 "If the cart won't move, hitting the cart is useless. Find what really pulls it, and work there."),
('017',"Dick Fosbury · high jumper, Athletics Weekly, 2018",
 "All the time I was doing it by feel as there was no model to follow. I was creating it as I went.",
 "The usual jump did not work for him. He trusted his feel and made a new one."),
('048',"Orville & Wilbur Wright · The Century Magazine, 1908",
 "Having set out with absolute faith in the existing scientific data, we were driven to doubt one thing after another, till finally, after two years of experiment, we cast it all aside, and decided to rely entirely upon our own investigations.",
 "The old numbers kept failing them. So they tested everything themselves, and then they flew."),
('034',"Little Roadling (Culla-Panthaka) · Jataka No. 4, tr. T. W. Rhys Davids, 1880",
 "...in four months he could not get by heart even this one verse... gave him a piece of very white cloth... and said, 'Now, Little Roadling... rub this cloth up and down...'",
 "He could not learn one verse in four months. The Buddha gave him a cloth to rub instead. It worked."),
('010',"Epictetus · Enchiridion 43, tr. Thomas W. Higginson, 1865",
 "Everything has two handles: one by which it may be borne, another by which it cannot... and thus you will lay hold on it as it is to be borne.",
 "Every hard thing has two handles. If you can't carry it one way, hold it by the other."),
('055',"Thai proverb",
 "Build the house to suit the one who lives in it...",
 "Fit the way to the person."),
('018',"The Buddha to Sona · Anguttara Nikaya 6.55, tr. Bhikkhu Sujato, 2018",
 "When your harp’s strings were tuned too tight, was it resonant and playable?” ... “In the same way, Sona, when energy is too forceful it leads to restlessness. When energy is too slack it leads to laziness.",
 "Too tight or too loose, the harp makes no music. Your effort needs the same balance."),
])
which=sys.argv[1]; LABEL,S={'A':A,'B':B}[which]
F=json.loads(sys.argv[2]) if len(sys.argv)>2 else {}
R.FORCE.clear(); R.FORCE.update({k:tuple(v) for k,v in F.items()})
d=f'out/o5{which}'; shutil.rmtree(d,ignore_errors=True); os.makedirs(d); js=[]
for i,(ph,who,q,m) in enumerate(S,1):
    sl=dict(who=who,quote=q,meaning=m,counter=f'{i:02d} / 10  ·  {LABEL}')
    r=R.render_slide(ph,sl,f'{d}/{i:02d}_{ph}.jpg'); print(i,ph,r,'END',r[1]+r[3]); js.append(dict(photo=ph,who=who,quote=q,meaning=m))
json.dump(js,open(f'{d}/slides.json','w'),ensure_ascii=False,indent=1)
from PIL import Image
fs=sorted(f for f in os.listdir(d) if f.endswith('.jpg'))
sh=Image.new('RGB',(5*432,2*540)); [sh.paste(Image.open(f'{d}/{f}').resize((432,540)),((j%5)*432,(j//5)*540)) for j,f in enumerate(fs)]; sh.save(f'o5{which}_sheet.jpg',quality=88)
