/**
 * AYBKK Daily Persuasion Lesson — Telegram Sender
 * Runs daily at 5:30am via cron
 * Uses existing TELEGRAM_BOT_TOKEN and BOONCHU_CHAT_ID from .env
 */

require('dotenv').config();
const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.BOONCHU_CHAT_ID;

// Program start date (Day 1 was manually sent on May 16, so Day 2 starts May 17)
const START_DATE = new Date('2026-05-16');

const lessons = [
  { day: 1, title: "Burning Desire — The Engine of All Influence", book: "Think and Grow Rich",
    concept: "Before you can move anyone else, you must be moved yourself. The most persuasive people are the most *convinced*. When you speak from deep conviction, people feel it before you finish your sentence.",
    practice: ["'I know this will change something for you.'", "'This is the most important thing I've learned in 5 years.'", "'I want to be honest with you about why I do this.'", "'When I first discovered this, I couldn't sleep.'"],
    reflection: "What do I believe so deeply that I would teach it for free?" },

  { day: 2, title: "Genuine Interest — Stop Being Interesting", book: "How to Win Friends & Influence People",
    concept: "Stop trying to be interesting. Start being *interested*. The person who asks better questions wins every room. Most people listen to respond — you will listen to *understand*.",
    practice: ["'Tell me more about that.'", "'What made you decide to start this?'", "'That's interesting — what happened next?'", "'I want to make sure I understand what you mean.'", "'How did that make you feel?'"],
    reflection: "Today, how many times did I give my opinion when I could have asked a question instead?" },

  { day: 3, title: "The Labeling Technique — Name What People Feel", book: "Never Split the Difference",
    concept: "Naming someone's emotion out loud immediately reduces its power. You don't have to solve the problem — just name it first. Works with aggressive students, upset customers, frustrated wife.",
    practice: ["'It seems like you're frustrated about something.'", "'It sounds like this has been difficult for you.'", "'It looks like you have some concerns.'", "'It seems like there's something more you want to say.'"],
    reflection: "When someone was emotional today, did I try to fix it or did I just name what I saw?" },

  { day: 4, title: "Law of Rapport — People Trust Mirrors", book: "Art of Seduction + Influence",
    concept: "Before you persuade anyone, they must feel *like you*. Don't mirror words — mirror *energy*. If someone is slow and thoughtful, slow down. If they're excited, match first, then guide.",
    practice: ["'That's exactly how I felt when I first started.'", "'You know what, I've been thinking the same thing.'", "'I understand — I've been there.'", "Repeat their last 3 words as a question: 'You said it felt impossible?'"],
    reflection: "With whom did I feel the most natural connection today — and why?" },

  { day: 5, title: "The Power of the Pause — Silence is Your Weapon", book: "Speak to Win + Never Split the Difference",
    concept: "The person who can hold silence controls the room. In speaking, a well-timed pause creates suspense. In negotiation, silence forces the other person to reveal more. In conflict, calm silence shows you're thinking — not reacting.",
    practice: ["Pause 3 full seconds before answering any important question.", "'Let me think about that for a moment.'", "'That's a good question.' (then pause)", "After a strong point — say nothing. Let it breathe."],
    reflection: "When did I rush to fill silence today that I could have held?" },

  { day: 6, title: "Value First — Give So Much They Feel Guilty", book: "100M Offers (Hormozi)",
    concept: "Give so much value that people feel *guilty* not paying you. Teach something so useful in the preview that they think: 'If this is free, what is the paid version like?'",
    practice: ["'Let me show you something that usually takes 3 years to figure out.'", "'I'm going to give you the thing that changed everything — for free.'", "'Most teachers charge for this. I just want you to have it.'", "'If this is all you get today, it was worth the time.'"],
    reflection: "What is one piece of valuable knowledge I could give away this week that I've been saving?" },

  { day: 7, title: "WEEK 1 REVIEW — Your Personal Power Audit", book: "All Books",
    concept: "Look back at Days 1–6. No new concept today — just honest self-review.\n\n1. Desire: Is my conviction visible when I speak?\n2. Interest: Am I asking enough questions?\n3. Labeling: Have I tried naming someone's emotion?\n4. Rapport: Do I match energy before leading?\n5. Silence: Can I hold a 3-second pause?\n6. Value: Am I giving before asking?",
    practice: ["'Tell me what you think — I want to hear it before I share mine.'"],
    reflection: "Which of the 6 tools from this week made the biggest difference for me?" },

  { day: 8, title: "Open Strong, Close Stronger", book: "Speak to Win",
    concept: "Audiences decide in the first 30 seconds whether they trust you. Your opening is not a greeting — it's a statement of power. Best openings: bold statement, powerful question, or a story that puts them in a moment.",
    practice: ["'What I'm about to tell you will change how you see your own body forever.'", "'Have you ever been in the middle of practice and felt completely lost?'", "Close: 'Take one thing from today. Just one. Use it before you sleep tonight.'", "Close: 'If you remember nothing else — remember this:'"],
    reflection: "How do I currently open my classes? Does it command attention or just start?" },

  { day: 9, title: "Stories Are the Trojan Horse", book: "How to Win Friends + Speak to Win + Hormozi",
    concept: "A fact tells. A story sells. Stories bypass the logical brain and go straight to emotion. Structure: 'Before I knew this, I was [struggling]. Then I discovered [insight]. Now [result]. And you can do the same.'",
    practice: ["'Let me tell you about a student who had this exact problem.'", "'When I first started teaching, I made a mistake that changed everything.'", "'I want to share something personal with you.'", "'This story is going to sound strange, but stay with me.'"],
    reflection: "What is one transformation story from my own life I could tell in under 2 minutes?" },

  { day: 10, title: "Tactical Empathy — Feel Their World", book: "Never Split the Difference",
    concept: "See their perspective so clearly you can voice it better than they can. When you do this, they feel no need to argue. The greatest act of power in a conversation is making the other person feel completely heard — before you say a single word about your own position.",
    practice: ["'Help me understand your side of this.'", "'What would make this feel right for you?'", "'I can see why you'd feel that way — and here's what I want you to know.'", "'You're not wrong to feel that.'", "'What do you need from me right now?'"],
    reflection: "Today, did I try to WIN an argument or truly understand it?" },

  { day: 11, title: "Scarcity and Social Proof", book: "Influence (Cialdini)",
    concept: "Scarcity: people want what they might not be able to have — use real limits. Social Proof: people follow people like them. You don't say 'I'm good.' You show what your students became.",
    practice: ["'I only work with 12 students at a time — that's how I maintain quality.'", "'One of my students, after 3 weeks, said this...'", "'This cohort fills fast — last time we had a waitlist.'", "'I'm not the right teacher for everyone. But if you're serious, this is for you.'"],
    reflection: "What real results have my students had that I haven't been sharing publicly?" },

  { day: 12, title: "Questions Over Pressure — Ask, Never Push", book: "Never Split the Difference + 48 Laws of Power",
    concept: "Aggressive selling creates resistance. Ask a question that makes THEM convince YOU. The person who asks the question controls the frame. When attacked: stay curious, not defensive.",
    practice: ["'What would need to be true for this to work for you?'", "'How do you see this going?'", "'What's the biggest thing stopping you right now?'", "'What would happen if you didn't do anything about this?'", "When attacked: 'What makes you say that?'"],
    reflection: "When I want someone to do something, do I tell them — or do I ask them into it?" },

  { day: 13, title: "The Anchored Identity", book: "Influence + 48 Laws of Power",
    concept: "Once people declare an identity, they act in line with it. Get a small yes first. Name their identity. Let them say who they are, then hold them to it. People live up to the label you give them.",
    practice: ["'You strike me as someone who takes this seriously.'", "'People like you — who really commit — always get the most out of this.'", "'What kind of practitioner do you want to be?'", "'You said you wanted to change — what does that look like for you?'", "'I work with people who are ready. Are you ready?'"],
    reflection: "What identity am I giving my students, my wife, the people I want to influence?" },

  { day: 14, title: "WEEK 2 REVIEW — Communication Audit", book: "All Books",
    concept: "Review Days 8–13:\n\n1. Opening: How do I open classes and pitches?\n2. Stories: Do I have 3 ready transformation stories?\n3. Tactical Empathy: Am I voicing their perspective first?\n4. Scarcity & Proof: Am I showing results consistently?\n5. Questions: Do I ask or push?\n6. Identity: What identity am I giving the people I lead?",
    practice: ["'Before I tell you what I think, let me make sure I understand what you need.'"],
    reflection: "Which of the 6 tools from Week 2 was hardest for me — and why?" },

  { day: 15, title: "Strategic Withdrawal — Be Slightly Hard to Get", book: "Art of Seduction + 48 Laws of Power",
    concept: "We value most what we work for. When you are slightly unavailable, slightly mysterious — you become more interesting. For your course: don't be desperate. Let them convince you they're ready. For teaching: don't give every answer immediately.",
    practice: ["'I'd love to work with you — let me think about whether this is the right fit.'", "'That's a great question. Sit with it for a day — what do you think the answer is?'", "'I'm not available that day, but tell me more about what you're looking for.'", "Say less than necessary. Let them wonder."],
    reflection: "Where am I being too available, too eager, too easy to read?" },

  { day: 16, title: "The Allure of the Unfinished", book: "Art of Seduction",
    concept: "We obsess over unfinished things more than finished ones (Zeigarnik Effect). End lessons at a peak moment, not at a resolution. Don't finish every story. In content: ask a question you don't answer yet.",
    practice: ["'I'll tell you the second part of this next time.'", "'There's something even more interesting here — but that's for another day.'", "'This connects to something much deeper — but let's start here.'", "End class: 'Think about this tonight. We'll pick it up tomorrow.'"],
    reflection: "In my teaching and content, do I resolve everything — or do I leave some beautiful tension?" },

  { day: 17, title: "Concede Small to Win Big", book: "48 Laws of Power + Never Split the Difference",
    concept: "When you agree quickly on small things, you gain enormous trust on the big things. With aggressive people: find the 10% that's valid in what they say and agree with it. You don't have to agree with everything — just find the true part. This disarms them instantly.",
    practice: ["'You're right about that — and here's what I'd add.'", "'That's a fair point. I hadn't thought of it that way.'", "'I can see your side. What would make this feel right for both of us?'", "'You may be right. Let me think about that.'"],
    reflection: "In a recent conflict, where could I have conceded 10% and gained 90% of what I wanted?" },

  { day: 18, title: "Social Proof in Motion", book: "Influence + Hormozi",
    concept: "The most powerful marketing is what others say while you're in the room. Collect, curate, and deploy your students' words consistently. Testimonials aren't just for websites — they're for every conversation.",
    practice: ["'I had a student who came to me with the same question — here's what happened.'", "'I'll let my students speak for me.'", "'Before I explain what I do, let me share what the last cohort experienced.'", "This week: post one student quote. Just one."],
    reflection: "Do I have at least 5 student transformation stories I can tell in under 60 seconds each?" },

  { day: 19, title: "Reframing — Change the Container", book: "Influence + Never Split the Difference + 48 Laws",
    concept: "You don't change the facts — you change the frame around the facts. The person who controls the frame controls the emotion. The person who controls the emotion controls the decision.",
    practice: ["'Think of it less as [negative] and more as [positive].'", "'The fact that this is hard is exactly why it's valuable.'", "'You're not behind — you're exactly where you need to be to learn this.'", "'This isn't a cost — it's an investment in [specific result].'", "'Most people see this as a problem. I see it as the beginning.'"],
    reflection: "What negative frame do I carry about my course or my teaching that needs to change?" },

  { day: 20, title: "Reciprocity — Give First, Win Later", book: "Influence + Hormozi + Carnegie",
    concept: "When you give someone something, they feel an obligation to give back. Give value before asking for anything. In your course: free content must be so good that buying feels obvious. The key: give first, give unexpectedly, and give something personal.",
    practice: ["'I want to give you something before we talk about anything else.'", "'I noticed something about your practice I think will help you.'", "'Here — take this. No strings. I just think it'll help.'", "In content: 'Here's the full system — for free.'"],
    reflection: "Am I giving enough — to students, to my audience, to my wife — without keeping score?" },

  { day: 21, title: "WEEK 3 REVIEW — Your Power Audit", book: "All Books",
    concept: "Review Days 15–20:\n\n1. Withdrawal: Am I too available?\n2. Unfinished: Do I create tension and desire?\n3. Concede small: Can I agree with 10% to defuse 100%?\n4. Proof: Am I letting my students speak for me?\n5. Reframe: What negative frame do I still carry?\n6. Reciprocity: Am I giving first, consistently?",
    practice: ["'What's the most useful thing I can give you today?'"],
    reflection: "Week 3 — which day's lesson showed up most powerfully in your real life?" },

  { day: 22, title: "The Irresistible Offer", book: "100M Offers (Hormozi)",
    concept: "Value formula: Dream Outcome + Perceived Likelihood + Speed + Ease — Effort and Sacrifice. Your offer must answer: What is the dream? How likely will they get it with you? How fast? How easy compared to doing it alone? Don't sell yoga — sell who they become.",
    practice: ["'In [X weeks], you'll be able to [result] — without [common pain point].'", "'I designed this so even someone who [limitation] can achieve [result].'", "'This isn't another course. It's the shortcut I wish I had when I started.'", "'What's your biggest goal right now? Let me show you exactly how this gets you there.'"],
    reflection: "Can I describe my course offer in one sentence that makes someone say 'I need that'?" },

  { day: 23, title: "Copy That Connects", book: "Hormozi + Influence + Carnegie",
    concept: "Great copy is not clever — it's *clear*. It speaks the exact words your audience uses in their head. Talk to one person, not everyone. Use 'you' more than any other word. Open with their problem, not your solution.",
    practice: ["'If you've been practicing for years but still feel stuck — this is why.'", "'What nobody tells you about [topic].'", "'The [timeframe] that changed my practice forever.'", "'Stop doing [common thing]. Do this instead.'", "'You're not behind. You're just missing one thing.'"],
    reflection: "Look at my last 5 posts. Did I open with their problem — or my solution?" },

  { day: 24, title: "Stay Calm When Everything is On Fire", book: "Never Split the Difference + 48 Laws",
    concept: "The most powerful person in any tense situation is the one who is least reactive. Calm is the ultimate display of control — it signals you've seen worse and cannot be destabilized. Technique: label your own emotion silently first. Then breathe. Then speak slowly.",
    practice: ["When attacked: 'That's interesting — tell me more.'", "'I'm going to take a moment before I respond to that.'", "'I hear that you're frustrated. I'm not going to match that energy — but I want to understand.'", "To yourself: 'This person's anger is information, not a weapon.'", "'You may be right. Let me think about that.'"],
    reflection: "What is my biggest trigger? How can I catch it earlier, before it takes over?" },

  { day: 25, title: "One-on-One — Teaching as Seduction", book: "Art of Seduction + Carnegie + Speak to Win",
    concept: "In private teaching, your student must feel like they are your whole world at that moment. Full presence IS the product. Your adjustments, your eye contact, your undivided attention — this is what people are really paying for.",
    practice: ["'I noticed something about your [specific detail] — can I share what I see?'", "'How does that feel for you specifically?'", "'Based on what you just told me, I want to adjust my approach for you.'", "Use their name 2–3x more than you normally would — notice what changes."],
    reflection: "In my last private lesson, was I fully present — or partially thinking about something else?" },

  { day: 26, title: "Content as Compound Interest", book: "100M Leads (Hormozi)",
    concept: "Every post, video, or article you create works while you sleep. But most people create content for likes. You create content for *trust*. Formula: 80% give massive free value + 20% show what more looks like with you. Be consistent. Be specific. Be personal.",
    practice: ["'Here's a mistake I made that cost me [X years] — and how to avoid it.'", "'The one thing I tell every new student on day one.'", "'What [X years] of daily practice taught me about [unexpected life lesson].'", "'Student breakthrough this week: [their story with permission].'"],
    reflection: "If I posted one piece of content per day for 90 days, what would my world look like on day 91?" },

  { day: 27, title: "Handling Objections Like a Master", book: "Hormozi + Never Split the Difference + Influence",
    concept: "Every objection is not a rejection — it's a request for more certainty. 'Too expensive' = 'I'm not sure the value is there.' 'Let me think about it' = 'I'm not convinced yet.' Don't argue — find the real uncertainty.",
    practice: ["'That's completely fair — what would make this feel worth it to you?'", "'A lot of people feel that way before they start. Can I share what they said afterwards?'", "'If price weren't a factor, would this be something you'd want?'", "'What would need to be different about this for it to be a yes?'", "'I want to make sure this is right for you — what's your biggest concern?'"],
    reflection: "What is the most common objection I hear — and what is the real question behind it?" },

  { day: 28, title: "The Mastermind Principle", book: "Think and Grow Rich",
    concept: "The people closest to you will either amplify or diminish your growth — not through intention, but through the aggregate energy and possibility that surrounds you. Actively seek people who operate at the level you want to reach.",
    practice: ["'Who is the most persuasive / calm / successful person I know — and what exactly do they do differently?'", "'What would [mentor/hero] say in this situation?'", "'I want to learn from someone who has already solved this.'", "To someone you admire: 'I'd love to ask you three questions.'"],
    reflection: "Who in my life lifts my standards just by being around them? How much time am I giving them?" },

  { day: 29, title: "The Integrated Identity — Who Are You Now?", book: "All Books",
    concept: "You've spent 28 days learning from the greatest minds in persuasion. Today is about integration. The question is no longer 'What should I do?' The question is 'Who am I becoming?' The most influential people don't use techniques — techniques become invisible when they become character.",
    practice: ["'I am the kind of person who...' — complete this 10 times in your journal today.", "Notice: when did an influence principle appear naturally today — without you trying?"],
    reflection: "How is the person I am today different from the person who started Day 1? Be specific." },

  { day: 30, title: "Your 30-Day Manifesto", book: "Your Words",
    concept: "Today no lesson. Today you write. Use these prompts:\n\nI BELIEVE: What do I believe about people, teaching, and influence?\nI COMMIT TO: What daily practices from these 30 days do I carry forward?\nI WILL STOP: What habit or belief am I leaving behind?\nMY OFFER: In one sentence — what do I give, and who is it for?\nWHEN I AM AT MY BEST, I: Describe the version of you this program built.",
    practice: ["Today, write your manifesto. It doesn't need to be perfect. It needs to be yours."],
    reflection: "30 days ago I started this. Today I am a different person because..." }
];

