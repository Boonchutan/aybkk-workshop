# The 30 slides for the 3 breath posts, word for word from the list Boonchu saw (1 Oct). E = event (no quote marks), Q = quote.
def E(who,head,meaning): return dict(who=who,quote=head,meaning=meaning,noquote=True)
def Q(who,quote,meaning): return dict(who=who,quote=quote,meaning=meaning)
A=[ # 11pm: strong heart, strong lungs
 Q('Svatmarama · Hatha Yoga Pradipika 2.2','Respiration being disturbed, the mind becomes disturbed. By restraining respiration, the Yogi gets steadiness of mind.','When your breath is shaky, your mind is shaky too. Slow, calm breathing makes a calm mind.'),
 E('University of Connecticut · 2019','49 studies: yoga lowered blood pressure. With breathing and rest added, the drop was almost twice as big.','The breath is not an extra. Yoga with breathing and rest helped blood pressure most.'),
 E('Pavia and Florence, Italy · 2001',"Saying a prayer or a yoga mantra slowed breathing to about 6 breaths a minute. The body's blood pressure control got stronger.",'Slow breathing is free. A prayer or a mantra can set the pace.'),
 Q('Bhagavad Gita 5.27 (tr. Edwin Arnold)','Whose outward breath and inward breath are drawn / Equal and slow through nostrils still and close','A calm person breathes in and out the same length, slow and quiet, through the nose.'),
 E('24 hospitals in India · 2020','3,959 heart attack patients. Gentle yoga with breathing helped them a little: better health, back to daily life sooner.','No harm was reported. Ask your heart doctor before you start.'),
 E('University of Kansas · 2013','People with an irregular heartbeat did yoga for 3 months. Their bad heartbeat episodes dropped from 3.8 to 2.1.','A small study, but they also felt less worried and less sad.'),
 Q('Zhuangzi · Book VI (tr. Legge)','The breathing of the true man comes (even) from his heels, while men generally breathe (only) from their throats.','Wise people breathe deep and quiet. Most people breathe only from the throat.'),
 E('Cochrane review · 2016','15 studies, 1,048 people with asthma: yoga probably helped a little with symptoms and daily life.','Use yoga next to your asthma medicine. Never instead of it.'),
 E('University of Duisburg-Essen, Germany · 2019','11 studies, 586 people with sick lungs (COPD): yoga breathing helped them walk farther and breathe out more air.','The gains came from pranayama. Sick lungs can still learn.'),
 Q('Seneca · Letter 54, On asthma','Yet in the midst of my difficult breathing I never ceased to rest secure in cheerful and brave thoughts.','Seneca had asthma. Even when breathing was hard, he kept his mind calm and brave.'),
]
B=[ # 6am: calm mind, good sleep
 Q('Henry David Thoreau · Walden, 1854','Morning air! If men will not drink of this at the fountain-head of the day, why, then, we must even bottle up some and sell it in the shops','Fresh morning air is a gift. Wake early and breathe it in while it is free.'),
 E('Stanford University · 2023','5 minutes a day of long, slow out-breaths lifted mood more than meditation did.',"You don't need an hour. Five minutes of slow breathing out goes everywhere with you."),
 E('Universities of Sussex and Oxford · 2023','12 studies, 785 adults: breathing practice lowered stress.','It helped by a small to medium amount. Not magic, but real.'),
 Q('Swami Vivekananda · Raja Yoga, 1896','We begin by controlling the breath, as the easiest way of getting control of the Prana.','Your breath is the easiest door to your life energy. Learn to guide your breath first.'),
 E('Universities in Adelaide and Sydney · 2020','13 studies: yoga lowered depression in people with mental health problems. More classes a week, bigger drops.','Showing up often may matter most.'),
 E('Beijing · 2025','22 studies: adults with poor sleep who did yoga said they slept almost 2 hours more a night.',"A gentle, cheap way to help sleep. Use it next to your doctor's advice."),
 Q('Laozi · Tao Te Ching 10 (tr. Legge)','When one gives undivided attention to the (vital) breath, and brings it to the utmost degree of pliancy, he can become as a (tender) babe.','Give your full attention to your breath and keep it soft. Then you stay fresh and bendy like a baby.'),
 E('Northwestern University, Chicago · 2016','People remembered pictures better while breathing in through the nose, not the mouth.','Ashtanga asks for nose breathing. In this study, memory parts of the brain moved with the nose breath.'),
 E('University of Illinois · 2014','118 adults, average age 62: 8 weeks of yoga beat stretching on memory and focus tests.','Starting in your 60s still counts. Yoga helped the mind, not only the body.'),
 Q('Dhammapada 204 (tr. Max Müller)','Health is the greatest of gifts, contentedness the best riches...','Being healthy is the best gift. Being happy with what you have is real treasure.'),
]
C=[ # 10am: every body, every age
 Q('Svatmarama · Hatha Yoga Pradipika 1.19','It should be practised for gaining steady posture, health and lightness of body.','Asana comes first. We practise it to feel steady, healthy and light.'),
 E('University of Edinburgh · 2019','22 studies: yoga gave older adults better balance, stronger legs, more flexibility, better mood and sleep.','Yoga is not only for the young.'),
 E('Boston Medical Center · 2017','12 weekly yoga classes helped long-term back pain about as much as 15 physical therapy visits.','A gentle weekly class can be a real choice for back pain.'),
 Q('Kabir · Songs of Kabir (tr. Tagore)','Be strong, and enter into your own body: for there your foothold is firm.','Stop looking far away for strength. Come home to your own body.'),
 E('University of Rochester · 2013','410 cancer survivors: 4 weeks of gentle yoga helped them sleep better and use fewer sleeping pills.','Gentle breathing, soft asana and rest, after cancer treatment.'),
 E('Ohio State University · 2014','Breast cancer survivors who did yoga had 57% less tiredness, 3 months after the classes ended.','The lead scientist thinks the breathing and meditation parts mattered a lot.'),
 E('Top cancer doctor groups (ASCO and SIO) · 2023','They now say yoga may be offered for worry and sadness in people with cancer.','Yoga is part of official cancer care advice. Next to treatment, never instead of it.'),
 E('National Taiwan University Hospital · 2024','After 8 weeks of yoga, period pain was 2.75 points lower (out of 10) than with no exercise.','Steady practice may make painful periods easier.'),
 E('Paula Radcliffe · London Marathon 2003','Found to have asthma at 14, she later set a marathon world record that stood for 16 years.',"Asthma doesn't have to stop you. She worked with her doctor and her medicine."),
 E('Kareem Abdul-Jabbar · NBA, 1969 to 1989','He says yoga helped him play 20 NBA seasons, until age 42, with few injuries.','One man\'s story. He also trained martial arts. A strong example of steady practice.'),
]
POSTS={'A':A,'B':B,'C':C}
