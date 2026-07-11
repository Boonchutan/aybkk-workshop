#!/usr/bin/env node
'use strict';

/**
 * Hermes CLI.
 *
 *   node cli.js "Build a simple booking system for yoga classes"
 *   node cli.js "Build a booking system" --client "Jane"
 *   node cli.js --list                 # recent generated projects
 *   node cli.js --memory               # known clients + remembered context
 *
 * Run via npm so the --experimental-sqlite flag is applied:
 *   npm run build -- "Build a booking system"
 */

require('./core/load-env');
const { Orchestrator } = require('./core/orchestrator');
const { getMemory } = require('./memory/store');

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') args.flags.list = true;
    else if (a === '--memory') args.flags.memory = true;
    else if (a === '--help' || a === '-h') args.flags.help = true;
    else if (a === '--client') args.flags.client = argv[++i];
    else args._.push(a);
  }
  return args;
}

function printHelp() {
  console.log(`Hermes — AYBKK multi-agent builder

Usage:
  node cli.js "<task description>"        Build a deliverable from a request
  node cli.js "<task>" --client "<name>"  Attribute the build to a client (persists context)
  node cli.js --list                      Show recently generated projects
  node cli.js --memory                    Show known clients and remembered context
  node cli.js --help

Tip: run through npm so SQLite is enabled:  npm run build -- "<task>"`);
}

function listProjects(memory) {
  const rows = memory.listProjects(25);
  if (!rows.length) return console.log('No projects yet. Try: npm run build -- "Build a booking system for yoga classes"');
  console.log('\nRecent projects:');
  for (const p of rows) {
    const agents = safeJson(p.agents_used);
    console.log(`  #${p.id}  ${p.slug}  [${p.project_type}/${p.executor}]  ${Array.isArray(agents) ? agents.length : 0} agents  ${p.created_at}`);
    console.log(`        ${p.dir}`);
  }
}

function showMemory(memory) {
  const clients = memory.listClients();
  if (!clients.length) return console.log('No clients in memory yet. Add one with --client "<name>".');
  console.log('\nClients in memory:');
  for (const c of clients) {
    console.log(`\n  ${c.name || c.id}${c.region ? ` (${c.region})` : ''} — ${memory.projectsForClient(c.id).length} project(s)`);
    const ctx = memory.getClientContext(c.id);
    ctx.split('\n').forEach((line) => console.log(`    ${line}`));
  }
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const memory = getMemory();

  if (args.flags.help) return printHelp();
  if (args.flags.list) return listProjects(memory);
  if (args.flags.memory) return showMemory(memory);

  const description = args._.join(' ').trim();
  if (!description) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  let clientId = null;
  if (args.flags.client) {
    const client = memory.upsertClient({ name: args.flags.client });
    clientId = client.id;
    memory.addConversation(clientId, 'user', description);
  }

  const orchestrator = new Orchestrator({ memory });
  const result = await orchestrator.runTask(description, { clientId });

  if (clientId) {
    memory.addConversation(clientId, 'hermes', `Built ${result.slug} → ${result.relDir}`);
  }

  console.log('\n── Result ───────────────────────────────');
  console.log(`Project:   ${result.slug} (${result.projectType})`);
  console.log(`Agents:    ${result.agentsUsed.join(', ')}`);
  console.log(`Backend:   ${result.executor}`);
  console.log(`Output:    ${result.relDir}`);
  console.log(`Files:     ${result.files.length}`);
  result.files.forEach((f) => console.log(`             - ${f}`));
  if (result.projectType === 'booking-system') {
    console.log(`\nRun it:    cd ${result.relDir} && npm install && node server.js`);
    console.log(`           then open http://localhost:5000`);
  }
}

main().catch((err) => {
  console.error('Hermes failed:', err.message);
  process.exitCode = 1;
});
