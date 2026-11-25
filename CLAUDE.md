# AYBKK Workshop — Claude Code Guide

This is the Mission Control repo for Ashtanga Yoga Bangkok (AYBKK), covering:
- Student tracking for the Huizhou workshop (March–April 2026)
- Agent monitoring dashboard (Neo4j graph backend)
- Marketing strategy for the China high-ticket cohort (180,000 THB, 10 to 12 students, 2026)

**Stack:** Node.js · Neo4j · Railway · LINE Bot · Express

---

## Custom Slash Commands

### `/remotecontrol`
**Purpose:** Positioning strategy session for the China high-ticket cohort.

Use when you need to make any marketing decision about the 180,000 THB China program:
writing the sales page, drafting application criteria, briefing a copywriter,
or testing whether the messaging is defensible vs. competitors.

The teacher holds direct multi-year authorization from the late Sharath Jois
(18-year personal relationship, hosted Sharath in Bangkok 2018 and 2024).
This is the core asset that shapes all positioning — it must never be inflated
and must always be the anchor of the strategy.

**Do not use for:** student management, scheduling, server ops, or daily tasks.

### `/qualify`
**Purpose:** Name-Disqualify-Release framework — writes the qualification section of a high-ticket offer page to filter buyers, not persuade them.

Use when writing or reviewing the "this is not for you" section of the China cohort page, drafting application criteria, or auditing existing copy for false urgency and vague claims.

**Do not use for:** general copywriting, student emails, or operations.

### `/hook`
**Purpose:** Hook writer for Reels and Shorts — generates 5 hook options per topic using distinct psychological levers (authority, contrarian, stakes, question, pattern interrupt), then recommends the strongest one.

Use when writing the opening line of any video content. Designed to stop a 10-year practitioner, not a beginner.

**Do not use for:** captions, carousels, sales copy, or long-form content.

### `/story`
**Purpose:** Reel script builder — structures the full video on the invisible 4-beat skeleton (Hook, Context, Ordeal, Takeaway): 4 beats for 60 seconds, 3 beats for 30. Works in two modes: spoken to camera (writes the lines) or caption-on-screen edit (writes a shot list from existing footage with max-8-word captions).

Use when turning a story or teaching point into a complete Reel script, or planning a caption edit. `/hook` writes seconds 0–3; `/story` writes the rest. Enforces one ordeal per video — a story with two lessons becomes two videos.

**Do not use for:** photo captions, carousels, sales copy, or long-form content.

### `/shop`
**Purpose:** Shop builder & operations — the full recipe for AYBKK pre-order shops (tee shop live at cn.aybkk.net/shop.html; future: Bangkok price list with classes and courses).

Use when adding/changing shop products, stock, prices, sections, or order operations. Covers the seed mechanism, photo pipeline, China access rules, and every incident fix already built.

**Do not use for:** marketing copy, journals, or orientation pages.

### `/dm`
**Purpose:** DM triage — reads an incoming inquiry about the China cohort, classifies the sender (tourist / beginner / serious), and drafts a response under 60 words that filters or routes. No selling in DMs.

Use when handling Instagram, LINE, or WeChat messages about the 180,000 THB program. Paste the incoming message after the command.

**Do not use for:** existing student questions, general inquiries, or anything unrelated to the China program.

### `/design-taste-frontend`
**Purpose:** Third-party design skill (Leonxlnx/taste-skill v2.1.5, MIT) in `.claude/skills/design-taste-frontend/`. Art direction and "looks AI-made" checks for web pages and app screens.

Use when redesigning a public page (aybkk.net, cn.aybkk.net shop, sales pages). Always pass `--keep palette,type`: our fonts are self-hosted because Google Fonts is blocked in China, so ignore any advice to load fonts from a CDN.

**Do not use for:** copy, Reels, or admin screens nobody outside the team sees.

---

## Business direction: The Habit Gap (Boonchu, 4 Oct 2026)

Wellness spending keeps rising; results don't. People don't lack tools, they quit.
**AYBKK sells a habit system: same practice, same time, a teacher who notices when you're gone.**
All writing, advice, Reels and builds follow this. Full brief: `bots/direction.md` on the
`claude/bots-memory` branch.

