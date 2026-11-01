from common import words
L=[(0,4,"Can't gain flexibility by pushing.","💪"),
(5,13,"Tight backbend can't get bendy if you force it.","🙅"),
(14,17,"I tell you why.","👀"),
(18,21,"Hanuman is monkey god.","🙏"),
(22,26,"Hanumanasana is named after him.","🧘"),
(27,34,"One day, Hanuman jump over the big sea.","🌊"),
(35,46,"In the middle of the sea, a giant snake lady come up.","🐍"),
(47,50,"Her name is Surasa.","🐍"),
(51,56,"She open her mouth and say,","👄"),
(57,64,"to pass, you must go into my mouth.","😮"),
(65,69,"Hanuman make himself very big.","⬆️"),
(70,74,"She make her mouth bigger.","👄"),
(75,78,"Then he get bigger.","⬆️"),
(79,83,"Her mouth get even bigger.","😮"),
(84,89,"Then he make himself even bigger.","⬆️"),
(90,93,"Then she got bigger.","🐍"),
(94,95,"Nobody wins.","🤷"),
(96,100,"Then Hanuman have some idea.","💡"),
(101,109,"He make himself very tiny, small like your thumb.","👍"),
(110,118,"He fly into her mouth and then out again.","✨"),
(119,127,"So he keep her rule, go into her mouth,","✅"),
(128,131,"and still he pass.","✅"),
(132,138,"Surasa bless him and let him go,","🙏"),
(139,147,"because she was only a test from the gods.","✨"),
(148,152,"Your backbend is the same.","🧘"),
(153,157,"When you push, it push back.","↩️"),
(158,162,"Bigger and bigger, nobody wins.","🤷"),
(163,165,"So go small,","🤏"),
(166,169,"a tiny bit deeper.","🤏"),
(170,171,"Stay, breathe,","😮‍💨"),
(172,174,"small every day.","📅"),
(175,177,"That's Hanuman's trick.","🙏")]
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
