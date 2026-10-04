import json, os, shutil, sys
import render_f as R
R.QF=('fonts/PatrickHand-Regular.ttf',None); R.QS=tuple(range(46,34,-2)); R.QLINES=7
R.PENS=((940,[70],0.0),(470,[50,560],0.06),(360,[40,680],0.22))
A=('THE MOUNTAIN DOES NOT GROW',[
('158','The Foolish Old Man · Liezi ch. 5, tr. Lionel Giles, 1912',
 'Though I myself must die, I shall leave a son behind me... the mountain will receive no increment or addition. Why then should I despair of levelling it to the ground at last?',
 'Almost 90, he moved a mountain one basket at a time. The mountain cannot grow. His work can go on.'),
('175','The Buddha · Anguttara Nikaya 3.92, tr. Bhikkhu Sujato',
 "That farmer has no special power or ability to say: 'Let the crops germinate today!' ... But there comes a time when that farmer's crops germinate, flower, and ripen as the seasons change.",
 'No farmer can make seeds grow today. Keep working, and they grow in their own time.'),
('067','Tiruvalluvar · Tirukkural 620, tr. G. U. Pope, 1886',
 'Who strive with undismayed, unfaltering mind, / At length shall leave opposing fate behind.',
 'Keep trying. One day, bad luck is left behind you.'),
('030','Yang Sa-eon · Korean sijo poem, 16th century',
 'Soaring high though a mountain may be, it is a mere mound beneath Heaven / Climb and climb, and no summit cannot be reached / Yet people stay at its base saying the mountain is too high.',
 "No mountain is too high to climb. The people who say 'too high' just stay at the bottom."),
('020','Confucius · Analects II.4, tr. James Legge',
 'At fifteen, I had my mind bent on learning. At thirty, I stood firm... At seventy, I could follow what my heart desired, without transgressing what was right.',
 'Confucius kept growing from 15 to 70. Learning has no finish line.'),
('112','The Buddha · Dhammapada 81, tr. F. Max Müller, 1881',
 'As a solid rock is not shaken by the wind, wise people falter not amidst blame and praise.',
 'If people laugh at your practice, be a rock in the wind. Keep going.'),
('152','R. Sharath Jois · Foreword to Yoga Mala, 2009',
 'Guruji created a strong foundation of yoga for us by teaching with such dedication for so many years. It is our duty to build upon that foundation... from him we should learn, be inspired, and carry on.',
 'Our teachers built the base over many years. Our job is to keep building on it.'),
('015','Vannupatha Jataka, No. 2 · tr. Robert Chalmers, 1895',
 'Untiring, deep they dug that sandy track / Till, in the trodden way, they water found. / So let the sage, in perseverance strong, / Flag not nor tire, until his heart find Peace.',
 'In the desert, they kept digging in the same place until they found water. Do not stop digging.'),
('052','Krishna · Bhagavad Gita 6.40, tr. Edwin Arnold, 1885',
 'He is not lost, thou Son of Pritha! No! / Nor earth, nor heaven is forfeit, even for him, / Because no heart that holds one right desire / Treadeth the road of loss!',
 'No good effort is ever wasted. Every morning on the mat still counts.'),
('187','Swami Vivekananda · The Real Nature of Man, London lecture',
 'Know the Truth and practice the Truth. The goal may be distant, but awake, arise, and stop not till the goal is reached.',
 'The goal may be far away. Wake up, get up, and do not stop until you get there.'),
])
B=('THE HARD WAY',[
('116',"Shunryu Suzuki · Zen Mind, Beginner's Mind, 1970",
 'Those who can sit perfectly physically usually take more time to obtain the true way of Zen... But those who find great difficulties in practicing Zen will find more meaning in it.',
 'When it is hard, you find more meaning in every step.'),
('171','Doctrine of the Mean, ch. 20 · tr. Ku Hung-ming, 1906',
 'Some exercise these moral qualities naturally and easily; ... some with effort and difficulty. But when the achievement is made it comes to one and the same thing.',
 'Some find it easy. Some find it hard. In the end, both arrive at the same place.'),
('159','Mencius · Mengzi VII.A.18, tr. James Legge',
 'Men who are possessed of intelligent virtue and prudence in affairs will generally be found to have been in sickness and troubles.',
 'Wise and careful people usually learned it in hard times.'),
('036','Chinese proverb · tr. William Scarborough, 1875',
 'Iron long fired becomes steel.',
 'Iron becomes steel only after a long time in the fire.'),
('017','Chinese proverb · tr. William Scarborough, 1875',
 'No one knows how difficult anything is until he has tried to do it.',
 'You only know how hard something is when you try it yourself.'),
('121','Japanese proverb · tr. W. G. Aston, 1872',
 'By pinching yourself understand the pain of others.',
 'Feel the hard part in your own body, and you will understand how hard it is for others.'),
('034','Krishna · Bhagavad Gita 18.37, tr. K. T. Telang, 1882',
 'That happiness is called good, in which one is pleased after repetition... which is like poison first and comparable to nectar in the long run...',
 'Good things taste bitter at first and sweet at the end. Practice is like that.'),
('111','The Buddha · Dhammapada 80, tr. F. Max Müller, 1881',
 'Well-makers lead the water (wherever they like); fletchers bend the arrow; carpenters bend a log of wood; wise people fashion themselves.',
 'Water, arrows and wood are shaped by skilled hands. Wise people shape themselves, bit by bit.'),
('046','Book of Rites (Liji), Record on Education · tr. James Legge, 1885',
 "...when he learns, one knows his own deficiencies; when he teaches, he knows the difficulties of learning. ... Hence it is said, 'Teaching and learning help each other.'",
 'Learning shows you what you lack. Teaching shows you how hard learning is.'),
('056','Zeno on his student Cleanthes · Diogenes Laertius 7.37, tr. R. D. Hicks, 1925',
 '...him Zeno used to compare to hard waxen tablets which are difficult to write upon, but retain the characters written upon them.',
 "Some learn slowly, like hard wax that is tough to write on. But what they learn stays. Cleanthes later led Zeno's school."),
])
which=sys.argv[1]; LABEL,S={'A':A,'B':B}[which]
F=json.loads(sys.argv[2]) if len(sys.argv)>2 else {}
R.FORCE.clear(); R.FORCE.update(F)
d=f'out/o4{which}'; shutil.rmtree(d,ignore_errors=True); os.makedirs(d); js=[]
for i,(ph,who,q,m) in enumerate(S,1):
    sl=dict(who=who,quote=q,meaning=m,counter=f'{i:02d} / 10  ·  {LABEL}')
    r=R.render_slide(ph,sl,f'{d}/{i:02d}_{ph}.jpg'); print(i,ph,r,'END',r[1]+r[3]); js.append(dict(photo=ph,who=who,quote=q,meaning=m))
json.dump(js,open(f'{d}/slides.json','w'),ensure_ascii=False,indent=1)
from PIL import Image
fs=sorted(f for f in os.listdir(d) if f.endswith('.jpg'))
sh=Image.new('RGB',(5*432,2*540)); [sh.paste(Image.open(f'{d}/{f}').resize((432,540)),((j%5)*432,(j//5)*540)) for j,f in enumerate(fs)]; sh.save(f'o4{which}_sheet.jpg',quality=88)
