export const meta = {
  name: 'be-ready-quotes-2',
  description: 'Second batch: 40 MORE quotes on being ready, from different source pools than batch 1',
  phases: [
    { title: 'Research', detail: '6 source lanes find candidate quotes' },
    { title: 'Verify', detail: 'adversarial fact-check per lane' },
    { title: 'Write', detail: '2 writers build 4 chains of 10 connected lines' },
    { title: 'Judge', detail: 'editor merges and checks every rule' },
    { title: 'Check', detail: '2 skeptics re-check every final line against its source' },
    { title: 'Fix', detail: 'final judge rules on every flag' },
  ],
}

const USED = '/tmp/claude-0/-home-user-aybkk-workshop/5fef75e8-f96a-51ec-a2b6-837dec39c8e1/scratchpad/used_who3.txt'

const THEME = `THEME (from Boonchu, an authorized Ashtanga yoga teacher in Bangkok, in his words): "Being prepared. Maintain your body and be ready. Every day is a new day and you don't know what will hit you. Being ready both mental and physical. The Ashtanga yoga is the tool."
So the message is: nobody knows what today will bring; you cannot get ready on the day you need it; readiness is built before, every day; keep the body strong and supple and the mind calm and steady; daily practice is how you build it; Ashtanga yoga (daily Mysore practice, breath, bandha, drishti, the same sequence every morning) is the tool that keeps you ready.
The arc has 6 stages:
 A unknown_day: every day is new, we cannot know what it will bring (change is normal, not scary)
 B prepare_before: get ready before you need it; you cannot prepare on the day itself
 C body_ready: keep the body strong, supple and balanced, so it can meet whatever comes
 D mind_ready: a calm, steady mind that does not panic when surprised
 E daily_practice: readiness is built by small daily practice and repetition, not one big effort
 F ashtanga_tool: Ashtanga yoga as the daily tool: breath, focus, the same practice each morning, practise and all is coming
Audience: yoga students in English, Thai, Chinese and Russian. Posts are Instagram carousels for Ashtanga Yoga Bangkok. Keep it warm, confident and hopeful, never fear-based or scary.`

const RULES = `HARD RULES
- Never invent a quote, a source, a date or a number. Every item needs a real, checkable source: book + chapter/verse + translator + year for texts, or the original-language proverb + a literal translation + a dictionary/classic source, or a named interview/book/record for modern people, or a named peer-reviewed study (journal, year, first author) for science. Give a URL you actually opened.
- Flag misattributions. Many 'be prepared' lines are fake: 'By failing to prepare you are preparing to fail' (not Franklin), 'Luck is what happens when preparation meets opportunity' (not Seneca), 'Give me six hours to chop down a tree' (not Lincoln), 'Failure is not an option' (a film line). Do not use a fake attribution. A saying with unknown author is fine only if labeled as a saying.
- Content safety: no politics, elections, war, battles, armies or military strategy (so no Sun Tzu, no generals, no battle quotes), government leaders, royalty or any monarchy (also when the source's context is a king or ruler, only use the idiom itself with a dictionary source and never mention the king), religious conflict, disasters, accidents or crashes, deaths with victims, crime, illness scares. Never mock a god, a sage or a religion. No flood, storm, tide, rain or rising-water images (Thailand has deadly floods right now). Never fear-based: readiness is about confidence, not danger.
- Ashtanga lineage quotes (K. Pattabhi Jois, R. Sharath Jois, T. Krishnamacharya) must come from their own books (Yoga Mala, Astanga Yoga Anusthana, Yoga Makaranda) or a named, dated interview you opened. Many internet 'Guruji said' lines are paraphrases: label them or drop them. Never claim anything about Boonchu's authorization.
- Ages and records must be from a reliable source (e.g. Guinness, a major newspaper). Prefer public-domain translations. Keep each quote short.
- The file ${USED} lists sources ALREADY USED in past AYBKK carousels. Read it first. Do not return the same passage again. A different passage from a used book is OK if clearly different.`

