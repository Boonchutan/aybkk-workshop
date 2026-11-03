# read-link

When Boonchu sends a video link (Instagram, TikTok, Facebook, YouTube), run:

    python3 bots/tools/read-link/read_link.py "<url>"

from the memory folder. It prints the caption, then every spoken line with its time.
First run on a fresh computer installs yt-dlp and faster-whisper and downloads the
speech model (about 1 minute). Add `--model medium` for Thai, Chinese or Russian
speech that comes out wrong.

- No login, ever. Boonchu's accounts are never touched (hard rule 2).
- Instagram limits video fetches per computer. When it says so, work from the caption,
  try once more later, or ask for a screenshot. Do not try to get around the limit.
- YouTube usually blocks the download from cloud computers: title only.
- Music-only videos and text-on-screen videos have no spoken lines: ask for a screenshot.
- Names and messages of students or leads that show up in a video never go in a file.
