# Class-footage Reel builder (Urdhva Kukkutasana Reel, 22 Nov 2026)

Cuts a vertical 1440x2560 Reel from landscape 4K class clips plus Boonchu's voice-over,
with karaoke captions (newest word yellow) and a white chip that names the part.

## Files
- `build.py edl.json` builds the whole thing. Flags: `--plan out.jpg [id,id]` (3 frames per shot at the real crop, fast), `--shots-only`, `--no-caps`.
- `wxcap2.py`, `wxcap.py`: caption engine (copied from wechat-captions, plus a `box` option for the chip). Fonts: `fonts/` next to `tools/` (Chiron GoRound TC 900 etc., see wechat-captions README).
- `edl_kukkutasana_v5.json`: the edit list of the version sent 22 Nov (v5 = v4 picture + class sound bed, 28 shots). `vo_words_kukkutasana_v2.json`: re-timed VO words.
- Layout expected: `kuk/src/{D1.mov,D2.mp4,D3.mp4,vo.wav}`, `kuk/tools/`, `kuk/fonts/`, `kuk/work/`, `kuk/out/`.

## Shot options (edl.json)
- `crop [x,y,w,h]` in source px, always 9:16. `crop2`: eased move to this box over the shot (push-in or pull-out).
- `punch {at, z, px, py}`: Boonchu's "punch in a hit" at the hard moment. Snap zoom z over 4 frames at `at` s into the shot, pivot px,py (source px) stays put on screen. z 1.2 to 1.3 on phone clips, 1.12 to 1.15 on the wide HDR camera (softer).
- `room_bed` (edl level): {floor_db -14, cap_db -6, ratio 6, duck_db 14, filter per camera}: the class sound as a real bed. Per shot `room_off_db` turns one shot down (used -4 to -6 where the teacher's counting talks over the VO). Old per-shot `room_db` only works without room_bed. `--audio-only out/<finished>.mp4` rebuilds just the sound and remuxes it onto a finished file (about 1 minute).
- Shots are cached by a key (`shotNN.mp4.key`). Bump `'v'` in `shot_key` when the decode chain changes.

## Lessons (the independent QA found these in v1)
1. **Whisper word starts absorb silence.** The first word after every pause started 0.2 to 0.7 s early, and words drifted inside long phrases. Fix used: find real speech segments from the VO loudness (10 ms bins, -46 dBFS, merge gaps under 0.18 s), put each word in the segment that holds its whisper END time, then map the words linearly into that segment. Check the hook by hand.
2. **Caption overlap.** A phrase must end on the frame the next one starts (f1 is exclusive). Gaps under 6 frames are closed. build.py now does both.
3. **Duplicate first frame** after every cut: add `setpts=PTS-STARTPTS` before `fps=24` when decoding with -ss.
4. **D1 (DJI HLG) colour:** tone-map mobius with desat=2, then warm mixer and `eq=gamma=0.88:contrast=1.06`. desat=0 left the blacks grey and the windows cyan.
5. **Audio:** student voices in the room sound mask VO words; the VO file had clicks after the last word (fade VO alone at 41.05 to 41.25 s). Limiter at 0.84 keeps true peak under -1 dBTP.
6. **Brief check:** a separate checker asked to list every brief item shown, partly shown or missing caught the missing jump back, padmasana without hands and jump up to handstand.
7. **Ask Boonchu, he knows his students.** The scouts missed a girl he named ("the girl on the most left also lift up by herself", "you can see better on the right side camera"). Black top, left line. In the footage she jumps up and holds padmasana in the air by herself (D3 77.0 to 80.5, clean against the wood wall; D1 203 to 208), comes down, and the teacher helps her lift back up (D3 86.5 to 91, D1 212 to 217). v4 shows her holding padmasana by herself under "You just smile" while the leopard-print student in front laughs (D3 78.0). Question sent to Boonchu with a 2-frame picture; his answer is pending.
8. **More QA lessons (rounds 2 and 3):** never put a punch-in on a student's hips; check the shot that should show "without hands" frame by frame; end a shot before a student drops out of an asana; never leave half a person at a frame edge; in ffmpeg eq, gamma below 1 darkens; a punch pivot outside the crop must be clamped (build.py does it now).
9. **Settings that passed:** D1 tone-map mobius param 0.15 desat 2, mixer rr 1.03 gg 0.96 bb 0.91, eq gamma 0.94. Phone copy for chat: H.264 9 Mbps, about 50 MB, gets a save button.
10. **Class sound (v5):** the DJI wide camera's sound is real room sound (200-1000 Hz), not hiss, so it needs only a low cut. The D2 phone caught the teacher counting (Exhale, the Sanskrit count, Inhale come up) in part A. Raw floors: D1 -44, D2 -49, D3 -55 dBFS; the VO speech is -31. Speech-to-text on the final mix heard the whole script.
