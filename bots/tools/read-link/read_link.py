#!/usr/bin/env python3
"""Read a public video link: print its caption and the words spoken in it.

Usage:  python3 read_link.py <url> [--model small|medium]

Works for Instagram reels and posts, TikTok and Facebook videos. YouTube often
blocks the download from cloud computers; then only the title comes back.

No login is used anywhere: Instagram shows the caption to link-preview bots
(the same thing that draws a preview card in LINE or WhatsApp), and the video
file is public. Boonchu's accounts are never touched.
"""
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse

PREVIEW_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"


def ensure(module, package):
    try:
        __import__(module)
    except ImportError:
        print(f"(installing {package}, first run only)", file=sys.stderr)
        cmd = [sys.executable, "-m", "pip", "install", "-q", package]
        if subprocess.run(cmd).returncode:
            subprocess.run(cmd + ["--break-system-packages"], check=True)


def curl(url, ua=PREVIEW_UA):
    r = subprocess.run(["curl", "-sL", "--max-time", "30", "-A", ua, url],
                       capture_output=True, text=True, errors="replace")
    return r.stdout


def caption(url):
    host = urllib.parse.urlparse(url).netloc.lower()
    if "youtube.com" in host or "youtu.be" in host or "tiktok.com" in host:
        base = "https://www.tiktok.com/oembed" if "tiktok" in host else "https://www.youtube.com/oembed"
        try:
            j = json.loads(curl(f"{base}?url={urllib.parse.quote(url, safe='')}&format=json"))
            return f"{j.get('author_name', '')}: {j.get('title', '')}".strip(": ")
        except ValueError:
            pass
    page = curl(url)
    found = {}
    for key in ("og:title", "og:description"):
        m = re.search(r'<meta[^>]+(?:property|name)="%s"[^>]+content="([^"]*)"' % key, page)
        if m:
            found[key] = html.unescape(m.group(1))
    # og:description repeats the caption after the like count; prefer it when it has more
    return found.get("og:description") or found.get("og:title") or ""


def download(url, work):
    ensure("yt_dlp", "yt-dlp")
    r = subprocess.run([sys.executable, "-m", "yt_dlp", "--no-warnings", "-q",
                        "-f", "best[ext=mp4]/best", "-o", os.path.join(work, "video.%(ext)s"), url],
                       capture_output=True, text=True)
    files = [f for f in os.listdir(work) if f.startswith("video.")]
    if not files:
        return None, (r.stderr.strip().splitlines() or ["download failed"])[-1]
    return os.path.join(work, files[0]), None


def transcribe(video, work, model_name):
    ensure("faster_whisper", "faster-whisper")
    import wave
    import numpy as np
    from faster_whisper import WhisperModel
    wav = os.path.join(work, "audio.wav")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", video, "-ac", "1", "-ar", "16000", wav], check=True)
    # Pass samples, not the file: the installed PyAV breaks faster-whisper's own decoder.
    with wave.open(wav) as w:
        audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, info = model.transcribe(audio, beam_size=5)
    lines = [f"[{s.start:5.1f}s] {s.text.strip()}" for s in segments]
    return info.language, len(audio) / 16000, lines


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    url = args[0]
    model_name = "medium" if "--model" in sys.argv and "medium" in sys.argv else "small"
    work = tempfile.mkdtemp(prefix="read-link-")
    try:
        print("CAPTION:")
        print(caption(url) or "(none found)")
        video, err = download(url, work)
        if not video:
            # Instagram caps anonymous video fetches per computer. Respect it: one try, no workarounds.
            why = ("Instagram is limiting video fetches from this computer right now"
                   if "rate-limit" in err or "login page" in err else err)
            print(f"\nSPOKEN: could not get the video ({why}). Work from the caption, try once more in an hour,"
                  " or ask Boonchu for a screenshot or one line on what is said.")
            return
        lang, secs, lines = transcribe(video, work, model_name)
        print(f"\nSPOKEN ({secs:.0f} s, language: {lang}):")
        print("\n".join(lines) if lines else "(no speech: music only, or text on screen)")
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
