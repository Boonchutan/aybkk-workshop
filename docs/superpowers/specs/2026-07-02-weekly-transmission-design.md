# Weekly Transmission: post-workshop student warmth loop

Date: 2026-07-02
Status: Approved by Boonchu (design conversation, this date)
Owner: Boonchu (ritual) + agents (drafting, reminders, product)

## Problem and evidence

The student journal retains nobody once the teacher leaves the room. Production data pulled 2026-07-02 from `/api/journal/students` (274 students):

| Cohort | Students | Check-ins ever | Active last 30d |
|---|---|---|---|
| Xichang WS Jun 2026 | 53 | 0 | 0 |
| Maoming WS Jun 2026 | 27 | 1 | 1 |
| Suzhou WS Jun 2026 | 8 | 0 | 0 |
| Guangzhou WS Apr 2026 | 30 | 95 | 2 |
| SPB + Moscow May 2026 | 44 | 216 | 4 |
| Bangkok/local | ~55 | 229 | ~10 |

Half of all students never wrote one entry. 6 of 274 touched the journal in the last week.

Two stacked causes:

1. **Plumbing.** QR cards and links generated while the server was reached through the rotating Cloudflare tunnel embed a tunnel domain that dies on every server restart. The bare-link self-heal fix (local commit 564a189) never reached production because Railway deploys were frozen Jun 25 to Jul 2 (credit exhaustion). June cohorts likely hit dead links on first touch.
2. **Psychology.** A private journal asks for solo writing with no one watching. The competition is WeChat and Xiaohongshu, which give effortless belonging. Students return to be seen by the teacher and the cohort, not to reread their own writing.

Strategic context: pipeline warmth is the primary goal (Boonchu, this conversation). Grads feed repeat workshops, city hosting, referrals, and the China High-Ticket program (180,000 THB, 12 seats). Practice adherence and teaching data are byproducts that benefit the student. Xiaohongshu as top-of-funnel is already decided in AYBKK Growth OS and is a separate project, out of scope here.

## Design decisions (locked)

- Student-facing channel: existing per-city WeChat groups. Boonchu is in all of them. No WeChat automation ever (account ban risk); every student-facing word is pasted by Boonchu's hand.
- Operating model: agent drafts, Boonchu sends. Target 15 minutes per week.
- Reminder channel to Boonchu: **both Telegram and LINE** push notifications (existing bots). Confirming on either silences the other's nudge.
- Cadence: weekly, Sunday 17:00 Asia/Bangkok (18:00 China). One soft pipeline line at most once per month. No daily anything.
- The journal flips direction: teacher speaks weekly, student taps back in ten seconds. Writing becomes optional everywhere.

## Components

### C0. Phase-0 plumbing fixes (prerequisite, ships first)

- Deploy the student.html self-heal from local commit 564a189 onto origin/main (already flagged as task chip "Port lost journal self-heal fix to origin/main").
- Journal links and QR codes must always embed the stable domain `https://aybkk-ashtanga.up.railway.app`, never the tunnel domain. Concretely: `siteOrigin(req)` in api/student-journal.js and the equivalent in server.js get a hard override via env var `PUBLIC_BASE_URL`; the tunnel remains usable for browsing but is never written into stored links or QR images.
- Verification script that walks all stored `journalLink`s in Neo4j, flags any embedding a `trycloudflare.com` domain, and rewrites them to the stable domain.
- Acceptance: opening a bare `student.html?id=<x>` link for a June-cohort student shows their returning-student check-in, on production, from a phone.

### C1. Ten-second check-in (student.html)

The journal page for a returning student opens with, in order:

1. **This week's focus card**: "本周练习重点 · From Boonchu" with the current week's focus text (source: C2 pack), falling back to the existing From Boonchu / Practice Focus content when no weekly focus exists.
2. **Tap check-in**: days practiced this week (chips 0 to 6), one body-feeling tap (`light` 轻盈 / `normal` 正常 / `tired` 疲惫), optional photo, optional one-line note. One POST to the existing `/api/journal/checkin` route, extended with fields `daysPracticed` (int), `bodyFeel` (enum), `weekOf` (ISO date of the Monday). No new schema migration beyond added node properties.
3. Existing journal history below, unchanged.

Language follows the student's stored `lang` as today. Existing writing-based flow remains reachable but is no longer the front door.

### C2. Weekly pack generator (the drafting agent)

Runs unattended every Sunday 16:30 Asia/Bangkok, before the 17:00 delivery.