const STAGES = ['unknown_day', 'prepare_before', 'body_ready', 'mind_ready', 'daily_practice', 'ashtanga_tool']
const ITEM = {
  type: 'object',
  properties: {
    id: { type: 'string' }, quote: { type: 'string' }, original: { type: 'string' }, who: { type: 'string' },
    source: { type: 'string' }, url: { type: 'string' }, stage: { type: 'string', enum: STAGES },
    meaning: { type: 'string', description: 'one plain-English line a 10-year-old understands, max 14 words, faithful' },
    is_story: { type: 'boolean' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, note: { type: 'string' },
  },
  required: ['id', 'quote', 'original', 'who', 'source', 'url', 'stage', 'meaning', 'is_story', 'confidence', 'note'],
}
const ITEM_SCHEMA = { type: 'object', properties: { items: { type: 'array', items: ITEM } }, required: ['items'] }
const VERDICT_SCHEMA = { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: {
  id: { type: 'string' }, verdict: { type: 'string', enum: ['verified', 'fixed', 'reject'] }, quote: { type: 'string' }, original: { type: 'string' },
  who: { type: 'string' }, source: { type: 'string' }, url: { type: 'string' }, stage: { type: 'string' }, meaning: { type: 'string' },
  is_story: { type: 'boolean' }, credit: { type: 'string', description: 'short slide credit, max 45 characters, e.g. "Seneca · Letters to Lucilius 18"' }, reason: { type: 'string' },
}, required: ['id', 'verdict', 'quote', 'original', 'who', 'source', 'url', 'stage', 'meaning', 'is_story', 'credit', 'reason'] } } }, required: ['items'] }

const LANES = [
  { key: 'I', name: 'Other Indian texts: Upanishads, Tirukkural, Ayurveda daily routine, Gheranda Samhita, Jataka tales', hint: 'Katha Upanishad 1.3.14 (arise, awake, the path is sharp as a razor) if not used, Ashtanga Hridayam Sutrasthana ch. 2 dinacharya (daily routine: rise early, exercise to half strength), Charaka on daily regimen (not 1.15, used), Tirukkural couplets on foresight (e.g. ch. 44 or 54, guarding against faults before they come), Gheranda Samhita on the body as a pot to be fired, Jataka tales of preparation. DO NOT use: Yoga Sutra 2.16, YS 1.14, Gita 2.14 or 2.48, AN 5.77-78, Dhammapada appamada (batch 1 has these). Public-domain translations.' },
  { key: 'L', name: 'Modern yoga teachers in their own books', hint: 'B.K.S. Iyengar, Light on Life (2005) or Light on Yoga (1966): exact lines on the body as a tool or daily practice; T.K.V. Desikachar, The Heart of Yoga (1995); Swami Kuvalayananda; Indra Devi. Exact page or chapter. DO NOT use Pattabhi Jois, Sharath Jois or Krishnamacharya (batch 1 has the Ashtanga lineage). Label paraphrases; drop internet-only quotes.' },
  { key: 'J', name: 'Chinese medicine classics, Daoist and Japanese budo and Zen sources, Thai and Russian sayings', hint: 'Huangdi Neijing Suwen ch. 2 (the sage treats illness before it arises: 不治已病治未病, with the image of digging a well when thirsty), Zhuangzi ch. 3 Cook Ding (skill and steady readiness), Jigoro Kano on judo and daily training (his writings), Shunryu Suzuki Zen Mind Beginner\'s Mind (1970) on readiness, Ajahn Chah or Buddhadasa (Thai monks, dated books) on a ready, calm mind, Russian proverbs on readiness (not the sled one), Japanese 石の上にも三年. DO NOT use 備えあれば憂いなし, 有備無患, 居安思危, 臨渴掘井, the sled proverb, กันไว้ดีกว่าแก้ or 七転び八起き (batch 1). No war, no rain or water images.' },
  { key: 'E', name: 'Western: more Stoics, essayists, psychologists and coaches', hint: 'Epictetus Discourses on training and being ready (e.g. 1.2, 3.12, 3.24), Seneca letters other than 18, 24 and 91, Montaigne, William James Principles of Psychology 1890 ch. 4 Habit (make the nervous system an ally), Aristotle Nicomachean Ethics II.1 (we become just by doing just acts; flag that "we are what we repeatedly do" is Will Durant, not Aristotle), John Wooden (check "when opportunity comes it is too late to prepare" source), Thoreau, Emerson. DO NOT use Marcus Aurelius 7.61, Proverbs 6:6-8, Ecclesiastes 9:11, Aesop, Pasteur 1854 or Baden-Powell (batch 1).' },
  { key: 'T', name: 'True stories of daily practice: dancers, musicians, climbers, runners, craftspeople', hint: 'A ballet dancer\'s daily class at an old age, a pianist or violinist on daily scales (check the famous "one day, two days, three days" practice saying: it is attributed to several people, so label it carefully), a climber or runner whose daily routine paid off, a craftsperson with the same morning ritual for decades. Named book, interview or major newspaper only. No accidents, crashes or victims. is_story=true. Already used: Hokusai, Jiro Ono, Casals, Kanakuri, Madonna Buder, Miyazaki, Colette Maze, Eileen Kramer; batch 1 covers astronauts and understudies, so avoid those.' },
  { key: 'R', name: 'Science of a ready body and mind (different studies from batch 1)', hint: 'Named, real studies only: exercise and mental health (e.g. Chekroud, Lancet Psychiatry 2018), mindfulness and stress (named RCT), flexibility or mobility and daily function in older adults, bone strength and loading exercise, aerobic fitness and stress reactivity, morning routine or consistency and wellbeing, interoception and yoga. DO NOT use falls (Sherrington), grip strength (Leong), slow breathing (Zaccaro) or habit formation (Lally) studies (batch 1). Gentle, never scary. State numbers exactly.' },
]

