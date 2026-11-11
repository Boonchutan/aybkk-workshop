# story_aranya.md : story research, section "aranya" (Valmiki Ramayana, Aranya Kanda, to just after the abduction), 11 Nov 2026

Written after the owner's note "Why find the advance C and D? I gave you the pdf in my obsidian last time".
So the asana hints at the end use ONLY names I read on his PDF (Philippa Asher, Practise Sheets Part 2, pages 15 to 18 = Advanced A and Advanced B). Nothing about C or D.

## What was read (primary text, opened and read, not from memory)
- valmikiramayan.net, Aranya Kanda, verse-by-verse pages. Translator of this kanda: Desiraju Hanumanta Rao (page footers "(c) ... Desiraju Hanumanta Rao").
  URL pattern: https://www.valmikiramayan.net/utf8/aranya/sargaN/aranyasansN.htm
  Sargas read: 5 to 15, 35 to 46, 49 to 52, 54, 64 to 74 (67 see below). Raw pages out/dl_aranya/ ; plain text out/txt_aranya2/bN.txt
  (rebuilt today with out/scripts_aranya/vr3.py, because the first text pass out/txt_aranya/aN.txt dropped some verses, e.g. 3.74.14 and 3.74.32).
- LIVE CHECK today through the fetch tool: sargas 5, 7, 8, 9, 10, 11, 12, 13, 14, 37, 39, 41, 42, 45, 50, 54, 64, 66, 68, 73, 74. Every phrase I asked for came back FOUND with its verse tag.
- Machine check: out/scripts_aranya/check_quotes_aranya.py . All quoted strings in this file FOUND in the saved text (0 not found).
- Sarga 67: the saved page was a robot check ("One moment, please..."), not the text. I did not get round it. I read sarga 67 through the fetch tool, which gave a verse-by-verse SUMMARY only.
  So there are NO Rao quote marks from sarga 67 below. The exact words for that scene are Griffith's (his Canto LXVIII).
