// team-brief.js: the AYBKK help desk, a second LINE Official Account (internal,
// free plan; not the student account LINE @aybkk) that posts to the teacher
// team's LINE group:
//   05:00 Bangkok  the teaching brief for today (who is booked, who is new,
//                  whose pass is ending, who has not paid, who needs a mat)
//   20:00 Bangkok  the summary of the day on aybkk.net
//   any time       a message Boonchu approved through the Desk assistant
//
// Mount:  const team = mountTeam(app, { pgPool, cloudinary, driver })
//         team.start() runs the minute timer. server.js calls it; tests call
//         team.tick(fakeNow) instead, so nothing runs on a clock in a test.
//
// Env:    HELPDESK_LINE_CHANNEL_SECRET  checks the webhook's signature
//         HELPDESK_LINE_ACCESS_TOKEN    pushes to the group
//
// The webhook keeps only which group the help desk is in. Text written in a
// group or a 1:1 chat is never stored, logged or forwarded. The first group it
// joins gets the briefs; any later group waits until the Desk or staff accept
// it (POST /api/bkk/admin/team/group), because the briefs carry student names
// and private class photos.
// Briefs name students by first name and family initial only: no email, phone
// or member code ever goes to LINE.
// The Thai brief keeps class and package names in the original English
// ('Mysore (1st batch)', '1 month unlimited', 'Drop-in'), and every student and
// teacher name is written as stored, never transliterated (Boonchu, 7 Nov 2026).

const crypto = require('crypto');
const express = require('express');
const { moonDaysBetween, rotationTeacher } = require('./bkk-api');
const { telegram } = require('./inbox');

// Matched the way Express matches the route, so server.js can leave every
// spelling of it out of its JSON parser: the signature is over the raw bytes.
const HELPDESK_PATH_RE = /^\/line\/helpdesk-webhook\/?$/i;
const LINE_API = 'https://api.line.me/v2/bot';
const PUSH_MAX = 5;                  // message objects per push
const TEXT_MAX = 5000;               // characters per text message
const URL_MAX = 2000;                // LINE's limit for an image URL
const SEND_MAX = PUSH_MAX * TEXT_MAX;
const BRIEF_AT = { morning: '05:00', evening: '20:00' };
const LATE_MIN = 60;                 // a server that was down sends late, up to this
const TRIES = 3;                     // per brief per day, only when LINE did not answer
const GROUPS_KEPT = 10;
const MARKER = 'team_brief_sent_';
const ATTENDED = `b.status='booked' AND b.checked_in_at IS NOT NULL`;
const MAT_THB = 200;                 // mat rental, flat, VAT included, paid at the shala

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};
const signed = (raw, sig, secret) => !!(secret && Buffer.isBuffer(raw) && sig)
  && safeEqual(sig, crypto.createHmac('sha256', secret).update(raw).digest('base64'));

// LINE does a request once per retry key: a push sent again after a timeout
// (it may have arrived) is answered 409 instead of being shown twice.
function retryKey(seed) {
  const h = crypto.createHash('sha256').update(String(seed)).digest('hex').split('');
  h[12] = '5';
  h[16] = '89ab'[parseInt(h[16], 16) & 3];
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

const bkkYmd = ms => new Date(ms + 7 * 3600000).toISOString().slice(0, 10);
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const bkkAt = (ymd, hhmm) => `${ymd}T${hhmm}:00+07:00`;
const realYmd = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !isNaN(Date.parse(`${d}T00:00:00Z`))
  && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

// "Anna Maria Bell" → "Anna Maria B."; one word stays as it is. Letters stay as
// stored (script and case). A word with a digit, '+' or '@' is dropped: real
// names have none, phone numbers, emails and member codes do. A Thai family
// name is shortened to its first consonant, not a leading vowel.
function shortName(raw) {
  const words = String(raw || '').replace(/\([^)]*\)/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ')
    .split(/\s+/).filter(w => w && !/[@+\d]/.test(w));
  if (!words.length) return '?';
  if (words.length === 1) return [...words[0]].slice(0, 30).join('');
  const last = words.pop();
  const first = [...last.replace(/^[เ-ไ]+/, '')][0] || [...last][0];
  return `${[...words.join(' ')].slice(0, 30).join('')} ${first}.`;
}

// Longer than 5,000 characters: split at line ends, never inside a character.
function splitText(text, max = TEXT_MAX) {
  const out = [];
  let cur = null;
  for (let line of String(text ?? '').split('\n')) {
    while (line.length > max) {
      if (cur !== null) { out.push(cur); cur = null; }
      let cut = max;
      if (/[\uD800-\uDBFF]/.test(line[cut - 1])) cut--;
      out.push(line.slice(0, cut));
      line = line.slice(cut);
    }
    if (cur === null) cur = line;
    else if (cur.length + 1 + line.length > max) { out.push(cur); cur = line; }
    else cur += '\n' + line;
  }
  if (cur !== null) out.push(cur);
  return out.filter(s => s.trim());
}

// Admin routes name a group by this, never by its LINE id.
const groupRef = id => crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 12);

