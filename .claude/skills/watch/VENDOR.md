# Vendored dependency

`watch` is third-party code, not written for this repo.

- **Upstream:** https://github.com/taoufik123-collab/claude-watch
- **Commit:** `7711231e4c47e5d4e06bcf5326c4abf5b70ab4a9`
- **License:** MIT (see LICENSE)
- **Vendored:** 2026-08-29

Local changes: upstream `scripts/tests/` and `scripts/build-skill.sh` removed — build and
test tooling for the upstream project, not needed at runtime here. Nothing else edited.

To update, re-copy `SKILL.md` and `scripts/` from upstream rather than patching in place.

## Runtime requirements

`yt-dlp` and `ffmpeg` must be on PATH. In an ephemeral session:

    pip3 install yt-dlp imageio-ffmpeg
    ln -sf "$(python3 -c 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())')" /usr/local/bin/ffmpeg
    printf '#!/bin/sh\nexec python3 -m yt_dlp "$@"\n' > /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp

Whisper transcription (`GROQ_API_KEY` / `OPENAI_API_KEY`) is optional and only used when a
video has no caption track. Unset, the skill falls back to on-screen text from frames.
