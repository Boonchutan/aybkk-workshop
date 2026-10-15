export const meta = {
  name: 'be-ready-quotes',
  description: 'Research, verify and chain 40 quotes on: be prepared, keep the body and mind ready, every day is new; Ashtanga is the tool',
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
  { key: 'Y', name: 'Yoga, Indian and Buddhist texts', hint: 'Yoga Sutra 2.16 heyam duhkham anagatam (the suffering not yet come can be avoided), Yoga Sutra 1.14 (practice becomes firm when done a long time, without break, with care) if not used, Bhagavad Gita 2.14 (heat and cold come and go, bear them), Gita 2.48 (evenness of mind is yoga), Anguttara Nikaya 5.77-78 (Anagatabhaya: the future dangers, make effort while young and healthy) or AN 5.80, Dhammapada on vigilance (appamada), Hatha Yoga Pradipika on steady practice. Public-domain translations (Vivekananda, Woods, Besant, Arnold, Muller, Sujato CC0).' },
  { key: 'A', name: 'Ashtanga lineage books and dated interviews', hint: 'K. Pattabhi Jois, Yoga Mala (English tr. 1999/2002): lines on daily practice, the body as the tool, practice and all is coming (find the exact book or interview wording); R. Sharath Jois, Astanga Yoga Anusthana (2013); T. Krishnamacharya, Yoga Makaranda (1934, English tr.); dated interviews in Namarupa, Yoga Journal or the Guardian. Exact wording and page or date only; label paraphrases. Check the used list carefully: some Yoga Mala lines are used.' },
  { key: 'C', name: 'Chinese, Japanese, Korean, Thai and Russian proverbs and classics', hint: 'Japanese 備えあれば憂いなし (sonae areba urei nashi), Chinese 有備無患 / Korean 유비무환 (idiom only, dictionary source, no king context), 居安思危 (idiom only), 臨渴掘井 (digging the well only when thirsty is too late), Russian "Готовь сани летом, а телегу зимой", Thai saying กันไว้ดีกว่าแก้ (prevention is better than cure), Japanese 七転び八起き (fall seven, rise eight) for resilience, Zhuangzi or Laozi on readiness and calm (Laozi 64: deal with things before they arise) if not used. Original script + literal translation + a dictionary or classic source. No rain or water images.' },
  { key: 'W', name: 'Western philosophy, literature and scripture', hint: 'Seneca Letter 18 (in times of security the spirit should prepare itself for hard times), Seneca Letter 91 or 24 (nothing should be unexpected), Marcus Aurelius Meditations 7.61 (the art of living is more like wrestling than dancing, standing ready for sudden blows), Epictetus, Proverbs 6:6-8 (the ant gathers her food in summer), Ecclesiastes 9:11 (time and chance happen to all), Aesop The Ant and the Grasshopper (check translation), Louis Pasteur 1854 lecture (chance favours only the prepared mind), Baden-Powell Scouting for Boys 1908 (Be Prepared: a state of readiness in mind and body). Check which are already used.' },
  { key: 'S', name: 'True stories: athletes, explorers, astronauts, musicians and masters who were ready', hint: 'Short true stories where daily preparation met an unexpected moment, with no accident, crash or victims: an understudy or substitute who was ready when called, an astronaut on preparing for what could go wrong (e.g. Chris Hadfield, An Astronaut\'s Guide to Life on Earth, 2013), an athlete whose daily routine paid off on a surprise day, an old master still practising daily. Named book, interview or major newspaper only. is_story=true. Already used: Hokusai, Jiro Ono, Casals, Kanakuri, Madonna Buder, Miyazaki, Colette Maze, Eileen Kramer.' },
  { key: 'B', name: 'Science of physical and mental readiness', hint: 'Named, real studies only: strength and balance training and fewer falls (e.g. Sherrington, Cochrane review 2019), grip strength and health (e.g. Leong, Lancet 2015), slow breathing and calm (e.g. Zaccaro, Frontiers in Human Neuroscience 2018), exercise and resilience to stress, yoga and balance or flexibility in adults, sleep and reaction time, habits formed by daily repetition (e.g. Lally, European Journal of Social Psychology 2010, about 66 days). Gentle, never scary. State numbers exactly as the paper says.' },
]

phase('Research')
const results = await pipeline(
  LANES,
  lane => agent(`${THEME}\n\n${RULES}\n\nYOUR LANE: ${lane.name}.\nIdeas to check (find better ones if you can): ${lane.hint}\n\nTASK: Use web search and open real pages. Find 12 strong candidates in your lane that fit the theme, spread across the 6 stages (each stage at least 1 where your lane allows). For each: exact wording, source, a URL you opened, and a faithful plain-English meaning line (10-year-old level, max 14 words, no long dash, write "asana" never "pose"). Use id prefix ${lane.key} (${lane.key}1..${lane.key}12). Be honest about doubts.`,
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
