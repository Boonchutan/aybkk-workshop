/**
 * Shared helpers for the Weekly Transmission scripts (run on Boonchu's M1
 * via launchd; see launchd/ for the job definitions).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

// .env lives in the main checkout; scripts may run from a worktree during dev.
const envCandidates = [
  path.join(__dirname, '..', '..', '.env'),
  '/Users/bt/mission-control/.env'
];
for (const p of envCandidates) {
  if (fs.existsSync(p)) { require('dotenv').config({ path: p }); break; }
}

const API_BASE = process.env.AYBKK_API_BASE || 'https://aybkk-ashtanga.up.railway.app';
const KEY_FILE = path.join(os.homedir(), '.aybkk', 'transmission-key');

function readKey() {
  try { return fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch { return null; }
}

function writeKey(key) {
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, key + '\n', { mode: 0o600 });
}

function httpJson(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 20000
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, json: null, raw: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

// Fetch the shared key, claiming it from /bootstrap on first run.
async function ensureKey() {
  let key = readKey();
  if (key) return key;
  const res = await httpJson('GET', `${API_BASE}/api/transmission/bootstrap`);
  if (res.json && res.json.key) {
    writeKey(res.json.key);
    return res.json.key;
  }
  throw new Error('No transmission key: bootstrap says ' + JSON.stringify(res.json || res.raw));
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.BOONCHU_CHAT_ID;
  if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN / BOONCHU_CHAT_ID missing');
  const res = await httpJson('POST', `https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text,
    disable_web_page_preview: true
  });
  if (!res.json || !res.json.ok) throw new Error('telegram send failed: ' + JSON.stringify(res.json || res.raw));
}

// LINE push to Boonchu — active only once BOONCHU_LINE_UID is set in .env.
async function sendLine(text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const uid = process.env.BOONCHU_LINE_UID;
  if (!token || !uid) return false;
  await new Promise((resolve, reject) => {
    const payload = JSON.stringify({ to: uid, messages: [{ type: 'text', text: text.slice(0, 4900) }] });
    const req = https.request({
      hostname: 'api.line.me',
      path: '/v2/bot/message/push',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 20000
    }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(payload);
    req.end();
  });
  return true;
}

// Both channels; Telegram is the must-succeed one.
async function notifyBoonchu(text) {
  await sendTelegram(text);
  try { await sendLine(text); } catch (e) { console.warn('LINE send failed (non-fatal):', e.message); }
}

function weekMonday(d = new Date()) {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

function isoWeekNumber(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function loadJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, rel), 'utf8'));
}

module.exports = { API_BASE, ensureKey, httpJson, sendTelegram, sendLine, notifyBoonchu, weekMonday, isoWeekNumber, loadJson };
