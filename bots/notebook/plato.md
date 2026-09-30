# Plato notebook

## Standing orders from Boonchu
- CHINESE PLATFORMS (30 Sep): Ep. 1 and Ep. 2 were never posted in Chinese. Boonchu starts the Chinese series (WeChat / Xiaohongshu) from Ep. 3 onward, keeping the same numbers as Instagram (第3集); Chinese Ep. 1 and 2 may come later.
- CHINESE VERSION of Reels (30 Sep): same edit, Chinese burned-in captions (Noto Sans SC variable, Weight Shift) and Chinese card text; emoji BIGGER than the English cut (about 150 px vs 118 px). Translate with checks (terms: 阿斯汤加, 迈索尔; Guruji is Sharath's maternal grandfather = 外公). Scripts: bots/tools/reel-edit/ep3/caps_zh.py, make_cards_zh.py.
- NO SIDE BARS on carousels (30 Sep): never pad photos with blurred side bars. Get 4:5 by cutting top and/or bottom only (feet before heads). If the bottom cut hides the watermark, paste the real watermark back (bots/tools/carousel/crop3.py lifts it from a clean photo).
- PICTURES OVER HIS HEAD (30 Sep, final): NO blur edge and NO stroke. Show the WHOLE picture, never crop important parts: fit inside 1000x560, rounded corners, soft shadow, pop in. Portrait photos: smaller (about 520 tall) and a bit to the side (right). May cover the top of his hair. (He tried soft edges first; they cut important parts.)
- EP. 3 EDIT (30 Sep): speed his take 1.3x, cut all pauses EXCEPT the silence after 'In November that year, he passed away' (keep about 2 s). Everything else = house edit style.
- POSTIZ LIMIT (30 Sep): Postiz allows max 10 photos per Instagram carousel (the app allows 20, Postiz does not). Plan carousels as 10 slides or fewer.
- NEVER CUT A STUDENT'S HEAD (30 Sep): when cropping a photo, never cut any head (main student, teacher or people in the back). Cut the feet instead, or fit the whole photo and fill the sides with a blurred copy. Keep the watermark at the bottom. Check every crop by eye before sending.
- CAROUSEL TEXT (30 Sep): the meaning line in white must be bold and easy to read (Montserrat bold 33 on 1080 wide). Text never on faces or the main asana, check each slide by eye.
- 2026-09-28: VIDEO EDIT SPEC (for whoever edits; editing happens in the "Editing by Claude" session with HyperFrames, not in Plato's run). With every Reel, Plato writes an edit cue sheet:
  - Zoom cut: punch in close on his face for 1 to 2 seconds on each stress word.
  - Sound effect on each stress word at 40% volume, starting 0.4 s AFTER he finishes saying that word.
  - Captions: Weight Shift style (thin to bold), with emoji on key words.
  - Images to go with his words, made with Cloudflare image generation. Plato writes the prompts. Nothing billed without Boonchu's OK.
  - Video file goes to his Google Drive, never the GitHub repo (it is public).
- 2026-09-28: Never say "pose". Always say "asana". In scripts AND captions (Thai อาสนะ, Chinese 体式, Russian асана).
- 2026-09-28: The myth stories are his bedtime stories to his 5 year old son. Write the story part as a bedtime story: soft, simple, told to a child, then turn to the adults for the asana. Never invent what the son said or did.
- 2026-09-28: TOOLKIT PITCH. Every Reel, pick the structure from the Reel Toolkit below (one hook tool + one body tool, humour optional). At the top of the Reel, write "Toolkit pick: <tool> + <tool>. Why: <1 to 2 plain lines on why it fits THIS story>." Rotate. Do not use the same pick 3 days in a row. Boonchu wants the pitch every time.

- 2026-09-28: SERIES NAME. The myth Reels are the series "Hidden Stories of Ashtanga" (Chinese: 阿斯汤加的隐藏故事). Put the series name and episode number on screen and in every caption. Ep. 1 = The King Who Said No (dristi, Dhritarashtra). Next Reel is Ep. 2, count up.
- 2026-09-28: Other running series on the AYBKK Instagram (seen in Postiz, from 23 Sep): daily quote post = one sage quote (Chinese, Pali, Japanese or Western, original + English) + one dry line + "Come learn yoga at aybkk.com". Themes so far: "10 signs of intelligence", "enough / few desires". Do not repeat quotes already used: Xunzi slow horse, Pascal quiet room, Confucius title, Everett to Lincoln, Confucius hard part first, Laozi enough, Mencius few desires, Ryokan moon, Buddha last words.

- 2026-09-28: BEDTIME-STORY ENGLISH. Most viewers are not native English speakers, and neither is Boonchu. Write every spoken line like a bedtime story for a 5-year-old: one idea per line, short common words, no "the former/latter", no clever grammar. Explain every name the first time (e.g. "Pandu, his brother"). If a line needs reading twice, rewrite it.

- 2026-09-28: WORD RULE. Never say or write "pose" for Ashtanga practice. Always "asana" (plural "asanas"). Applies to scripts, on-screen text, captions and hooks.

- 2026-09-28: COLOR RULE (triad, colors about 120 degrees apart on the color wheel, from a public Reel). AYBKK triad: Plum #5C2160 (base, the brand color already on aybkk sites), Gold #E0B52B (accent: the ONE key word per frame), Teal #1F9E96 (second accent: series label, episode number). Text: white on plum or teal, near-black #1A161D on gold. Max 3 colors per frame. Series card: plum background, gold "Hidden Stories of Ashtanga", teal "Ep. N". Cover: face + max 5 words, one word in gold. Check every cover in black and white: if the words vanish, the light/dark contrast is too weak. Gold is an accent only: no all-yellow frames or yellow shirts (in Thailand yellow links to royalty and politics).

- 2026-09-28: SERIES UNIFORM (proposed to Boonchu, waiting for his yes and which shirt he owns). Same shirt color every Hidden Stories episode, ideally a plum AYBKK tee. Cover: plum shirt on a light background (off-white or soft shala wall), one gold word, teal "Ep. N". Never match the cover to a new shirt each time.

- 2026-09-29: TOOLKIT CHOICE (Boonchu, sharpens the Toolkit pitch). When 2 or more tools could work for a story, do not just pick one: give Boonchu 2 to 3 options at the top, each as "Tool combo: a 2 to 3 line sample hook + one line on how the body runs + why it gets the result", mark one as "Plato's pick", and wait for his choice before writing the full script. In the 06:43 daily run (no chat), write the full script with Plato's pick and list the other 1 to 2 options under it in one line each, so he can ask for a rewrite.

- 2026-09-30: BRAND = WELCOMING (Boonchu). AYBKK is "serious practice, open door". Keep the lineage and discipline, change the door: every piece of content must make a beginner feel invited. Never write "hardcore", "strict", "advanced only", "for serious practitioners only". Say "beginners welcome, we teach you from zero". Rules are framed as care ("so everyone can focus"), not as bans. Show beginners and real progress, smiling teachers, first-day stories. Tagline under test: "Traditional Ashtanga. Open door."

## Jobs from Machi
- 2026-09-30 CAMPAIGN "Sharathji's 44 days" (29 Sep to 12 Nov 2026), approved by Boonchu. New students: buy 1 month, get 1 month free. Current/recent students on FLEXIBLE packages only: 1 month +1 week, 3 months +3 weeks, 6 months +6 weeks, 12 months +2 months. Dedicated Student packages (commit 16 classes a month) keep their own price, no bonus. One offer per purchase. Wording: "from his birthday to the day we lost him" (never "passing date" as a sales hook; tribute tone, no hype). Lead magnet: free guide "Your First Mysore Class at AYBKK" (EN + TH PDFs in bots/media/campaign-sharathji-44/), delivered by ManyChat when people comment MYSORE. JOB: 1) a Reel for Fri 2 Oct: Boonchu to camera, why Mysore scares beginners + "comment MYSORE and I'll send you my first-class guide"; offer lives in the caption, not spoken. 2) a 3-slide carousel of the offer (plum/gold/teal). 3) captions EN + TH. Draft in Postiz only after Boonchu approves; Postiz AYBKK channel must be reconnected first.

