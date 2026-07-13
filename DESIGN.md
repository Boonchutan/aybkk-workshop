# DESIGN.md — AYBKK design language v2: "The theme is the shirt"

Supersedes v1 (beech wood + carved clay + Fraunces/Spectral). v1's Bangkok palette
survives as the home theme. Confirmed by Boonchu 2026-07-09.

## Theme overview

Each city workshop's pages wear that city's tour tee. Four color roles carry every
surface; only `--shirt` (and its dependents) change per city. The visual language is
Boonchu's hand ink: white strokes on the shirt color, handwritten notes, stickers,
hand-drawn frames, wall grain.

Registers: orientation pages are posters (drenched hero in `--shirt`, content on paper
below the fold). Journal and tools are notebooks (paper surfaces, ink text, shirt color
only for headers, dates, buttons, active states, streaks).

## Color roles

| Token | Role | Recipe (OKLCH) |
|---|---|---|
| `--shirt` | City identity: heroes, buttons, active states | L 0.42-0.65, C 0.14-0.20 |
| `--wall` | Page background, room tone behind everything | L ~0.94, C 0.01-0.04, neighbor hue |
| `--chalk` | Ink/art on the shirt color, never #fff | ~oklch(0.96 0.008 85) `#f6f2ea` |
| `--ink` | Reading text on paper, never #000 | L ~0.24, C ~0.02, tinted toward shirt |
| `--paper` | Card/reading surface | L ~0.965 warm |
| `--mark` | Art color on LIGHT shirts (default = chalk; dark ink on light shirts) | per city |

Contrast rules: chalk on shirt >= 4.5:1; ink on paper >= 12:1. Light shirts (Suzhou,
Zhuhai) set `--mark` to a dark ink instead of chalk.

## City themes (`html[data-ws="..."]`)

| data-ws | City | --shirt | --wall | Notes |
|---|---|---|---|---|
| `home` (default) | Bangkok 曼谷 | `#7d6442` walnut | `#f1ede3` cream | v1 wood lives here |
| `hefei` | Hefei 合肥 | `#7429ac` royal purple | `#e7eef5` pale sky | real tee; firefly art |
| `suzhou` | Suzhou 苏州 | `#e3aa1a` sun yellow | `#e8f0e0` pale bamboo | real tee; mark = `#2c2214` |
| `chengdu` | Chengdu 成都 | `#1f8a70` bamboo jade | `#f6e9e6` pale lotus | proposal |
| `xichang` | Xichang 西昌 | `#c1531d` launch orange | `#e6eef5` pale sky | proposal |
| `maoming` | Maoming 茂名 | `#5c4030` tour brown | `#e4efe9` sea foam | real tee |
| `zhuhai` | Zhuhai 珠海 | `#b9c6d6` blue-gray | `#f4f1ea` shell | real tee; mark = purple `#4a2d8f` (refine against attached design) |
| `gz` | Guangzhou 广州 | `#a8322f` red | `#eaf0ec` gray jade | proposal |
| `huizhou` | Huizhou 惠州 | `#cf6d15` mandarin | `#eef2e2` pale leaf | proposal |
| `russia` | Russia (SPB/Moscow) | `#a9c8e4` ice blue | `#f2f1ec` snow | proposal; mark = `#27516f` |

Adding a city = one block in tokens.css. Never hardcode city colors in pages.

## Typography

Load via Google China mirror `fonts.googleapis.cn` (v1 lesson, keep), `display=swap`,
system fallbacks first-class so nothing blocks in mainland China.

| Role | Family | Fallbacks |
|---|---|---|
| Display EN/RU (headings, buttons, labels) | Shantell Sans 700/800 | Marker Felt, Chalkboard SE, sans-serif |
| Display ZH | ZCOOL KuaiLe | PingFang SC, Noto Sans SC |
| Handwriting EN (margin notes, quotes, dates) | Caveat 600 | Bradley Hand, cursive |
| Handwriting ZH | Ma Shan Zheng | Kaiti SC, cursive |
| Body all langs | Nunito 400/700 | -apple-system, PingFang SC, Noto Sans SC, Noto Sans Thai |

Scale: modular, >= 1.25 ratio between steps; body 16-17px, line-height 1.6-1.7;
zh body never in display faces. Uppercase labels get 0.14-0.22em letter-spacing.

## Components

- **Sticker**: chalk fill, 2.5px ink outline, pill or blob radius, 3px offset solid
  shadow, 1-2deg tilt. For badges, chips, the crowned bird, time slots.
- **Hand-drawn frame**: 2.5px ink border with uneven corner radii
  (e.g. `14px 18px 15px 17px / 17px 14px 18px 15px`), paper fill, small solid offset
  shadow. Replaces all neumorphic card shadows.
- **Marker underline / circle**: inline SVG stroke in `--shirt` under emphasized words.
  Replaces colored pills and side accents.
- **Tape card**: paper note with a translucent tape strip (shirt-tinted), slight
  rotation. Journal entries, pinned photos.
- **Tally streak**: hand tally strokes, every fifth stroke in `--shirt`. Practice
  streaks, weekly reports.
- **Buttons**: shirt-color fill, chalk display text, sticker shadow; active = pressed
  (translate 2px, shadow collapses). Secondary = paper with ink frame.
- **Hero art**: per-city tee art as inline SVG (chalk strokes on shirt), draw-on via
  stroke-dashoffset once on load, 1.6-1.8s ease-out. Fallback: crowned bird + lettering.

## Layout

- Phone-first, max-width 480px content column (keep from v1); proposal/report pages 760px.
- Spacing scale from v1 kept: 4/8/12/16/24/32/48/64.
- Wall grain: fixed fractal-noise SVG overlay at 4-6% opacity (9% on dark surfaces).
- No nested cards; sections separated by space and hand rules, not boxes in boxes.

## Motion

- Ease: `cubic-bezier(0.16, 1, 0.3, 1)`; durations 140/240/420ms; draw-on 1.7s.
- Allowed: draw-on strokes, sticker tilt on hover, gentle fade-rise staggers on load.
- Banned: bounce/elastic, layout-property animation, scroll-jacking.
- `prefers-reduced-motion: reduce` turns all of it off (keep v1 block).

## Migration notes

- 30 of 44 public pages already read tokens.css: re-skin = tokens v2 + component pass.
- 14 stray pages hand-roll palettes and must join the token system: aybkk-redesign,
  calendar, dashboard, index, journal, lookup, quiz, send-links, student-ru,
  teacher-assessment, updog-3d, updog-teach, updog-viewer, walkin.
  (calendar keeps its glass system for now by decision; revisit later.)
- Care: calendar.html is an installable PWA (manifest theme-color `#eceff4`,
  planner icons); QR endpoints (`/api/journal/qr/{id}`) render server-side, keep QR
  contrast dark-on-light; bkk-students has an external qrserver fallback; share-card
  and student-report render images/print, check both after re-theme.
- Bangkok QR cards (public/qr-cards) already match the home theme; per-city cards
  (e.g. Hefei) should read their city block from tokens v2.
