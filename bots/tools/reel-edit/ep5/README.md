Ep. 5 "Go Small" (Hanumanasana story, backbend lesson), 1 Nov 2026.
Take: Drive 14y5IIPoESRdNyWTXvCtU_XFh1RofX7RU (89 s 4K HEVC). curl drive.usercontent download -> proxy.mp4 (1080x1920 30 fps), audio44.wav.
1. faster-whisper small (pass a numpy array: this av version breaks file input) -> words.json
2. cut5.py: -55 dB, gaps 0.35/0.28, x1.1, beats, FORCED cut of the two restarts ('Surasa bless her', 'Surasa bless') -> fc_cut.txt -> cut.mov 59.2 s, voicecut.wav
3. re-transcribe on cut -> cwords.json; captions.py (32 lines); caps5.py = caps4 + 4 px dark stroke (white tee)
4. cards5.py (softcards2 from ep3; Montserrat.ttf = google/fonts Montserrat[wght].ttf); pics: Kling 1:1 2k (prompts.json; g4-g6 redone with the fixed Surasa design) + class photos 27-294, 31-155
5. sfx5.py: SFX synthesized in numpy (hf/ wavs not in repo) -> mixed.wav, punches.json; fc_final.txt
6. render5.sh, then concat a 2 s 'Comment STUCK' end card, 2-pass 2200k -> HiddenStories_Ep5_GoSmall.mp4 (62 s, 18 MB). Cover: frame 53.7 s, 'TIGHT BACKBEND? STOP PUSHING.'
