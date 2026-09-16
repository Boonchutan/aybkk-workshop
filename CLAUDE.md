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

### `/shop`
**Purpose:** Shop builder & operations — the full recipe for AYBKK pre-order shops (tee shop live at cn.aybkk.net/shop.html; future: Bangkok price list with classes and courses).

Use when adding/changing shop products, stock, prices, sections, or order operations. Covers the seed mechanism, photo pipeline, China access rules, and every incident fix already built.

**Do not use for:** marketing copy, journals, or orientation pages.

### `/dm`
**Purpose:** DM triage — reads an incoming inquiry about the China cohort, classifies the sender (tourist / beginner / serious), and drafts a response under 60 words that filters or routes. No selling in DMs.

Use when handling Instagram, LINE, or WeChat messages about the 150,000 THB program. Paste the incoming message after the command.

**Do not use for:** existing student questions, general inquiries, or anything unrelated to the China program.

### `/trend`
**Purpose:** Talk of the Town — a separate account that posts 3 times a day about what the world is searching (Google Trends, 100% global), @wealth-style 10-slide carousels (Anton headline over a Kling-generated photoreal image, one hidden fact per slide) with an Edward Sturm caption: what is trending, why, and the one thing most people don't know.

Use when running or tuning the daily trend batch. The skill holds the selection rubric, the voice, the fetcher (`scripts/trends-fetch.js`), the renderers (`scripts/trend-card.js`, `scripts/trend-carousel.js`), image hosting (branch `trend-cards`) and the Postiz steps. A Routine ("Talk of the Town — daily trend batch") runs it every morning inside the "Postiz Social media" session, which holds the repo, push access and Postiz; say "pause the trend routine" to stop it.

**Do not use for:** anything posted to AYBKK or Boonchu's personal channels.

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
- **Mind Stash:** Boonchu's psychology study app — a spaced-repetition card deck (91 cards, 13 topics: decision-making, value, attention, memory, persuasion, storytelling structure, deadpan humor, manipulation-spotting), published as a Claude artifact: https://claude.ai/code/artifact/194e1b0e-ea87-4166-a08c-2491baa69a44. The complete written-out lessons live in his Obsidian vault as 13 subject notes ("Psychology - …", "Persuasion - …", "Storytelling - …", "Humour - …") in the Boonchu Framework folder; the app-usage guide is the vault note "Mind Stash - Psychology Study App". When Boonchu says "mind stash", he means this system.

## Environment

Never commit `.env`. Required vars are documented in `check-env.js`.
Run `node check-env.js` to verify all secrets are present before starting the server.

## When Adding Features

- Edit existing files rather than creating new ones
- No comments unless the WHY is non-obvious
- No backwards-compatibility shims for removed code
- Test any student-facing UI change in a browser before marking done
