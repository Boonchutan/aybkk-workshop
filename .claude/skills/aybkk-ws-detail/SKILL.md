---
name: aybkk-ws-detail
description: Set up a new AYBKK workshop end to end — create the Obsidian notes (hub with dates, calendar, host detail, schedule, flights, presentation, class content, plus Roster & Money) and the live orientation page + check-in roster on cn.aybkk.net. Use when Boonchu starts planning a workshop in a new city or says "set up the WS".
---

# AYBKK WS Detail Setup

One WS = one Obsidian home + one live web presence. Build both in the same run.

## 1 · Gather (ask only for what's missing)

City & dates · host (name, WeChat, deal/split, what host covers) · daily schedule (sessions: led/mysore/workshop/lecture/Q&A per day) · flights (there + back, per the visa day-count rules in the huizhou-ws-2026 memory: run BOTH rolling and static-at-entry 90/180 checks for China trips) · price poster / tiers · presentation topics and class content plan.

## 2 · Obsidian structure (per feedback-ws-vault-structure: one fact, one home)

Create under `03 Programs & Workshops/Workshops/<year>/`:

1. **Hub note** `WS <City> <Year>` — sections: Dates & Calendar (day-by-day table) · Host (contact, deal, who covers what) · Schedule (session grid with times) · Flights (numbers, dates, booking refs) · Presentation (outline) · Class Content (per-day plan). Link to the other notes.
2. **`WS <City> <Year> - Support/<City or WS name> WS <Year> - Roster & Money`** — student table + payment reconciliation home (the aybkk-ws-money skill appends here).
3. **`WS <City> <Year> - Support/... — Orientation Links`** — per-student orientation/door-pass links once the roster exists.

Vault is write-only (TCC block; fix = Full Disk Access). Create notes via Obsidian URI:

```python
import subprocess, urllib.parse
q = urllib.parse.quote
url = (f"obsidian://new?vault={q('1st obsidian vault')}&file={q(path)}"
       f"&silent=true&content={q(md)}")   # add &append=true only for existing notes
subprocess.run(["open", url])
```

Creating NEW notes at new paths is safe; appending to existing notes requires the exact path (ask for Copy Obsidian URL if unknown). Confirm with Boonchu the folder name before the first note of a new WS. Optionally mirror the calendar into Google Calendar via MCP when the connector is authorized.

## 3 · Orientation page + check-in system (repo `~/mission-control`, GitHub Boonchutan/aybkk-workshop, Railway deploys main)

- **Orientation page**: copy the closest existing `public/orientation-<city>.html` (hefei/zhuhai are current patterns) and adapt: city name, dates, schedule, venue, host contact, theme colors. Add a short route (like `/zh`) if the server has that pattern. Chinese first for China workshops.
- **Roster + cards**: clone the Hefei pattern — `private-data/<city>-students.json` → `generate-<city>-roster.js` → `private-data/rosters/<city>.json` + QR cards in `private-data/qr-cards/<city>/` → render cards. `private-data/` is git-ignored: rosters, cards and print files name students and the repo is public, so they never go in git (`test/repo-hygiene.test.js` fails a push that adds one). Code scheme: Full block positional 001-0NN first in the file, then lettered blocks (D = drop-in/partial, H = hosts, T = test); explicit `code` field wins; students get `slug` short links (`/s/<name>`) as digital door passes; journal IDs are uuid v5 of name (never rename a student casually — it orphans the journal; use `aka` aliases).
- **Deploy**: NEVER commit from the local main checkout (stale + dirty). Always: `git fetch origin && git worktree add /tmp/<ws>-deploy origin/main --detach`, edit there, run the generator with `NODE_PATH=~/mission-control/node_modules BASE_URL=https://cn.aybkk.net`, scoped `git add` of only the intended files (the orientation page and the generator, never a roster or card), push `HEAD:main`, remove the worktree. The roster goes to the server by upload, not git: `curl -X PUT -H "x-bkk-key: $BKK_ADMIN_KEY" -H "Content-Type: application/json" --data-binary @private-data/rosters/<city>.json https://aybkk.net/api/bkk/admin/rosters/<city>` (it lands on the Railway volume in `/data/private/rosters/`).
- **Verify live** (never skip): `curl -s -o /dev/null -w "%{http_code} %{redirect_url}" https://cn.aybkk.net/s/<CODE>` for new codes + fetch the live roster JSON with the `x-bkk-key` header and check every student arrived (the count is private: say it to Boonchu in chat only, never in a commit, PR or post). cn.aybkk.net is the China domain (Cloudflare cache: bust with `?v=`); my.aybkk.com is the fallback. Never print or send tunnel/platform URLs (Suzhou lesson).

## 4 · Close the loop

- Write per-student orientation links (`https://cn.aybkk.net/orientation-<city>.html?s=<CODE>`) into the Orientation Links note and offer them formatted for WeChat.
- Create/update the WS memory file (dates, host, deal, system state, open items) + MEMORY.md index.
- Report: what's live (with URLs), what's in the vault, what's still missing from section 1.

## Environment check (do this FIRST)

Obsidian lives on Boonchu's Mac (`/Users/alfredoagent`). In a cloud session or any other machine: do the repo work (orientation page, roster, deploy) normally, but write the Obsidian note contents to `private-data/HANDOFF-obsidian.md` (git-ignored: the Roster & Money note names students and money, and the repo is public; never commit it) and print them, for the Mac agent or Boonchu to push into the vault. NEVER claim vault notes were created from an environment that cannot reach Obsidian.
