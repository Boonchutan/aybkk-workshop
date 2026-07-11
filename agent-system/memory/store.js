'use strict';

/**
 * Persistent memory for Hermes, backed by SQLite via Node's built-in
 * `node:sqlite` module (no native build, no npm install). Requires Node >= 22.5
 * and the `--experimental-sqlite` flag (wired into the npm scripts).
 *
 * Stores client/student context, conversation threads, generated projects, and
 * per-agent run records so context survives across CLI calls, web requests, and
 * Telegram restarts.
 */

const path = require('path');
const fs = require('fs');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
  throw new Error(
    'node:sqlite is unavailable. Run with Node >= 22.5 and the --experimental-sqlite flag ' +
      '(use the npm scripts: `npm run build`, `npm start`, `npm run hermes`). Original: ' +
      err.message
  );
}

const DB_PATH = process.env.HERMES_DB_PATH || path.join(__dirname, 'memory.db');

function nowISO() {
  return new Date().toISOString();
}

class Memory {
  constructor(dbPath = DB_PATH) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this._migrate();
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS clients (
        id          TEXT PRIMARY KEY,
        name        TEXT,
        email       TEXT,
        line_id     TEXT,
        telegram_id TEXT UNIQUE,
        region      TEXT,
        notes       TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id  TEXT NOT NULL,
        role       TEXT NOT NULL,           -- 'user' | 'hermes'
        content    TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        slug        TEXT NOT NULL,
        client_id   TEXT,
        description TEXT NOT NULL,
        project_type TEXT,
        agents_used TEXT,
        executor    TEXT,
        files_json  TEXT,
        dir         TEXT,
        status      TEXT NOT NULL DEFAULT 'completed',
        created_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_runs (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id     INTEGER,
        agent          TEXT NOT NULL,
        subtask        TEXT,
        executor       TEXT,
        output_summary TEXT,
        created_at     TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conv_client ON conversations(client_id);
      CREATE INDEX IF NOT EXISTS idx_proj_client ON projects(client_id);
      CREATE INDEX IF NOT EXISTS idx_runs_project ON agent_runs(project_id);
    `);
  }

  // --- Clients -------------------------------------------------------------

  /**
   * Insert or update a client by a stable identity. Identity precedence:
   * explicit id > telegram_id > generated from name.
   */
  upsertClient(fields = {}) {
    const ts = nowISO();
    let existing = null;
    if (fields.id) existing = this.getClient(fields.id);
    else if (fields.telegram_id) existing = this.getClientByTelegram(fields.telegram_id);
    else if (fields.name) existing = this.getClientByName(fields.name);

    if (existing) {
      const merged = { ...existing, ...clean(fields), updated_at: ts };
      this.db
        .prepare(
          `UPDATE clients SET name=?, email=?, line_id=?, telegram_id=?, region=?, notes=?, updated_at=?
           WHERE id=?`
        )
        .run(
          merged.name ?? null,
          merged.email ?? null,
          merged.line_id ?? null,
          merged.telegram_id ?? null,
          merged.region ?? null,
          merged.notes ?? null,
          ts,
          existing.id
        );
      return this.getClient(existing.id);
    }

    const id = fields.id || `c_${(fields.name || 'client').toLowerCase().replace(/\W+/g, '-')}_${Date.now().toString(36)}`;
    this.db
      .prepare(
        `INSERT INTO clients (id, name, email, line_id, telegram_id, region, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        fields.name ?? null,
        fields.email ?? null,
        fields.line_id ?? null,
        fields.telegram_id ?? null,
        fields.region ?? null,
        fields.notes ?? null,
        ts,
        ts
      );
    return this.getClient(id);
  }

  getClient(id) {
    return this.db.prepare('SELECT * FROM clients WHERE id=?').get(id) || null;
  }

  getClientByTelegram(telegramId) {
    return this.db.prepare('SELECT * FROM clients WHERE telegram_id=?').get(String(telegramId)) || null;
  }

  getClientByName(name) {
    return this.db.prepare('SELECT * FROM clients WHERE name=? COLLATE NOCASE').get(name) || null;
  }

  listClients() {
    return this.db.prepare('SELECT * FROM clients ORDER BY updated_at DESC').all();
  }

  // --- Conversations -------------------------------------------------------

  addConversation(clientId, role, content) {
    this.db
      .prepare('INSERT INTO conversations (client_id, role, content, created_at) VALUES (?, ?, ?, ?)')
      .run(clientId, role, content, nowISO());
  }

  recentConversation(clientId, limit = 10) {
    return this.db
      .prepare('SELECT role, content, created_at FROM conversations WHERE client_id=? ORDER BY id DESC LIMIT ?')
      .all(clientId, limit)
      .reverse();
  }

  /**
   * Compact context string fed to the planner so generation is informed by who
   * is asking and what they've built before.
   */
  getClientContext(clientId) {
    const client = this.getClient(clientId);
    if (!client) return '';
    const projects = this.projectsForClient(clientId);
    const convo = this.recentConversation(clientId, 6);
    const parts = [];
    parts.push(`Client: ${client.name || client.id}${client.region ? ` (${client.region})` : ''}`);
    if (client.notes) parts.push(`Notes: ${client.notes}`);
    if (projects.length) {
      parts.push(`Previously built: ${projects.map((p) => p.slug).join(', ')}`);
    }
    if (convo.length) {
      parts.push('Recent messages:\n' + convo.map((c) => `  ${c.role}: ${c.content}`).join('\n'));
    }
    return parts.join('\n');
  }

  // --- Projects & agent runs ----------------------------------------------

  recordProject(p) {
    const res = this.db
      .prepare(
        `INSERT INTO projects (slug, client_id, description, project_type, agents_used, executor, files_json, dir, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        p.slug,
        p.clientId ?? null,
        p.description,
        p.projectType ?? null,
        JSON.stringify(p.agentsUsed ?? []),
        p.executor ?? null,
        JSON.stringify(p.files ?? []),
        p.dir ?? null,
        p.status ?? 'completed',
        nowISO()
      );
    return Number(res.lastInsertRowid);
  }

  recordAgentRun(projectId, run) {
    this.db
      .prepare(
        `INSERT INTO agent_runs (project_id, agent, subtask, executor, output_summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(projectId, run.agent, run.subtask ?? null, run.executor ?? null, run.summary ?? null, nowISO());
  }

  listProjects(limit = 20) {
    return this.db.prepare('SELECT * FROM projects ORDER BY id DESC LIMIT ?').all(limit);
  }

  projectsForClient(clientId, limit = 20) {
    return this.db
      .prepare('SELECT * FROM projects WHERE client_id=? ORDER BY id DESC LIMIT ?')
      .all(clientId, limit);
  }

  close() {
    this.db.close();
  }
}

function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

let singleton = null;
function getMemory() {
  if (!singleton) singleton = new Memory();
  return singleton;
}

module.exports = { Memory, getMemory, DB_PATH };
