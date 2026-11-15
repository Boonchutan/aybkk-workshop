# Family Reel: 'ฟัง gen Alpha ต่อคำสุภาษิตไทย' (15 Nov 2026)

Boonchu's video (Drive AYBKK/03_Reels_Content/สุภาษิต, 85 s, 4K vertical): mom says the start of a Thai proverb, their son finishes it his own way. Boonchu asked for stickers of the things in each line, his answers on screen, and sound effects.
- 13 proverbs; answers confirmed by Boonchu in chat (e.g. ตกไฟ -> 'มีช้างช่วย', ชักแม่น้ำ -> 'อควาแมน', ชี้โพรงให้ -> 'ชีต้า', สอนจระเข้ให้ -> 'โยคะ').
- Edit: title, mom's line as a white pill, the answer big in yellow, a small 'ของจริง:' line with the real proverb, Noto emoji stickers (Apache 2.0, fonts.gstatic) popping top right then moving to a small row, Mali Bold font (OFL), sound effects (draft 1 synthesized; public-domain animal sounds being sourced), 1.6 s freeze on the yoga ending.
- Safety: the 'สึนามิ' answer kept as he said, but no wave picture or scary sound (real victims in Thailand). No monk picture for แพ้เป็นพระ.
- Tools: render.py (timeline.json -> mp4 via PIL + ffmpeg), synth.py (fallback sound effects).
- No names of family members in this public repo.

## Draft 2 (15 Nov), Boonchu's timing rule
- A sticker never shows before the spoken word. Sticker = word end + 0.25 s. Sound = word end + 0.5 s.
- All sound effects at 60% of draft 1 (`sfx_gain` 0.6 in timeline.json).
- ชี้โพรง gets a tree-trunk-with-hole sticker (stk/treehole.png, drawn in PIL), then ชีต้า gets 🐆.
- Newest sticker owns the big spot; older ones in the same line move to a small row at the top.

## Draft 3 (15 Nov): real sounds
- 15 real recordings, all CC0 or public domain, checked by a second agent (sources and licences: sfx_sources.json, trimmed files: sfx/).
- Elephant, cow, tiger, toad are real animals. Cartoon sounds come from the USC Sunset/Red/Gold libraries on archive.org (CC0).
- No CC0 rhino or cheetah call exists: rhino = heavy animal stomping run, cheetah = whoosh.
- Level rule: a real sound is never louder than the draft 2 sound for the same key (peak and loudness capped), so every sound stays at 60% of draft 1.
- `python3 -I render.py $D audio draft2.mp4` rebuilds only the sound and remuxes (1 min instead of 25).

## Draft 4 (15 Nov)
- Thai text: lines laid out by real glyph boxes, so ขี้ and other stacked marks are never cut or pushed into the line above.
- พระ: custom monk sticker (stk/monk.png: Noto bald person + Noto folded hands, eyes closed, saffron robe) at word end + 0.25 s, small glass bell at + 0.5 s.
- Fire: real flare whoosh on 🔥. Laugh: 2 s CC0 chuckle at 40% when Mom laughs (40.1 s and 83.6 s).
- Levels vs the normalized voice's mono 99.9% peak: animals 0.60, other effects 0.40, ding/bell/gong 0.28, laugh 0.40 (checked in mix.wav).
