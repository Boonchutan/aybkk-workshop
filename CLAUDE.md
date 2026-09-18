# AYBKK Workshop — Claude Code Guide

This is the Mission Control repo for Ashtanga Yoga Bangkok (AYBKK), covering:
- Student tracking for the Huizhou workshop (43 students, March–April 2026)
- Agent monitoring dashboard (Neo4j graph backend)
- Marketing and sales for the 30-day in-depth course in Bangkok (180,000 THB, 12 seats per cohort). Was called "the China cohort" until Sep 2026, see Business situation below.

**Stack:** Node.js · Neo4j · Railway · LINE Bot · Express

---

## Custom Slash Commands

### `/remotecontrol`
**Purpose:** Positioning strategy session for the 180,000 THB 30-day course (Chinese and Russian students, taught in Bangkok).

Use when you need to make any marketing decision about the 180,000 THB program:
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

## Business situation — updated by Boonchu, 17 Sep 2026

Read this before any strategy, pricing, marketing, or China-related answer. It overrides older notes in this repo.

**China is closed to Boonchu for at least 2 years (until ~Sep 2028).** Chinese police filed a report that he worked while on visa-free entry. He cannot enter China. The record may stay after 2 years, so do not plan on a clean reopening. Never suggest entering via Hong Kong, Macau, or any workaround. Boonchu should confirm with a Chinese immigration lawyer whether the ban covers HK/Macau and what visa is needed later.

**What made money before the ban:** Boonchu's graduate teachers across China invited him to teach workshops in their cities. Small city WS: 4 to 5 days, 25 to 30 students, 200 to 300K THB. Big city WS: 6 days, 50+ students, 400 to 500K THB. Students followed him city to city. About 9K THB per student per WS. This tour is now impossible. It was the funnel for the high-ticket course, never the road to $1M (12 big WS a year is only 5 to 6M THB).

**The real engine: the 30-day in-depth course in Bangkok, 180,000 THB per student.**
- Cohort 1 (2026): 6 students paid in full (about 170K each after a limited-time pay-early discount) plus 2 returning students finishing an unfinished course at 100K each. About 1.2M THB collected.
- Format moved to one 30-day block in Bangkok (was split across trips before, which is why some students did not finish).
- Cap: 12 seats per cohort. $1M/year net needs roughly 12 full cohorts a year, so the whole game is filling seats.
- Pricing rules agreed 17 Sep 2026: no more discounts. Deadlines get a bonus (e.g. extra shala week), never a price cut. Returning-to-finish students pay more than half price (100K), not less. Next cohort price does not go down; if cohort 1 fills, cohort 2 can go up.

**Strategy: Bangkok becomes Mysore.** Graduates who used to host Boonchu in China now host a 1 to 2 week Bangkok trip for their students at the AYBKK shala, and keep the same host cut. Chinese and Russian citizens enter Thailand visa-free. The trip is the front door to the 180K course. Content on Xiaohongshu and WeChat shows the Bangkok room and students arriving, never "I miss China" or the ban. Graduates are told by phone, one by one, never by public post, and never with the word "banned."

**Money target:** $1M USD/year net, about 35M THB.

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