- Sell the outcome (stronger, calmer, better sleep, aging well) plus the habit, never "poses".
- No equipment race (cold plunge, sauna, reformers): chains win there. We win on habit and teacher.
- Pilates, runners, office-syndrome classes are front doors to Mysore, judged by conversions.
- 180K program pitch: "how to build students who stay for years" (retention).
- Builds: the student profile is the habit system (attendance streak, "see you tomorrow" list,
  12-week proof check, renewal shown with the proof).
- Never use a statistic in public until it is checked against its source.
- **Rule #1, the stakes test (Boonchu, 2 Nov 2026):** every piece of content and every selling line
  (Reels, hooks, captions, carousels, stories, jokes, quotes, learning artifacts, lead replies) first answers
  "Stakes: what happens if this does not work or does not happen?" and "Why care?", one line each.
  For a problem: what happens if nobody solves it. For a benefit or quote: what happens if I don't.
  True stakes only: no health fear, no medical promise, no unchecked number, no shaming. Full text:
  `bots/direction.md` on `claude/bots-memory`.

## Key Facts for Any Claude Instance

- **Server:** `server.js` — main Express app, runs on Railway
- **Database:** Neo4j (credentials in `.env`, never commit)
- **Student pages:** `pages/` — HTML templates for student-facing UI
- **Public assets:** `public/` — CSS, JS, images
- **Bangkok shala:** `bkk-api.js` + `public/bkk.html` (`/book`, `/shala`),
  `bkk-admin.html`, `bkk-door.html` (`/door`, teacher-side check-in).
  Own `bkk_*` Postgres tables — Rezerv's tables are read-only here.
  Fonts are self-hosted in `public/fonts/` (Long Cang for display, IBM Plex Sans
  Thai for text) because the Google Fonts CDN is blocked in China.
- **Door tablet:** `public/bkk-tablet.html` at `/tablet` (an iPad at the door, iPadOS 16 Safari, Guided Access).
  Students tap their own booked tile, "Is this you?", and are checked in. The whole screen follows the language
  button (ไทย, EN, 中文, RU); with none picked it is Thai + English; screens with no buttons (waiting, moon day,
  pairing) show all 4. It holds a door key in the header
  `x-door-key` (localStorage `aybkk_door_key`), never the admin key. Pair it in Admin, Settings, Door tablets:
  the tablet shows a code, staff type it there; one tablet at a time, Unpair ends it. The door key opens only
  `/api/bkk/door/*` and those routes take nothing else: it sees "Name L." and in or not for the seats of today's
  in-person classes whose window is open (an hour before the start until the class ends), each seat as a signed
  handle, and for a student with a profile photo one signed face link (`f`, 320 px), shown in the tile and "Is this
  you?" circles (initials when there is none). That link opens with no key but names the tablet and ends with the
  class: it stops at the class end, at once on Unpair, a staff sign-out or a removed photo. Boonchu asked students to
  add a photo for check-in, so a photo in a profile is shown there (20 Nov 2026); the upload card says so in all 4
  languages. Never a member code, email, phone, pass or price. It cannot open Admin, /door or /teach.
  `/teach` can check in, undo, add someone with a started pass and take off its own add (today, in person,
  each saying who in `bkk_bookings.checkin_via`/`checkin_by`); wrong teacher passcodes lock an address out, but a
  browser that signed in before sends its `X-Teacher-Known` mark and is counted on its own (the shala wifi is one address).
