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
// group or a 1:1 chat is never stored, logged or forwarded.
// Briefs name students by first name and family initial only: no email, phone
// or member code ever goes to LINE.

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

// "Anna Maria Bell" → "Anna Maria B."; one word stays as it is. Words that look
// like an email or a phone number are dropped. A Thai family name is shortened
// to its first consonant, not a leading vowel.
function shortName(raw) {
  const words = String(raw || '').replace(/\([^)]*\)/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ')
    .split(/\s+/).filter(w => w && !/@|\d{3,}/.test(w));
  if (!words.length) return '?';
  if (words.length === 1) return [...words[0]].slice(0, 30).join('');
  const last = words.pop();
  const first = [...last.replace(/^[เ-ไ]+/, '')][0] || [...last][0];
  return `${[...words.join(' ')].slice(0, 30).join('')} ${first.toUpperCase()}.`;
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
const CLASS_TH = [[/\[Online\]/g, '[ออนไลน์]'], [/Mysore Sunday/g, 'มายซอร์ วันอาทิตย์'], [/Mysore/g, 'มายซอร์'],
  [/\(1st batch\)/g, '(รอบแรก)'], [/\(2nd batch\)/g, '(รอบสอง)']];
const baht = n => '฿' + Math.round(Number(n) || 0).toLocaleString('en-US');
const list = (names, max = 15) => names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max}` : names.join(', ');

const WORDS = {
  th: {
    day: d => { const t = new Date(`${d}T12:00:00Z`); return `${WD.th[t.getUTCDay()]} ${t.getUTCDate()} ${MON.th[t.getUTCMonth()]}`; },
    cls: s => CLASS_TH.reduce((x, [re, to]) => x.replace(re, to), String(s || '')).replace(/ series/g, ''),
    item: (en, th) => th || en || 'แพ็กเกจ',
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
    payH: '💳 ยังไม่จ่าย',
    payOrder: (n, item, amount, day, ref) => `• ${n} สั่ง ${item} ${amount} ยังไม่ได้จ่าย (สั่ง ${day}, ref ${ref})`,
    paySeat: (n, time, why) => `• ${n} จอง ${time} ${why}`,
    why: { none: 'แต่ยังไม่มีแพ็กเกจ', ended: d => `แต่แพ็กเกจหมดไปแล้ว ${d}`, frozen: 'แต่แพ็กเกจพักไว้อยู่',
      void: 'แต่แพ็กเกจถูกยกเลิกแล้ว', later: d => `แต่แพ็กเกจเริ่ม ${d}` },
    matH: '🧘 ขอเช่าเสื่อ',
    mTotal: o => `รวม ${o.classes} คลาส · จอง ${o.booked} · ใหม่ ${o.fresh} · ใกล้หมด ${o.ending} · ยังไม่จ่าย ${o.unpaid} · เสื่อ ${o.mats}`,

    eHead: (d, upTo) => `🌙 สรุปวันนี้ ${d} (ถึง ${upTo})`,
    moneyH: '💰 เงิน',
    paid: (n, total, vat) => `จ่ายแล้ว ${n} รายการ ${total} (รวม VAT ${vat})`,
    paidNone: 'วันนี้ยังไม่มีคนจ่าย',
    moneyItem: (item, n, total) => `• ${item} ×${n} ${total}`,
    method: { cash: 'เงินสด', transfer: 'โอน', card: 'บัตร', online: 'ออนไลน์', other: 'อื่นๆ' },
    desk: parts => `ที่เคาน์เตอร์ ${parts}`,
    online: (n, total) => `ออนไลน์ ${n} รายการ ${total}`,
    pending: (n, total) => `ค้างจ่าย ${n} รายการ ${total}`,
    mismatch: n => `⚠ ยอดไม่ตรง ${n} รายการ เช็กในหน้า Payments`,
    peopleH: '👥 นักเรียน',
    joined: (n, names) => `สมัครใหม่ ${n}${names ? `: ${names}` : ''}`,
    started: (n, names) => `เริ่มแพ็กเกจ ${n}: ${names}`,
    ended: (n, names) => `แพ็กเกจหมดวันนี้ ${n}: ${names}`,
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
    checks: (n, names) => `เช็กผล 12 สัปดาห์ ${n}: ${names}`,
    journal: (n, names) => `บันทึกการฝึก ${n}: ${names}`,
    signins: (n, links) => `เข้าโปรไฟล์ ${n} คน · ครูส่งลิงก์ ${links}`,
    leadsH: '📣 ลีด',
    letter: (yes, wait, left) => `จดหมายวันจันทร์ ยืนยัน ${yes} · รอยืนยัน ${wait}${left ? ` · เลิกรับ ${left}` : ''}`,
    start: (views, taps, done) => `หน้า /start เข้าชม ${views} · กดปุ่ม ${taps} · ทำครบ ${done}`,
    forms: n => `ฟอร์มลีด ${n}`,
    chat: (where, n, fresh, hot) => `${where} แชต ${n} คน (คนใหม่ ${fresh}) · ด่วน ${hot}`,
    apply: n => `ใบสมัคร In-Depth ${n}`,
    eTotal: o => `วันนี้เงินเข้า ${o.money} · มาเรียน ${o.came} · พรุ่งนี้จองแล้ว ${o.tomorrow}`,
  },
  en: {
    day: d => { const t = new Date(`${d}T12:00:00Z`); return `${WD.en[t.getUTCDay()]} ${t.getUTCDate()} ${MON.en[t.getUTCMonth()]}`; },
    cls: s => String(s || '').replace(/ series/g, ''),
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
    payH: '💳 Not paid',
    payOrder: (n, item, amount, day, ref) => `• ${n}: ${item} ${amount} not paid (ordered ${day}, ref ${ref})`,
    paySeat: (n, time, why) => `• ${n}: booked ${time} but ${why}`,
    why: { none: 'has no pass', ended: d => `the pass ended ${d}`, frozen: 'the pass is paused',
      void: 'the pass was voided', later: d => `the pass starts ${d}` },
    matH: '🧘 Needs a mat',
    mTotal: o => `Total: ${o.classes} classes · ${o.booked} booked · ${o.fresh} new · ${o.ending} ending · ${o.unpaid} not paid · ${o.mats} mats`,

    eHead: (d, upTo) => `🌙 Today on aybkk.net, ${d} (to ${upTo})`,
    moneyH: '💰 Money',
    paid: (n, total, vat) => `Paid: ${n} orders, ${total} (VAT ${vat} included)`,
    paidNone: 'No payments yet today',
    moneyItem: (item, n, total) => `• ${item} ×${n} ${total}`,
    method: { cash: 'cash', transfer: 'transfer', card: 'card', online: 'online', other: 'other' },
    desk: parts => `At the desk: ${parts}`,
    online: (n, total) => `Online: ${n} orders ${total}`,
    pending: (n, total) => `Still pending: ${n} orders ${total}`,
    mismatch: n => `⚠ Amount mismatch: ${n} orders, check Payments`,
    peopleH: '👥 Students',
    joined: (n, names) => `New members: ${n}${names ? `: ${names}` : ''}`,
    started: (n, names) => `Passes started: ${n}: ${names}`,
    ended: (n, names) => `Passes ended today: ${n}: ${names}`,
    renewed: r => r ? 'renewed' : 'not renewed',
    classesH: '🧘 Classes today',
    came: (time, title, came, booked, missed) => `${time} ${title}: ${came}/${booked} came${missed ? ` · no-show: ${missed}` : ''}`,
    bookings: (made, off, byShala) => `Bookings made: ${made} · cancelled: ${off}${byShala ? ` (${byShala} by a closed class)` : ''}`,
    tomorrowH: d => `📅 Tomorrow ${d}`,
    tLine: (time, title, n, mats) => `${time} ${title}: ${n} booked${mats ? ` · ${mats} mats` : ''}`,
    tClosed: c => c.why === 'none' ? 'No classes on the timetable tomorrow.'
      : c.why === 'cancelled' ? `The shala is closed tomorrow: every class is cancelled${c.note ? ` (${c.note})` : ''}.`
      : `The shala is closed tomorrow: ${c.why === 'full' ? 'full moon' : 'new moon'} day.`,
    photosH: '📷 Class photos',
    photos: (n, tagged, students) => `Uploaded: ${n} · tagged: ${tagged} · on ${students} profiles`,
    photosNone: 'No photos yet today',
    profileH: '📝 Student profiles',
    notes: (n, by) => `Teacher notes: ${n}${by ? ` (${by})` : ''}`,
    checks: (n, names) => `12-week checks: ${n}: ${names}`,
    journal: (n, names) => `Practice journal entries: ${n}: ${names}`,
    signins: (n, links) => `Opened their profile: ${n} · sign-in links sent by staff: ${links}`,
    leadsH: '📣 Leads',
    letter: (yes, wait, left) => `Monday letter: ${yes} confirmed · ${wait} waiting${left ? ` · ${left} left` : ''}`,
    start: (views, taps, done) => `/start page: ${views} views · ${taps} taps · ${done} finished the steps`,
    forms: n => `First-step forms: ${n}`,
    chat: (where, n, fresh, hot) => `${where} chats: ${n} people (${fresh} new) · hot: ${hot}`,
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
      if (!to) return fail(409, 'No team group yet: add the AYBKK help desk to the team LINE group first');
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
           p.status AS pass_status, to_char(p.valid_until,'YYYY-MM-DD') AS until, to_char(p.valid_from,'YYYY-MM-DD') AS since
         FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id LEFT JOIN bkk_passes p ON p.id=b.pass_id
         WHERE b.class_date=$1::date AND b.status='booked' AND b.slot_id IS NOT NULL ORDER BY lower(m.name), b.id`, [date]),
      // First class ever is today.
      q(`SELECT DISTINCT b.member_id FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id
         WHERE b.class_date=$1::date AND b.status='booked' AND NOT ${FROM_REZERV}
           AND (m.joined_on IS NULL OR m.joined_on >= $1::date - 7)
           AND NOT EXISTS (SELECT 1 FROM bkk_bookings x WHERE x.member_id=b.member_id AND x.status='booked'
             AND x.checked_in_at IS NOT NULL AND x.class_date < $1::date)`, [date]),
      // First pass bought in the last 7 days, never came, not booked today.
      q(`SELECT m.name, fp.item_en, fp.item_th, to_char(fp.at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') AS day,
           (SELECT to_char(min(x.class_date),'YYYY-MM-DD') FROM bkk_bookings x WHERE x.member_id=m.id
             AND x.status='booked' AND x.class_date > $1::date) AS next
         FROM bkk_members m
         JOIN LATERAL (SELECT p.created_at AS at, pr.name_en AS item_en, pr.name_th AS item_th FROM bkk_passes p
           LEFT JOIN bkk_products pr ON pr.id=p.product_id WHERE p.member_id=m.id ORDER BY p.created_at, p.id LIMIT 1) fp ON true
         WHERE fp.at >= ($1::date - 7)::timestamp AT TIME ZONE 'Asia/Bangkok'
           AND fp.at < ($1::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok' AND NOT ${FROM_REZERV}
           AND NOT EXISTS (SELECT 1 FROM bkk_bookings x WHERE x.member_id=m.id
             AND ((x.status='booked' AND x.checked_in_at IS NOT NULL) OR (x.class_date=$1::date AND x.status='booked')))
         ORDER BY fp.at`, [date]),
      // Ends within 7 days, or 2 or fewer classes left, nothing after it, and came in the last 30 days.
      q(`SELECT * FROM (SELECT DISTINCT ON (p.member_id) m.name, p.kind, p.credits_total - p.credits_used AS left,
           to_char(p.valid_until,'YYYY-MM-DD') AS until, pr.name_en AS item_en, pr.name_th AS item_th
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
      q(`SELECT m.name, o.refno, o.amount_thb, pr.name_en AS item_en, pr.name_th AS item_th,
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
      const title = L.cls(c.title);
      if (c.off) { lines.push('', L.cOff(c.time, title, c.note)); continue; }
      shown++;
      const here = seats.rows.filter(s => s.slot_id === c.id);
      lines.push('', L.cLine(c.time, title, c.teacher, here.length), here.length ? here.map(name).join(', ') : L.nobody);
    }

    const freshIds = new Set(fresh.rows.map(r => r.member_id));
    const firstSeat = new Map();
    for (const s of seats.rows) {
      if (!freshIds.has(s.member_id)) continue;
      const t = time.get(s.slot_id) || '';
      if (!firstSeat.has(s.member_id) || t < firstSeat.get(s.member_id).t) firstSeat.set(s.member_id, { t, n: name(s) });
    }
    const newLines = [...[...firstSeat.values()].sort((a, b) => a.t.localeCompare(b.t)).map(x => L.newFirst(x.n, x.t)),
      ...bought.rows.map(r => L.newBought(name(r), L.item(r.item_en, r.item_th), L.day(r.day), r.next && L.day(r.next)))];
    if (newLines.length) lines.push('', L.newH, ...newLines);

    const endLines = ending.rows.map(r => r.kind === 'credits' && r.left <= 2
      ? L.endLeft(name(r), L.item(r.item_en, r.item_th), Math.max(0, r.left), r.until && L.day(r.until))
      : L.endDate(name(r), L.item(r.item_en, r.item_th), L.day(r.until)));
    if (endLines.length) lines.push('', L.endH, ...endLines);

    const why = s => !s.pass_id ? L.why.none : s.pass_status === 'frozen' ? L.why.frozen
      : s.pass_status !== 'active' ? L.why.void : s.until && s.until < date ? L.why.ended(L.day(s.until))
      : s.since && s.since > date ? L.why.later(L.day(s.since)) : null;
    const unpaidSeats = seats.rows.filter(s => s.cover !== 'rezerv' && why(s));
    const payLines = [...orders.rows.map(r => L.payOrder(name(r), L.item(r.item_en, r.item_th), baht(r.amount_thb), L.day(r.day), r.refno)),
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

  async function evening(date, L) {
    const from = bkkAt(date, '00:00'), to = bkkAt(date, BRIEF_AT.evening);
    const cut = Math.min(Date.parse(to), nowMs());
    const W = [from, to];
    const tomorrow = addDays(date, 1);
    const one = async (sql, args = W) => (await q(sql, args)).rows[0];
    const all = async (sql, args = W) => (await q(sql, args)).rows;
    const unpaidStill = `o.status='pending' AND o.source IS NULL AND o.created_at >= $1 AND o.created_at < $2
      AND NOT EXISTS (SELECT 1 FROM bkk_orders x WHERE x.member_id=o.member_id AND x.status='paid' AND x.created_at > o.created_at)`;
    const [paid, pending, mismatch, joined, started, ended, seats, made, today, next, nextSeats,
      photos, tagged, notes, checks, tokens, letter, start, journal] = await Promise.all([
      all(`SELECT o.method, o.amount_thb, o.vat_thb, o.product_id, coalesce(pr.name_en, o.item_name) AS item_en, pr.name_th AS item_th
           FROM bkk_orders o LEFT JOIN bkk_products pr ON pr.id=o.product_id
           WHERE o.status='paid' AND o.source IS NULL
             AND coalesce(o.verified_at, o.created_at) >= $1 AND coalesce(o.verified_at, o.created_at) < $2`),
      one(`SELECT count(*)::int AS n, coalesce(sum(o.amount_thb),0)::int AS total FROM bkk_orders o WHERE ${unpaidStill}`),
      one(`SELECT count(*)::int AS n FROM bkk_orders o WHERE o.status='mismatch' AND o.created_at >= $1 AND o.created_at < $2`),
      all(`SELECT name FROM bkk_members WHERE created_at >= $1 AND created_at < $2 AND source IS DISTINCT FROM 'rezerv'
           ORDER BY created_at, id`),
      all(`SELECT m.name, pr.name_en AS item_en, pr.name_th AS item_th FROM bkk_passes p
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
           WHERE c.taken_on=$1::date AND c.created_at < $2 ORDER BY lower(m.name)`, [date, to]),
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
      const it = byItem.get(k) || { item: L.item(o.item_en, o.item_th), n: 0, total: 0 };
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
      list(started.map(r => `${name(r)} (${L.item(r.item_en, r.item_th)})`))));
    if (ended.length) lines.push(L.ended(ended.length, list(ended.map(r => `${name(r)} (${L.renewed(r.renewed)})`))));

    lines.push('', L.classesH);
    let came = 0;
    if (today.closed) lines.push(L.closed(today.closed));
    else {
      for (const c of today.classes) {
        const title = L.cls(c.title);
        if (c.off) { lines.push(L.cOff(c.time, title, c.note)); continue; }
        const here = seats.filter(s => s.slot_id === c.id);
        const inN = here.filter(s => s.checked_in_at).length;
        came += inN;
        const over = Date.parse(bkkAt(date, c.time)) + c.duration * 60000 <= cut;
        const missed = over ? here.filter(s => !s.checked_in_at).map(name) : [];
        lines.push(L.came(c.time, title, inN, here.length, list(missed)));
      }
    }
    lines.push(L.bookings(made.made, made.off, made.by_shala));

    let booked = 0;
    lines.push('', L.tomorrowH(L.day(tomorrow)));
    if (next.closed) lines.push(L.tClosed(next.closed));
    else {
      for (const c of next.classes) {
        const title = L.cls(c.title);
        if (c.off) { lines.push(L.cOff(c.time, title, c.note)); continue; }
        const n = nextSeats.find(s => s.slot_id === c.id) || { n: 0, mats: 0 };
        booked += n.n;
        lines.push(L.tLine(c.time, title, n.n, n.mats));
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

  // The latest group the help desk joins gets the briefs, and Boonchu hears
  // about every change (the briefs carry names). A join LINE sends again late
  // never takes them back to an older group.
  async function joined(id, ts) {
    const at = new Date(Number.isFinite(ts) ? ts : nowMs()).toISOString();
    const name = await groupName(id);
    const client = await pool.connect();
    let moved = false;
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO bkk_settings (key,value) VALUES ('team_line_groups','[]') ON CONFLICT (key) DO NOTHING`);
      const seen = (await client.query(`SELECT value FROM bkk_settings WHERE key='team_line_groups' FOR UPDATE`)).rows[0].value;
      const groups = Array.isArray(seen) ? seen : [];
      const cur = (await client.query(`SELECT value FROM bkk_settings WHERE key='team_line_group'`)).rows[0];
      const curId = cur && typeof cur.value === 'string' ? cur.value : null;
      const had = groups.find(g => g.id === id);
      const curAt = curId && (groups.find(g => g.id === curId) || {}).joinedAt;
      if (!(had && had.joinedAt > at)) {
        const next = [{ id, name: name || (had && had.name) || null, joinedAt: at, leftAt: null },
          ...groups.filter(g => g.id !== id)].slice(0, GROUPS_KEPT);
        await client.query(`UPDATE bkk_settings SET value=$1, updated_at=now() WHERE key='team_line_groups'`, [JSON.stringify(next)]);
      }
      if (curId !== id && !(curAt && curAt > at)) {
        await client.query(`INSERT INTO bkk_settings (key,value) VALUES ('team_line_group',$1)
          ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now()`, [JSON.stringify(id)]);
        moved = true;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
    if (moved) {
      console.log('[team] help desk joined a LINE group: team briefs go there now');
      Promise.resolve(notify(`AYBKK help desk joined the LINE group "${name || 'no name'}". The team briefs go to that group now. ` +
        `If that was not you, remove the help desk from that group.`)).catch(() => {});
    }
  }

  async function left(id, ts) {
    const at = new Date(Number.isFinite(ts) ? ts : nowMs()).toISOString();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query(`SELECT value FROM bkk_settings WHERE key='team_line_groups' FOR UPDATE`)).rows[0];
      const groups = row && Array.isArray(row.value) ? row.value : [];
      const had = groups.find(g => g.id === id);
      if (had && had.joinedAt > at) { await client.query('ROLLBACK'); return; }   // left before a later join
      if (had) {
        had.leftAt = at;
        await client.query(`UPDATE bkk_settings SET value=$1, updated_at=now() WHERE key='team_line_groups'`, [JSON.stringify(groups)]);
      }
      const gone = await client.query(`DELETE FROM bkk_settings WHERE key='team_line_group' AND value = to_jsonb($1::text)`, [id]);
      await client.query('COMMIT');
      if (gone.rowCount) console.log('[team] help desk left the team group: briefs wait for a new group');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
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
        group: { saved: !!group, name: g ? g.name : null, joinedAt: g ? g.joinedAt : null },
        groupsSeen: groups.map(x => ({ name: x.name, joinedAt: x.joinedAt, leftAt: x.leftAt, saved: x.id === group })),
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

  app.post('/api/bkk/admin/team/brief', adminOnly, async (req, res) => {
    const kind = briefArgs(req.body || {}, res);
    if (!kind) return;
    try {
      const date = bkkYmd(nowMs());
      const b = await build(kind, date, (await settings()).lang);
      const r = await teamSend(b.messages);
      if (!r.ok) { await failed(`${kind} brief ${date} (sent by hand)`, r.error); return res.status(r.status).json({ error: r.error }); }
      await remember(kind, { date, requestIds: r.requestIds, byHand: true });
      res.json({ ok: true, kind, date, requestIds: r.requestIds, images: b.images.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // What Boonchu approved, as he approved it: one text, no change.
  app.post('/api/bkk/admin/team/send', adminOnly, async (req, res) => {
    const text = (req.body || {}).text;
    if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text required' });
    if (text.length > SEND_MAX) return res.status(400).json({ error: `text is longer than ${SEND_MAX} characters` });
    try {
      const r = await teamSend([text]);
      if (!r.ok) { await failed('message', r.error); return res.status(r.status).json({ error: r.error }); }
      await remember('message', { requestIds: r.requestIds });
      res.json({ ok: true, requestId: r.requestIds[0], requestIds: r.requestIds });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return { tick, start, stop, send: teamSend, build };
}

module.exports = { mountTeam, HELPDESK_PATH_RE, shortName, splitText, retryKey };
