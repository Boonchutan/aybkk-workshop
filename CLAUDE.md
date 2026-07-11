# CLAUDE.md — AYBKK Workshop

Guidance for Claude when working in this repo (Ashtanga Yoga Bangkok — aybkk.com).

## What this repo is

- **Root**: the AYBKK platform — Express server (`server.js`, port 3000), Neo4j-backed
  student tracking, LINE/Telegram bots, and ~25 student-facing HTML pages in `public/`.
- **`agent-system/`**: Hermes, a self-contained multi-agent builder (own `package.json`,
  SQLite memory, CLI/web/Telegram front-ends). See `agent-system/SPEC.md`.
- A post-write hook runs `scripts/check-inline-js.js` against `public/*.html` — inline
  JS in those pages must parse cleanly.

## Writing voice (student-facing and marketing content)

Anything a student or reader will see — web copy, LINE/Telegram messages, emails,
newsletters, landing pages — should sound like a person from the studio wrote it,
not an AI. Follow these rules:

**Do**
- Write like you talk. Use contractions. Short sentences are fine.
- Start with the point. One idea per sentence.
- Be warm but plain: "See you on the mat Saturday" beats "We look forward to
  welcoming you to our transformative practice."
- Use concrete details: class names, times, prices in THB, teacher names.
- Say things once.

**Don't**
- No sycophantic or filler openers: "Great question!", "We're thrilled to announce".
- No AI-tell vocabulary: delve, robust, seamless, elevate, unlock, transformative
  journey, holistic wellness, underscore, pivotal, "it's worth noting".
- No rule-of-three padding ("strength, flexibility, and mindfulness") unless the
  three things genuinely matter.
- At most one em-dash per paragraph. Prefer commas or a full stop.
- Don't restate the reader's question back at them.
- No walls of headers and bullets in short messages — plain prose reads warmer.

**Tone reference**: friendly teacher at the front desk, not a wellness brand.
Thai and Russian student cohorts exist; keep English simple and translatable.

Code comments, commit messages, and technical docs are exempt — follow normal
engineering conventions there.
