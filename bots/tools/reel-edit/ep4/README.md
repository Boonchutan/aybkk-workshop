Ep. 4 (The Bird Who Fought the Sea, Tittibhasana) rough cut, 2 Oct.
Take: Drive folder 18perOKwTnyx3lbuKvKnDleYoxjq0GhKC (812645597...mov, 4K HEVC 10-bit, 2:37) + 8 Gemini pictures (Isle of Dogs style). Boonchu will add 3 Tittibhasana student photos to the same folder.
1. ffmpeg -> proxy.mp4 1080x1920 30fps (4K decode takes ~5 min on 4 cores); audio44.wav, a16.wav
2. faster-whisper small, word timestamps -> words.json (422 words)
3. cut4.py HOOK_F ALL_F: silence < -55 dB (this take's floor ~ -75 dB, speech ~ -30 to -45; -35 would cut speech), gaps 0.35/0.28 s, beats kept: 0.45 s after hook 'the real answer is' (cut-off), 0.9 s after 'take all the eggs', 0.9 s before 'the real answer', 0.5 s before 'you see'. Hook (to W[32]) x1.15 on top of all x1.1.
4. fc_cut: trim/atrim per segment, 8 ms afades, atempo, concat -> cut.mp4. Result 1:59.8, all 422 words kept (checked by re-transcribing).
5. Chat copy: 2-pass 1750k + 96k aac = 27.8 MB (chat card limit 30 MB).
Lengths: raw 2:37 -> pauses cut 2:12 -> hook faster 2:10 -> all x1.1 = 2:00.
