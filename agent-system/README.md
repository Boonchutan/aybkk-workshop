# Hermes — AYBKK Multi-Agent System

A multi-agent AI system that autonomously **builds and manages components** for
Ashtanga Yoga Bangkok (aybkk.com). You describe what you need in natural
language; Hermes breaks it into subtasks, delegates to specialized agents
(research / content / frontend / backend) running in parallel, and assembles a
working, runnable deliverable.

See [`SPEC.md`](./SPEC.md) for the full design.

## Quick start

```bash
cd agent-system
npm install

# Proof of concept: build a yoga class booking system
npm run demo
# → generates projects/run-<timestamp>-yoga-booking-system/

# Run the generated app
cd projects/run-*-yoga-booking-system
npm install && node server.js
# open http://localhost:5000
```

> Requires Node ≥ 22.5. The npm scripts pass `--experimental-sqlite` for you (the
> memory layer uses Node's built-in SQLite — no native build, no extra install).

## Interfaces

All three share the same orchestrator core.

```bash
# CLI
npm run build -- "Build a simple booking system for yoga classes"
npm run build -- "Create a landing page for a 10-day beginner workshop" --client "Jane"
npm run build -- --list          # recent generated projects
npm run build -- --memory        # known clients + remembered context

# Web (no-code textarea)
npm start                        # → http://localhost:4040

# Telegram (Hermes's conversational face)
cp .env.example .env             # add TELEGRAM_BOT_TOKEN from @BotFather
npm run hermes
```

## How it works

```
front-end (Telegram / Web / CLI)
   → Orchestrator: plan → delegate to agents (parallel) → assemble files → remember
                       │
        planner ───────┤ classifies request, builds dependency layers
        executor ──────┤ template (offline)  OR  claude -p  (HERMES_USE_CLAUDE=1)
        agents ────────┘ research · content · frontend · backend
   → projects/run-*/   (working app)        memory/memory.db (SQLite context)
```

## Agent brains: template vs. Claude

- **Default (offline):** deterministic template engine. No API key, runs anywhere.
- **`HERMES_USE_CLAUDE=1`:** agents delegate generation to the local `claude` CLI
  (headless `claude -p`). If Claude is unreachable or returns unusable output, each
  agent falls back to its template automatically — a run never hard-fails.

## Memory

SQLite (`memory/memory.db`, gitignored) persists clients, conversations,
generated projects, and per-agent runs. On Telegram, each chat is a remembered
client thread (`/whoami`, `/projects`).

## Layout

```
core/        orchestrator, planner, registry, executor, logger, load-env
agents/      research / content / frontend / backend
templates/   deterministic blueprint + file generators
memory/      SQLite store
interfaces/  telegram bot
projects/    generated output (example committed; run-* gitignored)
public/      web UI
```