- **Inputs**: per-city cohort stats for the previous week (C4 endpoint), class-summary notes and From Boonchu content already in Neo4j, the quotes bank (data/quotes.json), a 12-week rotating focus curriculum seeded from Boonchu's workshop material (breath, bandha, backbend, LBH, drishti, and so on; stored as a JSON file in the repo so Boonchu can edit it), and the list of active city groups (config file, one entry per cohort with group name and language).
- **Output**: one paste-ready message per city, in Chinese (Russian for the Russia cohorts, English/Thai for Bangkok), max ~120 CJK characters of teaching plus the focus line, the recap line (C3), and the journal reminder line with the lookup URL for lost links. Plus a header block for Boonchu listing which groups to paste into.
- **Runtime**: default is a launchd job on the M1 invoking `claude` CLI headless with a pinned prompt file (same pattern as com.aybkk.daily-lesson.plist); if the machine is asleep the job fires on next wake (launchd default). A scheduled Claude cloud routine is the designated upgrade path once its secret handling for the two bot tokens is confirmed. This choice is revisited in the implementation plan, not silently.
- **Failure mode**: if drafting fails or inputs are unreachable, send a minimal template pack (focus of the week from the curriculum file + standard reminder lines) rather than sending nothing. The reminder to Boonchu always fires.

### C3. Recap stats

Small addition to the journal API: `GET /api/journal/weekly-recap?workshop=<tag>&weekOf=<date>` returning counts (checked in, practiced 4+ days, photos shared). Used by C2 for the recap line ("西昌的同学们，上周有14位练习了4天以上") and rendered nowhere else in V1. Consented photos only, never auto-published anywhere.

### C4. Delivery and reminders to Boonchu

- Sunday 17:00: pack sent to Boonchu via Telegram bot (existing `TELEGRAM_BOT_TOKEN` + `BOONCHU_CHAT_ID`) and LINE push (existing LINE channel; Boonchu's LINE userId captured once during setup). Message ends with a one-tap confirm link per city: `GET /api/transmission/confirm?week=<w>&city=<c>&key=<secret>`.
- Monday 09:00: if any city unconfirmed, one nudge on both channels listing only the missing cities. No further nudges; the streak view keeps honesty.
- `GET /api/transmission/status` returns the streak and per-week confirmation record (Boonchu-facing, linked from the nudge, guarded by the same shared secret as the confirm links).

### C5. Monthly voice-note shortlist (the money list)

First Sunday of each month the pack includes a second section for Boonchu only: 10 to 20 warmest grads ranked by a warmth score = recency and frequency of check-ins + workshop attendance count + goal keywords (depth, teacher training, program interest) from orientation records. Each entry: name, city, one personal hook line drawn from their own words and recent activity. Boonchu sends 3 to 5 personal WeChat voice notes during that week; the following month's list marks who got one so nobody is skipped or doubled. No message content is generated for these; hooks only. Personal must stay personal.

## Data flow

Neo4j (students, check-ins, summaries) → C3 recap endpoint → C2 drafting agent (+ curriculum file + quotes) → Telegram + LINE push to Boonchu → Boonchu pastes into WeChat city groups → students open journal link → C1 tap check-in → Neo4j → next week's recap. Confirmation taps → C4 status. Monthly: Neo4j → warmth score → shortlist in pack → voice notes → (manually) warmer pipeline.

## Error handling

- Drafting agent failure: fallback template pack, reminder still fires (C2).
- Stats endpoint down: pack ships without recap line.
- Boonchu doesn't confirm: exactly one nudge; streak records the miss.
- Student link lost: every pack includes the lookup page URL; lookup.html already exists.
- Server restart / tunnel rotation: irrelevant to stored links after C0.

## Testing

- Dry-run mode: `TRANSMISSION_DRY_RUN=1` sends packs only to Boonchu labeled TEST, never anything else (there is no student-send path at all, by design; the test is about content and delivery timing).
- C0 acceptance test from a real phone on the June-cohort links.
- C1: extend the existing local stub-server flow test to cover the tap check-in POST.
- First live transmission is the re-onboarding edition to Xichang, Maoming, Suzhou, Guangzhou groups ("your journal is fixed, here is this week's focus"), reviewed word by word by Boonchu before sending.

## Rollout calendar

| When | What |
|---|---|
| Week of Jul 6 | C0 fixes deployed and verified; Transmission #1 (re-onboarding) drafted, approved, sent |
| Every Sunday 17:00 | Pack lands on Telegram + LINE; Boonchu pastes; confirms |
| Monday 09:00 | Nudge only if unconfirmed cities remain |
| First Sunday monthly | Voice-note shortlist included |
| Jul 20 | Hefei WS ends; hefei cohort added to the city config and joins the rotation |

## Success metrics (90 days)

- Transmission streak: unbroken (the system's own confirmation record is the source of truth).
- Weekly check-in rate among China grads: 15 to 25 percent (baseline today: ~2 percent weekly, ~7 percent monthly).
- Voice notes: 3 to 5 sent per month, logged.
- Trailing indicators watched, not targeted: repeat-workshop signups from grads, program applications citing city cohorts.

## Non-goals

- No community feed, no student-visible leaderboards beyond the one recap line, no daily messages, no WeChat API automation, no new mobile app, no Xiaohongshu work in this project (separate brainstorm).
