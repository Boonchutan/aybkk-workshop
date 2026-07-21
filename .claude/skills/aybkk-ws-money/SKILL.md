---
name: aybkk-ws-money
description: Verify and reconcile an AYBKK workshop money ledger (Lisa-style pasted table or incremental updates), compute all detail, and auto-append the result to the workshop's Obsidian "Roster & Money" note. Use whenever Boonchu pastes a WS ledger, shares new student payments, asks "is this correct", or shares a host money transfer.
---

# AYBKK WS Money Calculation

Every WS ledger goes through the same pipeline: parse → verify → diff → totals → Obsidian → memory. Never report numbers you haven't recomputed yourself in python.

## 1 · Rate card (AYBKK Workshop Policy, Jan 2026)

Per-class RMB: Led Primary 410 · Led P&I 490 · Led Intermediate 550 · Mysore 550 · Workshop 710 · Mini WS 550 · Lecture 450 · **Conference/Q&A FREE, never charged**.

Discounts (INTERNAL, never shown to clients): base = sum of class rates. Normal price ≈ 10% off base · Earlybird ≈ 25% off · Past-attendee 5% off · never stack earlybird + past-attendee. Common bundles: weekend (2 mysore + 2 WS) 2,200 · any 3 days ≈ 3,470.

Caveat: pricing varies per workshop — the WS price poster and the operator's explicit composition win over this card. Hefei 2026 reference tiers: regular full 4,100 · hot price 3,690 · in-depth CN2 3,321.

## 2 · Verify (python, always)

- Sum every row; check the ledger's own subtotals and grand total.
- Check each partial-package row against the rate card composition (e.g. 2×550=1,100 mysore pair; 2,200+490 then −5% = 2,555).
- Diff against the previous ledger version (agent memory has the last verified total; the vault note has the history). Every yuan of delta must decompose into named row changes. Flag anything that doesn't.
- Flag: numbering gaps (a missing # usually means a student added in another channel — check the check-in roster `hefei-students.json`-style file in `~/mission-control` before calling it an error), price mismatches, students in the ledger missing from the check-in system and vice versa.

## 3 · Transfer / split math (when a host transfer exists)

- Convert THB↔CNY at current market ≈ and at the implied rate; state which base makes the claimed percentage true.
- Always show: 50/50 remainder AND policy 60:40 (60% AYBKK / 40% host, host covers travel + accommodation + USD 60/day meals + venue + ads + translator).
- Standing rule: split and second-transfer date must exist in writing in the WeChat thread. Push until they do.

## 4 · Put in Obsidian (write-only workaround)

The vault is TCC-blocked for direct file access (fix: Full Disk Access for the host app). Append via Obsidian URI instead — this WORKS today:

```python
import subprocess, urllib.parse
q = urllib.parse.quote
url = (f"obsidian://new?vault={q('1st obsidian vault')}&file={q(NOTE_PATH)}"
       f"&append=true&silent=true&content={q(content_md)}")
subprocess.run(["open", url])
```

- Known path: `03 Programs & Workshops/Workshops/2026/WS Hefei 2026 - Support/Hefei WS 2026 - Roster & Money`. New WS notes follow the same pattern (see the aybkk-ws-detail skill).
- For any note whose exact path is unknown: ask Boonchu for right-click → Copy Obsidian URL. NEVER guess a path (duplicate-note risk; vault rule is one fact, one home).
- Append a dated `## Update <date> · ledger vN` section: total · paid count · new/changed rows table · tier breakdown · transfer math · open items. No read-back is possible; ask him to glance at the note.

## 4b · Transfer receipts archive (ALWAYS, for every receipt or bank screenshot)

Every transfer document Boonchu shares (BOC submission receipt, K PLUS / SCB arrival screenshot) gets archived to the WS's `<WS> - Transfer Receipts` note in the Support folder:

- Transcribe EVERY field: amount, date, beneficiary + account + SWIFT, payer account, reference number, remittance notes, and for arrivals the net amount and fee.
- Maintain an arrival-tracking table: sent vs arrived vs fee. Submission receipt ≠ arrival (the Jul 14, 2026 Hefei THB 480,000 was submitted successfully and then blocked by the China-side bank — always confirm arrival in the receiving app).
- Photos: if the image exists as a file path (drag-dropped in a local session), copy it into the vault attachments folder and embed with `![[...]]`. If the image arrived only in chat (remote/phone session), leave a "*(drop photo here)*" placeholder under its heading and tell Boonchu to drag the photo in.
- Link the receipts note from Roster & Money and vice versa.

## 5 · Memory + report

- Update the WS payments memory file and MEMORY.md index line with the new verified total.
- Report format: verdict first ("Lisa's math is clean, total ¥X"), then flags, then open money items. No em dashes anywhere. Final numbers in bold. Never expose discount percentages in anything client-facing.

## Environment check (do this FIRST)

Obsidian and the vault live on Boonchu's Mac (`/Users/alfredoagent`). Test: does `open "obsidian://..."` make sense here — is this that Mac? If NOT (cloud session, other machine): still do ALL calculation and verification, but instead of the Obsidian append, write the ready-to-append markdown section to `HANDOFF-obsidian.md` at the repo root (commit it) AND print it in the reply, telling Boonchu the Mac agent (or he) must push it into the vault. NEVER claim the vault was updated from an environment that cannot reach it.
