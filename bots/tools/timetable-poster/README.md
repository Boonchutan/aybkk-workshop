# Timetable poster

Next month's AYBKK timetable as images: Instagram feed (1080x1350), story (1080x1920),
the feed image for LINE, and the tall image for the aybkk.net booking page (above the site's
calendar; visitors can save it), in English and Thai. Images only; posting needs Boonchu's go.

## The monthly command

On the last afternoon of the month, from this folder:

```
node render.js --all --outdir <your scratchpad>/poster-out
```

It reads the live timetable (https://aybkk.net/api/bkk/schedule?days=62, no key), renders next
month, and writes ten images plus `schedule.json` (the timetable it used) into
`<outdir>/<YYYY-MM>/`: `aybkk-<YYYY-MM>-<en|th>-<feed|story>-<A|B>.png` for Instagram and LINE,
`aybkk-<YYYY-MM>-<en|th>-tall-C.png` for the booking page, and the booking page's web copies
`web/<YYYY-MM>-<en|th>.jpg` (1080 wide, JPEG 82, sRGB, no metadata; about 270 KB; made with
ImageMagick `convert`). The command prints each web copy's size.
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

Open every image (all ten, the two web copies and the preview) and check it before sending it to him.
The command prints `ok` or `CHECK` per image; fix any CHECK first. A CHECK names the box whose text
does not fit, or says the month name or the header is on a face (see `faces` under "Photo" below).

### Onto the website (aybkk.net booking page)

The booking page (`public/bkk.html` in the aybkk-workshop repo, `posterBox`) shows the poster of the
month on screen above its calendar, in the reader's language (else English), and visitors can open
or save it. It reads two things from the aybkk-workshop repo:

- the images: `public/img/timetable/<YYYY-MM>-<en|th>.jpg`, the web copies exactly as made, e.g.
  from the repo root `mkdir -p public/img/timetable && cp <outdir>/2026-11/web/2026-11-*.jpg public/img/timetable/`
- the list of months that have one: `public/img/timetable/posters.json`, month to languages:
  `{ "2026-11": ["en", "th"], "2026-12": ["en", "th"] }`. A month missing from it shows no poster
  (and the page never breaks for want of one). Add next month on the last afternoon, so it shows
  when someone pages forward; drop a month (and its two JPEGs) once it is over.

Use the web copies, never the PNGs (1.5 MB each). The page sets the image to 1080x1620; if a new
photo gives the tall image another shape, change `width`/`height` in `posterBox` to match (the
image still shows right, but the page would jump while it loads). It goes live with a commit to
the aybkk-workshop repo and a deploy, which needs Boonchu's go like any public change.

### Which look

For feed and story Boonchu has not picked yet, so `--all` renders both looks, and **A is the
default** for a single feed or story image (`DEFAULT_LOOK` in `render.js`). Once he picks, add
`--look A` or `--look B` to the monthly command (and set `DEFAULT_LOOK` to his pick); the tall
booking-page images (look C) are still made. `--all --look C` makes only the tall ones.
The tall size uses **look C** (his brief, 2 Nov), its default: see "The tall size" below.

### A new photo

```
node render.js --all --outdir <your scratchpad>/poster-out --photo /path/to/new.jpg
```

Any JPEG, PNG or WebP, ideally portrait and at least 1080 wide. The tall image takes the photo's own
shape (a 2:3 photo makes 1080x1620). Before the first run, put a `new.json` beside `new.jpg`
(same name) with where its printed credit is, every face, and the crops; the keys are under
"Photo" below. To find the boxes, open the photo in any viewer that shows pixel positions, or
draw your guesses on it and look:
`convert new.jpg -fill none -stroke lime -strokewidth 5 -draw "rectangle 96,414 240,545" check.png`.
Then render and open every image. The faces keep the white month name off them on the tall
image and make the command print CHECK wherever a month name or header still lands on one.

## One image

```
node render.js --month 2026-11 --lang en|th --size feed|story|tall --look A|B|C [--title up|down] [--photo p] [--data file] --out file.png
```

`--data` takes a saved copy of the schedule JSON instead of fetching it. `--today 2026-11-10`
pretends it is that Bangkok date (testing). `.jpg` in `--out` writes a JPEG. `--title` is for the
tall size (see "The tall size"). `--help` lists all.

The command prints one line per image: `ok` or `CHECK` (some text did not fit, the box is named;
or the month name or header is on a face), the title size, the logo size (tall), any fit steps it
took and how far the month name moved up. Exit code 1 means a CHECK or a WARNING: look before using it.

## What is on it

- Big: the month and year, Inter Black (Boonchu's "thicker Helvetica"), one line, full width.
  Thai: Thai month and Buddhist year (พฤศจิกายน 2569) in Noto Sans Thai Black.
- Middle: the date number in each tile.
- Small (one style, 22px Inter SemiBold, Thai in Noto Sans Thai SemiBold): weekday heads,
  class lines, footer.
- One white see-through tile per date, Sunday first. Each tile: date, then per class type its
  short name (Mysore / Primary / Inter., Thai มายซอร์, as on the booking page), start times,
  teachers in time order ("5:30 7:30" then "M, Boonchu" means M at 5:30). Shala classes only.
  Class names keep the booking page colours (Boonchu, 2 Nov): Mysore red, Primary green, Inter. blue, darkened on the bright boxes (A, C: #A3122A, #155A18, #2E3AA8, bold), light on B (#FC838B, #8BFC83, #9AA2FF).
  Moon days: date, "New moon" or "Full moon" (EN) and a dark or a full yellow moon (Boonchu, 2 Nov), or the booking page's own words in TH: "จันทร์ดับ"
  (new moon) / "จันทร์เต็มดวง" (full moon). No classes on them. No tile for days outside the month.
- Footer, in the month's empty days when there is room, else a band at the bottom:
  "Book at aybkk.net · LINE @aybkk", "S31 Sukhumvit Hotel, 8th floor, Sukhumvit 31", and
  "Led classes also live on Zoom" only when the month has online classes. TH: "จองที่ aybkk.net ·
  LINE @aybkk", "โรงแรม S31 ชั้น 8 สุขุมวิท 31" (the site calls it โรงแรม S31), "คลาส Led
  ถ่ายทอดสดทาง Zoom ด้วย".
- No prices, no em dashes, teacher names in Latin letters.

Six-week months (the 1st on a Friday or Saturday) put the month name in the empty first-week
days instead of above the grid, so the tiles keep their height.

## The tall size

For the aybkk.net booking page. 1080 wide, as tall as the photo's own shape (1080x1620 for a 2:3
photo): the whole photo, no crop. Look C by default (the only look made for it by `--all`).
The calendar (weekday heads, tiles, footer) is exactly the feed's, 22px from the bottom and sides,
same tile sizes, gaps and type, so it matches the feed image of the same look in size, only lower.
The month name is the feed's size and sits right above the weekday heads, as in the feed, unless
its letters would land on a face listed in the photo's JSON: then it moves up, same size, just
clear of the faces (6px), and the command prints `month name <n>px up, off a face`. The heads and
tiles never move. `--title down` keeps it right above the heads anyway and prints CHECK.
Everything above the month name is the header.

With `photo.jpg`, the A-feed spot puts the month name across the upside-down man's face on the
left and the seated student's on the far right (photo y 414 to 545). So on November it is 64px up
(EN) and 92px up (TH, where the tail of ฤ reaches down), and the two faces show in open photo
between the month name and the heads. Boonchu's words were "keep the size and format from A
english", so this is his call. The November files with the name right above the heads (on the
faces) were made on 2 Nov next to the others, in `alt/` (with `compare-up-down.png`, side by side)
under the building session's `poster-out/2026-11/`; `--title down` remakes them. If he picks those,
add `--title down` to the monthly command (it then prints CHECK every month with this photo).

The logo is 200px at most, less when the month name leaves less room above it (photo top to the
month name's highest mark, minus the 22px margin and a 24px gap). Under 120px the command prints
CHECK (header): use another photo. November: 181px (EN), 153px (TH).

Six-week months (January 2027, May 2027) put the month name in the empty first days, as in the
feed; there it is part of Look A's block, so it is in A's dark ink, not white, and gets no scrim.
With `photo.jpg` it lands on the face of the woman in the black top in January 2027 and the command
prints CHECK: that month needs another photo or Boonchu's OK.

The month name's box is trimmed to cap height and baseline; the tool measures the title and adds
room for Thai marks above it (ธันวาคม, กุมภาพันธ์) and descenders below it (July, พฤศจิกายน), so
the marks keep the 22px outer margin and nothing touches the weekday heads.

## The looks

- **A**: tiles 64% white, one dark ink `#17121a` for all text (no class colours: one ground, one
  ink); weekday heads on short strips of the same white; the footer panel only as tall as its
  lines; the photo in full colour, showing through the tiles. Worst text contrast measured on
  November: 7.7:1.
- **B**: tiles 16% white, white text, the photo calmed by one flat dark scrim (68%). Worst text
  contrast measured on November: 4.9:1. Under the scrim the photo's printed credit goes grey, so
  B always re-stamps it in the footer.

- **C** (tall only, for the booking page; Boonchu, 2 Nov: "move the calendar down to bottom so it
  looks like space as header" and "use the whole tall photo but keep the size and format from A
  english (with big white november 2026)"): Look A's calendar block, unchanged (same strips,
  tiles, ink, sizes, gaps, margins, footer, credit rule), at the bottom, with the month name in
  white, the feed's size, above it (moved up off any face, see "The tall size"). The photo above
  is the header: the AYBKK logo in white (`logo-white.png`, up to 200px) with "AYBKK" (date-number
  size, Inter Black) and "Ashtanga Bangkok, Thailand" (TH: "อัษฎางคโยคะ กรุงเทพฯ ประเทศไทย", the
  booking page's word) in white. Three text sizes in all. One flat dark scrim (60%) sits behind
  the header and the month name only and fades out over the 24px below the month name's lowest
  ink (never lower than the weekday heads), so the strips and tiles are exactly as bright as in A.
  Worst white-text contrast measured on November (title up): 5.8:1 EN and 5.3:1 TH (month name),
  7.0:1 (small line).

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
  "faces": [[96, 414, 240, 545], [1166, 418, 1234, 524], ...],
  "pos": { "feed": "50% 0%", "story": "50% 50%" }
}
```

All boxes are in the photo's own pixels, [left, top, right, bottom] (the photo is 1333x2000 here,
whatever size it ends up on the poster).

- `creditBox`: where the photo's printed credit is, in photo pixels (left, top, right, bottom).
  If the crop cuts it off, a tile covers it or the Look B scrim darkens it, the credit is re-stamped
  in the footer (or as three lines in spare empty days). With this photo the feed re-stamps it in
  both looks; story A shows the original, story B re-stamps it. When a box (tile, footer, title,
  header) covers it, the see-through box would leave the printed letters half showing next to the
  re-stamp, so the tool paints them out of the photo first (thin bright strokes and their shadow,
  filled from the pixels around them) and prints "printed credit under a box painted out". With
  this photo that happens on the tall images, where the footer sits on the printed credit.
- `faces`: every face in the photo, head and hair. On every size and look the command prints
  CHECK when a letter of the month name (its actual ink, Thai marks and tails included) comes within
  6px of one, or the header (logo, words) does; on the tall size the month name first moves up off
  them (see "The tall size"). Faces under the see-through tiles are fine, as in Look A. List them
  all, not only the ones near the month name today: a month with a longer name or six weeks puts
  the name somewhere else. `photo.jpg` lists six.
- `pos`: the crop (CSS object-position), per size (`feed`, `story`, `tall`; tall has no crop
  unless the photo's height is not a whole number of pixels at 1080 wide). On feed and story it is
  the way to move a face out from under the month name.
- No JSON: no credit is re-stamped unless you pass `--credit "line 1|line 2"`, and no face is
  checked, so look at the month name yourself.

## Files

- `render.js`: data, layout plan, rendering (Playwright Chromium, `chromium.launch()`).
- `template.html`: the poster page and its fit loop.
- `fonts/`: self-hosted Inter (variable, from `public/fonts/inter.woff2`) and Noto Sans Thai
  (variable). Never a font CDN.
- `photo.jpg`, `photo.json`: default background, its printed credit and its six faces.
- `logo-white.png`: the AYBKK seal (`public/aybkk-logo.jpg` in the main repo) in white on
  transparent, 400px, trimmed to the ring, for look C. Remake it from the main repo with:
  `convert aybkk-logo.jpg -colorspace Gray -negate -level 22%,58% \( -size 1276x1280 xc:black
  -fill white -draw "circle 638,638 638,74" \) -compose multiply -composite a.png;
  convert -size 1276x1280 xc:white a.png -alpha off -compose copy-opacity -composite -trim +repage
  -filter Lanczos -resize 400x400 -channel RGB -evaluate set 100% +channel PNG32:logo-white.png`
