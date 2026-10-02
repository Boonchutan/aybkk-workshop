from common import words
L=[(0,7,"When something hurt you once, it creates fear.","😨"),
(8,14,"But then you do it again anyway.","🔁"),
(15,20,"Because it is the healing way,","🩹"),
(21,27,"and you will find out the way.","🧭"),
(28,32,"But the real answer is...","❓"),
(33,40,"Oh, today it was raining in Bangkok again.","🌧️"),
(41,47,"My wife and I, we race home,","🏃"),
(48,53,"afraid of flood, like last week.","🌊"),
(54,60,"Okay, let me tell you a story","📖"),
(61,67,"from Panchatantra, the old Indian book.","📚"),
(68,77,"There are two little birds that live by the sea.","🐦"),
(78,86,"The mama bird said, the sea is too close.","🌊"),
(87,96,"One day the water will come and take our eggs.","🥚"),
(97,100,"Papa bird very proud.","😤"),
(101,112,"No, no, no, the sea know me, it will never do that.","🙅"),
(113,117,"The sea, he was listening.","👂"),
(118,123,"Haha, what a proud little bird.","😏"),
(124,128,"Okay, I will test him.","🌊"),
(129,138,"Next day, the birds go out to find some food.","🐛"),
(139,146,"The water come up, take all the eggs.","🥚"),
(147,152,"The sea hurt them so badly.","💔"),
(153,158,"And the sea is so big,","🌊"),
(159,166,"but the papa bird, he fight back anyway.","💪"),
(167,172,"He call every bird he know.","📣"),
(173,180,"They hit the sea with their little wings.","🪽"),
(181,186,"But the sea is too big.","🌊"),
(187,191,"Nothing happened to the sea.","🤷"),
(192,197,"Then one wise old bird said,","🦢"),
(198,204,"Go to Garuda, king of the birds.","🦅"),
(205,208,"And Garuda's master come.","✨"),
(209,214,"He is the great god Vishnu.","🙏"),
(215,223,"He tell the sea, hey, give back the eggs.","🗣️"),
(224,232,"And the big sea, shaking with fear, very scared.","😨"),
(233,236,"Give back every egg.","🥚"),
(237,244,"This bird in Sanskrit, we call them tittibha.","🐦"),
(245,252,"In many yoga book, called Tittibhasana, mean firefly.","✨"),
(253,259,"But no, tittibha actually is a bird.","🐦"),
(260,268,"If you do this asana, maybe you, you know,","🧘"),
(269,277,"fall from this asana before, maybe the legs burn.","🔥"),
(278,286,"You feel bad, your butt, your hip very sore.","😣"),
(287,295,"And then sometimes when you start to do it,","🤔"),
(296,300,"you're a little bit afraid,","😰"),
(301,309,"but you have to practice anyway by yourself, right?","🧍"),
(310,314,"So the breathing is bad,","😮‍💨"),
(315,324,"like a little bird hit the sea with their wings.","🪽"),
(325,334,"The real answer is: don't fight the sea alone, right?","💡"),
(335,340,"Even the little bird need help.","🤝"),
(341,346,"That's why in Mysore class,","🧘"),
(347,352,"there's a teacher in the room,","👨‍🏫"),
(353,358,"coming to give you some advice.","💬"),
(359,363,"Your legs sore from walking,","🚶"),
(364,369,"your butt and thighs feel heavy.","🪨"),
(370,377,"He will come and give you some tricks.","🪄"),
(378,386,"With practice, then it will become easier for you.","🌱"),
(387,393,"You see, the sea took the eggs.","🌊"),
(394,401,"The bird find the trick, get them back.","🥚"),
(402,405,"Your fear, your hesitation,","😨"),
(406,410,"it takes something from you.","💔"),
(411,414,"And it's also teach you.","📖"),
(415,421,"And one day, it become your wisdom.","🪷")]
# check coverage
ix=[i for a,b,_,_ in L for i in range(a,b+1)]
assert ix==list(range(len(words))), 'caption index gap'
lines=[]
for a,b,text,emo in L:
    ws=text.split(); src=words[a:b+1]
    st=[w[0] for w in src]; en=[w[1] for w in src]
    if len(ws)==len(src): wt=list(zip(st,en))
    else:
        s0,s1=st[0],en[-1]; d=(s1-s0)/len(ws); wt=[(s0+k*d,s0+(k+1)*d) for k in range(len(ws))]
    lines.append(dict(ws=ws,wt=wt,emo=emo,start=wt[0][0]-0.08))
for i,l in enumerate(lines):
    l['end']=(lines[i+1]['start'] if i+1<len(lines) else l['wt'][-1][1]+1.0)
