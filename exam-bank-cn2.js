/* exam-bank-cn2.js - question bank for the In-depth CN#2 final exam.
   SERVER SIDE ONLY. Holds the correct answers, so it must never be served
   to the browser. api/exam.js strips the correct flags before a paper leaves
   the server. At the repo root on purpose: .railwayignore excludes *.json. */

module.exports = [
 {
  "lecture": "Psychology of Learning",
  "topic": "retention-frame-three-factors",
  "stem_en": "You open a small shala. After four months you have plenty of people trying a first class and very few who stay. You have a long list of new cues you want to test. Which single thing do you work on first?",
  "stem_zh": "你开了一间小教室。四个月过去，来上第一堂课的人不少，留下来的却很少。你手上有一份长长的新口令清单想试。你最先该在哪一件事上下功夫？",
  "options": [
   {
    "label": "A",
    "text_en": "Build a bigger and more precise library of cues, since better instruction is what makes a student feel the class was worth the money.",
    "text_zh": "把口令库做得更大更精确，因为更好的指导才让学生觉得这堂课值这个价。",
    "correct": false,
    "note": "Treats cues as the lever. Cues matter but sit far below success, choice and relationship, so this teacher polishes technique while students keep leaving."
   },
   {
    "label": "B",
    "text_en": "Add more class times, a cheaper trial package and weekend hours, so more people come through the door each week.",
    "text_zh": "增加课次、推出更便宜的体验套餐、再加开周末时段，让每周有更多人走进来。",
    "correct": false,
    "note": "Fixes traffic, not retention. Losses are concentrated in the first three months, so a wider entrance only brings in more people to lose."
   },
   {
    "label": "C",
    "text_en": "Make sure every student succeeds at something real, has genuine choice in the practice, and has a real relationship with you.",
    "text_zh": "确保每个学生都真的做到某件事、在练习里有真实的选择权、并且和你有真实的关系。",
    "correct": true,
    "note": "These three, genuine success, a sense of choice, and the relationship, predict whether a student improves and stays, and everything else in the lecture protects one of them."
   },
   {
    "label": "D",
    "text_en": "Teach harder material early so students can see the practice is serious and that they are getting real value.",
    "text_zh": "早一点教更难的内容，让学生看到这套练习是认真的，自己拿到了真东西。",
    "correct": false,
    "note": "Confuses difficulty with value. Advanced material early denies the beginner the genuine success that confidence is built from."
   }
  ],
  "explanationExpected_en": "Three things predict whether a student improves and stays: genuine experiences of succeeding, a real sense of choice, and the relationship with the teacher. Cues matter but they sit far below these three in the order of what actually moves a student. Dropout is also front loaded, with most of the loss happening before the third month, so the work goes into what happens to a student inside the room rather than into the size of the entrance.",
  "explanationExpected_zh": "决定学生会不会进步、会不会留下的有三件事：真实的成功经验、一定的选择权、以及与老师的关系。口令有用，但在「真正推动学生的东西」这个排序里，它远在这三件事之下。流失又集中在前期，大部分发生在第三个月之前，所以要下功夫的是学生在教室里经历了什么，而不是把入口做得更大。",
  "teacherPoint": "Diagnose a retention problem by checking success, choice and relationship before touching the cue list.",
  "id": "PSY01"
 },
 {
  "lecture": "Psychology of Learning",
  "topic": "fading-correction-dependence",
  "stem_en": "A student has practised six mornings a week for seven months. You adjust and correct him in almost every posture, every day, and his practice looks good. Then you travel for two weeks. When you return he tells you his practice fell apart while you were away and he skipped several days. What is the most likely cause, and what do you do over the next month?",
  "stem_zh": "一位学生每周练六个早上，已经练了七个月。你几乎每天在每个体式上都调整他、纠正他，他的练习看起来很好。后来你出差两周，回来后他说：你不在的时候，他的练习整个散掉了，还断了好几天。最可能的原因是什么？接下来一个月你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "He lacks discipline. Set him a written attendance target for the month, and check it with him each week when he arrives.",
    "text_zh": "他自律不够。给他定一个当月的书面出勤目标，每周他来的时候一起核对。",
    "correct": false,
    "note": "Reads a teaching artefact as a character flaw. An attendance target adds outside pressure and leaves the dependence untouched."
   },
   {
    "label": "B",
    "text_en": "Your correction rate has made him depend on you. Give fewer corrections as he improves, so he feels the postures without you.",
    "text_zh": "你纠正的频率让他的练习依赖你。他越进步，纠正就给得越少，让他没有你也能感觉到体式。",
    "correct": true,
    "note": "Guidance hypothesis. Feedback given too often creates dependence on it, so performance collapses when it is withdrawn. Fading corrections as skill grows is the fix."
   },
   {
    "label": "C",
    "text_en": "He needs more detail before the postures become reliable. Add a short daily explanation of what each correction is doing.",
    "text_zh": "他需要更多细节，体式才会稳定。每天加一小段说明，讲清楚每个纠正在做什么。",
    "correct": false,
    "note": "The commonest well meant error. More feedback deepens the very dependence that caused the collapse."
   },
   {
    "label": "D",
    "text_en": "Two weeks was simply too long a gap. Record a full practice video for the students to follow on any day you are away travelling.",
    "text_zh": "两周确实断得太久了。录一段完整的跟练视频，你出门在外的任何一天都让学生跟着练。",
    "correct": false,
    "note": "Swaps one external guide for another. He still follows instead of feeling the posture from the inside, so nothing about the dependence changes."
   }
  ],
  "explanationExpected_en": "Guidance hypothesis (Salmoni, Schmidt and Walter, 1984). Feedback given too often creates dependence on it, so performance holds up while the teacher is present and collapses the moment the feedback is removed. Frequent correction flatters the practice day and costs long term learning. The rule is not to give almost nothing but to give less as the student improves, so he learns to feel the posture from the inside. The daily Mysore method is built for exactly this fade.",
  "explanationExpected_zh": "指导假说（Salmoni、Schmidt 与 Walter，1984）。反馈给得太频繁，学习者就会依赖它：老师在的时候撑得住，反馈一撤就垮。频繁纠正让当天的练习好看，却牺牲了长期的学习效果。规则不是「几乎不给」，而是「学生越进步，给得越少」，让他学会从内部感觉体式。每天的 Mysore 方法，正是为这种逐步撤出而设计的。",
  "teacherPoint": "Deliberately cut your corrections as a student improves, and read a practice that collapses in your absence as your error, not theirs.",
  "id": "PSY02"
 },
 {
  "lecture": "Psychology of Learning",
  "topic": "task-vs-person-feedback",
  "stem_en": "A student keeps letting the front knee fall inward in Virabhadrasana. You have corrected it three times this week and you are becoming impatient. Which correction do you give?",
  "stem_zh": "一位学生在战士式里，前膝老是往里倒。这一周你已经纠正了三次，你开始有点不耐烦。你会怎么说？",
  "options": [
   {
    "label": "A",
    "text_en": "\"You always lose this one. You really need to concentrate more.\"",
    "text_zh": "「你怎么老是做不好这个，真该专心一点。」",
    "correct": false,
    "note": "Person focused criticism. It is aimed at the self rather than at the movement, and in this form it is worse than saying nothing."
   },
   {
    "label": "B",
    "text_en": "\"The students who started when you did already have this one.\"",
    "text_zh": "「跟你同期开始的那几个人，早就做到了。」",
    "correct": false,
    "note": "Turns a knee into a ranking. Comparison threatens standing in front of others and gives him nothing to do with his leg."
   },
   {
    "label": "C",
    "text_en": "\"You are so gifted, this is nothing for you. Just watch that knee.\"",
    "text_zh": "「你天赋这么好，这个对你根本不算什么。膝盖注意一点就行。」",
    "correct": false,
    "note": "Praise aimed at the self carries the same risk as criticism aimed at the self, and the correction tacked on the end is too vague to act on. Attention goes to ego and self worth instead of to the movement."
   },
   {
    "label": "D",
    "text_en": "\"The front knee goes out over the middle toe. Try it once more.\"",
    "text_zh": "「前膝往中间脚趾的方向送出去。再来一次。」",
    "correct": true,
    "note": "Task focused and immediately usable. Feedback aimed at the movement helps, and it is the only option here that tells him what to do with his leg."
   }
  ],
  "explanationExpected_en": "Feedback aimed at the task helps. Feedback that points at the person, at ego and self worth, tends to backfire. Kluger and DeNisi found the average effect of feedback on performance was positive, but over one third of feedback interventions made performance worse, and that is the half of the result a teacher must remember. Praise aimed at the self carries the same risk as criticism aimed at the self, so warm words about how gifted someone is are not a safe wrapper for a correction.",
  "explanationExpected_zh": "指向动作的反馈有帮助；指向人、指向自尊与自我价值的反馈容易适得其反。Kluger 与 DeNisi 发现，反馈对表现的平均效应是正向的，但超过三分之一的反馈干预让表现变差，而这一半才是老师必须记住的部分。指向「自我」的表扬，风险和指向「自我」的批评是一样的，所以先夸天赋再纠正，并不是一层安全的外衣。",
  "teacherPoint": "Keep every correction on the movement, and drop the sentence the moment it starts pointing at the person, praise included.",
  "id": "PSY03"
 },
 {
  "lecture": "Psychology of Learning",
  "topic": "external-focus-cue",
  "stem_en": "A beginner is wobbling badly in Utthita Hasta Padangusthasana and is starting to look anxious. You have one sentence. Which one do you use?",
  "stem_zh": "一位新学生在手抓大脚趾单腿站立式里晃得很厉害，脸上开始出现紧张。你只能说一句话，你说哪一句？",
  "options": [
   {
    "label": "A",
    "text_en": "\"Press the standing foot into the floor, and hold your eyes on one still point ahead.\"",
    "text_zh": "「站立腿的脚往地板里压下去，眼睛盯住前方一个不动的点。」",
    "correct": true,
    "note": "External focus, attention on the effect of the movement and on a point outside the body. This is one of the most replicated findings in motor learning and it matters most in balances."
   },
   {
    "label": "B",
    "text_en": "\"Contract your gluteus medius and switch on the deep stabilisers around the standing hip.\"",
    "text_zh": "「收缩臀中肌，把站立侧髋部周围的深层稳定肌启动起来。」",
    "correct": false,
    "note": "Internal focus, and it names a muscle a beginner cannot locate. Attention on the body part produces worse performance than attention on the effect."
   },
   {
    "label": "C",
    "text_en": "\"Look down at your standing foot and check that the knee is in line with it.\"",
    "text_zh": "「低头看你的站立脚，检查膝盖有没有对在它上面。」",
    "correct": false,
    "note": "Sends attention inward and removes the fixed outside point that balance depends on, so the wobble usually gets worse."
   },
   {
    "label": "D",
    "text_en": "\"Stop for a moment. Let me explain how the hip joint works, then try again.\"",
    "text_zh": "「先停一下，我把髋关节的原理讲清楚，你再试。」",
    "correct": false,
    "note": "Anatomy delivered while the student is trying to move. Keep the explanation for when you are explaining, and cue the effect when you want them to move."
   }
  ],
  "explanationExpected_en": "External focus of attention. Directing attention to the effect of a movement produces better performance and better learning than directing it to the body part producing the movement, and the difference is largest in balance postures and in hard postures under strain. \"Press the floor away\" beats \"engage your quadriceps.\" Anatomical language can stay for when you are explaining; when you want the student to move, cue the effect.",
  "explanationExpected_zh": "外部注意焦点。把注意力引向动作的效果，比引向产生动作的身体部位，表现更好、学习效果也更好，在平衡体式和吃力的难体式上差别最大。「把地板推开」优于「收紧股四头肌」。解剖学的语言可以留在「你在解释」的时候用；当你想让学生动起来，就用指向效果的口令。",
  "teacherPoint": "Rewrite your most used cues so they name the effect of the movement rather than the body part.",
  "id": "PSY04"
 },
 {
  "lecture": "Psychology of Learning",
  "topic": "blocked-repetition-beginner",
  "stem_en": "A student in her second month says the sequence is always the same, that she is getting bored, and asks you to teach her something new each day. What do you do?",
  "stem_zh": "一位练到第二个月的学生说：序列每天都一样，她觉得无聊，希望你每天教她一些新的东西。你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Add two or three new postures each week so she stays interested, because a bored student stops coming and you cannot teach someone who left.",
    "text_zh": "每周给她加两三个新体式，让她保持兴趣，因为无聊的学生会不来，而人走了你就教不到他。",
    "correct": false,
    "note": "Well meant and harmful. A beginner needs repetition, and variation added this early costs the retention the repetition was buying."
   },
   {
    "label": "B",
    "text_en": "Tell her that boredom is part of the discipline, and that this is not the kind of question a student should be asking.",
    "text_zh": "告诉她无聊本身就是修行的一部分，而这种问题学生本来就不该问。",
    "correct": false,
    "note": "Dismisses a real question. It damages the goal agreement between you, and it teaches her that asking anything carries a cost."
   },
   {
    "label": "C",
    "text_en": "Agree that the fixed sequence is a limitation of the method, apologise for it, and promise her variety once she is more advanced.",
    "text_zh": "承认固定序列确实是这个方法的局限，先向她致歉，并答应她进阶之后就会有变化。",
    "correct": false,
    "note": "Apologising teaches her the method is a compromise, and it turns variety into a reward for progress rather than a tool for the experienced."
   },
   {
    "label": "D",
    "text_en": "Keep the sequence fixed, tell her repetition is how she sees more in it each time, and give her one clear thing to work on today.",
    "text_zh": "序列不变。告诉她重复正是让她每一次都看到更多的方式，并给她今天一个具体的功课。",
    "correct": true,
    "note": "Blocked repetition is right for a beginner, and repetition as a route into understanding is a claim these students already accept from the rest of their education."
   }
  ],
  "explanationExpected_en": "Blocked, repetitive practice is the right condition for a beginner. Random variation makes a session feel harder and improves retention for experienced learners, but the effect is small or absent in beginners, and the fixed Ashtanga sequence is already supplying the repetition. Repetition is also not shallow. You repeat something in order to see more in it each time, which is something your students already accept elsewhere in how they were taught, so the fixed sequence needs no apology.",
  "explanationExpected_zh": "对新手来说，重复的区组式练习才是对的条件。打乱顺序的变化会让当堂更难，对资深学习者的保持有帮助，但这个效应在初学者身上很小甚至没有，而固定的 Ashtanga 序列已经在提供重复。重复也不等于浅：重复一件事，是为了每一次都从中看到更多；这个道理，你的学生在过去的学习经验里早就接受过，所以固定序列不需要辩解。",
  "teacherPoint": "Hold the sequence steady for a beginner, and defend the repetition instead of apologising for it.",
  "id": "PSY05"
 },
 {
  "lecture": "Psychology of Learning",
  "topic": "mastery-experience-and-model",
  "stem_en": "A student six weeks in tells you, with some feeling, that her heels will never come down in Adho Mukha Svanasana and that she is not built for this. You want to change what she believes about herself. What is most likely to work?",
  "stem_zh": "一位练了六周的学生带着情绪对你说：她的脚跟永远落不了地，她天生不适合这个。你想改变的是她对自己的这个信念。哪一种做法最可能起作用？",
  "options": [
   {
    "label": "A",
    "text_en": "Tell her sincerely, and keep telling her every morning, that she can do it and that you believe in her.",
    "text_zh": "真诚地告诉她，并且每天早上都告诉她：她做得到，你相信她。",
    "correct": false,
    "note": "Verbal persuasion is third in strength and cannot substitute for felt success. Repeated reassurance with nothing behind it starts to read as pity."
   },
   {
    "label": "B",
    "text_en": "Ask your most advanced student to demonstrate a perfect version of it, so she can see what is possible.",
    "text_zh": "请你最厉害的学生做一个完美的示范，让她看到可能性。",
    "correct": false,
    "note": "An unreachable model gives no vicarious benefit, and in a group that notices ranking it can confirm that she is at the bottom of one."
   },
   {
    "label": "C",
    "text_en": "Scale it so she truly succeeds at a version today, and have her watch a student who began where she began.",
    "text_zh": "把体式降到她今天真的能做到的版本，并让她看一位起点和她一样的同学练。",
    "correct": true,
    "note": "Mastery experience is by far the strongest source of self efficacy, and a model who started where she started is what delivers real vicarious benefit."
   },
   {
    "label": "D",
    "text_en": "Explain the anatomy of the calf and the ankle, so she understands why the heels always take so long to come down.",
    "text_zh": "给她讲小腿和踝关节的解剖，让她明白脚跟为什么总是要那么久才下得去。",
    "correct": false,
    "note": "Information is not confidence. Anatomy here can also confirm the belief that her body is the obstacle."
   }
  ],
  "explanationExpected_en": "The strongest source of self efficacy by a long way is mastery experience, actually succeeding at the thing. Second is vicarious experience, watching someone similar succeed, which means the model must be a student who began where she began rather than your best demonstrator. Verbal persuasion is third and cannot replace felt success. So scale the posture until she genuinely does a version of it, let her repeat it, and use a peer model.",
  "explanationExpected_zh": "自我效能最强的来源遥遥领先的是掌握性经验，也就是真的做到。第二是替代性经验，看到与自己相似的人做到，这意味着示范的人要是一位起点和她一样的同学，而不是你最好的示范者。言语说服排第三，代替不了「真的做到了」的感觉。所以要把体式简化到她真的能做到，让她反复做到，并用同伴当榜样。",
  "teacherPoint": "Engineer a version of the posture the student genuinely does today, and pick a demonstrator who started where they started.",
  "id": "PSY06"
 },
 {
  "lecture": "Psychology of Learning",
  "topic": "choking-explicit-monitoring",
  "stem_en": "A practitioner of eight years does Kapotasana cleanly when she thinks nobody is watching. The moment you stand beside her, or a phone camera appears in the room, she tightens, over-controls and cannot reach her feet. What do you say to her in that moment?",
  "stem_zh": "一位练了八年的学生，在她以为没人看的时候，鸽子式做得很干净。你一站到她旁边，或者房间里出现一部手机镜头，她就绷紧、过度控制，手够不到脚。这一刻你对她说什么？",
  "options": [
   {
    "label": "A",
    "text_en": "Give her the anatomical detail step by step, so she has something reliable to hold on to under pressure.",
    "text_zh": "一步一步把解剖细节给她，让她在压力下有可靠的东西可以抓住。",
    "correct": false,
    "note": "Explicit monitoring is the mechanism, so detail is the poison here. Consciously controlling a movement that had become automatic is exactly what breaks it."
   },
   {
    "label": "B",
    "text_en": "Give her one external target and the breath: hands toward the heels, one long exhale on the way back.",
    "text_zh": "给她一个外部目标和呼吸：双手伸向脚跟，往回下去时一次长长的呼气。",
    "correct": true,
    "note": "Moving attention off the self and onto an external target or the breath lets the automatic movement run. Note the reversal: a brand new student in the same spot needs concrete steps."
   },
   {
    "label": "C",
    "text_en": "Tell her to relax, and to stop thinking about the fact that you are standing there beside her mat.",
    "text_zh": "让她放松，别再去想你就站在她垫子旁边这件事。",
    "correct": false,
    "note": "Telling someone not to think about something keeps their attention on themselves, and it is phrased as something to avoid rather than something to do."
   },
   {
    "label": "D",
    "text_en": "Stop adjusting her and stay away from her mat from now on, so that she is never observed in this posture.",
    "text_zh": "从此不再调整她，也不再走到她的垫子旁，让她在这个体式里永远不被看着。",
    "correct": false,
    "note": "Avoids the situation instead of teaching her. She will meet observation again, and she has learned nothing she can use when it happens."
   }
  ],
  "explanationExpected_en": "Explicit monitoring, the self focus account of choking (Beilock and Carr, 2001). Under pressure an expert turns attention inward and consciously controls a movement that had already become automatic, which disrupts it. The instruction is an external target or the breath rhythm, and step by step anatomical detail is the worst thing you can give. A novice shows the opposite pattern, being hurt by distraction rather than by self focus, so a beginner in the same situation needs the concrete steps.",
  "explanationExpected_zh": "显性监控，也就是卡壳的自我关注解释（Beilock 与 Carr，2001）。在压力下，熟练者把注意力转向内部、有意识地去控制一个已经自动化的动作，动作就被破坏了。要给的是外部目标或呼吸的节奏，而一步步的解剖细节是你能给的最糟的东西。新手的模式正好相反，伤害他们的是分心而不是自我关注，所以同样情境下的新手需要的恰恰是具体步骤。",
  "teacherPoint": "When an experienced student tightens under observation, switch them to an external target and the breath instead of adding detail.",
  "id": "PSY07"
 },
 {
  "lecture": "Psychology of Learning",
  "topic": "expert-blind-spot-difficulty",
  "stem_en": "You are teaching Marichyasana D. It looks like such a simple posture to you, you show every new student twice, they still cannot find the bind, and you have started to think they are not paying attention. What is actually going on, and what do you do?",
  "stem_zh": "你在教 Marichyasana D。这个体式在你看来很简单，每个新学生你都示范两遍，他们还是找不到扣手，你开始觉得是他们不专心。实际发生了什么？你该怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Your sense that it is simple is about you, not about them. Double your estimate for beginners, and ask one what was hardest today.",
    "text_zh": "你觉得它简单，这是关于你的信息，不是关于他们的。把新手所需时间的估计乘以二，再去问一个新学生今天最难的是什么。",
    "correct": true,
    "note": "The curse of knowledge and the expert blind spot. Experts underestimate beginner difficulty by roughly a factor of two, the more expert the teacher the worse the estimate, and the only reliable correction is to watch and ask rather than to trust the intuition."
   },
   {
    "label": "B",
    "text_en": "The students are not concentrating. Repeat the demonstration slowly until every one of them can follow it exactly.",
    "text_zh": "学生就是不专心。把示范放慢重复，直到每个人都能完全跟上。",
    "correct": false,
    "note": "Accepts your own diagnosis and puts the fault on the learner. Repeating a demonstration also tells you nothing about which part the beginner is actually stuck on."
   },
   {
    "label": "C",
    "text_en": "The difficulty must come from missing information, so give the full shoulder and spine breakdown before the student tries.",
    "text_zh": "困难一定来自信息不足，所以在学生尝试之前，把肩和脊柱的原理完整讲一遍。",
    "correct": false,
    "note": "Loads a beginner's working memory with six things when they can hold one or two, and it is still your expert view of what matters rather than what the student found hard."
   },
   {
    "label": "D",
    "text_en": "A beginner who cannot follow a clear demonstration is not ready for the posture. Take it out and bring it back again in a few months.",
    "text_zh": "跟不上清楚示范的新手，就是还不适合这个体式。先把它拿掉，过几个月再重新给。",
    "correct": false,
    "note": "Reads slowness as unreadiness and removes the genuine success the student could have had today in a scaled version."
   }
  ],
  "explanationExpected_en": "The curse of knowledge, also called the expert blind spot. Experts systematically underestimate how difficult a task is for a beginner, with novices taking roughly twice as long as the expert predicted, and the more expert the predictor the worse the prediction. Advanced subject knowledge makes the judgement worse rather than better, and attempts to train the bias away did not fix it. So a teacher's feeling that a posture is simple is not evidence about her student. Double the estimate, then verify by watching and by asking a beginner what was hardest today, because the answer is usually something the teacher no longer notices herself doing.",
  "explanationExpected_zh": "知识的诅咒，也叫专家盲点。专家会系统性地低估一项任务对新手的难度，新手实际花的时间大约是专家预测的两倍，而且预测者越专业，预测越差。学科知识越高深，判断反而越不准，尝试用训练消除这个偏差也没有成功。所以老师觉得某个体式简单，这不是关于学生的证据。把估计乘以二，然后靠观察和提问去核实：问一个新学生今天最难的是什么，因为答案往往是老师自己早已不再注意到的动作。",
  "teacherPoint": "Treat your own sense that something is easy as unreliable: double your estimate of beginner difficulty, then ask the beginner what was hardest today.",
  "id": "PSY08"
 },
 {
  "lecture": "Psychology of Learning",
  "topic": "missed-day-habit",
  "stem_en": "A student in his tenth week misses Wednesday because of a work dinner. On Thursday he messages you saying the streak is broken, that he has to start from zero, and that perhaps he is not the kind of person who can keep something like this up. What do you reply?",
  "stem_zh": "一位练到第十周的学生，因为工作聚餐漏了周三。周四他发消息说：连续记录断了，他要从零开始，也许他本来就不是能坚持这种事的人。你怎么回？",
  "options": [
   {
    "label": "A",
    "text_en": "Agree that the streak is broken, and set him a fresh twenty-one day run so that he can rebuild the habit from a clean start.",
    "text_zh": "同意连续记录确实断了，重新给他定一个二十一天的周期，让他从干净的起点重新建立习惯。",
    "correct": false,
    "note": "Repeats a claim with no research behind it and confirms his belief that something was reset. Students who expect three weeks tend to quit in week four feeling defective."
   },
   {
    "label": "B",
    "text_en": "Tell him to add an extra practice on Sunday, so the missed day is made up and the week comes out complete.",
    "text_zh": "让他周日补练一次，把漏掉的那天补回来，这一周就完整了。",
    "correct": false,
    "note": "Turns practice into a debt to be repaid, and confirms that something was lost when nothing measurable was lost."
   },
   {
    "label": "C",
    "text_en": "Tell him nothing measurable changed, that feeling automatic takes two to three months, and to practise tomorrow.",
    "text_zh": "告诉他没有任何可测量的东西改变了，那种自动化的感觉要两到三个月才会有，明天照常来练。",
    "correct": true,
    "note": "Both halves of the habit finding, delivered as reassurance he can act on: the timeline is longer than he thinks, and a single missed opportunity does not reset anything."
   },
   {
    "label": "D",
    "text_en": "Tell him not to worry, that motivation naturally comes and goes, and that he should come back when he feels ready again.",
    "text_zh": "告诉他别担心，动力本来就有起有落，等他想练了再回来。",
    "correct": false,
    "note": "Warm but permissive. Waiting to feel ready removes the habit structure at exactly the point in the first months when dropout is highest."
   }
  ],
  "explanationExpected_en": "Lally and colleagues (2010) followed people forming a daily behaviour and found the time to reach 95% of maximum automaticity had a median of about 66 days, with a very wide range. The more useful finding for teaching is the second one: missing a single opportunity did not materially affect habit formation. The automaticity score dipped a little and recovered quickly, so nothing resets. The twenty-one day figure comes from a 1960 book by a plastic surgeon describing patients adjusting to a changed face, not from habit research, and a student who expects three weeks quits in week four believing something is wrong with him.",
  "explanationExpected_zh": "Lally 等人（2010）追踪养成每日行为的人，发现达到最大自动化程度 95% 所需时间的中位数约为 66 天，范围极大。对教学更有用的是第二个发现：漏掉一次执行机会，并不会实质影响习惯养成，自动化分数只小幅下降，而且很快恢复，什么都不会清零。「二十一天」出自 1960 年一位整形外科医生的书，描述的是病人适应改变后的面容，不是关于习惯的研究；以为三周就够的学生，到第四周会觉得自己有问题而放弃。",
  "teacherPoint": "Tell every new student, inside the first fortnight, that automaticity takes two to three months and that one missed day changes nothing.",
  "id": "PSY09"
 },
 {
  "lecture": "Psychology of Learning",
  "topic": "rewards-vs-identity",
  "stem_en": "Your shala is quiet in the low season. Your assistant proposes a sixty day attendance challenge: a wall chart with everyone's name on it, a stamp for each practice, and a free month for whoever attends most. What do you do?",
  "stem_zh": "淡季教室很冷清。你的助理提议做一个六十天出勤挑战：墙上挂一张写着所有人名字的表，每练一次盖一个章，出勤最多的人送一个月免费。你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Run it. Attendance is exactly the behaviour you want, so rewarding it directly is the fastest way to raise the numbers.",
    "text_zh": "就这么做。出勤正是你想要的行为，直接奖励它是把数字拉起来最快的办法。",
    "correct": false,
    "note": "Rewarding a behaviour people already enjoy reduces their own reason for doing it, and a named wall chart creates a public ranking."
   },
   {
    "label": "B",
    "text_en": "Decline the chart and the prize. Build what marks a practitioner here: every name known, a fixed spot, asked about last week.",
    "text_zh": "不要这张表，也不要这个奖品。去建立那些让人成为「这里的练习者」的标志：叫得出每个人的名字、有固定的位置、被问起上周。",
    "correct": true,
    "note": "Identity is built from small ordinary signals of belonging, and keeping external rewards out protects the intrinsic motivation that predicts long adherence."
   },
   {
    "label": "C",
    "text_en": "Run it, but give the same prize to everyone who reaches forty practices, so that nobody is ranked against anybody else.",
    "text_zh": "照做，但凡是完成四十次的人都拿同样的奖品，这样谁也不会被排名。",
    "correct": false,
    "note": "Removing the ranking does not remove the reward. The practice still becomes a thing done for a prize, which is where the damage to intrinsic motivation happens."
   },
   {
    "label": "D",
    "text_en": "Replace it with a monthly award for the most improved student, announced to the whole room at the end of the Friday led class.",
    "text_zh": "改成每月评选一位进步最大的学生，在周五带领课结束时当着全场公布。",
    "correct": false,
    "note": "Public individual praise creates the sense of a ranking, pushes the students below the line toward quitting, and exposes the person praised."
   }
  ],
  "explanationExpected_en": "Rewarding with external incentives a behaviour that someone already enjoys reduces their intrinsic motivation for it, and intrinsic motivation, doing it because you enjoy the practice, is what predicts long term adherence. A named wall chart also creates a public ranking, which is uncomfortable in a group that values harmony and pushes the students at the bottom toward leaving. What actually keeps people is the move from \"I am trying yoga\" to \"I am a practitioner,\" and that is made of small ordinary signals: being known by name, having a fixed spot, being asked about last week, and being told in advance that hard weeks are normal.",
  "explanationExpected_zh": "对一个人本来就喜欢的行为施加外部奖励，会削弱他的内在动机；而内在动机，也就是「因为喜欢练习本身而练」，才是预测长期坚持的东西。挂名字的墙表还制造了公开排名，这在重视和谐的群体里让人不适，也会把排在后面的学生推向离开。真正留住人的，是从「我在尝试瑜伽」到「我是一个练习者」的转变，而它由细小平常的信号构成：被叫得出名字、有固定的位置、被问起上周，以及事先被告知难熬的几周是正常的。",
  "teacherPoint": "Grow the room with belonging signals rather than prizes, charts and public praise.",
  "id": "PSY10"
 },
 {
  "lecture": "Psychology of Learning",
  "topic": "desirable-difficulty-retrieval",
  "stem_en": "Your Mysore students tell you the Friday led class feels better organised and more enjoyable than their own morning practice, and several ask you to run led classes three times a week instead. What is the right reading of this?",
  "stem_zh": "你的 Mysore 学生说，周五的带领课比他们自己的早上练习更有条理、也更愉快，好几个人希望你改成一周开三次带领课。正确的解读是什么？",
  "options": [
   {
    "label": "A",
    "text_en": "Comfort and learning are different measurements. Producing the sequence from memory is what makes it stay, so Mysore remains the core.",
    "text_zh": "舒服和学会是两种不同的测量。凭记忆做出序列才是让它留下来的东西，所以 Mysore 仍然是核心。",
    "correct": true,
    "note": "Retrieval practice is why the Mysore room outperforms a led class for retention even though led feels more organised on the day. This is a desirable difficulty."
   },
   {
    "label": "B",
    "text_en": "Enjoyment is the best available measure of teaching quality, so follow the feedback and add the three led classes a week they are asking for.",
    "text_zh": "愉快程度是衡量教学质量最好的指标，就按他们的反馈，每周加开他们要求的三次带领课。",
    "correct": false,
    "note": "Enjoyment and learning are different measurements and can point in opposite directions on the day. A well liked class is not evidence that learning happened."
   },
   {
    "label": "C",
    "text_en": "They find it easier, which means they are not ready for Mysore yet and should go back to led practice for a few months.",
    "text_zh": "他们觉得带领课容易，说明他们还不适合 Mysore，应该先回到带领课练几个月。",
    "correct": false,
    "note": "Reads difficulty as unreadiness. It removes practice from memory from precisely the students whose retention depends on it."
   },
   {
    "label": "D",
    "text_en": "A student who enjoys the class is a student who keeps paying, so add the led classes and make the Mysore room optional.",
    "text_zh": "喜欢这堂课的学生才会继续付费，所以加开带领课，Mysore 改成可选。",
    "correct": false,
    "note": "Short term commercial logic that quietly removes the thing making them better, and long adherence comes from the practice being theirs, not from comfort."
   }
  ],
  "explanationExpected_en": "A smooth, comfortable, well liked class is not evidence that learning happened. Bjork's principle of desirable difficulties says conditions that make practice feel harder and slower during the session often produce better long term learning. Producing the sequence from memory is retrieval practice, and it is the reason the Mysore room retains better than a led class even though the led class feels more organised. Enjoyment and durable learning are two different measurements and on any given day they can point in opposite directions.",
  "explanationExpected_zh": "一堂顺畅、舒服、大家都喜欢的课，并不构成「学习发生了」的证据。Bjork 的合意难度原则是说：那些让练习在当堂显得更难、更慢的条件，往往带来更好的长期学习效果。凭记忆做出序列就是提取练习，也正是 Mysore 教室在保持效果上胜过带领课的原因，尽管带领课看起来更有条理。享受程度和牢固的学习是两种不同的测量，在某一天可能指向相反的方向。",
  "teacherPoint": "Protect practice from memory as the core of the room, even when students say the led class feels better.",
  "id": "PSY11"
 },
 {
  "lecture": "Psychology of Learning",
  "topic": "working-alliance-goal-agreement",
  "stem_en": "A student has come four mornings a week for two years. You like each other, you talk before practice, and she has never raised a problem with you. Last month she stopped coming and did not answer your message. What was most likely missing, and what do you change with your other long-term students?",
  "stem_zh": "一位学生两年来每周来四个早上。你们关系不错，练习前会聊两句，她也从来没有对你提过任何问题。上个月她不再出现，你发的消息她也没有回。最可能缺的是什么？对你其他的老学生，你要改变什么？",
  "options": [
   {
    "label": "A",
    "text_en": "The personal bond, which must have been weaker than you believed it was. Spend more time talking with each long-term student before practice.",
    "text_zh": "缺的是人与人之间的联结，它一定比你以为的要弱。以后练习前多和每一位老学生聊一会儿。",
    "correct": false,
    "note": "Treats the alliance as being made of warmth. The bond was the part you had, and more of it would never have surfaced the disagreement."
   },
   {
    "label": "B",
    "text_en": "Nothing was missing. Students naturally move on after two years, so change nothing about how you teach the ones who stay.",
    "text_zh": "什么都不缺。练了两年的学生自然会离开，所以对留下来的人，教法什么都不用改。",
    "correct": false,
    "note": "Fatalism removes the one predictor you can act on, and it guarantees the same loss with the next long term student."
   },
   {
    "label": "C",
    "text_en": "Her motivation. Encourage each long-term student more, and give them more of your attention in class every morning.",
    "text_zh": "缺的是她的动机。以后多鼓励每一位老学生，每天早上在课上多关注他们一些。",
    "correct": false,
    "note": "More attention raises dependence in an experienced student, and it still never asks the question that would have found the problem."
   },
   {
    "label": "D",
    "text_en": "Agreement on the goal and on the method. Ask each regular student what they practise toward, and whether the method still convinces them.",
    "text_zh": "缺的是目标共识和方法共识。去问每一位常来的学生：你朝着什么在练？这个方法你现在还认同吗？",
    "correct": true,
    "note": "The working alliance is goal agreement, task agreement and bond. A student practising toward a goal you never discussed, with a method she privately doubts, leaves without telling you why, and only the question surfaces it."
   }
  ],
  "explanationExpected_en": "The working alliance has three parts: agreement on the goal, agreement on the tasks used to reach it, and the personal bond. It is one of the most consistent predictors of outcome in the therapy literature, and the three part definition is what transfers safely to teaching. The personal bond alone is not the alliance. A student quietly practising toward a goal you have never discussed, using a method she privately doubts, is a student who leaves without telling you why. Ten minutes of conversation about goals and methods is worth more than a month of better adjustments, and if a regular student's answer surprises you, you have a goal agreement problem rather than a technique problem.",
  "explanationExpected_zh": "工作同盟由三部分组成：对目标的共识、对达成目标所用方法的共识，以及人与人之间的联结。在心理治疗文献里，它是最稳定的结果预测因素之一，而能安全迁移到教学里的正是这个三部分定义。光有亲近还不是工作同盟。一个心里朝着你从未谈过的目标在练、又私下怀疑你方法的学生，会在某天离开，而且不会告诉你原因。关于目标和方法的十分钟谈话，比一个月更好的调整更有价值；如果常来的学生给出的答案让你意外，那你面对的是目标共识的问题，不是技术问题。",
  "teacherPoint": "Ask every regular student once a month what they are practising toward, and treat a surprising answer as a goal agreement problem rather than a technique problem.",
  "id": "PSY12"
 },
 {
  "lecture": "Psychology of Learning",
  "topic": "prospect-ambivalence-reactance",
  "stem_en": "A prospect messages you: \"I really want to start, but I am not sure I have the time.\" What do you do next?",
  "stem_zh": "一位潜在学员给你发消息：「我很想开始，但我不确定有没有时间。」你接下来做什么？",
  "options": [
   {
    "label": "A",
    "text_en": "Ask what makes her want to start, listen, and say her own reasons back in her words before mentioning times or prices.",
    "text_zh": "问她是什么让她想开始，听她说，用她自己的话把她的理由说回给她，之后再谈时间和价格。",
    "correct": true,
    "note": "Ask, listen, reflect. A person who has said their own reasons out loud starts differently from a person who has been convinced."
   },
   {
    "label": "B",
    "text_en": "Answer the objection directly. Send the timetable and show her that a forty-five minute practice fits before work.",
    "text_zh": "直接回应这个顾虑：把课表发过去，说明四十五分钟的练习上班前完全放得下。",
    "correct": false,
    "note": "Counters the objection while she is still ambivalent, and moves to the timetable before she has said her own reasons, which ends the conversation early."
   },
   {
    "label": "C",
    "text_en": "Tell her that everybody is busy, and that the people who succeed at this are the ones who decide.",
    "text_zh": "告诉她大家都忙，能练成的人，是那些做了决定的人。",
    "correct": false,
    "note": "Pressure plus a judgement about her character. Threatened choice produces pushback, and she will value the option less than she did before you wrote."
   },
   {
    "label": "D",
    "text_en": "Offer a discount that expires at the end of this week, so that she has a concrete reason to decide now rather than later.",
    "text_zh": "给她一个本周末到期的折扣，让她有一个具体的理由现在就决定，而不是拖着。",
    "correct": false,
    "note": "Urgency and price threaten her sense of choice, and a discount buys the decision at the cost of the commitment behind it."
   }
  ],
  "explanationExpected_en": "Ask open questions about what draws her to practice, listen, reflect her own reasons back in her own words, ask permission before advising, and say plainly that the decision is hers. Behind this sits psychological reactance (Brehm, 1966): when people feel their freedom to choose is threatened they push back and value the threatened option less than before, which is why pressure on a hesitant prospect produces the opposite of what you wanted. Motivational interviewing outperforms plain advice giving across a wide range of behaviours. If she voices real ambivalence, stay in the conversation instead of moving to schedules and prices.",
  "explanationExpected_zh": "用开放式问题问她是什么让她想练，听，用她自己的话把她的理由反映回去，给建议之前先征求同意，并平实地说这个决定由她自己做。背后是心理逆反（Brehm，1966）：当人感到选择自由受到威胁，会反推回去，并且比之前更不看好那个被推销的选项，所以对犹豫的人施压，得到的是相反的结果。在广泛的行为问题上，动机性访谈优于单纯给建议。如果她表达了真实的犹豫，就留在谈话里，而不要转去讲课表和价格。",
  "teacherPoint": "Reply to a hesitant prospect with a question, and stay in the conversation until they have said their own reasons out loud.",
  "id": "PSY13"
 },
 {
  "lecture": "Psychology of Learning",
  "topic": "approach-vs-avoidance-goal",
  "stem_en": "A student is about to attempt dropping back to the floor for the first time and she looks frightened. Which instruction do you give as she goes?",
  "stem_zh": "一位学生第一次尝试站立后弯落地（drop back），看起来很害怕。她往下走的时候，你给哪一句指令？",
  "options": [
   {
    "label": "A",
    "text_en": "\"Don't fall, and don't let your arms give way on the way down.\"",
    "text_zh": "「别摔，下去的时候手臂也别塌。」",
    "correct": false,
    "note": "An avoidance goal. It names the things to prevent, which makes them more likely, and it gives her nothing to actually do."
   },
   {
    "label": "B",
    "text_en": "\"Try not to be frightened, and try not to rush it on the way down.\"",
    "text_zh": "「别害怕，下去的时候也别着急。」",
    "correct": false,
    "note": "Still avoidance, now aimed at her feelings. It puts her attention on the fear rather than on the movement she is making."
   },
   {
    "label": "C",
    "text_en": "\"You need do nothing at all. I have you completely, I will lower you down.\"",
    "text_zh": "「你什么都不用做，我完全托着你，我把你放下去。」",
    "correct": false,
    "note": "Well meant, but taking all the load removes the genuine success this attempt could have produced, and it starts the dependence early."
   },
   {
    "label": "D",
    "text_en": "\"Reach your chest toward the wall behind you, and keep the breath even.\"",
    "text_zh": "「胸口伸向身后那面墙，呼吸保持均匀。」",
    "correct": true,
    "note": "An approach goal aimed at the process, phrased as something to move toward, which supports persistence and lowers anxiety."
   }
  ],
  "explanationExpected_en": "Approach goals, framed as moving toward something, support persistence and positive feeling. Avoidance goals, framed as not failing or not looking bad, produce anxiety and worse outcomes, and \"do not fall\" makes falling more likely. Process goals aimed at executing the movement support performance and lower anxiety better than pure outcome goals. \"Reach your chest toward the wall behind you\" is approach, it is a process goal, and it points attention outward, which is why it does three useful things at once.",
  "explanationExpected_zh": "趋近目标，也就是朝着某个东西前进的表述，支持坚持和积极情绪。回避目标，也就是「不要失败」「不要难看」的表述，带来焦虑和更差的结果，而「别摔」会让摔更容易发生。聚焦于把动作做出来的过程目标，比纯粹的结果目标更能支持表现、降低焦虑。「胸口伸向身后那面墙」是趋近的、过程的，注意力又是朝外的，所以一句话同时做对了三件事。",
  "teacherPoint": "Count how many of your cues begin with \"do not\" and convert each one into something to move toward.",
  "id": "PSY14"
 },
 {
  "lecture": "Psychology of Learning",
  "topic": "face-and-public-correction",
  "stem_en": "In a full Mysore room you stop a new student, name his mistake out loud so that others can learn from it, and ask whether he understands. He nods and says nothing. For the next two weeks he practises at the back and asks you nothing. What happened, and what do you do differently?",
  "stem_zh": "在一间满员的 Mysore 教室里，你叫停一位新学生，把他的错误当众说出来，好让其他人也学到，然后问他听懂了吗。他点了点头，什么也没说。接下来两周，他练在最后一排，什么都不问你。发生了什么？下一次你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "He did not follow your English. Next time give the same correction more slowly and in more detail so that the whole room can follow it.",
    "text_zh": "他没听懂你的英文。下次同样的纠正说得更慢、更详细，让全场都能跟上。",
    "correct": false,
    "note": "Reads silence as a language gap. Repeating the correction publicly and at greater length extends the exposure that made him withdraw."
   },
   {
    "label": "B",
    "text_en": "He disagreed with the correction. Next time ask him to say in front of the group whether he accepts it, so it is settled openly.",
    "text_zh": "他不同意这个纠正。下次当着大家的面请他说说自己接不接受，把话讲开。",
    "correct": false,
    "note": "Asks him to discuss his own difficulty in front of peers, which is exactly the cost he was trying to avoid."
   },
   {
    "label": "C",
    "text_en": "Public correction cost him face. Correct him privately, normalise the difficulty for the group, and give him a minute after class.",
    "text_zh": "当众纠正让他失了面子。以后私下纠正，在团体层面把这个困难正常化，并在课后给他一分钟。",
    "correct": true,
    "note": "Public correction carries a real social cost. Private correction plus group level normalising keeps the information flowing and leaves no individual carrying the difficulty alone."
   },
   {
    "label": "D",
    "text_en": "He is simply a quiet person and it will pass by itself. Give him time, and change nothing about the way you correct.",
    "text_zh": "他本来就是安静的人，过一阵自然就好。给他时间，纠正的方式什么都不用改。",
    "correct": false,
    "note": "Treats silence as personality. Waiting loses you the information about where he is struggling, which is the information you need to build his success."
   }
  ],
  "explanationExpected_en": "Mianzi. Being corrected in front of others carries a real social cost, and staying quiet rather than admitting difficulty is how someone protects it, most strongly in front of peers. His nod was neither agreement nor comprehension. Once he is protecting face he stops telling you he is struggling, so you lose the information you need to engineer his success and the goal agreement the alliance depends on. Correct privately, which the one to one Mysore structure suits well, normalise the difficulty at the level of the whole group so no individual is the one who cannot do it, and build a low risk way for him to ask.",
  "explanationExpected_zh": "面子。当众被纠正带有真实的社会代价，保持安静、不承认困难，正是保护面子的方式，在同伴面前尤其明显。他那一点头，既不是同意，也不是听懂了。一旦他开始保护面子，就不会再告诉你他有困难，于是你失去了设计他成功所需要的信息，也失去了工作同盟所依赖的目标共识。要私下纠正，Mysore 一对一的结构正适合这一点；在整个团体的层面把困难正常化，让没有哪一个人成为「那个做不到的人」；并建立一个低风险的提问渠道。",
  "teacherPoint": "Default to private correction, and normalise the hard posture at the level of the whole group so no single student carries it.",
  "id": "PSY15"
 },
 {
  "lecture": "Hormones",
  "topic": "hormones-not-the-goal",
  "stem_en": "A prospective student messages you on WeChat: \"I read a post saying Ashtanga raises testosterone and lowers cortisol. Is that why people practise? Those are the effects I want.\" She has never practised. What is the best reply?",
  "stem_zh": "一位从未练过的准学生在微信上问你：「我看到一篇帖子说阿斯汤加能提高睾酮、降低皮质醇。大家是为了这个来练的吗？我想要的就是这些效果。」你最好怎么回？",
  "options": [
   {
    "label": "A",
    "text_en": "Agree that the hormone shifts are the reason people practise, and promise her she will feel them within a few weeks.",
    "text_zh": "同意她说的，激素变化就是大家练习的真正原因，并向她保证几个星期之内她就会感觉到。",
    "correct": false,
    "note": "Wrong. It sells a chemical outcome on a deadline. She will judge every practice against a feeling she cannot verify, and since practice actually raises cortisol, her first hard morning reads as failure."
   },
   {
    "label": "B",
    "text_en": "Say nothing about the hormones, since the science is complicated, and just invite her to come and feel it herself.",
    "text_zh": "不谈激素，因为这些科学问题太复杂，只邀请她先来练练看，自己去感受。",
    "correct": false,
    "note": "Wrong. The invitation is fine, the silence is not. She arrives still expecting the practice to lower her cortisol, so her first hard morning reads as failure. One clear true sentence costs you nothing."
   },
   {
    "label": "C",
    "text_en": "Tell her practice raises cortisol on purpose and the gain comes as it falls, then name what steady months give her.",
    "text_zh": "告诉她练习本来就要推高皮质醇，好处在它回落时才来，再说清稳定几个月能给她什么。",
    "correct": true,
    "note": "Correct. It is honest about the chemistry, it corrects the popular claim without arguing, and it moves the goal from a hormone to the thing that actually holds a student: coming back at the same hour."
   },
   {
    "label": "D",
    "text_en": "Confirm it, and add that cold showers and daily fasting will push the hormone effects higher still.",
    "text_zh": "肯定她的说法，并补充说配合冷水澡和每日禁食，可以把激素效果推得更高。",
    "correct": false,
    "note": "Wrong. Stacking unproven claims turns the teacher into a wellness seller. The first claim she checks and finds shaky costs you every other claim you make."
   }
  ],
  "explanationExpected_en": "The reply has to be honest about the chemistry and then move the goal. Practice raises cortisol acutely, and the benefit comes from the fall afterwards, so \"lowers cortisol\" is not a promise to make. Hormones are part of the process, the weather inside the work, not the prize at the end. A student who practises in order to obtain a chemical state has made the practice a transaction, and the state does not arrive on those terms. Say what the practice actually delivers over months: consistency, steadiness, the willingness to return without needing motivation first.",
  "explanationExpected_zh": "回答必须在化学上诚实，然后把目标挪回正确的位置。练习会让皮质醇急性上升，好处来自随后的下降，所以不能承诺「降低皮质醇」。激素是过程的一部分，是工作内部的天气，不是末尾的奖品。为了获得某种化学状态而练习的学生，已经把练习变成了交易，而那个状态不会以这种方式到来。要说出练习真正能给的东西：持续性、稳定、不需要先有动力也愿意明天再来。",
  "teacherPoint": "Answer a hormone question truthfully in one sentence, then move the conversation to the daily hour, which is what actually keeps a student.",
  "id": "HOR01"
 },
 {
  "lecture": "Hormones",
  "topic": "food-mood-honest-claim",
  "stem_en": "A student who has felt flat and unmotivated for the last two weeks asks you: \"Serotonin comes from food, right? Should I eat more tofu and eggs so I feel better?\"",
  "stem_zh": "一位最近两周情绪低落、提不起劲的学生问你：「血清素不是从食物来的吗？我多吃点豆腐和鸡蛋，是不是就会好一点？」",
  "options": [
   {
    "label": "A",
    "text_en": "Tell her food is raw material only, most of that serotonin never reaches the brain, then look at her sleep and rhythm.",
    "text_zh": "告诉她食物只是原料，大部分血清素到不了大脑，然后去看她的睡眠和作息。",
    "correct": true,
    "note": "Correct. It concedes the exact limit of the claim, keeps the useful half (tryptophan really is necessary raw material), and points at the lever that does move serotonin, which is rhythm."
   },
   {
    "label": "B",
    "text_en": "Tell her yes. Tryptophan foods raise serotonin, so changing her diet is the fastest way to lift her mood.",
    "text_zh": "告诉她可以。富含色氨酸的食物能提高血清素，改饮食就是让她心情变好最快的办法。",
    "correct": false,
    "note": "Wrong. This sells food as a switch. When her mood does not lift she concludes she failed at that too, and a teacher who oversells one claim loses credit on all the others."
   },
   {
    "label": "C",
    "text_en": "Tell her food is irrelevant, and that the answer is more practice, six mornings a week instead of four.",
    "text_zh": "告诉她饮食跟这个无关，答案是加大练习量，从每周四个早晨加到六个早晨。",
    "correct": false,
    "note": "Wrong on both halves. It dismisses a reasonable question and prescribes more load to someone already flat, which is the classic well-meaning harm."
   },
   {
    "label": "D",
    "text_en": "Tell her that mood and body chemistry are not really a yoga teacher's business, and steer the conversation somewhere else.",
    "text_zh": "告诉她情绪和身体化学不是瑜伽老师该管的事，然后把话题带到别的地方去。",
    "correct": false,
    "note": "Wrong execution of a right instinct. Knowing your limits does not mean refusing the question. If you say nothing, the internet answers her instead, and usually badly."
   }
  ],
  "explanationExpected_en": "Roughly 90 to 95% of the body's serotonin sits in the gut, and gut serotonin does not cross into the brain. Tryptophan is an essential amino acid, so it must come from food, but it is raw material, not a switch. The honest claim is always \"the raw material,\" never \"eat this and feel happy.\" What actually raises serotonin is rhythm, repetition and steady progress, so the practical answer is sleep and a fixed practice hour. If the low mood persists, it is beyond a teacher's scope and she should see a doctor.",
  "explanationExpected_zh": "人体大约 90% 到 95% 的血清素在肠道，而肠道的血清素不会进入大脑。色氨酸是必需氨基酸，必须从食物摄取，但它是原料，不是开关。诚实的说法永远是「原料」，绝不是「吃这个就开心」。真正让血清素升起的是节奏、重复和稳定的进展，所以实际的答案是睡眠和固定的练习时间。如果低落持续下去，那已经超出老师的范围，应该建议她去看医生。",
  "teacherPoint": "Answer food and mood questions with the words \"raw material\" and never with a promise, and know the point at which you refer the student on.",
  "id": "HOR02"
 },
 {
  "lecture": "Hormones",
  "topic": "post-backbend-high-duration",
  "stem_en": "A student says: \"After backbends I feel tall and powerful all morning, and by the evening it is completely gone. Am I doing something wrong?\"",
  "stem_zh": "一位学生说：「后弯之后，我整个上午都觉得又高又有力量，可是到了晚上就完全没有了。是我哪里做错了吗？」",
  "options": [
   {
    "label": "A",
    "text_en": "Tell her the feeling is a testosterone surge from the backbends, and that a second set in the evening will hold onto it.",
    "text_zh": "告诉她那是后弯带来的睾酮飙升，晚上再练一组后弯，就能把这个状态一直保留住。",
    "correct": false,
    "note": "Wrong. It over-claims the hormone and then prescribes load at the worst hour, costing her the sleep in which the repair actually happens."
   },
   {
    "label": "B",
    "text_en": "Tell her the feeling is mostly psychological, and that what she notices afterwards is not worth much attention.",
    "text_zh": "告诉她那多半是心理作用，练完之后自己的感觉不需要太放在心上。",
    "correct": false,
    "note": "Wrong. The feeling is real and so is the mechanism. Dismiss it and she stops reporting sensation to you, which is the information you teach from."
   },
   {
    "label": "C",
    "text_en": "Tell her it fades because she is not working hard enough, and that a full Intermediate practice would sustain it.",
    "text_zh": "告诉她效果消失是因为她练得还不够，练完整的中级序列就能维持住。",
    "correct": false,
    "note": "Wrong. It blames normal physiology on insufficient effort and pushes her toward volume in order to hold a feeling that was always going to fade."
   },
   {
    "label": "D",
    "text_en": "Tell her nothing is wrong. The rise is real but short, the building is local over days, so eat and sleep well tonight.",
    "text_zh": "告诉她没做错。上升真实但很短，建造在几天里由局部完成，所以今晚吃好睡好。",
    "correct": true,
    "note": "Correct. It gives both halves, the mechanism is real and the duration is small, and it converts the answer into an instruction she can act on tonight."
   }
  ],
  "explanationExpected_en": "The rise in testosterone and growth hormone is real and can be several times baseline, but it lasts on the order of fifteen to thirty minutes, and it is not what builds the tissue. Studies that measured both the spike and the eventual growth found no relationship between them. Muscle growth is driven mostly locally, by mechanical tension in the tissue and the signalling that follows it, over the days after practice. So the honest answer says both halves and then gives the useful instruction: food and sleep tonight, because that is when the repair happens.",
  "explanationExpected_zh": "睾酮与生长激素的上升是真的，幅度甚至可以达到基线的数倍，但它只持续大约十五到三十分钟，而且它不是组织生长的原因。同时测量激素峰值与最终增长的研究发现两者之间没有关系。肌肉的生长主要在局部，靠组织本身的机械张力以及随之而来的信号，发生在练习之后的几天里。所以诚实的回答要讲两半，然后给出有用的指令：今晚好好吃、好好睡，修复是在那时发生的。",
  "teacherPoint": "Give both halves of the answer, the mechanism is real and the duration is short, then turn it into an instruction about tonight's food and sleep.",
  "id": "HOR03"
 },
 {
  "lecture": "Hormones",
  "topic": "conceding-a-limit-precisely",
  "stem_en": "You are teaching this hormone material to your own students. One of them works in medicine and says in front of the whole room: \"That list is too neat. Dopamine is not only focus, cortisol is not only stress, and no hormone has one job.\" She is right. What do you do?",
  "stem_zh": "你在自己的练习室给学生讲这堂激素课。一位在医疗行业工作的学生当着全场说：「这份清单太整齐了。多巴胺不只管专注，皮质醇不只管压力，没有一种激素只有一个职责。」她说得对。你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Hold your ground, tell the room the four pairings are established physiology, then move on before confidence drains.",
    "text_zh": "坚持你的说法，告诉全场这四组配对是公认的生理学，然后赶紧往下讲，别让信心流失。",
    "correct": false,
    "note": "Wrong. This is bluffing. The one person in the room who can check you knows it, and everyone else can see it. Precise concession raises authority, bluffing ends it."
   },
   {
    "label": "B",
    "text_en": "Agree at once and precisely: the pairings are memory hooks, the real pathways overlap, then keep the useful half.",
    "text_zh": "立刻准确地承认：这四组配对是记忆挂钩，真实通路大量重叠，然后保留有用的一半。",
    "correct": true,
    "note": "Correct. Conceding the exact limit and keeping the useful part is what authority is actually made of, and it shows the room how to handle their own students one day."
   },
   {
    "label": "C",
    "text_en": "Drop the whole framework, and tell the room that hormone science is too unreliable to be worth teaching.",
    "text_zh": "干脆放弃整个框架，告诉全场激素这部分科学太不可靠，根本不值得教。",
    "correct": false,
    "note": "Wrong, and over-corrected. One accurate limit does not make the material worthless, and now your students have nothing at all to answer a question with."
   },
   {
    "label": "D",
    "text_en": "Tell her this is scientific detail, a yoga room is not the place for it, then carry on with your notes.",
    "text_zh": "告诉她这属于科学细节，瑜伽教室不是讨论它的地方，然后继续讲你的内容。",
    "correct": false,
    "note": "Wrong. It uses your position to close a good question. She stops asking, everyone else stops asking, and you have taught the room that questions are unwelcome."
   }
  ],
  "explanationExpected_en": "The four pairings, effort with testosterone and growth hormone, stress and challenge with cortisol, focus and breath with dopamine and serotonin, fatigue and surrender with endorphins, are memory hooks rather than literal wiring. The real pathways overlap heavily: dopamine is involved in effort as well as in learning, cortisol handles fuel as well as stress, and no hormone has a single job. When a student catches this, agree immediately and precisely, then keep the useful half, because the list still tells you which answer the body gives to which demand. Conceding a limit accurately raises a teacher's authority, and bluffing destroys it, since the one person who can check you is usually the person asking.",
  "explanationExpected_zh": "四组配对（用力对应睾酮与生长激素，压力与挑战对应皮质醇，专注与呼吸与多巴胺、血清素相关，疲惫与臣服带来内啡肽）是记忆用的挂钩，不是真实的线路图。真实通路大量重叠：多巴胺既参与学习也参与用力，皮质醇既管压力也管燃料，没有一种激素只有一个职责。学生抓到这一点时，立刻、准确地承认，然后保留有用的那一半：这份清单仍然告诉你，身体对哪一种要求给出哪一种回应。精确地承认边界会提高老师的权威，硬撑会摧毁它，而房间里唯一能查证你的人，通常就是提问的那个人。",
  "teacherPoint": "Concede the exact limit of a claim in front of the room and keep the useful half, because precise concession is what authority is made of.",
  "id": "HOR04"
 },
 {
  "lecture": "Hormones",
  "topic": "spotting-under-recovery",
  "stem_en": "A student who has practised six days a week for three years has changed over the last two months: sleeping badly, catching every cold in the room, flat on the mat, and no longer improving. She works long hours and is on her phone until midnight. She asks you for Intermediate Series to break the plateau.",
  "stem_zh": "一位练了三年、每周六天的学生，最近两个月变了：睡不好，教室里有人感冒她一定被传染，在垫子上整个人是平的，也不再进步。她工作时间很长，半夜还在看手机。她来找你要中级序列，说想突破瓶颈。",
  "options": [
   {
    "label": "A",
    "text_en": "Hold the new postures and change what comes after practice: longer śavāsana, a real meal, a fixed bedtime.",
    "text_zh": "先不给新体式，改练完之后：更长的摊尸式、正经吃饭、固定就寝。",
    "correct": true,
    "note": "Correct. She is not over-practising, she is under-recovering. Repair begins when cortisol falls, so the prescription belongs to the hours after practice, not to the practice itself."
   },
   {
    "label": "B",
    "text_en": "Give her the first few Intermediate postures, since a plateau is exactly what a new stimulus is there for.",
    "text_zh": "给她中级序列开头的几个体式，因为遇到瓶颈正是需要新刺激的时候。",
    "correct": false,
    "note": "Wrong, and the commonest well-meaning mistake. It adds another rise to a system that never falls. She gets worse, and because you gave her what she asked for she blames herself."
   },
   {
    "label": "C",
    "text_en": "Tell her to practise harder each morning, so that she is tired enough to sleep through the night.",
    "text_zh": "让她每天早上都练得更狠一点，这样晚上才会累到能一觉睡到底。",
    "correct": false,
    "note": "Wrong. It treats poor sleep as a shortage of fatigue. The problem is a stress signal that never comes down, and more load raises it further."
   },
   {
    "label": "D",
    "text_en": "Tell her to stop practising completely for a month, and to come back when she feels normal again.",
    "text_zh": "让她整整一个月完全停练，等感觉恢复正常之后再回到教室来。",
    "correct": false,
    "note": "Over-correction. You remove the one part of her day that already contains a downshift, and three years of habit can break inside a month away."
   }
  ],
  "explanationExpected_en": "Poor sleep, frequent illness, flatness and a stalled practice in someone whose life never downshifts is the picture of a spike without a drop. The benefit of practice comes from an acute cortisol rise followed by a real fall, and the repair state takes over during the fall. This student has the rise and no fall, so more practice only adds more rise, and chronically high cortisol breaks down muscle and suppresses immunity. Recovery is part of the dose, so the thing to change is recovery: śavāsana, food, sleep and a downshift in the rest of the day.",
  "explanationExpected_zh": "睡不好、经常生病、整个人是平的、练习停滞，加上一种从不降档的生活，这是一幅只有上升、没有下降的图像。练习的好处来自急性皮质醇上升之后真正的下降，修复的状态在下降时接手。这个学生只有上升，没有下降，所以加练只是增加上升，而长期偏高的皮质醇会分解肌肉、抑制免疫。恢复本身也算在剂量之内，所以要改的是恢复：摊尸式、饮食、睡眠，以及一天里其余时间的降档。",
  "teacherPoint": "Read bad sleep, frequent illness, flatness and a stalled practice as under-recovery rather than over-practice, and prescribe recovery instead of postures.",
  "id": "HOR05"
 },
 {
  "lecture": "Hormones",
  "topic": "breath-inside-effort",
  "stem_en": "In Mysore, a strong student is fighting for the bind in Marīcyāsana D. Her face is red, she is holding her breath, and if she strains for a few seconds the fingers do touch. She looks up at you for the adjustment.",
  "stem_zh": "迈索尔课上，一位强壮的学生正在拼 Marīcyāsana D 的绑手。她满脸通红，屏着呼吸，硬撑几秒手指确实能碰到。她抬头看你，等你去调整。",
  "options": [
   {
    "label": "A",
    "text_en": "Give her the adjustment. Once the bind is in place, the breath will settle again on its own.",
    "text_zh": "先给她调整。等手绑上之后，她的呼吸自己就会顺回来。",
    "correct": false,
    "note": "Wrong. You have rewarded breath holding. The shape arrives, the nervous system reads threat, and she learns that gripping is how postures get earned."
   },
   {
    "label": "B",
    "text_en": "Let her keep straining. This is exactly the controlled stress that makes the practice work over time.",
    "text_zh": "让她继续撑下去。这正是让练习长期起作用的那种可控压力。",
    "correct": false,
    "note": "Wrong. It confuses stress with useful stress. Once the breath stops, the stress is no longer in the range that builds her, so this is load without adaptation."
   },
   {
    "label": "C",
    "text_en": "Bring her out into a shape she can breathe in, and say you are watching the breath, not the bind.",
    "text_zh": "把她带回能呼吸的形状，并告诉她你看的是呼吸，不是绑手。",
    "correct": true,
    "note": "Correct. The breath is the marker that separates useful stress from a threat response, and saying it out loud teaches the whole room what standard you actually hold."
   },
   {
    "label": "D",
    "text_en": "Take the posture out of her practice for now, until her hips and shoulders have opened further.",
    "text_zh": "暂时把这个体式从她的练习里拿掉，等髋和肩再打开一些再给。",
    "correct": false,
    "note": "Wrong. She can already reach the bind, so this treats a breathing problem as a flexibility problem and removes the exact posture where she would first learn to recover while still in effort."
   }
  ],
  "explanationExpected_en": "The skill being trained in the binding postures is recovering while still in effort, which means finding a long smooth breath inside a shape that is hard. It is not resting between postures. Marīcyāsana B and D are where most students meet this, because the bind compresses the abdomen and the breath wants to disappear. If the breath survives, the stress stays in the range that builds the student. If the breath stops, the stress becomes a threat response and the nervous system grips harder. So the cue is breath first, shape second, and the teacher watches the breath rather than the bind.",
  "explanationExpected_zh": "绑手系列真正训练的技术，是在用力之中恢复，也就是在一个困难的形状里找到又长又平顺的呼吸，而不是在体式之间休息。大多数学生第一次遇到这件事是在 Marīcyāsana B 和 D，因为绑手压迫腹部，呼吸想要消失。呼吸活下来，压力就还在能把人建起来的区间；呼吸停了，压力就变成威胁反应，神经系统会抓得更紧。所以指令是先呼吸、后形状，老师看的是呼吸，不是绑手。",
  "teacherPoint": "Make the breath, not the bind, the standard in the hard binding postures, and say out loud that this is what you are watching.",
  "id": "HOR06"
 },
 {
  "lecture": "Hormones",
  "topic": "rhythm-over-heroic-efforts",
  "stem_en": "Your shala is quiet in the low season. Someone proposes a 108 sun salutation challenge and a monthly three hour intensive to bring people in, arguing that big events create excitement.",
  "stem_zh": "淡季，练习室很冷清。有人提议办一场 108 遍拜日式挑战，再加每月一次三小时的强化课，理由是大型活动能制造热度。",
  "options": [
   {
    "label": "A",
    "text_en": "Put the big events at the centre of the timetable. Excitement is what fills a room and keeps it full.",
    "text_zh": "把大型活动放到课表的正中心。热度才能把教室填满，并且一直维持住。",
    "correct": false,
    "note": "Wrong. A community built on peaks empties between them. Attendance follows the events rather than the practice, and you have to keep inventing a bigger one."
   },
   {
    "label": "B",
    "text_en": "Refuse events entirely. Ashtanga is a daily practice, and a challenge is only a distraction from it.",
    "text_zh": "完全不办活动。阿斯汤加是日常的练习，挑战赛只是一种干扰而已。",
    "correct": false,
    "note": "Rigid, and it closes a legitimate front door. The event is not the problem. Making the event the centre is the problem."
   },
   {
    "label": "C",
    "text_en": "Run the challenge and lengthen everyone's daily practice as well, so the excitement carries into the mornings.",
    "text_zh": "办挑战赛，同时把所有人的每日练习也加长，让热度延续到早晨的练习里。",
    "correct": false,
    "note": "Wrong. It raises load across the whole room to solve a marketing problem, and gives every student more rise with no more recovery."
   },
   {
    "label": "D",
    "text_en": "Use an event as a door in, but keep the daily hour at the centre. Steady return builds practitioners.",
    "text_zh": "用活动当入口，但中心仍是每天那一小时。稳定回来，才造就练习者。",
    "correct": true,
    "note": "Correct. It uses the event for what it is good at, attention, without confusing it with the thing that produces long-term practitioners, which is rhythm."
   }
  ],
  "explanationExpected_en": "Serotonin does not spike. It rises with rhythm, repetition and steady progress: same time, same room, same order, day after day. That is the chemistry underneath a fixed sequence practised at a fixed hour, and it is the honest argument for consistency over intensity in a student's first years. The practical value of that steadiness is not happiness but consistency, the willingness to come back tomorrow at the same hour without needing to feel motivated first, and that trait is worth more than any single strong practice. An event can bring someone through the door, but only the daily hour keeps them.",
  "explanationExpected_zh": "血清素不会骤升，它随着节奏、重复和稳定的进展而升起：同样的时间、同样的房间、同样的顺序，日复一日。这就是固定序列、固定时间练习背后的化学基础，也是「前几年重稳定甚过重强度」的诚实理由。这种稳定的实际价值不是快乐，而是持续性：明天同一时间还愿意回来，不需要先有动力。这个特质比任何一次强力的练习都更有价值。活动可以把人带进门，但留住人的只有每天那个固定的时间。",
  "teacherPoint": "Sell the daily hour, not the event, and use events only as doors into it.",
  "id": "HOR07"
 },
 {
  "lecture": "Hormones",
  "topic": "reward-in-pursuit-not-arrival",
  "stem_en": "A student two years in tells you the middle of her practice has become boring: \"I just want to get to Supta Kūrmāsana. Everything before it is something I get through.\" She is still working the Marīcyāsana D bind and is nowhere near Supta Kūrmāsana.",
  "stem_zh": "一位练了两年的学生说，她练习的中段变得很无聊：「我就想赶紧到 Supta Kūrmāsana，前面那些只是要熬过去的。」她还在处理 Marīcyāsana D 的绑手，离 Supta Kūrmāsana 还很远。",
  "options": [
   {
    "label": "A",
    "text_en": "Give her Supta Kūrmāsana now anyway, so that the middle stops feeling like a corridor she has to walk down.",
    "text_zh": "还是现在就把 Supta Kūrmāsana 给她，让中段不再像一条必须走完的走廊。",
    "correct": false,
    "note": "Wrong. You hand over the trophy out of order and the boredom returns at the next posture, because nothing about where she locates the reward has changed."
   },
   {
    "label": "B",
    "text_en": "Give her something measurable in the middle, for example the breath tracked exactly for ten postures.",
    "text_zh": "在中段给她一个能衡量的目标，比如连续十个体式都把呼吸精准跟住。",
    "correct": true,
    "note": "Correct. It moves the reward back into the process, where it actually rises, and it gives her something that can improve today rather than in six months."
   },
   {
    "label": "C",
    "text_en": "Tell her that wanting the next posture is ego, and that she should practise without wanting anything.",
    "text_zh": "告诉她想要下一个体式就是我执，练习时不应该想要任何东西。",
    "correct": false,
    "note": "Wrong. It shames an ordinary report. She stops telling you what she feels, and wanting to progress is not a fault, it is the engine you steer."
   },
   {
    "label": "D",
    "text_en": "Tell her to practise faster, so that the middle of the series takes up less of her morning time.",
    "text_zh": "让她整体都练快一点，这样中段占用早晨的时间就会少一些。",
    "correct": false,
    "note": "Wrong. It confirms that the middle is worthless and trains a rushed, low attention practice, which is the opposite of what the method is for."
   }
  ],
  "explanationExpected_en": "Dopamine rises during the pursuit, not at the finish. It tracks progress and prediction rather than the trophy, so a jump through that improves by an inch, or the breath held precisely for ten postures, raises it while it is happening. If the reward is located only at the end, the entire middle of the practice becomes something to get through, and the student who practises to obtain the reward has already lost it. The teaching move is to name a target inside the process, so progress is visible today.",
  "explanationExpected_zh": "多巴胺在追求的过程中上升，不是在终点。它追踪的是进展和预测，不是奖杯，所以跳穿进步了一寸，或者连续十个体式把呼吸精准跟住，这些事情在发生的当下多巴胺就在上升。如果奖赏只放在终点，练习的整个中段就变成要熬过去的东西，而为了得到奖赏而练习的人，已经把它弄丢了。教学上的做法是：在过程之中设定一个目标，让进展今天就看得见。",
  "teacherPoint": "When a student is bored in the middle, name a measurable target inside the middle instead of moving the finish line closer.",
  "id": "HOR08"
 },
 {
  "lecture": "Hormones",
  "topic": "small-completions-build-habit",
  "stem_en": "A new student loves the practice but says six mornings a week is impossible with her job. She feels she cannot do it properly, and is thinking of stopping altogether.",
  "stem_zh": "一位新学生很喜欢练习，但说以她的工作，每周六个早晨根本做不到。她觉得自己没法好好练，正在考虑干脆不练了。",
  "options": [
   {
    "label": "A",
    "text_en": "Hold the standard: six mornings a week or nothing, because a diluted commitment makes a diluted practitioner.",
    "text_zh": "坚持标准：要么六个早晨，要么不练，因为打折的承诺只养出打折的练习者。",
    "correct": false,
    "note": "Wrong. It sounds like rigour and it empties rooms. She leaves, and a student who has left practises zero mornings a week."
   },
   {
    "label": "B",
    "text_en": "Tell her to come on whatever mornings she can manage, and leave the arrangement loosely at that.",
    "text_zh": "告诉她哪个早上有空就来，剩下的不必约定，就这样安排下去。",
    "correct": false,
    "note": "Kind but shapeless. With nothing to complete there is no pull to return, and she drifts away quietly over about two months."
   },
   {
    "label": "C",
    "text_en": "Agree a commitment she will certainly keep, such as unrolling the mat daily, and say what counts as done.",
    "text_zh": "跟她定一个她一定做得到的承诺，比如每天铺开垫子，并说清怎样算完成。",
    "correct": true,
    "note": "Correct. A completion she can actually reach every day is what produces the pull to come back, and the days build from there rather than from willpower."
   },
   {
    "label": "D",
    "text_en": "Offer her a discounted package, so that the money she has already paid pushes her to keep attending.",
    "text_zh": "给她一个打折的套票，让她已经付出去的那笔钱推着她来上课。",
    "correct": false,
    "note": "Wrong. Money as motivation fades fast, and it trains her to think of the practice as something she purchased rather than something she does."
   }
  ],
  "explanationExpected_en": "A habit is built as a sequence of small completions, each one making the next more likely. Take the difficult thing and do one part of it at a time, and complete that part. Applied to a posture, a student who cannot do the full shape can complete the entry, or the breath in the hardest position, or the exit. Applied to discipline, it is the same move: the student who cannot commit to six days a week can commit to putting the mat down. The completion must be named and visible, otherwise there is nothing to complete and nothing pulling her back tomorrow.",
  "explanationExpected_zh": "习惯是由一串小的完成建立起来的，每一次完成都让下一次更容易发生。把困难的事拆开，一次只做一部分，并且完成那一部分。用在体式上：做不了完整形状的学生，可以完成进入的部分，或者最难位置上的呼吸，或者退出的部分。用在自律上是同一个动作：承诺不了每周六天的学生，可以先承诺把垫子铺开。完成的标准必须说出来、看得见，否则就没有可以完成的东西，也就没有把她拉回来的力量。",
  "teacherPoint": "Shrink the commitment until the student can complete it every day, and say out loud what counts as done.",
  "id": "HOR09"
 },
 {
  "lecture": "Hormones",
  "topic": "repetition-builds-the-map",
  "stem_en": "A beginner has jumped back the same wrong way for a month, dumping into her lower back every time. She is happy and improving in other ways. A senior student tells you to leave her alone and let her enjoy herself for now.",
  "stem_zh": "一位初学者跳回的方式已经错了一个月，每次都塌在下背。她练得很开心，其他方面也在进步。一位老学生跟你说，先别管她，让她开心地练一阵子。",
  "options": [
   {
    "label": "A",
    "text_en": "Correct it now with one clear instruction, and say why: every day she gets better at the wrong version.",
    "text_zh": "现在就用一句清楚的指令纠正，并告诉她原因：她每天都在把错的版本练得更熟。",
    "correct": true,
    "note": "Correct. One instruction is what a beginner can hold, and giving the reason buys you her patience for a slow correct version instead of a fast wrong one."
   },
   {
    "label": "B",
    "text_en": "Leave it. Enjoyment matters most in the first months, and the pattern will tidy itself as she gets stronger.",
    "text_zh": "先放着。头几个月开心最重要，等她力量上来了，这个模式自己就会好。",
    "correct": false,
    "note": "Wrong. It assumes repetition is neutral. It never is, so a month of the wrong pattern is a month spent building the wrong pattern accurately."
   },
   {
    "label": "C",
    "text_en": "Correct everything you can see today, so she has the whole picture and can work on it herself.",
    "text_zh": "今天就把你看到的所有问题一次全部纠正，让她拿到完整的一张图，自己回去慢慢改。",
    "correct": false,
    "note": "Wrong. Over-correcting a beginner is the other common harm. She cannot hold five instructions, retains none of them, and leaves feeling incompetent."
   },
   {
    "label": "D",
    "text_en": "Tell her she is careless with her back, and that it will change when she decides to take it seriously.",
    "text_zh": "告诉她她对自己的下背太随便，等她决定认真对待，跳回自然就会改。",
    "correct": false,
    "note": "Wrong. It renames a teaching problem as a flaw in her character. Nobody has shown her another way to jump back, so blame gives her nothing to do differently and she leaves feeling judged rather than taught."
   }
  ],
  "explanationExpected_en": "A cortical map is the detailed model the brain builds of what to move, how to move it and how it should feel, and it is sculpted consciously, by attention, one correction at a time. Muscle memory is the subconscious result of that sculpting. The consequence for teaching is that repetition is never neutral: repeat a wrong pattern and you build a precise map of the wrong pattern, and the student becomes very good at doing it badly. Repeat the correct pattern and the map, the tissue and the joint change in the right direction. This is why strict method is the mechanism rather than conservatism, and why the reason is worth explaining to the student.",
  "explanationExpected_zh": "皮层地图是大脑为身体及其运动建立的详细模型：动什么、怎么动、应该是什么感觉。它是被有意识地雕琢出来的，靠注意力，一次一个修正。肌肉记忆是这种雕琢的潜意识结果。教学上的后果是：重复永远不是中性的。重复错误的模式，你会建出一张精确的错误地图，学生会变得非常擅长做错；重复正确的模式，地图、组织和关节都朝正确的方向改变。所以严格的方法不是保守，它就是机制本身，也因此值得把这个理由讲给学生听。",
  "teacherPoint": "Correct a repeated error early, one instruction at a time, and give the map reason so the student accepts a slow correct version.",
  "id": "HOR10"
 },
 {
  "lecture": "Hormones",
  "topic": "body-awareness-not-pain-override",
  "stem_en": "A student has read that yoga practitioners tolerate pain far better than non-practitioners. Her knee has hurt in lotus for three weeks. She tells you she is going to use the practice to build her pain tolerance and work through it.",
  "stem_zh": "一位学生看到「瑜伽练习者对疼痛的耐受度远高于不练的人」，而她的膝盖在莲花坐里已经痛了三周。她告诉你，她打算用练习来提高疼痛耐受，把它扛过去。",
  "options": [
   {
    "label": "A",
    "text_en": "Agree with her. Higher pain tolerance is one thing a long practice genuinely builds, so work through it.",
    "text_zh": "同意她的说法。长期练习确实会提高疼痛耐受，所以这个痛扛过去就好。",
    "correct": false,
    "note": "Wrong. It turns a research finding into permission to override a joint. Knee pain in lotus is mechanical, and tolerance will not solve a mechanical problem."
   },
   {
    "label": "B",
    "text_en": "Tell her the research shows that practice rebuilds joints, and that staying consistent will resolve the knee in time.",
    "text_zh": "告诉她研究显示练习能修复关节，只要一直稳定练下去，膝盖迟早自己会好。",
    "correct": false,
    "note": "Wrong. It over-claims a snapshot comparison of two groups, and the false reassurance delays the change that would actually fix the knee."
   },
   {
    "label": "C",
    "text_en": "Tell her to stop practising altogether, until the knee has been completely painless for a full month.",
    "text_zh": "让她完全停下练习，等膝盖整整一个月完全不痛了，再回到教室来。",
    "correct": false,
    "note": "Over-correction. She loses her whole practice over one joint, and the missing rotation that caused it still has not been addressed."
   },
   {
    "label": "D",
    "text_en": "Tell her the training is to read the body, not override it, so take the knee out of lotus and work the rotation.",
    "text_zh": "告诉她练习是读懂身体，不是压过身体，把膝盖移出莲花坐，去补缺的旋转。",
    "correct": true,
    "note": "Correct. It separates tolerating pain from reading it, keeps her practising, and puts the work where the actual problem is."
   }
  ],
  "explanationExpected_en": "Every time a student feels muscle, joint, heartbeat and fatigue, they are training interoception, the sense of the body from the inside, which carries body awareness, pain tolerance, emotional regulation and self-observation. The study showed that practitioners tolerated cold pain more than twice as long as matched non-practitioners, but it compared two groups at one moment, so it cannot show that yoga caused the difference, and the correct wording is \"practitioners show,\" not \"yoga builds.\" More importantly, a trained sense of the body means noticing earlier and more precisely, not ignoring more. Three weeks of knee pain in lotus is information, and the answer is to change the mechanics.",
  "explanationExpected_zh": "每一次学生感受肌肉、关节、心跳和疲惫，都在训练内感受，也就是从内部感知身体的能力，它承载身体觉知、疼痛耐受、情绪调节和自我观察。那项研究发现练习者对冷痛的耐受时间是配对非练习者的两倍以上，但它比较的是两群人在某一刻的状态，无法证明是瑜伽造成了这个差异，所以准确的说法是「练习者身上观察到」，而不是「瑜伽造就了」。更重要的是：被训练过的身体感知，意味着更早、更精确地察觉，而不是更能忽略。膝盖在莲花坐里痛了三周是信息，答案是改变力学结构。",
  "teacherPoint": "Name the difference between tolerating pain and reading it, and answer a persistent joint pain by changing the mechanics, not the tolerance.",
  "id": "HOR11"
 },
 {
  "lecture": "Hormones",
  "topic": "tristhana-as-attention-training",
  "stem_en": "A student says her mind wanders through the whole practice and she is thinking about work by the third Sūrya Namaskāra. She asks whether she should take up meditation separately to fix her concentration.",
  "stem_zh": "一位学生说她整堂练习心都在飘，做到第三遍拜日式就已经在想工作的事。她问你，是不是该另外去学冥想来解决专注力的问题。",
  "options": [
   {
    "label": "A",
    "text_en": "Tell her to add twenty minutes of sitting meditation before practice, since concentration can only be trained sitting still.",
    "text_zh": "让她在练习前每天加上二十分钟的坐式冥想，因为专注这件事只能靠坐着不动练出来。",
    "correct": false,
    "note": "Well meant, but the premise is false and it sends her elsewhere for a skill the method already contains, while adding a second daily task to someone already stretched."
   },
   {
    "label": "B",
    "text_en": "Hand her the three anchors the method already gives, gaze, breath and posture held by bandha, and name that her training.",
    "text_zh": "把方法已有的三处交给她：凝视点、呼吸、由收束撑住的体式，这就是专注训练。",
    "correct": true,
    "note": "Correct. It hands her a tool already in her hands, and it fuses attention with the movement rather than asking her to train attention somewhere else."
   },
   {
    "label": "C",
    "text_en": "Tell her to close her eyes through the standing postures, so that less around her pulls the attention away.",
    "text_zh": "让她在整个站立系列里闭上眼睛，这样周围能把注意力拉走的东西就少了。",
    "correct": false,
    "note": "Wrong. It removes the gaze, which is the anchor. It is unsafe in the balances and it makes the mind wander more, not less."
   },
   {
    "label": "D",
    "text_en": "Tell her a wandering mind is completely normal at her stage, and that there is not much to be done about it.",
    "text_zh": "告诉她这个阶段心飘是完全正常的，暂时也没有什么特别需要去做的事。",
    "correct": false,
    "note": "True and useless. She asked for a method, the method has one, and answering with acceptance alone teaches her that the practice has no technique for attention."
   }
  ],
  "explanationExpected_en": "Tristhāna means three places of attention. In Pattabhi Jois's own formulation they are posture (āsana), breathing system (ujjāyī) and gazing place (dṛṣṭi); the working version many teachers use replaces posture with bandha, because the bandhas hold posture and breath together. Dṛṣṭi fixes the eyes and steadies the system, ujjāyī sets the rhythm and gives the practice its metronome, bandha holds the centre so the movement has something to move from. Three streams converge into one point, which is what the laboratory calls cognitive-motor integration: attention and movement fused into a single task rather than run in parallel. The concentration training is already inside the practice she is doing.",
  "explanationExpected_zh": "三处专注（tristhāna）的意思是三个安住之处。在 Pattabhi Jois 本人的表述里，三者是体式（āsana）、呼吸系统（ujjāyī）、凝视点（dṛṣṭi）；很多老师使用的实用版本用收束（bandha）替换了体式，因为收束正是把体式和呼吸绑在一起的东西。凝视固定眼睛，让整个系统稳下来；喉呼吸固定节奏，给练习一个节拍器；收束稳住中心，让动作有可以发力的地方。三股汇成一点，实验室把这种汇合叫作认知运动整合：注意力与动作融合成一件事，而不是并行的两件事。她要的专注训练，本来就在她正在做的练习里。",
  "teacherPoint": "Hand a distracted student the three places instead of a new discipline, and explain that the practice already fuses attention with movement.",
  "id": "HOR12"
 },
 {
  "lecture": "Three Doshas",
  "topic": "vata-dose-withhold-depth",
  "stem_en": "A student has practised with you for three weeks. She is very flexible, her hands are cold, she sleeps badly, and she has arrived at seven, then at nine, then not at all. After her third class this week she asks you for the next posture. What do you do?",
  "stem_zh": "一位学生跟你练了三个星期。她非常柔软，手脚冰凉，睡眠很差，来的时间是七点、九点，后来有一天完全没来。本周第三次课后，她来找你要下一个体式。你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Give her the next posture. She learns quickly, and new material is what will keep her coming back to the shala.",
    "text_zh": "给她下一个体式。她学得快，而新东西正是让她持续回到练习中心的原因。",
    "correct": false,
    "note": "Wrong. A teacher who picks this has read speed as readiness. This body already has far more range than control, and buying attendance with novelty rewards the exact pattern that injures her."
   },
   {
    "label": "B",
    "text_en": "Say no, tell her why, and ask for a fixed hour and a fixed mat six days a week before a new posture.",
    "text_zh": "说不，告诉她原因，先要固定时间、固定垫子、一周六天，再给新体式。",
    "correct": true,
    "note": "Correct. Over-aroused with poor recovery: the dose is less stress and more rhythm, and the hard thing for this student is showing up, so that is what you hold her accountable to."
   },
   {
    "label": "C",
    "text_en": "Give her the posture and tell her to work on it gently at home on the days she cannot come to the shala.",
    "text_zh": "给她这个体式，并告诉她在来不了练习中心的日子，在家轻轻地练。",
    "correct": false,
    "note": "Wrong. This looks like a compromise but it adds unsupervised range to an irregular schedule, and it quietly accepts the irregularity instead of correcting it."
   },
   {
    "label": "D",
    "text_en": "Keep her sequence the same but add longer, deeper holds in her existing postures so she feels she was given something.",
    "text_zh": "序列不变，但在她现有的体式里加更长、更深的停留，让她觉得自己得到了东西。",
    "correct": false,
    "note": "Wrong. Depth substituted for rhythm is the same mistake in a different costume. She receives more stress with no more recovery, which is the failure already underway."
   }
  ],
  "explanationExpected_en": "Name what you are seeing (a system already over-aroused with poor recovery, range without control), name the dose (less stress, more rhythm, long exhale, steady count, warmth), and say that showing up is the hard thing for this student while depth is the first thing she will ask for.",
  "explanationExpected_zh": "说出你看到的是什么（一个已经过度兴奋、恢复很差的系统，有范围没有控制），说出剂量（更少的压力，更多的规律，长呼气，稳定的数息，保暖），并指出对这个学生来说，最难的是出现在垫子上，而深度是她第一个会来要的东西。",
  "teacherPoint": "Refuse a new posture to an irregular, hypermobile student and ask for a fixed hour and mat instead, saying out loud why.",
  "id": "DOS01"
 },
 {
  "lecture": "Three Doshas",
  "topic": "pitta-stopping-assignment-framing",
  "stem_en": "A strong, competitive student has been practising on a painful shoulder for a month. He sweats in the second Surya Namaskara and tells you that stopping would set him back. You have decided that his practice has to change this week. What do you say to him?",
  "stem_zh": "一位强壮好胜的学生带着疼痛的肩膀练了一个月。他第二遍拜日式就出汗，并告诉你，停下来会让他退步。你已经决定，这一周他的练习必须改。你怎么对他说？",
  "options": [
   {
    "label": "A",
    "text_en": "\"Take the whole week off and rest. Be kind to yourself, your body is asking you for it.\"",
    "text_zh": "「这一周完全停下来休息。对自己好一点，你的身体正在向你要休息。」",
    "correct": false,
    "note": "Wrong. Framed as kindness, this student hears demotion and will either ignore you or disappear. A full week away also removes the rhythm, when what he needs is the same stress with real recovery."
   },
   {
    "label": "B",
    "text_en": "\"Do what you can this week. Listen to your body, stop when it hurts, and pick it up again when it eases.\"",
    "text_zh": "「这一周量力而行。听身体的话，疼就停，觉得好一点了再练回来。」",
    "correct": false,
    "note": "Wrong. It hands both the stopping and the restarting to the one student least able to stop. He will read pain as a test and finish the series anyway, on an inflamed tendon."
   },
   {
    "label": "C",
    "text_en": "\"Finish at Marichyasana D this week and close slowly. That is the assignment, and it is the harder one.\"",
    "text_zh": "「这一周练到玛里奇 D 就结束，慢慢收尾。这就是功课，而且更难。」",
    "correct": true,
    "note": "Correct. A specific stopping assignment, framed as difficulty rather than rest, is the only version this student can accept, and it is honest because restraint genuinely is harder for him."
   },
   {
    "label": "D",
    "text_en": "\"Keep your full practice, just skip the postures that hurt the shoulder and carry on with everything else.\"",
    "text_zh": "「练习量照旧，只是把弄疼肩膀的那几个体式跳过去，其他一切照常。」",
    "correct": false,
    "note": "Wrong. Total output is unchanged, so there is still no downshift. The shoulder is protected on paper while the pattern that produced it continues six days a week."
   }
  ],
  "explanationExpected_en": "Say what you are seeing (high output with no downshift), name the dose (same stress, real recovery), and explain that restraint offered as kindness reads as demotion to this student, so it must be given as the harder assignment, with the exhale corrected rather than the alignment.",
  "explanationExpected_zh": "说出你看到的（输出很高，却不肯降档），说出剂量（压力照旧，但要真的恢复），并解释：把克制说成好意，这个学生会听成降级，所以必须把它说成更难的那份功课，而且你要纠正的是他的呼气，不是他的对位。",
  "teacherPoint": "Give a driven student a precise stopping assignment worded as the harder version, never as rest or self-care.",
  "id": "DOS02"
 },
 {
  "lecture": "Three Doshas",
  "topic": "kapha-plateau-more-load",
  "stem_en": "A student has come six mornings a week for four years. He never complains, has never been injured, and his practice looks exactly as it did two years ago. He has never asked you for anything. What is the right next action?",
  "stem_zh": "一位学生连续四年，每周六个早晨都来。他从不抱怨，从没受过伤，而他的练习和两年前看起来一模一样。他从来没有向你要过任何东西。下一步正确的动作是什么？",
  "options": [
   {
    "label": "A",
    "text_en": "Give him more before he asks: extra breaths, shorter rest, the next posture on an ordinary Tuesday.",
    "text_zh": "不等他开口就给更多：多加呼吸，缩短休息，普通的星期二就给下一个体式。",
    "correct": true,
    "note": "Correct. Under-stimulation and plateau: the dose is more stress. Asking for more is the hardest thing for this student, so you have to offer it unasked."
   },
   {
    "label": "B",
    "text_en": "Leave him alone. Four years with no injury means your teaching is working on him and there is nothing to fix.",
    "text_zh": "别去动他。四年没有受伤，说明你的教学在他身上是有效的，没有什么要修的。",
    "correct": false,
    "note": "Wrong, and the commonest failure in the room. Absence of problems is read as progress. A system that adapts to load stopped adapting long ago, so this student is being quietly wasted."
   },
   {
    "label": "C",
    "text_en": "Ask him what he would like to work on, and build the next months of his practice around his answer.",
    "text_zh": "问他想练什么，然后就按他的回答，安排他接下来几个月的练习。",
    "correct": false,
    "note": "Wrong. It sounds respectful but hands the decision to the person least able to ask for more. He will say he is fine, and you will have confirmed the plateau with his own words."
   },
   {
    "label": "D",
    "text_en": "Send him to a workshop or a different style for a few months so that he finds his inspiration again.",
    "text_zh": "送他去上个工作坊，或者去练几个月别的流派，让他重新找回一点动力。",
    "correct": false,
    "note": "Wrong. It sends your most loyal student out of the room to solve a problem you can solve inside the sequence, and it treats a dosing failure as a motivation problem."
   }
  ],
  "explanationExpected_en": "Name what you are seeing (under-stimulation and a plateau, not injury), name the dose (more stress: heat, pace, shorter rest, real load inside the fixed sequence), and say why this student is easy to neglect: nothing appears wrong and he will never ask.",
  "explanationExpected_zh": "说出你看到的（刺激不足与停滞，不是受伤），说出剂量（更多的压力：热度、节奏、更短的休息、在固定序列里给出真实的负荷），并说明这个学生为什么容易被忽略：看起来一切都好，而且他永远不会开口。",
  "teacherPoint": "Add real load to the quiet, never-complaining long-timer without waiting to be asked, and go to him first in the room, not last.",
  "id": "DOS03"
 },
 {
  "lecture": "Three Doshas",
  "topic": "dosa-means-fault-not-identity",
  "stem_en": "A new student tells you: \"I did a test online, I am a Vata, so I will never be able to keep a regular schedule.\" What is the most useful thing you can say to her?",
  "stem_zh": "一位新学生告诉你：「我做过网上的测试，我是瓦塔型，所以我永远做不到规律。」你能对她说的最有用的一句话是什么？",
  "options": [
   {
    "label": "A",
    "text_en": "\"Those tests are not accurate. Shall I look at you properly and tell you your real type?\"",
    "text_zh": "「那些网上的测试不准。要不要我好好看看你，告诉你真正的类型？」",
    "correct": false,
    "note": "Wrong. It replaces a cheap label with a label from you, which is heavier because it comes from her teacher. It also moves you into the diagnosis seat, which is not your work."
   },
   {
    "label": "B",
    "text_en": "\"Type does not matter here. Just practise every morning and it will sort itself out over time.\"",
    "text_zh": "「类型在这里不重要。每天照常练就是了，练着练着自然就会好起来。」",
    "correct": false,
    "note": "Wrong. It throws away a usable read and leaves her excuse standing untouched. She keeps the belief and you keep no instrument for dosing her."
   },
   {
    "label": "C",
    "text_en": "\"That matches exactly what I see, so we will build your practice around the fact that you are a Vata.\"",
    "text_zh": "「这和我看到的完全一致，所以我们接下来就按照你是瓦塔型这件事，安排你的练习。」",
    "correct": false,
    "note": "Wrong. Accepting a fault-name as an identity hands her a permanent reason not to show up, which is the one thing she most needs to do."
   },
   {
    "label": "D",
    "text_en": "\"Dosha means what can go wrong, so it is a tendency, not a name. What has changed this month?\"",
    "text_zh": "「督夏的意思是会出问题的东西，是倾向，不是名字。这个月你有什么变了？」",
    "correct": true,
    "note": "Correct. One sentence of etymology, then a question that moves her from identity to state, which is where the tradition actually stands."
   }
  ],
  "explanationExpected_en": "Say that dosa comes from a root meaning to spoil or corrupt, so it names a fault, something that can go wrong, not a person. Calling yourself a Vata is taking the name of a fault as an identity. Then explain that the follow-up question moves her from a fixed identity to a changing state.",
  "explanationExpected_zh": "说明 doṣa 来自意为败坏、污损的词根，所以它命名的是一个缺陷、一个会出问题的东西，而不是一个人。自称「我是瓦塔型」，是把一个缺陷的名字当成了身份。然后说明那个追问的作用：把她从固定的身份带回流动的状态。",
  "teacherPoint": "Correct a quiz identity in one warm sentence, then ask what changed in the last month to move the student from identity to state.",
  "id": "DOS04"
 },
 {
  "lecture": "Three Doshas",
  "topic": "scope-of-practice-refusal",
  "stem_en": "After class a student asks you to tell her which dosha she is, to write her a matching diet, and says she is thinking of coming off the medication her doctor prescribed because she wants to be more natural. What do you do?",
  "stem_zh": "下课后，一位学生要你告诉她属于哪一种督夏，给她配一份对应的食谱，并说她在考虑停掉医生开的药，因为她想「自然一点」。你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Give her the read and the food list, since eating is general wellness rather than medicine, and stay silent on the medication, which is her doctor's business.",
    "text_zh": "把督夏的判断和食谱都给她，因为吃什么属于一般养生、不算医疗；药的事一句都不说，那是她和医生之间的事。",
    "correct": false,
    "note": "Wrong. A food list built on a read you are not qualified to make is a prescription, whatever you call it. Saying nothing about the medication is heard as agreement."
   },
   {
    "label": "B",
    "text_en": "Refuse both, say plainly that you do not diagnose or prescribe, send the medication question to her doctor, and give her pace, depth and when to stop.",
    "text_zh": "两样都拒绝，明确说你不做诊断、不开处方，停药的问题交回她的医生，并给她节奏、深度、什么时候停。",
    "correct": true,
    "note": "Correct. The refusal is stated plainly and the student still leaves with something real, which is how you teach the boundary rather than merely defend it."
   },
   {
    "label": "C",
    "text_en": "Tell her you cannot advise on medication, then share what you personally eat and how changing it changed your own practice and sleep.",
    "text_zh": "告诉她你不能对用药给建议，然后分享你自己吃什么，以及改了之后你的练习和睡眠有什么变化。",
    "correct": false,
    "note": "Wrong. From a teacher, a personal example functions as a prescription. The disclaimer covers the medication only, and she walks out with a diet she believes you gave her."
   },
   {
    "label": "D",
    "text_en": "Refuse the diet and the medication question, but still give her the dosha read, since a read is a teaching tool rather than a diagnosis.",
    "text_zh": "拒绝食谱，也拒绝回答用药的问题，但还是把督夏的判断告诉她，因为这个判断是教学工具，不是诊断。",
    "correct": false,
    "note": "Wrong, and it is the trap for a teacher who half remembers the boundary. The read is for how you teach her, not a name you hand over. Say \"you are a Vata\" and she cannot argue with it, and she will still be repeating it in two years."
   }
  ],
  "explanationExpected_en": "State the boundary: you do not diagnose and you do not prescribe, and never advise on medication. Add that a dosha read is not a diagnosis in the first place, and that it is a lens for how you teach her rather than a name to hand over. Then name what is inside your scope: how fast you introduce a posture, how long a hold you give, when you stop them, whether you push today.",
  "explanationExpected_zh": "说出界限：你不做诊断，也不开处方，绝不对用药给建议。补充两句：督夏的判断本来就不是诊断，而且它是「你怎么教这个人」的镜头，不是一个可以交出去的名字。然后说出你职责范围内的东西：一个体式你多快介绍给她，停留给多长，什么时候让她停，今天推还是让她安静。",
  "teacherPoint": "Say the scope of practice sentence out loud, refer the medical question out, keep the read to yourself, and still hand the student something usable from inside your own work.",
  "id": "DOS05"
 },
 {
  "lecture": "Three Doshas",
  "topic": "one-churning-two-results",
  "stem_en": "Two students take the same led primary from you on the same morning. One says afterwards that the practice gave her a body for the first time. The other leaves with a shoulder injury she carries for two years. A teacher in your training asks how that is possible when the class was identical. What do you say?",
  "stem_zh": "同一个早上，两位学生上了你同一堂口令课。一位结束后说，这堂课让她第一次真正拥有了自己的身体。另一位带着一个肩伤离开，这个伤跟了她两年。培训里有位老师问你：课明明是一样的，怎么会这样？你怎么回答？",
  "options": [
   {
    "label": "A",
    "text_en": "The class was the same, the receiver was not. Dose, timing and constitution decide whether a practice heals or harms.",
    "text_zh": "课是一样的，接受的人不一样。剂量、时机和体质决定一件事是治还是伤。",
    "correct": true,
    "note": "Correct. One ocean, one churning, both results. The same substance is medicine or poison depending on dose, timing and who is holding it, and that is an ordinary Tuesday, not an extreme case."
   },
   {
    "label": "B",
    "text_en": "Led primary is too strong for most bodies, so it should be kept for advanced students and dropped from the open timetable.",
    "text_zh": "口令课对大多数身体来说太强了，应该只留给高级学生，并从公开课表上撤下来。",
    "correct": false,
    "note": "Wrong. It blames the practice instead of the dose, and it would take the class away from the very student it healed. The teacher who thinks this way slowly removes all stress from the room."
   },
   {
    "label": "C",
    "text_en": "The injured student's alignment was wrong. Sharper instruction and a better adjustment would have made the same class safe for both.",
    "text_zh": "是那位受伤学生的对位有问题。指令更准确、辅助更到位，同一堂课对两个人都会是安全的。",
    "correct": false,
    "note": "Wrong. It reduces a dosing failure to a technique failure, so the teacher keeps giving everyone the same amount and simply cues it more cleanly. The injuries continue."
   },
   {
    "label": "D",
    "text_en": "One of them was unlucky. Injuries are an unavoidable part of practising six days a week, and they even out over the years.",
    "text_zh": "只是运气不好。一周六练，受伤是免不了的一部分，几年下来会自己平掉。",
    "correct": false,
    "note": "Wrong. Making injury random, and imagining it evens out over the years, removes your responsibility for the dose, which is the one thing you actually control every morning."
   }
  ],
  "explanationExpected_en": "Explain that poison and medicine came out of one churning, not two, so they are two results of the same work. Name the three things that decide which one a student gets: dose, timing, and the constitution of the one receiving it. Say that this is the ordinary situation in a Mysore room, not an extreme case.",
  "explanationExpected_zh": "说明毒与药出自同一次搅动，不是两片海，它们是同一份工作的两个产物。说出决定学生拿到哪一个的三件事：剂量、时机，以及接受者的体质。并指出这是 Mysore 教室里的日常，不是极端情况。",
  "teacherPoint": "Explain to another teacher, in two sentences, why the same class heals one student and injures another, and locate the cause in the dose rather than in the practice.",
  "id": "DOS06"
 },
 {
  "lecture": "Three Doshas",
  "topic": "simile-keep-the-as",
  "stem_en": "You have taught the line from Sushruta that sets kapha beside the moon, pitta beside the sun and vata beside the wind. The following week you hear your assistant tell the room: \"Kapha is the moon, pitta is the sun, vata is the wind.\" Does it matter, and what do you ask him to change?",
  "stem_zh": "你教过《妙闻集》里那一句：卡帕与月，皮塔与日，瓦塔与风。第二个星期，你听见助教对全班说：「卡帕就是月亮，皮塔就是太阳，瓦塔就是风。」这重要吗？你要他改什么？",
  "options": [
   {
    "label": "A",
    "text_en": "It does not matter. The image is what students remember, \"is\" lands harder in a room than \"as\", so leave his sentence as it is.",
    "text_zh": "不重要。学生记住的是那个意象，在教室里说「就是」比说「如同」更有力量，让他这样说下去就好。",
    "correct": false,
    "note": "Wrong, and it is the tempting one, because the flatter sentence really does land harder. It also states something the verse does not say, and a teacher who trades accuracy for impact has nothing left to defend when a student checks."
   },
   {
    "label": "B",
    "text_en": "It matters. Put \"as\" back: these three hold the body as moon, sun and wind hold the world, then teach the verse's three verbs.",
    "text_zh": "重要。把「如同」放回去：这三者支撑身体，如同月、日、风支撑世界，然后教这一颂的三个动词。",
    "correct": true,
    "note": "Correct. The verse is a simile, built on \"as ... so\". The moment a comparison becomes an identity you have left the text and started selling something, and the three functions it assigns, giving out, drawing away, distributing, are verbs, which is what dosing is made of."
   },
   {
    "label": "C",
    "text_en": "Drop the verse. Moon and sun language sounds like astrology, and it costs you the sceptical students you most want to keep.",
    "text_zh": "把这一颂整个拿掉。日月这一套听起来像占星，会让你最想留住的那些怀疑派学生流失。",
    "correct": false,
    "note": "Wrong. It throws away a real line from a real text because it sounds unscientific. What earns the sceptical student is the honest version of the verse, not silence about it."
   },
   {
    "label": "D",
    "text_en": "Simplify it: tell them the moon stands for water, the sun for fire and the wind for air, and go back to teaching the five elements.",
    "text_zh": "把它简化：告诉他们月代表水，日代表火，风代表风元素，然后回去教五大元素就好。",
    "correct": false,
    "note": "Wrong. It swaps a verb list for a noun list and loses what the verse was for. \"Kapha is water\" tells a teacher nothing to do on Tuesday morning. \"Kapha is what gives out and builds\" does."
   }
  ],
  "explanationExpected_en": "Say that the verse is a simile, built on \"as ... so\": kapha, pitta and vata hold the body as the moon, the sun and the wind hold the world. Keep the word \"as\" every single time, because turning a comparison into an identity leaves the text. Then give the three functions the verse assigns, releasing and moistening, drawing away and consuming, throwing about and distributing, and say why a list of verbs is more useful to a teacher than a list of nouns.",
  "explanationExpected_zh": "说明这一颂是一个比喻，结构是「如同……那样……」：卡帕、皮塔、瓦塔支撑身体，如同月、日、风支撑世界。每一次教都要把「如同」留在句子里，因为把比喻变成等同，就已经离开了经文。然后说出这一颂给三者安排的功能：释放与滋润、收取与消耗、抛散与推动，并说明为什么一串动词对老师比一串名词更有用。",
  "teacherPoint": "Teach the moon, sun and wind line as a simile and hand students three verbs, so the image gives them something to dose with instead of a slogan.",
  "id": "DOS07"
 },
 {
  "lecture": "Three Doshas",
  "topic": "wait-three-weeks-before-reading",
  "stem_en": "A new student's first class: quick, very flexible, talks fast, barely sweats, forgets the order twice. Afterwards your assistant asks you what her dosha is so he can plan her practice. What is the right answer?",
  "stem_zh": "一位新学生的第一堂课：快，非常柔软，说话快，几乎不出汗，顺序忘了两次。课后你的助教问你她是哪一种督夏，好安排她的练习。正确的回答是什么？",
  "options": [
   {
    "label": "A",
    "text_en": "Give the read now while the first impression is fresh, and adjust later if it turns out to be wrong.",
    "text_zh": "趁第一印象还新鲜，现在就给出判断，以后发现错了再调整就好。",
    "correct": false,
    "note": "Wrong. A first class is contaminated by nerves and novelty, and a read given early hardens into a plan that nobody revisits. Quick and flexible on day one may simply be frightened."
   },
   {
    "label": "B",
    "text_en": "Have her fill in a written questionnaire, so the plan rests on something objective rather than on a hunch.",
    "text_zh": "让她填一份书面问卷，这样练习的安排就有客观依据，而不是凭感觉。",
    "correct": false,
    "note": "Wrong. This is the online quiz in a new costume. It looks objective, reads nothing, and gives the whole shala false confidence in a form."
   },
   {
    "label": "C",
    "text_en": "Ask her about her sleep, her appetite and whether she runs hot or cold, and set this week's dose from her answers.",
    "text_zh": "问她的睡眠、食欲、怕冷还是怕热，然后按她的回答把这一周的剂量定下来。",
    "correct": false,
    "note": "Wrong. Asking is fine, dosing on it today is not. It is still day one, and what she reports is what she believes about herself, which is where the quiz got its answers too."
   },
   {
    "label": "D",
    "text_en": "Say you do not know yet, and that you will decide after three weeks of watching what hour she actually arrives.",
    "text_zh": "说你还不知道，要看三个星期，看她到底什么时候来，然后再决定。",
    "correct": true,
    "note": "Correct. Attendance pattern over three weeks tells you what body language on day one cannot, and saying \"I do not know yet\" in front of an assistant sets the culture of the shala."
   }
  ],
  "explanationExpected_en": "Explain that what you need is the attendance pattern, not the first impression, because nerves and novelty distort a first class. Three weeks of arrival times tells you something the body and the self-description could not. Add that the read is a working tendency, so it must rest on behaviour over time.",
  "explanationExpected_zh": "说明你需要的是出勤模式，不是第一印象，因为紧张和新鲜感会扭曲第一堂课。三个星期的到场时间，会告诉你身体和她的自述都没有说出来的事。并补充：这个判断读的是当下的倾向，所以必须建立在一段时间的行为上。",
  "teacherPoint": "Hold a read for three weeks and base it on when a student actually arrives, and say \"I do not know yet\" in front of your staff.",
  "id": "DOS08"
 },
 {
  "lecture": "Three Doshas",
  "topic": "bandha-direction-correction",
  "stem_en": "Your assistant is leading the room and says: \"Mula bandha sends prana down, uddiyana bandha lifts apana up.\" After class a student who has been reading comes to ask you which way round it is. What do you tell her?",
  "stem_zh": "你的助教在带口令课时对全班说：「根锁把 prāṇa 向下送，脐锁把 apāna 向上提。」下课后，一位读过一些书的学生来问你：到底是哪个方向？你怎么说？",
  "options": [
   {
    "label": "A",
    "text_en": "Tell her different books say it differently, so the direction does not matter as long as she can feel the lift.",
    "text_zh": "告诉她不同的书说法不一样，所以方向不重要，只要她感觉得到那个上提就行。",
    "correct": false,
    "note": "Wrong. It is not a matter of taste. Only one version is even physically coherent, because two things moving apart can never meet, and the student who is reading will catch you."
   },
   {
    "label": "B",
    "text_en": "Drop the wind names from your teaching and cue the bandhas physically instead, since that is what a student can act on.",
    "text_zh": "以后不再用这两个风的名字，改用纯身体的指令教收束法，因为学生真正能照做的是身体指令。",
    "correct": false,
    "note": "Wrong. The physical cue is good and the retreat is not. Losing the two names loses the one fact that shows a student her bandhas and the medical texts are made of the same material."
   },
   {
    "label": "C",
    "text_en": "Tell her he has it backwards: mula bandha draws apana up, uddiyana draws prana down, and the two meet at the navel fire.",
    "text_zh": "告诉她他说反了：根锁把 apāna 向上提，脐锁把 prāṇa 向下引，两者在脐周的火相遇。",
    "correct": true,
    "note": "Correct. That is the classical hatha statement and the only version that makes physical sense. Correcting it in front of the student who asked is also how you keep a room where people read."
   },
   {
    "label": "D",
    "text_en": "Tell her both winds are drawn upward, because lift is what the bandhas are for, and the two names describe the same movement.",
    "text_zh": "告诉她两股气都是向上提的，因为收束法本来就是为了「提」，这两个名字说的是同一个动作。",
    "correct": false,
    "note": "Wrong, and it is the common muddle. The two winds are not two names for one movement, and if both travel the same way nothing meets. Uddiyana draws prana down to where apana is rising, and that meeting at the navel fire is the whole point of the pair."
   }
  ],
  "explanationExpected_en": "Give the direction plainly: mula bandha draws apana upward, uddiyana bandha draws prana downward, and they meet at the fire around the navel. Give the physical reason, that two things moving apart cannot meet. Then say why it is worth getting right: prana and apana are also two of vata's five winds, the vocabulary is shared and both traditions inherited it, so the student who hears it stated correctly finds out she has been working with this material for years.",
  "explanationExpected_zh": "把方向说清楚：根锁把 apāna 向上提，脐锁把 prāṇa 向下引，两者在脐周的火那里相遇。给出物理上的理由：两个相互远离的东西不可能相遇。然后说明这件事为什么值得说准：prāṇa 和 apāna 也是瓦塔五风中的两个，这套词汇是两个传统共同继承的，谁也没有从谁那里借。学生一旦听对了，就会发现自己已经和这门东西打了好几年交道。",
  "teacherPoint": "Correct a reversed bandha cue on the spot, give the physical reason the direction has to be that way, and use it to show a student that her bandhas and the wind names are the same material.",
  "id": "DOS09"
 },
 {
  "lecture": "Three Doshas",
  "topic": "shala-culture-labels-vs-instructions",
  "stem_en": "Your assistant teacher has started writing \"Vata\", \"Pitta\" or \"Kapha\" on each student's card and telling them their type at the door. Students have begun introducing themselves that way. What is the problem, and what do you ask him to change?",
  "stem_zh": "你的助教开始在每位学生的卡片上写「瓦塔」「皮塔」或「卡帕」，并在学生进门时告诉他们属于哪一型。学生们已经开始这样自我介绍。问题出在哪里？你要他改什么？",
  "options": [
   {
    "label": "A",
    "text_en": "A label is a verdict the student cannot argue with, and it sticks. Ask him to write pace, depth and when to stop instead.",
    "text_zh": "标签是学生无法反驳的判决，会黏很久。让他改成写节奏、深度、什么时候停。",
    "correct": true,
    "note": "Correct. A student can argue with \"I think you need more rhythm and less depth right now\" and cannot easily argue with \"you are a Vata\". One is teaching, the other is handed down from above."
   },
   {
    "label": "B",
    "text_en": "Nothing is wrong with the labels themselves, so send him for training until the type he assigns to a student is accurate.",
    "text_zh": "标签本身没有问题，所以送他去受训练，直到他给学生的判断足够准确。",
    "correct": false,
    "note": "Wrong. Accuracy is not the issue. A more accurate verdict is still a verdict, and it still takes away the student's ability to disagree."
   },
   {
    "label": "C",
    "text_en": "The problem is legal exposure, so ask him to add that this is not medical advice before he tells a student their type.",
    "text_zh": "问题是法律风险，所以让他在告诉学生类型之前，先加一句「这不是医疗建议」。",
    "correct": false,
    "note": "Wrong. A disclaimer protects you and does nothing for the student, who still walks away with the label. The real damage is to how she now sees herself."
   },
   {
    "label": "D",
    "text_en": "The subject is too advanced for students, so ask him to stop discussing Ayurveda with them and keep it for teacher training.",
    "text_zh": "这个主题对学生来说太深，所以让他不要再和学生谈阿育吠陀，留到师资培训里讲。",
    "correct": false,
    "note": "Wrong. It throws away a usable dosing instrument instead of correcting how it is spoken. The fix is the sentence, not the silence."
   }
  ],
  "explanationExpected_en": "Explain that a dosha read presented as a type is a claim you cannot support and a label a student cannot argue with, and labels stay on people for years. The usable version is a teaching sentence about how you will teach this person: how fast you introduce a posture, how long a hold, when you stop them.",
  "explanationExpected_zh": "说明把督夏的判断当作「类型」说出来，是一个你无法支撑的论断，也是一个学生无法反驳的标签，而标签会在人身上黏很多年。能用的版本是一句关于「你打算怎么教这个人」的教学话：一个体式多快介绍给他，停留多长，什么时候让他停。",
  "teacherPoint": "Replace type labels in your shala's language with a sentence about pace, depth and stopping that a student is free to disagree with.",
  "id": "DOS10"
 },
 {
  "lecture": "Three Doshas",
  "topic": "movement-carries-the-other-two",
  "stem_en": "A hot, competitive student has an inflamed elbow that will not settle. He is also sleeping four or five hours, flying most weeks since a job change, and eating at whatever hour he lands. Charaka's counts of single dosha disorders run eighty for vata, forty for pitta and twenty for kapha. Where do you put your work first, and why?",
  "stem_zh": "一位体热、好胜的学生，手肘发炎一直不好。他同时每晚只睡四到五个小时，几乎每周都在飞，落地几点就几点吃饭。《遮罗迦集》记载的单一督夏病症数目是瓦塔八十、皮塔四十、卡帕二十。你先把功夫下在哪里？为什么？",
  "options": [
   {
    "label": "A",
    "text_en": "On the elbow itself: take out chaturanga, rebuild the sequence around it, and change nothing else in his week until the pain settles.",
    "text_zh": "先处理手肘本身：不做四柱，围绕它重建序列，在疼痛缓解之前，他这一周其他都不动。",
    "correct": false,
    "note": "Wrong. It treats the site of the fire and leaves the thing that keeps carrying it around. The elbow settles, then the next joint goes, and the teacher calls it bad luck."
   },
   {
    "label": "B",
    "text_en": "Give him a full week away from the shala so that the elbow and the sleep both recover, then start him again where he stopped.",
    "text_zh": "给他一整周不来练习中心，让手肘和睡眠都恢复，然后从他停下的地方重新开始。",
    "correct": false,
    "note": "Wrong, and well intentioned. A week of absence adds one more irregularity to a life already made of them, and he comes back to the same schedule that produced the elbow."
   },
   {
    "label": "C",
    "text_en": "Refer the elbow to a doctor, and leave the rest of his practice exactly as it is until the doctor has cleared him to train.",
    "text_zh": "把手肘转介给医生，在医生放行让他练之前，他练习的其他部分完全照旧。",
    "correct": false,
    "note": "Wrong. Referring out is right and stopping there is not. Waiting is not neutral: the irregularity keeps running while you wait, and the irregularity was the part inside your scope from the beginning."
   },
   {
    "label": "D",
    "text_en": "Refer the elbow out and work first on the irregularity: fixed hour, sleep, food, steady count. Fire on its own does not travel.",
    "text_zh": "手肘转介出去，先处理不规律：固定时间，睡眠，吃饭，稳定的节奏。火自己不会走。",
    "correct": true,
    "note": "Correct. Vata is the dosha that moves the other two, which is why the tradition counts it as the most dangerous and why its disorder count is the largest. Fix the carrier and the local fire has somewhere to settle."
   }
  ],
  "explanationExpected_en": "Explain that vata is movement, and movement is what distributes anything wrong around the body. Fire on its own sits still and water on its own sits still, so nothing travels unless something carries it. That is why the tradition treats wind as the most dangerous of the three and why its number is the largest. Send the elbow to a doctor, because that part is not your work, and put your own work on the irregularity, because the carrier is what you can reach every morning.",
  "explanationExpected_zh": "说明瓦塔是「动」，而「动」正是把出问题的东西带到身体各处的那股力量。火自己不会走，水自己不会走，没有东西带，它就到不了别处。这就是传统把风看作三者中最危险的一个的理由，也是它的数目最大的理由。手肘转介给医生，因为那不是你的工作；你自己的功夫下在不规律上，因为「带东西的那个」才是你每天早晨能碰到的部分。",
  "teacherPoint": "When a hot local problem sits on top of an irregular life, refer the joint out and put your own work on the irregularity, and say the reason in one sentence.",
  "id": "DOS11"
 },
 {
  "lecture": "Three Doshas",
  "topic": "parampara-edit-for-your-room",
  "stem_en": "You open a small shala in your city and are planning your first Ayurveda workshop. You want to include all fifteen subtypes, the full transmission chain and every citation in your notes, because you do not want to lose anything your teacher gave you. What should you actually do?",
  "stem_zh": "你在自己的城市开了一间小的练习中心，正在准备第一场阿育吠陀工作坊。你想把十五个亚型、完整的传承链条、笔记里的每一处出处全部放进去，因为你不想丢掉老师给你的任何东西。你实际上该怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Teach all of it. A teacher passes on what he received without shortening it, and a paying workshop deserves the complete material, not a summary of it.",
    "text_zh": "全部教。老师要把领受的东西原样传下去，不做删减；付费来上工作坊的学生，值得拿到完整的材料，而不是一份摘要。",
    "correct": false,
    "note": "Wrong. Fifteen names on a slide is a memory test, and memory tests are not teaching. This is loyalty to the material at the expense of the people in the room."
   },
   {
    "label": "B",
    "text_en": "Teach none of it in your first year, and stay with postures until your community is larger and your students readier for theory.",
    "text_zh": "第一年这门东西一点都不要教，先专心教体式，等社群大一些、学生也更能坐下来听理论的时候再说。",
    "correct": false,
    "note": "Wrong. Withholding for a year removes the thing that makes a young shala worth travelling to, and the caution is about her confidence, not about her students."
   },
   {
    "label": "C",
    "text_en": "Cut it to the one fact that changes practice: prana and apana, the winds inside their bandhas, are two of vata's five. Editing is what lineage means.",
    "text_zh": "砍到那个改变练习的事实：prāṇa 和 apāna 就在他们的收束法里，是瓦塔五风中的两个。删减，就是传承的意思。",
    "correct": true,
    "note": "Correct. Brahma cut a hundred thousand verses down to something people could hold, and every teacher since has narrowed the material for the students actually in front of him. That is parampara, not dilution."
   },
   {
    "label": "D",
    "text_en": "Send your students to your own teacher's course instead, since you are not senior enough to teach this material to a paying room yet.",
    "text_zh": "把你的学生介绍去上你自己老师的课，因为你现在还不够资深，不该对一个付费的教室教这部分材料。",
    "correct": false,
    "note": "Wrong. It turns a young shala into a referral desk. Parampara means narrowing the teaching for your own room, not handing your students back up the chain."
   }
  ],
  "explanationExpected_en": "Say that the tradition itself edits: Brahma reduced a hundred thousand verses to eight branches so people could actually hold it, and each teacher since has narrowed the material for the students in front of him. Then name the one fact worth teaching first, that prana and apana are two of vata's five winds and her students have been working with them in the bandhas for years, and say that cutting to it is loyalty to the lineage rather than a compromise.",
  "explanationExpected_zh": "说明传统本身就在做删减：梵天把十万颂删成八支，小到人真的拿得动，而此后每一代老师都在为眼前的学生做删减。然后说出最该先教的那个事实：prāṇa 和 apāna 是瓦塔五风中的两个，而她的学生在收束法里已经和它们打了好几年交道。并指出：砍到这一点，是对传承的忠诚，不是妥协。",
  "teacherPoint": "Plan a workshop by cutting the material down to the one fact that changes practice, and defend the cut as what the lineage does rather than as a compromise.",
  "id": "DOS12"
 },
 {
  "lecture": "Shoulder Screening",
  "topic": "painless-weakness-refer-not-program",
  "stem_en": "A student who has practised with you for two years mentions her right shoulder feels \"a bit tired\". You test resisted external rotation on both sides with the elbow held against the ribs. The right side is clearly weaker than the left, and she says it does not hurt at all. What do you do?",
  "stem_zh": "一位跟你练了两年的学生说她的右肩「有点累」。你在两侧都做抗阻外旋测试，手肘夹紧肋骨。右侧明显比左侧无力，而她说完全不痛。你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Put the right side on a six week strengthening plan and test her again at the end.",
    "text_zh": "给右侧安排一套六周的力量训练，六周后再重测。",
    "correct": false,
    "note": "Right prescription, wrong student. A gap that came from habit is closed by training, but weakness that does not hurt suggests something structural or a nerve. Six weeks of loading delays the referral she needs."
   },
   {
    "label": "B",
    "text_en": "Tell her that since nothing hurts, nothing is wrong, and leave her practice as it is.",
    "text_zh": "告诉她既然不痛就没有什么问题，练习保持原样。",
    "correct": false,
    "note": "Treats pain as the only signal worth having. Force against your hand is the more objective finding, and external rotation weakness is often painless, so \"a bit tired\" can sit on top of a real problem."
   },
   {
    "label": "C",
    "text_en": "Stop loading that shoulder, note the finding, and have it checked before loading again.",
    "text_zh": "停止负荷那个肩膀，记下发现，先检查再上负荷。",
    "correct": true,
    "note": "Painless weakness is the referral pattern, and it is the one teachers let slide because nobody is complaining. Stop the load, record the finding, hand it over."
   },
   {
    "label": "D",
    "text_en": "Tell her the external rotators are probably torn and that she should rest for six weeks.",
    "text_zh": "告诉她外旋的那几条肌肉可能已经撕裂，让她休息六周。",
    "correct": false,
    "note": "Naming an injury is diagnosis and outside a teacher's scope, and the timeline is not yours to give. It frightens her and may simply be untrue."
   }
  ],
  "explanationExpected_en": "Says the finding is weakness without pain, that this pattern points to something structural or a nerve, and that the action is to stop loading and refer, with no injury name and no timeline given to the student.",
  "explanationExpected_zh": "指出这个发现是「不痛的无力」，说明这个模式提示结构性或神经问题，因此要停止负荷并转介；不给损伤命名，也不告诉她需要多久。",
  "teacherPoint": "Refer a weak shoulder that does not hurt, instead of writing it a training plan.",
  "id": "SHO01"
 },
 {
  "lecture": "Shoulder Screening",
  "topic": "closing-a-gap-volume-and-order",
  "stem_en": "A student broke her left wrist three months ago and came out of the cast two weeks ago. Her doctor has cleared her for full practice. Her left shoulder now tests clearly weaker than her right in every direction. She has no pain and nothing on the red flag list. What do you give her?",
  "stem_zh": "一位学生三个月前左手腕骨折，两周前刚拆石膏，医生已经允许她恢复完整练习。现在她的左肩在每个方向上都明显比右肩弱。她没有疼痛，危险信号一条都没有。你给她什么？",
  "options": [
   {
    "label": "A",
    "text_en": "Equal sets on the left and on the right, with both sides trained in the same order each session.",
    "text_zh": "左右两侧做同样的组数，每次训练的先后顺序也相同。",
    "correct": false,
    "note": "The commonest mistake in the room, and it feels like the fair thing to do. Both sides improve at a similar rate, so matching them keeps the gap exactly where it is."
   },
   {
    "label": "B",
    "text_en": "The push and pull she knows, three sets left to one right, left side first, retest at six weeks.",
    "text_zh": "她会的一推一拉，左三组对右一组，先做左侧，六周后重测。",
    "correct": true,
    "note": "Uneven volume is what moves an uneven strength, and the weak side goes first because it is fresh and sets the number the strong side then matches. Two movements she knows, not five new ones."
   },
   {
    "label": "C",
    "text_en": "Sets on the strong right side only, letting that strength carry across to the weak left one.",
    "text_zh": "只在强的右侧做组数，让那边长出来的力量迁移到弱的左侧。",
    "correct": false,
    "note": "The right principle at the wrong moment. Training one side does carry across to the other, and that is what you use while a limb cannot be loaded at all. Hers can be loaded now, so load it."
   },
   {
    "label": "D",
    "text_en": "The same push and pull, three sets left to one right, but the strong right side going first each time.",
    "text_zh": "同样的一推一拉，左三组对右一组，但每次先做的都是强的右侧。",
    "correct": false,
    "note": "Order is not a detail here. The weak side produces most at the start of the set, so it should set the number. Put it second and it spends every session reaching for a figure it cannot hit tired."
   }
  ],
  "explanationExpected_en": "Says the weak side needs more volume than the strong side rather than equal volume, that it is trained first because it is fresh and sets the repetitions, that the movements should be ones she already knows rather than new ones, and that this is measured in weeks.",
  "explanationExpected_zh": "说明弱侧需要的是比强侧更多的训练量，而不是两边一样；先练弱侧，因为它在开始时最有力，由它决定次数；动作要用她已经会的，不是新加一堆；而且这件事要以周来计。",
  "teacherPoint": "Write the plan for a genuinely weak side: more sets on the weak side, weak side first, movements she already knows.",
  "id": "SHO02"
 },
 {
  "lecture": "Shoulder Screening",
  "topic": "normal-soreness-beginner-caturanga",
  "stem_en": "A beginner three weeks in says her shoulders ache the day after practice, more on days with many Sūrya Namaskāras. It is the same on both sides, nothing wakes her at night, and she holds both arms firmly against your hand. She asks whether she is damaging herself. What do you do?",
  "stem_zh": "一位入门三周的学生说，练完的第二天两侧肩膀都酸，拜日式做得多的日子更酸。两侧一样，夜里不会痛醒，在你手下两只手臂都顶得很稳。她问自己是不是在把身体练坏。你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Tell her plainly this is the ache of new work, check her Caturaṅga elbows and depth, and keep her going.",
    "text_zh": "直接告诉她这是新训练量的酸，检查四肢支撑式的手肘和深度，照常练。",
    "correct": true,
    "note": "Both sides, no weakness, no night pain: this is soreness, not a finding. The useful action is a look at the shape that loads her shoulders most, since flared elbows and shoulders dropping below the elbows is the usual cause of front of shoulder pain."
   },
   {
    "label": "B",
    "text_en": "Take her out of Caturaṅga and every arm balance until she has been completely free of ache for a month.",
    "text_zh": "让她停掉四肢支撑式和所有手臂支撑的动作，直到她整整一个月完全不酸为止。",
    "correct": false,
    "note": "Well meant and costly. It removes the load that builds a shoulder, teaches her that sensation equals damage, and students who are told to stop often stop coming altogether."
   },
   {
    "label": "C",
    "text_en": "Tell her the ache means the tendons are being compressed, and swap her Caturaṅga for rotator cuff stretches.",
    "text_zh": "告诉她这个酸说明她的肌腱正被挤压，把四肢支撑式换成肩袖的拉伸练习。",
    "correct": false,
    "note": "Invents a mechanism you cannot support, and students carry a mechanism for years and repeat it to their own students. It also trades the strength work for stretching, and when class time is limited strength is what protects a shoulder."
   },
   {
    "label": "D",
    "text_en": "Tell her to practise through it and change nothing, since soreness in a beginner always passes on its own.",
    "text_zh": "告诉她练过去就好，什么都不用改，因为初学者的酸痛总会自己过去。",
    "correct": false,
    "note": "Blanket reassurance with no checks. Say this often enough and you will miss the day the pattern changes to one side, to weakness, or to night pain."
   }
  ],
  "explanationExpected_en": "Recognises the pattern as ordinary training soreness (both sides, no weakness, no night pain), says so plainly, and pairs it with a check of her Caturaṅga rather than removing load or inventing a mechanism.",
  "explanationExpected_zh": "认出这是普通的训练酸痛（两侧一样、没有无力、夜里不会痛醒），直接如实告诉她，并检查她的四肢支撑式，而不是减负荷，也不编一个机制。",
  "teacherPoint": "Answer \"am I damaging myself\" with a check of the shape, not with restriction or with blanket reassurance.",
  "id": "SHO03"
 },
 {
  "lecture": "Shoulder Screening",
  "topic": "words-used-to-deliver-a-finding",
  "stem_en": "Your screening shows the left shoulder producing less force than the right in two directions, and the left blade sitting less flat against the ribs. She is left handed, so the weaker side is her dominant one. Nothing on the red flag list is present. You are about to give her the plan. Which sentence do you use?",
  "stem_zh": "你的筛查结果：左肩在两个方向上的出力都比右肩小，左侧肩胛骨也没有右侧贴得平。她是左利手，所以出力小的反而是她的优势侧。危险信号一条都没有。你正要把接下来的计划告诉她。你会用哪一句话？",
  "options": [
   {
    "label": "A",
    "text_en": "\"Your tight right side is shutting the left one down, so release the right first.\"",
    "text_zh": "「你右边太紧，把左边压制住了，所以先把右边松开。」",
    "correct": false,
    "note": "That inhibition mechanism is not established, and it turns a training gap into a story about a body that is broken. She will repeat it to her own students for years."
   },
   {
    "label": "B",
    "text_en": "\"Your left rotator cuff is weak and the blade is winging, so go carefully overhead.\"",
    "text_zh": "「你左边肩袖无力，肩胛骨有翼状，所以过头动作要小心。」",
    "correct": false,
    "note": "A muscle group plus a condition is a diagnosis, which sits outside a teacher's scope. It also hands her a reason to be careful of her own arms, and careful shoulders get weaker, not stronger."
   },
   {
    "label": "C",
    "text_en": "\"I did not find anything worth changing, so let's carry on exactly as before.\"",
    "text_zh": "「我没查出什么需要改的，所以照以前那样练就好。」",
    "correct": false,
    "note": "You did find something usable, and in her case it is the reverse of the expected pattern. Saying nothing means nothing changes, and the same gap will still be there in six months."
   },
   {
    "label": "D",
    "text_en": "\"This side is doing less work than the other one, so let's give it more.\"",
    "text_zh": "「这一侧做的工作比另外一侧少，所以我们给它多一点。」",
    "correct": true,
    "note": "Same instruction, same behaviour afterwards, and no story the evidence cannot carry. No muscle name, no injury, no mechanism."
   }
  ],
  "explanationExpected_en": "Chooses the sentence that changes what the student does without naming a muscle, an injury, or a mechanism, and explains that the other three either diagnose, frighten, or leave the gap untouched.",
  "explanationExpected_zh": "选那句能改变学生行为、却不涉及肌肉名称、损伤名称或机制的话，并说明另外三句要么是在诊断，要么是在吓人，要么让差距原样不动。",
  "teacherPoint": "Deliver a screening finding in one sentence that contains no muscle name and no diagnosis.",
  "id": "SHO04"
 },
 {
  "lecture": "Shoulder Screening",
  "topic": "sore-shoulder-get-the-answer-without-provoking-pain",
  "stem_en": "A student's right shoulder is sore today, and you want to know whether it still holds against your hand in the lifting direction. She winces as soon as she turns her thumbs down for the empty can, before you have pressed at all. What do you do?",
  "stem_zh": "一位学生今天右肩很痛，而你想知道它在上抬方向上还顶不顶得住你的手。你还没开始下压，她一把拇指转向下摆出空罐测试的姿势就皱眉。你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Press through the wince on both sides anyway, and take the pain she reports as your positive result.",
    "text_zh": "照压不误，两侧都压下去，把她报出来的痛当成阳性结果。",
    "correct": false,
    "note": "Pain is the weakest of the three signals and it is not what makes this test accurate. Hurting a sore student for a low value result also costs you her trust for every test after it."
   },
   {
    "label": "B",
    "text_en": "Switch to the full can, thumbs up, press both sides at once, and read the hold, not the pain.",
    "text_zh": "改用满罐测试，拇指朝上，两侧同时压，读顶不顶得住，不读痛。",
    "correct": true,
    "note": "The full can loads the same muscle to a similar level with less pain provoked, and accuracy in both versions is highest when weakness rather than pain is taken as the positive sign (Itoi: full can 75%, empty can 70%)."
   },
   {
    "label": "C",
    "text_en": "Skip the testing today, and modify every overhead shape in her practice for the next month.",
    "text_zh": "今天跳过测试，保险起见，把她练习里过头的动作全都改掉一个月。",
    "correct": false,
    "note": "Well meant, and it spends a month of her practice on information one minute of testing would have given you. It also teaches her that a sore shoulder means a smaller practice."
   },
   {
    "label": "D",
    "text_en": "Test the sore right side on its own, and leave the left arm out so it does not get tired too.",
    "text_zh": "只单独测痛的右侧，把左手臂放着不动，免得连它也跟着累。",
    "correct": false,
    "note": "Without her other side you have no normal to compare against, and every finding in this lecture is a comparison. Pressing both at once is what makes a difference obvious in your hands."
   }
  ],
  "explanationExpected_en": "Says the full can loads the same muscle with less pain provoked, that weakness rather than pain is what makes either version accurate, and that both sides are pressed together so the difference can be felt.",
  "explanationExpected_zh": "说明满罐测试负荷的是同一块肌肉但更不痛，两个版本的准确率都建立在读「无力」上，而且两侧同时压才能感觉出差别。",
  "teacherPoint": "Get the answer out of a sore student without provoking pain: full can, both sides at once, read weakness.",
  "id": "SHO05"
 },
 {
  "lecture": "Shoulder Screening",
  "topic": "one-positive-biceps-test-modify-not-diagnose",
  "stem_en": "A student has pain at the front of the right shoulder in Ūrdhva Mukha Śvānāsana. He points to it with one fingertip, in the groove at the front of the upper arm. The upper cut test reproduces it. Yergason's and Speed's do not. What do you do?",
  "stem_zh": "一位学生做上犬式时右肩前方痛。他用一根手指指出来，位置在上臂前方的那条沟槽里。上勾拳测试能复现这个痛，Yergason 测试和 Speed 测试都不痛。你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Tell him the long head of the biceps tendon is inflamed, and take him out of Ūrdhva Mukha and all binds.",
    "text_zh": "告诉他肱二头肌长头的肌腱发炎了，让他停掉上犬式和所有缠绕动作。",
    "correct": false,
    "note": "Two errors in one answer: naming a tissue and a condition is diagnosis, and removing the shapes entirely is more than one positive of three supports. He loses practice and gains a fear."
   },
   {
    "label": "B",
    "text_en": "Treat it as nothing and let him carry on as before, since two of the three biceps tests came back clean.",
    "text_zh": "当作没事，让他照常练下去，因为三个肱二头肌的测试里有两个是干净的。",
    "correct": false,
    "note": "The upper cut is the most accurate single test of the three, and he can point to the groove with one finger. That is the clearest information you have, and ignoring it leaves the same load running every day."
   },
   {
    "label": "C",
    "text_en": "Drop Ūrdhva Mukha to cobra height for a few weeks, put a strap in the Marīcyāsana binds, and reassess.",
    "text_zh": "把上犬式降到眼镜蛇高度做几周，玛里琪式的缠绕给绳子，之后重测。",
    "correct": true,
    "note": "One positive of three earns a change in the shapes that drag the tendon through its groove, and nothing said to the student about his tendon. The poses still do their job for the spine and the hip."
   },
   {
    "label": "D",
    "text_en": "Press hard into the groove on the right arm to confirm the tenderness before you decide anything else.",
    "text_zh": "用力按压右臂那条沟槽，先确认那里的压痛，再决定要不要改动。",
    "correct": false,
    "note": "A completely normal tendon is tender under a hard press, so hard pressure manufactures a positive on almost anybody. Light pressure, identical on both arms, or the comparison is worthless."
   }
  ],
  "explanationExpected_en": "States that one positive of three biceps tests justifies modifying the shapes that load the groove for a few weeks, and does not justify telling the student anything about his tendon.",
  "explanationExpected_zh": "说明三个肱二头肌测试里只有一个阳性，理由只够把负荷那条沟槽的体式改几周，不够跟学生讲他的肌腱怎么了。",
  "teacherPoint": "Convert one positive biceps test into a change in two shapes for a few weeks, and say nothing about the tendon.",
  "id": "SHO06"
 },
 {
  "lecture": "Shoulder Screening",
  "topic": "cross-body-negative-rules-out",
  "stem_en": "A student's pain sits on top of the right shoulder in the last part of lifting the arm overhead. You run the cross-body test: you take her relaxed arm across the chest and it produces no pain on top of the shoulder at all. What have you learned?",
  "stem_zh": "一位学生的痛出现在手臂快举到最高的时候，位置在肩膀顶部。你做横过身体测试：把她放松的手臂带过胸前，肩膀顶部完全不痛。你得到了什么信息？",
  "options": [
   {
    "label": "A",
    "text_en": "Only a positive result tells you anything about a structure, so you have learned very little.",
    "text_zh": "只有阳性结果才说明得了某个结构的问题，所以你几乎没学到什么。",
    "correct": false,
    "note": "Backwards for this test. Its positive predictive value is about 20% and its negative about 98%, so the clean result is the one actually worth having."
   },
   {
    "label": "B",
    "text_en": "Nothing at all is wrong with the shoulder, so she can carry on practising as before.",
    "text_zh": "这个肩膀完全没有问题，所以她可以照以前那样继续练下去。",
    "correct": false,
    "note": "One clean screening test clears one structure, not a shoulder. Her pain at the top of the range is still unexplained and still needs a modification and a follow-up."
   },
   {
    "label": "C",
    "text_en": "The pain must be coming from muscle, so more strengthening of the cuff is what she needs.",
    "text_zh": "痛一定是肌肉来的，所以给肩袖加更多力量训练才是答案。",
    "correct": false,
    "note": "Jumps from one negative test to a named cause. A screening test tells you where to look next, it never explains why something hurts."
   },
   {
    "label": "D",
    "text_en": "This test rules out far better than it rules in, so look elsewhere for the source.",
    "text_zh": "这个测试排除的能力远比确认强，所以要往别处找痛的来源。",
    "correct": true,
    "note": "Use it in the direction it is good in. A negative is right about 98% of the time, while only about one positive in five is a real problem there, so a positive is never something you announce."
   }
  ],
  "explanationExpected_en": "Explains that this test rules the joint out far better than it rules it in, so a clean result means the source is probably elsewhere, and adds that her pain at the top of the range is still unexplained and still needs a modification and a follow-up.",
  "explanationExpected_zh": "说明这个测试「排除」的能力远强于「确认」，所以阴性的意思是痛的来源多半在别处；同时指出她在活动范围顶端的痛仍未解释，仍然需要调整和随访。",
  "teacherPoint": "Take the useful information from a clean cross-body test, and never name a joint on a positive one.",
  "id": "SHO07"
 },
 {
  "lecture": "Shoulder Screening",
  "topic": "winging-blade-what-you-may-conclude",
  "stem_en": "In a wall push-up you watch from behind and the inner edge of the left blade peels away from the ribs. The right stays flat. The student has no pain. What is the right next step?",
  "stem_zh": "推墙测试时你站在后面看，左侧肩胛骨的内侧缘从肋骨上翘起来，右侧保持贴平。学生没有疼痛。下一步怎么做才对？",
  "options": [
   {
    "label": "A",
    "text_en": "Tell her the serratus anterior is not holding the blade down, and give her serratus drills to fix it.",
    "text_zh": "告诉她是前锯肌没有把肩胛骨按住，给她一套前锯肌的强化训练。",
    "correct": false,
    "note": "This test was positive in all fifty patients with abnormal blade movement, and only about one in ten of them actually had that muscle at fault. You have announced a cause you cannot know, to someone with no pain."
   },
   {
    "label": "B",
    "text_en": "Do nothing at all here, since blade movement like this shows up in about half of all people with no pain.",
    "text_zh": "什么都不用做，因为将近一半没有任何疼痛的人都有这样的肩胛骨活动。",
    "correct": false,
    "note": "Over-corrected the other way. The 48% figure means you cannot diagnose from a moving blade, not that a side plainly doing less work should be left alone."
   },
   {
    "label": "C",
    "text_en": "Keep her out of every overhead posture until both of her shoulder blades stay flat against the ribs.",
    "text_zh": "在她两侧肩胛骨都能贴平肋骨之前，不让她做任何过头的体式。",
    "correct": false,
    "note": "Well meant and harmful. Overhead loading is what builds the base, and removing it hands a pain free student a reason to believe something is wrong with her."
   },
   {
    "label": "D",
    "text_en": "Retest with resisted shoulder flexion at about 100 degrees, watch the blade, then load that side more.",
    "text_zh": "改测约 100 度的抗阻肩前屈，看着肩胛骨，然后给这侧加量。",
    "correct": true,
    "note": "The high resisted test separates the causes the wall push-up cannot separate. Then train the side that is doing less, and keep the muscle name out of the room."
   }
  ],
  "explanationExpected_en": "States that a lifting blade tells you that side is doing less work but not which muscle or nerve is behind it, and that resisted shoulder flexion at about 100 degrees is the follow-up that can separate them.",
  "explanationExpected_zh": "说明肩胛骨翘起只能告诉你这一侧工作做得少，不能告诉你是哪块肌肉或哪条神经，而约 100 度的抗阻肩前屈才是能区分开的下一步。",
  "teacherPoint": "Follow a winging blade with the high resisted flexion test, and train the side without naming a muscle to the student.",
  "id": "SHO08"
 },
 {
  "lecture": "Shoulder Screening",
  "topic": "dominant-side-gap-direction-over-size",
  "stem_en": "A right-handed student tests about 15% stronger on the right shoulder than on the left. She has no pain and no red flags. She has read that a 10% side-to-side difference means injury risk, and asks whether she should worry. What do you tell her, and what do you do?",
  "stem_zh": "一位右利手的学生，右肩测出来比左肩强约 15%。她没有疼痛，也没有任何危险信号。她看到过一个说法：两侧相差 10% 就意味着受伤风险，于是问你要不要担心。你怎么跟她说，怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Tell her a stronger dominant side is normal, and act only if the left tests stronger or a fall came first.",
    "text_zh": "告诉她优势侧本来就更强，只有左侧更强或先摔过一次，才需要处理。",
    "correct": true,
    "note": "Healthy shoulders average about 17.3% in favour of the dominant side, the largest asymmetry in the upper limb. Direction and history make a gap a finding, size does not."
   },
   {
    "label": "B",
    "text_en": "Tell her she is right to be worried, and build a corrective programme for the left side, retested monthly.",
    "text_zh": "告诉她担心得没错，现在就给左侧安排一套矫正训练，每月复测。",
    "correct": false,
    "note": "That rule flags almost every normal shoulder in the room, including your own. Asymmetry is a weak predictor of injury in any case, so you would be selling her a problem she does not have."
   },
   {
    "label": "C",
    "text_en": "Tell her the two sides should match, and train the left while resting the right until the numbers are equal.",
    "text_zh": "告诉她两侧应该一样，练左边、让右边休息，直到两个数字追平。",
    "correct": false,
    "note": "Detraining a strong side to close a gap makes the whole student weaker, and it is not what closes a gap in any case."
   },
   {
    "label": "D",
    "text_en": "Tell her numbers from studies do not apply to yoga practitioners, and leave side-to-side testing out of it.",
    "text_zh": "告诉她研究里的那些数字不适用于瑜伽练习者，两侧对比测试可以不做。",
    "correct": false,
    "note": "Throws away the most objective thing your hands can measure without equipment. The fix is to read size and direction correctly, not to stop testing."
   }
  ],
  "explanationExpected_en": "Says a stronger dominant side is the normal pattern (healthy average about 17.3%), so 15% on the right of a right-hander is not a finding, and names what would make it one: the non-dominant side stronger, or a gap that appeared after a specific event.",
  "explanationExpected_zh": "说明优势侧更强是正常模式（健康人平均约 17.3%），所以右利手右侧强 15% 不算发现；并说出什么情况下才算：非优势侧反而更强，或者差距是在某个具体事件之后出现的。",
  "teacherPoint": "Read a side-to-side gap by its direction and its history, not by its size.",
  "id": "SHO09"
 },
 {
  "lecture": "Five Kleshas",
  "topic": "pain-signal-vs-story-knee",
  "stem_en": "A student in your Mysore room has had discomfort in the right knee for three weeks. Today she says \"my knees are bad\", then pushes harder into the posture to prove it is not true, and her breath goes short. The knee is worse at the end of practice than at the start. What do you do first?",
  "stem_zh": "你 Mysore 教室里的一位学生，右膝已经不舒服三周了。今天她说「我的膝盖不行」，然后为了证明不是这样，更用力地压进体式里，呼吸变短。练完时，膝盖比开始时更糟。你首先做什么？",
  "options": [
   {
    "label": "A",
    "text_en": "Tell her the knee will settle once her hips open, and keep her in the same postures so she does not lose ground.",
    "text_zh": "告诉她等到髋打开了，膝盖自然会好，并让她继续练同样的体式，免得练习退步。",
    "correct": false,
    "note": "Wrong. This teacher has treated a real signal as something to wait out, and has left the sentence \"my knees are bad\" standing. The student keeps loading a joint that is asking for less, now with the teacher's permission, and the story hardens into an identity while the tissue gets worse."
   },
   {
    "label": "B",
    "text_en": "Ask her to name three facts about the sensation: what kind, exactly where, and at which breath it arrives. Then stop asking.",
    "text_zh": "请她说出关于这个感觉的三个事实：哪一种、具体在哪里、第几个呼吸时出现。然后不要再问。",
    "correct": true,
    "note": "Correct. Sensation described as data separates the body's signal from what the mind is adding. \"Sharp, inside the joint, on the third breath\" is data. \"My knees are bad\" is a story. This is the point where the chain (discomfort, frustration, short breath, more pushing, more pain) can be cut, and the three facts give you real information about the knee at the same time. The instruction to stop asking is part of the method, not politeness."
   },
   {
    "label": "C",
    "text_en": "Build her a permanent bad-knee sequence with every posture that loads the knee taken out, and call that her practice from now on.",
    "text_zh": "给她编一套永久的「膝盖不好」版序列，把所有压到膝盖的体式都去掉，以后就练这一套。",
    "correct": false,
    "note": "Wrong, and well intentioned. Reducing load on that knee today is sensible. Handing her a permanent sequence named after the problem is not. Wholesale removal confirms \"I am a person with bad knees\" and turns a today-fact into a forever-fact, and it trains avoidance across a whole region of the practice. You have answered one klesha by installing another."
   },
   {
    "label": "D",
    "text_en": "Sit her down for a full history: old injuries, the doctor's verdict, her theory of the cause, and any knee trouble in the family.",
    "text_zh": "让她坐下来把病史问全：以前受过什么伤、医生怎么说、她认为的原因、家里有没有人膝盖不好。",
    "correct": false,
    "note": "Wrong, and it feels thorough. More questions produce more story. Three facts and then nothing else is the instruction, because every extra question invites her to explain her knee to you instead of feel it. You end up with a longer narrative, a firmer identity, and the same short breath."
   }
  ],
  "explanationExpected_en": "Pain is the body's signal and suffering is what the mind adds on top. Her frustration shortens the breath, she pushes to prove something, and the knee gets worse, so the signal is real but the escalation is mental. Asking for three facts and then stopping trains her to separate the two, and it also tells me what is actually happening in the joint.",
  "explanationExpected_zh": "痛是身体的信号，苦是心加上去的部分。烦躁让呼吸变短，她为了证明什么而更用力，膝盖就更糟：信号是真的，升级是心的事。让她用三个事实描述感觉、然后不再追问，是在训练她把信号和故事分开，同时也让我知道关节里究竟发生了什么。",
  "teacherPoint": "Turn a student's pain story into three facts (what kind, where exactly, which breath), then stop asking, so the signal and the story come apart in front of both of you.",
  "id": "KLE01"
 },
 {
  "lecture": "Five Kleshas",
  "topic": "asmita-refuses-modification-in-public",
  "stem_en": "A student of four years cannot bind in Marichyasana D and is now compressing his low back to reach. You offer him a strap. He waves you off, glances at the mat next to him, and says \"I've got it.\" The following week he skips the posture whenever he sees you walking toward him. What is the best move?",
  "stem_zh": "一位练了四年的学生，在 Marichyasana D 里绑不上手，现在靠挤压腰椎去够。你递给他一条伸展带，他挥手拒绝，瞟了一眼旁边的垫子，说「我可以」。第二周，他一看见你朝他走过来，就把这个体式跳过去。最好的做法是什么？",
  "options": [
   {
    "label": "A",
    "text_en": "Bind him yourself so that he feels the correct shape and stops arguing with you about the strap.",
    "text_zh": "亲手把他绑上，让他感觉到正确的形状，不再为这条带子跟你较劲。",
    "correct": false,
    "note": "Wrong. A forced bind wins the posture and loses the student. It loads the lumbar spine he is already compressing, and it confirms his fear that help is something done to him while the room watches."
   },
   {
    "label": "B",
    "text_en": "Tell the room that everyone uses a strap at some stage, so he hears there is no shame in it.",
    "text_zh": "当着全教室说，每个人在某个阶段都用过伸展带，让他听见这件事不丢脸。",
    "correct": false,
    "note": "Wrong, and kindly meant. It is still a public statement about him, and every person in the room will decode who it is for. Asmitā does not soften under public exposure, it hardens, and the usual result is that he stops coming."
   },
   {
    "label": "C",
    "text_en": "Leave the posture alone for now, since he is an adult who will ask for help when he wants it.",
    "text_zh": "暂时先不动这个体式，他是个成年人，需要帮助的时候自己会开口。",
    "correct": false,
    "note": "Wrong. He is compressing his low back to reach a bind, and he has already shown he will not ask. Calling that autonomy is the teacher choosing comfort over responsibility, and the injury arrives on schedule."
   },
   {
    "label": "D",
    "text_en": "Hand him the strap privately before the room fills, and say nothing more about it for a month.",
    "text_zh": "在教室还没什么人时，私下把带子交给他，之后一个月不再提这件事。",
    "correct": true,
    "note": "Correct. The refusal is asmitā, a refusal to be a beginner in public, not an opinion about straps. Handed over before anyone is watching it costs him nothing in front of the room, and the daily repetition of the same sequence wears the self-image thin without a teacher having to break it."
   }
  ],
  "explanationExpected_en": "His problem is not the strap, it is being seen as a beginner. That is asmitā, and in a shala it shows up as refusing a modification while others watch, not as arrogance. Breaking an ego in public hardens it, so I give him the task quietly and let the repetition do the work over weeks.",
  "explanationExpected_zh": "他的问题不在于伸展带，而在于被人看见自己是初学者。这就是我执，它在教室里的样子不是傲慢，而是「不肯在别人看着时接受简化」。当众拆一个学生的自我只会让它变硬，所以我私下把工具给他，剩下的交给几周的重复去完成。",
  "teacherPoint": "Hand a proud student their modification privately, before the room fills, and let a month of repetition do what a public correction never will.",
  "id": "KLE02"
 },
 {
  "lecture": "Five Kleshas",
  "topic": "raga-best-day-asking-for-more",
  "stem_en": "A student has her best practice in a year. The room is warm, her jump backs are light, and at the end she asks for the next two postures because \"today my body is finally ready.\" She has held her current last posture steadily for less than a week. What do you do?",
  "stem_zh": "一位学生练出了这一年里最好的一次练习。教室很热，跳回很轻，结束时她请你给她后面两个体式，理由是「今天我的身体终于准备好了」。她目前的最后一个体式，稳定地做下来还不到一周。你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Finish her at the same posture as always, praise the practice, and give nothing new today.",
    "text_zh": "让她在和平常一样的体式结束，称赞今天的练习，今天不给新的。",
    "correct": true,
    "note": "Correct. The peak day is precisely where rāga is manufactured, a pleasure the mind then lies down beside and wants back. Holding the finishing point on the best day of the year is worth more than any lecture on attachment, and postures are given on steadiness over weeks, not on how a morning felt."
   },
   {
    "label": "B",
    "text_en": "Give her one of the two today, putting motivation this strong to use while she has it.",
    "text_zh": "今天先给她其中一个，趁这么强的动力还在，好好把它用起来。",
    "correct": false,
    "note": "Wrong. Half of the same mistake. The reward is still tied to how the day felt, which teaches her that a good day buys postures. That is the lesson she will then practise for the next ten years, and it is the fire being fed."
   },
   {
    "label": "C",
    "text_en": "Give her both today, treating a body this open as clear evidence that she is ready.",
    "text_zh": "今天两个都给，把开成这样的身体当成她已经准备好了的明确证据。",
    "correct": false,
    "note": "Wrong. This reads one warm morning as capacity. It also sets up the reverse reading, where a stiff morning becomes evidence of failure, and it hands her a standard she will spend years trying to reach again."
   },
   {
    "label": "D",
    "text_en": "Tell her that wanting more is rāga, and that she should practise without desire for progress.",
    "text_zh": "告诉她「想要更多」就是贪，练习时不应该带着对进步的欲望。",
    "correct": false,
    "note": "Wrong. Accurate word, useless action. Telling a student not to desire produces a student who hides desire, and she still walks out measuring every future practice against this one. The teaching happens in what you give her today, not in the label."
   }
  ],
  "explanationExpected_en": "Rāga is the residue that lies down after pleasure, so it needs a prior experience and it always points backward at a day that is over. Her best practice in a year is exactly the moment that residue is being laid down. Finishing at the usual point stops the pleasure from becoming a target, and new postures are given when the current one is steady.",
  "explanationExpected_zh": "贪是「随乐而卧」的残余，它需要先前的经验，方向永远向后，指向一个已经过去的日子。她一年里最好的这次练习，正是这份残余被留下的时刻。让她在平常的地方结束，能防止这份快乐变成日后追求的目标；而新体式应当在当前体式稳定之后才给。",
  "teacherPoint": "Hold a student at the same finishing point on their best day of the year, and give new postures on steadiness rather than on mood.",
  "id": "KLE03"
 },
 {
  "lecture": "Five Kleshas",
  "topic": "dvesa-avoided-posture-is-the-map",
  "stem_en": "A student has practised at your shala for a year. The room closes at eight thirty, and for the last six weeks he has arrived twenty minutes late, so he is rolling up his mat before backbends every single time. The reasons are all plausible: traffic, a work call, a sick child. What is the correct reading and the correct action?",
  "stem_zh": "一位学生在你的教室练了一年。教室八点半结束，而最近六周他每次都迟到二十分钟，于是每一次都在后弯之前就把垫子收了。理由都说得通：堵车、一个工作电话、孩子生病。正确的判断和正确的做法是什么？",
  "options": [
   {
    "label": "A",
    "text_en": "Take the reasons at face value, and move him to a later evening slot he can reach without rushing.",
    "text_zh": "把这些理由照单全收，给他换到一个晚一些、他不用赶时间的时段。",
    "correct": false,
    "note": "Wrong. Dveṣa never announces itself as dislike. It arrives dressed as tiredness, traffic, and a reasonable schedule, and the excuse being plausible is the signal to look rather than the reason to stop looking. A later slot relocates the avoidance without touching it."
   },
   {
    "label": "B",
    "text_en": "Send him to the led class instead, where arriving late will not let him leave before backbends.",
    "text_zh": "干脆改让他去上口令课，在那里就算迟到了，他也没办法在后弯之前离开。",
    "correct": false,
    "note": "Wrong, and it looks like structure. It delivers the posture on whatever day he happens to have, in a full room, and it arrives as a consequence of being late. One bad experience of backbends taken under duress deepens exactly the recoil you were trying to interrupt, and it hands him a reason to dislike the led class as well."
   },
   {
    "label": "C",
    "text_en": "Treat the pattern as data, and quietly help him through backbends early on his strongest morning.",
    "text_zh": "把这个规律当成数据，在他状态最好的早晨安静地帮他提前做后弯。",
    "correct": true,
    "note": "Correct. Six weeks of leaving before the same posture is data, not a scheduling coincidence. Dveṣa is the one klesha that tells you exactly where the work is, so it functions as a map, and it is interrupted by one good experience. Give him that experience on his strongest day, not his worst, and say nothing about the lateness."
   },
   {
    "label": "D",
    "text_en": "Take backbends out of his practice until he is more confident, and then add them back gradually.",
    "text_zh": "先把后弯从他的练习里拿掉，等他更有信心之后，再慢慢加回来。",
    "correct": false,
    "note": "Wrong, and well meant. Removing the avoided posture removes the one posture with his name on it. Avoidance that a teacher authorises becomes permanent, and the value of a set sequence here is precisely that he meets the thing again tomorrow."
   }
  ],
  "explanationExpected_en": "Six weeks of leaving before the same posture, every time, with a plausible reason every time, is aversion in costume. Dveṣa is a map: the posture a student avoids is the posture with his name on it. I keep the observation private so there is no shame in it, and I give him one good experience of backbends on a day he is strong, because one good experience is what interrupts the pattern.",
  "explanationExpected_zh": "六周里每一次都在同一个体式之前离开，而且每一次都有说得通的理由，这是嗔穿着外衣。嗔是一张地图：学生躲开的那个体式，就是刻着他名字的那个。我把观察留在心里，不让他难堪，然后在他状态最好的一天给他一次好的后弯经验，因为打断这个模式需要的正是一次好的经验。",
  "teacherPoint": "Keep a private record of which posture each student is late for or leaves before, and teach that posture on their strongest morning rather than their worst.",
  "id": "KLE04"
 },
 {
  "lecture": "Five Kleshas",
  "topic": "four-states-quiet-is-not-gone",
  "stem_en": "A practitioner of fifteen years, now assisting in your room, tells you calmly that ambition and fear have simply left him and that he no longer recognises the person who used to compete on the mat. He is not boasting. He means it. How should you read this?",
  "stem_zh": "一位练了十五年、现在在你教室里做助教的练习者，平静地告诉你：野心和恐惧已经从他身上离开了，他已经认不出当年那个在垫子上跟人比较的自己。他不是在炫耀，他是真心这么认为。你应该怎么读这件事？",
  "options": [
   {
    "label": "A",
    "text_en": "Treat it as the result practice is meant to produce, confirm it, and give him more teaching responsibility.",
    "text_zh": "把它当作练习本来就该产生的结果，肯定他，并给他更多教学上的责任。",
    "correct": false,
    "note": "Wrong. This congratulates an untested state. When a serious injury, a public failure as a teacher, or a diagnosis arrives, the seed sprouts at full size with fifteen years of accumulated conditions behind it, and it takes an experienced practitioner apart in a way it never could have taken apart a beginner."
   },
   {
    "label": "B",
    "text_en": "Treat a quiet klesha as dormant rather than gone, and ask what life has demanded of him recently.",
    "text_zh": "把安静的烦恼当成潜伏而不是消失，先问他最近生活对他提出过什么要求。",
    "correct": true,
    "note": "Correct. Dormant means the conditions that would water the seed have not arrived, and it is the state experienced practitioners most often mistake for freedom. A quiet season only tells you which state a klesha happens to be in, so you assess by what has actually been asked of the person, not by how calm they feel."
   },
   {
    "label": "C",
    "text_en": "Treat it as self-deception, and tell him plainly that those kleshas are still fully active in him.",
    "text_zh": "把它当成自欺，坦白告诉他那些烦恼在他身上仍然是完全活跃的。",
    "correct": false,
    "note": "Wrong, and needlessly harsh. It is also inaccurate, since dormant is not the same as active. Worse, it hands him an enemy to fight, and fighting a defect requires an \"I\" to do the fighting, which adds asmitā rather than removing anything."
   },
   {
    "label": "D",
    "text_en": "Treat fifteen years of daily practice as enough to burn the seeds out, and tell him he has earned it.",
    "text_zh": "把十五年的每日练习当成足以烧掉种子，并告诉他这个结果是他自己挣来的。",
    "correct": false,
    "note": "Wrong. The stated job of daily practice is to make the kleshas thin, which moves them from active to attenuated and leaves them present. Dissolving the seed is a different operation and it belongs to samadhi, not to daily technique. A teacher who promises more than the tradition does will be proved wrong in front of a student one day."
   }
  ],
  "explanationExpected_en": "A klesha is always in one of four states: dormant, attenuated, interrupted, or active. Practice thins them, it does not kill the seed, so absence of feeling is not proof of absence of the pattern. A dormant seed is not a dead seed, and the way to check is to ask what conditions he has actually met lately, not how calm he feels on a quiet day.",
  "explanationExpected_zh": "一个烦恼永远处在四种状态之一：潜伏、减弱、间断、活跃。练习让它变薄，并不杀死种子，所以「感觉不到」不等于「已经没有」。潜伏的种子不是死去的种子；要判断，就问他最近实际遇到了什么条件，而不是看他在平静的日子里有多平静。",
  "teacherPoint": "When a senior student reports that ambition or fear has left them, ask what life has asked of them recently instead of congratulating them.",
  "id": "KLE05"
 },
 {
  "lecture": "Five Kleshas",
  "topic": "abhinivesa-size-of-the-step",
  "stem_en": "A student of eight years has the hip range for Supta Kurmasana and her hands come together without strain. Every time she is bound, her breath goes ragged within two breaths and she pulls her hands apart and sits up. She tells you she knows she cannot get stuck and that nothing bad can happen to her in there. What do you do next?",
  "stem_zh": "一位练了八年的学生，髋部幅度足够做 Supta Kurmasana（睡龟式），双手扣到一起也毫不勉强。但每次扣上之后，不到两个呼吸，她的呼吸就乱了，她把手松开坐起来。她告诉你，她知道自己卡不住，在里面也不会出什么事。接下来你做什么？",
  "options": [
   {
    "label": "A",
    "text_en": "Hold her hands together yourself before she can object, so the fear has no time to assemble.",
    "text_zh": "在她来不及反应前亲手把她的双手按在一起，不给恐惧集结的时间。",
    "correct": false,
    "note": "Wrong, and it is the fastest way to lose her. Being held in a shape she did not agree to teaches her nervous system that the room is unsafe and the teacher is unpredictable. Fear goes up, trust goes down, and you may not get her into the posture at all after that."
   },
   {
    "label": "B",
    "text_en": "Explain again that she cannot get stuck, and show her how easily the hands come apart.",
    "text_zh": "再向她解释一遍她卡不住，并示范双手可以多么轻易地松开。",
    "correct": false,
    "note": "Wrong. She already knows, she said so, and knowing changed nothing. Patanjali specifies that this klesha is rooted the same way even in the learned, so information does not reach it. This is the commonest thing teachers do here and the least effective."
   },
   {
    "label": "C",
    "text_en": "Leave the bind out for now, and keep working on her hips until she feels ready for it.",
    "text_zh": "先把扣手放一边，继续开她的髋，等她自己觉得准备好了再做。",
    "correct": false,
    "note": "Wrong, and kind. She is not tight, the stem says her hands come together without strain, so more hip work answers a question nobody asked. Waiting for a frightened student to feel ready hands the decision to the fear, and the avoidance sets."
   },
   {
    "label": "D",
    "text_en": "Bind her and give one instruction: three breaths, counted aloud by you, then you let go.",
    "text_zh": "把她扣上，只给一个指令：三个呼吸，由你出声数，数完就松手。",
    "correct": true,
    "note": "Correct. Her nervous system is reading a strong unfamiliar sensation as a threat to survival, which is exactly what abhiniveśa is. It runs on its own momentum and is not removed by knowledge, so you change the size of the step instead: one instruction rather than five, with the end stated before she begins, small enough that surviving it is obvious in advance."
   }
  ],
  "explanationExpected_en": "This is not stiffness and not weakness. Her body is capable and she knows the shape is safe, and the fear runs anyway, because this klesha carries its own momentum and persists even in the learned. Reasoning with it therefore does not work. I change the size of the step instead: one instruction, with a stated end, small enough that surviving it is obvious before she starts.",
  "explanationExpected_zh": "这不是不柔软，也不是没有力量。她的身体有能力，她自己也知道这个形状是安全的，但恐惧照样运转，因为这个烦恼依自身之势而流，即使在有学识的人身上也同样深植。所以跟它讲道理没有用。我要改变的是那一步的大小：只给一个指令，事先说明它在哪里结束，小到「做完不会有事」在她开始之前就看得出来。",
  "teacherPoint": "Replace the explanation with one instruction that has a stated end, small enough that surviving it is obvious before the student begins.",
  "id": "KLE06"
 },
 {
  "lecture": "Pranayama",
  "topic": "beginner-inventing-retention",
  "stem_en": "A student in his second month of Mysore holds the breath at the top of every inhale and comes up red in the face. After class he asks you to teach him kumbhaka, because he has read that retention is where the real practice begins. What do you do?",
  "stem_zh": "一位练 Mysore 才第二个月的学生，每次吸到顶就憋住，脸涨得通红。下课后他来找你，说他读到屏息才是真正练习的开始，要你教他 kumbhaka（屏息）。你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Teach him a counted retention, four in, four held, four out, so that the holding he is already doing becomes structured instead of random.",
    "text_zh": "教他一个计数屏息：吸四拍，屏四拍，呼四拍，让他本来就在做的憋气从随意变成有结构。",
    "correct": false,
    "note": "Wrong, and the most tempting wrong answer because it looks like taking the student seriously. The teacher has mistaken a strain sign for raw material. Putting a count on a stuck throat does not open it, it makes the habit official and adds pressure to a body whose practice is not yet steady. This is the fourth limb handed to someone who has not finished the third."
   },
   {
    "label": "B",
    "text_en": "Tell him retention is dangerous, that he should never hold the breath at all, and change the subject each time he raises it again.",
    "text_zh": "告诉他屏息很危险，永远不要憋气，以后他每次提起这件事，就把话题岔开。",
    "correct": false,
    "note": "Wrong. The teacher has replaced an order problem with a fear problem. Retention is not forbidden, it is placed later, and a flat ban is both untrue and unteachable. The student either ignores you in private or carries a fear of his own breath into every class."
   },
   {
    "label": "C",
    "text_en": "Give him a breath that never pauses, call the red faced hold a stuck throat, not retention, and add slow seated breathing after practice.",
    "text_zh": "给他从不停顿的呼吸，告诉他脸涨红的憋气是喉咙卡住、不是屏息，练习后加坐姿慢呼吸。",
    "correct": true,
    "note": "Correct. It names the sign accurately, removes the harm today, keeps the door open for later, and gives him something real to do after practice so he does not feel refused."
   },
   {
    "label": "D",
    "text_en": "Leave it alone and keep watching. The holding is his body finding its own rhythm, and it will settle over the next few months as he gets stronger.",
    "text_zh": "先不管，继续观察。那是他的身体在找自己的节奏，接下来几个月他力量长起来，就会自己好。",
    "correct": false,
    "note": "Wrong. The teacher has confused non interference with observation. A held breath plus a red face is rising pressure, not rhythm, and it does not settle on its own because the student is rewarding himself for effort. Two more months of this and the habit is in the nervous system."
   }
  ],
  "explanationExpected_en": "Names the sign correctly: a breath held at the top with a red face is a stuck throat and rising pressure, not retention. States the order: prāṇāyāma comes after the āsana practice is established, which is the order Patañjali gives, so retention is not refused forever, it is placed later. Gives the replacement out loud: a continuous breath with no pause at either end, and a few minutes of slow seated breathing after practice rather than before it.",
  "explanationExpected_zh": "把现象说准：吸到顶憋住、脸涨红，是喉咙卡住加血压上升，不是屏息。把次序说清：调息在体式练习稳固之后才开始，这正是 Patañjali 给出的顺序，所以不是永远不教他，而是把它放到后面。把替代方案说出来：两端都不停顿的连续呼吸，加上练习之后（不是之前）几分钟的坐姿慢呼吸。",
  "teacherPoint": "Read a held breath plus a red face as a warning rather than as ambition, and answer a request for retention by removing the pause and giving a slow seated breath after practice instead.",
  "id": "PRA01"
 },
 {
  "lecture": "Pranayama",
  "topic": "pushing-student-count-the-breaths",
  "stem_en": "A strong student flies through the standing sequence in your Mysore room. The shapes are fine, but her breath is fast and shallow and you can hear her from three mats away, and by the prasāritas she is soaked and clenching her jaw. She thinks she is having an excellent practice. What do you do?",
  "stem_zh": "你的 Mysore 教室里，一位体力很好的学生一路冲过站立序列。体式本身没什么问题，但她的呼吸又快又浅，隔三张垫子都听得见；到 prasārita 的时候，她全身是汗，下巴咬得死紧。她自己觉得今天练得非常好。你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Count her breaths for a minute, give her both numbers, hers and the tradition's, and let her correct it herself.",
    "text_zh": "数她一分钟呼吸，把两个数字给她，她的和传统的，让她自己改。",
    "correct": true,
    "note": "Correct. It turns an abstract instruction into a personal measurement. A correction a student reaches from her own number holds, while one she is told to make is obeyed for a day and forgotten. It costs you a minute and none of your authority."
   },
   {
    "label": "B",
    "text_en": "Tell her to slow down and breathe more deeply, then carry on to the next student and leave her to it.",
    "text_zh": "让她慢下来、呼吸深一点，然后就去看下一个学生，不再回头。",
    "correct": false,
    "note": "Wrong, and it is what most of us say. Slow down is not a quantity, so she has no way to tell whether she has done it, and a student who cannot tell whether she has complied returns to her old rate inside two postures. It also arrives as disapproval rather than as information."
   },
   {
    "label": "C",
    "text_en": "Hold her at the end of the standing sequence and take back the last postures she was given until the breath settles down.",
    "text_zh": "把她停在站立序列末尾，收回最近给她的几个体式，等呼吸稳下来为止。",
    "correct": false,
    "note": "Wrong. The postures were never the problem, the rate was. Taking poses away for a breathing fault reads as punishment to the student in the room who is trying hardest, and it teaches her to hide the strain from you rather than show it."
   },
   {
    "label": "D",
    "text_en": "Praise the effort in front of the room and hold her up as the example of what a strong practice looks like.",
    "text_zh": "当着全班表扬她的努力，把她立成「什么叫练得好」的例子。",
    "correct": false,
    "note": "Wrong, and the most expensive of the four because it sets the standard for everyone. You have rewarded strain publicly, and now every student who wants your approval breathes the way she does. The measure of a practice is the breath, not the sweat."
   }
  ],
  "explanationExpected_en": "Says what the teacher does: count her breaths for sixty seconds during the standing sequence, then hand back both numbers, hers and the ordinary rate the tradition gives, which is fifteen a minute. Says why measuring beats instructing: a number she can verify herself becomes a correction she owns and keeps, while an instruction with no quantity in it gives her nothing to check against. May note that a student who is pushing usually runs twenty to thirty a minute, and that the fast, shallow, effortful breath is the sign to read, not the shape of the posture.",
  "explanationExpected_zh": "写出老师实际要做的事：在站立序列时站在她身后数六十秒，再把两个数字都还给她，她自己的次数，和传统给的平常频率，也就是每分钟十五次。写出为什么「测量」胜过「下指令」：她自己能验证的数字，会变成她自己守得住的修正；而一句没有量的指令，她无从判断自己做到没有。也可以补充：在推的学生通常是每分钟二十到三十次，要读的信号是又快又浅又费力的呼吸，不是体式的形状。",
  "teacherPoint": "Correct a student who is pushing by counting her breaths for sixty seconds and handing her the number, so the correction becomes hers instead of yours.",
  "id": "PRA02"
 },
 {
  "lecture": "Pranayama",
  "topic": "assist-that-silences-the-breath",
  "stem_en": "You are running your own room. A senior student who assists for you is pressing a beginner deeper into kūrmāsana, and from where you stand you can no longer hear the beginner breathing at all. What do you do, and what do you teach your assistant afterwards?",
  "stem_zh": "你自己带一间教室。一位帮你做辅助的资深学生，正把一个初学者往 kūrmāsana 里压得更深；从你站的位置，已经完全听不到那个初学者的呼吸了。你怎么做？事后你要教你的助教什么？",
  "options": [
   {
    "label": "A",
    "text_en": "Let the adjustment finish. It is nearly done, and interrupting the person helping you in front of the room undermines their standing.",
    "text_zh": "让这个辅助做完。已经快结束了，当着全班打断帮你做事的人，会伤到他在教室里的威信。",
    "correct": false,
    "note": "Wrong. The teacher is protecting the assistant's face at the student's expense. It also teaches the room the wrong hierarchy: that the shape outranks the breath and that an adjustment, once started, must be completed. Your assistant's authority is built by being corrected well, not by never being corrected."
   },
   {
    "label": "B",
    "text_en": "Step in, get the pressure off and the breath audible, then tell your assistant the breath is corrected first and given up last.",
    "text_zh": "上前让他把力道放掉，先让呼吸重新出声，再告诉助教：呼吸最先修，最后才放弃。",
    "correct": true,
    "note": "Correct. A student who has lost the breath is no longer practising yoga whatever the body is doing, and the assistant walks away with a rule they can apply in every future assist rather than a scolding about one pose."
   },
   {
    "label": "C",
    "text_en": "Have the beginner hold for five more breaths at that depth to get used to it, and talk to your assistant quietly after class.",
    "text_zh": "让初学者在这个深度再撑五次呼吸，好让他习惯，助教的事等下课再私下讲。",
    "correct": false,
    "note": "Wrong. The teacher is asking for five more breaths from someone who is not breathing at all. Depth held without breath does not turn into capacity, it turns into fear of the posture, and kūrmāsana is precisely where a beginner panics and goes silent."
   },
   {
    "label": "D",
    "text_en": "Take the beginner out of kūrmāsana and say in front of the room that they are not ready for this posture yet.",
    "text_zh": "把初学者从 kūrmāsana 里拉出来，当着全班说他还没准备好做这个体式。",
    "correct": false,
    "note": "Wrong, and it looks like caution. Removing the student is not the error, the public verdict is: the posture was never the problem, the pressure and the lost breath were. It teaches the beginner that postures are things you fail, and it hands your assistant no usable rule for the next assist."
   }
  ],
  "explanationExpected_en": "States the priority: you correct the breath before you correct the shape, and a student who has lost the breath is no longer practising, whatever the body is doing. Explains why the silent breath is the signal here, and that it can be read from across the room without touching anyone. Names what the assistant is taught: release first, restore audible breathing, then reconsider depth, given as a rule for all assists rather than as a comment on one student.",
  "explanationExpected_zh": "把优先次序说清楚：先修呼吸，再修形状；呼吸丢掉的学生，不管身体在做什么，已经不在练瑜伽了。说明为什么呼吸没有声音就是那个信号，而且这一点隔着整间教室、不用碰到人就能读出来。说明要教给助教什么：先放力道，先让呼吸重新出声，再谈深度。这是所有辅助通用的规矩，不是针对这一个学生的批评。",
  "teacherPoint": "Use the sound of the breath as the stop signal on any adjustment, and give assistants one rule (release, restore the breath, then depth) instead of pose by pose corrections.",
  "id": "PRA03"
 },
 {
  "lecture": "Pranayama",
  "topic": "teaching-ujjayi-by-feel",
  "stem_en": "A new student in your led class cannot make the ujjāyī sound. She has read about the glottis and asks you to explain exactly which muscles she should be using. You have about thirty seconds with her before the room needs you. What do you do?",
  "stem_zh": "带领课上一位新学生发不出 ujjāyī 的声音。她读过关于声门的资料，来问你到底该用哪些肌肉。全班还等着你，你大概只有三十秒。你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Explain the glottis and the larynx properly. She is an intelligent adult who asked a precise question, and the mechanism is what lets her produce it.",
    "text_zh": "把声门和喉部好好讲清楚。她是有理解力的成年人，问题也问得很准，弄懂机制才做得出来。",
    "correct": false,
    "note": "Wrong, and it flatters both of you. Nobody has ever learned ujjāyī from an explanation. You spend the thirty seconds on words, she leaves without the sound, and she now believes the breath is a technical subject she is not qualified for yet."
   },
   {
    "label": "B",
    "text_en": "Tell her to make the sound louder, like waves, and to tighten the throat until she can hear herself over the rest of the room.",
    "text_zh": "让她把声音做大一点，像海浪一样，把喉咙收紧到能在全班的声音里听见自己。",
    "correct": false,
    "note": "Wrong. The teacher is buying volume with tension. A squeezed throat gives an impressive noise on day one and years of forcing afterwards, and it raises the effort of every breath in a student who has not yet learned what ease feels like."
   },
   {
    "label": "C",
    "text_en": "Have her fog a mirror with the mouth open, a hand on the throat to feel where the sound is made, then close the mouth and keep that sound.",
    "text_zh": "让她张嘴哈气，像对着镜子，手放喉咙前感觉声音从哪里来，闭嘴后保持这个声音。",
    "correct": true,
    "note": "Correct. It puts the sensation before the vocabulary, it takes about thirty seconds, and she leaves the class able to do it rather than able to describe it."
   },
   {
    "label": "D",
    "text_en": "Tell her not to worry about the sound, to breathe normally for the first few months, and that it will come on its own in time.",
    "text_zh": "告诉她先别管声音，头几个月正常呼吸就行，那个声音以后自己会来的。",
    "correct": false,
    "note": "Wrong. The teacher thinks they are lowering the pressure, but the student asked a direct question and leaves with nothing. It also postpones the fourth limb as if it were an advanced extra, when the breath is the thing the practice is made of from the first day."
   }
  ],
  "explanationExpected_en": "Says why the demonstration beats the explanation: the sound is made at the throat by narrowing the space the air passes through, and a hand on the throat plus an open mouthed fogging breath gives her that sensation directly, in seconds, which no description can do. Says what the teacher does with the thirty seconds: sensation first, vocabulary later. May add that the throat is the one place below the mouth where a person can change the airway on purpose and hear the result immediately, which is why feedback by sound and touch works here, and that the anatomy can be given once she can already produce the breath.",
  "explanationExpected_zh": "说清楚为什么演示胜过讲解：声音是在喉咙这里、通过缩小气流通过的空间发出来的，手放在喉咙上加上张嘴哈气，几秒钟就让她直接感觉到，这是任何描述都做不到的。写出这三十秒老师实际怎么用：先给感觉，词汇以后再说。也可以补充：在口腔以下，喉咙是唯一一个人能有意改变气道口径、并且当场听到结果的地方，所以在这里用声音和触感做反馈才有效；解剖可以等她做得出来之后再讲。",
  "teacherPoint": "Teach ujjāyī in thirty seconds with an open mouth fogging breath and a hand on the throat, and keep the anatomy until after the student can already make the sound.",
  "id": "PRA04"
 },
 {
  "lecture": "Pranayama",
  "topic": "lifespan-claim-and-the-two-registers",
  "stem_en": "A prospective student messages you on WeChat. She has seen a post claiming that yogic breathing lets a person live to a hundred and sixty years, and she wants to know whether it is true before she signs up. How do you reply?",
  "stem_zh": "一位潜在学生在微信上问你：她看到一个帖子说，瑜伽的呼吸法能让人活到一百六十岁，她想先弄清楚这是不是真的，再决定要不要报名。你怎么回她？",
  "options": [
   {
    "label": "A",
    "text_en": "Confirm it. The tradition teaches it, and a teacher who publicly doubts his own tradition in front of a new student has no authority left to stand on.",
    "text_zh": "肯定它。传统就是这么教的，一个当着新学生公开怀疑自己传统的老师，就没有威信可言了。",
    "correct": false,
    "note": "Wrong. The teacher has confused loyalty to a tradition with asserting what cannot be checked. You have just made a health claim you cannot support, and the serious students you actually want in the room are the ones who will trust you less for it."
   },
   {
    "label": "B",
    "text_en": "Tell her the number is folklore and that the real benefits are flexibility and stress relief, so she can ignore that part of the post.",
    "text_zh": "告诉她这个数字是民间说法，真正的好处是柔软度和减压，帖子里那部分不用理。",
    "correct": false,
    "note": "Wrong in the other direction. The teacher throws the material away to sound modern, and what is left is a stretching class. The arithmetic behind the claim is checkable and it carries a real teaching, so discarding it costs her the one idea that would have changed how she practises."
   },
   {
    "label": "C",
    "text_en": "Do not answer directly. Invite her to come and try a class, since these things only make sense once a person is actually practising.",
    "text_zh": "先不正面回答，请她先来上一次课，因为这些事情要真的开始练了才懂。",
    "correct": false,
    "note": "Wrong. She asked a direct question and the dodge is the answer she receives: that her teacher will not say plainly what he does and does not know. A prospect testing whether you tell the truth is the easiest person to win and the easiest to lose."
   },
   {
    "label": "D",
    "text_en": "Give her the fixed breath allotment, spent fast or slow, call the lifespan the tradition's claim, not a promise, and count breaths, not years.",
    "text_zh": "给她固定的呼吸份额，可以花得快或慢；寿命是传统的说法，不是承诺；数呼吸，不数年。",
    "correct": true,
    "note": "Correct. It keeps the two registers apart, gives her the tradition without a health claim, and hands her the change of unit, which is the part that survives contact with a calculator."
   }
  ],
  "explanationExpected_en": "Separates the two registers and says why. The arithmetic is checkable, so it can be stated flatly as fact: the allotment is fixed, the rate is not, and halving the rate spreads the same allotment across twice the years, which is where the figure comes from. The lifespan itself is the tradition's claim rather than a measured result, so it is quoted with its owner named and never converted into a promise, because a health claim you cannot support loses you exactly the students you want. States what the material actually teaches: a change of unit from years to breaths. May add that when you do not know where a figure comes from, the honest answer is that you do not know.",
  "explanationExpected_zh": "把两种口气分开，并说明为什么。算术是可以验算的，所以这部分可以平实地当作事实讲：份额是固定的，频率不是；把频率减半，同样的份额就摊到一倍的年数上，那个数字就是这么来的。寿命本身是传统的说法，不是测量出来的结果，所以要引述，并说明是谁在说，绝不把它变成承诺，因为一个撑不住的健康承诺，恰好赶走你最想留住的那批认真学生。要写出这份材料真正教的东西：把单位从「年」换成「呼吸」。也可以补充：某个数字的出处你不知道，就老实说不知道。",
  "teacherPoint": "Answer a lifespan claim by stating the checkable arithmetic as fact, naming the tradition as the owner of the claim, and refusing to turn either one into a health promise.",
  "id": "PRA05"
 },
 {
  "lecture": "Pranayama",
  "topic": "plateaued-student-retention",
  "stem_en": "A student two years in tells you she has stopped improving. Everyone who started when she did has moved further along the series, she still cannot bind in marīcyāsana D, and she is thinking of stopping. What do you do?",
  "stem_zh": "一位练了两年的学生告诉你，她不再进步了。和她同期开始的人都往后走了，她到现在还绑不上 marīcyāsana D，她在考虑不练了。你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Show her the four ages and the scale behind them, so she can see how small two years really is, and tell her the thing to work on is her impatience.",
    "text_zh": "把四个时代和背后的尺度拿给她看，让她明白两年到底有多小，并告诉她要处理的是她的急躁。",
    "correct": false,
    "note": "Wrong, and it misuses good material. The cosmology exists to remove the unit the student came in with, not to win an argument against her. Used as a rebuke it tells her that her two years were trivial and her feelings are a fault, and a student already halfway out of the door will take that as permission to leave."
   },
   {
    "label": "B",
    "text_en": "Change her unit from years to breaths: her breath is longer and steadier than two years ago, as she can check tomorrow. Leave the postures alone.",
    "text_zh": "把她的单位从年换成呼吸：她的呼吸比两年前更长更稳，明天就能自己验证。体式先不动。",
    "correct": true,
    "note": "Correct. It gives her a measure she actually controls and can check in tomorrow's practice, instead of one that depends on other people's bodies and other people's timing."
   },
   {
    "label": "C",
    "text_en": "Give her the next few postures so she can feel she is moving forward again, and come back to marīcyāsana D later when her mood has recovered.",
    "text_zh": "给她后面几个体式，让她重新觉得在往前走，等心情好些再处理 marīcyāsana D。",
    "correct": false,
    "note": "Wrong, and it is the commonest well meaning error in a Mysore room. It buys a week of morale from a body that is not ready, and it confirms the exact belief that is hurting her: that progress means new postures. A month later she is in the same comparison with two more poses she cannot do."
   },
   {
    "label": "D",
    "text_en": "Tell her that if she keeps coming to practise every day the bind will come sooner or later, because everyone gets it in the end.",
    "text_zh": "告诉她只要每天坚持来练，那个绑迟早会来，因为每个人到最后都会绑上。",
    "correct": false,
    "note": "Wrong. It is a promise you cannot keep, and it leaves her measuring herself by the bind. If it has not come in another year she now has your word as one more reason to conclude that she is the exception who failed."
   }
  ],
  "explanationExpected_en": "Identifies the real problem as the unit she is measuring herself by, not the posture. Explains the change of unit: the tradition counts a life in breaths rather than years, and the yuga material exists to stop the year looking like an absolute measure, which is why it is offered as relief and never used as a rebuke. Says what the teacher does in practice: name the change she can verify for herself, a longer and steadier breath than two years ago, hold the postures where they are, and keep her attention on the one thing she governs, which is the breath in front of her.",
  "explanationExpected_zh": "指出真正的问题是她用来衡量自己的那个单位，不是那个体式。说明「换单位」：传统用呼吸计量一生，不用年；四个时代那套尺度的作用，是让「年」不再像一把绝对的量尺，所以它应该被当作松绑来给，绝不能当作批评来用。写出老师实际要做的事：说出她自己可以验证的变化，也就是呼吸比两年前更长、更稳；体式停在原地；把她的注意力放回她真正能管的东西上，也就是眼前这一次呼吸。",
  "teacherPoint": "Hold a plateaued student by changing the unit she measures herself in, from postures and years to the length and steadiness of her breath, without handing her new poses to buy morale.",
  "id": "PRA06"
 },
 {
  "lecture": "Pranayama",
  "topic": "pranayama-means-extension-not-control",
  "stem_en": "A student in your Tuesday morning group has read that prāṇāyāma means breath control. Since then she has been tightening her throat and cutting her breath short through the standing sequence, and she tells you, pleased, that she is finally controlling it. What do you tell her the word actually says, and what do you change in her practice this morning?",
  "stem_zh": "你周二早上课上的一个学生读到，prāṇāyāma 的意思是「控制呼吸」。从那以后，她在整个站立序列里都把喉咙收紧、呼吸变短，还很高兴地告诉你，她终于「控制住」了。这个词到底在说什么？你怎么跟她讲？今天早上你又要改她练习里的什么？",
  "options": [
   {
    "label": "A",
    "text_en": "Tell her control is one of the two readings and extension is the other, that teachers have always disagreed about it, and that she should keep whichever reading helps her practice.",
    "text_zh": "告诉她，「控制」是两种读法之一，「延伸」是另一种，老师们一直有分歧，哪一种对她的练习有帮助就用哪一种。",
    "correct": false,
    "note": "False balance dressed as open mindedness. Both readings are taught, but the word itself carries the long ā that only prāṇa plus āyāma produces, and this answer leaves her squeezing her throat all week because it changes nothing she does."
   },
   {
    "label": "B",
    "text_en": "Tell her the word says extension: prāṇa plus āyāma, the lengthening of the vital force, and that her long slow exhale is already doing it.",
    "text_zh": "告诉她这个词说的是「延展」：prāṇa 加 āyāma，生命能量的延长；她那个长而慢的呼气，其实已经在做这件事了。",
    "correct": true,
    "note": "Correct. It gives her the half she is missing and turns that meaning into a change she can make in the next posture, which is the only place the definition earns its keep."
   },
   {
    "label": "C",
    "text_en": "Tell her control is the right idea but that she is applying it in the wrong place, and give her a counted ratio to work with: four in, four held, eight out.",
    "text_zh": "告诉她「控制」这个想法是对的，只是用错了地方，然后给她一个数好的比例来练：吸四拍、屏四拍、呼八拍。",
    "correct": false,
    "note": "Well intentioned and the most common harm in this lecture. A hold laid on top of a breath she is already clamping trains a stuck glottis rather than retention, and it arrives long before āsana is established."
   },
   {
    "label": "D",
    "text_en": "Tell her not to worry about what the Sanskrit means and to simply follow the count in the room, since word meanings are the teacher's business rather than the student's.",
    "text_zh": "告诉她不用去操心梵文是什么意思，跟着教室里的口令数就行，词义是老师的事，不是学生的事。",
    "correct": false,
    "note": "Refuses the question that is already changing her practice. She did not get the meaning from you, so closing the subject leaves the book in charge of her breath and you holding a count she no longer trusts."
   }
  ],
  "explanationExpected_en": "The word carries its own answer. Prāṇa plus āyāma gives extension, lengthening, development, and that is the reading the word as written supports: āyāma is the prefix ā on the root yam, which turns holding into stretching out, and joining prāṇa to āyāma is what produces the long ā the word actually has, where prāṇa plus yama would leave a short one. Control is not wrong. It is the smaller half, and a student holding only that half does exactly what she is doing, makes the breath tighter and shorter and calls it progress. Give her the other half and the practice changes the same morning: the same ujjāyī sound carried longer and finer, nothing clamped. The deck subtitle already says it out loud, the development of the vital force.",
  "explanationExpected_zh": "这个词本身就带着答案。prāṇa 加 āyāma 得到的是延伸、拉长、开展，而就词形而言，梵文支持的正是这一种：āyāma 是词根 yam 前面加了前缀 ā，把「握住」翻转成「拉开」；prāṇa 与 āyāma 相连产生的长 ā，正是这个词实际带有的那个音，而 prāṇa 加 yama 在那个位置上只会是短 a。「控制」不算错，它只是小的那一半。只拿到这一半的学生，做的就是她现在做的事：把呼吸弄得更紧、更短，还以为这是进步。把另一半给她，当天早上练习就会变：同样的 ujjāyī 声音，延续得更长、更细，什么都不用夹紧。幻灯片的副标题早就把话说明了，调息是生命能量的开展。",
  "teacherPoint": "Teach prāṇāyāma as lengthening first and control second, and when a student says control, look at whether her breath has gone shorter.",
  "id": "PRA07"
 },
 {
  "lecture": "Pranayama",
  "topic": "why-the-breath-and-not-the-heart",
  "stem_en": "After class a student who works as a hospital nurse tells you she does not see why yoga makes so much of the breath. She can lengthen her exhale the moment you ask, she says, but she cannot slow her own heart or her digestion by deciding to, so what makes breathing the special one? Give her the two sentences you would actually say in the room.",
  "stem_zh": "下课后，一个在医院当护士的学生跟你说，她不明白瑜伽为什么把呼吸看得这么重。她说，你一让她拉长呼气，她马上就能做到，可她没办法「决定」让自己的心跳慢下来，也没办法让消化听她的，那呼吸凭什么是特别的那一个？用你在教室里真的会说的那两句话回答她。",
  "options": [
   {
    "label": "A",
    "text_en": "Tell her the breath is special because it carries prāṇa, which the throat centre purifies before it enters the body, and that this is what sets it apart from the heartbeat.",
    "text_zh": "告诉她呼吸之所以特别，是因为它带着 prāṇa，而喉轮会在它进入身体之前把它净化，这就是它和心跳不一样的地方。",
    "correct": false,
    "note": "Asserts a subtle body claim as physiology to the one student in the room who measures things for a living. Teach that claim as what the tradition says, and never as the mechanism, because you cannot demonstrate it and she will know."
   },
   {
    "label": "B",
    "text_en": "Tell her she is right that there is no physiological difference, and that the importance of the breath is a traditional idea she is free to take on faith or leave alone.",
    "text_zh": "告诉她她说得对，生理上并没有什么不同，呼吸的重要性只是传统的观念，她可以选择相信，也可以放着不管。",
    "correct": false,
    "note": "Sounds humble and gives away a plain fact you actually hold. It also invites the most serious student in the room to file the whole fourth limb under belief."
   },
   {
    "label": "C",
    "text_en": "Tell her that with enough training she will be able to slow her heart directly as well, as advanced practitioners can, and that breath work is where that training starts.",
    "text_zh": "告诉她，练到一定程度她也能直接让心跳慢下来，高阶的练习者就可以做到，而呼吸的练习正是这个训练的起点。",
    "correct": false,
    "note": "An overclaim she can test on herself and disprove by Thursday. It buys one impressive moment and costs you everything you say about the breath afterwards."
   },
   {
    "label": "D",
    "text_en": "Tell her breathing is the one automatic function she can take over at will, which is why it is the handle on a system she cannot otherwise reach.",
    "text_zh": "告诉她呼吸是她唯一能随意接管的自动功能，正因如此，它才是那个她本来碰不到的系统上唯一的把手。",
    "correct": true,
    "note": "Correct. It answers the mechanical question she actually asked, in language she can check on herself, and it is the fact that makes the word bridge defensible rather than decorative."
   }
  ],
  "explanationExpected_en": "She has handed you the answer inside her own question. Breathing is the one autonomic function a person can take over at will. The muscles that breathe her are skeletal muscles wired twice, an automatic drive that runs all night without her and a voluntary one she can apply in a second, while her heart, her gut and her pupils take orders only once and admit no direct intervention. That double wiring is the plain fact underneath the tradition calling the breath a bridge between the conscious and the subconscious, and the tradition used the word long before anyone drew the nerve. It is also why the fourth limb is a limb rather than a technique bolted on the side, and why in the Mysore room you correct the breath before you correct the shape. A student whose breath is intact will find the posture eventually.",
  "explanationExpected_zh": "她的问题里已经藏着答案。呼吸是一个人唯一可以随意接管的自主功能。让她呼吸的横膈膜和肋间肌是骨骼肌，接着两套线：一套自动的，整夜运行、不用她管；一套随意的，她一秒钟就能用上。而心脏、肠道、瞳孔只接一套线，无法直接干预。这套双重接线，就是传统把呼吸称为意识与潜意识之桥这个说法底下的朴素事实，而在任何人画出那条神经之前很久，传统就已经在用这个字了。这也是为什么呼吸是八支中的第四支，而不是外挂上去的技术；是为什么在 Mysore 教室里，你先修呼吸，再修形状。呼吸完整的学生，早晚会找到体式。",
  "teacherPoint": "Say in two sentences why the breath is the one automatic function you can take over, and use that same fact as your reason for correcting the breath before the shape.",
  "id": "PRA08"
 },
 {
  "lecture": "Pranayama",
  "topic": "why-cosmology-sits-in-a-breath-class",
  "stem_en": "You have just taken a room of students through the yuga arithmetic, and they came to learn about breathing. One of them asks, with no edge in her voice, why she is hearing about a day of Brahmā in a class on the breath. The rest of the room is waiting for your answer. What do you say?",
  "stem_zh": "你刚给一屋子学生讲完 yuga 的算术，而他们是来学呼吸的。其中一个学生问你，语气里没有任何挑衅：为什么在一堂讲呼吸的课上，要听梵天的一天？其他人都在等你的回答。你怎么说？",
  "options": [
   {
    "label": "A",
    "text_en": "Tell her the cosmology is there to take a unit away from her: at that scale, the age she reaches stops being the measure of the practice.",
    "text_zh": "告诉她这些宇宙尺度是用来拿走她手里的量尺的：在那个尺度上，她活到几岁，已经不再是衡量这个练习的标准。",
    "correct": true,
    "note": "Correct. It names the job the numbers are doing, and it lands her on the unit she can change in the next breath rather than on a feeling about the size of the universe."
   },
   {
    "label": "B",
    "text_en": "Tell her these are the tradition's figures for the actual age of the world, and give the yuga lengths as history so that the scale lands on her properly.",
    "text_zh": "告诉她这些是传统给出的世界实际年龄，并把各个 yuga 的长度当作历史讲出来，好让这个尺度真正压到她身上。",
    "correct": false,
    "note": "Turns material you should quote into material you assert. The next ten minutes become an argument about geology with the one student who reads, and the reason the numbers were in a breathing class never gets said."
   },
   {
    "label": "C",
    "text_en": "Tell her the question is fair, that you will keep the class to what can be measured from now on, and move back to the breath count.",
    "text_zh": "告诉她这个问题问得对，从现在起你会把课只讲可测量的部分，然后回到呼吸的次数上。",
    "correct": false,
    "note": "Reads as respect for the student and throws away the strongest material in the lecture. She asked what the cosmology was for, and retreating tells the room that their teacher did not know."
   },
   {
    "label": "D",
    "text_en": "Tell her the numbers are there to show how small a single life is, so that she stops taking her own eighty years quite so seriously.",
    "text_zh": "告诉她，这些数字是要显示一条命有多渺小，好让她不要把自己的八十年看得那么重。",
    "correct": false,
    "note": "Half the answer, and the half that leaves her with less than she walked in with. Scale is the method, not the point, and this version removes her unit without handing her the replacement."
   }
  ],
  "explanationExpected_en": "The cosmology is neither decoration nor information. It is there to remove the unit the student walked in with. At the scale the tradition puts next to a human lifespan, eighty years do not register at all, so the gap between dying at eighty and dying at twice that is zero, and the tradition draws the only conclusion left to it: years are the wrong measure, and it quits counting them. What remains when you stop counting years is the breath in front of her and how long it is, and that she can change this morning. A teacher who cannot say this looks like they are decorating, which is why the answer belongs in one sentence you can give while the room is still waiting. Quote the yuga figures as the tradition's own and say what they are for out loud.",
  "explanationExpected_zh": "这些宇宙论既不是装饰，也不是知识。它们的作用，是把学生带进门时手里的那个单位拿走。在传统放在人的寿命旁边的那个尺度上，八十年根本不留痕迹，所以八十岁死和活到两倍长之间的差距等于零，于是传统得出唯一可能的结论：用年来计量是错的，它不再数年。不再数年之后剩下的，是她眼前这一次呼吸，以及它有多长，而这个她今天早上就能改。答不上这个问题的老师，看起来就像在做装饰，所以这句话要短到能在全场等你的时候直接说出口。yuga 的数字要当作传统的说法引述，并且把它们的用途明说出来。",
  "teacherPoint": "Say out loud what the cosmology is for: it takes the year away as a unit so that the breath can take its place.",
  "id": "PRA09"
 },
 {
  "lecture": "Five Kleshas",
  "topic": "kleshas-as-messengers-student-at-war-with-herself",
  "stem_en": "A student of five years sat through your talk on the kleshas and has been reporting on herself ever since. She calls her wish for a deeper backbend raga, calls her dislike of the teacher who covers Fridays dvesa, and has cut herself back to three mornings a week as a penalty for wanting too much. She is harder in the room and less happy than she was before. She asks you which klesha is her worst one. What do you do?",
  "stem_zh": "一位练了五年的学生，听完你那堂讲五种烦恼的课之后，每周都来向你汇报自己。她把想要更深的后弯叫作贪，把不喜欢周五代课的老师叫作嗔，还把练习砍到一周三个早晨，作为对自己「想要太多」的惩罚。她在教室里比以前更硬，也更不快乐。她问你：她最严重的是哪一个烦恼？你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Take the labels out of it. Put her back on her full week, and ask her to bring you one plain observation each week: what happened and where, with no verdict attached.",
    "text_zh": "把标签拿掉。让她恢复完整的一周练习，并请她每周带一个朴素的观察给你：发生了什么、在哪里，不要附上任何结论。",
    "correct": true,
    "note": "Correct. Read as information, a klesha keeps the practice workable and reports where she currently is. Fought as an enemy, it needs an I to do the fighting, and that manufactured I is asmita, so the war produces the very thing she is trying to remove. Daily repetition thins these things without anyone having to win."
   },
   {
    "label": "B",
    "text_en": "Agree with her reading, and give her a task in front of the room that forces her to be a beginner where everyone can see, so the ego has nowhere left to hide.",
    "text_zh": "同意她的判断，并当着全教室给她一个任务，逼她在所有人面前当初学者，让自我无处可藏。",
    "correct": false,
    "note": "An ego broken in public hardens instead of dissolving. The task that works is quiet, private and repeated daily for a month. This one also rewards the habit you need to interrupt, which is treating herself as a defect to be defeated."
   },
   {
    "label": "C",
    "text_en": "Tell her to stop reading and stop naming anything for six months, and to keep the lighter three mornings a week until she feels warmer toward the practice again.",
    "text_zh": "叫她半年内不要再读、也不要再给任何东西命名，并保持一周三个早晨的轻量安排，直到她对练习的感觉重新变好。",
    "correct": false,
    "note": "It removes self study, which is one of the three parts of the practice that actually thins a klesha, and it leaves the punishment schedule in place while waiting on a feeling to arrive. The problem is not that she studied. It is that she is using what she studied as a weapon against herself."
   },
   {
    "label": "D",
    "text_en": "Praise the level of self awareness, and tell her that if she keeps working on herself this honestly the kleshas will eventually be gone.",
    "text_zh": "称赞她的自我觉察，并告诉她只要这样诚实地继续下功夫，这些烦恼最后会消失。",
    "correct": false,
    "note": "It applauds the war, then promises an outcome the practice does not promise. Daily practice moves a klesha from active to thin and leaves the seed. A student who has been told they will be gone is the one taken apart the first time a dormant one wakes at full size."
   }
  ],
  "explanationExpected_en": "A full answer says the kleshas are messengers rather than enemies. Each one reports where the practitioner currently is, what she has mistaken for permanent, what she is defending, what she is avoiding, and read that way the practice stays workable. Treated as enemies they cannot be removed, because fighting a defect requires an I to do the fighting, and that manufactured I is asmita, so she has added one instead of losing one. It should also be accurate about what practice claims: it thins a klesha from active to attenuated, it does not kill the seed, so promising removal is dishonest. The action is to restore the full week, drop the labelling, and take her back to plain observation with no conclusion attached.",
  "explanationExpected_zh": "完整的答案要说明：烦恼是信使，不是敌人。每一个烦恼都在报告练习者此刻所在的位置：她把什么误当成永久的，她在防守什么，她在回避什么。这样读，练习就一直做得下去。把它们当敌人就去不掉，因为跟一个缺陷打仗需要有一个「我」来打，而这个被制造出来的「我」正是我执，于是她多加了一个，而不是少了一个。也要说准练习究竟承诺什么：练习把烦恼从活跃变薄，并不杀死种子，所以承诺「会消失」是不诚实的。做法是：恢复完整的一周，拿掉标签，回到不附结论的朴素观察。",
  "teacherPoint": "Treat a klesha as information, not as an enemy. Restore the full week, drop the labels, ask for plain observation, and promise thinning rather than removal.",
  "id": "KLE07"
 },
 {
  "lecture": "Five Kleshas",
  "topic": "asmita-teacher-passed-by-own-student",
  "stem_en": "A student of four years now has a cleaner drop back and a deeper kapotasana than yours, and newer students have started putting their mats where they can watch her. You notice that you correct her more often than anyone else in the room, and that you feel lighter on the mornings she does not come. What do you do?",
  "stem_zh": "一位跟你练了四年的学生，现在的后弯落地比你干净，kapotasana 也比你深，新来的学生开始把垫子铺在能看见她的位置。你注意到，自己纠正她的次数比纠正教室里任何人都多，而她不来的那些早晨，你觉得轻松一些。你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Stop adjusting her and let her practise on her own, since there is not much left that you can give her.",
    "text_zh": "不再调整她，让她自己练，因为你能给她的已经不多了。",
    "correct": false,
    "note": "Withdrawal dressed as humility. It protects your self image and takes from her the one thing she cannot supply herself, which is a pair of eyes outside her own body. Nobody can watch their own practice, and that is the whole argument for having a teacher at all."
   },
   {
    "label": "B",
    "text_en": "Move her into the next postures now, since she is clearly ready and the room should see that there is still somewhere to go.",
    "text_zh": "现在就给她加下面的体式，她显然已经准备好了，而且教室里的人也该看到前面还有路。",
    "correct": false,
    "note": "The trigger here is your reaction, not her readiness. A promotion timed by the teacher's discomfort puts a student into range she has not earned, and hands her a level to defend, which is exactly the material her first injury will use against her."
   },
   {
    "label": "C",
    "text_en": "Tell the room openly that she has gone past you, so the students hear honesty from their teacher and she gets the recognition she has earned.",
    "text_zh": "当着全教室坦白说她已经超过了你，让学生听到老师的诚实，也让她得到应得的认可。",
    "correct": false,
    "note": "A public statement about your own ego is still a statement about you. It also fixes her level in front of witnesses, and a level held in public is the identity that comes apart on the day her body cannot hold it."
   },
   {
    "label": "D",
    "text_en": "Keep her corrections exactly as they are for everyone else, and take your own reaction to your own teacher.",
    "text_zh": "给她的纠正与给其他所有人的完全一样，把你自己的反应带到你自己的老师那里去。",
    "correct": true,
    "note": "Correct. The manufactured I has attached itself to a role, the most advanced body in the room, and the over correcting and the relief on her absent days are the evidence. Consistency inside the room, self study outside it, and one person who can see what you cannot see about yourself."
   }
  ],
  "explanationExpected_en": "A full answer puts asmita in the teacher, not in the student. The manufactured I has attached itself to a role, the strongest practitioner in the room, and the two symptoms in the stem are the evidence: correcting her more than anyone else, and feeling lighter when she is absent. It says that withdrawing, promoting her, and announcing it to the room all serve the teacher rather than the student, and that a level handed out in public becomes an identity that breaks at her first injury. The workable answer is unchanged treatment inside the room, self study outside it, and taking the reaction to your own teacher, because no practitioner can see their own practice from the inside.",
  "explanationExpected_zh": "完整的答案要把我执放在老师身上，不是放在学生身上。被制造出来的「我」黏上了一个角色：教室里最好的练习者。题干里的两个症状就是证据：纠正她比纠正任何人都多，以及她不来的早晨你觉得轻松。抽身不管、给她加体式、当众宣布，这三种做法服务的都是老师，不是学生；而一个当众给出的程度，会变成她第一次受伤时就塌掉的身份。可行的做法是：教室里对她的对待保持不变，教室外做自我研习，并把自己的反应带到自己老师那里去，因为没有人能从内部看见自己的练习。",
  "teacherPoint": "Recognise your own asmita when a student passes you: keep your treatment of her identical inside the room, and take the reaction to your own teacher rather than to the students.",
  "id": "KLE08"
 },
 {
  "lecture": "Five Kleshas",
  "topic": "identity-collapse-when-injury-takes-the-level",
  "stem_en": "A student of six years tears something in her shoulder and is told to put no weight through that arm for twelve weeks. She stops coming altogether and writes to you: I am not a yoga person any more, and I do not know what I am now. What is your first move?",
  "stem_zh": "一位练了六年的学生肩膀撕裂，医生要求十二周内那只手臂不能承重。她完全不来了，并写信给你：「我已经不是一个练瑜伽的人了，我不知道自己现在算什么。」你的第一步是什么？",
  "options": [
   {
    "label": "A",
    "text_en": "Tell her the injury is temporary and that in twelve weeks she will have her old practice back.",
    "text_zh": "告诉她这次受伤是暂时的，十二周之后她会把原来的练习拿回来。",
    "correct": false,
    "note": "It promises the return of a practice that no longer exists, and that promise is the thought that walks a senior student back into an old range on an older body. It also confirms her conclusion that her worth was the level."
   },
   {
    "label": "B",
    "text_en": "Give her a practice she can do every day with that arm out of use, at the same hour she always practised, and talk to her only about today.",
    "text_zh": "给她一套每天都能做、且那只手臂不参与的练习，在她一向练习的同一个时间做，而且只跟她谈今天。",
    "correct": true,
    "note": "Correct. Keeping the daily container while dropping the level separates the practice from the identity, and today facts stop a twelve week condition from being written down as a permanent one."
   },
   {
    "label": "C",
    "text_en": "Tell her to rest completely and to come back once the shoulder has healed.",
    "text_zh": "叫她完全休息，等肩膀好了再回来。",
    "correct": false,
    "note": "Kind, standard, and it removes the container at the exact moment the identity has already gone. It also agrees with her that practice means the postures she currently cannot do."
   },
   {
    "label": "D",
    "text_en": "Ask her to come to the room anyway, to watch and to help you with adjustments, so that she does not lose her place in the community.",
    "text_zh": "请她照样来教室，看着，也帮你做调整，这样她不会失去自己在这个群体里的位置。",
    "correct": false,
    "note": "It keeps her attendance and takes away her practice. Every morning she watches the thing she believes defined her being done by other people, with nothing of her own to do, which keeps the level as the measure of her."
   }
  ],
  "explanationExpected_en": "A full answer separates three things. A twelve week fact written as a permanent identity is avidya, the temporary read as permanent. The identity itself is asmita, I am this level. The terror underneath it is abhinivesa, which knowledge does not touch, so an explanation will not reach her. Then the action: keep the daily container and drop the level, same hour, whatever the body can do with one arm out of use, and speak only in today facts. It should also say why the two kind answers fail, one promising the old practice back and feeding raga, the other removing practice at the exact moment the identity has collapsed.",
  "explanationExpected_zh": "完整的答案要把三件事分开。把一个十二周的事实写成永久的身份，这是无明，把无常读成常。身份本身是我执：我就是这个程度。底下的恐惧是怖畏，知识碰不到它，所以讲道理到不了她那里。接着是动作：保留每天的容器，放掉程度，同一个时间，一只手臂不能用的情况下身体能做什么就做什么，并且只用今天的事实说话。也要说明两个善意选项为什么不行：一个承诺把旧的练习还给她，喂的是贪；另一个正好在身份塌掉的那一刻，把练习也一起拿走。",
  "teacherPoint": "When an injury takes a student's level, keep the daily container and drop the level: same hour, whatever the body can do, and speak only in today facts.",
  "id": "KLE09"
 },
 {
  "lecture": "Shoulder Screening",
  "topic": "student-wants-you-to-fix-it-scope",
  "stem_en": "After class a student tells you that you know shoulders and asks whether you can just fix hers, because she does not want to pay a physiotherapist. Her shoulder is sore at the front in Ūrdhva Mukha Śvānāsana and none of your red flags are present. What do you say?",
  "stem_zh": "下课后，一位学生对你说你懂肩膀，问你能不能直接帮她「治好」，因为她不想花钱去看物理治疗师。她做 Ūrdhva Mukha Śvānāsana 时肩膀前方会痛，而你的危险信号一条也没有。你怎么回答？",
  "options": [
   {
    "label": "A",
    "text_en": "Agree to fix it. Give her a session after class each week to work on that shoulder until it settles, since none of the serious signs are there and she trusts you.",
    "text_zh": "答应帮她治好。每周下课后单独给她做一次，直到肩膀好转。反正严重的信号一条也没有，她也信任你。",
    "correct": false,
    "note": "Taking the word fix takes on a treatment role you are not licensed for. If it does not settle she has lost weeks of the appointment she actually needed, and she has lost her trust in you as well."
   },
   {
    "label": "B",
    "text_en": "Tell her it is most likely her supraspinatus tendon and give her a rehab program for it.",
    "text_zh": "告诉她这多半是冈上肌肌腱的问题，并给她一套针对性的康复训练。",
    "correct": false,
    "note": "Naming a structure is a diagnosis, and nothing your hands can measure supports the name. She will carry that name for years and repeat it to other people."
   },
   {
    "label": "C",
    "text_en": "Tell her shoulder pain usually passes on its own and that she can keep practising as normal.",
    "text_zh": "告诉她肩膀痛一般自己会过去，照常练就行。",
    "correct": false,
    "note": "Dismisses a finding you could act on today, and leaves every loaded shape exactly where it is."
   },
   {
    "label": "D",
    "text_en": "Tell her what you can do, screen both sides and change what she practises, and what you cannot, name it or treat it. Then start the screen.",
    "text_zh": "告诉她你能做的：两侧筛查、调整她练的体式；也告诉她你不能做的：命名和治疗。然后就开始筛查。",
    "correct": true,
    "note": "Names the two jobs correctly, and she still leaves the room with something useful today."
   }
  ],
  "explanationExpected_en": "Say that a screen tells you where to look and what to change in her practice, and that naming the problem or treating it is licensed work that is not yours. Say that you can still act today by testing both sides and modifying the shapes that load the front of that shoulder, so declining the word fix is not declining to help.",
  "explanationExpected_zh": "说明：筛查告诉你「往哪里看」，以及她的练习要改什么；而给问题命名和治疗，是需要执照的工作，不属于你。你今天仍然能做事：两侧测试，调整那些负荷肩前的体式。所以拒绝「治好」这个说法，并不等于拒绝帮忙。",
  "teacherPoint": "Say out loud where your job ends, and give the student a concrete action in the same breath.",
  "id": "SHO10"
 },
 {
  "lecture": "Shoulder Screening",
  "topic": "range-on-her-own-versus-with-your-help",
  "stem_en": "A student tells you her left arm has stopped going overhead. She lifts it herself and it stops at about shoulder height. You ask her to let the arm go completely heavy, and you take it the rest of the way up for her easily, with no pain. What have you learned, and what comes next?",
  "stem_zh": "一位学生说她的左臂举不上去了。她自己抬，大约到肩高就停住。你让她把手臂完全放松交给你，你很轻松地把它带到了头顶，全程不痛。你从中知道了什么？接下来做什么？",
  "options": [
   {
    "label": "A",
    "text_en": "That the joint is stiff. Give her daily overhead stretching on that side and expect a long process.",
    "text_zh": "说明关节僵硬。给她这一侧每天做过头的拉伸，并且要有长期的心理准备。",
    "correct": false,
    "note": "That is the other branch of this comparison, the one where neither of you can move the arm. Here the joint plainly moves in your hands, so months of stretching would be spent on the wrong thing."
   },
   {
    "label": "B",
    "text_en": "That the joint itself moves, so the limit sits in the muscle or the tendon. Test strength on both sides next, starting with the right.",
    "text_zh": "说明关节本身是能动的，所以限制在肌肉或肌腱。下一步两侧测力量，从右侧开始。",
    "correct": true,
    "note": "Range on her own compared with range with your help separates a stiff joint from a muscle or tendon problem in about ten seconds, and weakness is the finding you then have to read."
   },
   {
    "label": "C",
    "text_en": "That she is guarding. The arm went up in your hands without pain, so ask her to push through her own limit.",
    "text_zh": "说明她在自我保护。手臂在你手里能上去而且不痛，所以让她自己冲过那个限制。",
    "correct": false,
    "note": "A relaxed arm moving painlessly does not mean the same arm can produce that movement under its own load. Pushing through is loading a shoulder you have not tested yet."
   },
   {
    "label": "D",
    "text_en": "Nothing usable, because you moved the arm rather than her. Wait until she is warm and ask her to try again.",
    "text_zh": "得不到有用的信息，因为动手臂的是你，不是她。等她练热了再让她试一次。",
    "correct": false,
    "note": "Throws away the one comparison in the whole screen that tells a stiff joint from a weak or sore muscle. Being warmer would not change that answer."
   }
  ],
  "explanationExpected_en": "Say that range has two halves, how far the arm goes on its own and how far you can take it, and that the difference between the two is the finding. Because the joint clearly moves when she relaxes, the joint is not the limit, so the problem sits in the muscle or the tendon. Say that the next step is strength on both sides, starting with the side she has not complained about, and that painless weakness there is a referral rather than a modification.",
  "explanationExpected_zh": "说明：活动度要看两半，她自己能抬到哪里，以及你能帮她抬到哪里，两者之间的差别才是发现。她放松时关节明显能动，所以限制不在关节，而在肌肉或肌腱。下一步是两侧测力量，从她没有抱怨的那一侧开始；如果那里出现「不痛却无力」，那是转介，不是调整体式。",
  "teacherPoint": "Compare range on her own against range with your help, and read that difference before deciding whether you are looking at a joint or a muscle.",
  "id": "SHO11"
 },
 {
  "lecture": "Shoulder Screening",
  "topic": "the-student-who-hides-pain",
  "stem_en": "A student who wants Marīcyāsana D has told you three times that her left shoulder is fine. In practice you keep seeing her come out of Caturaṅga early on that side and shake the arm out. What is the most useful next step?",
  "stem_zh": "一位很想拿到 Marīcyāsana D 的学生，已经三次告诉你她的左肩没问题。但你一再看到她在 Caturaṅga 里左侧提早起来，然后甩一甩那只手臂。下一步最有用的是什么？",
  "options": [
   {
    "label": "A",
    "text_en": "Take her at her word and give her the pose, since only she can feel what is happening inside her shoulder.",
    "text_zh": "相信她说的，把体式给她，因为只有她自己感觉得到肩膀里发生了什么。",
    "correct": false,
    "note": "A pain report is the one thing a student who wants a pose can shade. You would be adding load to a shoulder you have never actually looked at."
   },
   {
    "label": "B",
    "text_en": "Tell her you have seen her shaking the arm out, and that the pose waits until she is honest with you.",
    "text_zh": "告诉她你看见她在甩手臂，她不老实交代，这个体式就先等着。",
    "correct": false,
    "note": "Turns a screening problem into an argument about honesty. She hides it better next time and you still have no finding."
   },
   {
    "label": "C",
    "text_en": "Test strength on both sides, starting with the right, and read what each arm can hold against your hand.",
    "text_zh": "两侧都测力量，从右侧开始，看每只手臂能不能顶住你的手。",
    "correct": true,
    "note": "Force against your hand is the most objective thing your hands can measure without equipment, and it does not move with what she wants."
   },
   {
    "label": "D",
    "text_en": "Give her the pose, and tell her to come out the moment anything hurts.",
    "text_zh": "把体式给她，叮嘱她一有痛就马上出来。",
    "correct": false,
    "note": "Makes her pain report the safety system, when her pain report is the one unreliable instrument in this student."
   }
  ],
  "explanationExpected_en": "Say that pain is an output of the nervous system and moves with sleep, mood and motivation, so a student who wants the next pose can under report it. Say that force production against your hand is much harder to shade in either direction, so you test both sides, start with the side she has not complained about, and read weakness rather than her words.",
  "explanationExpected_zh": "说明：疼痛是神经系统的输出，会随睡眠、情绪和动机变化，所以一个想要下一个体式的学生可能会少报。而她能不能顶住你的手，这个力量输出往哪个方向都很难装。所以两侧都测，从她没有抱怨的那一侧开始，看「无力」，不看她的说法。",
  "teacherPoint": "When a student's words and their practice disagree, take the answer from strength testing on both sides rather than from asking again.",
  "id": "SHO12"
 },
 {
  "lecture": "Shoulder Screening",
  "topic": "cannot-reach-behind-the-back-use-the-belly-press",
  "stem_en": "You are screening a student's shoulders and you reach the lift-off, where the back of the hand rests on the low back and she lifts it away. She cannot get into that position at all: the arm will not go behind her, and trying to put it there hurts. What do you do?",
  "stem_zh": "你在给一位学生做肩部筛查，做到抬离测试：手背贴在下背部，让她把手抬离。可是她根本进不了这个位置，手臂转不到背后，硬要放还会痛。你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Leave that position alone. Use the belly press instead: hand flat on the stomach, elbow forward, she presses your hand away.",
    "text_zh": "别用那个位置了，改用腹部推压：手掌平放在腹部，肘向前，让她把你的手推开。",
    "correct": true,
    "note": "The alternative exists for exactly this student, it takes ten seconds, and you still get an answer on both sides."
   },
   {
    "label": "B",
    "text_en": "Ease her hand into the position for her, gently, so that both sides can still be tested exactly the same way.",
    "text_zh": "轻轻地帮她把手放到位，这样两侧还是能用完全一样的方式测。",
    "correct": false,
    "note": "Forcing a position she cannot reach turns a test into a risk, and a hand you put there tells you nothing about what she can do herself."
   },
   {
    "label": "C",
    "text_en": "Record it as a positive finding, since not being able to reach the position is at least as bad as not being able to lift off.",
    "text_zh": "把它记成阳性，因为「摆不到这个位置」至少和「抬不起来」一样严重。",
    "correct": false,
    "note": "Two different findings collapsed into one. Not being able to get there is range, not strength, and a positive you invented will follow her through every review."
   },
   {
    "label": "D",
    "text_en": "Skip that test and write down that the shoulder is simply too stiff to screen this way today.",
    "text_zh": "跳过这个测试，记下：这个肩今天太紧，用这种方式筛查不了。",
    "correct": false,
    "note": "Gives up the one finding you were missing when a second version of the test was available in the same minute."
   }
  ],
  "explanationExpected_en": "Say that you never force the hand behind the back, and that the belly press is there for exactly this student: hand flat on the stomach, elbow held forward, she presses in while you watch the elbow, and losing the elbow backward is the positive sign. Say that you still test both sides, and that not being able to reach behind the back is a range finding you record separately from anything you learn about strength.",
  "explanationExpected_zh": "说明：绝不要硬把手掰到背后；压腹测试正是为这样的学生准备的：手掌平贴腹部，手肘保持向前，她把手压向肚子，你看手肘，手肘往后掉就是阳性。两侧仍然都要测。另外，「手放不到背后」属于活动度的发现，要和力量的发现分开记录。",
  "teacherPoint": "When a student cannot get into the test position, switch to the belly press instead of forcing the hand or dropping the finding.",
  "id": "SHO13"
 },
 {
  "lecture": "Shoulder Screening",
  "topic": "tender-under-pressure-is-not-a-finding",
  "stem_en": "A student reports pain at the front of her left shoulder in Ūrdhva Mukha Śvānāsana. You feel for the biceps groove on the right first, press firmly, and she says that one is a bit sore. You press the left the same way and she says it is sore too. What does this tell you?",
  "stem_zh": "一位学生说她做 Ūrdhva Mukha Śvānāsana 时左肩前方痛。你先摸右侧的二头肌沟槽，用力按下去，她说右边有点痛。你用同样的力气按左侧，她说左边也痛。这说明什么？",
  "options": [
   {
    "label": "A",
    "text_en": "That both grooves are irritated, so take the depth of Ūrdhva Mukha Śvānāsana down on both sides for a few weeks.",
    "text_zh": "两侧的沟槽都被刺激了，所以接下来几周两边都把 Ūrdhva Mukha Śvānāsana 的深度降下来。",
    "correct": false,
    "note": "Builds a modification on an artefact of your own hand, and she walks out believing both shoulders are a problem."
   },
   {
    "label": "B",
    "text_en": "That the left is the side she complains about, so count the left as positive and treat the right as background.",
    "text_zh": "左边才是她抱怨的那一侧，所以左侧算阳性，右侧当背景噪音处理。",
    "correct": false,
    "note": "Reads her answer through the result you expected. Under that pressure the right was positive too, and you cannot keep only the half that fits."
   },
   {
    "label": "C",
    "text_en": "Not much yet, so press harder on the left to find out whether it is genuinely worse.",
    "text_zh": "目前信息还不够，那就在左侧按得更重一点，看看是不是真的更痛。",
    "correct": false,
    "note": "A hard press produces a positive in almost anybody, so this manufactures the false positive you were trying to avoid."
   },
   {
    "label": "D",
    "text_en": "Almost nothing. Both answers came from the pressure you used, so test again with a light, equal press on both sides.",
    "text_zh": "几乎什么也说明不了。两边的答案都是你的力度造成的，所以两侧用同样的轻力度重测一次。",
    "correct": true,
    "note": "A completely normal tendon is tender when you dig into it, so with that press the finding is yours rather than hers."
   }
  ],
  "explanationExpected_en": "Say that a normal tendon is tender if you dig into it, so a firm press gives a false positive on almost anyone, and pressing harder only makes that worse. Say that the only usable version of this is light, equal pressure on both sides with one side clearly worse than the other, and that until you have that you change nothing about her practice.",
  "explanationExpected_zh": "说明：完全正常的肌腱被用力按也会痛，所以用力压几乎在任何人身上都能压出假阳性，按得更重只会更糟。唯一可用的做法是两侧用同样的轻力度比较，其中一侧明显更痛才算数。在拿到这个结果之前，她的练习什么都不改。",
  "teacherPoint": "Palpate with light, equal pressure on both sides, and treat a result produced by your own hand as no finding at all.",
  "id": "SHO14"
 },
 {
  "lecture": "Shoulder Screening",
  "topic": "modify-the-shape-keep-the-pose",
  "stem_en": "A student lifts the back of her hand away from her low back on the right but clearly less on the left, and the bind in Marīcyāsana C has started to pinch at the front of the left shoulder. The reverse prayer in Pārśvottānāsana does the same thing. She is upset because she thinks you are about to take both poses away from her. What do you give her tomorrow morning?",
  "stem_zh": "一位学生的抬离测试：右手能把手背抬离下背部，左手明显抬得少；而且 Marīcyāsana C 的缠绕开始在左肩前方夹痛，Pārśvottānāsana 的反祈祷手也一样。她很沮丧，以为你要把这两个体式都收走。明天早上你给她什么？",
  "options": [
   {
    "label": "A",
    "text_en": "A strap in the bind, the elbows held instead of the reverse prayer, and the same tests again in six weeks.",
    "text_zh": "缠绕改用绳子，反祈祷改成互抱手肘，六周后用同样的测试重测。",
    "correct": true,
    "note": "The load comes off the front of the shoulder while both poses keep doing their work for the spine and the hip, and the review date gives you a real before and after."
   },
   {
    "label": "B",
    "text_en": "Take both poses out of her practice until the left side tests the same as the right side.",
    "text_zh": "把这两个体式从她的练习里拿掉，直到左侧测出来和右侧一样。",
    "correct": false,
    "note": "Removing the poses removes everything else the poses do, and equal to the right is a target a perfectly normal shoulder may never reach."
   },
   {
    "label": "C",
    "text_en": "Keep the bind and cue her to breathe and relax into it, because that position is what will open the shoulder.",
    "text_zh": "保留缠绕，提示她呼吸、放松进去，因为正是这个位置能把肩膀打开。",
    "correct": false,
    "note": "Well intentioned and harmful. Internal rotation plus extension behind the back, every morning, into a shoulder that already pinches, is the exact load you are meant to take off."
   },
   {
    "label": "D",
    "text_en": "Let her do the bind on the days it feels good and skip it on the days it does not.",
    "text_zh": "感觉好的日子做缠绕，不好的日子就跳过。",
    "correct": false,
    "note": "Hands the decision to a day to day pain report, so the load never really drops and there is nothing to compare in six weeks."
   }
  ],
  "explanationExpected_en": "Say that both shapes combine internal rotation with extension behind the back, which is the position that loads the muscle on the front of the shoulder blade and drags the biceps tendon through its groove, so that is the part of the shape you change. Say that the strap and the held elbows keep her practising both poses while the shoulder gets a few weeks of less load, and that you put a date on the review rather than guessing later.",
  "explanationExpected_zh": "说明：这两个形状都是「内旋加背后伸展」的组合，正是负荷肩胛骨前面那块肌肉、并让二头肌肌腱在沟槽里被拉扯的位置，所以要改的就是这一部分。用绳子和互抱手肘，她照样在练这两个体式，同时肩膀有几周的减负；复查要有日期，不是过后再猜。",
  "teacherPoint": "Change the part of the shape that loads the sore shoulder, and keep the student in the pose rather than removing it.",
  "id": "SHO15"
 },
 {
  "lecture": "Shoulder Screening",
  "topic": "strength-before-stretch-when-time-is-short",
  "stem_en": "A student with a clearly weaker left shoulder asks you for stretches to open it out, because her left side feels tight. She has fifteen minutes, three times a week, and no equipment. What do you give her?",
  "stem_zh": "一位学生左肩明显更弱，她来问你要一些拉伸动作，因为她觉得左边很紧。她每周有三次、每次十五分钟，也没有任何器材。你给她什么？",
  "options": [
   {
    "label": "A",
    "text_en": "The stretches she asked for. Tightness is what she feels, and stretching is what she will actually do.",
    "text_zh": "给她要的拉伸。她感觉到的就是紧，而且这是她真的会去做的事。",
    "correct": false,
    "note": "Spends the only fifteen minutes she has on the option that showed no protective effect in the pooled trials, and the weak side still gets no work."
   },
   {
    "label": "B",
    "text_en": "Release the tight left side first, because a tight side holds the weak side back, then add strength once it has let go.",
    "text_zh": "先把紧的左侧松开，因为紧的一侧会把弱的一侧压住，等它松开了再加力量训练。",
    "correct": false,
    "note": "That mechanism is not established, and saying it out loud turns a training gap into a story about a body that is broken. It also postpones the only thing that moves a weak side."
   },
   {
    "label": "C",
    "text_en": "Two strength movements she already knows, one pushing and one pulling.",
    "text_zh": "两个她已经会的力量动作，一个推，一个拉。",
    "correct": true,
    "note": "Strength is what changes a weak side, and two familiar movements are the ones she will actually complete three times a week."
   },
   {
    "label": "D",
    "text_en": "A mobility routine, since fifteen minutes with no equipment will not build strength anyway.",
    "text_zh": "给她一套活动度练习，反正十五分钟又没有器材，本来也练不出力量。",
    "correct": false,
    "note": "Not true, and it hands her the option with no protective effect. Her own body weight is load, and the weak side simply needs more of it than the strong side."
   }
  ],
  "explanationExpected_en": "Say that when time is limited the choice is strength, because across randomised trials covering more than twenty six thousand people strength work cut injury rates sharply while stretching showed no protective effect. Say that you can still answer the tight feeling honestly: stretching does not lengthen a muscle, it raises how much stretch she can tolerate, and a side that feels tight often eases once it is doing more work.",
  "explanationExpected_zh": "说明：时间有限时就选力量。在覆盖超过两万六千人的随机对照试验汇总中，力量训练大幅降低了损伤率，而拉伸没有表现出任何保护作用。同时可以诚实地回应那个「紧」的感觉：拉伸不会把肌肉拉长，它改变的是她能承受多大牵拉的耐受度；弱侧开始做更多工作之后，那种紧通常会缓解。",
  "teacherPoint": "Spend a student's limited time on strength, and explain the tight feeling without promising a longer muscle.",
  "id": "SHO16"
 },
 {
  "lecture": "Shoulder Screening",
  "topic": "same-shoulder-complaint-every-week",
  "stem_en": "For three months a student has told you at the start of nearly every class that her right shoulder is sore. Each week you give her a cue, she nods, and the next week she says the same thing. What has gone wrong, and what do you do now?",
  "stem_zh": "三个月来，几乎每次上课前，这位学生都告诉你她的右肩酸痛。每周你给她一个口令提示，她点头，下周她又说同样的话。问题出在哪里？现在你要做什么？",
  "options": [
   {
    "label": "A",
    "text_en": "Nothing has gone wrong here. Shoulders take time to settle, so keep giving the same cue and let it come good on its own.",
    "text_zh": "这里没出什么问题。肩需要时间，继续给同样的口令，让它自己慢慢好。",
    "correct": false,
    "note": "Three months of the same sentence is itself the finding. Treating each week as a fresh event means nobody ever reviews it and she never gets seen."
   },
   {
    "label": "B",
    "text_en": "Screen her properly once, write the three findings with the date, change one thing, and repeat the same tests in six weeks.",
    "text_zh": "认真做一次完整筛查，把三项发现和日期写下来，改一件事，六周后用同样的测试复查。",
    "correct": true,
    "note": "A dated screen plus one change gives you a real before and after, and a clear point at which to refer if nothing has moved."
   },
   {
    "label": "C",
    "text_en": "Screen her again every single week, so that you catch the exact moment something changes in either direction.",
    "text_zh": "每一周都重新筛查一次，好让你抓到它往任何方向变化的那个确切时刻。",
    "correct": false,
    "note": "Weekly testing gives you impressions rather than a comparison, and provoking a sore shoulder over and over can keep it stirred up."
   },
   {
    "label": "D",
    "text_en": "Tell her this practice may not suit her shoulder, and suggest she move across to a gentler class instead.",
    "text_zh": "告诉她这个练习可能不适合她的肩，建议她转去上更温和的课。",
    "correct": false,
    "note": "Pushes the student out of the room and names a cause you have never established. You still do not know what her shoulder does under your hand."
   }
  ],
  "explanationExpected_en": "Say that a weekly cue produces an impression and never a comparison, so three months can pass with nothing recorded. Say that the fix is one proper screen written in three columns, pain with where and at what angle, weakness with direction and side, range on her own against range with your help, dated, one modification in place, and the same tests repeated at six weeks. If nothing has changed by then, that is the point at which you refer.",
  "explanationExpected_zh": "说明：每周给一个提示，只会得到印象，永远得不到对比，所以三个月过去仍然什么都没有记录。正确的做法是认真做一次筛查，用三栏记录：疼痛（在哪里、在什么角度）、无力（哪个方向、哪一侧）、活动度（自己动 vs 协助下），写上日期，放一个调整进去，六周后用同样的测试复查。如果到那时还是没有变化，那就是转介的时机。",
  "teacherPoint": "Convert a repeating weekly complaint into one dated record, one modification, and a fixed review date.",
  "id": "SHO17"
 },
 {
  "lecture": "Shoulder Screening",
  "topic": "night-pain-red-flag-refer-today",
  "stem_en": "A student who has practised with you for two years mentions at the end of class that for the past two weeks her right shoulder has been waking her at three in the morning, and that no position settles it. She lifts the arm normally and says it barely hurts during practice. What do you do?",
  "stem_zh": "一位跟你练了两年的学生在下课时提到，最近两周她的右肩总在凌晨三点把她痛醒，换任何姿势都缓解不了。她手臂能正常抬起，练习中也几乎不痛。你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Give her a week off Caturaṅga and jump backs, then look at it again when she comes back.",
    "text_zh": "让她停做 Caturaṅga 和 jump back 一周，等她回来再看情况。",
    "correct": false,
    "note": "Treats a referral finding as a load problem. Pain that wakes her and settles in no position stays on the red flag list whatever she can do in class, so a rest week only delays the appointment."
   },
   {
    "label": "B",
    "text_en": "Run the full screening sequence to work out which structure is involved before you decide anything.",
    "text_zh": "先做完整套筛查流程，弄清楚是哪个结构的问题，再决定怎么办。",
    "correct": false,
    "note": "Looking for a name the screen cannot give. Once a red flag is there you stop testing to guess what it is, and no result would change what you do next anyway."
   },
   {
    "label": "C",
    "text_en": "Tell her to get it checked by a doctor this week, and keep her practising the shapes that do not load it.",
    "text_zh": "告诉她这周就去看医生，同时让她继续练那些不负荷这个肩膀的体式。",
    "correct": true,
    "note": "Pain that wakes her and will not settle is a referral finding, and referral does not mean she stops practising."
   },
   {
    "label": "D",
    "text_en": "Reassure her that a shoulder aching at night is common in people who sleep on that side, and suggest she change sides.",
    "text_zh": "安慰她说，夜里肩膀酸痛在习惯侧睡的人身上很常见，建议她换一侧睡。",
    "correct": false,
    "note": "Confuses aching while lying on that shoulder, which is common, with pain that wakes her from sleep and settles in no position. This sends a red flag home."
   }
  ],
  "explanationExpected_en": "Say that pain which wakes a student from sleep and will not settle in any position is on the red flag list, and that it is not the same thing as aching when she lies on that shoulder. Say that more tests would not change the action, that you write down what you found and hand it to her, and that referring her does not mean she stops practising.",
  "explanationExpected_zh": "说明：把人从睡眠中痛醒、并且换任何姿势都缓解不了，属于危险信号；这和压着那一侧睡时觉得酸不是一回事。再多做测试也不会改变你的处理；把你测到的写下来交给她，而转介并不等于让她停止练习。",
  "teacherPoint": "Recognise night pain that wakes a student as a same week referral, and keep her practising around it instead of stopping her.",
  "id": "SHO18"
 },
 {
  "lecture": "Shoulder Screening",
  "topic": "tingling-during-an-adjustment",
  "stem_en": "You are adjusting a student in a bind and she says the fingers on that side have gone tingly and numb. What do you do?",
  "stem_zh": "你正在给一位学生做缠绕的辅助，她说那一侧的手指开始发麻、有针刺感。你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Come out of the shape at once, ask whether this has happened away from the mat, and tell her to get it checked this week.",
    "text_zh": "立刻出体式，问她这种情况在垫子以外有没有发生过，并让她这周去做检查。",
    "correct": true,
    "note": "Anything travelling down the arm is on the referral list, and it is not something you make safe by adjusting more gently."
   },
   {
    "label": "B",
    "text_en": "Ease the bind and hold it more gently, since this is probably the strap or your grip pressing on the circulation.",
    "text_zh": "把缠绕放松一点、手上再轻一点，因为这多半是绳子或你的手压住了血流。",
    "correct": false,
    "note": "Explains away a nerve symptom you have no way to rule out, and keeps her in the position that produced it."
   },
   {
    "label": "C",
    "text_en": "Release her and move that bind to a strap version for the next few weeks.",
    "text_zh": "放开她，接下来几周这个缠绕改成用绳子的版本。",
    "correct": false,
    "note": "The right instinct in the wrong place. Numbness down the arm is not a load problem to be trimmed, it is a finding to be sent on."
   },
   {
    "label": "D",
    "text_en": "Release her, carry on adjusting her other poses as usual, and note it for next week.",
    "text_zh": "放开她，其他体式照常辅助，记下来下周再说。",
    "correct": false,
    "note": "Waits a week on a finding the list says goes now, and keeps loading the same shoulder in every other shape."
   }
  ],
  "explanationExpected_en": "Say that numbness or pins and needles travelling down the arm is one of the red flags, so it stops the adjusting and goes to a doctor rather than getting a modification. Say that you also ask whether it happens away from the mat, and that you keep your hands off that shoulder until she has been seen.",
  "explanationExpected_zh": "说明：麻木或针刺感沿着手臂往下走，是危险信号之一，所以要停止辅助、转介去看医生，而不是给一个替代动作。同时要问清楚这种情况在垫子以外会不会出现，并且在她检查之前，不要再对那个肩膀动手。",
  "teacherPoint": "Stop the adjustment and refer when a symptom travels down the arm, instead of softening the adjustment.",
  "id": "SHO19"
 },
 {
  "lecture": "Shoulder Screening",
  "topic": "doctor-restriction-versus-student-wish",
  "stem_en": "A student's doctor has told her no overhead loading for six weeks. Three weeks in she feels good, is bored, and asks you to let her do her full practice again because she has a retreat coming up. What do you do?",
  "stem_zh": "一位学生的医生要求她六周内不要做过头的负重。到第三周，她自我感觉很好，觉得无聊，又因为快要去参加一个静修营，来问你能不能恢复完整练习。你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Let her do the full practice and ask her to stop the moment anything hurts.",
    "text_zh": "让她做完整练习，叮嘱她一痛就停。",
    "correct": false,
    "note": "Puts her pain report in charge of a medical restriction. The restriction exists precisely because feeling fine does not mean the tissue is ready."
   },
   {
    "label": "B",
    "text_en": "Split the difference and let her do half the vinyāsas, since three weeks of rest has probably done most of the job.",
    "text_zh": "折中一下，让她做一半的 vinyāsa，毕竟三周的休息大概已经解决了大部分问题。",
    "correct": false,
    "note": "Inventing a halfway point is overriding a medical instruction with a guess, and it is a guess you could not defend to anyone."
   },
   {
    "label": "C",
    "text_en": "Ask her to stop coming to class until the six weeks are finished.",
    "text_zh": "请她等六周结束以后再来上课。",
    "correct": false,
    "note": "Removes the student from the room when most of the practice is fine, and she is more likely to load the shoulder unsupervised at home."
   },
   {
    "label": "D",
    "text_en": "Hold the restriction, and build her a full practice with nothing overhead in it.",
    "text_zh": "守住医生的限制，给她安排一套完整的、不含任何过头动作的练习。",
    "correct": true,
    "note": "The six weeks belongs to her doctor, and almost all of her practice is still available inside it."
   }
  ],
  "explanationExpected_en": "Say that a healing timeline is not yours to give and not yours to shorten, so the six weeks stands even when she feels well. Say that your job inside that restriction is to keep her practising everything that is allowed, which keeps her in the room, keeps her supervised, and keeps her from loading it alone at home.",
  "explanationExpected_zh": "说明：恢复的时间表不该由你来给，也不该由你来缩短，所以即使她感觉很好，六周依然是六周。在这个限制之内，你的工作是让她继续练所有允许的内容：这样她留在教室里、在你眼前练，也不会自己在家乱加负荷。",
  "teacherPoint": "Keep a medical restriction intact and build the largest practice that fits inside it.",
  "id": "SHO20"
 },
 {
  "lecture": "Psychology of Learning",
  "topic": "lapsed-student-warm-return",
  "stem_en": "A student who came five mornings a week for four months has not appeared for three weeks. She has not messaged you, and she read your last group message without replying. You decide to write to her privately. What do you write, and why?",
  "stem_zh": "一位学生连续四个月每周来练五个早晨，最近三周没有出现。她没有给你发过消息，你上次在群里发的通知她看了也没有回。你决定私下写给她。你会写什么，为什么？",
  "options": [
   {
    "label": "A",
    "text_en": "Warn her that the time away has set her back to the beginning, so she arrives knowing how much ground she must recover.",
    "text_zh": "告诉她这三周的停练已经把她打回起点，让她回来时清楚自己要补回多少。",
    "correct": false,
    "note": "Treats time away as a debt. Nothing resets when practice stops, and an accounting of her absence adds shame that makes coming back harder than staying away."
   },
   {
    "label": "B",
    "text_en": "Wait for her to come back on her own and say nothing now, so she never feels pressured or watched by her teacher.",
    "text_zh": "现在先什么都不说，等她自己回来，这样她不会觉得被老师催促或者盯着。",
    "correct": false,
    "note": "Mistakes silence for respect. What she lost is the relationship and her place in the room, and those are exactly what a short message restores."
   },
   {
    "label": "C",
    "text_en": "Write two ordinary lines: her spot in the room, one detail you remember about her practice, and an invitation to a short morning.",
    "text_zh": "写两句平常的话：位置给她留着、你记得她练习里的一个细节、请她来一个短早晨。",
    "correct": true,
    "note": "Rebuilds the belonging side of practice (known by name, a place kept, remembered) and makes the first morning back short enough to succeed at."
   },
   {
    "label": "D",
    "text_en": "Ask her to commit to a fixed number of mornings before she returns, so her intention is clear and the habit rebuilds properly.",
    "text_zh": "请她先承诺回来后一周固定练几个早晨，这样意愿清楚，习惯也能重新搭起来。",
    "correct": false,
    "note": "An if-then plan converts an existing intention, it does not create one. A commitment demanded before she returns reads as pressure and produces resistance."
   }
  ],
  "explanationExpected_en": "A full-mark explanation says that what she lost is the relationship and her sense of having a place, not accumulated days, and that nothing resets when someone stops for a while, so there is no ground to recover. Any message that counts her absence turns returning into a debt to repay and makes staying away easier. Two ordinary signals that she is known and has a place, plus a first morning short enough that she genuinely finishes it, restore relatedness and hand her an immediate success on the day she walks back in.",
  "explanationExpected_zh": "满分的解释要说明：她失去的是关系和「我在这里有位置」的感觉，不是累积的天数，停一段时间也不会把任何东西清零，所以根本没有什么要补回来。任何清算她缺席时间的消息，都会把「回来」变成一笔要偿还的债，让继续不来更容易。两个平常的信号（她被记得、位置还留着）加上一个短到她真的能做完的早晨，能恢复归属感，并让她回来的当天就拿到一次真实的成功。",
  "teacherPoint": "Write the return message in two lines that name her, her place and one thing you remember, and never mention how long she was away.",
  "id": "PSY16"
 },
 {
  "lecture": "Psychology of Learning",
  "topic": "first-class-nervous-beginner-load",
  "stem_en": "A woman in her fifties comes to her first Mysore morning. At the door she tells you she is stiff, cannot sit on the floor, and is worried she will hold everyone up. You have one hour with her. How do you run her first morning?",
  "stem_zh": "一位五十多岁的女性第一次来上 Mysore。她在门口就告诉你，自己身体很硬，坐不下地板，怕会拖住大家。你有一个小时和她在一起。她的第一个早晨你怎么安排？",
  "options": [
   {
    "label": "A",
    "text_en": "Teach a short opening she can actually finish, demonstrate each posture in full, give one or two cues, and use her name throughout.",
    "text_zh": "教她一段她真的做得完的短序列，每个体式完整示范，只给一两个口令，并叫她的名字。",
    "correct": true,
    "note": "A novice learns best from a full demonstration and one or two cues, and one genuine finish plus being known by name is what brings her back tomorrow."
   },
   {
    "label": "B",
    "text_en": "Take her through the whole standing sequence and half of seated, explaining the anatomy of each posture so she understands what she is doing.",
    "text_zh": "带她做完整套站立加一半坐姿，逐个体式讲解解剖结构，让她明白自己在做什么。",
    "correct": false,
    "note": "Overloads a sharply limited working memory and uses anatomy where an external cue belongs, so she leaves with no success and with her fear confirmed."
   },
   {
    "label": "C",
    "text_en": "Place her mat beside your most advanced student and let her watch that practice, so she sees at once what the method can produce.",
    "text_zh": "把她的垫子放在你最厉害的学生旁边，让她看那个练习，一开始就看到这套方法能练出什么。",
    "correct": false,
    "note": "An unreachable model gives her a ranking rather than a route. A demonstrator who started where she started is the only one whose success transfers to her."
   },
   {
    "label": "D",
    "text_en": "Reassure her repeatedly that she is doing well and promise the postures will come if she simply keeps showing up for a year.",
    "text_zh": "反复告诉她她做得很好，并且承诺只要她坚持来上一年，那些体式自然就会到位。",
    "correct": false,
    "note": "Substitutes reassurance for real success and promises postures as a function of hours, which later becomes her private evidence that she has failed."
   }
  ],
  "explanationExpected_en": "A full-mark explanation says that working memory is sharply limited, so a beginner learns better from a full demonstration and one or two cues than from anatomical explanation or a long sequence, and that the first three months are when most people leave. The job of a first morning is therefore one genuine, repeatable success rather than coverage, because actually succeeding is by far the strongest source of the belief that she can do this. Using her name and giving her a place are the ordinary signals that start the move from trying yoga to being a practitioner.",
  "explanationExpected_zh": "满分的解释要说明：工作记忆容量非常有限，新手从完整示范和一两个口令中学到的，多于从解剖讲解或一长串序列中学到的；而最初三个月正是流失最集中的时候。所以第一个早晨的任务不是把内容做完，而是给她一次真实、可以重复的成功，因为「真的做到」是自信最强的来源。叫得出她的名字、给她一个位置，是让她从「我在尝试瑜伽」走向「我是一个练习者」的平常信号。",
  "teacherPoint": "Design a first morning around one genuine finish: full demonstration, one or two cues, her name used out loud, and nothing added.",
  "id": "PSY17"
 },
 {
  "lecture": "Psychology of Learning",
  "topic": "comparison-ranking-public-praise",
  "stem_en": "A student eight months in tells you after practice that she cannot keep going next to the woman beside her, who binds everything easily. She says it makes her feel she is not built for this. Looking at your own room, what do you do?",
  "stem_zh": "一位练了八个月的学生在练完后告诉你，她没办法继续在旁边那位学生身边练：那个人所有的绑手都轻松做到。她说这让她觉得自己天生不适合练这个。回头看你自己的教室，你会怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Move her mat to the back row where the advanced practitioners are out of her sight, so the comparison stops disturbing her practice.",
    "text_zh": "把她的垫子挪到后排，让那些练得好的人不在她视线里，比较就不会再干扰她的练习。",
    "correct": false,
    "note": "Treats a room-level ranking as her seating problem. Hiding her at the back cuts the belonging that keeps her coming, and the comparison survives the move."
   },
   {
    "label": "B",
    "text_en": "Tell her privately that comparing herself is a habit she must drop, and that her attitude is what stands between her and progress.",
    "text_zh": "私下告诉她，比较是她必须改掉的习惯，真正拦在她和进步之间的是她自己的心态。",
    "correct": false,
    "note": "Person-focused feedback laid on top of a teaching artefact. Your public praise built the ranking, and now she carries it as a fault in her character."
   },
   {
    "label": "C",
    "text_en": "Add a daily private correction in her binding postures until she catches up with the mat beside her and the comparison no longer stings.",
    "text_zh": "每天私下多纠正她那几个绑手体式，直到她追上旁边那位，比较就不再刺人了。",
    "correct": false,
    "note": "Accepts the premise that she must catch up and builds dependence on your hands, so the posture holds while you stand there and collapses at home."
   },
   {
    "label": "D",
    "text_en": "Stop praising advanced postures out loud, name the hard parts to the whole room, and give her a version of the bind she completes.",
    "text_zh": "不再当众表扬高级体式，把难的地方讲给全体，并给她一个她能做完的绑手版本。",
    "correct": true,
    "note": "Removes the spotlight that created the ranking, moves difficulty to group level so no one carries it alone, and rebuilds her expectancy out of a real success."
   }
  ],
  "explanationExpected_en": "A full-mark explanation says that her comparison is partly manufactured by the room: praise delivered out loud for an advanced posture creates a felt ranking, and the students who read themselves as below the line move toward quitting. Addressing the hard part to everyone reaches the person who needs it without exposing anyone, so no single student is the one who cannot do it. And because how she reads difficulty decides whether she stays, the answer is a scaled version she genuinely completes rather than an argument about her attitude, since actually succeeding is what changes the belief.",
  "explanationExpected_zh": "满分的解释要说明：她的比较有一部分是教室制造出来的。当众表扬高级体式会造出一种「这里有个排名」的感觉，而把自己读成排在后面的学生会走向放弃。把难的地方讲给全体，能传达给需要的人又不暴露任何人，这样就没有哪一个人是「那个做不到的人」。而她如何解读困难决定了她会不会留下，所以正确的做法是给她一个真的能做完的简化版本，而不是和她辩论心态，因为改变信念的是真实的成功。",
  "teacherPoint": "Stop praising advanced postures in the room, move every hard point to the group level, and give the comparing student a version she completes today.",
  "id": "PSY18"
 },
 {
  "lecture": "Psychology of Learning",
  "topic": "plateau-normal-stage-variation",
  "stem_en": "A man who has practised with you for six years says his practice has felt the same for a year and he is bored. He still comes, but he has started skipping Fridays and has told you he may be finished with Ashtanga. What do you do?",
  "stem_zh": "一位跟你练了六年的男学生说，他的练习整整一年都是同一个样子，他觉得腻了。他还在来，但已经开始不来周五，并告诉你他可能不练 Ashtanga 了。你会怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Break his three weakest postures down step by step each morning, so he has concrete detail to work on again.",
    "text_zh": "每天早上把他最弱的三个体式一步步拆开讲给他，让他有具体的东西可以练。",
    "correct": false,
    "note": "Detail that served him as a beginner is now redundant and adds load, so more instruction makes his practice worse rather than more interesting."
   },
   {
    "label": "B",
    "text_en": "Tell him plateaus are a normal stage at his years of practice, then hand him real choices inside the practice and add variation.",
    "text_zh": "告诉他平台期是这个阶段的正常经历，然后在练习里给他真正的选择，并加入变化。",
    "correct": true,
    "note": "A plateau named as a normal stage stops him reading it as a verdict about himself, and choice plus variation is what an experienced practitioner needs."
   },
   {
    "label": "C",
    "text_en": "Set him a named posture to reach by December, and tell him the hours he needs will get him there if he stops skipping.",
    "text_zh": "给他定一个体式，要求十二月前做到，并告诉他只要不缺课，时数到了就会做到。",
    "correct": false,
    "note": "Promises a posture as a function of hours. Practice does not determine outcomes on its own, and a missed deadline becomes his proof that stopping was right."
   },
   {
    "label": "D",
    "text_en": "Offer him a discounted year of unlimited classes and a place in the shala group of long-standing students, to keep him coming.",
    "text_zh": "给他打折的全年不限次会员，并请他进老学生的馆内小组，把他留住。",
    "correct": false,
    "note": "Pays him for something he once did for its own sake, which weakens the enjoyment long practice runs on, and prices a problem that is about meaning."
   }
  ],
  "explanationExpected_en": "A full-mark explanation says that a plateau pre-framed as a normal stage stops him reading a flat year as evidence about himself, which is the reading that ends practices. Long-term adherence comes from enjoying the practice, and that is sustained by autonomy, competence and relatedness, so handing him genuine choices and varied conditions is the move: variation helps an experienced practitioner even when it makes the session feel messy. More detailed correction at six years is redundant guidance that now degrades his practice, and paying him to stay replaces the internal motivation you actually need with an external one.",
  "explanationExpected_zh": "满分的解释要说明：预先把平台期说成正常阶段，能阻止他把这平淡的一年读成关于自己这个人的证据，而正是这种解读会结束一份练习。长期坚持靠的是喜欢练习本身，而这由自主、胜任感、归属感来维持，所以给他真正的选择和变化的条件才是对的做法：变化对资深练习者有益，即使当下会让他觉得练得乱。练到六年还给更细的拆解，属于冗余指导，此时会让他的练习变差；而用打折把他留下，是用外部动机替换掉你真正需要的内在动机。",
  "teacherPoint": "Say the word plateau out loud as a normal stage, then give a long-time student choices and variation instead of more correction.",
  "id": "PSY19"
 },
 {
  "lecture": "Psychology of Learning",
  "topic": "relatedness-community-not-list",
  "stem_en": "Your shala has ninety names on the class-pack list and a room that empties the moment practice ends. Nobody stays, nobody talks, and new students leave inside two months. You want a community rather than a list. What do you build first?",
  "stem_zh": "你的馆里有九十个名字在课程包名单上，而练习一结束教室就空了。没有人留下，没有人说话，新学生两个月内就走。你想要的是一个社群，而不是一份名单。你会先建什么？",
  "options": [
   {
    "label": "A",
    "text_en": "Launch a monthly attendance leaderboard and a badge at thirty mornings, so regulars are visible and newer students have something to work toward.",
    "text_zh": "做一个每月出勤排行榜，练满三十个早晨发一枚徽章，让常来的人被看见，新学生有目标。",
    "correct": false,
    "note": "Rewards and rankings weaken the motivation of students who already enjoy practice, and they tell everyone below the line that this room is not for them."
   },
   {
    "label": "B",
    "text_en": "Pair every new student with an advanced practitioner who corrects them during practice, so beginners get help and the room starts teaching itself.",
    "text_zh": "给每个新学生配一位资深练习者，在练习中随时纠正他，新人有人帮，教室自己就教起来了。",
    "correct": false,
    "note": "Well meant, but correction from a peer in front of others costs face, builds dependence on being corrected, and installs a hierarchy inside your community."
   },
   {
    "label": "C",
    "text_en": "Learn every name in the first week, keep their spots, ask about last week's practice, and normalise the hard parts to the whole room.",
    "text_zh": "第一周把每个人的名字记住，位置固定，问他们上周练得怎么样，并把难的地方讲给全体。",
    "correct": true,
    "note": "Belonging is made of ordinary signals, and difficulty normalised at group level is the condition under which students help each other instead of ranking each other."
   },
   {
    "label": "D",
    "text_en": "Run a discounted six-month pack and a referral bonus, so the list grows and the room fills with people who already know each other.",
    "text_zh": "推出打折的半年课程包和推荐奖励，名单就会变长，来的人彼此本来就认识。",
    "correct": false,
    "note": "Grows a list rather than a room. Discounts and referrals add names without adding the relationship and belonging that decide whether anyone stays."
   }
  ],
  "explanationExpected_en": "A full-mark explanation says that what holds people is relatedness and the identity signals that carry it: being known by name, having a place of your own, being asked about last week. Those are what move a student from trying yoga to being a practitioner, and they cost nothing. Rankings, badges and discounts act on a list, and external rewards attached to something a student already enjoys reduce the motivation that produces long practice. Naming difficulty to the whole room protects face so that no individual is the one struggling, and that is what makes a room where students help each other instead of measuring each other.",
  "explanationExpected_zh": "满分的解释要说明：真正留住人的是归属感，以及承载它的那些身份信号：被叫得出名字、有属于自己的位置、被问起上周练得怎么样。正是这些让学生从「我在尝试瑜伽」变成「我是一个练习者」，而且不花钱。排行榜、徽章和打折作用在名单上，而给学生本来就喜欢的事情加上外部奖励，会削弱那份支撑长期练习的动机。把困难讲给全体，保护了面子，让没有哪一个人是「那个做不到的人」，这才是学生互相帮忙而不是互相比较的前提。",
  "teacherPoint": "Build the three ordinary belonging signals (name, kept spot, a question about last week) before you spend anything on packs, badges or discounts.",
  "id": "PSY20"
 },
 {
  "lecture": "Psychology of Learning",
  "topic": "spacing-daily-versus-weekly-block",
  "stem_en": "A student with long work hours tells you she can only reach the shala once a week. She asks whether one four-hour Sunday session would leave her in the same place as forty-five minutes on six mornings. What do you tell her, and why?",
  "stem_zh": "一位工作时间很长的学生说，她每周只能来道场一次。她问：周日练一次四小时，是不是和每天早上四十五分钟、一周六天，最后到达的地方一样？你怎么回答她，为什么？",
  "options": [
   {
    "label": "A",
    "text_en": "Tell her the Sunday block is equal, because what matters is the total hours she puts in weekly.",
    "text_zh": "告诉她周日一次长练习效果一样，重要的是她每周一共练了多少小时。",
    "correct": false,
    "note": "Counts only total minutes. The same hours packed into one session leave less behind weeks later, so she works hard, keeps little, and reads the flat progress as evidence about herself."
   },
   {
    "label": "B",
    "text_en": "Tell her to come weekly and stop practising at home, so you can watch every posture yourself.",
    "text_zh": "告诉她每周来一次就好，在家不要练，这样每个体式都由你亲自看。",
    "correct": false,
    "note": "Puts all practice under your eye. She ends up with a practice that only runs when you are standing there, and she loses the daily frequency that makes anything hold."
   },
   {
    "label": "C",
    "text_en": "Tell her to keep the six short mornings, because practice spread across the week holds better.",
    "text_zh": "告诉她保持每天早上的短练习，分散在一周里的练习保持得更好。",
    "correct": true,
    "note": "The same total practice distributed over time produces better long-term retention than the same amount massed, which is what the daily Mysore format is already doing for her."
   },
   {
    "label": "D",
    "text_en": "Tell her to do the Sunday block and add breathing on other days to cover the gap.",
    "text_zh": "告诉她做周日的长练习，其余日子加些呼吸练习来补上差距。",
    "correct": false,
    "note": "Substitutes a different activity for frequency. The long and occasional structure stays in place, and she is told the gap is covered when it is not."
   }
  ],
  "explanationExpected_en": "Names distributed practice: the same total amount spread over time is retained better long term than the same amount packed together. Then says what you do with her, keep the six short mornings and treat frequency rather than weekly hours as the variable to protect, and notes that the Mysore format already builds the spacing in.",
  "explanationExpected_zh": "说出分散练习：同样的总量分散在一段时间里做，长期保持的效果好过集中在一起做。然后说明对她的处理：保持每周六天的短练习，要保护的变量是频率，而不是每周总时长；并指出 Mysore 的形式本身已经把分散做进去了。",
  "teacherPoint": "When a student offers you hours, negotiate for days instead: fix the frequency first and let the session length be whatever fits her life.",
  "id": "PSY21"
 },
 {
  "lecture": "Psychology of Learning",
  "topic": "cognitive-load-demo-then-two-cues",
  "stem_en": "A student in her third week arrives at the place where the bind is possible for the first time. You can see six things worth saying, and she is standing there waiting for you to speak. What do you do?",
  "stem_zh": "一位刚练三周的学生，第一次来到可以绑手的位置。你能看出六个值得提醒的点，而她正站在那里等你开口。你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Say all six points in order, slowly, so she has the full picture before starting.",
    "text_zh": "把六个点按顺序慢慢讲完，让她开始之前先有完整的画面。",
    "correct": false,
    "note": "Six points at once exceed what a new student can hold. She freezes or picks one at random, the posture gets worse, and she concludes she is slow."
   },
   {
    "label": "B",
    "text_en": "Give her the anatomy of the twist first, then have her name the muscles involved.",
    "text_zh": "先讲这个扭转的解剖结构，再让她说出用到哪些肌肉。",
    "correct": false,
    "note": "Points her attention inside the body and adds load before she moves. Naming muscles is explaining, not cueing, and she moves worse for it."
   },
   {
    "label": "C",
    "text_en": "Say nothing and let her find the shape alone, the way an experienced student would.",
    "text_zh": "什么都不说，让她自己找到形状，就像对资深学生那样。",
    "correct": false,
    "note": "Withholds the demonstration a novice learns best from. It reads as you not caring, and she guesses her way into a habit you will spend months undoing."
   },
   {
    "label": "D",
    "text_en": "Demonstrate the whole posture once, then give her one or two cues and let her move.",
    "text_zh": "完整示范一次，然后给她一到两个口令，让她动起来。",
    "correct": true,
    "note": "Working memory is sharply limited, and novices learn better from a full demonstration plus a small number of cues than from a full explanation."
   }
  ],
  "explanationExpected_en": "Names the limit on working memory: a beginner learns better from a whole demonstration and one or two cues, while six points at once overload her and the posture degrades. Says what you actually do, demonstrate, cue outward once or twice, let her move, and keep the remaining four points for later weeks.",
  "explanationExpected_zh": "说出工作记忆的容量限制：新手从完整示范加一到两个口令中学得更好，一次给六个点会让她超载、体式反而变差。并说明你实际怎么做：先完整示范，给一到两个向外的口令，让她动起来，剩下的四点留到后面几周再说。",
  "teacherPoint": "Before you speak to a beginner, pick the two cues you will actually say and hold the rest, then demonstrate instead of describing.",
  "id": "PSY22"
 },
 {
  "lecture": "Psychology of Learning",
  "topic": "teacher-own-practice-fixed-slot",
  "stem_en": "Your shala has grown. You teach six days a week from six in the morning until evening, and your own practice has slipped to twice a week. You keep telling yourself you will practise more once the schedule eases. What do you do?",
  "stem_zh": "你的道场做起来了。你每周六天、从早上六点教到晚上，自己的练习已经掉到每周两次。你一直告诉自己，等排课松一点就会多练。你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Fix one slot before teaching, tie it to an existing daily cue, and log it.",
    "text_zh": "把练习固定在教课前，绑在已有的日常触发点上，并做记录。",
    "correct": true,
    "note": "An if-then plan turns an intention you already have into behaviour, and keeping a log is among the strongest ways to sustain a physical activity."
   },
   {
    "label": "B",
    "text_en": "Practise alongside your students during class hours, so the same two hours serve both jobs.",
    "text_zh": "在上课的时间里和学生一起练，让同样的两个小时同时完成两件事。",
    "correct": false,
    "note": "Splits your attention two ways. Your students get a teacher who is inside his own posture, and you get a practice interrupted every two minutes."
   },
   {
    "label": "C",
    "text_en": "Bank a long practice on your day off each week, covering what the other days missed.",
    "text_zh": "每周在休息日集中练一次长的，把其他日子缺掉的量补回来。",
    "correct": false,
    "note": "Trades frequency for one long session, which holds less, and any busy week erases the entire week of practice at once."
   },
   {
    "label": "D",
    "text_en": "Let it rest this season, and keep your body ready by demonstrating postures during class.",
    "text_zh": "这一季先放下练习，靠在课上示范体式来保持身体的状态。",
    "correct": false,
    "note": "Treats demonstrating as practice. You lose daily contact with how hard the work actually is, and you already underestimate beginner difficulty by roughly a factor of two."
   }
  ],
  "explanationExpected_en": "Says why the intention alone fails and the plan works: a specific if-then tied to a fixed time, a fixed place and a cue already in your day converts an existing intention into behaviour, and self-monitoring holds it. Adds that short and daily beats one long catch-up, and that demonstrating in class is not your practice.",
  "explanationExpected_zh": "说明为什么光有意愿不成、有计划才成：具体的「如果…就…」绑在固定时间、固定地点和你日常已有的触发点上，才能把已有的意愿变成行为，而自我监控（记录）能把它维持住。并补充：每天短时间胜过一次补课式的长练习，课上示范不等于你自己的练习。",
  "teacherPoint": "Write your own if-then plan tonight the way you would write one for a new student, then hand yourself the log.",
  "id": "PSY23"
 },
 {
  "lecture": "Psychology of Learning",
  "topic": "saying-you-do-not-know",
  "stem_en": "A student who reads a great deal asks you in class whether a study she found on stretching and injury applies to this practice. You have not read it and you do not know the answer. Four other students are listening. What do you do?",
  "stem_zh": "一位读书很多的学生在课上问你：她看到一项关于拉伸与受伤的研究，这对这套练习适用吗？你没读过那项研究，也不知道答案，旁边还有四位学生在听。你怎么做？",
  "options": [
   {
    "label": "A",
    "text_en": "Give the most likely answer with confidence, since a clear reply keeps the room settled.",
    "text_zh": "用有把握的语气给出最可能的答案，一个明确的回答能让教室安定。",
    "correct": false,
    "note": "Buys calm with invented authority. The students who check things are often the ones who stay longest, and one confident wrong answer costs you all of them."
   },
   {
    "label": "B",
    "text_en": "Say you do not know, find out properly, and give her the answer next class.",
    "text_zh": "说你不知道，回去认真查清楚，下一堂课把准确的答案给她。",
    "correct": true,
    "note": "Not knowing costs you nothing, while repeating something unverified costs your credibility, and coming back with the answer shows the room that asking is safe."
   },
   {
    "label": "C",
    "text_en": "Offer the popular explanation you have heard other teachers use, and move the class on.",
    "text_zh": "把你听过的、别的老师常用的流行解释说给她，然后继续上课。",
    "correct": false,
    "note": "Recycles a claim you have not checked. This is exactly how learning styles, twenty-one days and ten thousand hours keep spreading through teachers."
   },
   {
    "label": "D",
    "text_en": "Tell her research is not the point here, and ask her to stay with her practice.",
    "text_zh": "告诉她研究不是这里的重点，请她把注意力放回自己的练习。",
    "correct": false,
    "note": "Treats a question as a distraction. She learns not to ask, and you lose the channel that tells you what the room has not understood."
   }
  ],
  "explanationExpected_en": "Says what is at stake: a teacher who passes on an unchecked claim loses credibility with precisely the students who verify things, and those students often stay the longest. Then gives the move, admit you do not know, look it up properly, return with the answer, and keep low risk channels open so questions keep coming to you.",
  "explanationExpected_zh": "说出关键在哪里：一个把没核实过的说法传出去的老师，正好会在那些会去核实的学生面前失去可信度，而这些学生往往留得最久。然后给出做法：承认自己不知道，回去认真查清楚，带着答案回来，并保留低风险的提问渠道，让学生愿意继续来问你。",
  "teacherPoint": "Answer an unknown with \"I do not know, I will find out and tell you next class,\" then actually come back with it.",
  "id": "PSY24"
 },
 {
  "lecture": "Psychology of Learning",
  "topic": "visiting-teacher-serves-newest",
  "stem_en": "Your shala is in its second year and your own teacher agrees to come to your city for four days. Six of your eleven regular students are inside their first three months of practice. How do you set the four days up?",
  "stem_zh": "你的道场进入第二年，你自己的老师答应来你的城市待四天。你十一位常来的学生里，有六位还在练习的最初三个月。这四天你怎么安排？",
  "options": [
   {
    "label": "A",
    "text_en": "Keep the four days for your advanced students, so your teacher sees the room at its best.",
    "text_zh": "把这四天留给资深的学生，让你的老师看到这个道场最好的一面。",
    "correct": false,
    "note": "Turns the visit into a showcase and a ranking. The students most likely to leave are shut out during the exact months when leaving happens."
   },
   {
    "label": "B",
    "text_en": "Ask your teacher to correct each student in every posture across all four days, morning and afternoon.",
    "text_zh": "请你的老师在四天的每个上下午，逐一纠正每个学生的每个体式。",
    "correct": false,
    "note": "Constant correction for four days builds dependence, and the detail that serves a beginner is redundant load that makes your experienced students worse."
   },
   {
    "label": "C",
    "text_en": "Include the newest students in every session, scale so each one succeeds, and say difficulty is normal.",
    "text_zh": "让最新的学生参加每一堂，把体式简化到他们能做到，并说困难是正常的。",
    "correct": true,
    "note": "The visit serves students when the newest ones genuinely succeed at something, because real success is the strongest source of confidence in the first three months."
   },
   {
    "label": "D",
    "text_en": "Tell the newest students that four days with your teacher will move them into their next postures.",
    "text_zh": "告诉最新的学生，跟你的老师练这四天，就能进到下面的体式。",
    "correct": false,
    "note": "Promises postures as a function of time spent. When it does not happen, your promise becomes their private evidence that they are the problem."
   }
  ],
  "explanationExpected_en": "Says who the four days are for and why: the first three months are when students leave, real experiences of succeeding are the strongest source of their confidence, and a visit built around the advanced students creates a ranking that pushes the newer ones out. Then gives the design, everyone in every session, scaled so each person does a real version, difficulty normalised at group level, and no promise of postures.",
  "explanationExpected_zh": "说清这四天是为谁办的、为什么：最初三个月是学生最容易离开的阶段，真实的成功体验是他们信心最强的来源，而围着资深学生办的活动会造成排名感，把新学生往外推。然后给出安排：所有人都参加每一堂，把体式简化到每个人都真的能做到某个版本，在团体层面把困难正常化，并且不承诺任何体式。",
  "teacherPoint": "Build a visiting teacher's schedule around the students in their first ninety days, and give every one of them a version they can actually do.",
  "id": "PSY25"
 }
];
