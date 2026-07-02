#!/usr/bin/env node
/**
 * Monday-morning nudge — if any city from yesterday's Transmission is still
 * unconfirmed, remind Boonchu once on Telegram + LINE. Never nags twice.
 *
 * Runs via launchd every Monday 09:00 Asia/Bangkok (com.aybkk.transmission-nudge).
 */
const { API_BASE, ensureKey, httpJson, notifyBoonchu, weekMonday } = require('./lib');

async function main() {
  const key = await ensureKey();
  // On Monday 09:00 the current week's Monday IS yesterday's transmission week.
  const week = weekMonday();
  const res = await httpJson('GET', `${API_BASE}/api/transmission/status?key=${key}`);
  if (res.status !== 200 || !res.json) throw new Error('status unavailable: ' + res.status);

  const entry = (res.json.weeks || []).find(w => w.week === week);
  if (!entry) { console.log('No transmission recorded for', week, '- nothing to nudge.'); return; }

  const missing = entry.cities.filter(c => c.sentAt && !c.confirmedAt);
  if (!missing.length) { console.log('All confirmed for', week, '- streak', res.json.streak); return; }

  const lines = missing.map(c =>
    `${c.city}: ${API_BASE}/api/transmission/confirm?week=${week}&city=${c.city}&key=${key}`
  ).join('\n');
  await notifyBoonchu(`⏰ 周日传送还有 ${missing.length} 个群没确认:\n${lines}\n\n已经发了的话，点上面链接确认即可。`);
  console.log('Nudged for', missing.map(c => c.city).join(', '));
}

main().catch(err => { console.error('nudge failed:', err.message); process.exit(1); });