- Griffith, "The Ramayan of Valmiki, translated into English verse", Project Gutenberg ebook #24869
  (https://www.gutenberg.org/cache/epub/24869/pg24869.txt), Book III. File out/dl_bala_griffith/pg24869.txt, reader out/scripts_aranya/gr3.py
- sacred-texts.com: HTTP 403 again today. Griffith is quoted from Gutenberg only.
- NUMBERING. Sarga numbers below are valmikiramayan.net numbers. Griffith's Book III cantos have the same number up to 56.
  Griffith has one extra canto (LVII "Sita Comforted"), so from site sarga 57 on, Griffith = site + 1 (site 64 = Griffith LXV, site 74 = Griffith LXXV).
- SITE MISPRINT. On sargas 10, 11, 39 and 66 the page prints the verse tags as [4-10-..], [4-11-..], [4-39-..], [4-66-..]. They are Aranya (book 3). Cite them as 3.10, 3.11, 3.39, 3.66.
- Quote marks below = words I saw on the page (Rao = valmikiramayan.net, Griffith = Gutenberg #24869; " / " marks a line break in Griffith's verse).
  [say: ...] in square brackets = my suggested safe wording, NOT a quote.

## My order of strength for a 60-second Reel
A: Maricha (4), Jatayu (5), the hermit and the sword (2), Shabari (8). A-: Lakshmana and the deer (7), Sutikshna (1). B+: Sita's bundle (6, the most delicate to tell). B: Agastya (3, same sage as two earlier scripts).

## The 8 picks (story order)

### 1. Sutikshna : go, and come back
- Who: an old sage alone in his hermitage in the Dandaka forest. Rama finds him sitting still with dust on his body (3.7.5).
- Where: 3.7.1-23 (welcome, the gift, the animals), 3.8.5-20 (leaving), 3.11.21-29 (ten years, the return), 3.11.29-44 (he tells the road to Agastya). Griffith III.VII, VIII, XI.
- Moment: the sage hugs Rama: "I am awaiting for you only" (3.7.9). He offers Rama all the worlds his long practice has won (3.7.12).
  FORK 1 (Rama's): take the gift or earn his own. "I alone can gain all those worlds" (3.7.14, Rao); just show me where to live.
  The sage: stay here. One trouble only: herds of big animals come every day, "they return after scaring us, of course without killing anyone" (3.7.18).
  Rama lifts his bow to clear them, then says the sage would be pained, so it is better not to stay long (3.7.20-22). One night.
  FORK 2 (morning): leave. The sage lifts them from his feet, hugs them: go and see every hermitage, "but come again towards this hermitage after seeing all of them" (3.8.16).
  They go round: ten months here, a year there, four months, five, six (3.11.24-26). "indeed ten years have smoothly elapsed" (3.11.26b-27a).
  Then Rama "indeed went to the hermitage of Sage Suteekshna again" (3.11.27b-28a).
- source_words (Rao, 3.8.16 + 3.11.26b-27a + 3.11.27b-28a, 50 words): "My dear Rama, you may go and Soumitri you too also may go... but come again towards this hermitage after seeing all of them..."
  ... "While Raghava stayed comfortably taking delight in those hermitages of sages, indeed ten years have smoothly elapsed." ... "indeed went to the hermitage of Sage Suteekshna again"
- Griffith (second witness): "Go forth, these varied beauties see, / And then once more return to me." ; "Ten circling years of pleasure fled." ;
  "Then with his dame retraced the road / To good Sutíkshṇa's calm abode." ; Rama on the gift: "I of myself those worlds will win,"
- Surprise: ten of the fourteen forest years pass in about three verses, as small stays. At the end of them Rama walks back to the same door. And the hero says no to a shortcut: he is offered heaven as a present and answers that he will earn his own.
- Danger: herds of big wild animals rush the hermitage every day. Past the trees are the demons that hunt the forest sages (3.6, 3.10).
- Practice: coming back, and small steps. Ten years is made of ten months here, a year there. Nobody can hand you his practice (the gift refused). The teacher says "come back" and the student does.
  Fits the confirmed AYBKK line: a teacher notices when you are gone.
- Not in Valmiki: Sutikshna as Agastya's student who walks Rama to Agastya as his gift to his teacher. Later tradition (Tulsidas calls him Agastya's disciple; popular retellings add the teacher's-fee story).
  In Valmiki he only tells the road (3.11.37-43) and Rama goes without him. Also: the month list does not add up to ten years (translator's note at 3.11.26). Say "ten years", never do the sum.
- Safety: safe. No death. His not leaving for heaven stays one soft line, never explained as leaving the body. Rama raises the bow at the animals but does not shoot. Do not show the sages' plea with the bodies (3.6.16).

### 2. The hermit who kept Indra's sword (Sita tells it)
- Who: a truthful hermit with no name, in an old story Sita tells Rama on the road, the morning they leave Sutikshna. Sita is the storyteller.
  (Griffith prints a name, "Suchi". Rao reads the same word as "pious". The live page gives him no name. Use no name.)
- Where: 3.9.1-33 (Sita's speech, the tale is 3.9.16-23), 3.10.1-22 (Rama's answer). Griffith III.IX, X.
- Moment: Indra, dressed as a soldier, leaves his sword with a gentle hermit "to keep", in order to disturb his practice (3.9.17-18).
  The hermit is so careful of the trust that he carries it everywhere. Even to gather roots and fruit "he did not go without that sword" (3.9.20).
  FORK: leave it at home, or carry it every day. He carries it. Day by day his mind turns fierce, he lets his practice go, and he is lost (3.9.21-22).
  Sita: "In affinity and in respect I am reminding but not tutoring you" (3.9.24).
  Rama's answer: you speak because you care, "uninterested ones do not forewarn, indeed" (3.10.20b-21a). But I gave the sages my word:
  "I may forfeit my life, forgo Lakshmana, or even forsake you but not a promise" (3.10.18b-19a).
- source_words (Rao, 3.9.19 + 3.9.21 + 3.10.20b-21a, 50 words): "On receiving that sword, he who is duteous in guarding the entrustment, moved about in the forest always handling the sword, to safeguard the confidence reposed in him..."
  ... "Carrying that sword always, that hermit slowly made his own faculty infuriated, loosing determination in ascesis..." ... "uninterested ones do not forewarn, indeed"
- Griffith: "Whene'er for roots and fruit he strayed / Still by his side he bore the blade:" ; "As day by day that brand he wore," ... "And fierce and wild his spirit grew." ; Rama: "For those we love are those we teach."
- Surprise: in this scene Sita is the teacher, and her story is about habit. Nothing bad happens on any one day. The sword is never drawn in Rao's telling. Carrying it is what changed him. And Rama does not tell her she is wrong. He thanks her.
- Danger: a god in disguise who wants the hermit to fail. A sword in a gentle man's hand every day. A change so slow nobody sees it. And the three of them are walking into the demons' forest as she speaks.
- Practice: what you carry every day shapes you, slowly. It works the other way too: the mat you unroll every day. Second true link: the one who cares is the one who warns you. A teacher who notices.
- Not in Valmiki: the hermit's name (Rao has none); any list of the cruel things he did; a moral that weapons are bad (Sita herself says the bow is for "safeguarding the sufferers", 3.9.26, and Rama keeps his promise);
  any quarrel between husband and wife (he praises her, 3.10.2, 3.10.21).
- Safety: safe. [say: he lost his way] and never the word hell. Leave out 3.9.3-6 (the list of vices) and the sages being eaten (3.10.6): [say: demons hurt the forest sages]. It is a story about habit, never about weapons or war today. Never frame Sita as scolding Rama.

### 3. Agastya : the teacher who was keeping the bow
- Who: the great sage of the south. Rama calls him "my mentor" (3.13.10, Sanskrit "naH guruH"). CHECK BEFORE REUSE: same sage as posted Ep. 4 (he drinks the ocean) and as the 9 Nov Tadasana script
  ("The Mountain That Lay Down", Vindhya). This is a different event.
- Where: 3.11.29-94 (the road, his fame), 3.12.1-37 (welcome, the weapons), 3.13.1-25 (Panchavati). Griffith III.XI, XII, XIII.
- Moment: Rama walks to the one place in the forest where demons "do not even venture to live" (3.11.82) and tells Lakshmana "I think of living the remainder of forest living here only." (3.11.88).
  Inside, Agastya to his student: "My heart is indeed yearning for his arrival" ... "why you have not invited them as yet?" (3.12.10b-12a).
  He feeds them, then hands over what he has been keeping: Vishnu's bow, two quivers that never run out, a sword in a gold sheath (3.12.32-37).
  He sees how tired they are: "it is evident from the sweat above your necks" (3.13.2). He says they may stay with him. Rama asks for a place of his own (3.13.11).
  FORK (the teacher's): keep the good student in the safe place, or send him on. He thinks for a while (3.13.12). Then: Panchavati, not far. He knows what is in Rama's heart, so
  "I wish to advise you to go to Panchavati, though I said that you may dwell in these ascetic-woods along with me." (3.13.16-17a). From there Rama can guard the hermits (3.13.20).
- source_words (Rao, 3.12.10b-11a + 3.12.36 + 3.13.16-17a, 49 words): "My heart is indeed yearning for his arrival" ...
  "The bow, these two quivers, arrows, and the sword, oh, Rama, the endower of grace, receive and wield them" ... "I wish to advise you to go to Panchavati, though I said that you may dwell in these ascetic-woods along with me."
- Griffith: "For long my soul has yearned to see / The prince who comes to visit me." ; "Why stands he not already here?" ; "Beloved son, four leagues away / Is Panchavaṭí bright and gay:"
- Surprise: the bow in Rama's hand for the rest of the story is not from home. An old teacher in the forest had been keeping it for him. And the teacher who waited so long does not keep him: he sends him out of the one safe place.
- Danger: outside Agastya's wood is demon country. The first thing the next friend says about it: "this impassable forest is a beloved one to predators and demons" (Jatayu, 3.14.34). The teacher is sending them there, with Sita.
- Practice: a teacher who notices (the sweat on your neck, what is in your heart) and gives you the next thing when you are ready. In a Mysore room the teacher gives the next asana. You do not take it. [That last sentence is my bridge, for Boonchu to accept or change.]
- Not in Valmiki (these sargas): the mountain Vindhya told to stay low until he comes back (here only: the mountain stopped growing at his word, 3.11.85-86; the rest is Mahabharata and Puranas, see the 9 Nov research);
  the ocean drunk dry; the sun hymn (that is the war book, outside this run); Agastya as "short". He does NOT refuse to let Rama stay: he offers, Rama asks for his own place, he advises.
  Distance: Rao "two yojana-s", Griffith "four leagues". Say "not far".
- Safety: safe if Vatapi and Ilvala are left out (3.11.55-66: two demon brothers who kill their dinner guests from inside; told by Rama on the road). Leave out Agastya's lines on the nature of women (3.13.5-6).
  The weapons are for protecting the sages. No war talk. Skip Rao's "king of all the world" (3.12.30).

### 4. Maricha : the one who did not want to be the golden deer
- Who: the demon whom the boy Rama's arrow threw into the sea without killing him (Bala Kanda pick 4; his own memory of it is 3.38.19-22). Now he lives across the sea as a hermit,
  "wearing jute-clothes and black deerskin and tufts of hairs" (3.35.38), "living here in a yogic way" (3.39.14).
- Where: 3.35.37-42 (Ravana finds him), 3.36 (the plan), 3.37-39 (he says no), 3.40 (the threat), 3.41 (his choice), 3.42 (he goes, the deer), 3.43.5-8 (Lakshmana knows), 3.44 (the end, the false cry). Griffith III.XXXV-XLIV.
- Moment: Ravana lands at his hut: become a golden deer with silver spots and walk in front of Sita (3.36.18). At the name "Rama" Maricha's mouth goes dry (3.36.22).
  He says no, for three chapters, and he says what nobody says to a king: "It will always be easy to get people who talk pleasantly, oh, king" ... and harder still, "it is impossible to get listeners of such advises." (3.37.2).
  He admits his fear: he sees Rama at this tree and that tree, a thousand Ramas, and even words that begin with "ra" frighten him (3.39.15-18).
  Ravana: do it and "I will grant half of my kingdom" (3.40.23). Refuse and "for sure I will kill you now itself." (3.40.26).
  FORK: die now for saying no, or go and meet Rama's arrow. He chooses: "I will be dying at the hand of my enemy rather than at the hand of my own clansman like you" (3.41.17). He says "let us go." (3.42.1).
  And: "What is appearing before you is the reflected image of mine" (3.42.3): he counts himself gone from the moment he agreed.
- source_words (Rao, 3.39.15 + 3.41.17, 53 words): "From then on wards, I am indeed descrying Rama at this tree and at that tree, dressed in jute-cloths and black deerskin, and handling his bow like the Terminator handling a tether."
  ... "I will be dying at the hand of my enemy rather than at the hand of my own clansman like you"
- Griffith: "'Tis easy task, O King, to find / Smooth speakers who delight the mind." ; "The letter that begins his name / Sends terror through my startled frame." ; "I die, and if by Ráma slain / And not by thee, I count it gain." ;
  the forest deer: "Then snuffed the tainted gale and fled."
- Surprise: the golden deer did not want to be the golden deer. The villain's helper is a demon turned hermit who gives the best advice in the book and is right about all of it:
  "you will not be there, I will not be there, Lanka will not be there, the demons will not be there." (3.41.19). And the real animals are not fooled: "on smelling it well they are running away to all the ten directions" (3.42.28b-29a).
  Neither is Lakshmana: "I believe this deer to be that Maareecha, the demon." (3.43.5).
- Danger: death on both sides of the fork. A lord who will not hear "no". And the trap is being set for Sita.
- Practice: the person who tells you the thing you do not want to hear is rare. The person who can listen is rarer (3.37.2). A teacher who notices and says it. A student who can take it.
- Not in Valmiki: Maricha as a happy devotee who wants to be freed by Rama. Here his reasons are fear and the better of two deaths (3.41.17), and falling he still cries out in Rama's voice (3.44.19), so he is no saint.
  (Where the devotee reading starts I did not check to a text.) Maricha as Ravana's uncle: I did not see it in these sargas. No line on the ground (see pick 7). Maricha is NOT the sage Marichi of Marichyasana.
- Safety: tellable. End on [say: He went. A golden deer walked out in front of the hut.] If his end is needed: one gentle line, no arrow shown.
  OUT: his old life hunting sages (3.38.2, 3.39), Ravana's words about Sita (3.36.12-21, 3.38.30), Surpanakha's wound. [say: the demon lord] and do not dwell on the word king. Rama is never the fool: he says that if it is Maricha he must stop him (3.43.38).

### 5. Jatayu : the promise made on a road
- Who: a very old bird, lord of the vultures (Rao writes "eagle", Griffith "vulture"; [say: the old bird]). A friend of Rama's father.
  Son of Aruna, the Sun's charioteer: "I took birth from that Aruna, the charioteer of Sun" (3.14.33). Aruna is the hero of the earlier script "The One Who Comes Before the Sun".
- Where: 3.14.1-36 (first meeting), 3.49.36-40 (Sita sees him), 3.50 (he speaks), 3.51 (he fights), 3.67 and 3.68 (Rama finds him; the rites). Griffith III.XIV, L, LI, LXVIII, LXIX.
- Moment: on the road to Panchavati the brothers meet a huge bird and question it, "presuming it to be a demon" (3.14.2). It answers softly: "oh boy Rama know me as your father's friend." (3.14.3).
  Then, almost in passing: "I can take care of Seetha if you and Lakshmana go out..." (3.14.34).
  Later that day comes. He is asleep on a tree ("Jataayu who is slumbering away", 3.50.1). Sita sees him from the sky chariot and asks only for a message:
  "It is impossible for you to forestall this merciless night-walker" ... "everything about my abduction shall be narrated to Rama" (3.49.39-40).
  FORK: carry the message, or keep the promise. First he asks Ravana, politely, to stop (3.50.3-19). Then he says how old he is and how young and armed Ravana is, and goes anyway.
  He breaks Ravana's bow twice, and the chariot, and brings him to the ground (3.51.10-19). Then the old bird "is fatigued owing to his senescence" (3.51.21) and falls.
  When Rama finds him, Rama AGAIN takes him for a demon and raises his bow (3.67.10-13; Griffith: "My darling was the vulture's prey. / Some demon in the bird's disguise").
  With his last breath: Ravana "went southward taking the princess of Videha" (3.68.10) ... "That demon is the son of Vishravasa" (3.68.16), and he is gone in the middle of the sentence, Rama still saying "tell... tell more..." (3.68.17).
  Rama: "likewise this lord of birds is also a venerable and honourable one to me" (3.68.26), as his own father was. He does for the bird what a son does for a father (3.68.27-36).
- source_words (Rao, 3.14.34 + 3.50.20 + 3.50.21, 55 words): "I can take care of Seetha if you and Lakshmana go out..." ... "sixty thousand years have elapsed since I was born." ...
  "You are youngish whereas I am oldish, you are an armoured archer darting arrows from an air-chariot, whereas I am pensile bird in an open sky. Nevertheless, on taking Vaidehi you cannot abscond safely."
- Griffith: "By Sítá's side shall be my place." ; "The vulture from his slumber woke" ; "I, worn by years, am older far / Than thou, young lord of bow and car,"
- Surprise: three things. He was taken for a monster twice by the man he served. Nobody asked him to fight: Sita asked for a message. And he never says "Lanka": he gets out "south" and a father's name, and that one word is what the whole search then runs on (3.68.38).
- Danger: an old tired bird against an armed demon lord in a flying chariot, with Sita in it. Then a grieving archer about to shoot his only witness.
- Practice: keeping your word, long after you gave it, on the day nobody would blame you for not. Practice is a promise made on an easy day and kept on a hard one. He did not win, and it still counted: he bought the one word "south". Showing up counts even when you do not finish.
- Not in Valmiki (here): the word "Lanka" from Jatayu (checked on the live page: no); his brother Sampati and the flight toward the sun (a later book, outside this run). Place legends about where he fell are local tradition (not checked).
  The "sixty thousand years" are his own claim in the text. Eagle or vulture: translators differ.
- Safety: tellable with care. His death is ONE gentle line [say: the old bird closed his eyes]. No blood, no wings cut on screen [say: he fell]. OUT: the charioteer (3.51.18), the ten arms (3.51.38), the blood at 3.68.15.
  Never a war: one old friend keeping a promise. Ravana and Sita in one safe line [say: the demon lord was carrying Sita away in his sky chariot].

### 6. Sita : the small bundle
- Who: Sita, alone in the sky chariot.
- Where: 3.49.30-35 (she calls to the trees, the river, the forest gods, the animals), 3.52.26-33 (flowers, an anklet, pearls fall), 3.54.1-5 (the five on the mountain, the bundle). Griffith III.XLIX, LII, LIV.
  The payoff is outside this run: Kishkindha Kanda 4.6.15-22 (seen on the live page: the cloth and jewels are shown to Rama; Lakshmana knows only the anklets).
- Moment: she is carried through the sky. She calls to the flowering trees, to the river Godavari, to the forest gods, to the animals: tell Rama (3.49.30-34). The old bird has fallen. No helper is left.
  Then, far below, five monkeys sitting on a mountain top. FORK: go on crying, or do the one small thing still in her own hands.
  She wraps her jewels in her upper cloth and drops the bundle among them, thinking they "may perhaps" show it to Rama (3.54.2). Ravana, in his hurry, "has not noticed her action" (3.54.3).
  The monkeys look up "with their unwinking eyes" (3.54.4b-5a).
- source_words (Rao, 3.54.1 + 3.54.2-3a, 51 words): "Vaidehi has not seen any rescuer while she is abducted, but she has seen five prominent vanara-s staying on a mountaintop." ...
  "inwrapping her auspicious ornaments in the upper-fringe of her sari, dropped in the midmost of those five Vanara-s with a thinking that 'these creatures may perhaps indicate them to Rama.'"
- Griffith: "five monkeys stood." ; "From her fair neck her scarf she drew, / And down the glittering vesture flew." ; "And tell my lord the way I go."
- Surprise: the rescue of Sita starts with Sita. Before any helper, any search, she leaves the first clue herself, to five strangers, on a "perhaps".
- Danger: she is being carried across the sea by the demon lord. Nobody knows where. The one witness has fallen.
- Practice: small steps. When everything is out of your hands, do the one small thing that is still in them, without knowing if it will work. On the day practice feels useless, stand on the mat.
- Not in Valmiki: a trail of jewels dropped one by one to mark the road. Here flowers, an anklet and pearls fall by themselves (3.52.26-33) and the planned drop is ONE bundle (3.54.2).
  The five monkeys have no names in the verse (the names are the translator's bracket in the word list). No line on the ground and no crossing of it (pick 7).
  The shadow Sita (a double taken in her place) and Ravana lifting the ground under her are later texts (the translator's endnote to sarga 49 quotes the Adhyatma Ramayana for the second and "Another anthology" for the first). In Valmiki he simply seizes her (3.49.17-20).
- Safety: the most delicate of the eight. Ravana's words to Sita and his hands on her (3.46-49, 3.53-56) are OUT: one safe line only. Never quote Griffith's canto title for sarga 49 (it uses an old word for "carrying off" that reads badly today).
  She is shown thinking and acting, not weeping. [say: five monkeys on a hill] only: no names, no monkey army. The payoff is one line at most [say: later, that bundle reached Rama] or left as the open question.

### 7. Lakshmana : the deer that turned south
- Who: Rama's younger brother, just after he has been blamed for leaving the hut (3.58-59).
- Where: 3.64.1-36 (the silent river, the animals, the flowers, Rama's anger), 3.65.1-16 and 3.66.1-21 (his two speeches), 3.67.1-8 (Rama steadies). Griffith III.LXV-LXVIII. His leaving of Sita: 3.45.
- Moment: the hut is empty. Rama asks the trees (3.60). He asks the river Godavari. She stays silent: "River Godavari then remained mouthless about Seetha" (3.64.8), out of fear of Ravana (3.64.9).
  The forest animals keep looking at Rama. He asks them, his voice thick with tears, "where is Seetha?" (3.64.16b-17a).
  They stand up, turn their faces south, lift their noses to the sky, run a little way south, stop, look back, run again (3.64.17b-19a).
  FORK: stay inside the grief, or follow one small sign. It is Lakshmana who reads it: "Lakshmana ascertained that reason." (3.64.19b-20a). They walk south and find flowers on the path: "I recognise these flowers that are fallen here" (3.64.26b-27a).
  When the mountain gives no answer and Rama's grief turns to an anger "Lakshmana has not seen previously" (3.65.1), Lakshmana speaks: search first.
  "Let us search the oceans, rivers and forests, and even divers dreadful caves and different lotus-lakes..." (3.65.13b-14a).
  He "suppliantly gripped his feet" (3.66.1-2) and hands Rama's own teaching back to him: "indeed you alone have said this way to me previously and repeatedly" (3.66.18).
- source_words (Rao, 3.64.17b-19a + 3.64.19b-20a, 52 words): "When that best king has asked, those animals rose to their feet in a trice and facing themselves southward showed skyward with their snouts. And while running in the direction in which Maithili is taken away they are stopping to look back at that lord of people, Rama." ... "Lakshmana ascertained that reason."
- Griffith: "See, to the south their looks they bend." ; "And earth in patience unsurpassed." ; "To me thy lips such counsel gave."
- Surprise: the search for Sita begins with a herd of animals that cannot speak, and the one who notices is the younger brother who has just been scolded. On the elder's worst day the student steadies the teacher with the teacher's own words.
  And for viewers who know the famous version: there is no line on the ground in Valmiki.
- Danger: Sita is gone, no one will say where, and the strongest archer alive is so full of grief he is ready to break the river and the mountain. If nobody steadies him, the search never starts.
- Practice: on the bad day decide nothing big. Find the next small sign and take one step toward it. And practise next to people who know you well enough to give your own words back to you. Someone who notices.
- Not in Valmiki: the Lakshmana rekha (the line on the ground). In 3.45 he draws nothing (asked of the live page: no line or circle in any verse). He says "let all of the forest deities protect you" (3.45.33b-34a) and goes
  "while repeatedly looking back at that lonely lady" (3.45.40). Griffith: "May all attendant wood-gods screen / Thy head from harm, O large-eyed Queen!"
  The translator's endnote to sarga 49 lists the line among later legends. Wikipedia: "This line is not featured in the original epic by Valmiki." The deer do not speak: they turn and look.
- Safety: tellable. Rama's anger is told as GRIEF, in one soft line, never as a fault, never funny, and never the threat to the worlds. Sita's hard words to Lakshmana and his words about women (3.45.5-33) are OUT:
  [say: Sita was afraid for Rama and sent him] and no blame on her. OUT: the blood on the ground (3.65.7), the demoness Ayomukhi (3.69.12-18).

### 8. Shabari : the wet cloth on the tree (what Valmiki really says)
- Who: an old ascetic woman at Lake Pampa. She had served the students of the sage Matanga; she calls them "my teachers". Rao: "anchoress". Griffith: "aged votaress".
- Where: 3.73.22-27 (Kabandha describes the place and says she is still there), 3.74.1-35 (the meeting). Griffith III.LXXIV (lines "There erst on holy thoughts intent" on), LXXV.
- Moment: her teachers were carried up "to welkin on your arriving at Chitrakuta" (3.74.14), that is, at the very start of Rama's forest years, before the ten years of pick 1.
  They told her: "Rama will come to this highly blest hermitage of yours along with Soumitri", welcome them as guests, and then you will follow us (3.74.15-16).
  FORK: let the place go quiet, or stay and keep it ready with no date given. She stays. She gathers forest food from the lake shore for a guest who has not come.
  When he does come she does not talk about herself. She shows him her teachers' place: the altar still bright (3.74.24); the garlands they tied, "there is no discolouration to them" (3.74.27);
  their bark cloth, hung on the trees after the bath, still not dry (3.74.26). Kabandha has already told Rama about the flowers there: her teachers once carried heavy loads for their own teacher, their sweat fell,
  and "since those flowers have emerged from sweat-drops, they are imperishable, indeed" (3.73.23b-25). Rama says "astonishing is this..." (3.74.30). Then she asks leave to go to her teachers.
- source_words (Rao, 3.74.17 + 3.74.26, 59 words): "I have gleaned various forest fruits and eatables that occur on the moorlands of Pampa Lake for your sake..." ...
  "On performing holy baths those sages have spread their jute cloths on those trees with their own doddering hands here at this place and oh, Raghu's legatee, those cloths did not dry even now by the touch of their hands..."
- Griffith: "Food culled for thee in endless store / From every tree on Pampá's shore." ; "Through many a day are dripping yet." ; "From limb and brow the heat-drops fell:"
- Surprise: no tasted berries. The heart of Valmiki's scene is something else: a student who kept the place going for more than ten years after her teachers had gone (my sum from 3.74.14 and 3.11.26; the text gives no number), and a room where the work of people who practised is still fresh. Sweat that became flowers which do not fade.
- Danger (gentle): an old woman alone for years in a wild forest, near a mountain where, the guide says, demons seize the wicked in their sleep (3.73.34). Her teachers are gone and no date is given for the guest. The danger is giving up.
- Practice: showing up after the teacher has left the room. Practice leaves a mark on a place: the cloth is still wet, somebody was just here. Same place, same time.
- Not in Valmiki: the tasting or biting of the fruit, and the berries themselves. She says only that she gathered forest food (3.74.17). The translator's own note on that verse:
  "All that is not in Valmiki Ramayana. This amplification is from Padma Purana." D. Pattanaik (devdutt.com): not in Valmiki, not in Tulsidas, probably first in Balaram Das's Odia Ramayana (15th century), with mangoes.
  The sources differ on where it began, so [say: later tradition] and name no book. Matanga as her own guru: in Valmiki she served his students. Her birth or caste as the point of the scene: leave out.
- Safety: tellable. Her leaving is through fire (3.74.32-33a): ONE gentle line [say: then she went to her teachers], never the fire. Nothing about caste (the translator's long note): leave it all out.
  She is a saint: respectful. Kabandha is [say: a guide on the road] or left out.

## Bench (read, not picked)
- Sharabhanga (3.5, Griffith III.V): Indra's sky chariot, one that "does not touch the earth" (3.5.5-7), waits to take him to Brahma's world. He says wait:
  "without seeing my dear guest I do not wish to go to Brahma's abode" (3.5.29). He offers Rama his worlds; Rama: "I alone can gain all those worlds" (3.5.33).
  He leaves his old body "like a snake casting its withered moult" (3.5.38) by walking into the fire, and rises young (3.5.41).
  Griffith: "But when I knew that thou wast nigh, / To Brahmá's world I could not fly / Until these longing eyes were blest / With seeing thee, mine honoured guest."
  Strong fork (go now, or wait for the guest). Not picked: it doubles pick 1 (same offer, same answer) and it would be a second fire ending next to Shabari. Swap in for pick 3 if Agastya is refused.
- Lakshmana builds the hut (3.15.1-30): Rama: you choose the place. Lakshmana: you tell me, I am yours for all the years. Rama hugs him: with you beside me my father is not gone (3.15.27-29). Sweet, no fork, no danger.
- The forest sages (3.6.2-5): a list of how they practise (in neck-deep water, on bare ground, on leaves only, on water only, in wet cloth, between five fires). A good picture. Their plea shows the bodies of sages (3.6.16): unsafe to show.
- Kabandha (3.69-73): once handsome, he put on a monster shape to scare hermits for fun. A sage said: "that which is presently diabolic and despicable form of yours, hereinafter you will abide in this form alone" (3.71.4b-5a).
  Freed, he gives the road to Lake Pampa. A real fairy tale (the mask that stuck), but the release needs both arms cut and a pyre: unsafe as an episode. Use as one line [say: a cursed guide showed the road].
- Ravana as a holy beggar (3.46): safe picture only: orange cloth, umbrella, wooden sandals, water pot (3.46.3); the trees and the wind go still (3.46.6b-7a); Sita gives the guest a seat, water and food (3.46.34-36).
  His speech about her body (3.46.16-22) and all that follows: OUT. One line inside pick 5 or 6, not an episode.
- Unsafe: Viradha (3.2-4, a killing and a burial), Surpanakha (3.17-18: one safe line only [say: a demon princess was sent away angry and ran to her brothers]), Khara (3.19-30, a battle of thousands),
  Mandakarni's lake with hidden music (3.11.5-20, five heavenly women sent to break a sage's practice), Vatapi and Ilvala (3.11.55-66).

## Asana hints for the linking step (ONLY names I read on the owner's PDF, pages 15 to 18; meanings still to be checked in Monier-Williams by the asana step)
Names seen on the page images (pdf/pg-05 to pg-08, top and bottom halves):
- p.15 "First Half of Advanced A Series": Vasisthasana, Vishvamitrasana, Kasyapasana, Chakorasana, Bhairvasana (spelled so), Skandasana, Durvasasana, Urdhva Kukkutasana A, B, C, Galavasana,
  Eka Pada Bakasana A, B, Koundinyasana A, B, Astavakrasana A, B.
- p.16 "Second Half of Advanced A Series": Purna Matsyendrasana, Viranchyasana A, Viranchyasana B, Viparita Dandasana, Eka Pada Viparita Dandasana, Viparita Salabhasana, Ganda Bherundasana A and B,
  Hanumanasana A and B, Supta Trivikramasana, Dighasana A and B (spelled so), Trivikramasana, Natarajasana, Raja Kapotasana, Eka Pada Raja Kapotasana.
- p.17 "First Half of Advanced B Series": Mula Bandhasana, Nahusasana A, B and C, Vrschikasana, Sayanasana, Buddhasana, Kapilasana, Akarna Dhanurasana A and B, Padangustha Dhanurasana A and B,
  Marichyasana E, F, G, H, Tadasana, Samanasana, Punga Kukkutasana, Parsva Bakasana, Eka Pada Dhanurasana A and B, Eka Pada Kapotasana A and B.
- p.18 "Second Half of Advanced B Series": Paryangasana A, B, Parivrttasana A, B, Yoni Dandasana A and B, Yoga Dandasana, Bhuja Dandasana, Parsva Dandasana, Adho Dandasana, Urdhva Dandasana, Sama Konasana, Omkarasana.
Hints, with the KIND of link said plainly:
- Lakshmana and the deer: "Dighasana A and B" (p.16). WORD link if Monier-Williams confirms dish = direction: the verse itself has the word (glosses "yam disham" at 3.64.18 and "dakshiNaam disham ca" with "darshayanti" at 3.64.22 = they show the southern direction). Best honest link in this section.
  NOT "Nahusasana": Nahusha is named in 3.66.8 only as Yayati's father, in a line about a fall from heaven, and the 9 Nov research ruled Nahusha stories out.
- Agastya: "Akarna Dhanurasana A and B", "Padangustha Dhanurasana A and B" or "Eka Pada Dhanurasana A and B" (p.17). NAME link through dhanu = bow (glosses "anena dhanuSaa", "tat dhanuH" at 3.12.35-36).
  Clash: story_bala.md offers the same asanas to Janaka and Parashurama. One episode per asana.
- Sutikshna: "Parivrttasana A" or "B" (p.18; the sheet prints "3 x around clockwise / 3 x anti-clockwise"). SHAPE and MEANING link only, say so: going round and ending where you began.
  The text has both rounds: Rama walks round the sage before he leaves (gloss "pradakshiNam", 3.8.17) and comes back "on going around" the hermitages (gloss "pari sR^itya", 3.11.27b).
- Jatayu: "Kasyapasana" (p.15). NAME link, thin: Jatayu's own account of his family starts from Kashyapa (3.14.9-13). Clash: story_bala.md offers it to Parashurama.
  "Sayanasana" (p.17) would be a MEANING link only if shayana = lying asleep is confirmed (he is asleep on the tree, 3.50.1). No bird asana on the sheet is a vulture: do not use the crane or rooster asanas for him.
- Sharabhanga (bench): "Viranchyasana A" or "B" (p.16), NAME link if Viranchi = Brahma is confirmed (Brahma's world, and Brahma welcomes him, 3.5.42-43). story_bala.md offers it to Valmiki.
- Maricha: NO honest link. "Marichyasana E, F, G, H" are on p.17 but Marichi the sage is not Maricha the demon.
- The hermit and the sword, Sita's bundle, Shabari: NO name link found on the four pages. If one of these is filmed, the script must say in plain words that the asana is tied by the lesson only.
  ("Hanumanasana A and B" is on p.16, but Hanuman is not named in 3.54 and Hanumanasana is already used.)

## Secondary sources used only for the "not in Valmiki" flags (not for story facts)
- Lakshmana rekha: https://en.wikipedia.org/wiki/Lakshmana_rekha ; the translator's endnote on https://www.valmikiramayan.net/utf8/aranya/sarga49/aranyasans49.htm
- Shabari and the tasted fruit: the translator's note at 3.74.17 on https://www.valmikiramayan.net/utf8/aranya/sarga74/aranyasans74.htm ; https://devdutt.com/did-shabari-actually-feed-ram-tasted-berries/ ; https://en.wikipedia.org/wiki/Shabari
- Sutikshna in later tradition: https://www.hindu-blog.com/2020/03/story-sutikshana-and-lord-ram-greatness.html ; https://www.kidsgen.com/fables_and_fairytales/indian_mythology_stories/suteekshanas_gurudakshina.htm (search results only, not opened)
- The jewels found: https://www.valmikiramayan.net/utf8/kish/sarga6/kishkindhasans6.htm (4.6.15, 4.6.22)
- Earlier Agastya and Nahusha work: /home/user/bots-mem/bots/posts/2026-11-09-plato-hidden-stories-harvard/ (picks_advB2.md, research_advB.md, story_advB3.md)
