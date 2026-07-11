#!/usr/bin/env node
'use strict';

/**
 * Hermes on Telegram — the always-on conversational face of the system.
 *
 * Each Telegram chat maps to a client thread in SQLite, so Hermes remembers who
 * it's talking to and what they've built across restarts. A free-text message is
 * treated as a build request and handed to the same orchestrator the CLI/web use.
 *
 * Create a NEW bot with @BotFather, put its token in .env as TELEGRAM_BOT_TOKEN,
 * then:  npm run hermes
 *
 * With no token set, this prints a notice and exits cleanly (so the rest of the
 * system stays testable offline).
 */

require('../core/load-env');
const { getMemory } = require('../memory/store');
const { Orchestrator } = require('../core/orchestrator');
const { logger } = require('../core/logger');

const log = logger.child('telegram');
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  console.log(
    [
      'Hermes Telegram bot is not configured.',
      '',
      '  1. Create a new bot with @BotFather and copy its token.',
      '  2. Add to agent-system/.env:   TELEGRAM_BOT_TOKEN=123456:ABC...',
      '  3. Run again:                  npm run hermes',
      '',
      'The CLI (npm run build) and web UI (npm start) work without a token.',
    ].join('\n')
  );
  process.exit(0);
}

const { Bot } = require('grammy');
const memory = getMemory();
const orchestrator = new Orchestrator({ memory });
const bot = new Bot(TOKEN);

function clientForChat(ctx) {
  const from = ctx.from || {};
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || `tg-${ctx.chat.id}`;
  return memory.upsertClient({ telegram_id: String(ctx.chat.id), name });
}

bot.command('start', async (ctx) => {
  const client = clientForChat(ctx);
  await ctx.reply(
    `Namaste ${client.name} 🙏\n\n` +
      'I am Hermes — I build things for Ashtanga Yoga Bangkok. Just tell me what you need, e.g.\n' +
      '“build a simple booking system for yoga classes”.\n\n' +
      'Commands: /projects (what I have built for you), /whoami (what I remember).'
  );
});

bot.command('whoami', async (ctx) => {
  const client = clientForChat(ctx);
  const context = memory.getClientContext(client.id) || 'Nothing yet — send me a request!';
  await ctx.reply(context);
});

bot.command('projects', async (ctx) => {
  const client = clientForChat(ctx);
  const projects = memory.projectsForClient(client.id, 10);
  if (!projects.length) return ctx.reply('No projects yet. Tell me what to build!');
  await ctx.reply('Built for you:\n' + projects.map((p) => `• ${p.slug} (${p.project_type}) — ${p.created_at}`).join('\n'));
});

bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return; // unknown command
  const client = clientForChat(ctx);
  memory.addConversation(client.id, 'user', text);
  await ctx.reply('On it — delegating to the agents… 🛠️');
  try {
    const result = await orchestrator.runTask(text, { clientId: client.id });
    memory.addConversation(client.id, 'hermes', `Built ${result.slug} → ${result.relDir}`);
    const reply =
      `Done! Built *${result.slug}* (${result.projectType}).\n` +
      `Agents: ${result.agentsUsed.join(', ')}\n` +
      `Backend: ${result.executor}\n` +
      `Files (${result.files.length}): ${result.files.join(', ')}\n` +
      `Output: ${result.relDir}` +
      (result.projectType === 'booking-system'
        ? `\n\nRun it: cd ${result.relDir} && npm install && node server.js`
        : '');
    await ctx.reply(reply, { parse_mode: 'Markdown' });
  } catch (err) {
    log.error(err.stack || err.message);
    await ctx.reply('Sorry — that build failed: ' + err.message);
  }
});

bot.catch((err) => log.error('bot error: ' + (err.error?.message || err.message)));

log.ok('Hermes is live on Telegram. Press Ctrl+C to stop.');
bot.start();
