# Talk Reel builder (first used 21 Nov 2026)
Students-talk Reel: the talking clip is the main track, practice footage or photos go over it, burned EN + ZH captions.
- build2.py plan.json out.mp4: frame-exact cuts (keep + add - cut), optional cold open ('pre'), clip gains, end fade, slow-zoom photos ('image'), 4K practice crops ('file','t0','crop'), punch-in on alternate talking shots, one-box captions (Liberation Sans + WenQuanYi Zen Hei, black on 50% white = Boonchu's title style).
- Make the talking working copy with: ffmpeg -i after.mov -vf "fps=24000/1001,scale=1080:1920" (timestamp-true; plain re-encode drifted lip sync by 46 ms).
- gsheet.py: contact sheets for checking.
Lessons: whisper large-v3 on long Chinese windows makes up YouTube outro text, so use windows under 12 s. Word ends get clipped at cut points (AYBK-, Edis-), so pad each cut and check every name by ear or ASR. Two independent QA passes found about 50 real issues, so keep doing them.
Delivery: the Drive connector takes about 3 MB per upload (downloads up to 10 MB), so send the full video in chat. The footage folder is link-shared, so download big files with curl from drive.usercontent.google.com/download?id=...&export=download&confirm=t.

## Inserts (21 Nov, v1.2)
- Plan key `inserts`: a short beat placed after the kept segment nearest `after_src`, with its own room-tone audio (`audio`: file, t0, gain_db), a B-roll and a caption. Use it when a new caption needs its own moment.
- Room tone: check it with speech-to-text first. A "quiet" class clip can hold a teacher's voice.
- Don't trust Whisper word times at a cut point. Look at the 10 ms sound levels and cut in the silence. A cut 30 ms into a word leaves a half-word.
