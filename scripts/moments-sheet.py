#!/usr/bin/env python3
"""Numbered contact sheets of the staged Moments photos, so the daily routine
can look at a whole day (often 100+ photos) in a dozen images and pick the best 9.

  python3 scripts/moments-sheet.py <stagingDir> <sheetDir>

Writes <sheetDir>/sheet-01.jpg … (12 photos each, 4x3) and <sheetDir>/index.txt
mapping each number to its staged file name. Needs Pillow (pip install pillow).
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont, ImageOps

PHOTO = (".jpg", ".jpeg", ".png", ".webp")
COLS, ROWS, CELL = 4, 3, 360

staging, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
files = sorted(f for f in os.listdir(staging) if f.lower().endswith(PHOTO) and "__" in f)
try:
    font = ImageFont.truetype("DejaVuSans-Bold.ttf", 40)
except OSError:
    font = ImageFont.load_default()

lines = []
per = COLS * ROWS
for s in range(0, len(files), per):
    sheet = Image.new("RGB", (COLS * CELL, ROWS * CELL), "white")
    draw = ImageDraw.Draw(sheet)
    for i, f in enumerate(files[s:s + per]):
        n = s + i + 1
        try:
            im = ImageOps.exif_transpose(Image.open(os.path.join(staging, f)))
            im = ImageOps.fit(im.convert("RGB"), (CELL - 6, CELL - 6))
        except Exception:
            continue
        x, y = (i % COLS) * CELL + 3, (i // COLS) * CELL + 3
        sheet.paste(im, (x, y))
        draw.rectangle([x, y, x + 70, y + 50], fill="black")
        draw.text((x + 8, y + 3), str(n), fill="yellow", font=font)
        lines.append(f"{n}\t{f}")
    sheet.save(os.path.join(out, f"sheet-{s // per + 1:02d}.jpg"), quality=80)

with open(os.path.join(out, "index.txt"), "w") as fh:
    fh.write("\n".join(lines) + "\n")
print(f"{len(lines)} photos on {(len(files) + per - 1) // per} sheets in {out}")
