Ep. 4 (The Bird Who Fought the Sea, Tittibhasana) rough cut, 2 Oct.
Take: Drive folder 18perOKwTnyx3lbuKvKnDleYoxjq0GhKC (812645597...mov, 4K HEVC 10-bit, 2:37) + 8 Gemini pictures (Isle of Dogs style). Boonchu will add 3 Tittibhasana student photos to the same folder.
1. ffmpeg -> proxy.mp4 1080x1920 30fps (4K decode takes ~5 min on 4 cores); audio44.wav, a16.wav
2. faster-whisper small, word timestamps -> words.json (422 words)
3. cut4.py HOOK_F ALL_F: silence < -55 dB (this take's floor ~ -75 dB, speech ~ -30 to -45; -35 would cut speech), gaps 0.35/0.28 s, beats kept: 0.45 s after hook 'the real answer is' (cut-off), 0.9 s after 'take all the eggs', 0.9 s before 'the real answer', 0.5 s before 'you see'. Hook (to W[32]) x1.15 on top of all x1.1.
4. fc_cut: trim/atrim per segment, 8 ms afades, atempo, concat -> cut.mp4. Result 1:59.8, all 422 words kept (checked by re-transcribing).
5. Chat copy: 2-pass 1750k + 96k aac = 27.8 MB (chat card limit 30 MB).
Lengths: raw 2:37 -> pauses cut 2:12 -> hook faster 2:10 -> all x1.1 = 2:00.

Full edit (2 Oct evening), house style like Ep. 3:
6. cwords.json = words re-transcribed ON the cut timeline (no remap needed; concat pads each segment so A/V stay in sync).
7. captions.py (60 lines, his words, whisper mishearings fixed: race home, Panchatantra, tittibha, Mysore class, legs sore from walking, it's also teach you) -> caps4.py (Weight Shift, copied from ep3 caps3.py) -> caps4.mov
8. cards4.py (softcards2 from ep3, header 'Hidden Stories of Ashtanga · Ep. 4'): 8 Gemini Isle of Dogs pictures (pics/g1..g8), 4 class photos (s1..s4: Sep29 026/037/044, Sep30 125), 2 teacher-adjust photos from 2 Oct (oct2 raw 012, 092), navy title cards; no Garuda/Vishnu figures (light/wings only, 'Vishnu' title card).
9. sfx4.py: 28 SFX at 40%, 0.4 s after the word, synth rumble on 'raining'; punches.json -> 1.3x zoom.
10. render4.sh: video shifted down 180 px with blurred top fill, overlays top.mov at y 60 and caps4.mov at y 1370, 0.8 s tail; 2-pass 1650k for the chat.
Picture map (cut word index): g2 68-96, g8 97-112, quote card 113-128, g1 129-158, g6 159-191, g5 192-197, g4 198-204, Vishnu card 205-223, g7 224-236, tittibha card 237-244, g3 245-259, s2 260-286, s3 287-309, g6 310-324, answer card 325-340, 012 341-358, s1 359-369, 092 370-386, g7 387-401.
