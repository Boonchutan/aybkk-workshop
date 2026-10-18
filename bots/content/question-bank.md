# Question Bank: what people type into the search box

Boonchu, 18 Oct 2026: "This funnel technique. Save this and use it for my benefit."
Source: @jaredroars Reel DeKWUZYhO3z (74 s, reacting to @themrspedersen, Rachel Pedersen). Watched and transcribed 18 Oct.

## The technique (as she tells it)
1. Pick your one specialty.
2. Cut it into 12 subtopics, one per month. That is a year of content.
3. Google each subtopic. Open "People also ask". Each click shows more questions. 30 clicks = 30 questions people already want answered.
4. Put them in a spreadsheet, shuffle, make one piece a day.
5. It is the TOP of the funnel only: it brings strangers in. It sells nothing by itself.

## What we changed for AYBKK
- Google "People also ask" blocks robots, and Google is blocked in China. So we read the search box suggestions instead (what people type, same idea): Google for English and Thai, Baidu for Chinese, Yandex for Russian. Script: `bots/tools/question-bank/mine.py`. Raw list (about 2,600 phrases, 18 Oct): `bots/content/question-bank-2026-10.json`.
- Baidu is not Xiaohongshu. When a China graduate can send screenshots of the Xiaohongshu search box (type 阿斯汤加 and wait), add those words here. They beat Baidu for China.

## Rules (Plato, Carne, Machi)
1. NOT daily. We do not lack ideas (about 30 pieces wait in the Content Waiting List). At most 1 answer piece a week, in the Monday TRUST slot of the PTL plan. Plato's daily story series stays as it is.
2. Common question, uncommon answer. Answer from the room (since 2013, what Boonchu sees in students), never like a web article. No statistic unless checked against its source.
3. The searched words go in the title, exact, in their language: Xiaohongshu title, first on-screen line, first caption line, Google post text. That is how search finds us for months, not 48 hours.
4. Before writing a new piece, check the waiting list. If one already answers a question, give it the searched title. Do not write a new one.
5. Never make content from tradition gossip in this list: deaths, causes of death, wives and children, "scandal". (Same as the no-tragedy rule.)
6. Authorization questions: say exactly "Authorized Level 2 by R. Sharath Jois". Never hint that the 180K program gives authorization.
7. Refresh on the 1st of Jan, Apr, Jul, Oct: run the script, note only NEW questions here.

## The picks (18 Oct 2026). Exact search words, then our angle.

### China, the 180K buyer (Baidu)
Studio owners and teachers type their pain. This IS the 180K pitch ("how to build students who stay for years"):
- 瑜伽馆 留住会员怎么办 (my studio can't keep members, what do I do?)
- 开了瑜伽馆没有会员怎么办 (I opened a studio and have no members)
- 瑜伽馆遇到会员想退卡怎么办 (a member wants to cancel their card)
- 瑜伽馆老会员带新会员方案 (a plan for old members to bring new ones)
- 瑜伽馆的办卡套路 (yoga studio card tricks: people do not trust prepaid cards)
- 瑜伽老师真实收入 (a yoga teacher's real income)
- 阿斯汤加老师课前怎样引导会员的话术 (what an Ashtanga teacher says to members before class)
- 阿斯汤加认证老师名单 / 阿斯汤加中国认证老师 / 如何考取阿斯汤加认证导师 (list of authorized teachers / in China / how to get authorized): rule 6.
Use: Carne uses these words in 180K replies; the China 180K page headline can be their words (e.g. 瑜伽馆留不住会员？). Never a price in a DM.

Practitioners:
- 练阿斯汤加最后不练了 (I practised Ashtanga, then quit) and 阿斯汤加为啥不练 (why people don't practise Ashtanga): the Habit Gap in their own words.
- 阿斯汤加瑜伽为什么严厉 (why is Ashtanga so strict?): the tradition answer, calm.
- 阿斯汤加每天练一样的 (it's the same every day) / 阿斯汤加每一天都是从零开始 (every day starts from zero)
- 阿斯汤加瑜伽适合40多岁女性练不 (is Ashtanga OK for women in their 40s?)
- 练瑜伽反而睡不着觉 (yoga made my sleep worse)
- 阿斯汤加难吗 (is Ashtanga hard?) / 阿斯汤加初学者能跟上吗 (can a beginner keep up?)

RISK, not checked: type 迈索尔瑜伽 (Mysore yoga) into Baidu and it offers 跑路了 (ran off), 倒闭了 (closed down), 为什么闭馆了 (why did it close), 弟子班学费多少 (disciple class fee), 为什么那么贵 (why so expensive). It looks like a Chinese brand with that name had trouble. A web search found nothing. Our Chinese pages use 迈索尔 in 8 files (bkk.html, season1, october-tour, mysore-room-welcome, idcn and others). Ask a China graduate what people think of when they hear 迈索尔瑜伽, before the China 180K page goes out. Safe habit: always write 阿斯汤加 next to 迈索尔, plus AYBKK.

### Bangkok, Thai (Google)
- ปวดหลัง เล่นโยคะได้ไหม (back pain: can I do yoga?)
- โยคะช่วยออฟฟิศซินโดรมไหม (does yoga help office syndrome?)
- เล่นโยคะทุกวัน อันตรายไหม (is yoga every day dangerous?)
- ผู้สูงอายุเล่นโยคะได้ไหม (can older people do yoga?)
- โยคะสร้างกล้ามเนื้อได้ไหม (can yoga build muscle?)
- ปวดเข่า เล่นโยคะได้ไหม (knee pain: can I do yoga?)
- เรียนครูโยคะ กรุงเทพ (yoga teacher training Bangkok): Bangkok 180K cohort.
- เรียนโยคะ ราคา / โยคะ สุขุมวิท 31 (yoga class price / yoga Sukhumvit 31): these people are ready to buy.

### English (Google)
- is ashtanga the hardest yoga / is ashtanga yoga hard for beginners
- what is a mysore yoga class
- how long to learn ashtanga primary series
- is yoga every day too much / yoga every day or every other day
- can yoga make back pain worse / yoga making back pain worse
- knee pain after starting yoga
- is it too late to start yoga at 40 / is 60 too old to start yoga
- does ashtanga yoga build muscle / is ashtanga yoga considered strength training
- can yoga replace strength training for runners
- how to become an ashtanga teacher / authorized ashtanga teacher: rule 6.
- yoga bangkok english / yoga bangkok price / yoga bangkok sukhumvit

### Russian (Yandex)
- майсор йога что это (what is Mysore yoga?)
- аштанга йога что это простыми словами (what is Ashtanga, in simple words?)
- что даёт йога женщине после 40 / после 50 (what yoga gives a woman after 40 / 50). Also "гормональная йога": never promise hormone results.
- йога каждый день результат (yoga every day: results)
- бандхи в йоге что это и зачем (bandhas: what and why?)
RISK: "паттабхи джойс скандал" (Pattabhi Jois scandal) is a top suggestion. Never content. If a lead asks, no bot draft: Boonchu answers himself.

## Bangkok search check (Google, 18 Oct)
- "ashtanga yoga bangkok": Google suggests "ashtanga yoga center of bangkok aybkk". Good.
- "ashtanga bangkok": suggests "shraddha ashtanga bangkok sabkk" (SABKK, competitor), not us.
- "yoga sukhumvit 31": suggests "absolute yoga sukhumvit 31", not us. Our site already says Sukhumvit 31 (title text, map data, address).
- Fix with what is already running, no new build: more Google reviews (aybkk.net/review) and Plato's Google posts. Plato writes "Sukhumvit 31" in the text of every Google post.
