# Trial Reels run (from 18 Nov 2026)
Boonchu via Alex (his assistant bot): repost the most-shared Reels as Instagram TRIAL REELS (non-followers), 3 a day at 07:00, 12:30, 19:30 Bangkok (00:00, 05:30, 12:30 UTC), in order of shares. Standing go from Alex/Boonchu for every reel that keeps the standard: true to the original, value caption + CTA 'Want to try a class with us in Bangkok? Comment TRIAL and we'll message you.', no invented claims. Send Alex a short note each time a day's 3 are scheduled.
- Alex answers TRIAL comments and DMs (hourly check). Plato does not.
- #4 Sharathji tribute (DPLr5ZYE3kz) is OUT of the run (no sales CTA on tribute content).
- Music: a pop/copyrighted song is swapped: mute it in the file (silent AAC track) and attach a track from Instagram's library with Postiz settings.audio {id,title,artist,audio_volume 100,video_volume 0} (find ids with triggerTool audioSearch). Voice or room sound stays.
- Postiz: settings post_type post, is_trial_reel true, graduation_strategy MANUAL (followers already saw these). Hook burned on screen in Boonchu's title style (black Liberation Sans Bold on white 50%), clear of burned-in text.
Slots (updated 17 Nov: #4 tribute out; #2 and #8 are the SAME clip, posted once in #2's slot using #8's sharper 1440x2560 file and #8's caption; #8 dropped):
| Day | 07:00 | 12:30 | 19:30 |
| Wed 18 Nov | #1 DVlUjiuCdEq SCHEDULED cmwksqe5u047cqe07pb6fad56 (audio Colors (Instrumental)) | #2/#8 SCHEDULED cmwkuqvwq04xsqe07c5qfqs8x (original count audio) | #3 DT5MGLlCYIZ SCHEDULED cmwkuqvxq04xtqe07cztq73qx (audio Good Vibes, Giulio Cercato) |
| Thu 19 Nov | #5 DPqoaEBjEKB SCHEDULED cmwkv4fp504qlns084e85svx9 (Qingdao, 360p upscaled, hook 'Most come back every time we teach in China.', original count audio) | #6 DcgNnNBJfE3 SCHEDULED cmwkv4fpt04qmns08qwb7e9ts (voice audio) | #7 DVSInBZAcNY SCHEDULED cmwkv4fqg04qnns08ofz3qcrz (audio Primavera, Giulio Cercato) |
| Fri 20 Nov | #9 DE40EiMTWmH SCHEDULED cmwkz55px06j8ns08rz3ruq0r ('6 problems with Ashtanga' joke; hook 'Ashtanga has problems. The worst? You won't stop talking about it.' 0-52.6 s; voice+music kept, mixed; package_09.json) | #10 DDjxGzaTbxh SCHEDULED cmwkypo3806mdqe07hm6j0jnd (voice audio kept, hook 0-9 s, pregnancy caution line) | #11 DW7ciWoAefI SCHEDULED cmwkypo4806mfqe07pz9pcxis (Huizhou; audio Breathe In, Go Slow, The Poison Oaks; hook 0-8.5 s) |
| Sat 21 Nov | #12 DDMio1_zQPu SCHEDULED cmwkz14gl06iens08kdexqva1 (voice kept, hook 0-13.5 s) | #13 DUxX9QYiQ_a SCHEDULED cmwkz14hz06ifns08qmxiqcez (cut at 29.4 s + 1.6 s freeze to drop the burned 'Comment the experience' ask; audio Mesmer, Austin Woodward & Adam Griffith; hook 0-4.5 s) | #14 DXjo6HBiUrh SCHEDULED cmwkz14kc06igns08vgsnud39 (Guangzhou; audio Someday (Instrumental), Cy Curnin; hook 0-4.6 s) |
| Sun 22 Nov | #15 DQFpR4Sk11M | #16 DZP6P7PJqTD | #17 DUwhH8UgczA |
| Mon 23 Nov | #18 DZ6eBp-pbkH | #19 DVLnFDPCfaj | #20 DTtwa3JEoHz |
| Tue 24 Nov | #21 DLIGtnSTQmX | #22 DXp5Zp6ARrO | #23 DSxBKzIiYvN |
| Wed 25 Nov | #24 DdQ7jjOSvx8 | #25 DEZYfwITC8_ | #26 DcEBiDgJhvu |
| Thu 26 Nov | #27 DP6UwT1iZXb | #28 DSKiv76iSIQ | (need #29 from Alex) |
Hook timing: when the reel has its own burned-in text in the top band, the hook shows only at the start (fades out before the burned text arrives, about 4.5-5.5 s).
Old #1 draft cmwksheng043sqe0737534lvq (19:00, no audio swap) must be deleted in the Postiz app.

Packages for 13-28: packages_13_28.json (workflow, 17 Nov). Flags before their slots: #16 is a birthday TRIBUTE to a named student (no TRIAL CTA allowed: out of the run like #4 unless Boonchu says otherwise); #21 uses Andrew Huberman's podcast voice (copyrighted, looks like an endorsement under a sales CTA); #25 is New Year content (out of season in Nov).
File size: keep each mp4 under 50 MB (GitHub warns over 50, fails over 100). Long reels: raise crf.
Tools: scratchpad trial/fri/tools/mkhook.py (hook box) and sheet.py (frame sheets). Freeze an ending with input-side -t then tpad (output -t cuts the pad).