- DONE by Machi 29 Sep on branch claude/aybkk-net-shopwindow (hero uses this photo); skip unless Boonchu asks for changes. Was: WEBSITE HEADER (from Boonchu): use the photo of Boonchu, Jamsai and Sharathji in front of the shala wall as the background of the website header. Photo: bots/media/header/boonchu-jamsai-sharathji-wall.jpg (2576x1718). The site is public/bkk.html, served at my.aybkk.com (aybkk.net has no DNS record yet; Machi is checking launch readiness). Plato's rules forbid writing to main, so: make the header crops (desktop wide + phone tall; keep all three faces and the wall art; leave calm space for the AYBKK title), save them in bots/media/header/, write the exact code change as a patch file bots/media/header/bkk-header.patch, show Boonchu the mock-up, and ask him before anything touches the live site.

- 2026-09-29: STORY PATTERN. Every Reel runs FAIL, then HERO, then PAYOFF, inside the Toolkit pick. Fail = someone gets it wrong (the myth's mistake). Hero = who gets it right (if the myth has no hero, the hero is the practitioner on the mat, or Boonchu with a REAL story of his own). Payoff = the last line closes the loop the hook opened. Also: Boonchu's teaching cues on asanas beat Plato's; use his words, light edits only.
- 2026-09-29: Plato broke the Toolkit (hook was Question-First, not Triple Hook, no bedtime frame). Before sending any script, check it line by line against the Toolkit pick and the standing orders.

- 2026-09-29: His Vault note "05 Business & Strategy/Boonchu Framework/Vibe Samurai - Storytelling Structure" (Drive file 1jz1Q0-b6sSe1CFBzIHYfPj-biRs1_0gN) is the reference for Vibe Samurai. Key: hook = one flat statement, never a question; credit the source; ladder of 3 moving toward the viewer (beginner, 10-year practitioner, you); silent beat; turn "It isn't X. It's Y."; one screenshot line; closing inversion; pitch only in the caption.

- 2026-09-29: WORD RULE 2. Do not use "stress" (non-native viewers do not get it). "Power" also failed. For the chant say "high" (the voice goes high on the start or the end: true to the Vedic accent); for the body say "lift from". Bridge = "wrong place". Same test for any word: if a 10-year-old non-native speaker would stop on it, swap it.
- 2026-09-29: REVEAL AT THE END. Do not teach the fix early. Beginning and middle must make the viewer feel they cannot do it (the fail gets worse when they try harder). The answer comes late, short, after a silent beat.

- 2026-09-29: CAPTIONS. Every caption line gets an emoji (1 to 3). Emoji BIG: about 2x the text height (150 px emoji on 72 px text at 1080x1920), popping in above the line. Weight Shift = words start thin and turn bold when spoken; key word gold. Also: story images for every myth character he names, and motion everywhere (zoom punches on his face at key words, slow zoom on images).

- 2026-09-29: HOUSE EDIT STYLE = the Ep. 1 look (made in HyperFrames by the "Editing by Claude" session). Plato forgot it once; never again:
  - Header: dark rounded pill (rgba 22,30,48,0.8), white Montserrat SemiBold ~38 px: "Hidden Stories of Ashtanga · Ep. N", top center, whole video.
  - Cards: rounded 586x346 card with a thin white border and soft shadow, centered under the header, above his head (shift his video down ~110 px so the card does not cover his face). Cards pop in (scale 0.82 to 1, ease-out-back) and fade out.
  - Two card kinds: (1) story pictures, slow zoom inside the card; (2) graphic "SVG" cards: navy gradient, big emoji/icon, gold Montserrat ExtraBold title, cream subtitle; lists reveal item by item with ❌/✅ as he says them.
  - Captions: Montserrat, lowercase, 2 balanced lines, white, soft shadow; word turns bold when spoken (Weight Shift), emoji inline at the end, emoji about 1.4x text height (bigger than Ep. 1).
  - WEIGHT SHIFT (HyperFrames, his pick): 2 lines, lowercase Montserrat; the LINE he is saying is bold (800), the other line thin (300); shift over about 0.14 s. Big emoji (about 125 px on 70 px text) to the right of the block, popping in. (caps3.py)
  - CUT ZOOM: 1.3x hard cut on his face for each important word (about 1 s), with a sound effect at 40%, 0.4 s after the word. Sounds: the HyperFrames set (pop, whoosh, sparkle, chime, ping, impact-bass-1/2, error, click-soft) from his "Story Edit Sheet" artifact https://claude.ai/artifact/1wze1oWWGujYe4XYVxkngg (files sfx/*.mp3), plus synth thunder for rain/thunderbolt. (build_audio2.py, fc5.txt)
  - No full-screen cutaways.
  - Scripts saved in bots/tools/reel-edit/ (common.py, cards.py, caps2.py, build_audio.py, fc4.txt).
- 2026-09-29: STORY PICTURES. Boonchu may make his own pictures (Isle of Dogs stop-motion style, he likes it: "fun"). Use his first. Fill gaps with Cloudflare flux in the same style ("stop-motion claymation, Wes Anderson Isle of Dogs style, handmade miniature set").

- 2026-09-29: REEL CAPTION FORMAT. 4 short lines (hook line, series + Ep. N, the asana point, the payoff), then "Come learn Ashtanga" / "Aybkk.com", then hashtags: #aybkk #ashtanga #ashtangabangkok #hiddenstoriesofashtanga #<asana> #boonchutanti

- 2026-09-30: Boonchu confirmed: Hanumanasana and Astavakrasana are both in the Ashtanga Advanced A series.

- 2026-09-30: SHARATH FACTS from Boonchu (his own account, say "as I saw it" / label as Boonchu's account, not as a published fact):
  - Got serious about the series around age 17 to 19, still in school (not university). Boonchu is not sure of the exact age.
  - Known as the one Guruji taught to his deepest knowledge (use this wording, not "all six series" unless a source confirms).
  - Mysore: about 300 to 450 students each morning per month in season (season Oct to Mar, last season Nov to Feb); some years a monsoon season Jun to Aug with 200 to 300 per month.
  - Tours: at least 300 students per venue. Boonchu hosted him in Bangkok: 500 students in 2018, 450 in May 2024 (his last Bangkok visit). He passed away 12 Nov 2024 (India date). Tribute scripts must say he has passed; use past tense. Last Shanghai workshop 1,200+ students.
  - Do NOT say "millions of followers" unless a source shows it.
  - CHECKED 30 Sep (sources: his book Ageless 2018 via Global Indian Dec 2024; NYT obit Nov 2024; sharathyogacentre.com; old KPJAYI bio): "As a child, I was always ill." Rheumatic fever (age 11 per Ageless/NYT; ages differ, say "as a boy"), no bicycle, cricket dream ended. Ran out the back door to play cricket, Guruji came searching. Serious at 19 ("I would keep putting it off until one day, I decided to go"). Assisted Guruji from 19, almost 20 years (about 17 to 19). Took over the shala in 2007 while Guruji was alive but too weak to teach; Guruji died 18 May 2009. KPJAYI bio: "only student who has studied and continues to practice the complete six series" (attribute to the institute). Instagram about 230,000 (not millions). Students from 70+ countries. First trip abroad Sydney Dec 1996 after 3 visa refusals. NO quote about "not ready": say it as Boonchu's feeling. Student-transcript story (2013): back pain, "I can't do today", Guruji: "just do it, just breathe".
  - MYTH MATCH: Ashtavakra (Mahabharata Vana Parva 132 to 134) is the daughter's son of his teacher Uddalaka (= Aruni, the devoted student who lay in the water channel, Adi Parva 3), raised on his grandfather's lap, like Sharath (daughter's son of Guruji). Born bent in 8 places, at 12 went to King Janaka's court, "too young" at the gate, won, body made straight in the Samanga river. Asana: Astavakrasana (Advanced A).

## Reel Toolkit
Hook tools (seconds 0 to 3):
- Triple Hook (from a public Reel, saved 2026-09-28): 1) Context: line one says exactly what the video is about. 2) Pull: make them care, pick one: Taboo (feels risky to say), Dark (expose something happening to them they did not know), Contradiction (opposite of what they believe), Proof (fact or number, show it on screen if possible). 3) Whiplash: say the opposite of what they expect. Context sets the trap, Pull loads it, Whiplash snaps it. Best for: myth-busting a common practice belief, technique topics.
- /hook (.claude/commands/hook.md): 5 hooks, one per lever (authority, contrarian, stakes, question, pattern interrupt). Best for: when the story is strong and only the opening needs testing.
Body tools:
- /story (.claude/commands/story.md): 4 beats Hook, Context, Ordeal, Takeaway. Best for: one personal ordeal, one lesson.
- Vibe Samurai (skill anthropic-skills:vibe-samurai-story): flat statement, credit the source, ladder of 3 examples, the turn (it isn't X, it's Y), one screenshot line, closing flip. Pitch stays in the caption. Best for: myth or history ideas with 3 parallel examples.
- Hero's Journey (Joseph Campbell, The Hero with a Thousand Faces, 1949; the frame George Lucas used for Star Wars). Short Reel version, 5 steps: ordinary life, the call, the test, the dark moment, return with a gift. Campbell leaned on Hindu myth (worked with Indologist Heinrich Zimmer), so it fits Hidden Stories. Best for: a student's or Boonchu's own practice journey, or any myth with a clear hero. Fact note: Campbell did NOT write a dissertation on Finnegans Wake (he never finished a PhD); he co-wrote A Skeleton Key to Finnegans Wake (1944) and took the word "monomyth" from Joyce.
Humour layer (optional):
- Gervais deadpan (skill anthropic-skills:gervais-deadpan): flat delivery, punch up at trends, buzzwords, gurus or Boonchu himself, never a student, the lineage, Sharath or the practice, then one true line. Best for: yoga trends, self-mockery.
Obsidian frameworks (Boonchu's vault, 05 Business & Strategy/Boonchu Framework). Name | shape | best for | note:
- Five-Lever Hook | one lever only: authority, contrarian, stakes, question, interrupt | technique, breath | Content Analysis/Hook Library
- Interrupt Opener | visual, audio (black screen + ujjayi), narrative (start mid-action), conceptual (odd pairing) | footage-only caption Reels | Content Analysis/Pattern Interruption
- 3-Second Audit | sound off, top line under 12 words | CHECK EVERY REEL | Psychology - Attention
- Curiosity Amplifiers | specific, say what it is NOT, conflict, insider group, contrast line | discipline, routine | Persuasion/Copy writing
- Root and Wobble | word-root reveal, or name the awkward middle stage as a stage | philosophy, plateaus | Storytelling - Structure Patterns
- Name-the-Feeling | name the exact feeling, one true 2-sentence student story, new reading | emotion, motivation | Storytelling - Story and Emotion
- Fork-First Story | open at the decision ("6 AM, bad knee, wants to jump back. Do you let him?"), pause, answer | teaching decisions, behind the scenes | Persuasion/Harvard and Selling Tricks
- PST | Problem, Story, Transformation | 30s student stories | Plato Communication Cheat Sheet
- Question-First | question on screen, let them guess, answer | anatomy, technique tips | Psychology - Memory
- One Dissenting Voice | "Most teachers say X. I say Y." | contrarian positioning | Psychology - Identity and Tribes
- Win/Loss Frame | write the line as gain and as loss, exact numbers | longevity, consistency | Psychology - How Choices Get Made
- Honest Flaw | fall out of a balance, name a pose you lost | trust | Persuasion - See Through The Trick
- Reframe Unit | put the benefit in a unit people know | why-we-do-less | Rory Sutherland
- Two-Voice Deadpan | buzzword in its voice, pause, flat truth in 10 words | myth-busting openers | Humour - Sarcasm
- Bracket or Ranking | rank 8 to 16 techniques, ask which helped you, reveal later | engagement series | Anthony Vicino notes
- Quote-Matched Struggle | one philosopher quote for one student type | philosophy | Philosophers for Ashtanga
- Myth-Kill | myth, "No", verified fact | science | LBH Flexibility Science
- Useful Over Diary | one transferable principle, never "my morning" | daily topic filter | AYBKK Growth OS
Guardrails: never use the "back injury" story from Boonchu Persuasion Framework (flagged as invented). Before any science claim: how big, tested on whom, predicted or found after, repeated? (Psychology - Reading The Evidence)

## Life notes
- 2026-09-28: Tells these Indian myth stories to his 5 year old son at bedtime. (Standing frame for the series, not a one-time trigger.)
- 2026-09-28: At 53, cannot read anything close in low light. Buys reading glasses at the eye shop. [USED 2026-09-28, dristi Reel]
- 2026-09-27: Three days of rain in Bangkok, stuck at home, and so is half the city. [USED: Vritra part 1 (27 Sep) and part 2 (28 Sep)]

## Stories used
- 2026-09-30 | CAROUSELS 'From weak to strong' from the 30 Sep Mysore class photos | Part 1 (10) posted now 30 Sep ~19:23 BKK, Postiz cmuo2sc3801arp70yvd3vws5o; Part 2 (10) scheduled 1 Oct 06:00 BKK, cmuo6qkhw01tnp70y8h6dw0u3 (re-made without side bars; old cmuo2sexr01asp70ysyqnrvbp deleted by Boonchu) | 5 philosopher + 5 history quotes each, all checked against sources (Booker T. Washington checked in Up from Slavery on Gutenberg) | Part 3: Boonchu wants it posted 1 Oct with NEW photos from that day's class (reminder set for 11:00 BKK); 4 quotes ready (Edison, Epictetus, Gibran, Hawking) in bots/media/2026-09-30-weak-to-strong/postC.json | Style: Caveat quote, Montserrat bold meaning, gold attribution, scrim; crop never cuts heads (pad with blur). Scripts saved in bots/tools/carousel (crop2.py, render.py, build.py).
- 2026-09-30 | Hidden Stories of Ashtanga Ep. 4 | Trigger: Asian Games Aichi-Nagoya, 29 Sep 2026, India women's 4x400m relay gold 3:29.69 (Bahrain 3:30.21, China 3:31.02); anchor Vithya Ramraj passed China at the bend, held off Bahrain, quote "My teammates gave the distance" (theprint.in) | Story: Vasishtha recites Rama's line at the wedding: Brahma, Marichi, Kashyapa, the Sun, Manu, Ikshvaku... Rama (Valmiki Ramayana, Bala Kanda 70) | Asana: Marichyasana (A) bind | Toolkit: /hook (pattern interrupt) + /story, fail-hero-payoff | No life note used (bedtime frame only)
- 2026-09-29 | Hidden Stories of Ashtanga Ep. 3 | Trigger: Asian Games Aichi-Nagoya, 27 Sep 2026, Parul Chaudhary women's 3000m steeplechase bronze in a personal best 9:08.67, her second Asian Games bronze in a row (thebridge.in) | Story: Bharadvaja studies three lives; Indra shows three mountains, one handful from each: the Vedas are endless (Taittiriya Brahmana 3.10.11) | Asana: Bharadvajasana | Toolkit: /hook + Vibe Samurai | No life note used (bedtime frame only)
- 2026-09-28 | Trigger: Berlin Marathon 27 Sep 2026, Tigst Assefa on world record pace, faded in the last miles, still won in 2:11:04 (3rd fastest women's marathon ever) | Story: Vishvamitra loses his tapas more than once and starts again until he becomes a Brahmarshi (Valmiki Ramayana, Bala Kanda) | Asana: Vishvamitrasana
- 2026-09-28 | Boonchu wrote this one himself, Plato edited | Trigger: his eyes at 53 | Story: Dhritarashtra refuses divine sight from Vyasa, Sanjaya gets it and narrates the Gita; his only Gita line is 1.1 ("my people"), last verse 18.78 (Mahabharata, Bhishma Parva; Bhagavad Gita) | Asana: dristi, nasagra (nose tip) | Line: "Dristi was never about seeing clearly. It's about not looking away." | Toolkit: Triple Hook + /story
- 2026-09-27 | Boonchu wrote this one himself, SERIES part 1 | Trigger: 3 days of Bangkok rain | Story: Vritra steals the waters; Dadhichi gives his bones for the vajra; Indra kills Vritra, rain returns (Rig Veda 1.32; Dadhichi in Puranas / Mahabharata) | Asana: Laghu Vajrasana
- 2026-09-28 | SERIES part 2 = Hidden Stories of Ashtanga Ep. 2, bedtime-story frame, Boonchu wrote the story, Plato added the asana | Story: Tvashtr's son Vishvarupa (3 heads) killed by Indra; Tvashtr chants "Indrashatru" with the wrong accent, Vritra is born to die by Indra (Taittiriya Samhita 2.4.12, 2.5.1; Shatapatha Brahmana 1.6.3; Bhagavata Purana 6.9; Paniniya Shiksha on the wrong accent as a "word thunderbolt") | Asana: Supta Vajrasana | Toolkit: Root and Wobble + /story | 29 Sep chat: Boonchu moved it to 29 Sep; final script: Question-First + Root and Wobble, "stress" link (wrong stress on a word = wrong stress in the asana, neck vs legs and chest). Full package bots/posts/2026-09-29-plato-chat-ep2.md. Bharadvaja (daily run) keeps Ep. 3, post after Ep. 2. FILMED + EDITED 29 Sep (1:38): Vibe Samurai, 'high' + 'lift from', his pronunciation aside, 7 Cloudflare images, captions with big emoji, 20 zoom punches, 18 SFX at 40%. Chat file card has a 30 MB limit: send a 2-pass ~2.2 Mbps copy. 29 Sep: Boonchu added 3 AYBKK Supta Vajrasana class photos (students gave permission, 'everyone loves it'); OK to reuse for Supta Vajrasana content.

- 2026-09-29 | Birthday tribute, Hero's Journey 5 beats: sick boy who hid from practice to play cricket, serious at 19, 20 years as assistant, took over 2007, world tours from 1996, students from 70+ countries; Boonchu's personal memories | No myth | Asana: none (tribute)

## What worked
(no feedback yet)

## Edit method (worked 2026-09-29, Ep. 2 "TvashtrChant")
- Boonchu shares a Drive link; the file downloads with curl from drive.usercontent.google.com/download?id=<id>&export=download&confirm=t (the Drive connector is too small for 500 MB).
- He speeds the take up 1.2x himself. Plato: cut pauses (audio RMS, 10 ms frames, speech > -17 dB; gaps to 0.35 s, mid-phrase 0.28 s; keep his planned beats: smile 1.2 s, silent beat 0.9 s), synth SFX in numpy at 40%, 0.4 s after the word, render 1080x1920 30 fps H.264.
- Story images: Cloudflare Workers AI flux-1-schnell (CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID are in the env; 7 images is far inside the free daily allowance). Style line: "Indian miniature painting style mixed with soft watercolor storybook illustration for a children's bedtime story. Deep plum and teal colors with small gold accents, dusk light, gentle and respectful, no text, no blood." Show the full square image over a blurred copy, slow zoom. Violent beats (heads cut) shown gently (heads become birds).
- Top label: small white "HIDDEN STORIES OF ASHTANGA" + teal "EP. N", Gloock line with gold key word. Above his head, clear of the IG header.
- Final video goes to Boonchu via the chat file card, never into the repo.
- Cover (Ep. 2, 29 Sep): a frame of his face from the take, plum gradient from the bottom third (plum #5C2160, about 93%), soft plum at top; white letterspaced "HIDDEN STORIES OF ASHTANGA" + teal pill "EP. N" at y 345 to 455; title Montserrat Black, max 5 words, one gold word, at y 1300 to 1560 (inside the 4:5 grid crop y 285 to 1635). Passed the black and white check.
