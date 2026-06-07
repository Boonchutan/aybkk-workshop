#!/usr/bin/env node
'use strict';

/**
 * Minimal web front-end for Hermes — the "no-code" natural-language interface.
 * A textarea posts to /api/task; the orchestrator builds the deliverable and
 * the result (project, agents, files) is rendered back.
 *
 * Run:  npm start   (applies --experimental-sqlite)   → http://localhost:4040
 */

require('./core/load-env');
const path = require('path');
const express = require('express');

const { Orchestrator } = require('./core/orchestrator');
const { getMemory } = require('./memory/store');
const { logger } = require('./core/logger');

const log = logger.child('web');
const app = express();
const PORT = process.env.HERMES_PORT || 4040;

const memory = getMemory();
const orchestrator = new Orchestrator({ memory });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true, backend: orchestrator.executor.mode }));

app.get('/api/projects', (req, res) => res.json(memory.listProjects(25)));

app.post('/api/task', async (req, res) => {
  const { description, client } = req.body || {};
  if (!description || !description.trim()) {
    return res.status(400).json({ error: 'description is required' });
  }
  try {
    let clientId = null;
    if (client && client.trim()) {
      const c = memory.upsertClient({ name: client.trim() });
      clientId = c.id;
      memory.addConversation(clientId, 'user', description);
    }
    const result = await orchestrator.runTask(description.trim(), { clientId });
    if (clientId) memory.addConversation(clientId, 'hermes', `Built ${result.slug} → ${result.relDir}`);
    res.json(result);
  } catch (err) {
    log.error(err.stack || err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  log.ok(`Hermes web UI on http://localhost:${PORT}  (backend: ${orchestrator.executor.mode})`);
});
