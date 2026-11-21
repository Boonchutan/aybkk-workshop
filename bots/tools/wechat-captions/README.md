# WeChat Channels (视频号) Chinese-caption versions of Reels

Job from Boonchu, 21 Nov 2026: take his clean (no-caption) Reel exports and burn in simplified-Chinese captions with exactly the timing and look of his English Instagram versions.

## How it works
1. `diffmap.py ref.mp4 clean.mp4 out_prefix`: compares the English reference with the clean file. What is left is the burned-in captions. It saves a rows-by-frames map, so every caption line shows as a bar: where it sits and the exact frame it turns on and off.
2. Write a spec (`specs/chN.json`): one event per caption line, with `f0` (first frame), `f1` (first frame without it), `cy` (centre height, 0 to 1), `size` (font size as a share of the width), `fill` (white, cream, yellow), optional `anim: "ring"` and `audio: {gain_db}`.
3. `wxcap.py spec.json --still 250,470 out.png` previews frames. `wxcap.py spec.json` encodes: source size and frame rate, x264 CRF 14 slow, colour tags kept, audio copied (or gain plus limiter when `audio` is set).
4. `qa_timing.py clean.mp4 out.mp4 spec.json` proves each caption turns on at its planned frame.

## Fonts (Google Fonts, not stored here)
- Body: Chiron GoRound TC Black (bold rounded, covers simplified characters).
- Trailing ，。、；： are drawn with Noto Sans SC Black, because the TC font centres them the Taiwan way.
- CTA: ZCOOL QingKe HuangYou (condensed display). Emoji: Noto Color Emoji.

## Rules learned
- Chinese burned-in captions: no comma or full stop at the end of a line. Keep only ？ and ！.
- 上床 alone reads as a sex joke. Use 睡觉.
- The Chinese font size is about 1.13 times the English one, so it carries the same weight on a phone.
- Copy his little animations (the "Mula bandha is calling" phone-ring shake is the `ring` table in wxcap.py).
- Check the loudness of the clean file against the version he posted. channel4's clean export was 9 dB quieter, so it got +9 dB and a limiter.
- The Drive connector refuses uploads over 10 MB. Full-quality videos go to Boonchu in chat.

## Part 2 (same day): the five harder reels
- `refscan.py ref clean outdir` aligns the English reference with the clean file frame by frame (works for 24 fps reference against a 30 fps clean file, and for HDR clean against SDR reference), finds every caption change and makes contact sheets. `stepfind.py` shows any time window frame by frame, for word-by-word captions.
- A workflow then ran one reader per reel (exact on-screen text and frames), a translator (timed Chinese steps) and a reviewer. Result: `out/five_result.json` (not stored: large). `mkspec.py` turns it into `specs/chN.json`.
- `wxcap2.py` draws blocks whose text is laid out once for the full line and revealed step by step, so nothing moves while a line builds. It supports a serif look (Noto Serif SC Black), hard drop shadows, left-aligned stacks with one shared left edge per sentence, and HDR: HLG sources are encoded as HEVC Main10 HLG with the text at HDR reference white.
- For a 24 fps reference, lock caption times to seconds, not to the picture: clean frame = ceil(1.25 x reference frame).
- channel7 "had no music": in fact the posted version was the room sound 19.3 dB louder plus a music bed at 120.0 BPM in F minor. `bed120.py` synthesises an original bed with that tempo, key and tone balance; it is mixed 2 dB under the boosted room sound.
- Watch the disk: helper agents left 2 GB of frames in out/agents and an encode died with "no space left". Clear old scratch folders before encoding.
