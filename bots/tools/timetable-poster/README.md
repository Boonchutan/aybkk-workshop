# Timetable poster

Next month's AYBKK timetable as images: Instagram feed (1080x1350), story (1080x1920),
and the feed image for LINE, in English and Thai. Images only; posting needs Boonchu's go.

## The monthly command

On the last afternoon of the month, from this folder:

```
node render.js --all --outdir <your scratchpad>/poster-out
```

It reads the live timetable (https://aybkk.net/api/bkk/schedule?days=62, no key), renders next
month, and writes eight images plus `schedule.json` (the timetable it used) into
`<outdir>/<YYYY-MM>/`: `aybkk-<YYYY-MM>-<en|th>-<feed|story>-<A|B>.png`.
Without `--outdir` (or the `POSTER_OUT` env var) it writes to the scratchpad of the session that
built the tool, which a later session does not have, so always pass it.

Then make the preview sheet for Boonchu (the four feed images, A on top, B below, white ground):

```
D=<outdir>/<YYYY-MM>; M=<YYYY-MM>; F=../golden-grid/fonts/Inter-var.ttf
montage -font "$F" -pointsize 40 -fill '#17121a' -background white \
  -label 'Look A · English' $D/aybkk-$M-en-feed-A.png -label 'Look A · Thai' $D/aybkk-$M-th-feed-A.png \
  -label 'Look B · English' $D/aybkk-$M-en-feed-B.png -label 'Look B · Thai' $D/aybkk-$M-th-feed-B.png \
  -tile 2x2 -geometry 1080x1350+40+30 -depth 8 $D/preview.png
```

Open every image (all eight, and the preview) and check it before sending it to him.
The command prints `ok` or `CHECK` per image; fix any CHECK first.

### Which look

Boonchu has not picked yet, so `--all` renders both looks, and **A is the default** for a single
image (`DEFAULT_LOOK` in `render.js`). Once he picks, add `--look A` or `--look B` to the monthly
command (and set `DEFAULT_LOOK` to his pick).

### A new photo

```
node render.js --all --outdir <your scratchpad>/poster-out --photo /path/to/new.jpg
```

Put a `new.json` beside `new.jpg` to say where its printed credit is and how to crop it
(see "Photo" below). Look at the title: it must not sit on a face; move the crop with `pos`.

## One image

```
node render.js --month 2026-11 --lang en|th --size feed|story --look A|B [--photo p] [--data file] --out file.png
```

`--data` takes a saved copy of the schedule JSON instead of fetching it. `--today 2026-11-10`
pretends it is that Bangkok date (testing). `.jpg` in `--out` writes a JPEG. `--help` lists all.

The command prints one line per image: `ok` or `CHECK` (some text did not fit; the box is named),
the title size, and any fit steps it took. Exit code 1 means a CHECK or a WARNING: look before using it.

## What is on it

- Big: the month and year, Inter Black (Boonchu's "thicker Helvetica"), one line, full width.
  Thai: Thai month and Buddhist year (พฤศจิกายน 2569) in Noto Sans Thai Black.
- Middle: the date number in each tile.
- Small (one style, 22px Inter SemiBold, Thai in Noto Sans Thai SemiBold): weekday heads,
  class lines, footer.
- One white see-through tile per date, Sunday first. Each tile: date, then per class type its
  short name (Mysore / Primary / Inter., Thai มายซอร์, as on the booking page), start times,
  teachers in time order ("5:30 7:30" then "M, Boonchu" means M at 5:30). Shala classes only.
  Moon days: date and "Moon day" (EN), or the booking page's own words in TH: "จันทร์ดับ"
  (new moon) / "จันทร์เต็มดวง" (full moon). No classes on them. No tile for days outside the month.
- Footer, in the month's empty days when there is room, else a band at the bottom:
  "Book at aybkk.net · LINE @aybkk", "S31 Sukhumvit Hotel, 8th floor, Sukhumvit 31", and
  "Led classes also live on Zoom" only when the month has online classes. TH: "จองที่ aybkk.net ·
  LINE @aybkk", "โรงแรม S31 ชั้น 8 สุขุมวิท 31" (the site calls it โรงแรม S31), "คลาส Led
  ถ่ายทอดสดทาง Zoom ด้วย".
- No prices, no em dashes, teacher names in Latin letters.

Six-week months (the 1st on a Friday or Saturday) put the month name in the empty first-week
days instead of above the grid, so the tiles keep their height.

The month name's box is trimmed to cap height and baseline; the tool measures the title and adds
room for Thai marks above it (ธันวาคม, กุมภาพันธ์) and descenders below it (July, พฤศจิกายน), so
the marks keep the 22px outer margin and nothing touches the weekday heads.

## The two looks

- **A**: tiles 64% white, one dark ink `#17121a` for all text (no class colours: one ground, one
  ink); weekday heads on short strips of the same white; the footer panel only as tall as its
  lines; the photo in full colour, showing through the tiles. Worst text contrast measured on
  November: 7.7:1.
- **B**: tiles 16% white, white text, the photo calmed by one flat dark scrim (68%). Worst text
  contrast measured on November: 4.9:1. Under the scrim the photo's printed credit goes grey, so
  B always re-stamps it in the footer.

The reviewer's pick (2 Nov) was B: the photo stays a real background and the white month has the
most punch. A is the second choice. Boonchu decides.

Look and type live in `template.html` (CSS variables at the top). Design rules followed: the
design-taste-frontend house rules (two or three sizes, tight big type, no rules or outlines, no
gradients, no shadows, no blur, no emoji, no tracked caps labels, left-aligned, equal margins).

## Fitting

Text never shrinks below 22px. If a tile overflows, the tool tightens in this order and logs each
step: line height, date number 36px, title 90%, date 32px, title 80%, tile padding. A line that is
too wide for its box wraps in that box only.

## Days already started

The live timetable hides classes that have started. When the month has begun, each day up to
today shows the classes of the same weekday two weeks later (one week, then three or four, if that
day is a moon day or empty), and the command prints which day it borrowed. Two weeks keeps the
Saturday Led Primary rotation (Jamsai / M). Moon days before today come from the same moon formula
the API uses (`bkk-api.js`).

## Photo

Default: `photo.jpg` (Led Intermediate, 31 Oct 2026). Any photo works with `--photo`. A JSON file
with the same name beside it (`photo.json` for `photo.jpg`) can say:

```
{
  "credit": ["AYBKK Shala Bangkok", "Oct 31st Led Intermediate", "Boonchu Tanti"],
  "creditBox": [440, 1780, 895, 1895],
  "pos": { "feed": "50% 0%", "story": "50% 50%" }
}
```

- `creditBox`: where the photo's printed credit is, in photo pixels (left, top, right, bottom).
  If the crop cuts it off, a tile covers it or the Look B scrim darkens it, the credit is re-stamped
  in the footer (or as three lines in spare empty days). With this photo the feed re-stamps it in
  both looks; story A shows the original, story B re-stamps it.
- `pos`: the crop (CSS object-position). Keep faces out of the top band where the month name sits.
- No JSON: no credit is re-stamped unless you pass `--credit "line 1|line 2"`.

## Files

- `render.js`: data, layout plan, rendering (Playwright Chromium, `chromium.launch()`).
- `template.html`: the poster page and its fit loop.
- `fonts/`: self-hosted Inter (variable, from `public/fonts/inter.woff2`) and Noto Sans Thai
  (variable). Never a font CDN.
- `photo.jpg`, `photo.json`: default background.
