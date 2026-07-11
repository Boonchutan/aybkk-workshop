# Hermes — AYBKK Multi-Agent System — Specification

> A multi-agent AI system that autonomously builds and manages components for
> Ashtanga Yoga Bangkok (aybkk.com). Codename: **Hermes** (the messenger /
> delegator). This document is the source of truth for the system's design.

## 1. Goal

Given a natural-language request ("build a booking system for yoga classes"),
the system decomposes it into subtasks, delegates them to specialized agents
running in parallel, and assembles the results into a **working, runnable
deliverable** on disk — while persisting client/student context across
conversations.

## 2. Core capabilities

| # | Capability | How it is realized |
|---|------------|--------------------|
| 1 | Agent orchestration (parallel specialized agents) | `core/orchestrator.js` runs agents in dependency **layers**; agents within a layer run concurrently via `Promise.all`. |
| 2 | Project generation (description → working code) | `core/planner.js` classifies the request; `templates/generators.js` + agents emit real files; orchestrator writes them to `projects/run-*`. |
| 3 | Memory system (persist context) | `memory/store.js` over SQLite (Node built-in `node:sqlite`): clients, conversations, projects, agent_runs. |
| 4 | No-code interface (NL in → working output) | Three front-ends share one core: **Telegram** (`interfaces/telegram.js`), **web** (`server.js` + `public/index.html`), **CLI** (`cli.js`). |

## 3. Architecture

```
            ┌─────────── front-ends (one core, swappable) ───────────┐
            │   Telegram bot        Web UI            CLI             │
            │   interfaces/         server.js +       cli.js          │
            │   telegram.js         public/index.html                │
            └───────────────────────────┬────────────────────────────┘
                                         │ runTask(description, {clientId})
                                ┌────────▼─────────┐
                                │  Orchestrator     │  core/orchestrator.js
                                │  (Hermes engine)  │
                                └───┬─────┬─────┬───┘
                  plan ────────────┘     │     └──────── remember
            core/planner.js              │            memory/store.js (SQLite)
                                 delegate │
                                 ┌────────▼────────┐
                                 │   Executor      │  core/executor.js
                                 │ template │ claude│  (pluggable backend)
                                 └────────┬────────┘
                                          │ runAgent(agent, ctx)
        ┌───────────────┬─────────────────┼─────────────────┬───────────────┐
   research-agent   content-agent     frontend-agent    backend-agent
        (agents/*.js — each: templateFiles(ctx) + prompt(ctx))
```

### Directory layout

```
agent-system/
├── cli.js                  # CLI front-end
├── server.js               # web front-end (Express)
├── interfaces/telegram.js  # Telegram front-end (grammy)
├── core/
│   ├── orchestrator.js     # plan → delegate (parallel) → assemble → remember
│   ├── planner.js          # request → projectType + subtasks + dependency layers
│   ├── registry.js         # instantiates & looks up agents
│   ├── executor.js         # template / claude generation backends + fallback
│   ├── load-env.js         # zero-dep .env loader
│   └── logger.js
├── agents/                 # research / content / frontend / backend
├── memory/store.js         # SQLite (node:sqlite) persistence
├── templates/generators.js # deterministic blueprint + file bodies
├── projects/               # generated output (run-* gitignored; example committed)
└── public/index.html       # no-code web UI
```

## 4. Orchestration flow

1. **Receive** a task via CLI arg, `POST /api/task`, or a Telegram message.
2. **Plan** (`planner.plan`): classify into a `projectType` (`booking-system` |
   `webpage`) and produce subtasks with `dependsOn` edges, then group into
   parallelizable **layers** (`planner.toLayers`).
3. **Blueprint** (`generators.buildBlueprint`): resolve the concrete data the
   agents build against (studio, class schedule, copy). Client memory context is
   injected here.
4. **Delegate**: for each layer, run every agent concurrently through the
   Executor. Each agent returns `[{ path, content }]`.
5. **Assemble**: write all files to `projects/run-<timestamp>-<slug>/`, plus a
   `MANIFEST.json`.
6. **Remember**: record the project and each agent run in SQLite; if a client is
   attached, log the conversation turn.

## 5. Agents

Each agent (in `agents/`) exposes `templateFiles(ctx)` (offline output) and
`prompt(ctx)` (Claude instructions). They own disjoint file sets so a layer runs
without write collisions.

| Agent | Owns | Depends on |
|-------|------|-----------|
| `research-agent` | `requirements.json` | — |
| `content-agent` | `classes.json` / `content.json` | research |
| `frontend-agent` | `public/index.html`, `public/styles.css` | content |
| `backend-agent` | `server.js`, `package.json`, data files, `README.md` | content |

## 6. Generation backends (the "brains")

`core/executor.js` chooses per run:

- **TemplateExecutor** (default): deterministic, offline, no API key. Each agent
  supplies its own file bodies.
- **ClaudeCodeExecutor** (`HERMES_USE_CLAUDE=1` and `claude` on PATH): each agent
  builds a prompt; Hermes shells out to headless `claude -p ... --output-format
  json` and parses a `[{path, content}]` array. **Any failure (no auth, network,
  bad output) falls back per-agent to the template** — a run never hard-fails.

This is the "Hermes runs Claude Code CLI" path, while keeping the system fully
runnable with zero external dependencies.

## 7. Memory schema (SQLite via `node:sqlite`)

- `clients(id, name, email, line_id, telegram_id, region, notes, created_at, updated_at)`
- `conversations(id, client_id, role, content, created_at)`
- `projects(id, slug, client_id, description, project_type, agents_used, executor, files_json, dir, status, created_at)`
- `agent_runs(id, project_id, agent, subtask, executor, output_summary, created_at)`

A Telegram chat maps to a `clients` row by `telegram_id`; `getClientContext()`
summarizes the client + past projects + recent messages and feeds the planner.

## 8. Proof of concept — yoga class booking system

`npm run demo` (or any "booking"/"class"/"schedule" request) generates a runnable
Express app:

- `GET /api/classes` — Mysore Self-Practice, Led Primary (Sat/Sun), Beginner
  Orientation, with days/time/level/capacity/price.
- `POST /api/bookings` `{ name, email, classId, date }` — validates input and
  enforces **per-class-per-date capacity**, persists to `bookings.json`.
- `GET /api/bookings` — list.
- `public/index.html` — mobile-first schedule + booking form.

Run: `cd projects/<dir> && npm install && node server.js` → http://localhost:5000.

## 9. Interfaces

- **CLI**: `npm run build -- "<task>"`, `--client <name>`, `--list`, `--memory`.
- **Web**: `npm start` → http://localhost:4040 (textarea → result).
- **Telegram**: `npm run hermes` (requires `TELEGRAM_BOT_TOKEN`); `/start`,
  `/projects`, `/whoami`, free text → build.

## 10. Non-goals (future work)

- Bridge to the existing AYBKK platform's Neo4j **Agora/TeamMemory** so Hermes
  agents post artifacts/handoffs alongside Neo/Plato/Nicco. (Integration seam:
  `memory/store.js` could gain a Neo4j adapter; the orchestrator already records
  structured `agent_runs`.)
- Auth, rate-limiting and deployment hardening for generated apps.
- LLM-authored *plans* (currently rule-based; the orchestrator already consumes a
  generic `{ projectType, slug, subtasks }` shape, so a Claude planner can drop in).