const httpsUrl = u => typeof u === 'string' && u.length <= URL_MAX && /^https:\/\/[^\s"'<>]+$/.test(u);

// Strings become text messages; an image needs https URLs LINE can fetch.
function lineMessages(list) {
  const out = [];
  for (const m of Array.isArray(list) ? list : [list]) {
    if (typeof m === 'string' || (m && m.type === 'text' && typeof m.text === 'string')) {
      for (const text of splitText(typeof m === 'string' ? m : m.text)) out.push({ type: 'text', text });
    } else if (m && m.type === 'image' && httpsUrl(m.originalContentUrl) && httpsUrl(m.previewImageUrl)) {
      out.push({ type: 'image', originalContentUrl: m.originalContentUrl, previewImageUrl: m.previewImageUrl });
    } else {
      return { error: 'each message must be text, or an image with https originalContentUrl and previewImageUrl' };
    }
  }
  return { messages: out };
}

// ── words ───────────────────────────────────────────────────────────────────
const WD = { th: ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'], en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] };
const MON = {
  th: ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const baht = n => '฿' + Math.round(Number(n) || 0).toLocaleString('en-US');
const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const list = (names, max = 15) => names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max}` : names.join(', ');

const WORDS = {
  th: {
    day: d => { const t = new Date(`${d}T12:00:00Z`); return `${WD.th[t.getUTCDay()]} ${t.getUTCDate()} ${MON.th[t.getUTCMonth()]}`; },
    item: en => en || 'แพ็กเกจ',
    mHead: d => `☀️ บรีฟเช้า ${d}`,
    closed: c => c.why === 'none' ? 'วันนี้ไม่มีคลาสในตาราง'
      : c.why === 'cancelled' ? `วันนี้ชาลาปิด ยกเลิกทุกคลาส${c.note ? ` (${c.note})` : ''}`
      : `วันนี้ชาลาปิด ${c.why === 'full' ? 'วันพระจันทร์เต็มดวง' : 'วันพระจันทร์ดับ'} (moon day)`,
    cLine: (time, title, teacher, n) => `${time} ${title}${teacher ? ` · ครู ${teacher}` : ''} · จอง ${n}`,
    cOff: (time, title, note) => `${time} ${title} · ยกเลิก${note ? ` (${note})` : ''}`,
    nobody: 'ยังไม่มีคนจอง',
    newH: '🌱 นักเรียนใหม่ ช่วยกันต้อนรับ',
    newFirst: (n, time) => `• ${n} มาครั้งแรก ${time}`,
    newBought: (n, item, day, next) => `• ${n} ซื้อ ${item} เมื่อ ${day} ยังไม่เคยมา${next ? ` (จองไว้ ${next})` : ' ยังไม่ได้จอง'}`,
    endH: '⏳ ใกล้หมด ชวนคุยเรื่องต่อแพ็กเกจ',
    endDate: (n, item, until) => `• ${n} ${item} หมด ${until}`,
    endLeft: (n, item, left, until) => `• ${n} ${item} เหลือ ${left} ครั้ง${until ? ` ใช้ได้ถึง ${until}` : ''}`,
    payH: '💳 ยังไม่จ่าย ช่วยตามเก็บเงิน',
    payOrder: (n, item, amount, day, ref) => `• ${n} สั่ง ${item} ${amount} ยังไม่ได้จ่าย (สั่ง ${day}, ref ${ref})`,
    paySeat: (n, time, why) => `• ${n} จอง ${time} ${why}`,
    why: { none: 'แต่ยังไม่มีแพ็กเกจ', ended: d => `แต่แพ็กเกจหมดไปแล้ว ${d}`, frozen: 'แต่แพ็กเกจพักไว้อยู่',
      void: 'แต่แพ็กเกจถูกยกเลิกแล้ว' },
    matH: `🧘 เตรียมเสื่อให้ (เก็บ ${baht(MAT_THB)})`,
    mTotal: o => `รวม ${o.classes} คลาส · จอง ${o.booked} · ใหม่ ${o.fresh} · ใกล้หมด ${o.ending} · ยังไม่จ่าย ${o.unpaid} · เสื่อ ${o.mats}`,

    eHead: (d, upTo) => `🌙 สรุปวันนี้ ${d} (ตั้งแต่ 20:00 เมื่อวาน ถึง ${upTo})`,
    moneyH: '💰 เงิน',
    paid: (n, total, vat) => `จ่ายแล้ว ${n} รายการ ${total} (รวม VAT ${vat})`,
    paidNone: 'ยังไม่มีคนจ่าย',
    moneyItem: (item, n, total) => `• ${item} ×${n} ${total}`,
    method: { cash: 'เงินสด', transfer: 'โอน', card: 'บัตร', online: 'ออนไลน์', other: 'อื่นๆ' },
    desk: parts => `ที่เคาน์เตอร์ ${parts}`,
    online: (n, total) => `ออนไลน์ ${n} รายการ ${total}`,
    pending: (n, total) => `ค้างจ่าย ${n} รายการ ${total}`,
    mismatch: n => `⚠ ยอดไม่ตรง ${n} รายการ เช็กในหน้า Payments`,
    peopleH: '👥 นักเรียน',
    joined: (n, names) => `สมัครใหม่ ${n} คน${names ? `: ${names}` : ''}`,
    started: (n, names) => `เริ่มแพ็กเกจ ${n} คน: ${names}`,
    ended: (n, names) => `แพ็กเกจหมดวันนี้ ${n} คน: ${names}`,
    renewed: r => r ? 'ต่อแล้ว' : 'ยังไม่ต่อ',
    classesH: '🧘 คลาสวันนี้',
    came: (time, title, came, booked, missed) => `${time} ${title}: มา ${came}/${booked}${missed ? ` · ไม่มา: ${missed}` : ''}`,
    bookings: (made, off, byShala) => `จองใหม่ ${made} · ยกเลิก ${off}${byShala ? ` (ชาลาปิดคลาส ${byShala})` : ''}`,
    tomorrowH: d => `📅 พรุ่งนี้ ${d}`,
    tLine: (time, title, n, mats) => `${time} ${title}: จอง ${n}${mats ? ` · เสื่อ ${mats}` : ''}`,
    tClosed: c => c.why === 'none' ? 'พรุ่งนี้ไม่มีคลาสในตาราง'
      : c.why === 'cancelled' ? `พรุ่งนี้ชาลาปิด ยกเลิกทุกคลาส${c.note ? ` (${c.note})` : ''}`
      : `พรุ่งนี้ชาลาปิด ${c.why === 'full' ? 'วันพระจันทร์เต็มดวง' : 'วันพระจันทร์ดับ'} (moon day)`,
    photosH: '📷 รูปคลาส',
    photos: (n, tagged, students) => `อัปโหลด ${n} รูป · แท็กแล้ว ${tagged} · ขึ้นโปรไฟล์ ${students} คน`,
    photosNone: 'วันนี้ยังไม่มีรูป',
    profileH: '📝 โปรไฟล์นักเรียน',
    notes: (n, by) => `โน้ตครู ${n}${by ? ` (${by})` : ''}`,
    checks: (n, names) => `เช็กผล 12 สัปดาห์ ${n} คน: ${names}`,
    journal: (n, names) => `บันทึกการฝึก ${n} ครั้ง (${names})`,
    signins: (n, links) => `เข้าโปรไฟล์ ${n} คน · ครูส่งลิงก์ ${links}`,
    leadsH: '📣 ลีด',
    letter: (yes, wait, left) => `จดหมายวันจันทร์ ยืนยัน ${yes} · รอยืนยัน ${wait}${left ? ` · เลิกรับ ${left}` : ''}`,
    start: (views, taps, done) => `หน้า Start เข้าชม ${views} · กดจอง ${taps} · ทำครบทุกขั้น ${done}`,
    forms: n => `ฟอร์มสนใจเรียน ${n}`,
    chat: (where, n, fresh, hot) => `${where} แชต ${n} คน (คนใหม่ ${fresh}) · ด่วน ${hot}`,
    apply: n => `ใบสมัคร In-Depth ${n}`,
    eTotal: o => `วันนี้เงินเข้า ${o.money} · มาเรียน ${o.came} · พรุ่งนี้จองแล้ว ${o.tomorrow}`,
  },
  en: {
    day: d => { const t = new Date(`${d}T12:00:00Z`); return `${WD.en[t.getUTCDay()]} ${t.getUTCDate()} ${MON.en[t.getUTCMonth()]}`; },
    item: en => en || 'pass',
    mHead: d => `☀️ Teaching brief ${d}`,
    closed: c => c.why === 'none' ? 'No classes on the timetable today.'
      : c.why === 'cancelled' ? `The shala is closed today: every class is cancelled${c.note ? ` (${c.note})` : ''}.`
      : `The shala is closed today: ${c.why === 'full' ? 'full moon' : 'new moon'} day.`,
    cLine: (time, title, teacher, n) => `${time} ${title}${teacher ? ` · ${teacher}` : ''} · ${n} booked`,
    cOff: (time, title, note) => `${time} ${title} · cancelled${note ? ` (${note})` : ''}`,
    nobody: 'Nobody booked yet',
    newH: '🌱 New students, please welcome',
    newFirst: (n, time) => `• ${n}, first class today at ${time}`,
    newBought: (n, item, day, next) => `• ${n} bought ${item} on ${day}, has not come yet${next ? ` (booked ${next})` : ', no booking yet'}`,
    endH: '⏳ Ending soon, talk about renewing',
    endDate: (n, item, until) => `• ${n}: ${item}, ends ${until}`,
    endLeft: (n, item, left, until) => `• ${n}: ${item}, ${left} left${until ? `, until ${until}` : ''}`,
    payH: '💳 Not paid, please collect',
    payOrder: (n, item, amount, day, ref) => `• ${n}: ${item} ${amount} not paid (ordered ${day}, ref ${ref})`,
    paySeat: (n, time, why) => `• ${n}: booked ${time} but ${why}`,
    why: { none: 'has no pass', ended: d => `the pass ended ${d}`, frozen: 'the pass is paused',
      void: 'the pass was voided' },
    matH: `🧘 Have a mat ready (collect ${baht(MAT_THB)} each)`,
    mTotal: o => `Total: ${pl(o.classes, 'class', 'classes')} · ${o.booked} booked · ${o.fresh} new · ${o.ending} ending · ${o.unpaid} not paid · ${pl(o.mats, 'mat', 'mats')}`,

    eHead: (d, upTo) => `🌙 Today on aybkk.net, ${d} (20:00 yesterday to ${upTo})`,
    moneyH: '💰 Money',
    paid: (n, total, vat) => `Paid: ${pl(n, 'order', 'orders')}, ${total} (VAT ${vat} included)`,
    paidNone: 'No payments yet',
    moneyItem: (item, n, total) => `• ${item} ×${n} ${total}`,
    method: { cash: 'cash', transfer: 'transfer', card: 'card', online: 'online', other: 'other' },
    desk: parts => `At the desk: ${parts}`,
    online: (n, total) => `Online: ${pl(n, 'order', 'orders')} ${total}`,
    pending: (n, total) => `Still pending: ${pl(n, 'order', 'orders')} ${total}`,
    mismatch: n => `⚠ Amount mismatch: ${pl(n, 'order', 'orders')}, check Payments`,
    peopleH: '👥 Students',
    joined: (n, names) => names ? `New members (${n}): ${names}` : `New members: ${n}`,
    started: (n, names) => `Passes started (${n}): ${names}`,
    ended: (n, names) => `Passes ended today (${n}): ${names}`,
    renewed: r => r ? 'renewed' : 'not renewed',
    classesH: '🧘 Classes today',
    came: (time, title, came, booked, missed) => `${time} ${title}: ${came}/${booked} came${missed ? ` · no-show: ${missed}` : ''}`,
    bookings: (made, off, byShala) => `Bookings made: ${made} · cancelled: ${off}${byShala ? ` (${byShala} by a closed class)` : ''}`,
    tomorrowH: d => `📅 Tomorrow ${d}`,
    tLine: (time, title, n, mats) => `${time} ${title}: ${n} booked${mats ? ` · ${pl(mats, 'mat', 'mats')}` : ''}`,
    tClosed: c => c.why === 'none' ? 'No classes on the timetable tomorrow.'
      : c.why === 'cancelled' ? `The shala is closed tomorrow: every class is cancelled${c.note ? ` (${c.note})` : ''}.`
      : `The shala is closed tomorrow: ${c.why === 'full' ? 'full moon' : 'new moon'} day.`,
    photosH: '📷 Class photos',
    photos: (n, tagged, students) => `Uploaded: ${n} · tagged: ${tagged} · on ${pl(students, 'profile', 'profiles')}`,
    photosNone: 'No photos yet',
    profileH: '📝 Student profiles',
    notes: (n, by) => `Teacher notes: ${n}${by ? ` (${by})` : ''}`,
    checks: (n, names) => `12-week checks (${n}): ${names}`,
    journal: (n, names) => `Practice journal entries: ${n} (${names})`,
    signins: (n, links) => `Opened their profile: ${n} · sign-in links sent by staff: ${links}`,
    leadsH: '📣 Leads',
    letter: (yes, wait, left) => `Monday letter: ${yes} confirmed · ${wait} waiting${left ? ` · ${left} left` : ''}`,
    start: (views, taps, done) => `Start page: ${pl(views, 'view', 'views')} · ${taps} tapped Book · ${done} finished`,
    forms: n => `First-step forms: ${n}`,
    chat: (where, n, fresh, hot) => `${where} chats: ${pl(n, 'person', 'people')} (${fresh} new) · hot: ${hot}`,
    apply: n => `In-Depth applications: ${n}`,
    eTotal: o => `Today: ${o.money} in · ${o.came} came · ${o.tomorrow} booked for tomorrow`,
  },
};
const CHAT = { line: 'LINE', instagram: 'Instagram', facebook: 'Facebook' };

function mountTeam(app, opts = {}) {
  const pool = opts.pgPool;
  const cloudinary = opts.cloudinary || null;
  const driver = opts.driver || null;
  const httpFetch = opts.fetch || fetch;
  const nowMs = typeof opts.now === 'function' ? opts.now : Date.now;
  const notify = opts.notify || telegram;
  const ADMIN_KEY = process.env.BKK_ADMIN_KEY || process.env.SHOP_ADMIN_KEY || '';
  const adminOnly = (req, res, next) => ADMIN_KEY && safeEqual(req.headers['x-bkk-key'], ADMIN_KEY)
    ? next() : res.status(401).json({ error: 'bad key' });
  const raw = express.raw({ type: () => true, limit: '256kb' });

  if (!pool) {
    console.warn('⚠ team-brief: no pgPool, LINE help desk disabled');
    app.post('/line/helpdesk-webhook', (req, res) => res.sendStatus(503));
    return { tick: async () => [], start() {}, stop() {} };
  }
  const q = (sql, params = []) => pool.query(sql, params);
  const stats = { badSignatures: 0 };

  const getSetting = async key => (await q('SELECT value FROM bkk_settings WHERE key=$1', [key])).rows[0]?.value ?? null;
  const putSetting = (key, value) => q(`INSERT INTO bkk_settings (key,value) VALUES ($1,$2)
    ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now()`, [key, JSON.stringify(value)]);
  async function settings() {
    const r = await q(`SELECT key, value FROM bkk_settings WHERE key IN ('team_brief_morning','team_brief_evening','team_brief_lang')`);
    const v = k => (r.rows.find(x => x.key === k) || {}).value;
    return { morning: v('team_brief_morning') === 'on' ? 'on' : 'off',
      evening: v('team_brief_evening') === 'on' ? 'on' : 'off', lang: v('team_brief_lang') === 'en' ? 'en' : 'th' };
  }
  const savedGroup = async () => {
    const g = await getSetting('team_line_group');
    return typeof g === 'string' && g ? g : null;
  };
  async function remember(what, extra) {
    const at = new Date(nowMs()).toISOString();
    await q(`INSERT INTO bkk_settings (key,value) VALUES ('team_brief_last',$1)
      ON CONFLICT (key) DO UPDATE SET value = bkk_settings.value || $1::jsonb, updated_at=now()`,
      [JSON.stringify({ [what]: { at, ...extra } })]);
  }
  async function failed(what, error) {
    console.error(`[team] ${what}: ${error}`);
    try { await putSetting('team_brief_error', { at: new Date(nowMs()).toISOString(), what, error: String(error).slice(0, 300) }); }
    catch (e) { console.error('[team] could not store the error:', e.message); }
  }

  // ── send ──────────────────────────────────────────────────────────────────
  // → { ok: true, requestIds } or { ok: false, status, error, transient }.
  // Never throws: a LINE problem is a value, so no caller can crash the server.
  async function teamSend(messages, { seed } = {}) {
    const fail = (status, error, extra = {}) => ({ ok: false, status, error, ...extra });
    try {
      const token = process.env.HELPDESK_LINE_ACCESS_TOKEN;
      if (!token) return fail(503, 'HELPDESK_LINE_ACCESS_TOKEN is not set on the server');
      const built = lineMessages(messages);
      if (built.error) return fail(400, built.error);
      if (!built.messages.length) return fail(400, 'nothing to send');
      const to = await savedGroup();
      if (!to) return fail(409, 'No team group yet: add the AYBKK help desk to the team LINE group, or accept a waiting group (team/group)');
      const requestIds = [];
      const base = seed || crypto.randomUUID();
      for (let i = 0; i < built.messages.length; i += PUSH_MAX) {
        let r;
        try {
          r = await httpFetch(`${LINE_API}/message/push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`,
              'X-Line-Retry-Key': retryKey(`${base}:${i}`) },
            body: JSON.stringify({ to, messages: built.messages.slice(i, i + PUSH_MAX) }),
            signal: AbortSignal.timeout(15000),
          });
        } catch (e) {
          return fail(502, `LINE could not be reached (${e.name === 'TimeoutError' ? 'timeout' : e.message})`,
            { transient: true, requestIds });
        }
        const accepted = r.status === 409 && r.headers.get('x-line-accepted-request-id');
        if (accepted) { requestIds.push(accepted); continue; }
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          return fail(502, `LINE answered ${r.status}${j.message ? `: ${String(j.message).slice(0, 200)}` : ''}`,
            { transient: r.status >= 500, requestIds });
        }
        requestIds.push(r.headers.get('x-line-request-id') || null);
      }
      return { ok: true, requestIds, count: built.messages.length };
    } catch (e) {
      return fail(500, e.message, { transient: true });
    }
  }

  // ── what the team needs to know ───────────────────────────────────────────
  async function classesOn(date) {
    const moon = moonDaysBetween(date, date).get(date);
    if (moon) return { closed: { why: moon }, classes: [] };
    const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
    const [slots, ovs] = await Promise.all([
      q('SELECT * FROM bkk_class_slots WHERE active AND weekday=$1 ORDER BY start_time, is_online, id', [wd]),
      q('SELECT slot_id, cancelled, note FROM bkk_class_overrides WHERE class_date=$1::date', [date]),
    ]);
    const classes = slots.rows.map(s => {
      const ov = ovs.rows.find(o => o.slot_id === s.id);
      return { id: s.id, time: s.start_time, title: s.title, online: s.is_online, duration: s.duration_min || 120,
        teacher: rotationTeacher(s.code, date) || s.teachers || '', off: !!(ov && ov.cancelled), note: ov && ov.cancelled ? ov.note : null };
    });
    if (!classes.length) return { closed: { why: 'none' }, classes };
    if (classes.every(c => c.off)) return { closed: { why: 'cancelled', note: classes.map(c => c.note).find(Boolean) }, classes };
    return { closed: null, classes };
  }

  // A pass that carries on after p ends: the student has already renewed.
  const CARRIES_ON = `EXISTS (SELECT 1 FROM bkk_passes x WHERE x.member_id=p.member_id AND x.id<>p.id
    AND x.status IN ('active','frozen') AND (x.valid_until IS NULL OR x.valid_until > coalesce(p.valid_until, $1::date))
    AND (x.kind='unlimited' OR x.credits_used < x.credits_total))`;
  // Students who were already with the shala before aybkk.net (moved over from Rezerv).
  const FROM_REZERV = `(m.source IS NOT DISTINCT FROM 'rezerv' OR EXISTS (SELECT 1 FROM bkk_passes x WHERE x.member_id=m.id AND x.source='rezerv')
    OR EXISTS (SELECT 1 FROM bkk_bookings x WHERE x.member_id=m.id AND x.source='rezerv'))`;

  async function morning(date, L) {
    const lines = [L.mHead(L.day(date))];
    const { closed, classes } = await classesOn(date);
    if (closed) return { text: [...lines, L.closed(closed)].join('\n') };

    const [seats, fresh, bought, ending, orders] = await Promise.all([
      q(`SELECT b.slot_id, b.member_id, b.need_mat, b.cover, b.pass_id, m.name,
           p.status AS pass_status, to_char(p.valid_until,'YYYY-MM-DD') AS until
         FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id LEFT JOIN bkk_passes p ON p.id=b.pass_id
         WHERE b.class_date=$1::date AND b.status='booked' AND b.slot_id IS NOT NULL ORDER BY lower(m.name), b.id`, [date]),
      // First class ever is today.
      q(`SELECT DISTINCT b.member_id FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id
         WHERE b.class_date=$1::date AND b.status='booked' AND NOT ${FROM_REZERV}
           AND (m.joined_on IS NULL OR m.joined_on >= $1::date - 7)
           AND NOT EXISTS (SELECT 1 FROM bkk_bookings x WHERE x.member_id=b.member_id AND x.status='booked'
             AND x.checked_in_at IS NOT NULL AND x.class_date < $1::date)`, [date]),
      // First pass bought in the last 7 days, never came, not booked today.
      q(`SELECT m.name, fp.item_en, to_char(fp.at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') AS day,
           (SELECT to_char(min(x.class_date),'YYYY-MM-DD') FROM bkk_bookings x WHERE x.member_id=m.id
             AND x.status='booked' AND x.class_date > $1::date) AS next
         FROM bkk_members m
         JOIN LATERAL (SELECT p.created_at AS at, pr.name_en AS item_en FROM bkk_passes p
           LEFT JOIN bkk_products pr ON pr.id=p.product_id WHERE p.member_id=m.id ORDER BY p.created_at, p.id LIMIT 1) fp ON true
         WHERE fp.at >= ($1::date - 7)::timestamp AT TIME ZONE 'Asia/Bangkok'
           AND fp.at < ($1::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok' AND NOT ${FROM_REZERV}
           AND NOT EXISTS (SELECT 1 FROM bkk_bookings x WHERE x.member_id=m.id
             AND ((x.status='booked' AND x.checked_in_at IS NOT NULL) OR (x.class_date=$1::date AND x.status='booked')))
         ORDER BY fp.at`, [date]),
      // Ends within 7 days, or 2 or fewer classes left, nothing after it, and came in the last 30 days.
      q(`SELECT * FROM (SELECT DISTINCT ON (p.member_id) m.name, p.kind, p.credits_total - p.credits_used AS left,
           to_char(p.valid_until,'YYYY-MM-DD') AS until, pr.name_en AS item_en
         FROM bkk_passes p JOIN bkk_members m ON m.id=p.member_id LEFT JOIN bkk_products pr ON pr.id=p.product_id
         WHERE p.status='active' AND (p.valid_until IS NULL OR p.valid_until >= $1::date)
           AND (p.kind='unlimited' OR p.credits_total > 1)
           AND ((p.valid_until IS NOT NULL AND p.valid_until <= $1::date + 7)
             OR (p.kind='credits' AND p.credits_total - p.credits_used <= 2))
           AND EXISTS (SELECT 1 FROM bkk_bookings b WHERE b.member_id=p.member_id AND ${ATTENDED}
             AND b.class_date >= $1::date - 30 AND b.class_date < $1::date)
           AND NOT ${CARRIES_ON}
         ORDER BY p.member_id, p.valid_until DESC NULLS FIRST) e ORDER BY e.until NULLS LAST, lower(e.name)`, [date]),
      // Online orders left unpaid in the last 3 days, unless the same student paid since.
      q(`SELECT m.name, o.refno, o.amount_thb, pr.name_en AS item_en,
           to_char(o.created_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') AS day
         FROM bkk_orders o JOIN bkk_members m ON m.id=o.member_id LEFT JOIN bkk_products pr ON pr.id=o.product_id
         WHERE o.status='pending' AND o.source IS NULL AND o.method='online'
           AND o.created_at >= ($1::date - 3)::timestamp AT TIME ZONE 'Asia/Bangkok'
           AND o.created_at < ($1::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'
           AND NOT EXISTS (SELECT 1 FROM bkk_orders x WHERE x.member_id=o.member_id AND x.status='paid' AND x.created_at > o.created_at)
         ORDER BY o.created_at, o.id`, [date]),
    ]);
    const time = new Map(classes.map(c => [c.id, c.time]));
    const name = r => shortName(r.name);
    let shown = 0;
    for (const c of classes) {
      if (c.off) { lines.push('', L.cOff(c.time, c.title, c.note)); continue; }
      shown++;
      const here = seats.rows.filter(s => s.slot_id === c.id);
      lines.push('', L.cLine(c.time, c.title, c.teacher, here.length), here.length ? here.map(name).join(', ') : L.nobody);
    }

    const freshIds = new Set(fresh.rows.map(r => r.member_id));
    const firstSeat = new Map();
    for (const s of seats.rows) {
      if (!freshIds.has(s.member_id)) continue;
      const t = time.get(s.slot_id) || '';
      if (!firstSeat.has(s.member_id) || t < firstSeat.get(s.member_id).t) firstSeat.set(s.member_id, { t, n: name(s) });
    }
    const newLines = [...[...firstSeat.values()].sort((a, b) => a.t.localeCompare(b.t)).map(x => L.newFirst(x.n, x.t)),
      ...bought.rows.map(r => L.newBought(name(r), L.item(r.item_en), L.day(r.day), r.next && L.day(r.next)))];
    if (newLines.length) lines.push('', L.newH, ...newLines);

    const endLines = ending.rows.map(r => r.kind === 'credits' && r.left <= 2
      ? L.endLeft(name(r), L.item(r.item_en), Math.max(0, r.left), r.until && L.day(r.until))
      : L.endDate(name(r), L.item(r.item_en), L.day(r.until)));
    if (endLines.length) lines.push('', L.endH, ...endLines);

    // A seat booked on an active pass is paid for, even when the pass window
    // starts later (a far class booked first sets it): booking accepted it.
    const why = s => !s.pass_id ? L.why.none : s.pass_status === 'frozen' ? L.why.frozen
      : s.pass_status !== 'active' ? L.why.void : s.until && s.until < date ? L.why.ended(L.day(s.until)) : null;
    const unpaidSeats = seats.rows.filter(s => s.cover !== 'rezerv' && why(s));
    const payLines = [...orders.rows.map(r => L.payOrder(name(r), L.item(r.item_en), baht(r.amount_thb), L.day(r.day), r.refno)),
      ...unpaidSeats.map(s => L.paySeat(name(s), time.get(s.slot_id), why(s)))];
    if (payLines.length) lines.push('', L.payH, ...payLines);

    const mats = classes.map(c => [c, seats.rows.filter(s => s.slot_id === c.id && s.need_mat && !c.off)]).filter(([, m]) => m.length);
    if (mats.length) lines.push('', L.matH, ...mats.map(([c, m]) => `• ${c.time} ${m.map(name).join(', ')}`));

    const live = new Set(classes.filter(c => !c.off).map(c => c.id));
    lines.push('', L.mTotal({ classes: shown, booked: seats.rows.filter(s => live.has(s.slot_id)).length,
      fresh: newLines.length, ending: endLines.length, unpaid: payLines.length,
      mats: mats.reduce((n, [, m]) => n + m.length, 0) }));
    return { text: lines.join('\n') };
  }

  // Signed like the student page's photos (they are private Cloudinary assets),
  // as JPEG: LINE takes JPEG or PNG only, at most 10 MB, preview at most 1 MB.
  function lineImage(publicId) {
    if (!cloudinary || typeof cloudinary.url !== 'function') return null;
    try {
      const at = t => cloudinary.url(publicId, { type: 'authenticated', sign_url: true, secure: true, transformation: [t] });
      const img = {
        type: 'image',
        originalContentUrl: at({ width: 1600, height: 1600, crop: 'limit', quality: 'auto:good', fetch_format: 'jpg' }),
        previewImageUrl: at({ width: 480, height: 480, crop: 'limit', quality: 'auto', fetch_format: 'jpg' }),
      };
      return httpsUrl(img.originalContentUrl) && httpsUrl(img.previewImageUrl) ? img : null;
    } catch (_) { return null; }
  }

  // Practice journal entries are kept in Neo4j, on the member's journal id.
  async function journalEntries(from, to) {
    if (!driver) return null;
    const session = driver.session();
    try {
      const r = await Promise.race([
        session.run(`MATCH (s:Student)-[:HAS_SELF_ASSESSMENT]->(sa:SelfAssessment)
          WHERE s.id STARTS WITH 'bkk-' AND sa.checkedInAt >= datetime($from) AND sa.checkedInAt < datetime($to)
          RETURN s.id AS id, count(sa) AS n`, { from, to }),
        new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 8000).unref()),
      ]);
      const num = v => v && typeof v.toNumber === 'function' ? v.toNumber() : Number(v);
      const counts = new Map(r.records.map(x => [x.get('id'), num(x.get('n'))]));
      if (!counts.size) return { n: 0, names: [] };
      const people = (await q('SELECT journal_id, name FROM bkk_members WHERE journal_id = ANY($1::text[]) ORDER BY lower(name)',
        [[...counts.keys()]])).rows;
      return { n: [...counts.values()].reduce((a, b) => a + b, 0), names: people.map(p => shortName(p.name)) };
    } catch (e) {
      console.warn('[team] journal entries not read:', e.message);
      return null;
    } finally { session.close().catch(() => {}); }
  }

  // From 20:00 yesterday to 20:00 today, so a payment, a sign-up or a chat late
  // at night is in the next summary. Check-ins and no-shows are today's classes.
  async function evening(date, L) {
    const from = bkkAt(addDays(date, -1), BRIEF_AT.evening), to = bkkAt(date, BRIEF_AT.evening);
    const cut = Math.min(Date.parse(to), nowMs());
    const W = [from, to];
    const tomorrow = addDays(date, 1);
    const one = async (sql, args = W) => (await q(sql, args)).rows[0];
    const all = async (sql, args = W) => (await q(sql, args)).rows;
    const unpaidStill = `o.status='pending' AND o.source IS NULL AND o.created_at >= $1 AND o.created_at < $2
      AND NOT EXISTS (SELECT 1 FROM bkk_orders x WHERE x.member_id=o.member_id AND x.status='paid' AND x.created_at > o.created_at)`;
    const [paid, pending, mismatch, joined, started, ended, seats, made, today, next, nextSeats,
      photos, tagged, notes, checks, tokens, letter, start, journal] = await Promise.all([
      all(`SELECT o.method, o.amount_thb, o.vat_thb, o.product_id, coalesce(pr.name_en, o.item_name) AS item_en
           FROM bkk_orders o LEFT JOIN bkk_products pr ON pr.id=o.product_id
           WHERE o.status='paid' AND o.source IS NULL
             AND coalesce(o.verified_at, o.created_at) >= $1 AND coalesce(o.verified_at, o.created_at) < $2`),
      one(`SELECT count(*)::int AS n, coalesce(sum(o.amount_thb),0)::int AS total FROM bkk_orders o WHERE ${unpaidStill}`),
      one(`SELECT count(*)::int AS n FROM bkk_orders o WHERE o.status='mismatch' AND o.created_at >= $1 AND o.created_at < $2`),
      all(`SELECT name FROM bkk_members WHERE created_at >= $1 AND created_at < $2 AND source IS DISTINCT FROM 'rezerv'
           ORDER BY created_at, id`),
      all(`SELECT m.name, pr.name_en AS item_en FROM bkk_passes p
           JOIN bkk_members m ON m.id=p.member_id LEFT JOIN bkk_products pr ON pr.id=p.product_id
           WHERE p.valid_from=$1::date AND p.status IN ('active','frozen') AND p.created_at < $2
             AND (p.kind='unlimited' OR p.credits_total > 1) ORDER BY lower(m.name)`, [date, to]),
      all(`SELECT m.name, ${CARRIES_ON} AS renewed FROM bkk_passes p JOIN bkk_members m ON m.id=p.member_id
           WHERE p.status='active' AND (p.kind='unlimited' OR p.credits_total > 1)
             AND (p.valid_until=$1::date OR (p.kind='credits' AND p.credits_used >= p.credits_total
               AND EXISTS (SELECT 1 FROM bkk_bookings b WHERE b.pass_id=p.id AND b.status='booked' AND b.class_date=$1::date)
               AND NOT EXISTS (SELECT 1 FROM bkk_bookings b WHERE b.pass_id=p.id AND b.status='booked' AND b.class_date>$1::date)))
           ORDER BY lower(m.name)`, [date]),
      all(`SELECT b.slot_id, b.checked_in_at, m.name FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id
           WHERE b.class_date=$1::date AND b.status='booked' AND b.slot_id IS NOT NULL ORDER BY lower(m.name)`, [date]),
      one(`SELECT count(*) FILTER (WHERE booked_at >= $1 AND booked_at < $2)::int AS made,
             count(*) FILTER (WHERE cancelled_at >= $1 AND cancelled_at < $2)::int AS off,
             count(*) FILTER (WHERE cancelled_at >= $1 AND cancelled_at < $2 AND cancel_reason LIKE 'class cancelled:%')::int AS by_shala
           FROM bkk_bookings WHERE slot_id IS NOT NULL AND source IS DISTINCT FROM 'rezerv'
             AND (booked_at >= $1 OR cancelled_at >= $1)`),
      classesOn(date),
      classesOn(tomorrow),
      all(`SELECT slot_id, count(*)::int AS n, count(*) FILTER (WHERE need_mat)::int AS mats FROM bkk_bookings
           WHERE class_date=$1::date AND status='booked' GROUP BY slot_id`, [tomorrow]),
      all(`SELECT p.id, p.public_id, EXISTS (SELECT 1 FROM bkk_photo_members pm WHERE pm.photo_id=p.id) AS tagged
           FROM bkk_photos p WHERE p.created_at >= $1 AND p.created_at < $2 ORDER BY p.id`),
      one(`SELECT count(DISTINCT pm.member_id)::int AS n FROM bkk_photo_members pm JOIN bkk_photos p ON p.id=pm.photo_id
           WHERE p.created_at >= $1 AND p.created_at < $2`),
      all(`SELECT coalesce(t.name,'?') AS teacher, count(*)::int AS n FROM bkk_notes n LEFT JOIN bkk_teachers t ON t.id=n.teacher_id
           WHERE n.created_at >= $1 AND n.created_at < $2 GROUP BY 1 ORDER BY n DESC, 1`),
      all(`SELECT m.name FROM bkk_checks c JOIN bkk_members m ON m.id=c.member_id
           WHERE c.created_at >= $1 AND c.created_at < $2 ORDER BY lower(m.name)`),
      one(`SELECT count(DISTINCT member_id) FILTER (WHERE used_at >= $1 AND used_at < $2)::int AS opened,
             count(*) FILTER (WHERE ip='staff' AND created_at >= $1 AND created_at < $2)::int AS links
           FROM bkk_login_tokens WHERE created_at >= $1::timestamptz - interval '31 days' AND created_at < $2`),
      one(`SELECT count(*) FILTER (WHERE confirmed_at >= $1 AND confirmed_at < $2)::int AS yes,
             count(*) FILTER (WHERE status='pending' AND created_at >= $1 AND created_at < $2)::int AS wait,
             count(*) FILTER (WHERE unsubscribed_at >= $1 AND unsubscribed_at < $2)::int AS left
           FROM bkk_newsletter`),
      one(`SELECT count(*) FILTER (WHERE kind='view')::int AS views, count(*) FILTER (WHERE kind='tap')::int AS taps,
             count(*) FILTER (WHERE kind='step' AND ch LIKE 'done%')::int AS done
           FROM bkk_start_events WHERE created_at >= $1 AND created_at < $2 AND src IS DISTINCT FROM 'letter'`),
      journalEntries(from, to),
    ]);
    // The inbox has its own table (inbox.js); a server without it still briefs.
    let inbox = [];
    try {
      inbox = await all(`SELECT channel, count(DISTINCT sender_id)::int AS people,
          count(DISTINCT sender_id) FILTER (WHERE NOT EXISTS (SELECT 1 FROM aybkk_inbox y
            WHERE y.channel=x.channel AND y.sender_id=x.sender_id AND y.created_at < $1))::int AS fresh,
          count(DISTINCT sender_id) FILTER (WHERE triage->>'lane'='hot')::int AS hot, count(*)::int AS n
        FROM aybkk_inbox x WHERE direction='in' AND created_at >= $1 AND created_at < $2 GROUP BY channel`);
    } catch (_) {}

    const name = r => shortName(r.name);
    // Sent by hand before 20:00, it says how far the day has got.
    const upTo = cut > Date.parse(from) ? new Date(cut + 7 * 3600000).toISOString().slice(11, 16) : BRIEF_AT.evening;
    const lines = [L.eHead(L.day(date), upTo)];

    const sum = (rows, k) => rows.reduce((n, r) => n + (Number(r[k]) || 0), 0);
    const total = sum(paid, 'amount_thb');
    lines.push('', L.moneyH, paid.length ? L.paid(paid.length, baht(total), baht(sum(paid, 'vat_thb'))) : L.paidNone);
    const byItem = new Map();
    for (const o of paid) {
      const k = o.product_id || o.item_en;
      const it = byItem.get(k) || { item: L.item(o.item_en), n: 0, total: 0 };
      it.n++; it.total += o.amount_thb;
      byItem.set(k, it);
    }
    lines.push(...[...byItem.values()].sort((a, b) => b.total - a.total).map(i => L.moneyItem(i.item, i.n, baht(i.total))));
    const desk = ['cash', 'transfer', 'card'].map(m => [m, paid.filter(o => o.method === m)]).filter(([, r]) => r.length);
    if (desk.length) lines.push(L.desk(desk.map(([m, r]) => `${L.method[m]} ${r.length} ${baht(sum(r, 'amount_thb'))}`).join(' · ')));
    const online = paid.filter(o => !['cash', 'transfer', 'card'].includes(o.method));
    if (online.length && desk.length) lines.push(L.online(online.length, baht(sum(online, 'amount_thb'))));
    if (pending.n) lines.push(L.pending(pending.n, baht(pending.total)));
    if (mismatch.n) lines.push(L.mismatch(mismatch.n));

    lines.push('', L.peopleH, L.joined(joined.length, list(joined.map(name))));
    if (started.length) lines.push(L.started(started.length,
      list(started.map(r => `${name(r)} (${L.item(r.item_en)})`))));
    if (ended.length) lines.push(L.ended(ended.length, list(ended.map(r => `${name(r)} (${L.renewed(r.renewed)})`))));

    lines.push('', L.classesH);
    let came = 0;
    if (today.closed) lines.push(L.closed(today.closed));
    else {
      for (const c of today.classes) {
        if (c.off) { lines.push(L.cOff(c.time, c.title, c.note)); continue; }
        const here = seats.filter(s => s.slot_id === c.id);
        const inN = here.filter(s => s.checked_in_at).length;
        came += inN;
        const over = Date.parse(bkkAt(date, c.time)) + c.duration * 60000 <= cut;
        const missed = over ? here.filter(s => !s.checked_in_at).map(name) : [];
        lines.push(L.came(c.time, c.title, inN, here.length, list(missed)));
      }
    }
    lines.push(L.bookings(made.made, made.off, made.by_shala));

    let booked = 0;
    lines.push('', L.tomorrowH(L.day(tomorrow)));
    if (next.closed) lines.push(L.tClosed(next.closed));
    else {
      for (const c of next.classes) {
        if (c.off) { lines.push(L.cOff(c.time, c.title, c.note)); continue; }
        const n = nextSeats.find(s => s.slot_id === c.id) || { n: 0, mats: 0 };
        booked += n.n;
        lines.push(L.tLine(c.time, c.title, n.n, n.mats));
      }
    }

    lines.push('', L.photosH, photos.length ? L.photos(photos.length, photos.filter(p => p.tagged).length, tagged.n) : L.photosNone);
    const images = [];
    for (const p of [...photos].sort((a, b) => (b.tagged - a.tagged) || (b.id - a.id))) {
      if (images.length >= 4) break;
      const img = lineImage(p.public_id);
      if (img) images.push(img);
    }

    const profile = [];
    const noteN = sum(notes, 'n');
    if (noteN) profile.push(L.notes(noteN, notes.map(t => `${t.teacher} ${t.n}`).join(', ')));
    if (checks.length) profile.push(L.checks(checks.length, list(checks.map(name))));
    if (journal && journal.n) profile.push(L.journal(journal.n, list(journal.names)));
    profile.push(L.signins(tokens.opened, tokens.links));
    lines.push('', L.profileH, ...profile);

    const leads = [L.letter(letter.yes, letter.wait, letter.left), L.start(start.views, start.taps, start.done)];
    const ch = k => inbox.find(r => r.channel === k);
    if (ch('lead')) leads.push(L.forms(ch('lead').n));
    for (const k of Object.keys(CHAT)) if (ch(k)) leads.push(L.chat(CHAT[k], ch(k).people, ch(k).fresh, ch(k).hot));
    if (ch('apply')) leads.push(L.apply(ch('apply').n));
    lines.push('', L.leadsH, ...leads);

    lines.push('', L.eTotal({ money: baht(total), came, tomorrow: booked }));
    return { text: lines.join('\n'), images };
  }

  // → { kind, date, lang, text, images, messages }: the LINE messages, one push
  // when it fits (a free plan counts every push), so images fill what text leaves.
  async function build(kind, date, lang) {
    const L = WORDS[lang] || WORDS.th;
    const b = kind === 'evening' ? await evening(date, L) : await morning(date, L);
    const texts = splitText(b.text);
    const images = (b.images || []).slice(0, Math.max(0, PUSH_MAX - texts.length));
    return { kind, date, lang: WORDS[lang] ? lang : 'th', text: b.text, images,
      messages: [...texts.map(text => ({ type: 'text', text })), ...images] };
  }

  // ── the timer ─────────────────────────────────────────────────────────────
  // One marker row per brief per day, claimed before anything is sent: two
  // servers, or a restart, can never send one twice. Only when LINE did not
  // answer (down, timeout) is the marker given back for another try, and the
  // retry key makes LINE drop a push it already has.
  async function claim(key) {
    const first = await q(`INSERT INTO bkk_settings (key,value) VALUES ($1,'{"state":"sending","tries":1}')
      ON CONFLICT (key) DO NOTHING RETURNING value`, [key]);
    if (first.rows.length) return first.rows[0].value;
    const again = await q(`UPDATE bkk_settings SET value = value || jsonb_build_object('state','sending',
        'tries', coalesce((value->>'tries')::int, 0) + 1), updated_at=now()
      WHERE key=$1 AND value->>'state'='retry' RETURNING value`, [key]);
    return again.rows[0] ? again.rows[0].value : null;
  }
  const settle = (key, value) => q(`UPDATE bkk_settings SET value = value || $2::jsonb, updated_at=now() WHERE key=$1`,
    [key, JSON.stringify(value)]);

  async function sendBrief(kind, date, lang) {
    const key = `${MARKER}${kind}_${date}`;
    const mark = await claim(key);
    if (!mark) return { kind, date, sent: false, skipped: 'already' };
    let r;
    try {
      const b = await build(kind, date, lang);
      r = await teamSend(b.messages, { seed: key });
    } catch (e) { r = { ok: false, error: e.message, transient: true }; }
    if (r.ok) {
      await settle(key, { state: 'sent', at: new Date(nowMs()).toISOString(), requestIds: r.requestIds });
      await remember(kind, { date, requestIds: r.requestIds });
    } else {
      await settle(key, { state: r.transient && mark.tries < TRIES ? 'retry' : 'failed', error: r.error });
      await failed(`${kind} brief ${date}`, r.error);
    }
    q(`DELETE FROM bkk_settings WHERE left(key, ${MARKER.length}) = $1 AND updated_at < now() - interval '30 days'`, [MARKER])
      .catch(() => {});
    return { kind, date, sent: !!r.ok, error: r.ok ? undefined : r.error };
  }

  // Due: at the hour, or late by under an hour (a restart, a deploy). Later
  // than that, the day's brief is skipped: an old brief only confuses.
  async function tick(at = nowMs()) {
    const date = bkkYmd(at);
    const due = Object.keys(BRIEF_AT).filter(kind => {
      const t = Date.parse(bkkAt(date, BRIEF_AT[kind]));
      return at >= t && at < t + LATE_MIN * 60000;
    });
    if (!due.length) return [];
    const out = [];
    try {
      const s = await settings();
      for (const kind of due) if (s[kind] === 'on') out.push(await sendBrief(kind, date, s.lang));
    } catch (e) { await failed('timer', e.message); }
    return out;
  }
  let timer = null;
  function start() {
    if (timer) return;
    const run = () => tick().catch(e => console.error('[team] tick failed:', e.message));
    timer = setInterval(run, 60 * 1000);
    timer.unref();
    setTimeout(run, 20 * 1000).unref();
  }
  const stop = () => { clearInterval(timer); timer = null; };

  // ── webhook ───────────────────────────────────────────────────────────────
  async function groupName(id) {
    const token = process.env.HELPDESK_LINE_ACCESS_TOKEN;
    if (!token) return null;
    try {
      const r = await httpFetch(`${LINE_API}/group/${encodeURIComponent(id)}/summary`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
      return r.ok ? String((await r.json()).groupName || '').slice(0, 80) || null : null;
    } catch (_) { return null; }
  }

  // Which group gets the briefs ('team_line_group') and every group seen
  // ('team_line_groups'), changed together under one lock. fn edits st.
  async function withGroups(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO bkk_settings (key,value) VALUES ('team_line_groups','[]') ON CONFLICT (key) DO NOTHING`);
      const seen = (await client.query(`SELECT value FROM bkk_settings WHERE key='team_line_groups' FOR UPDATE`)).rows[0].value;
      const cur = (await client.query(`SELECT value FROM bkk_settings WHERE key='team_line_group'`)).rows[0];
      const st = { groups: Array.isArray(seen) ? seen : [], saved: cur && typeof cur.value === 'string' ? cur.value : null };
      const was = { groups: JSON.stringify(st.groups), saved: st.saved };
      const out = await fn(st);
      const s = st.groups.find(g => g.id === st.saved);
      st.groups = st.groups.slice(0, GROUPS_KEPT);
      if (s && !st.groups.includes(s)) st.groups[st.groups.length - 1] = s;   // the saved group is always kept
      if (JSON.stringify(st.groups) !== was.groups) {
        await client.query(`UPDATE bkk_settings SET value=$1, updated_at=now() WHERE key='team_line_groups'`, [JSON.stringify(st.groups)]);
      }
      if (st.saved !== was.saved) {
        if (st.saved) await client.query(`INSERT INTO bkk_settings (key,value) VALUES ('team_line_group',$1)
          ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now()`, [JSON.stringify(st.saved)]);
        else await client.query(`DELETE FROM bkk_settings WHERE key='team_line_group'`);
      }
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
  }
  const tell = text => Promise.resolve(notify(text)).catch(() => {});
  const quoted = name => `"${name || 'no name'}"`;

  // The first group the help desk joins gets the briefs. A join to another
  // group while one is saved only waits in the list: anyone who can add the
  // help desk to a group could otherwise take the next brief, with its names
  // and photos. Boonchu hears of every join. A join LINE sends again late
  // never undoes a later join or leave.
  async function joined(id, ts) {
    const at = new Date(Number.isFinite(ts) ? ts : nowMs()).toISOString();
    const name = await groupName(id);
    const r = await withGroups(st => {
      const had = st.groups.find(g => g.id === id);
      if (had && (had.joinedAt > at || (had.leftAt && had.leftAt > at))) return null;
      if (had && had.joinedAt === at && !had.leftAt) return null;   // the same join sent again
      const first = !st.saved;
      if (first) st.saved = id;
      const waits = st.saved !== id;
      st.groups = [{ id, name: name || (had && had.name) || null, joinedAt: at, leftAt: null, pending: waits },
        ...st.groups.filter(g => g.id !== id)];
      return { first, waits, current: (st.groups.find(g => g.id === st.saved) || {}).name };
    });
    if (!r) return;
    if (r.first) {
      console.log('[team] help desk joined a LINE group: team briefs go there now');
      tell(`AYBKK help desk joined the LINE group ${quoted(name)}. The team briefs go to that group now. ` +
        `If that was not you, remove the help desk from that group.`);
    } else if (r.waits) {
      console.log('[team] help desk was added to another LINE group: it waits, the briefs stay where they are');
      tell(`AYBKK help desk was added to another LINE group, ${quoted(name)}. The team briefs still go to ${quoted(r.current)}. ` +
        `Nothing moves unless the Desk or staff accept the new group. If you did not add it, ask the Desk to leave that group.`);
    }
  }

  async function left(id, ts) {
    const at = new Date(Number.isFinite(ts) ? ts : nowMs()).toISOString();
    const cleared = await withGroups(st => {
      const had = st.groups.find(g => g.id === id);
      if (had && had.joinedAt > at) return false;   // left before a later join
      if (had) Object.assign(had, { leftAt: at, pending: false });
      if (st.saved !== id) return false;
      st.saved = null;
      return true;
    });
    if (cleared) console.log('[team] help desk left the team group: briefs wait for a new group');
  }

  // Only group joins and leaves are read. Every other event, a message in the
  // group or a 1:1 chat included, is answered 200 and dropped unread.
  app.post('/line/helpdesk-webhook', raw, async (req, res) => {
    const secret = process.env.HELPDESK_LINE_CHANNEL_SECRET;
    if (!secret) return res.sendStatus(503);
    const body = Buffer.isBuffer(req.body) ? req.body : req.rawBody;
    if (!signed(body, req.headers['x-line-signature'], secret)) {
      stats.badSignatures++;
      return res.sendStatus(401);
    }
    let events = [];
    try { events = JSON.parse(body.toString('utf8')).events; } catch (_) {}
    for (const ev of Array.isArray(events) ? events : []) {
      const src = ev && ev.source;
      if (!src || src.type !== 'group' || typeof src.groupId !== 'string' || !src.groupId) continue;
      try {
        if (ev.type === 'join') await joined(src.groupId, ev.timestamp);
        else if (ev.type === 'leave') await left(src.groupId, ev.timestamp);
      } catch (e) { await failed('webhook', e.message); }
    }
    res.sendStatus(200);
  }, (err, req, res, next) => res.sendStatus(err.status === 413 ? 413 : 400));

  // ── admin (x-bkk-key: the Desk assistant, and staff) ──────────────────────
  let quotaCache = { at: 0, value: null };
  async function quota() {
    const token = process.env.HELPDESK_LINE_ACCESS_TOKEN;
    if (!token) return null;
    if (quotaCache.value && nowMs() - quotaCache.at < 10 * 60000) return quotaCache.value;
    try {
      const get = p => httpFetch(`${LINE_API}/message/${p}`, { headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000) }).then(r => r.ok ? r.json() : null);
      const [limit, used] = await Promise.all([get('quota'), get('quota/consumption')]);
      if (!limit || !used) return null;
      quotaCache = { at: nowMs(), value: { limit: limit.type === 'limited' ? limit.value : null, used: used.totalUsage } };
      return quotaCache.value;
    } catch (_) { return null; }
  }

  app.get('/api/bkk/admin/team/status', adminOnly, async (req, res) => {
    try {
      const [s, group, seen, last, error, usage] = await Promise.all([settings(), savedGroup(),
        getSetting('team_line_groups'), getSetting('team_brief_last'), getSetting('team_brief_error'), quota()]);
      const groups = Array.isArray(seen) ? seen : [];
      const g = group && groups.find(x => x.id === group);
      const next = kind => {
        const now = nowMs(), today = bkkYmd(now);
        const t = Date.parse(bkkAt(today, BRIEF_AT[kind]));
        return new Date(t > now ? t : Date.parse(bkkAt(addDays(today, 1), BRIEF_AT[kind]))).toISOString();
      };
      res.json({
        channel: { secretSet: !!process.env.HELPDESK_LINE_CHANNEL_SECRET, tokenSet: !!process.env.HELPDESK_LINE_ACCESS_TOKEN },
        group: { saved: !!group, ref: group ? groupRef(group) : null, name: g ? g.name : null, joinedAt: g ? g.joinedAt : null },
        // pending: the help desk is in it, it gets nothing until accepted (team/group).
        groupsSeen: groups.map(x => ({ ref: groupRef(x.id), name: x.name, joinedAt: x.joinedAt, leftAt: x.leftAt,
          saved: x.id === group, pending: !!x.pending && !x.leftAt && x.id !== group })),
        briefs: { morning: s.morning, evening: s.evening, lang: s.lang, at: BRIEF_AT,
          next: { morning: s.morning === 'on' ? next('morning') : null, evening: s.evening === 'on' ? next('evening') : null } },
        lastSent: last || {},
        lastError: error,
        quota: usage,
        badSignatures: stats.badSignatures,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  const briefArgs = (src, res) => {
    const kind = String(src.kind || '');
    if (!BRIEF_AT[kind]) { res.status(400).json({ error: 'kind must be morning or evening' }); return null; }
    return kind;
  };

  app.get('/api/bkk/admin/team/preview', adminOnly, async (req, res) => {
    const kind = briefArgs(req.query, res);
    if (!kind) return;
    const date = req.query.date == null || req.query.date === '' ? bkkYmd(nowMs()) : String(req.query.date);
    if (!realYmd(date)) return res.status(400).json({ error: 'date must be a date (YYYY-MM-DD)' });
    if (req.query.lang && !WORDS[req.query.lang]) return res.status(400).json({ error: 'lang must be th or en' });
    try {
      const lang = req.query.lang || (await settings()).lang;
      const b = await build(kind, date, lang);
      res.json({ ...b, images: b.images.map(i => ({ original: i.originalContentUrl, preview: i.previewImageUrl })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // By hand it is the day's brief, on the same marker as the timer: the timer
  // never posts it again, and after an outage it keeps the timer's retry key,
  // so LINE drops a push it already has. A second one needs force: true. An
  // evening summary before 20:00 is "so far" and leaves the 20:00 one alone.
  app.post('/api/bkk/admin/team/brief', adminOnly, async (req, res) => {
    const kind = briefArgs(req.body || {}, res);
    if (!kind) return;
    const force = (req.body || {}).force === true;
    try {
      const now = nowMs(), date = bkkYmd(now);
      const sofar = kind === 'evening' && now < Date.parse(bkkAt(date, BRIEF_AT.evening));
      const key = `${MARKER}${kind}_${date}`;
      let mark = null;
      if (!sofar) {
        mark = (await q(`INSERT INTO bkk_settings (key,value) VALUES ($1,'{"state":"sending","tries":0,"byHand":true}')
          ON CONFLICT (key) DO UPDATE SET value = bkk_settings.value || '{"state":"sending","byHand":true}'::jsonb, updated_at=now()
          WHERE bkk_settings.value->>'state' IN ('retry','failed') RETURNING value`, [key])).rows[0] || null;
        if (!mark && !force) {
          const v = (await getSetting(key)) || {};
          const at = v.at ? ` at ${new Date(Date.parse(v.at) + 7 * 3600000).toISOString().slice(11, 16)}` : '';
          return res.status(409).json({ error: v.state === 'sent'
            ? `The ${kind} brief for today was already sent${at}. Send { "kind": "${kind}", "force": true } to post it again.`
            : `The ${kind} brief for today is being sent right now.`, state: v.state || null });
        }
      }
      let r;
      try {
        const b = await build(kind, date, (await settings()).lang);
        r = await teamSend(b.messages, mark ? { seed: key } : {});
        r.images = b.images.length;
      } catch (e) { r = { ok: false, status: 500, error: e.message, transient: true }; }
      if (mark) await settle(key, r.ok ? { state: 'sent', at: new Date(nowMs()).toISOString(), requestIds: r.requestIds, byHand: true }
        : { state: r.transient ? 'retry' : 'failed', error: r.error });
      if (!r.ok) { await failed(`${kind} brief ${date} (sent by hand)`, r.error); return res.status(r.status).json({ error: r.error }); }
      await remember(kind, { date, requestIds: r.requestIds, byHand: true });
      res.json({ ok: true, kind, date, sofar, requestIds: r.requestIds, images: r.images });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // What Boonchu approved, as he approved it: one text, no change.
  app.post('/api/bkk/admin/team/send', adminOnly, async (req, res) => {
    const text = (req.body || {}).text;
    if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text required' });
    if (text.length > SEND_MAX) return res.status(400).json({ error: `text is longer than ${SEND_MAX} characters` });
    // One approved message is one push: never half of it in the group.
    if (lineMessages([text]).messages.length > PUSH_MAX) {
      return res.status(400).json({ error: `too long for one LINE post (at most ${PUSH_MAX} parts of ${TEXT_MAX} characters, split at line ends)` });
    }
    try {
      const r = await teamSend([text]);
      if (!r.ok) { await failed('message', r.error); return res.status(r.status).json({ error: r.error }); }
      await remember('message', { requestIds: r.requestIds });
      res.json({ ok: true, requestId: r.requestIds[0], requestIds: r.requestIds });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Which group gets the briefs: { accept: ref } moves them to a group the
  // help desk is in, { leave: ref } makes it leave a group, { clear: true }
  // stops them until a group is accepted or joined. ref is from team/status.
  app.post('/api/bkk/admin/team/group', adminOnly, async (req, res) => {
    const b = req.body || {};
    const ref = typeof (b.accept || b.leave) === 'string' ? (b.accept || b.leave) : '';
    if (!ref && b.clear !== true) return res.status(400).json({ error: 'send { accept: ref }, { leave: ref } or { clear: true }' });
    try {
      if (b.clear === true) {
        const was = await withGroups(st => { const w = st.saved; st.saved = null; return w; });
        if (was) tell('The team briefs are stopped: no LINE group gets them until one is accepted on the Desk.');
        return res.json({ ok: true, saved: false });
      }
      const seen = await getSetting('team_line_groups');
      const g = (Array.isArray(seen) ? seen : []).find(x => groupRef(x.id) === ref);
      if (!g) return res.status(404).json({ error: 'no group with that ref (see groupsSeen in team/status)' });
      if (b.accept) {
        const r = await withGroups(st => {
          const x = st.groups.find(y => y.id === g.id);
          if (!x || x.leftAt) return { gone: true };
          const moved = st.saved !== x.id;
          st.saved = x.id;
          x.pending = false;
          return { moved, name: x.name };
        });
        if (r.gone) return res.status(409).json({ error: 'the help desk is not in that group any more' });
        if (r.moved) tell(`The team briefs go to the LINE group ${quoted(r.name)} now (accepted on the Desk).`);
        return res.json({ ok: true, saved: true, ref, name: r.name });
      }
      const token = process.env.HELPDESK_LINE_ACCESS_TOKEN;
      if (!token) return res.status(503).json({ error: 'HELPDESK_LINE_ACCESS_TOKEN is not set on the server' });
      let lr;
      try {
        lr = await httpFetch(`${LINE_API}/group/${encodeURIComponent(g.id)}/leave`, { method: 'POST',
          headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
      } catch (e) { return res.status(502).json({ error: `LINE could not be reached (${e.message})` }); }
      if (!lr.ok) {
        const j = await lr.json().catch(() => ({}));
        return res.status(502).json({ error: `LINE answered ${lr.status}${j.message ? `: ${String(j.message).slice(0, 200)}` : ''}` });
      }
      const saved = await withGroups(st => {
        const x = st.groups.find(y => y.id === g.id);
        if (x) Object.assign(x, { leftAt: new Date(nowMs()).toISOString(), pending: false });
        if (st.saved === g.id) st.saved = null;
        return !!st.saved;
      });
      res.json({ ok: true, left: true, ref, saved });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return { tick, start, stop, send: teamSend, build };
}

module.exports = { mountTeam, HELPDESK_PATH_RE, shortName, splitText, retryKey };
