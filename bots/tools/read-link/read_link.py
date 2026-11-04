#!/usr/bin/env python3
"""Read a video: every spoken line, plus stills a bot can open to see the screen.

Usage:
  python3 read_link.py <video file> [--model small|medium] [--no-frames]
  python3 read_link.py <link>          caption only, from what the platform shares openly

Instagram, Facebook, TikTok and YouTube do not let bots pull their videos. We do not
get around that: no fake user agents, no downloaders. For a video link, ask Boonchu
for the file (saved from the app, or a screen recording) and run this on the file.
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

UA = "AYBKK-team-bot/1.0 (+https://aybkk.net)"
OEMBED = {"tiktok.com": "https://www.tiktok.com/oembed",
          "youtube.com": "https://www.youtube.com/oembed",
          "youtu.be": "https://www.youtube.com/oembed"}


def ensure(module, package):
    try:
        __import__(module)
    except ImportError:
        print(f"(installing {package}, first run only)", file=sys.stderr)
        cmd = [sys.executable, "-m", "pip", "install", "-q", package]
        if subprocess.run(cmd).returncode:
            subprocess.run(cmd + ["--break-system-packages"], check=True)


def curl(url):
    r = subprocess.run(["curl", "-sL", "--max-time", "30", "-A", UA, url],
                       capture_output=True, text=True, errors="replace")
    return r.stdout


def caption(url):
    host = urllib.parse.urlparse(url).netloc.lower()
    for domain, endpoint in OEMBED.items():
        if host.endswith(domain):
            try:
                j = json.loads(curl(f"{endpoint}?url={urllib.parse.quote(url, safe='')}&format=json"))
                return f"{j.get('author_name', '')}: {j.get('title', '')}".strip(": ")
            except ValueError:
                return ""
    # Any other page: read its public preview tags as an honest visitor. A login wall means no caption.
    page = curl(url)
    for key in ("og:description", "og:title"):
        m = re.search(r'<meta[^>]+(?:property|name)="%s"[^>]+content="([^"]*)"' % key, page)
        if m:
            return html.unescape(m.group(1))
    return ""


def frames(video, out_dir, max_frames=20):
    """One still every few seconds (every 3 s, spread wider for long videos) for the image reader."""
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video],
                       capture_output=True, text=True)
    try:
        secs = float(r.stdout.strip())
    except ValueError:
        secs = 60.0
    step = max(3.0, secs / max_frames)
    os.makedirs(out_dir, exist_ok=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", "0.5", "-i", video,
                    "-vf", f"fps=1/{step:.2f},scale=540:-2", "-frames:v", str(max_frames),
                    os.path.join(out_dir, "frame_%02d.jpg")], check=True)
    shots = sorted(f for f in os.listdir(out_dir) if f.endswith(".jpg"))
    return [(0.5 + i * step, os.path.join(out_dir, f)) for i, f in enumerate(shots)]


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
    target = args[0]
    if not os.path.isfile(target):
        print("CAPTION:")
        print(caption(target) or "(none: the platform shows bots a login page)")
        print("\nVIDEO: platforms do not let bots download videos, and we do not get around that."
              " Ask Boonchu to send the video file (save it from the app, or screen-record it),"
              " then run this tool on the file.")
        return
    model_name = "medium" if "--model" in sys.argv and "medium" in sys.argv else "small"
    work = tempfile.mkdtemp(prefix="read-link-")
    try:
        lang, secs, lines = transcribe(target, work, model_name)
        print(f"SPOKEN ({secs:.0f} s, language: {lang}):")
        print("\n".join(lines) if lines else "(no speech: music only, or text on screen: look at the frames)")
        if "--no-frames" not in sys.argv:
            # Kept after the run (the work folder is not): open them with the image reader.
            out = tempfile.mkdtemp(prefix="read-link-frames-")
            shots = frames(target, out)
            print(f"\nFRAMES ({len(shots)} stills; open them with your image reader to see text on screen,"
                  " faces, setting, edit style):")
            print("\n".join(f"[{t:5.1f}s] {path}" for t, path in shots))
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