// Calculate which day we're on
const today = new Date();
const start = new Date(START_DATE);
today.setHours(0,0,0,0);
start.setHours(0,0,0,0);
const dayNum = Math.floor((today - start) / (1000*60*60*24)) + 1;

if (dayNum < 1 || dayNum > 30) {
  console.log(`Program ${dayNum < 1 ? 'not started yet' : 'complete (Day ' + dayNum + ')'}. Start date: ${START_DATE.toDateString()}`);
  process.exit(0);
}

const lesson = lessons[dayNum - 1];

// Format Telegram message
const practiceList = lesson.practice.map((p, i) => `${i+1}. ${p}`).join('\n');

const message = `🌅 *Good morning, Boonchu!*

📚 *Day ${lesson.day} of 30 — Master Persuasion Program*
━━━━━━━━━━━━━━━━━━━━

*${lesson.title}*
📖 _(${lesson.book})_

${lesson.concept}

━━━━━━━━━━━━━━━━━━━━
🗣 *Practice Today:*
${practiceList}

━━━━━━━━━━━━━━━━━━━━
🌙 *Tonight, reflect:*
_${lesson.reflection}_

━━━━━━━━━━━━━━━━━━━━
_Day ${lesson.day}/30 — You are building something real._`;

// Send via Telegram
const body = JSON.stringify({
  chat_id: CHAT_ID,
  text: message,
  parse_mode: 'Markdown'
});

const options = {
  hostname: 'api.telegram.org',
  path: `/bot${BOT_TOKEN}/sendMessage`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const result = JSON.parse(data);
    if (result.ok) {
      console.log(`✅ Day ${lesson.day} lesson sent to Telegram successfully.`);
    } else {
      console.error('❌ Telegram error:', result.description);
    }
  });
});

req.on('error', (e) => console.error('Request error:', e.message));
req.write(body);
req.end();