phase('Research')
const results = await pipeline(
  LANES,
  lane => agent(`${THEME}\n\n${RULES}\n\nYOUR LANE: ${lane.name}.\nIdeas to check (find better ones if you can): ${lane.hint}\n\nTASK: Use web search and open real pages. Find 12 strong candidates in your lane (this is batch 2: Boonchu asked for 40 MORE quotes, so stay inside your lane's sources and avoid the batch 1 items named in the hint) that fit the theme, spread across the 6 stages (each stage at least 1 where your lane allows). For each: exact wording, source, a URL you opened, and a faithful plain-English meaning line (10-year-old level, max 14 words, no long dash, write "asana" never "pose"). Use id prefix ${lane.key} (${lane.key}1..${lane.key}12). Be honest about doubts.`,
    { label: `research:${lane.key}`, phase: 'Research', schema: ITEM_SCHEMA }),
  (found, lane) => agent(`${THEME}\n\n${RULES}\n\nYou are a strict fact-checker. Try to REFUTE each item. Search the exact wording and source; check translator, year, chapter; check misattribution; check numbers against the original paper or record; check content safety (war, royalty, accidents, rain or water images, fear); check the meaning line is faithful and simple (max 14 words, no long dash). Verdict 'verified', 'fixed' (give the corrected version) or 'reject' (fake, unverifiable, unsafe, already used per ${USED}). When unsure, reject. Also write a short slide credit (max 45 characters, 'Name · Work' style).\n\nITEMS (lane: ${lane.name}):\n${JSON.stringify(found ? found.items : [], null, 1)}`,
    { label: `verify:${lane.key}`, phase: 'Verify', schema: VERDICT_SCHEMA }),
)

const verified = results.filter(Boolean).flatMap(r => r.items).filter(i => i.verdict !== 'reject')
log(`${verified.length} items survived verification`)

const CHAIN_SCHEMA = { type: 'object', properties: {
  chains: { type: 'array', items: { type: 'object', properties: {
    title: { type: 'string' },
    lines: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' }, id: { type: 'string' }, line: { type: 'string' } }, required: ['n', 'id', 'line'] } },
  }, required: ['title', 'lines'] } },
  why: { type: 'string' },
}, required: ['chains', 'why'] }

const BRIEF = `${THEME}

FORMAT (same as Boonchu's last sets): 4 Instagram carousels, 10 slides each, 40 different quotes. Each slide shows ONLY one interpretation line (big text) plus a tiny credit, never the original quote. The 10 lines of one carousel connect like one short story: slide 1 is a hook that stops the scroll (hard truth, surprise or question), each line pulls the reader to the next, slide 10 lands it and makes them want to practise tomorrow morning. Each carousel walks the arc unknown_day -> prepare_before -> body_ready -> mind_ready -> daily_practice -> ashtanga_tool in its own way, with its own central image (e.g. a packed bag by the door, a sharpened tool, a morning alarm, a well dug before you are thirsty). Every carousel ends with Ashtanga as the daily tool.

LINE RULES: faithful to its quote (never twist it); plain English for a 10-year-old learner; max 14 words; no long dash (use commas, periods or colons); no hype; write "asana" never "pose"; confident, never fear-based; no war, accident, flood, storm, rain or water images; science lines say "linked to" or "went with", never "causes"; each id once only across all 4 carousels; mix cultures and lanes in each carousel (yoga text, Ashtanga lineage, Asian proverb, Western, true story, science). Avoid two lines from the same author in one carousel.

VERIFIED ITEMS:
${JSON.stringify(verified.map(i => ({ id: i.id, quote: i.quote, who: i.who, stage: i.stage, meaning: i.meaning, is_story: i.is_story })), null, 1)}`

phase('Write')
const drafts = await parallel([
  () => agent(`${BRIEF}\n\nYOUR ANGLE: storyteller. Like a bedtime story for a 10-year-old: First... Then... But... So...`, { label: 'write:story', phase: 'Write', schema: CHAIN_SCHEMA }),
  () => agent(`${BRIEF}\n\nYOUR ANGLE: hook writer. Each slide opens a small loop that the next slide closes. Short punchy coach lines.`, { label: 'write:hook', phase: 'Write', schema: CHAIN_SCHEMA }),
])