- **Student agreement:** the text is `CONSENT_TEXT` in `bkk-api.js` (v2 since 25 Nov 2026: v1 word for word but for the privacy notice's photo sentence, which names Cloudflare; v1 stays for those who signed it; v1: EN and TH "draft 3", Thai says เค้า for he/she/they, never เขา; ZH and RU need a native check), hashes pinned in `test/bkk-api.test.js` (new words are a new version), served at `GET /api/bkk/consent`; signatures go to append-only `bkk_consents`, and a copy is emailed (a checkout's once paid). Its privacy notice names every service personal data goes to (inbox.js, team-brief.js and server.js too, OpenRouter for the staff AI summary of a journal): a new one means new text. Admin, Settings, Student agreement holds the switch `consent_mode`: off as shipped (nothing changes), ask (checkout asks before the gateway), require (a student's own booking asks too); while on, `/bkk` and `/orientation-bkk.html` (the old waiver form) 302 to `/book` (a database that does not answer in 1.5 s reads as off there and on `/policy`). It cannot leave off without all 4 languages and the privacy notice's legal name, address and email. Payments, staff, /teach, imports and check-ins are never refused. The door key and `/tablet` get nothing of it; `/teach` gets only `signed` and `under20` as true/false.
- **Passes on the student page and the desk note (24 Nov 2026):** `GET /api/bkk/me/:code` never lists a void pass,
  and marks one whose last day has gone `ended` (a running freeze has moved its end out already); My account shows live passes, with
  ended ones folded under "Past passes". The desk note is `bkk_members.desk_note` (+ `desk_note_at`), one box on the
  Admin student card, saved by `POST /api/bkk/admin/members/:code/note` (admin key, a stale `at` is 409): staff only,
  never on /me, the door, /teach, emails or exports.
- **Photo costs (Cloudinary free plan):** never change a `PHOTO_SIZES` or `FACE_SIZES` string in `bkk-api.js` (a new string re-bills every photo opened again). Download goes through the signed `/api/bkk/photo/<id>.<sig>/AYBKK-photo.jpg` (the stored JPEG, no copy made); staff `/photos` shows Drive thumbnails for Drive imports (the Drive id never reaches a student); `photos_daily_cap` (default 100, 0 = none, Admin, Settings) limits new photos a day while Cloudinary is 90% used or more.
- **IDCN#3 teacher training (24 Nov 2026):** Machi's `idcn-api.js` app (`idc_*` tables, `/idcn3/<slug>`, admin
  `public/idcn-admin.html`), now tied to AYBKK accounts: `idc_students.member_id` links a student to their
  `bkk_members` profile (folded profiles followed), so the student's own AYBKK sign-in (`x-member-code`) opens their page
  and only theirs; the old passcode still works. `/idcn3` is the one cohort link (sends a signed-in student to their page,
  else bkk's email sign-in); My account shows an IDCN card. Admin: bulk add (code or email, never a second account),
  "Link AYBKK account", a 7-day login link per student (bkk's `staffSigninLink`), the calendar pasted as Boonchu's table
  (`idc_days`, `idc_sessions` from "#N"/"SN" in a slot), assignments per session and one teacher comment per student per
  day; hand-ins are per session only (the old daily video box is gone, Boonchu, 25 Nov 2026; earlier videos still
  list under Assignments & notes). `start_date` is per student (alumni start 2027-01-24, day 14, session #13); `terms_arranged` opens the course
  without the sign flow. The staff note (`cohort_note`) never reaches the student. The roster, calendar text and links
  are entered in Admin, never in git.
- **Class photos:** new ones go to Cloudflare R2 when `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
  and `R2_BUCKET` are all set (`lib/r2.js`); until then everything is on Cloudinary as before. Once a photo is in R2
  the switch is one-way: with a variable missing, or the code rolled back past this change, R2 photos do not show
  (`/ph` answers 503, Save fails) until the variables are back. The privacy notice names Cloudflare since v2.
  `bkk_photos.store` says where a photo is; in R2 it is `cls/<class date>/<r2_key>/v.jpg` (long side 2560 px, upright,
  no metadata) and `t.webp` (the 600 px tile). Students get `/ph/<id>.<sig>/t.webp` and `v.jpg` (signed, never
  ending, relative so cn.aybkk.net works too), sent `public, max-age=86400, s-maxage=86400` so Cloudflare's edge keeps
  them: a deleted photo can still show for up to a day. Admin, Settings, "Photo storage": Test R2, photo counts, and
  Start/Stop for moving the older Cloudinary photos (about 3 a minute, after Test R2 passes, each checked in R2 before
  it switches; state in `bkk_settings` `photo_r2_move`; a server start stops it, Start goes on). Copies to remove
  (a moved photo's Cloudinary copy a day after its move, R2 copies that could not be deleted) wait in
  `bkk_photo_orphans`. With R2 on, `photos_daily_cap` does not apply.
  **Cloudinary exit (25 Nov 2026, the account closes 29 Nov):** Photo storage offers "Fast move (before Cloudinary
  closes)": faces first, then 4 photos at a time a quarter second apart, photos with no Drive copy first, from Drive's
  2048 px copy or the stored Cloudinary JPEG (never the Drive original); a JPEG of at most 2560 px with no EXIF turn goes
  to R2 as it is, metadata out. A fast move keeps every Cloudinary copy (`not_before` infinity in `bkk_photo_orphans` and
  `bkk_face_orphans`) until staff press "Remove the Cloudinary copies of moved photos" (Boonchu's call). Faces with R2
  on are `bkk_members.photo_id` `r2face/<ref>` (`face/<ref>/l|d|s.jpg`, 600, 320, 160 px, a centre square, no face
  finder), under the same ref, so every face link handed out (door tablet too) keeps working; the face route stays
  `private, max-age` and never a public cache. A normal Start moves the faces too. The save, face and `/ph` links are
  signed with `PHOTO_LINK_SECRET`, else `CLOUDINARY_API_SECRET`: never remove `CLOUDINARY_API_SECRET` unless
  `PHOTO_LINK_SECRET` holds the same value, or every photo and face link stops. The `PHOTO_SIZES`/`FACE_SIZES` strings
  never change (a new one re-bills every photo).
- **Inbox:** `inbox.js` keeps 1:1 chats from the LINE Official Account (`/line/webhook`) and
  Instagram/Facebook DMs and comments (`/meta/webhook`) in `aybkk_inbox` for 90 days.
  Machi reads `GET /api/inbox` (header `x-inbox-key`). Env: `INBOX_KEY`; `LINE_CHANNEL_SECRET`
  (LINE signature); `META_APP_SECRET`, `META_VERIFY_TOKEN`, optional `META_PAGE_TOKEN` (names).
  Optional `ANTHROPIC_API_KEY` sorts each message on arrival and sends hot ones to Boonchu's
  Telegram (`INBOX_AI_MODEL`, default Opus 5.5; `INBOX_AI_DAILY_CAP`, default 150 calls).
  **Real fit** on an In-Depth application is worked out at save time by the one `REAL_FIT` rule in `inbox.js`
  (now: Primary yes, Mysore and led classes yes, all 30 days on the Chinese list, 4+ mornings, 2+ years; not
  teaching, not the video). The weekly counts (Admin "Landing pages, by week", `/api/bkk/admin/landing-weeks`,
  rows in `bkk_start_events`) hold no personal data, outlive the 90-day purge and stay staff only. A `?src=` or
  `?for=` code names a channel, post or headline, never a person (no names, phones or IDs in a link).
- **Team brief:** `team-brief.js`, sent by the main AYBKK LINE OA (`LINE_CHANNEL_ACCESS_TOKEN`) to the one staff group accepted in Admin. Groups it hears of on `/line/webhook` (signed with `LINE_CHANNEL_SECRET`, `team.takeLine(req)` beside the inbox) or that staff add by ID wait until accepted; nothing is saved by itself and leaving the saved group clears it. On its first start it clears, once per database (`team_line_sender`), the group and switches the LINE account used before left under the same keys. Morning brief Tue to Fri 05:00, Mon 05:30, Sat and Sun 06:00 (Bangkok), 20:00 day summary, each off until switched on. Admin, Settings, "LINE team brief" shows the secret and token (whose account), the last signed event, the group, waiting groups, add by ID, the switches and tomorrow's preview. Never a reply in a group. A group push counts once per member against the main account's monthly quota, shared with messages to students. Admin routes `/api/bkk/admin/team/*` (status, preview, send, brief, group) and `/api/bkk/admin/inbox`, all with `x-bkk-key`.
- **Tee pre-order (pickup in China, 24 Nov 2026):** `bkk-api.js` (`bkk_tee_drops`, `bkk_tee_stock`, `bkk_tee_orders`,
  `bkk_tee_lines`; money rows are `bkk_orders.kind='tee'`), the `#tees` section of `public/bkk.html` (`/tees`, the
  order link `cn.aybkk.net/book#tee=<token>`), Admin "Tees" tab. Paid through PaySolutions like a package, never a
  member, pass or the class agreement; its own notice `TEE_NOTICE` (EN, ZH needs a native check). Stock is worked out
  from the order lines under a drop lock, never counted down; an unpaid order holds its tees for `hold_min`, can be
  paid from its link while held and let go by it ("Change my order"). Telegram lines carry the ref and tee count,
  never the buyer. Contact details go `purge_days` after hand-over (7 after a cancel or a lapsed hold), never early
  while the money could still turn paid; a problem note or a wrong-amount payment keeps them at most 60 days longer
  (the notice says so). Finish waits for live holds; a payment after Finish is oversold (refund).
- **Rezerv import from the command line:** `scripts/rezerv-import.js` (`check`, `write --expect`, `plan`, `run-all`) is the admin page's "Move everything from Rezerv" box without the uploads. It runs the page's own parsing code, taken out of `public/bkk-admin.html` by name, so renaming one of those functions stops the tool until it is brought in line.
  It prints counts and reason codes only (names go to `--details`, mode 0600) and sends `x-bkk-key` only when `BKK_ADMIN_KEY` is set. Test: `test/rezerv-import-cli.test.js`.
  Rows go only to `https://aybkk.net`, `https://my.aybkk.com` or a test server on this machine. `run-all <dir>` only looks; `run-all <dir> --save` saves, and stops at the first file a person must see. Rezerv exports and details files name students and this repo is public: keep them outside the repo (or in the git-ignored `rezerv-export/`); the tool refuses a path git would take.
- **Student lists are private:** student lists and any count of students, members, bookings or practice at the shala are private: never in public pages, posts, Reels, captions, PR text or the public repo, and every route that lists students needs the admin key (`staffOnly` in `lib/staff-key.js`, header `X-Bkk-Key`; team pages load `/staff-key.js`).
  Two narrow exceptions: the door key (`x-door-key`) sees only "Name L." (and the face link) for today's open
  in-person classes, and a teacher passcode (`x-teacher-key`) sees the teacher's list (`/api/bkk/teacher/*`: students
  by a sealed ref with the small face link, no member codes, except the student view opened by a code the teacher typed).
  Every other route that lists students still needs the admin key.
  Files that name students (workshop rosters, QR cards, print files, journals, class photos) live in the git-ignored
  `private-data/` on a computer and in `/data/private` on the Railway volume. Rosters reach the server by
  `PUT /api/bkk/admin/rosters/<city>` (`x-bkk-key`), never by git.
- **No secrets in code:** passwords, keys and tokens come from `.env` / Railway variables only, never a typed-in
  fallback. `test/repo-hygiene.test.js` (CI: `repo-hygiene.yml`, every push) fails on a password, key or token in a
  tracked file, and on a tracked file that names students.
- **Inline JS gate:** After every Write/Edit, `scripts/check-inline-js.js` runs automatically (PostToolUse hook). If it fails, fix the JS syntax before proceeding.
- **package-lock.json** is tracked in git (intentional — see `.gitignore`)
- **Obsidian vault:** Boonchu's vault ("1st obsidian vault") syncs with Google Drive. ONE note per topic — never create companion/extra notes (e.g. "X students", "X links") next to an existing note. The Drive connector cannot edit or delete existing files, so to update a vault note, put the complete updated note content in the chat reply for Boonchu to paste in himself.

## AYBKK bot team (Claude routines on the Max plan, set up 28 Sep 2026)

Replaces the Hermes agents that billed OpenRouter per message. Each run is a fresh cloud
session on Boonchu's Claude Max plan (no API billing), model Opus 5.5 (Boonchu's choice).
Manage at claude.ai/code/routines. Neo (coder) is not a routine: it is Claude Code itself.
This repo is attached to each routine (Boonchu set it in the routines UI), which gives push access.

| Bot (short name) | Job | Daily (Bangkok) | Trigger id |
|---|---|---|---|
| Carnegie (Carne) | 180K lead list, reply and follow-up drafts | 06:37 | `trig_01NXpBtYBpHnsD6j9CWYB3si` |
| Plato | daily story-series Reel: his life or safe news → Indian myth or history → behavior → asana; hooks, script, EN/TH/ZH/RU captions, XHS title | 06:43 | `trig_018F4MLqhbuRom8kUVe4ARph` |
| Machiavelli (Machi) | chief of staff: morning brief at 07:08, check-ins at 13:08 and 19:08 that chase open decisions (one-tap choice, countdown, default), deliver due reminders and show the score (wins vs the gap, no pep talk) | 07:08, 13:08, 19:08 | `trig_01Awdy7kZdUgdu46mhfETVCT` |

- Memory and team chat live on the `claude/bots-memory` data branch: `bots/notebook/<bot>.md`,
  `bots/posts/<date>-<bot>.md`, `bots/board.md`. Never merge that branch into main.
- This repo is public, so Carnegie's lead table is stored only as
  `bots/notebook/carnegie-leads.md.enc` (openssl AES-256). The key lives in the Carnegie
  routine prompt and with Boonchu, never in this repo. Posts carry counts, never names.
- Boonchu talks to the team in two permanent sessions: "💬 Machi · AYBKK team chat"
  (`session_01QRPtAqCjY8bjNihjxsdNLn`: money, leads, decisions, reminders, wins) and
  "✍️ Plato · AYBKK content chat" (`session_01EpfSiAFErEs2e4MYfzK1F9`: Reels, carousels,
  captions, Postiz). They are his control panel for the connectors on his account; anything
  public or paid needs his "go" on that exact item. Machi's notebook has "Reminders" and
  "Wins" sections that the chat writes and the 3x-daily runs read. Scheduled runs are separate
  "⚡ AYBKK bot: …" sessions that don't show in the normal session list; find them under
  each routine at claude.ai/code/routines.
- Hard rules live in each routine prompt: drafts only, no logins to Meta, WeChat, Xiaohongshu,
  TikTok, LINE or Rezerv, no spending, never a price in a DM draft. Plato also never touches
  politics, war, royalty, government leaders, religious conflict or tragedies with victims:
  the business runs in China, Russia and Thailand.
- The routines hold no connectors. Giving a bot Gmail, Calendar or Postiz is done in the
  routines UI and needs Boonchu's yes first.

## AYBKK Bangkok study fees (aybkk.net), check here before quoting a price

From 12 Nov 2026, every price + 7% VAT (posters: bots/media/2026-11-06-price-poster on claude/bots-memory):
- 1 month 9,600 · 3 months 19,500 (6,500/month; Boonchu, 6 Nov 2026) · 6 months 34,200 (5,700/month, teacher's pick) · 12 months 63,600 (5,300/month, 12 months only; Boonchu, 11 Nov 2026: was 32,000 and 59,900)
- Drop-in 1,500 · 8 classes 7,600, use within 2 months (Boonchu, 9 Nov 2026)
- One price for everyone: no returning-student or promo price. The Sharathji promotion (Duo, Rookie Pack, Reset & Restart, Back to the Beat) ended on 11 Nov 2026.
- Unlimited (monthly) members: no minimum, no set 4 days a week (Boonchu, 9 Nov 2026). Thai: "ไม่กำหนด 4 วันต่ออาทิตย์ มาฝึกตามเวลาที่สะดวก", never "ไม่ต้องมา...".

Passes sold before 12 Nov keep what was bought: 12 months sold before 21 Oct keep their 13 months, Rezerv's old 45,000 THB 6-month passes are honored, and 10-class packs stay valid.

## Environment

Never commit `.env`. Required vars are documented in `check-env.js`.
Run `node check-env.js` to verify all secrets are present before starting the server.

## When Adding Features

- Edit existing files rather than creating new ones
- No comments unless the WHY is non-obvious
- No backwards-compatibility shims for removed code
- Test any student-facing UI change in a browser before marking done
