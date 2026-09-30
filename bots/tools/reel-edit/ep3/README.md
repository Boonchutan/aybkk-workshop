Ep. 3 edit (30 Sep), soft-box version. Order:
1. ffmpeg speed 1.3x -> fast.mov (setpts=PTS/1.3, atempo=1.3, 1080x1920 30fps)
2. faster-whisper small, word timestamps -> words.json
3. cut.py: pauses cut (-35 dB, gaps 0.35/0.28 s), silence after 'passed away' stretched to 2.0 s -> edit.json, voice.wav
4. base video: fc_base.txt (select + stretched silence + concat) -> base.mov
5. sfx3.py (HyperFrames sfx at 40%, 0.4 s after word) -> mixed.wav, punches.json
6. caps3.py (Weight Shift captions, auto 1-3 rows) -> caps3.mov ; cards3.py + softcards.py (soft-box cards, no frame) -> top.mov
7. render.sh (video shifted down 180 px, blurred top fill, 1.3x punches, overlays; 2-pass 2.25 Mbps for the chat)
Note: never pkill/pgrep -f a pattern that is also in your own command line (self-match, exit 144).