phase('Judge')
const final = await agent(`${BRIEF}\n\nYou are the final editor. Two writers made drafts (below). Pick and graft the strongest carousels and lines into the FINAL 4 carousels x 10 lines (40 different ids). Read each as a stranger scrolling: would slide 1 stop you, would you swipe to 10? Check every line against its quote (faithful, max 14 words counted carefully, no long dash, plain words). Fix what fails; swap in a better verified item when a line twists its quote.\n\nDRAFT A:\n${JSON.stringify(drafts[0])}\n\nDRAFT B:\n${JSON.stringify(drafts[1])}`,
  { label: 'judge:final', phase: 'Judge', schema: { type: 'object', properties: { chains: CHAIN_SCHEMA.properties.chains, checks: { type: 'string' } }, required: ['chains', 'checks'] } })

const byId = Object.fromEntries(verified.map(i => [i.id, i]))
const rows = (final && final.chains ? final.chains : []).flatMap((c, ci) => c.lines.map(l => ({ post: 'ABCD'[ci], slide: l.n, id: l.id, line: l.line, credit: byId[l.id] ? byId[l.id].credit : null, who: byId[l.id] ? byId[l.id].who : null, quote: byId[l.id] ? byId[l.id].quote : null, source: byId[l.id] ? byId[l.id].source : null, url: byId[l.id] ? byId[l.id].url : null })))

const FLAG_SCHEMA = { type: 'object', properties: { lines: { type: 'array', items: { type: 'object', properties: {
  id: { type: 'string' }, verdict: { type: 'string', enum: ['ok', 'fix'] }, problem: { type: 'string' }, new_line: { type: 'string' }, new_credit: { type: 'string' },
}, required: ['id', 'verdict', 'problem'] } } }, required: ['lines'] }
const CHECK_RULES = `Rules: each line is shown alone on a slide with its small credit. It must stay faithful to its source: no added claims, no new numbers, no stronger claim than the source (science says "linked to", "went with" or "predicted"). Numbers, ages and years must match exactly. Max 14 words, plain English for a 10-year-old, no idioms a learner cannot follow, no long dash, "asana" never "pose". The credit must name the right person and work. Content safety: no war, royalty, government leaders, accidents, disasters, victims, rain or water images, fear. Slide 10 of each carousel lands on Ashtanga or daily practice.`

phase('Check')
const halves = [rows.filter(r => r.post === 'A' || r.post === 'B'), rows.filter(r => r.post === 'C' || r.post === 'D')]
const checks = await parallel(halves.map((h, i) => () => agent(`You are a skeptical fact-checker for Instagram carousels. Try hard to REFUTE each of these 20 final lines: compare word by word with its quote, open the url or search the web to confirm numbers, ages, translations and attributions. ${CHECK_RULES}\nReturn "fix" only for a real problem (wrong fact, overclaim, unclear English, safety risk, wrong credit), with a corrected new_line (max 14 words) and/or new_credit. Do not flag matters of taste.\n\nLINES:\n${JSON.stringify(h, null, 1)}`,
  { label: `check:${i ? 'CD' : 'AB'}`, phase: 'Check', schema: FLAG_SCHEMA })))
const flags = checks.filter(Boolean).flatMap(c => c.lines.filter(l => l.verdict === 'fix'))
log(`${flags.length} lines flagged`)

let judged = []
if (flags.length) {
  phase('Fix')
  const j = await agent(`You are the final judge. Fact-checkers flagged these carousel lines:\n${JSON.stringify(flags, null, 1)}\n\nFull data for each line (match by id):\n${JSON.stringify(rows.filter(r => flags.some(f => f.id === r.id)), null, 1)}\n\nFor each flag decide independently if the problem is REAL or NOT (taste, nitpick, misread). Open the url or search when a fact is disputed. ${CHECK_RULES}\nFor real problems give the best final line (max 14 words, faithful, plain) and credit.`,
    { label: 'fix:judge', phase: 'Fix', schema: { type: 'object', properties: { judged: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, real: { type: 'boolean' }, why: { type: 'string' }, final_line: { type: 'string' }, final_credit: { type: 'string' },
    }, required: ['id', 'real', 'why'] } } }, required: ['judged'] } })
  judged = j ? j.judged : []
}

return { final, rows, flags, judged, verified, rejected: results.filter(Boolean).flatMap(r => r.items).filter(i => i.verdict === 'reject').map(i => ({ id: i.id, who: i.who, reason: i.reason })) }
