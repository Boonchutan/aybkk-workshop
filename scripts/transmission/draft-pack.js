#!/usr/bin/env node
/**
 * Sunday Transmission — drafts the weekly per-city pack and delivers it to
 * Boonchu's phone (Telegram + LINE). Never contacts students.
 *
 * Runs via launchd every Sunday 16:30 Asia/Bangkok (com.aybkk.transmission-draft).
 *   TRANSMISSION_DRY_RUN=1 node scripts/transmission/draft-pack.js   # test run
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { API_BASE, ensureKey, httpJson, notifyBoonchu, weekMonday, isoWeekNumber, loadJson } = require('./lib');

const DRY = process.env.TRANSMISSION_DRY_RUN === '1';
const JOURNAL_REMINDER = '打开你的专属练习记录链接，10秒打卡。链接丢了？ ' + API_BASE + '/lookup.html';

function activeCities() {
  const today = new Date().toISOString().slice(0, 10);
  return loadJson('cities.json').cities.filter(c =>
    c.active && (!c.activeFrom || c.activeFrom <= today)
  );
}

function fallbackMessage(city, focus, recap) {
  const recapLine = recap && recap.checkedIn > 0 ? `上周有 ${recap.checkedIn} 位同学打卡，很好。\n` : '';
  return `${city.label.split(' ')[0]}的同学们，本周练习重点：${focus.zh}。\n${recapLine}${JOURNAL_REMINDER}`;
}

function draftWithClaude(payload) {
  const prompt = fs.readFileSync(path.join(__dirname, 'prompt.md'), 'utf8')
    + '\n\nInput JSON:\n' + JSON.stringify(payload, null, 2);
  const out = execFileSync('claude', ['-p', prompt, '--output-format', 'text'], {
    timeout: 180000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, PATH: process.env.PATH + ':/Users/bt/.local/bin:/opt/homebrew/bin' }
  }).toString();
  const cleaned = out.replace(/```json/gi, '').replace(/```/g, '').trim();
  const arr = JSON.parse(cleaned.slice(cleaned.indexOf('['), cleaned.lastIndexOf(']') + 1));
  if (!Array.isArray(arr)) throw new Error('not an array');
  return arr;
}

async function main() {
  const key = await ensureKey();
  // Sent Sunday evening: the pack is FOR the week starting tomorrow (Monday),
  // while the recap covers the week ending today.
  const week = weekMonday(new Date(Date.now() + 86400000));
  const prevWeek = weekMonday();
  const cities = activeCities();
  if (!cities.length) { console.log('No active cities.'); return; }

  // If this week's pack was already sent (e.g. a manual run earlier in the
  // week), say so in the header instead of double-asking the groups.
  let alreadySent = false;
  try {
    const st = await httpJson('GET', `${API_BASE}/api/transmission/status?key=${key}`);
    const entry = st.json && (st.json.weeks || []).find(w => w.week === week);
    alreadySent = !!(entry && entry.cities.some(c => c.sentAt));
  } catch { /* non-fatal */ }

  const focus = loadJson('curriculum.json').weeks[isoWeekNumber() % 12];

  // Previous-week recap per city (non-fatal if the API is down)
  const recaps = {};
  for (const c of cities) {
    try {
      const r = await httpJson('GET', `${API_BASE}/api/journal/weekly-recap?workshop=${encodeURIComponent(c.workshop)}&weekOf=${prevWeek}`);
      if (r.status === 200 && r.json) recaps[c.key] = r.json;
    } catch (e) { console.warn(`recap ${c.key} failed:`, e.message); }
  }

  // Monthly shortlist on the first Sunday of the month
  let shortlist = null;
  if (new Date().getDate() <= 7) {
    try {
      const r = await httpJson('GET', `${API_BASE}/api/transmission/shortlist?key=${key}`);
      if (r.status === 200 && r.json && r.json.students) shortlist = r.json.students.slice(0, 20);
    } catch (e) { console.warn('shortlist failed:', e.message); }
  }

  // Draft with claude CLI; template fallback per city on any failure
  let drafts = null;
  try {
    drafts = draftWithClaude({
      weekOf: week,
      focus,
      journalReminderLine: JOURNAL_REMINDER,
      cities: cities.map(c => ({ key: c.key, label: c.label, lang: c.lang, recap: recaps[c.key] || null })),
      ...(shortlist ? { shortlist } : {})
    });
    console.log('Drafted with claude CLI.');
  } catch (e) {
    console.warn('claude drafting failed, using template fallback:', e.message);
  }

  const messageFor = c => {
    const d = drafts && drafts.find(x => x.city === c.key);
    return (d && d.message) || fallbackMessage(c, focus, recaps[c.key]);
  };

  const tag = DRY ? '🧪 TEST · ' : '';
  const dupNote = alreadySent ? '\n⚠️ 本周已经发过一次，群里发过的话请忽略这条。' : '';
  const header = `${tag}📮 周日传送 · Sunday Transmission\n周 ${week} · 重点: ${focus.zh}${dupNote}\n\n下面每条消息对应一个城市群，复制粘贴即可。全部发完后，点最后一条里的确认链接。`;
  await notifyBoonchu(header);

  for (const c of cities) {
    await notifyBoonchu(`${tag}【${c.wechatGroup}】\n\n${messageFor(c)}`);
  }

  const confirmLines = cities.map(c =>
    `${c.label}: ${API_BASE}/api/transmission/confirm?week=${week}&city=${c.key}&key=${key}`
  ).join('\n');
  await notifyBoonchu(`${tag}✅ 发完一个群就点一个:\n${confirmLines}`);

  if (shortlist) {
    const d = drafts && drafts.find(x => x.city === 'shortlist');
    const listText = (d && d.message) || shortlist.map(s =>
      `· ${s.name} (${s.workshop}) ${s.recentCheckins} 次打卡${s.goals ? ' · ' + String(s.goals).slice(0, 30) : ''}`
    ).join('\n');
    await notifyBoonchu(`${tag}🎙 本月语音名单 (只给你看，本周内发 3-5 条私人语音):\n${listText}`);
  }

  if (!DRY) {
    await httpJson('POST', `${API_BASE}/api/transmission/sent`, { key, week, cities: cities.map(c => c.key) });
  }
  console.log(`Pack delivered for week ${week}: ${cities.map(c => c.key).join(', ')}${DRY ? ' (dry run)' : ''}`);
}

main().catch(async err => {
  console.error('draft-pack failed:', err.message);
  // The reminder must still reach Boonchu even when drafting breaks.
  try { await notifyBoonchu('⚠️ 周日传送生成失败: ' + err.message + '\n请手动发本周消息，或查看日志 ~/Library/Logs/aybkk-transmission.log'); } catch {}
  process.exit(1);
});
