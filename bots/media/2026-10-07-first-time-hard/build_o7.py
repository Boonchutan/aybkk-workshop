import json, os, shutil, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render_f as R
R.QF=('fonts/PatrickHand-Regular.ttf',None); R.QS=tuple(range(46,34,-2)); R.QLINES=7
R.PENS=((940,[70],0.0),(470,[50,560],0.06),(360,[40,680],0.22))
B1=('THE FIRST TIME IS HARD',[
('7-030',"Thomas Fuller · Gnomologia, no. 560, 1732",
 "All things are difficult, before they are easy.",
 "Everything is hard the first time. It gets easy later."),
('7-002',"Russian proverb · V. I. Dal's collection, 1862",
 "The first pancake comes out a lump.",
 "Your first try is usually messy. That is normal, so keep going."),
('7-033',"Seneca · Letters to Lucilius 104, tr. Richard M. Gummere, 1925",
 "To what man did they not seem easier in the doing? Our lack of confidence is not the result of difficulty; the difficulty comes from our lack of confidence.",
 "Things look hard because we are afraid to start. Once we start, they feel easier."),
('7-032',"B. K. S. Iyengar · Light on Yoga, 1966",
 "Everything will seem at first to be completely unfamiliar... This is due to fear of a fall... To topple over while learning the head stand is not as terrible as we imagine... Then one will just roll over and smile.",
 "Going upside down feels strange and scary at first. A fall is not as bad as you fear."),
('7-016',"Michael Phelps · speaking to TODAY, 2025",
 "When I first got into the water to swim... I didn't want to put my face under... Yes, me, Michael Phelps, afraid to put my face into the water. But naturally, you overcome those fears...",
 "Even Michael Phelps was scared to put his face in the water at first. He got over it."),
('7-027',"Russian proverb · V. I. Dal's collection, 1862",
 "The eyes frighten you, but the hands get it done.",
 "Start, and your hands get it done."),
('7-004',"Rikyu's hundred tea poems · tr. from Japanese",
 "Cast off shame, ask others, and learn: this is the very foundation of skill.",
 "Feeling shy at the start is normal. Ask anyway. That is where every skill begins."),
('7-010',"Sama, a Buddhist nun · Therigatha 2.10, tr. Bhikkhu Sujato & Jessica Walton, 2019",
 "Four or five times / I left my dwelling. / I had failed to find peace of heart, / or any control over my mind.",
 "Even a nun who gave her life to practice found the start hard. You are not alone."),
('6-008',"Su Shi · on Wen Yuke's bamboo painting, 1079, tr. from Chinese",
 "Yuke taught me this. I could not do it, though my mind understood why. ... Inside and outside are not one; mind and hand do not answer each other. That is the fault of not having practised.",
 "Knowing it in your head is not enough. Your hands and body learn only by practice."),
('7-038',"Goethe · Wilhelm Meister's Apprenticeship, tr. Thomas Carlyle, 1824",
 "The height charms us, the steps to it do not: with the summit in our eye, we love to walk along the plain.",
 "We love the top, but not the steps to get there. The steps are the practice."),
])
B2=('AGAIN AND AGAIN',[
('7-052',"Russian saying · V. I. Dal's collection, 1862",
 "Repetition is the mother of learning.",
 "We learn by doing the same thing again and again."),
('7-021',"Dong Yu, scholar, 3rd century · tr. from Chinese",
 "Someone came to study with Dong Yu. He would not teach him, but said: 'First you must read it a hundred times.' He said: 'Read a book a hundred times, and the meaning shows itself.'",
 "Don't understand it yet? Do it a hundred times. Then it becomes clear."),
('7-028',"Confucius · Analects 17.2, tr. James Legge, 1861",
 "By nature, men are nearly alike; by practice, they get to be wide apart.",
 "We all start out much the same. What we practise again and again makes us different."),
('7-036',"Svatmarama · Hatha Yoga Pradipika 1.67-68, tr. Pancham Sinh, 1915",
 "Success comes to him who is engaged in the practice. How can one get success without practice; for by merely reading books on Yoga, one can never get success... Practice alone is the means to success.",
 "Reading about yoga is not enough. Only doing it, again and again, brings success."),
('7-034',"Mencius · Mengzi 7B21, tr. James Legge, 1861",
 "There are the footpaths along the hills; if suddenly they be used, they become roads; and if, as suddenly they are not used, the wild grass fills them up.",
 "Keep walking a path and it becomes a road. Stop, and wild grass covers it again."),
('7-059',"Vrind · Hindi couplet, 1704, tr. from Hindi",
 "By practising and practising, the dull mind becomes skilled; from the rope coming and going, a mark forms on the stone.",
 "Keep practising and even a slow learner gets good, like a rope wearing a mark into stone."),
('7-051',"Epictetus · Discourses II.18, tr. George Long, 1877",
 "...the habit of walking by walking, the habit of running by running. ... Generally then if you would make any thing a habit, do it...",
 "You get good at walking by walking. Want something to become a habit? Do it."),
('7-049',"William James · The Principles of Psychology, 1890",
 "Never suffer an exception to occur till the new habit is securely rooted in your life. Each lapse is like the letting fall of a ball of string which one is carefully winding up...",
 "While a new habit is young, do not skip a day. One slip undoes many days of work."),
('7-046',"Thai saying",
 "Grind an anvil down into a needle.",
 "Keep at it, with all your heart, until it works."),
('7-071',"Thomas Fuller · Gnomologia, no. 5410, 1732",
 "Use Legs, and have Legs.",
 "Use your legs every day, and you keep strong legs."),
])
B3=('THEN IT GETS EASY',[
('7-043',"Peng Duanshu · On Learning, 18th century, tr. from Chinese",
 "Are the things of the world hard or easy? Do them, and even the hard become easy. Do not do them, and even the easy become hard.",
 "Hard or easy is up to you. Do it, and hard turns easy. Don't, and easy turns hard."),
('7-045',"Thomas Keller · chef, Kingdom Magazine, 2022",
 "At first... you really have to focus and concentrate, you're kind of slow... And you get better at it as time goes on... And then it becomes liberating, because you don't have to think about it, you just do it.",
 "A new skill is slow at first and takes all your focus. Keep practising, and soon you just do it."),
('7-068',"Goethe · Maxims and Reflections, tr. T. Bailey Saunders, 1893",
 "To see a difficult thing lightly handled gives us the impression of the impossible.",
 "Easy-looking skill is just a lot of practice."),
('7-019',"B. K. S. Iyengar · Light on Yoga, 1966",
 "When one has mastered an āsana, it comes with effortless ease and causes no discomfort. The bodily movements become graceful.",
 "Once your body truly learns an asana, it feels easy, comfortable and graceful."),
('7-066',"Aristotle · Rhetoric I.11, tr. John Henry Freese, 1926",
 "Application, study, and intense effort are also painful, for these involve necessity and compulsion, if they have not become habitual; for then habit makes them pleasant.",
 "Hard work feels painful while it is new. Once it becomes a habit, the habit makes it pleasant."),
('6-002',"Leo Tolstoy · Anna Karenina, tr. Constance Garnett, 1901",
 "...it seemed not his hands that swung the scythe, but the scythe mowing of itself... These were the most blissful moments.",
 "After long practice, the work seemed to do itself. Those were his happiest moments."),
('7-037',"Japanese proverb · Monzen no kozo",
 "The boy at the temple gate chants the sutra he was never taught.",
 "Hear and see it every day, and one day you can do it without lessons. That is a Mysore room."),
('7-015',"Ouyang Xiu · The Oil Seller, about 1067, tr. from Chinese",
 "...slowly ladled oil, letting it drip in through the coin's hole without wetting the coin. Then he said: 'I have no secret either. My hands are simply practised.'",
 "There is no magic secret. Hands that do something again and again get good at it."),
('7-056',"Ralph Waldo Emerson · The Conduct of Life, 1860",
 "A humorous friend of mine thinks, that the reason why Nature is so perfect in her art, and gets up such inconceivably fine sunsets, is, that she has learned how, at last, by dint of doing the same thing so very often.",
 "Even nature's sunsets are so good because she has done them so very often."),
('7-061',"Krishna · Bhagavad Gita 6.23-25, tr. Edwin Arnold, 1885",
 "Steadfastly the will / Must toil thereto, till efforts end in ease... so, step by step, it comes / To gift of peace assured and heart assuaged.",
 "Step by step, hard effort turns into ease."),
])
which=sys.argv[1]; LABEL,S={'1':B1,'2':B2,'3':B3}[which]
F=json.loads(sys.argv[2]) if len(sys.argv)>2 else {}
R.FORCE.clear(); R.FORCE.update({k:tuple(v) for k,v in F.items()})
d=f'out/o7_{which}'; shutil.rmtree(d,ignore_errors=True); os.makedirs(d); js=[]
for i,(ph,who,q,m) in enumerate(S,1):
    sl=dict(who=who,quote=q,meaning=m,counter=f'{i:02d} / 10  ·  {LABEL}')
    r=R.render_slide(ph,sl,f'{d}/{i:02d}_{ph}.jpg'); print(i,ph,r,'END',r[1]+r[3]); js.append(dict(photo=ph,who=who,quote=q,meaning=m))
json.dump(js,open(f'{d}/slides.json','w'),ensure_ascii=False,indent=1)
from PIL import Image
fs=sorted(f for f in os.listdir(d) if f.endswith('.jpg'))
sh=Image.new('RGB',(5*432,2*540)); [sh.paste(Image.open(f'{d}/{f}').resize((432,540)),((j%5)*432,(j//5)*540)) for j,f in enumerate(fs)]; sh.save(f'o7_{which}_sheet.jpg',quality=88)
