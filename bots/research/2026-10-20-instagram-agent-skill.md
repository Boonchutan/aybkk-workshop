# "Instagram agent skill" (Reel by @ai.zygis, DerFZ3CuwUH) review, 20 Oct 2026

Boonchu sent the Reel: "Instagram skill". Reel claim: "Claude just killed Instagram... connect Claude to Instagram and it runs your entire account... comment Claude and I'll shoot it over" (1,978 comments).
Source: github.com/Jakeschincariol/instagram-agent-skill, commit d03c56b (13 Sep 2026), MIT. Reviewed by 3 agents (safety, fit, install) + critic; every file read.

## Verdict: safe to read; do NOT install as the Reel/README says; take 4 edited pieces later
- The Reel's claim is false. Nothing connects to Instagram or posts. README: "no API key, nothing to connect", "These skills do not post to Instagram". It is 13 prompt files + 6 local stdlib Python scripts that write drafts from what you paste in.
- No malware, no hidden instructions, no network code in the scripts, no hooks or MCP servers.
- Problems: ig-viral tells Claude to drive the user's logged-in Instagram browser (or computer use) and run yt-dlp on YouTube: bot inside the live account, against platform Terms. humanize.py changes meaning ("Elevate your hips and unlock the knee" -> "Improve your hips and get the knee"; "We empower students to" -> "We let students to"), splits the yoga emoji, breaks Chinese name dots and the Russian dash. caption.py / detect.py / hookscore.py are English-only. Skills write handles of leads/commenters/buyers to plain files (log.md, plan.md, swipe.md, voice.md "names I cannot say publicly"): must never land in the public repo. hookscore.py: README itself reports AUC 0.56 (near a coin flip); hooks.json has an unsourced stat (#23) and money-claim hooks. Broad skill descriptions would take over /hook, /story, /dm.

## Take (as edited copies, pinned d03c56b, LICENSE kept, via one PR after Boonchu's go)
- ig-human (humanize.py) as a last English-only pass, output always read; remove U+200D from deletes and the meaning-changing swaps; add AYBKK banned words.
- ig-caption (caption.py) as pass/fail on English captions (one ask, tag count, first-125-character window). Misses Thai tags and "aybkk.net" without a slash.
- beats.py from ig-reel: time spoken lines at Boonchu's measured words per minute (default 165 too fast); on the 19 Oct script it found 68.6 s vs 60 s target and a 6 s hook beat.
- ig-reply in the Carne chat on pasted comments: no price, no "sorry", no handles in repo files, aybkk comments get the frozen DM text, questions go to the question bank.
- After 22 Nov (keyword test frozen until then): ig-profile one manual audit (proof line exactly "Authorized Level 2 by R. Sharath Jois"); ig-audit metrics (multiple over own median, hold at 3 s, sends per reach) added to the Reel log.
Each copy: "disable-model-invocation: true", AYBKK house-rules header, paths moved, log/plan/swipe writes removed.

## Skip
ig-viral (only the outlier-multiple METHOD, by hand), ig-dm (no price ban; "Worth a quick call?" before the application; /dm is better), ig-plan (duplicates Batch Sheet, would change the frozen test), ig-comment (no outbound-comment job; stores handles), ig-carousel (clashes with the locked magazine look), ig-story (name clashes with /story; later maybe the question-box idea), ig-repurpose (later, for the Halbert letter), hookscore.py as a gate.

## AYBKK gap found
.claude/commands/dm.md line 37 says to state the price "once, plainly", which conflicts with the house rule "never a price in a DM". Fix /dm.
Unverified, do not act on yet: "Instagram allows 5 hashtags since 18 Dec 2025" (repo + news only).
