# AYBKK Workshop — Claude Code Guide

This is the Mission Control repo for Ashtanga Yoga Bangkok (AYBKK), covering:
- Student tracking for the Huizhou workshop (43 students, March–April 2026)
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
