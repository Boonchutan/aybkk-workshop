# Weekly Transmission — implementation plan

Spec: docs/superpowers/specs/2026-07-02-weekly-transmission-design.md

## Phase A — C0 plumbing (unblocks everything)
1. Port student.html self-heal from local commit 564a189 onto origin/main-based branch (init() looks up student by id when `name` param missing).
2. Stable-domain guard: wherever a journal/QR link is STORED or ENCODED (api/student-journal.js `siteOrigin` call sites, server.js orientation journalLink), if the request host is a `trycloudflare.com` domain, substitute `https://aybkk-ashtanga.up.railway.app`. Browsing via tunnel unaffected.
3. `scripts/fix-journal-links.js`: rewrite any stored `journalLink` containing trycloudflare to the stable domain (dry-run flag, count report).
4. Acceptance: `node --check` all touched files; bare `student.html?id=` link for a June-cohort student opens the returning-student flow on production from a phone; zero tunnel-domain links remain in Neo4j.

## Phase B — server endpoints (C3 + C4 backend)
1. `GET /api/journal/weekly-recap?workshop=&weekOf=` → {checkedIn, practiced4plus, photos} from check-in nodes.
2. Transmission tracking in Neo4j: `(:Transmission {week, city, sentAt, confirmedAt})`.
   - `GET /api/transmission/confirm?week=&city=&key=` (shared secret env TRANSMISSION_KEY; friendly HTML "confirmed" response)
   - `GET /api/transmission/status?key=` → streak + per-week record JSON.
3. Extend `POST /api/journal/checkin` to accept `daysPracticed`, `bodyFeel`, `weekOf` (additive, backward compatible).
4. Acceptance: endpoints exercised against local stub/dev, `node --check`, deployed 200s.

## Phase C — C1 tap check-in (student.html)
1. Focus card "本周练习重点 · From Boonchu" at top of returning-student view; source: current week focus (from transmission config API or latest From Boonchu content fallback).
2. Tap check-in UI: days chips 0-6, bodyFeel 3-state, optional photo (existing upload), optional line; one POST.
3. All four languages (zh/en/th/ru) for new labels.
4. Acceptance: stub-server click-through test like the Hefei page test; existing writing flow still reachable.

## Phase D — C2/C5 drafting agent + delivery + reminders
1. `scripts/transmission/` on the M1 (this repo):
   - `cities.json` (cohort tag → WeChat group label, language, active)
   - `curriculum.json` (12-week rotating focus, zh + en seed from Boonchu's WS material)
   - `draft-pack.js`: pulls recap stats + quotes + curriculum; calls `claude` CLI headless with pinned prompt to draft per-city packs (Chinese/Russian/EN-TH); falls back to template on any failure; first-Sunday-of-month adds voice-note shortlist (warmth score query via API).
   - `send-to-boonchu.js`: Telegram sendMessage (existing TELEGRAM_BOT_TOKEN + BOONCHU_CHAT_ID); LINE push when BOONCHU_LINE_UID configured; includes per-city confirm links.
   - `nudge.js`: reads /api/transmission/status; if unconfirmed cities, one nudge on both channels.
2. launchd: `com.aybkk.transmission-draft.plist` (Sun 16:30 Asia/Bangkok) and `com.aybkk.transmission-nudge.plist` (Mon 09:00), installed to ~/Library/LaunchAgents and loaded.
3. Acceptance: dry-run produces packs and delivers to Boonchu's Telegram labeled TEST; launchctl list shows both jobs; nudge fires correctly against a fake unconfirmed week.

## Phase E — ship + Transmission #1
1. Push branch → main → Railway deploy; verify production acceptance items.
2. Run generator in TEST mode → real Telegram delivery to Boonchu = re-onboarding edition draft (Xichang, Maoming, Suzhou, Guangzhou) for his word-by-word review; he sends when ready.
3. Add hefei to cities.json (active after Jul 20).
4. Dismiss the now-superseded "port self-heal" task chip; update memory.

Out of scope: everything in spec Non-goals; LINE activates when BOONCHU_LINE_UID captured (bot "myid" helper if absent).
