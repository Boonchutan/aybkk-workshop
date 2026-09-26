# AYBKK Workshop — Claude Code Guide

This is the Mission Control repo for Ashtanga Yoga Bangkok (AYBKK), covering:
- Student tracking for the Huizhou workshop (43 students, March–April 2026)
- Agent monitoring dashboard (Neo4j graph backend)
- Marketing strategy for the China high-ticket cohort (150,000 THB, 10 students, 2026)

**Stack:** Node.js · Neo4j · Railway · LINE Bot · Express

---

## Custom Slash Commands

### `/remotecontrol`
**Purpose:** Positioning strategy session for the China high-ticket cohort.

Use when you need to make any marketing decision about the 150,000 THB China program:
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

### `/cadence`
**Purpose:** Publishing rhythm — sets how often, which slot, which channel, and what gets filmed when. Governs volume and consistency, not words. Two modes: set the cadence (built on the worst week, not the average), or fill a 7/30-day window with slotted, dated posts routed to the skill that writes each one.

Four slots in rotation, one job each: TEACHING (give the technique away completely), STANDARD (what the practice demands — this does the disqualifying), PROOF (the room, accurately told), ASK (one per cycle, maximum).

Capture and publish are separate activities. Film in batches next to teaching; never schedule a post that has to be shot the day it goes out. China and international never share a schedule or a cut — Instagram is blocked in China.

`/hook` writes seconds 0–3, `/story` writes the rest, `/cadence` decides what gets made at all.

**Do not use for:** writing the video, sales copy, DM replies, or shop operations.

### `/riff`
**Purpose:** Natural talking-head riff — turns a real shala moment into a spoken script in a stand-up rhythm: flat open, a side taken twice, stacked specifics, an act-out, a silly rule, one teaching block, and a dry or dark close with a callback. Style studied from comedian Godfrey (@godfreycomic): copy how he talks, never his material.

Humour follows the gervais-deadpan rules: one or two dry jokes, at most one dark line, and the target is never a student, the lineage, or the practice.

Use when a message people don't like hearing needs humour to land (hygiene, lateness, phones), or when a script should sound like talking, not reading.

**Do not use for:** the opening line alone (`/hook`), 4-beat story videos (`/story`), sales copy, or DMs.

### `/shop`
**Purpose:** Shop builder & operations — the full recipe for AYBKK pre-order shops (tee shop live at cn.aybkk.net/shop.html; future: Bangkok price list with classes and courses).

Use when adding/changing shop products, stock, prices, sections, or order operations. Covers the seed mechanism, photo pipeline, China access rules, and every incident fix already built.

**Do not use for:** marketing copy, journals, or orientation pages.

### `/dm`
**Purpose:** DM triage — reads an incoming inquiry about the China cohort, classifies the sender (tourist / beginner / serious), and drafts a response under 60 words that filters or routes. No selling in DMs.

Use when handling Instagram, LINE, or WeChat messages about the 150,000 THB program. Paste the incoming message after the command.

**Do not use for:** existing student questions, general inquiries, or anything unrelated to the China program.

---

## Installed Plugin Skills

### `higgsfield` — AI image / video generation

Registered as a marketplace in `.claude/settings.json` from
[`higgsfield-ai/skills`](https://github.com/higgsfield-ai/skills) (MIT, v0.12.0).
Adds nine `/higgsfield:*` commands.

Needs the Higgsfield CLI installed and authed **on Boonchu's own machine** — a
remote session has no persistent login:

```bash
curl -fsSL https://raw.githubusercontent.com/higgsfield-ai/cli/main/install.sh | sh
higgsfield auth login
```

The ones that earn their place here:

- `/higgsfield:generate` — Reel footage and b-roll, Marketing Studio UGC ads,
  and Virality Predictor scoring on a finished video
- `/higgsfield:soul-id` — train Boonchu's face once, reuse the `reference_id`
- `/higgsfield:product-photoshoot` — workshop tee shots for
  `cn.aybkk.net/shop.html` (`product_shot`, `lifestyle_scene`, `virtual_model_tryout`)
- `/higgsfield:youtube-thumbnail` — vertical Reel and Short covers

**Lineage rule:** never generate footage that depicts practice, adjustment, or
Sharath transmission that did not happen. Product shots, covers, and b-roll only
— nothing a student could read as a record of the lineage. This is the same
constraint `/hook` already enforces on fabricated Sharath quotes.

`/hook` and `/story` still write the words. Higgsfield only makes the pictures.

---

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
- **Inline JS gate:** After every Write/Edit, `scripts/check-inline-js.js` runs automatically (PostToolUse hook). If it fails, fix the JS syntax before proceeding.
- **package-lock.json** is tracked in git (intentional — see `.gitignore`)
- **Obsidian vault:** Boonchu's vault ("1st obsidian vault") syncs with Google Drive. ONE note per topic — never create companion/extra notes (e.g. "X students", "X links") next to an existing note. The Drive connector cannot edit or delete existing files, so to update a vault note, put the complete updated note content in the chat reply for Boonchu to paste in himself.
- **Spoken-word rule (every video script, any skill):** only words a 10-year practitioner says out loud — would a student say it to you after class? Never "chase" or "chasing"; say "work on," "stuck at." Full rule in `/hook` and `/story`.

## AYBKK Bangkok study fees (aybkk.net) — Boonchu asked to remember these, 11 Sep 2026

- 1 month: 9,600 THB
- 3 months: 25,800 THB (8,600 THB/month)
- 6 months: 45,000 THB (7,500 THB/month)
- 12 months: 78,000 THB (6,000 THB/month) — includes 1 free month, so 13 months total

## Environment

Never commit `.env`. Required vars are documented in `check-env.js`.
Run `node check-env.js` to verify all secrets are present before starting the server.

## When Adding Features

- Edit existing files rather than creating new ones
- No comments unless the WHY is non-obvious
- No backwards-compatibility shims for removed code
- Test any student-facing UI change in a browser before marking done
