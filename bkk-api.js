// bkk-api.js — AYBKK Bangkok: packages, payment (PaySolutions), passes,
// class schedule, bookings, check-in.
//
// Mount:  mountBkk(app, { pgPool })
//
// Owns its own bkk_* tables. It NEVER writes Rezerv's students/classes/
// bookings/passes tables — the two systems run side by side.
//
// Money rule: a pass is only created after the gateway itself confirms the
// payment AND the amount matches. The PaySolutions postback is treated as an
// untrusted nudge (their own plugins accept it blindly; we do not).

const crypto = require('crypto');
const { sendMail, render } = require('./mailer');

const TZ_OFFSET = '+07:00';                    // Asia/Bangkok, no DST
const SIGNIN_TTL_MIN = 30;                     // a sign-in link is short-lived
const STAFF_LINK_DAYS = 7;                     // one M sends by LINE/WhatsApp/WeChat
const SIGNIN_PER_EMAIL_HOUR = 3;               // and cheap to abuse without limits
const SIGNIN_PER_IP_HOUR = 10;
const LETTER_PER_IP_HOUR = 10;                 // letter confirm mails asked from one place (shala wifi)
const LETTER_PER_HOUR = 30;                    // and from everywhere (x-forwarded-for can be faked)
const LETTER_PER_DAY = 60;                     // the same mail account sends receipts and sign-in links
const LETTER_ASKS_PER_DAY = 3;                 // confirm mails to one address
const CANCEL_CUTOFF_HOURS = 5;                 // cancel ≥5h before start → credit back
const VAT_PCT = 7;                             // Thai VAT, charged on price + online fee

// ── seed data (from aybkk.com, captured 2026-08-05) ─────────────────────────
// price_thb is the BASE price. The online surcharge is a setting, applied at
// checkout, so it can be changed without touching the catalogue.
const SEED_PRODUCTS = [
  { code: 'dropin',    name_en: 'Drop-in',              name_th: 'ครั้งเดียว',        price_thb: 1500,  kind: 'credits',   credits: 1,  valid_days: 1,   daily_cap: null, sort: 10 },
  { code: 'pack10',    name_en: '10 classes / 3 months', name_th: '10 ครั้ง / 3 เดือน', price_thb: 14000, kind: 'credits',   credits: 10, valid_days: 90,  daily_cap: null, sort: 20 },
  { code: 'unlim1',    name_en: '1 month unlimited',     name_th: '1 เดือน ไม่จำกัด',   price_thb: 9600,  kind: 'unlimited', credits: null, valid_days: 30,  daily_cap: 2, sort: 30 },
  { code: 'unlim3',    name_en: '3 months unlimited',    name_th: '3 เดือน ไม่จำกัด',   price_thb: 25800, kind: 'unlimited', credits: null, valid_days: 90,  daily_cap: 2, sort: 50 },
  { code: 'unlim12m',  name_en: '12 months unlimited',   name_th: '12 เดือน ไม่จำกัด',  price_thb: 78000, kind: 'unlimited', credits: null, valid_days: 365, daily_cap: 2, sort: 70 },
];

// weekday: 0=Sun … 6=Sat
// Moon days: the shala is closed on the Bangkok date of every new and full moon.
// Mean-lunation formula with the main periodic terms (Walker's moontool); checked
// against an ephemeris for 2026–2028 with no date wrong.
const rad = d => d * Math.PI / 180;
function moonJD(k) {
  const t = k / 1236.85, t2 = t * t, t3 = t2 * t;
  let jd = 2415020.75933 + 29.53058868 * k + 0.0001178 * t2 - 0.000000155 * t3
    + 0.00033 * Math.sin(rad(166.56 + 132.87 * t - 0.009173 * t2));
  const m = rad(359.2242 + 29.10535608 * k - 0.0000333 * t2 - 0.00000347 * t3);
  const mp = rad(306.0253 + 385.81691806 * k + 0.0107306 * t2 + 0.00001236 * t3);
  const f = rad(21.2964 + 390.67050646 * k - 0.0016528 * t2 - 0.00000239 * t3);
  jd += (0.1734 - 0.000393 * t) * Math.sin(m) + 0.0021 * Math.sin(2 * m)
    - 0.4068 * Math.sin(mp) + 0.0161 * Math.sin(2 * mp) - 0.0004 * Math.sin(3 * mp)
    + 0.0104 * Math.sin(2 * f) - 0.0051 * Math.sin(m + mp) - 0.0074 * Math.sin(m - mp)
    + 0.0004 * Math.sin(2 * f + m) - 0.0004 * Math.sin(2 * f - m)
    - 0.0006 * Math.sin(2 * f + mp) + 0.0010 * Math.sin(2 * f - mp) + 0.0005 * Math.sin(m + 2 * mp);
  return jd;
}
function moonDaysBetween(fromYmd, toYmd) {
  const out = new Map();
  const y = Number(fromYmd.slice(0, 4)) + (Number(fromYmd.slice(5, 7)) - 1) / 12;
  const k0 = Math.floor((y - 1900) * 12.3685) - 2;
  for (let k = k0; k < k0 + 40; k++) {
    for (const [ph, name] of [[0, 'new'], [0.5, 'full']]) {
      const ms = (moonJD(k + ph) - 2440587.5) * 86400000;
      const d = new Date(ms + 7 * 3600000).toISOString().slice(0, 10);
      if (d >= fromYmd && d <= toYmd) out.set(d, name);
    }
  }
  return out;
}

const SEED_SLOTS = [
  // Titles carry no times — the schedule already shows the time in its own column.
  // teachers: one name, or a name per weekday. Saturday Led Primary rotates (SAT_PRIMARY_ROTATION).
  { code: 'my530',   title: 'Mysore (1st batch)',        kind: 'mysore',       weekdays: [2,3,4,5],   start_time: '05:30', duration_min: 120, capacity: 42, is_online: false, teachers: { 2: 'Boonchu', 3: 'M', 4: 'M', 5: 'Boonchu' } },
  { code: 'my730',   title: 'Mysore (2nd batch)',        kind: 'mysore',       weekdays: [2,3,4,5],   start_time: '07:30', duration_min: 120, capacity: 42, is_online: false, teachers: 'Boonchu' },
  { code: 'lp_mon',  title: 'Led Primary series',        kind: 'led_primary',  weekdays: [1],         start_time: '06:30', duration_min: 90,  capacity: 42, is_online: false, teachers: 'Boonchu' },
  { code: 'lp_sat',  title: 'Led Primary series',        kind: 'led_primary',  weekdays: [6],         start_time: '07:00', duration_min: 90,  capacity: 42, is_online: false },
  { code: 'li_sat',  title: 'Led Intermediate series',   kind: 'led_inter',    weekdays: [6],         start_time: '08:45', duration_min: 120, capacity: 42, is_online: false, teachers: 'Boonchu' },
  { code: 'my_sun',  title: 'Mysore Sunday',             kind: 'mysore',       weekdays: [0],         start_time: '07:00', duration_min: 150, capacity: 42, is_online: false, teachers: 'M' },
  { code: 'olp_mon', title: '[Online] Led Primary series',      kind: 'led_primary', weekdays: [1], start_time: '06:30', duration_min: 90,  capacity: 20, is_online: true, teachers: 'Boonchu' },
  { code: 'olp_sat', title: '[Online] Led Primary series',      kind: 'led_primary', weekdays: [6], start_time: '07:00', duration_min: 90,  capacity: 10, is_online: true },
  { code: 'oli_sat', title: '[Online] Led Intermediate series', kind: 'led_inter',   weekdays: [6], start_time: '09:00', duration_min: 120, capacity: 15, is_online: true, teachers: 'Boonchu' },
];
// Saturday Led Primary takes turns week by week, Jamsai first on 17 Oct 2026 (Boonchu, 4 Oct).
const SAT_PRIMARY_ROTATION = { codes: ['lp_sat', 'olp_sat'], from: '2026-10-17', teachers: ['Jamsai', 'M'] };
function rotationTeacher(code, ymdStr) {
  if (!SAT_PRIMARY_ROTATION.codes.some(c => code === `${c}_6`)) return null;
  const weeks = Math.round((Date.parse(ymdStr) - Date.parse(SAT_PRIMARY_ROTATION.from)) / (7 * 86400000));
  const t = SAT_PRIMARY_ROTATION.teachers;
  return t[((weeks % t.length) + t.length) % t.length];
}

// ── reading Rezerv's export (Oct 2026) ──────────────────────────────────────
// Thailand writes the day first, often in the Buddhist year (2569 = 2026), and
// a spreadsheet re-saves dates in its own way, so every shape seen in the wild
// is read. All dates and times are Bangkok.
const MON_EN = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MON_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const MON_TH_SHORT = ['มค', 'กพ', 'มีค', 'เมย', 'พค', 'มิย', 'กค', 'สค', 'กย', 'ตค', 'พย', 'ธค'];
function monthOf(word) {
  const w = String(word).toLowerCase().replace(/[.,\s]/g, '');
  if (/^[a-z]{3,}$/.test(w)) return MON_EN[w.slice(0, 3)] || null;
  const i = MON_TH.indexOf(w);
  if (i >= 0) return i + 1;
  const j = MON_TH_SHORT.indexOf(w);
  return j >= 0 ? j + 1 : null;
}
// Two-digit years never overlap: 15–30 are 2015–2030, 58–73 are Buddhist 2558–2573.
function fullYear(y) {
  const n = Number(y);
  if (y.length <= 2) return n >= 50 ? 2500 + n - 543 : 2000 + n;
  return n > 2400 ? n - 543 : n;
}
// A class written as a range, "05:30 - 07:30", is read as its start.
const rangeStart = s => s.replace(/(\d[:.]\d{2}(?::\d{2})?(?:\s*[ap]\.?m\.?|\s*น\.?)?)\s*[-–]\s*\d{1,2}[:.]\d{2}.*$/i, '$1');
// "05:30", "5:30 AM", "05:30:00", "05.30 น." → "05:30"
function parseClock(v) {
  const s = String(v ?? '').trim();
  if (s.length > 40) return null;
  const m = rangeStart(s).match(/^(\d{1,2})[:.](\d{2})(?::\d{2}(?:\.\d+)?)?\s*(a\.?m\.?|p\.?m\.?|น\.?)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const ap = (m[3] || '').toLowerCase();
  if (/^[ap]/.test(ap)) {
    if (h < 1 || h > 12) return null;
    if (ap[0] === 'p' && h < 12) h += 12;
    if (ap[0] === 'a' && h === 12) h = 0;
  }
  if (h > 23 || Number(m[2]) > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}
// → { date: 'YYYY-MM-DD', time: 'HH:MM' | null }, or null when unreadable.
function parseWhen(v) {
  // The era ("พ.ศ. 2569") goes: the year itself says which one it is.
  let s = String(v ?? '').replace(/[พค]\.\s?ศ\./g, ' ').trim().replace(/\s+/g, ' ');
  // A date cell is short. A long one is not a date, and the patterns below
  // backtrack badly on one (a whole server stalls on a 4 KB cell).
  if (!s || s.length > 80) return null;
  // Only an explicit UTC time or offset is converted; anything else is Bangkok already.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const t = Date.parse(s);
    if (isNaN(t)) return null;
    const b = new Date(t + 7 * 3600000).toISOString();
    return { date: b.slice(0, 10), time: b.slice(11, 16) };
  }
  s = rangeStart(s);
  let rest = s, time = null;
  const tm = s.match(/(^|[\sT,])(\d{1,2}[.:]\d{2}\s*น\.?|\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s*[ap]\.?m\.?)?)(?=$|\s)/i);
  if (tm) {
    time = parseClock(tm[2]);
    if (!time) return null;
    rest = (s.slice(0, tm.index) + ' ' + s.slice(tm.index + tm[0].length)).trim();
  }
  rest = rest.replace(/(?:[,\s]*(?:at|เวลา))?[,\s]*$/i, '')
    .replace(/^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?\s+/i, '').replace(/^วัน[^\s\d]*ที่\s*/, '').trim();
  let y, mo, d, m;
  if ((m = rest.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) [y, mo, d] = [fullYear(m[1]), +m[2], +m[3]];
  else if ((m = rest.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) [d, mo, y] = [+m[1], +m[2], fullYear(m[3])];
  else if ((m = rest.match(/^(\d{1,2})[\s-]*([^\d\s-]+)[\s-]*(\d{2}|\d{4})$/))) [d, mo, y] = [+m[1], monthOf(m[2]), fullYear(m[3])];
  else if ((m = rest.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/))) [mo, d, y] = [monthOf(m[1]), +m[2], fullYear(m[3])];
  else return null;
  if (!mo || !d || y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { date: dt.toISOString().slice(0, 10), time };
}
// "฿1,500.00", "THB 9600", "(1,500)" → number; null when it is not an amount.
function parseAmount(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = s.replace(/[^\d.,]/g, '').replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(n)) return null;
  return (/^\(.*\)$/.test(s) || s.includes('-')) ? -Number(n) : Number(n);
}
const luhn = digits => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let x = Number(digits[digits.length - 1 - i]);
    if (i % 2) { x *= 2; if (x > 9) x -= 9; }
    sum += x;
  }
  return sum % 10 === 0;
};
// Card numbers are never kept, not even typed into a note.
const noCards = s => String(s).replace(/\d(?:[ -]?\d){12,18}/g, m => luhn(m.replace(/\D/g, '')) ? '[card number removed]' : m);
// Rezerv's visit statuses, loosely: order matters ("not attended", "late cancel", "ไม่มา").
const VISIT_WORDS = [
  [/late[\s_-]*cancel|ยกเลิกช้า|ยกเลิกกระชั้น/i, 'late'],
  [/no[\s_-]*show|absent|missed|not[\s_-]*(attend|came|show)|did\s*n[o']?t|ไม่มา|ขาด/i, 'noshow'],
  [/wait|รอคิว|สำรอง/i, 'waitlist'],
  [/cancel|ยกเลิก|refund/i, 'cancelled'],
  // "Not checked in", "Unattended", "Incomplete", "ยังไม่เข้าเรียน": did not come
  // (yet). A no-show once the class is over, a seat while it is still to come.
  [/\b(not|no|un|non|never)[\s_-]*(yet[\s_-]*)?(check|attend|complet|came|come|show|visit|present)|incomplete|pending|ไม่/i, 'unchecked'],
  [/attend|check(ed)?[\s_-]*in|present|came|complete|done|visit|เข้าเรียน|มาเรียน|เช็[คก]อิน|เข้าร่วม|มาแล้ว/i, 'attended'],
  [/book|confirm|reserv|upcoming|schedul|จอง|ยืนยัน/i, 'booked'],
];
function visitStatus(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const hit = VISIT_WORDS.find(([re]) => re.test(s));
  return hit ? hit[1] : undefined;
}
// Rezerv's payment states. Only money that came in, or went back, is kept:
// order matters ("Payment failed", "Refund pending", "Unpaid").
const PAY_WORDS = [
  [/fail|declin|reject|pending|await|\bdue\b|overdue|unpaid|not[\s_-]*paid|cancel|void|expir|abandon|incomplete|chargeback|disput|ไม่สำเร็จ|ยกเลิก|รอชำระ|รอดำเนินการ|รอตรวจสอบ|ค้างชำระ|หมดอายุ|ยังไม่ชำระ|ไม่ได้ชำระ/i, 'skip'],
  [/refund|คืนเงิน/i, 'refund'],
  [/paid|success|complete|approv|captur|settl|^ok$|sale|purchase|payment|charge|ชำระแล้ว|จ่ายแล้ว|สำเร็จ|เรียบร้อย|ขาย|ซื้อ/i, 'paid'],
];
function payStatus(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const hit = PAY_WORDS.find(([re]) => re.test(s));
  return hit ? hit[1] : undefined;
}
function payMethod(raw) {
  const s = String(raw || '').toLowerCase();
  if (!s) return 'other';
  if (/cash|เงินสด/.test(s)) return 'cash';
  if (/card|credit|debit|visa|master|amex|jcb|บัตร/.test(s)) return 'card';
  if (/transfer|bank|prompt\s*pay|qr|โอน|พร้อมเพย์|ธนาคาร/.test(s)) return 'transfer';
  if (/online|web|app|stripe|omise|paypal|2c2p|pay\s*solutions|gateway|ออนไลน์/.test(s)) return 'online';
  return 'other';
}

function mountBkk(app, opts = {}) {
  const pool = opts.pgPool;
  const cloudinary = opts.cloudinary || null;
  const httpFetch = opts.fetch || fetch;
  // No key set means no admin at all: the repo is public, so a default key
  // would open every student's data to anyone.
  const ADMIN_KEY = process.env.BKK_ADMIN_KEY || process.env.SHOP_ADMIN_KEY || '';
  if (!ADMIN_KEY) console.warn('⚠ bkk-api: BKK_ADMIN_KEY not set — admin endpoints are closed');
  // Header only. A key in the query string ends up in access logs, browser
  // history and Referer headers.
  const isAdmin = req => !!ADMIN_KEY && req.headers['x-bkk-key'] === ADMIN_KEY;

  if (!pool) { console.warn('⚠ bkk-api: no pgPool — Bangkok API disabled'); return; }
  const q = (sql, params = []) => pool.query(sql, params);

  // ── schema ────────────────────────────────────────────────────────────────
  async function initSchema() {
    await q(`CREATE TABLE IF NOT EXISTS bkk_settings (
      key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_products (
      id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL,
      name_en TEXT NOT NULL, name_th TEXT, price_thb INTEGER NOT NULL,
      kind TEXT NOT NULL, credits INTEGER, valid_days INTEGER NOT NULL,
      daily_cap INTEGER, active BOOLEAN DEFAULT true, sort INTEGER DEFAULT 100)`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_members (
      id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL, email TEXT, phone TEXT,
      student_id TEXT, created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_members_email ON bkk_members (lower(email))`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_orders (
      id SERIAL PRIMARY KEY, refno BIGINT UNIQUE NOT NULL,
      product_id INTEGER REFERENCES bkk_products(id),
      member_id INTEGER REFERENCES bkk_members(id),
      base_thb INTEGER NOT NULL, fee_thb INTEGER NOT NULL DEFAULT 0,
      amount_thb INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      gateway_ref TEXT, gateway_note TEXT,
      verified_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_passes (
      id SERIAL PRIMARY KEY, member_id INTEGER REFERENCES bkk_members(id),
      product_id INTEGER REFERENCES bkk_products(id),
      order_id INTEGER REFERENCES bkk_orders(id),
      kind TEXT NOT NULL, credits_total INTEGER, credits_used INTEGER DEFAULT 0,
      daily_cap INTEGER, valid_days INTEGER NOT NULL,
      valid_from DATE, valid_until DATE,
      status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_class_slots (
      id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL, kind TEXT, teachers TEXT,
      weekday INTEGER NOT NULL, start_time TEXT NOT NULL,
      duration_min INTEGER NOT NULL, capacity INTEGER NOT NULL,
      is_online BOOLEAN DEFAULT false, active BOOLEAN DEFAULT true)`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_class_overrides (
      id SERIAL PRIMARY KEY, slot_id INTEGER REFERENCES bkk_class_slots(id),
      class_date DATE NOT NULL, cancelled BOOLEAN DEFAULT false,
      capacity INTEGER, note TEXT, UNIQUE (slot_id, class_date))`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_bookings (
      id SERIAL PRIMARY KEY, slot_id INTEGER REFERENCES bkk_class_slots(id),
      class_date DATE NOT NULL, start_at TIMESTAMPTZ NOT NULL,
      member_id INTEGER REFERENCES bkk_members(id),
      pass_id INTEGER REFERENCES bkk_passes(id),
      status TEXT NOT NULL DEFAULT 'booked',
      booked_at TIMESTAMPTZ DEFAULT now(), cancelled_at TIMESTAMPTZ,
      checked_in_at TIMESTAMPTZ)`);
    // Single-use sign-in links. The IP is kept only to rate-limit: this endpoint
    // sends mail from the shala's domain, so it must not become a spam cannon.
    await q(`CREATE TABLE IF NOT EXISTS bkk_login_tokens (
      token TEXT PRIMARY KEY,
      member_id INTEGER REFERENCES bkk_members(id),
      email TEXT, ip TEXT,
      expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_login_tokens_recent
             ON bkk_login_tokens (created_at)`);

    // The teaching team. Each teacher has their own passcode, stored hashed —
    // a shared key would make every note say "somebody", and revoking one
    // person would mean changing it for everyone.
    await q(`CREATE TABLE IF NOT EXISTS bkk_teachers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL, email TEXT,
      key_hash TEXT NOT NULL,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now())`);

    // What a teacher saw, and what the student should work on.
    // share_with_student separates the two audiences deliberately: some notes
    // are for the team ("pushing too hard, watch the shoulder") and some are
    // for the student ("straighten the front leg in Trikonasana").
    await q(`CREATE TABLE IF NOT EXISTS bkk_notes (
      id SERIAL PRIMARY KEY,
      member_id INTEGER REFERENCES bkk_members(id) ON DELETE CASCADE,
      teacher_id INTEGER REFERENCES bkk_teachers(id),
      class_date DATE,
      body TEXT,
      to_work_on TEXT,
      share_with_student BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_notes_member
             ON bkk_notes (member_id, created_at DESC)`);
    // Language the student last chose, so email matches the page they bought on.
    await q(`ALTER TABLE bkk_members ADD COLUMN IF NOT EXISTS lang TEXT`);
    await q(`ALTER TABLE bkk_orders ADD COLUMN IF NOT EXISTS vat_thb INTEGER NOT NULL DEFAULT 0`);
    await q(`ALTER TABLE bkk_orders ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'online'`);
    await q(`ALTER TABLE bkk_passes ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ`);

    // Class photos on each student's own profile (Oct 2026). The public feed
    // closed because students didn't want others saving their photos, so a
    // photo is stored private and only shown to the students tagged in it.
    await q(`CREATE TABLE IF NOT EXISTS bkk_photos (
      id SERIAL PRIMARY KEY,
      public_id TEXT UNIQUE NOT NULL,
      class_date DATE NOT NULL,
      width INTEGER, height INTEGER,
      uploaded_by INTEGER REFERENCES bkk_teachers(id),
      created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_photo_members (
      photo_id INTEGER REFERENCES bkk_photos(id) ON DELETE CASCADE,
      member_id INTEGER REFERENCES bkk_members(id) ON DELETE CASCADE,
      PRIMARY KEY (photo_id, member_id))`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_photo_members_member ON bkk_photo_members (member_id)`);
    // Photos pulled from the Drive day folder remember their Drive file, so a
    // second pass over the same folder skips what is already in.
    await q(`ALTER TABLE bkk_photos ADD COLUMN IF NOT EXISTS drive_id TEXT`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS bkk_photos_drive ON bkk_photos (drive_id) WHERE drive_id IS NOT NULL`);

    // The 12-week proof check (habit #1, Track): numbers the student already
    // has on their watch or phone, at week 0, 6 and 12. One row per day.
    await q(`CREATE TABLE IF NOT EXISTS bkk_checks (
      id SERIAL PRIMARY KEY,
      member_id INTEGER REFERENCES bkk_members(id) ON DELETE CASCADE,
      taken_on DATE NOT NULL,
      resting_hr INTEGER, sleep_hours NUMERIC(3,1), feel INTEGER, note TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (member_id, taken_on))`);

    // A member's id in the workshop journal (Neo4j Student.id). Not the member
    // code: that is their login, and the journal lists student ids publicly.
    await q(`ALTER TABLE bkk_members ADD COLUMN IF NOT EXISTS journal_id TEXT UNIQUE`);

    // Tees sold on aybkk.net in baht. Payment is a PaySolutions link Boonchu
    // makes per tee, so there is no cart here, only a button to that link.
    await q(`CREATE TABLE IF NOT EXISTS bkk_tees (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, price_thb INTEGER NOT NULL,
      pay_link TEXT NOT NULL, photo TEXT, sizes TEXT,
      active BOOLEAN DEFAULT true, sort INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now())`);

    // /start counts: which Reel (?src=) brings people, and how many tap the button.
    // No IP, no name: only source, language, channel.
    await q(`CREATE TABLE IF NOT EXISTS bkk_start_events (
      id SERIAL PRIMARY KEY, kind TEXT NOT NULL, src TEXT, lang TEXT, ch TEXT,
      created_at TIMESTAMPTZ DEFAULT now())`);

    // The Monday letter, email door. LINE, WeChat and Telegram readers join in
    // those apps, so only email lives here. An address counts once it is
    // confirmed from its own inbox. asks = confirm mails sent since asked_at's day.
    await q(`CREATE TABLE IF NOT EXISTS bkk_newsletter (
      id SERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, lang TEXT, src TEXT,
      status TEXT NOT NULL DEFAULT 'pending', token TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ DEFAULT now(), asked_at TIMESTAMPTZ DEFAULT now(),
      confirmed_at TIMESTAMPTZ, unsubscribed_at TIMESTAMPTZ)`);
    await q(`ALTER TABLE bkk_newsletter ADD COLUMN IF NOT EXISTS asks INTEGER NOT NULL DEFAULT 1`);
    await q(`ALTER TABLE bkk_newsletter DROP COLUMN IF EXISTS ip`);
    // One row per confirm mail sent, kept a day: the caps count mails, not
    // addresses, because one address can be asked again and again.
    await q(`CREATE TABLE IF NOT EXISTS bkk_letter_asks (
      id SERIAL PRIMARY KEY, ip TEXT, at TIMESTAMPTZ DEFAULT now())`);

    // The things a shala actually does to a pass, which Rezerv has and this did
    // not: pause it for an injury, write off a mistake, note why.
    await q(`ALTER TABLE bkk_passes ADD COLUMN IF NOT EXISTS frozen_from DATE`);
    await q(`ALTER TABLE bkk_passes ADD COLUMN IF NOT EXISTS frozen_until DATE`);
    await q(`ALTER TABLE bkk_passes ADD COLUMN IF NOT EXISTS note TEXT`);
    await q(`ALTER TABLE bkk_passes ADD COLUMN IF NOT EXISTS source TEXT`);
    await q(`ALTER TABLE bkk_bookings ADD COLUMN IF NOT EXISTS cancel_reason TEXT`);
    // Every way into a class puts a name on its list (28 Oct 2026). cover is what
    // pays for the seat: 'pass' (an aybkk.net pass) or 'rezerv' (a Rezerv package
    // not moved over yet, so no pass here). source is how the name got there:
    // student, staff, door, order. Older rows stay NULL.
    await q(`ALTER TABLE bkk_bookings ADD COLUMN IF NOT EXISTS cover TEXT`);
    await q(`ALTER TABLE bkk_bookings ADD COLUMN IF NOT EXISTS source TEXT`);
    // A drop-in is bought for one class, and paying for it books that class.
    await q(`ALTER TABLE bkk_orders ADD COLUMN IF NOT EXISTS slot_id INTEGER REFERENCES bkk_class_slots(id)`);
    await q(`ALTER TABLE bkk_orders ADD COLUMN IF NOT EXISTS class_date DATE`);
    // The door's add sheet sends one id per person added, so a second tap after
    // a lost reply finds the first one's seat instead of adding them again.
    await q(`ALTER TABLE bkk_bookings ADD COLUMN IF NOT EXISTS request_id TEXT`);

    // findOrCreateMember and login/request both take the first row for an email
    // with no ORDER BY. Two rows for one address means one of them — and any
    // pass on it — becomes permanently unreachable. A bulk import is exactly
    // how that happens, so make it impossible before importing anyone.
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS bkk_members_email_unique
             ON bkk_members (lower(email)) WHERE email IS NOT NULL`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_bookings_slot_date
             ON bkk_bookings (slot_id, class_date) WHERE status = 'booked'`);
    // One seat per student per class — but only among LIVE bookings. A plain
    // UNIQUE constraint counted cancelled rows too, so a student who cancelled
    // and changed their mind was told "you already booked this class".
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS bkk_bookings_one_live
             ON bkk_bookings (slot_id, class_date, member_id) WHERE status = 'booked'`);
    // Existing databases still carry the old table-level constraint.
    await q(`ALTER TABLE bkk_bookings
             DROP CONSTRAINT IF EXISTS bkk_bookings_slot_id_class_date_member_id_key`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS bkk_bookings_request_id
             ON bkk_bookings (request_id) WHERE request_id IS NOT NULL`);

    // Keep all history (28 Oct 2026): everything Rezerv holds moves over, and
    // nothing is deleted to tidy up. source_ref is Rezerv's own id for the row
    // (or a hash of it), so importing the same file twice adds nothing twice.
    await q(`ALTER TABLE bkk_members ADD COLUMN IF NOT EXISTS rezerv_id TEXT`);
    await q(`ALTER TABLE bkk_members ADD COLUMN IF NOT EXISTS joined_on DATE`);
    await q(`ALTER TABLE bkk_members ADD COLUMN IF NOT EXISTS source TEXT`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS bkk_members_rezerv ON bkk_members (rezerv_id) WHERE rezerv_id IS NOT NULL`);
    // A past Rezerv class that matches no slot keeps its own title, slot_id NULL.
    // status 'noshow' = booked, never came. Attended = 'booked' and checked in.
    await q(`ALTER TABLE bkk_bookings ADD COLUMN IF NOT EXISTS class_title TEXT`);
    await q(`ALTER TABLE bkk_bookings ADD COLUMN IF NOT EXISTS source_ref TEXT`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS bkk_bookings_source_ref
             ON bkk_bookings (source, source_ref) WHERE source_ref IS NOT NULL`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_bookings_member ON bkk_bookings (member_id, class_date)`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_bookings_date ON bkk_bookings (class_date)`);
    await q(`ALTER TABLE bkk_orders ADD COLUMN IF NOT EXISTS item_name TEXT`);
    await q(`ALTER TABLE bkk_orders ADD COLUMN IF NOT EXISTS source TEXT`);
    await q(`ALTER TABLE bkk_orders ADD COLUMN IF NOT EXISTS source_ref TEXT`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS bkk_orders_source_ref
             ON bkk_orders (source, source_ref) WHERE source_ref IS NOT NULL`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_orders_member ON bkk_orders (member_id)`);

    // Catalogue: a package added to SEED_PRODUCTS reaches a running shala on the
    // next boot. ON CONFLICT leaves existing rows alone, so a price changed or a
    // package retired in the admin page stays as staff set it.
    const added = await q(`SELECT count(*)::int AS n FROM bkk_products`);
    for (const s of SEED_PRODUCTS) {
      await q(`INSERT INTO bkk_products (code,name_en,name_th,price_thb,kind,credits,valid_days,daily_cap,sort)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (code) DO NOTHING`,
        [s.code, s.name_en, s.name_th, s.price_thb, s.kind, s.credits, s.valid_days, s.daily_cap, s.sort]);
    }
    // From 21 Oct 2026 a year is 12 months, no free 13th (Boonchu). valid_days
    // never changes under passes already sold, so the 13-month package is
    // retired once and kept for the passes and Rezerv imports that point at it.
    // The marker is written after the UPDATE, so a failed boot tries again.
    const year12 = await q(`SELECT 1 FROM bkk_settings WHERE key = 'year_is_12_months'`);
    if (!year12.rows.length) {
      await q(`UPDATE bkk_products SET active=false WHERE code='unlim12'`);
      await q(`INSERT INTO bkk_settings (key,value) VALUES ('year_is_12_months','true') ON CONFLICT (key) DO NOTHING`);
    }
    if (added.rows[0].n === 0) console.log(`✓ bkk: seeded ${SEED_PRODUCTS.length} products`);
    const c = await q('SELECT count(*)::int AS n FROM bkk_class_slots');
    if (c.rows[0].n === 0) {
      for (const s of SEED_SLOTS) {
        for (const wd of s.weekdays) {
          await q(`INSERT INTO bkk_class_slots (code,title,kind,weekday,start_time,duration_min,capacity,is_online)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (code) DO NOTHING`,
            [`${s.code}_${wd}`, s.title, s.kind, wd, s.start_time, s.duration_min, s.capacity, s.is_online]);
        }
      }
      console.log('✓ bkk: seeded weekly timetable');
    }
    // The seed above only fires on an empty table, so renaming a class in
    // SEED_SLOTS would never reach a running shala. Titles are synced on every
    // boot instead. Safe while there is no admin UI for renaming slots — add
    // one, and this has to go.
    for (const s of SEED_SLOTS) {
      for (const wd of s.weekdays) {
        await q('UPDATE bkk_class_slots SET title=$2 WHERE code=$1 AND title <> $2',
          [`${s.code}_${wd}`, s.title]);
        const who = s.teachers && typeof s.teachers === 'object' ? s.teachers[wd] : s.teachers;
        if (who) await q('UPDATE bkk_class_slots SET teachers=$2 WHERE code=$1 AND teachers IS DISTINCT FROM $2',
          [`${s.code}_${wd}`, who]);
      }
    }
    // Monday is Led Primary only (Oct 2026). Earlier databases were seeded with
    // Monday Mysore batches; switch those off once.
    const monFix = await q(`INSERT INTO bkk_settings (key,value) VALUES ('no_monday_mysore','true')
                            ON CONFLICT (key) DO NOTHING RETURNING key`);
    if (monFix.rows.length) {
      await q(`UPDATE bkk_class_slots SET active=false WHERE code IN ('my530_1','my730_1')`);
    }
    // No 2- or 6-month package any more (Oct 2026). Switch off the ones earlier
    // databases were seeded with, once; a pass already sold keeps working.
    const no26 = await q(`INSERT INTO bkk_settings (key,value) VALUES ('retired_unlim2_6','true')
                          ON CONFLICT (key) DO NOTHING RETURNING key`);
    if (no26.rows.length) await q(`UPDATE bkk_products SET active=false WHERE code IN ('unlim2','unlim6')`);
    const st = await q(`SELECT value FROM bkk_settings WHERE key = 'surcharge_pct'`);
    if (!st.rows.length) {
      await q(`INSERT INTO bkk_settings (key,value) VALUES ('surcharge_pct','3')`);
    }
    // One-time move from the old 5% to PaySolutions' real 3% (Oct 2026). The
    // marker keeps a later change in the admin page from being overwritten.
    const moved = await q(`INSERT INTO bkk_settings (key,value) VALUES ('surcharge_set_3pct','true')
                           ON CONFLICT (key) DO NOTHING RETURNING key`);
    if (moved.rows.length) {
      await q(`UPDATE bkk_settings SET value='3', updated_at=now() WHERE key='surcharge_pct' AND value='5'`);
    }
  }

  async function getSetting(key, fallback) {
    try {
      const r = await q('SELECT value FROM bkk_settings WHERE key = $1', [key]);
      return r.rows.length ? r.rows[0].value : fallback;
    } catch (e) { return fallback; }
  }

  const surcharge = async () => Number(await getSetting('surcharge_pct', 3)) || 0;

  // VAT is due on everything the student pays, the online fee included.
  function breakdown(base, pct) {
    const fee = Math.round(base * pct / 100);
    const vat = Math.round((base + fee) * VAT_PCT / 100);
    return { fee, vat, total: base + fee + vat };
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  // The code in a browser is the sign-in, so it must not be guessable: 64 random
  // bits (the old clock-plus-3-characters codes stay valid, but new ones are not).
  const memberCode = () => 'B' + BigInt('0x' + crypto.randomBytes(8).toString('hex')).toString(36).toUpperCase().padStart(13, '0');
  // PaySolutions requires a numeric refno; 10 digits, unique.
  // PaySolutions wants a unique 12-digit numeric reference. 8 digits of clock
  // (unique for ~28h) + 4 random; the UNIQUE index on refno is the backstop.
  const newRefno = () => Number(String(Date.now()).slice(-8) +
    String(Math.floor(Math.random() * 10000)).padStart(4, '0'));
  const refno12 = n => String(n).padStart(12, '0');
  const bkkNow = () => new Date();
  const startAtISO = (dateStr, hhmm) => `${dateStr}T${hhmm}:00${TZ_OFFSET}`;
  // Calendar date in Bangkok, NOT UTC. toISOString() would put 01:00 Bangkok on
  // the previous day — and 05:30 Mysore is booked in exactly those hours.
  const ymd = d => new Date(d.getTime() + 7 * 3600000).toISOString().slice(0, 10);
  const bkkToday = () => ymd(bkkNow());
  const isYmd = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
  // "Wed 28 Oct 2026, 07:30" for receipts and the Telegram ping, from the
  // Bangkok class date itself, so the server's own timezone never shifts it.
  const WD3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const classWhen = (dateStr, hhmm) => {
    const d = new Date(`${dateStr}T12:00:00Z`);
    return `${WD3[d.getUTCDay()]} ${d.getUTCDate()} ${MON3[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hhmm}`;
  };
  // A visit they came to: a live seat that was checked in (the door, or the
  // class start for one moved over from Rezerv). Written for bkk_bookings b.
  const ATTENDED = `b.status='booked' AND b.checked_in_at IS NOT NULL`;
  // A no-show: Rezerv said so, or a seat here never checked in by the end of
  // its day (aybkk.net itself never writes 'noshow').
  const NOSHOW = `(b.status='noshow' OR (b.status='booked' AND b.checked_in_at IS NULL
    AND b.class_date < (now() AT TIME ZONE 'Asia/Bangkok')::date))`;
  // A Rezerv class with no time on file is stored at 00:00 with no slot; no
  // class starts at midnight, so that time is shown as unknown.
  const VISIT_TIME = `CASE WHEN b.slot_id IS NULL AND to_char(b.start_at AT TIME ZONE 'Asia/Bangkok','HH24:MI') = '00:00'
    THEN NULL ELSE to_char(b.start_at AT TIME ZONE 'Asia/Bangkok','HH24:MI') END`;
  // When money came in, as a Bangkok day.
  const PAY_AT = `coalesce(o.verified_at, o.created_at)`;
  const PAY_DAY = `(${PAY_AT} AT TIME ZONE 'Asia/Bangkok')::date`;
  const realYmd = d => {
    if (!isYmd(d)) return false;
    const t = Date.parse(`${d}T00:00:00Z`);
    return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
  };

  async function findOrCreateMember({ name, email, phone }) {
    const em = (email || '').trim().toLowerCase();
    if (em) {
      const r = await q('SELECT * FROM bkk_members WHERE lower(email) = $1 LIMIT 1', [em]);
      if (r.rows.length) return r.rows[0];
    }
    const r = await q(
      `INSERT INTO bkk_members (code,name,email,phone) VALUES ($1,$2,$3,$4) RETURNING *`,
      [memberCode(), (name || '').trim() || 'Student', em || null, (phone || '').trim() || null]);
    return r.rows[0];
  }

  // Active pass for a member, preferring one that is already started.
  async function activePass(memberId) {
    const r = await q(
      `SELECT p.*, pr.name_en FROM bkk_passes p JOIN bkk_products pr ON pr.id = p.product_id
       WHERE p.member_id = $1 AND p.status = 'active'
         AND (p.valid_until IS NULL OR p.valid_until >= (now() AT TIME ZONE 'Asia/Bangkok')::date)
         AND (p.kind = 'unlimited' OR p.credits_used < p.credits_total)
       ORDER BY p.valid_from NULLS LAST, p.id LIMIT 1`, [memberId]);
    return r.rows[0] || null;
  }

  // Reports how money can be taken, and — when it cannot — which environment
  // variables are missing. Variable NAMES only, which are already public in the
  // repo; no value, no length, no fragment of any key is ever exposed.
  function paymentStatus() {
    const need = ['PAYSO_MERCHANT_ID', 'PAYSO_SECRET_KEY', 'PAYSO_API_KEY'];
    const missing = need.filter(k => !String(process.env[k] || '').trim());
    if (!missing.length) return { mode: 'gateway' };
    if (String(process.env.PAYSO_PAYSN_STORE || '').trim())
      return { mode: 'link', missingForGateway: missing };
    return { mode: 'none', missing };
  }

  // ── public: catalogue + schedule ──────────────────────────────────────────
  app.get('/api/bkk/products', async (req, res) => {
    try {
      const pct = await surcharge();
      const r = await q('SELECT * FROM bkk_products WHERE active ORDER BY sort, id');
      res.json({
        surchargePct: pct,
        vatPct: VAT_PCT,
        // Which way this shala can take money right now. Names only — never a
        // key, never a fragment of one. 'gateway' = verified auto-activation,
        // 'link' = pay.sn plus a human confirming, 'none' = cannot sell online.
        payment: paymentStatus(),
        // The promotion calculator counts real classes, and a doubled 3-month
        // Duo bought on the last day runs about 7 months.
        moonDays: Object.fromEntries(moonDaysBetween(ymd(new Date()), ymd(new Date(Date.now() + 260 * 86400000)))),
        products: r.rows.map(p => {
          const b = breakdown(p.price_thb, pct);
          return { ...p, fee_thb: b.fee, vat_thb: b.vat, total_thb: b.total };
        }),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Schedule is generated from the weekly pattern on read — no cron.
  // 62 days covers the booking page's calendar: the rest of this month + next.
  const SCHEDULE_DAYS = 62;
  app.get('/api/bkk/schedule', async (req, res) => {
    try {
      const days = Math.min(SCHEDULE_DAYS, Math.max(1, parseInt(req.query.days) || 14));
      const slots = (await q('SELECT * FROM bkk_class_slots WHERE active')).rows;
      const from = new Date();
      const dates = [];
      for (let i = 0; i < days; i++) {
        const d = new Date(from.getTime() + i * 86400000);
        dates.push(ymd(d));
      }
      const overrides = (await q(
        `SELECT * FROM bkk_class_overrides WHERE class_date = ANY($1::date[])`, [dates])).rows;
      const counts = (await q(
        `SELECT slot_id, class_date, count(*)::int AS n FROM bkk_bookings
         WHERE status = 'booked' AND class_date = ANY($1::date[])
         GROUP BY slot_id, class_date`, [dates])).rows;

      const moon = moonDaysBetween(dates[0], dates[dates.length - 1]);
      const out = [];
      for (const dstr of dates) {
        if (moon.has(dstr)) continue;
        const wd = new Date(`${dstr}T12:00:00${TZ_OFFSET}`).getUTCDay();
        for (const s of slots.filter(x => x.weekday === wd)) {
          const ov = overrides.find(o => o.slot_id === s.id && ymd(new Date(o.class_date)) === dstr);
          if (ov && ov.cancelled) continue;
          // ?? not || — an override capacity of 0 ("closed today") is a real value.
          const cap = (ov && ov.capacity != null) ? ov.capacity : s.capacity;
          const booked = (counts.find(c => c.slot_id === s.id && ymd(new Date(c.class_date)) === dstr) || {}).n || 0;
          const startAt = startAtISO(dstr, s.start_time);
          if (new Date(startAt) < bkkNow()) continue;         // hide past classes
          out.push({
            slotId: s.id, date: dstr, startAt, title: s.title, kind: s.kind,
            teachers: rotationTeacher(s.code, dstr) || s.teachers || '', durationMin: s.duration_min,
            isOnline: s.is_online, capacity: cap, booked, seatsLeft: Math.max(0, cap - booked),
          });
        }
      }
      out.sort((a, b) => a.startAt.localeCompare(b.startAt));
      // to: the last day loaded, so a page knows a later day is not "no class".
      res.json({ classes: out, moonDays: Object.fromEntries(moon), to: dates[dates.length - 1], cutoffHours: CANCEL_CUTOFF_HOURS });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── buy: create order, hand back a PaySolutions redirect ──────────────────
  app.post('/api/bkk/orders', async (req, res) => {
    try {
      const { productCode, name, email, phone } = req.body || {};
      if (!productCode || !(name || '').trim() || !(email || '').trim())
        return res.status(400).json({ error: 'name, email and product are required' });

      const pr = (await q('SELECT * FROM bkk_products WHERE code = $1 AND active', [productCode])).rows[0];
      if (!pr) return res.status(404).json({ error: 'product not found' });

      // A drop-in is one class, so it is bought FOR a class and paying books it.
      // Checked here as a student booking would be; the seat itself is taken
      // only once the payment is confirmed.
      let cls = null;
      if (singleClass(pr)) {
        const { slotId, date } = req.body;
        if (!slotId || !isYmd(date) || !Number.isInteger(Number(slotId)))
          return res.status(400).json({ error: 'Pick the class for your drop-in.' });
        // No further than the timetable shows: a seat sold for a class years
        // off would outlive any change to the timetable before then.
        if (date > ymd(new Date(bkkNow().getTime() + (SCHEDULE_DAYS - 1) * 86400000)))
          return res.status(409).json({ error: 'You can buy a drop-in for the next 2 months only.' });
        try {
          const c = await classCheck(pool, slotId, date);
          if (await seatsTaken(pool, slotId, date) >= c.capacity) throw new Error('class is full');
          cls = { slotId: Number(slotId), date };
        } catch (e) { return res.status(409).json({ error: e.message }); }
      }

      const before = (await q('SELECT id FROM bkk_members WHERE lower(email)=$1 LIMIT 1',
        [String(email).trim().toLowerCase()])).rows[0];
      const member = await findOrCreateMember({ name, email, phone });
      // Typing someone's email at checkout must not open their profile (photos,
      // teacher notes): an existing profile's code goes back only to a browser
      // that already holds it. Everyone else signs in from the receipt email.
      const showCode = !before || req.body.memberCode === member.code;
      const pct = await surcharge();
      const { fee, vat, total } = breakdown(pr.price_thb, pct);

      // refno is unique-indexed and partly random, so a clash is possible if two
      // orders land in the same millisecond. Retry rather than 500 at a student.
      let o = null;
      for (let attempt = 0; attempt < 5 && !o; attempt++) {
        try {
          o = (await q(
            `INSERT INTO bkk_orders (refno,product_id,member_id,base_thb,fee_thb,vat_thb,amount_thb,slot_id,class_date)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [newRefno(), pr.id, member.id, pr.price_thb, fee, vat, total,
             cls && cls.slotId, cls && cls.date])).rows[0];
        } catch (e) {
          if (!/duplicate key/.test(e.message) || attempt === 4) throw e;
        }
      }

      const cfg = paysoConfig();
      res.json({
        order: { id: o.id, refno: String(o.refno), amount: total, product: pr.name_en },
        member: showCode ? { code: member.code } : { existing: true },
        pay: cfg ? buildPayForm(cfg, o, pr, member, req) : null,
        payLink: cfg ? null : paysnLink(o, pr),
        payUnavailable: (cfg || paysnLink(o, pr)) ? undefined :
          'Online payment is not configured yet — the shala will contact you to arrange payment.',
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Pay.sn is PaySolutions' no-code product: a payment link, no API key, no
  // secret, and therefore nothing we can verify server-side. Orders paid this
  // way stay 'pending' until a human confirms in the admin — deliberately, since
  // auto-activating on an unverifiable signal would hand out free memberships.
  // Format from the merchant console: pay.sn/<store>/<amount>/<detail>,
  // capped at 300,000 THB per link.
  const PAYSN_MAX_THB = 300000;
  function paysnLink(order, product) {
    const store = (process.env.PAYSO_PAYSN_STORE || '').trim().replace(/^\/+|\/+$/g, '');
    if (!store) return null;
    if (order.amount_thb > PAYSN_MAX_THB) return null;
    const ref = String(order.refno);
    // The detail is a path segment: keep slashes out of it entirely rather than
    // relying on %2F surviving their router.
    const detail = `AYBKK ${product.name_en} ref ${ref}`.replace(/[\/\\?#&]+/g, '-');
    return {
      url: `https://pay.sn/${store}/${order.amount_thb}/${encodeURIComponent(detail)}`,
      refno: ref,
      amount: order.amount_thb,
      // Shown to the student — they must quote this so the payment can be matched.
      note: `Please keep reference #${ref}. Your pass is activated once the shala ` +
            `sees the payment, usually the same day.`,
    };
  }

  // All three keys are required, not just the merchant id: the redirect itself
  // needs only merchantid, but without the Inquiry credentials we could never
  // confirm a payment, and activating on an unverifiable postback would give
  // away memberships. No credentials → no automatic activation, by design.
  function paysoConfig() {
    const merchantId = process.env.PAYSO_MERCHANT_ID;
    const secret = process.env.PAYSO_SECRET_KEY;
    const apiKey = process.env.PAYSO_API_KEY;
    if (!merchantId || !secret || !apiKey) return null;
    return {
      merchantId, secret, apiKey,
      endpoint: process.env.PAYSO_ENDPOINT || 'https://payments.paysolutions.asia/payment',
      inquiryBase: process.env.PAYSO_INQUIRY_BASE || 'https://apis.paysolutions.asia',
    };
  }

  // The redirect is unsigned — PaySolutions publishes no hash, checksum or MAC
  // for it, so every field here is modifiable by the payer before submitting.
  // Nothing is trusted on the way back: the amount is re-read from the Inquiry
  // API and compared with what we recorded.
  // Return URL and Post Back URL are NOT form fields; they are configured once
  // in the merchant panel and PaySolutions appends no parameters to the return.
  function buildPayForm(cfg, order, product, member) {
    return {
      action: cfg.endpoint,
      fields: {
        merchantid: String(cfg.merchantId),
        refno: refno12(order.refno),
        customeremail: String(member.email || '').slice(0, 100),
        productdetail: `AYBKK ${product.name_en}`.replace(/[<>&"']/g, ' ').slice(0, 255),
        total: order.amount_thb.toFixed(2),
        cc: '00',                                   // 00 = Thai baht
        lang: 'EN',
      },
      refno: refno12(order.refno),
    };
  }

  // ── payment confirmation ──────────────────────────────────────────────────
  // The postback carries NO trustworthy signature (PaySolutions' own plugins
  // accept it blindly). It only tells us *which* order to go and verify.
  app.post('/api/bkk/pay/postback', express_urlencoded_safe, async (req, res) => {
    const refno = String((req.body && (req.body.refno || req.body.refNo)) || req.query.refno || '').trim();
    res.json({ ok: true });                        // always 200 — never leak state
    if (!refno) return;
    try { await verifyAndActivate(Number(refno)); }
    catch (e) { console.error('[bkk pay] verify failed:', e.message); }
  });

  // Student's browser comes back here; also triggers a verify so activation is
  // not dependent on the postback arriving.
  app.get('/api/bkk/pay/check/:refno', async (req, res) => {
    try {
      const r = await verifyAndActivate(Number(req.params.refno));
      res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  async function verifyAndActivate(refno) {
    const o = (await q('SELECT * FROM bkk_orders WHERE refno = $1', [refno])).rows[0];
    if (!o) return { status: 'unknown' };
    if (o.status === 'paid') return { status: 'paid', already: true, ...await orderBooking(o) };
    // A Rezerv payment is history: it never goes near the gateway or a pass.
    if (o.source === 'rezerv') return { status: o.status };

    const cfg = paysoConfig();
    if (!cfg) return { status: o.status, note: 'gateway not configured' };

    const verdict = await inquire(cfg, o);
    if (!verdict.paid) {
      await q(`UPDATE bkk_orders SET gateway_note = $2 WHERE id = $1`,
        [o.id, (verdict.note || 'not confirmed').slice(0, 300)]);
      return { status: o.status, note: verdict.note };
    }
    // Amount must match what we asked for. A confirmed payment with no amount
    // is not good enough either — the redirect form is unsigned, so the amount
    // is the one thing a payer could have altered, and it is exactly what must
    // be checked before a pass is created.
    if (verdict.amount == null || Math.round(Number(verdict.amount)) !== o.amount_thb) {
      await q(`UPDATE bkk_orders SET status='mismatch', gateway_note=$2 WHERE id=$1`,
        [o.id, `amount ${verdict.amount} != ${o.amount_thb}`]);
      console.warn(`[bkk pay] AMOUNT MISMATCH refno=${refno} gateway=${verdict.amount} expected=${o.amount_thb}`);
      return { status: 'mismatch' };
    }
    await activateOrder(o, verdict);
    return { status: 'paid', ...await orderBooking(o) };
  }

  // The class a paid drop-in booked, for the "you are booked into…" message.
  // Read back from the database, so a second check (or a postback that won
  // the race) gets the same answer as the first. The buyer's live seat in the
  // order's class: the one the order's pass took, or one they already had.
  // No seat (the class was cancelled or over by the time the payment came
  // through) is said out loud: the student picked that class and would
  // otherwise travel to it.
  async function orderBooking(o) {
    if (!o.slot_id) return {};
    const b = (await q(
      `SELECT s.title, b.start_at FROM bkk_orders o
       JOIN bkk_bookings b ON b.slot_id=o.slot_id AND b.class_date=o.class_date
         AND b.member_id=o.member_id AND b.status='booked'
       JOIN bkk_class_slots s ON s.id=b.slot_id
       WHERE o.id=$1 LIMIT 1`, [o.id])).rows[0];
    if (b) return { booking: { title: b.title, startAt: b.start_at } };
    const c = (await q(
      `SELECT s.title, s.start_time, to_char(o.class_date,'YYYY-MM-DD') AS class_date
       FROM bkk_orders o JOIN bkk_class_slots s ON s.id=o.slot_id WHERE o.id=$1`, [o.id])).rows[0];
    return c ? { notBooked: { title: c.title, startAt: startAtISO(c.class_date, c.start_time) } } : {};
  }

  // POST /order/orderdetailpost. Header casing is theirs and is inconsistent
  // with their other endpoints — merchantID, merchantSecretKey, apikey — so it
  // is written out literally rather than normalised. merchantID is the LAST 5
  // DIGITS of the merchant id, in both header and body. Unused body fields take
  // the literal placeholders the docs specify ("X", "QWERTY").
  async function inquire(cfg, order) {
    const url = `${cfg.inquiryBase.replace(/\/$/, '')}/order/orderdetailpost`;
    const mid5 = String(cfg.merchantId).slice(-5);
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        merchantID: mid5,
        merchantSecretKey: cfg.secret,
        apikey: cfg.apiKey,
      },
      body: JSON.stringify({
        merchantID: mid5,
        orderNo: 'X',
        refno: refno12(order.refno),
        productDetail: 'QWERTY',
      }),
    });
    const text = (await r.text()).trim();
    // Documented failure mode: an unsuccessful payment returns no body at all.
    if (!text) return { paid: false, note: `no record (http ${r.status})` };
    let j = null; try { j = JSON.parse(text); } catch (_) {}
    if (!j) return { paid: false, note: `inquiry ${r.status}: ${text.slice(0, 120)}` };
    const d = Array.isArray(j) ? j[0] : (j.data || j);
    // Carry the HTTP status in every note: an unpaid order and a rejected API
    // key both come back "not paid", and the code is what tells them apart.
    if (!d) return { paid: false, note: `no record (http ${r.status})` };
    const status = String(d.Status ?? '').toUpperCase();
    const paid = status === 'CP';
    // Total comes back as a JSON number (3900.0), not a string.
    const amount = d.Total == null ? null : Number(d.Total);
    return {
      paid, amount, raw: d,
      note: paid ? 'confirmed'
        : `http ${r.status} status=${status || 'unknown'} ${d.StatusName || ''}`.trim(),
    };
  }

  // An order bought for a class (a drop-in) also takes its seat, with the new
  // pass. opts.checkIn, opts.source and opts.requestId are for a drop-in paid
  // at the door. Returns { booking, bookingError }, { unsold, seat } when the
  // door's sale was not needed after all (seat: what takeSeat found), or null
  // when the order was already paid.
  async function activateOrder(order, verdict = {}, opts = {}) {
    const pr = (await q('SELECT * FROM bkk_products WHERE id = $1', [order.product_id])).rows[0];
    const client = await pool.connect();
    let seat = null, cls = null;
    try {
      await client.query('BEGIN');
      const upd = await client.query(
        `UPDATE bkk_orders SET status='paid', verified_at=now(), gateway_ref=$2, gateway_note=$3
         WHERE id=$1 AND status <> 'paid' RETURNING slot_id, to_char(class_date,'YYYY-MM-DD') AS class_date`,
        [order.id, verdict.raw ? JSON.stringify(verdict.raw).slice(0, 400) : null, verdict.note || null]);
      if (!upd.rows.length) { await client.query('ROLLBACK'); return null; }   // already activated
      const pass = (await client.query(
        `INSERT INTO bkk_passes (member_id,product_id,order_id,kind,credits_total,daily_cap,valid_days)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [order.member_id, pr.id, order.id, pr.kind, pr.credits, pr.daily_cap, pr.valid_days])).rows[0];
      const { slot_id: slotId, class_date: date } = upd.rows[0];
      if (slotId && date) {
        // The seat must never cost the student the payment. A class cancelled
        // (or over) while they paid rolls back to here: the order stays paid,
        // the pass stays a 1-class credit, and the shala is told to sort it out.
        // Staff timing: a payment confirmed after 07:30 still books until the end.
        await client.query('SAVEPOINT seat');
        try {
          seat = await takeSeat(client, { member: { id: order.member_id }, slotId, date, staff: true,
            allowOver: true, cover: 'pass', passId: pass.id, checkIn: !!opts.checkIn,
            source: opts.source || 'order', requestId: opts.requestId, onList: true });
          await client.query('RELEASE SAVEPOINT seat');
        } catch (e) {
          await client.query('ROLLBACK TO SAVEPOINT seat');
          seat = { error: e.message };
        }
        // At the door (or staff adding from the calendar) the money is still in
        // the hand. Another phone (or a second tap) put them on the list while
        // this sale was on its way: they keep that seat, and nothing is sold twice.
        if ((opts.source === 'door' || opts.source === 'staff') && seat.already) {
          await client.query('DELETE FROM bkk_passes WHERE id=$1', [pass.id]);
          await client.query('DELETE FROM bkk_orders WHERE id=$1', [order.id]);
          await client.query('COMMIT');
          return { unsold: true, seat };
        }
        const s = (await client.query('SELECT title, start_time FROM bkk_class_slots WHERE id=$1', [slotId])).rows[0];
        cls = { name: s ? s.title : `class ${slotId}`, when: classWhen(date, s ? s.start_time : '') };
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK'); throw e;
    } finally { client.release(); }

    const booked = cls && !seat.error;
    console.log(`✓ bkk: pass activated for order ${order.id} (${pr.name_en})${cls ? (booked
      ? `, booked ${cls.name} ${cls.when}` : `, could NOT book ${cls.name} ${cls.when}: ${seat.error}`) : ''}`);
    const lines = [`💳 AYBKK payment (${order.method || 'online'})`, `${pr.name_en} · ฿${order.amount_thb}`, `refno ${order.refno}`];
    if (booked) lines.push(`📅 ${seat.already ? 'Already on the list' : 'Booked'}: ${cls.name}, ${cls.when}`
      + (seat.overCapacity ? `\n⚠ over capacity: ${seat.taken + 1} for ${seat.capacity} places` : ''));
    else if (cls) lines.push(`⚠ Paid, but could not book ${cls.name}, ${cls.when}: ${seat.error}. Book them by hand.`);
    notify(lines.join('\n'));
    // After COMMIT, and awaited only so failures are logged. The pass already
    // exists; a mail server having a bad day must not undo a paid order.
    emailReceipt(order, pr, cls && { ...cls, booked }).catch(e => console.error('[bkk] receipt failed:', e.message));
    return {
      booking: booked ? { title: cls.name, startAt: seat.startAt, overCapacity: seat.overCapacity, already: seat.already } : null,
      bookingError: cls && seat.error ? seat.error : null,
    };
  }

  // The receipt doubles as the student's way back in: it carries a sign-in link,
  // so nobody has to keep a member code safe to keep their pass.
  async function emailReceipt(order, product, cls) {
    const m = (await q('SELECT * FROM bkk_members WHERE id=$1', [order.member_id])).rows[0];
    if (!m || !m.email) return;
    const token = crypto.randomBytes(32).toString('hex');
    await q(`INSERT INTO bkk_login_tokens (token,member_id,email,ip,expires_at)
             VALUES ($1,$2,$3,'receipt', now() + interval '30 days')`,
      [token, m.id, m.email]);
    const t = render('receipt', m.lang || 'en', {
      name: m.name, product: product.name_en,
      amount: order.amount_thb, base: order.base_thb, fee: order.fee_thb, vat: order.vat_thb || 0,
      refno: order.refno, link: `${baseUrl()}/api/bkk/login/${token}`, cls,
    });
    await sendMail({ to: m.email, subject: t.subject, html: t.html, text: t.text, tag: 'receipt' });
  }

  async function notify(text) {
    try {
      const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.BOONCHU_CHAT_ID;
      if (!token || !chat) return;
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text }),
      });
    } catch (_) {}
  }

  // ── sign in by email ──────────────────────────────────────────────────────
  // A member code lives in one browser. Lose it and the student is locked out —
  // and the shala has no way to look it up either. A one-time link is the only
  // option here that actually proves the student owns the address: a name is
  // guessable and an email address is not a secret.

  const baseUrl = () => (process.env.PUBLIC_BASE_URL || 'https://cn.aybkk.net').replace(/\/$/, '');
  const clientIp = req =>
    String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress || 'unknown';

  app.post('/api/bkk/login/request', async (req, res) => {
    // The answer never varies. Telling a stranger whether an address is
    // registered would leak the shala's student list one guess at a time.
    const vague = { ok: true, message: 'If that address is registered, a link is on its way.' };
    try {
      const email = String((req.body || {}).email || '').trim().toLowerCase();
      const lang = String((req.body || {}).lang || '').slice(0, 5) || null;
      if (!email || !email.includes('@')) return res.json(vague);
      const ip = clientIp(req);

      const [byEmail, byIp] = await Promise.all([
        q(`SELECT count(*)::int AS n FROM bkk_login_tokens
           WHERE email=$1 AND created_at > now() - interval '1 hour'`, [email]),
        q(`SELECT count(*)::int AS n FROM bkk_login_tokens
           WHERE ip=$1 AND created_at > now() - interval '1 hour'`, [ip]),
      ]);
      if (byEmail.rows[0].n >= SIGNIN_PER_EMAIL_HOUR || byIp.rows[0].n >= SIGNIN_PER_IP_HOUR) {
        console.warn(`[bkk login] throttled ${email} from ${ip}`);
        return res.json(vague);
      }

      const m = (await q('SELECT * FROM bkk_members WHERE lower(email)=$1 LIMIT 1', [email])).rows[0];
      if (!m) return res.json(vague);
      if (lang) await q('UPDATE bkk_members SET lang=$2 WHERE id=$1', [m.id, lang]);

      const token = crypto.randomBytes(32).toString('hex');
      await q(`INSERT INTO bkk_login_tokens (token,member_id,email,ip,expires_at)
               VALUES ($1,$2,$3,$4, now() + ($5 || ' minutes')::interval)`,
        [token, m.id, email, ip, String(SIGNIN_TTL_MIN)]);

      const t = render('signin', lang || m.lang || 'en',
        { name: m.name, link: `${baseUrl()}/api/bkk/login/${token}` });
      await sendMail({ to: m.email, subject: t.subject, html: t.html, text: t.text, tag: 'signin' });
      res.json(vague);
    } catch (e) {
      console.error('[bkk login] request failed:', e.message);
      res.json(vague);
    }
  });

  // M sends a student their own sign-in link by LINE, WhatsApp or WeChat: most
  // Rezerv students have no email on file here. Same one-time token as the
  // email link, just longer-lived because it waits in a chat.
  app.post('/api/bkk/admin/members/:code/signin-link', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const m = (await q('SELECT id,name FROM bkk_members WHERE code=$1', [req.params.code])).rows[0];
      if (!m) return res.status(404).json({ error: 'member not found' });
      const token = crypto.randomBytes(32).toString('hex');
      await q(`INSERT INTO bkk_login_tokens (token,member_id,email,ip,expires_at)
               VALUES ($1,$2,NULL,'staff', now() + ($3 || ' days')::interval)`,
        [token, m.id, String(STAFF_LINK_DAYS)]);
      res.json({ success: true, name: m.name, days: STAFF_LINK_DAYS,
        link: `${baseUrl()}/api/bkk/login/${token}` });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // The shala fixes an email (8 Oct: a sign-in link went to the wrong student,
  // who typed her own email into the other profile and then could not add it to
  // her own). Empty clears it. An email another profile holds moves only when
  // the request names that profile in takeFrom: a typo never silently steals one.
  // An address that leaves a profile takes its sign-in and receipt links with it,
  // or the person it belongs to could still open the profile it left.
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const stopLinks = (db, memberId, email) => db.query(
    `UPDATE bkk_login_tokens SET expires_at=now()
     WHERE member_id=$1 AND lower(email)=$2 AND expires_at > now()`, [memberId, email]);
  app.post('/api/bkk/admin/members/:code/email', async (req, res) => {
    if (adminOnly(req, res)) return;
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'not an email address' });
    const clash = async () => {
      const o = (await q('SELECT code,name FROM bkk_members WHERE lower(email)=$1 AND code<>$2',
        [email, req.params.code])).rows[0];
      return o && res.status(409).json({ error: `that email is on ${o.name}'s profile (${o.code})`,
        owner: { code: o.code, name: o.name } });
    };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Lock both profiles in id order, so two crossed moves can't deadlock.
      const rows = (await client.query(
        `SELECT id,code,name,email FROM bkk_members
         WHERE code=$1 OR ($2 <> '' AND lower(email)=$2) ORDER BY id FOR UPDATE`,
        [req.params.code, email])).rows;
      const m = rows.find(r => r.code === req.params.code);
      if (!m) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'member not found' }); }
      const owner = rows.find(r => r !== m);
      if (owner) {
        if (b.takeFrom !== owner.code) { await client.query('ROLLBACK'); return clash(); }
        await client.query('UPDATE bkk_members SET email=NULL WHERE id=$1', [owner.id]);
        await stopLinks(client, owner.id, email);
      }
      const old = String(m.email || '').toLowerCase();
      if (old && old !== email) await stopLinks(client, m.id, old);
      await client.query('UPDATE bkk_members SET email=$2 WHERE id=$1', [m.id, email || null]);
      await client.query('COMMIT');
      console.log(`✓ bkk: email of ${m.code} ${email ? 'set' : 'cleared'} by admin${owner ? `, moved from ${owner.code}` : ''}`);
      res.json({ success: true, member: { code: m.code, name: m.name, email: email || null } });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      // A student saved the same address a moment ago: same answer as a clash.
      if (e.code === '23505' && email && await clash()) return;
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // The member code in a browser IS the sign-in: whoever opened a profile keeps
  // it. When the wrong person got in, give the profile a new code and stop all
  // its sign-in links, in one transaction, so every phone is signed out and the
  // real owner gets a new link. clearEmail also removes an email that belongs to
  // the wrong person; left on, it would let her sign straight back in.
  // Bookings, passes, photos and journal hang off the member id, not the code.
  app.post('/api/bkk/admin/members/:code/signout', async (req, res) => {
    if (adminOnly(req, res)) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const m = (await client.query('SELECT id,name,email FROM bkk_members WHERE code=$1 FOR UPDATE',
        [req.params.code])).rows[0];
      if (!m) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'member not found' }); }
      // A profile with an email needs M's answer about THAT email (keep or
      // remove), given against what it is now, not a search from before the
      // wrong person typed hers in (8 Oct review: the stale screen let her back).
      const b = req.body || {};
      const now = m.email ? String(m.email).toLowerCase() : null;
      const saw = b.expectEmail ? String(b.expectEmail).toLowerCase() : null;
      if (now && (saw !== now || typeof b.clearEmail !== 'boolean')) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `${m.name}'s profile has the email ${m.email}: keep it or remove it?`,
          needEmailDecision: true, email: m.email });
      }
      const links = await client.query(`UPDATE bkk_login_tokens SET expires_at=now()
                                        WHERE member_id=$1 AND expires_at > now()`, [m.id]);
      const clear = !!now && b.clearEmail === true;
      const code = (await client.query(
        `UPDATE bkk_members SET code=$2${clear ? ', email=NULL' : ''} WHERE id=$1 RETURNING code`,
        [m.id, memberCode()])).rows[0].code;
      await client.query('COMMIT');
      console.log(`✓ bkk: ${req.params.code} signed out everywhere, now ${code} (${links.rowCount} links stopped${clear ? ', email removed' : ''})`);
      res.json({ success: true, member: { code, name: m.name, email: clear ? null : m.email },
        linksStopped: links.rowCount, removedEmail: clear ? m.email : undefined });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // The student's own proof check. Same trust as the rest of /me: the member
  // code the signed-in browser holds.
  app.get('/api/bkk/me/:code/checks', async (req, res) => {
    try {
      const m = (await q('SELECT id FROM bkk_members WHERE code=$1', [req.params.code])).rows[0];
      if (!m) return res.status(404).json({ error: 'not found' });
      const r = await q(
        `SELECT to_char(taken_on,'YYYY-MM-DD') AS date, resting_hr, sleep_hours, feel, note
         FROM bkk_checks WHERE member_id=$1 ORDER BY taken_on`, [m.id]);
      res.json({ checks: r.rows.map(c => ({ date: c.date, restingHr: c.resting_hr,
        sleepHours: c.sleep_hours == null ? null : Number(c.sleep_hours), feel: c.feel, note: c.note })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/bkk/me/:code/checks', async (req, res) => {
    try {
      const m = (await q('SELECT id FROM bkk_members WHERE code=$1', [req.params.code])).rows[0];
      if (!m) return res.status(404).json({ error: 'not found' });
      const b = req.body || {};
      const hr = b.restingHr === '' || b.restingHr == null ? null : Number(b.restingHr);
      const sleep = b.sleepHours === '' || b.sleepHours == null ? null : Number(b.sleepHours);
      const feel = b.feel === '' || b.feel == null ? null : Number(b.feel);
      if (hr != null && !(Number.isInteger(hr) && hr >= 30 && hr <= 200)) return res.status(400).json({ error: 'resting heart rate must be 30 to 200' });
      if (sleep != null && !(sleep >= 0 && sleep <= 14)) return res.status(400).json({ error: 'sleep must be 0 to 14 hours' });
      if (feel != null && !(Number.isInteger(feel) && feel >= 1 && feel <= 5)) return res.status(400).json({ error: 'feel must be 1 to 5' });
      if (hr == null && sleep == null && feel == null) return res.status(400).json({ error: 'fill in at least one number' });
      await q(`INSERT INTO bkk_checks (member_id,taken_on,resting_hr,sleep_hours,feel,note)
               VALUES ($1,(now() AT TIME ZONE 'Asia/Bangkok')::date,$2,$3,$4,$5)
               ON CONFLICT (member_id,taken_on) DO UPDATE SET resting_hr=$2, sleep_hours=$3, feel=$4, note=$5`,
        [m.id, hr, sleep, feel, String(b.note || '').trim().slice(0, 300) || null]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // A signed-in student adds their email, so they can sign in again on another
  // phone. Only when none is set: changing one is a job for the shala.
  app.post('/api/bkk/me/:code/email', async (req, res) => {
    try {
      const email = String((req.body || {}).email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'not an email address' });
      const m = (await q('SELECT id,email FROM bkk_members WHERE code=$1', [req.params.code])).rows[0];
      if (!m) return res.status(404).json({ error: 'not found' });
      if (m.email) return res.status(409).json({ error: 'an email is already set; ask the shala to change it' });
      const taken = await q('SELECT 1 FROM bkk_members WHERE lower(email)=$1', [email]);
      if (taken.rows.length) return res.status(409).json({ error: 'that email belongs to another profile; ask the shala' });
      await q('UPDATE bkk_members SET email=$2 WHERE id=$1', [m.id, email]);
      res.json({ success: true });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'that email belongs to another profile; ask the shala' });
      res.status(500).json({ error: e.message });
    }
  });

  // Opening the link (GET) never uses it up: LINE, WhatsApp and WeChat fetch every
  // link to draw a preview, which used up one-time tokens before the student ever
  // tapped (4 Oct). The page posts back to itself, which a preview bot never does.
  // Staff-made links (sent in a private chat) keep working until they expire, so a
  // second phone or a re-open is fine; emailed links stay one-time.
  // The code is handed to the browser, never put in a URL, so it stays out of history.
  const loginPage = (msg, extra = '', lang = 'en') => `<!DOCTYPE html><html lang="${lang}"><meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>AYBKK</title>
<body style="font-family:-apple-system,sans-serif;background:#f7f1f5;color:#17121a;
text-align:center;padding:22vh 20px"><p>${msg}</p>${extra}</body></html>`;
  const usable = `token = $1 AND expires_at > now() AND (used_at IS NULL OR ip = 'staff')`;

  // ── the Monday letter (email sign-ups) ────────────────────────────────────
  // Double opt-in: the address joins only when its owner taps Confirm, so nobody
  // can sign up someone else. Every row came with the consent tick; asked_at and
  // confirmed_at date the latest consent, unsubscribed_at the latest withdrawal.
  // The answer never says whether an address is already on the list. The token
  // in every link is the only key; there is no login.
  const LETTER_LANGS = ['en', 'th', 'zh', 'ru'];
  const letterLang = v => (LETTER_LANGS.includes(String(v || '').slice(0, 2)) ? String(v).slice(0, 2) : 'en');
  const letterOk = { ok: true };
  app.post('/api/bkk/newsletter', async (req, res) => {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
      return res.status(400).json({ error: 'email' });
    }
    if (b.consent !== true) return res.status(400).json({ error: 'consent' });
    const lang = letterLang(b.lang);
    const src = String(b.src || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || null;
    try {
      const ip = clientIp(req);
      const sent = (await q(`SELECT count(*) FILTER (WHERE ip=$1 AND at > now() - interval '1 hour')::int AS ip,
          count(*) FILTER (WHERE at > now() - interval '1 hour')::int AS hour, count(*)::int AS day
        FROM bkk_letter_asks WHERE at > now() - interval '1 day'`, [ip])).rows[0];
      // Said out loud, not "check your inbox": a reader on a busy shared
      // network can come back later or take LINE.
      if (sent.ip >= LETTER_PER_IP_HOUR || sent.hour >= LETTER_PER_HOUR || sent.day >= LETTER_PER_DAY) {
        console.warn(`[bkk letter] throttled ${ip}`);
        return res.status(429).json({ error: 'busy' });
      }
      // Every ask gets a new token, so an old link (a forwarded letter's footer)
      // can never confirm a later ask. One address gets at most 3 confirm mails
      // a day, 10 minutes apart, except that someone who left can come back at
      // once. A confirmed reader is left alone.
      const row = (await q(
        `INSERT INTO bkk_newsletter (email,lang,src,token) VALUES ($1,$2,$3,$4)
         ON CONFLICT (email) DO UPDATE SET lang=EXCLUDED.lang, token=EXCLUDED.token, status='pending', asked_at=now(),
           asks = CASE WHEN bkk_newsletter.asked_at < now() - interval '1 day' THEN 1 ELSE bkk_newsletter.asks + 1 END
         WHERE bkk_newsletter.status <> 'confirmed'
           AND (bkk_newsletter.asks < ${LETTER_ASKS_PER_DAY} OR bkk_newsletter.asked_at < now() - interval '1 day')
           AND (bkk_newsletter.status = 'unsubscribed' OR bkk_newsletter.asked_at < now() - interval '10 minutes')
         RETURNING id, token`,
        [email, lang, src, crypto.randomBytes(24).toString('base64url')])).rows[0];
      if (row) {
        const t = render('letterConfirm', lang, { link: `${baseUrl()}/api/bkk/newsletter/confirm/${row.token}` });
        const r = await sendMail({ to: email, subject: t.subject, html: t.html, text: t.text, tag: 'letter-confirm' });
        if (!r.sent) {
          // Mail is off or Resend said no. Undo the ask so a retry goes straight
          // out, and tell the reader instead of sending them to an empty inbox.
          await q(`UPDATE bkk_newsletter SET asks = asks - 1, asked_at = now() - interval '11 minutes' WHERE id=$1`, [row.id]);
          return res.status(503).json({ error: 'mail' });
        }
        await q(`INSERT INTO bkk_letter_asks (ip) VALUES ($1)`, [ip]);
      }
      res.json(letterOk);
    } catch (e) {
      console.error('[bkk letter] sign-up failed:', e.message);
      res.status(500).json({ error: 'failed' });
    }
  });

  // The pages open in the language the reader signed up in.
  const LETTER_PAGE = {
    en: {
      confirm: 'Last step: tap the button to get the AYBKK Monday letter.',
      confirmBtn: 'Yes, send me the letter',
      confirmed: 'Thank you. You are on the list: the AYBKK letter comes every Monday.',
      leave: 'Stop the AYBKK Monday letter?',
      leaveBtn: 'Unsubscribe',
      left: 'Done. You will not get the letter any more. You can sign up again on aybkk.net any time.',
    },
    th: {
      confirm: 'ขั้นสุดท้าย: กดปุ่มด้านล่างเพื่อรับจดหมาย AYBKK ทุกวันจันทร์',
      confirmBtn: 'ยืนยัน ส่งจดหมายให้ฉัน',
      confirmed: 'ขอบคุณค่ะ คุณจะได้รับจดหมายจาก AYBKK ทุกวันจันทร์',
      leave: 'ยกเลิกการรับจดหมาย AYBKK ทุกวันจันทร์ใช่ไหม?',
      leaveBtn: 'ยกเลิกการรับจดหมาย',
      left: 'ยกเลิกเรียบร้อยแล้ว คุณจะไม่ได้รับจดหมายอีก สมัครใหม่ได้ที่ aybkk.net ทุกเมื่อ',
    },
    zh: {
      confirm: '最后一步：点击下方按钮，每周一收到 AYBKK 来信。',
      confirmBtn: '确认订阅',
      confirmed: '谢谢！订阅成功，AYBKK 来信每周一送达。',
      leave: '要退订 AYBKK 每周一来信吗？',
      leaveBtn: '退订',
      left: '已退订，您将不再收到来信。随时可以在 aybkk.net 重新订阅。',
    },
    ru: {
      confirm: 'Последний шаг: нажмите кнопку, чтобы получать письмо AYBKK по понедельникам.',
      confirmBtn: 'Да, присылайте письмо',
      confirmed: 'Спасибо! Вы подписаны: письмо AYBKK приходит каждый понедельник.',
      leave: 'Отписаться от письма AYBKK по понедельникам?',
      leaveBtn: 'Отписаться',
      left: 'Готово. Письмо больше не будет приходить. Подписаться снова можно на aybkk.net в любой момент.',
    },
  };
  const letterDead = () => loginPage('This link is not valid any more. You can sign up again on '
    + '<a href="/book#letter" style="color:#5c2160">aybkk.net</a>.<br>ลิงก์นี้ใช้ไม่ได้แล้ว สมัครใหม่ได้ที่ aybkk.net');
  const letterBtn = (label, bg) => `<form method="post"><button style="font:inherit;font-weight:700;padding:14px 22px;
border:0;border-radius:10px;background:${bg};color:#fff">${label}</button></form>`;
  // A confirm link works for 7 days; then the unconfirmed address is deleted.
  const confirmable = `(status = 'confirmed' OR (status = 'pending' AND asked_at > now() - interval '7 days'))`;
  const letterPurge = () => q(`DELETE FROM bkk_newsletter WHERE status='pending' AND asked_at < now() - interval '7 days'`)
    .then(() => q(`DELETE FROM bkk_letter_asks WHERE at < now() - interval '1 day'`))
    .catch(e => console.error('[bkk letter] purge failed:', e.message));
  setInterval(letterPurge, 24 * 3600 * 1000).unref();
  // GET only shows a page: mail scanners and chat previews open every link,
  // and some run its scripts, so confirming and leaving each take a real tap.
  app.get('/api/bkk/newsletter/confirm/:token', async (req, res) => {
    try {
      const row = (await q(`SELECT status, lang FROM bkk_newsletter WHERE token=$1 AND ${confirmable}`,
        [req.params.token])).rows[0];
      if (!row) return res.status(400).send(letterDead());
      const lang = letterLang(row.lang), p = LETTER_PAGE[lang];
      res.set('Cache-Control', 'no-store').send(row.status === 'confirmed'
        ? loginPage(p.confirmed, '', lang)
        : loginPage(p.confirm, letterBtn(p.confirmBtn, '#e8458c'), lang));
    } catch (e) { res.status(500).send(loginPage('Something went wrong. Please try again.')); }
  });
  app.post('/api/bkk/newsletter/confirm/:token', async (req, res) => {
    try {
      const r = await q(`UPDATE bkk_newsletter SET status='confirmed',
          confirmed_at = CASE WHEN status = 'pending' THEN now() ELSE confirmed_at END
        WHERE token=$1 AND ${confirmable} RETURNING lang`, [req.params.token]);
      if (!r.rows.length) return res.status(400).send(letterDead());
      const lang = letterLang(r.rows[0].lang);
      res.set('Cache-Control', 'no-store').send(loginPage(LETTER_PAGE[lang].confirmed, '', lang));
    } catch (e) { res.status(500).send(loginPage('Something went wrong. Please try again.')); }
  });
  app.get('/api/bkk/newsletter/unsubscribe/:token', async (req, res) => {
    try {
      const row = (await q(`SELECT lang FROM bkk_newsletter WHERE token=$1`, [req.params.token])).rows[0];
      if (!row) return res.status(400).send(letterDead());
      const lang = letterLang(row.lang), p = LETTER_PAGE[lang];
      res.set('Cache-Control', 'no-store').send(loginPage(p.leave, letterBtn(p.leaveBtn, '#5c2160'), lang));
    } catch (e) { res.status(500).send(loginPage('Something went wrong. Please try again.')); }
  });
  // Also the RFC 8058 one-click target: mail apps POST here straight from the
  // List-Unsubscribe header, so this must work with any body and no script.
  app.post('/api/bkk/newsletter/unsubscribe/:token', async (req, res) => {
    try {
      const r = await q(`UPDATE bkk_newsletter SET status='unsubscribed', unsubscribed_at=now()
        WHERE token=$1 RETURNING lang`, [req.params.token]);
      if (!r.rows.length) return res.status(400).send(letterDead());
      const lang = letterLang(r.rows[0].lang);
      res.set('Cache-Control', 'no-store').send(loginPage(LETTER_PAGE[lang].left, '', lang));
    } catch (e) { res.status(500).send(loginPage('Something went wrong. Please try again.')); }
  });
  const deadLink = () => loginPage('That link has already been used, or it has expired.<br>'
    + '<a href="/book" style="color:#5c2160">Ask for a new one</a>');

  app.get('/api/bkk/login/:token', async (req, res) => {
    try {
      const ok = (await q(`SELECT 1 FROM bkk_login_tokens WHERE ${usable}`, [req.params.token])).rows.length;
      if (!ok) return res.status(400).send(deadLink());
      res.set('Cache-Control', 'no-store').send(loginPage('Opening your AYBKK profile…',
        `<form method="post" id="f"><button style="font:inherit;font-weight:700;padding:14px 22px;border:0;
border-radius:10px;background:#e8458c;color:#fff">Open my profile · เปิดโปรไฟล์</button></form>
<script>document.getElementById('f').submit()</script>`));
    } catch (e) {
      console.error('[bkk login] check failed:', e.message);
      res.status(500).send(loginPage('Something went wrong. Please try again.'));
    }
  });

  app.post('/api/bkk/login/:token', async (req, res) => {
    try {
      // One statement: a sign-out landing between "use the link" and "read the
      // code" would otherwise hand this browser the profile's brand-new code.
      const m = (await q(
        `UPDATE bkk_login_tokens SET used_at = COALESCE(used_at, now())
         FROM bkk_members mb WHERE mb.id = bkk_login_tokens.member_id AND ${usable}
         RETURNING mb.code`, [req.params.token])).rows[0];
      if (!m) return res.status(400).send(deadLink());
      res.set('Cache-Control', 'no-store').send(loginPage('Signing you in…',
        `<script>try{localStorage.setItem('aybkk_member',${JSON.stringify(m.code)})}catch(e){}
setTimeout(function(){location.replace('/book?me=1')},400)</script>`));
    } catch (e) {
      console.error('[bkk login] consume failed:', e.message);
      res.status(500).send(loginPage('Something went wrong. Please try again.'));
    }
  });

  // ── member view ───────────────────────────────────────────────────────────
  // Made on first use, then fixed for good, so every entry lands on one journal.
  async function journalId(m) {
    if (m.journal_id) return m.journal_id;
    await q(`UPDATE bkk_members SET journal_id=$2 WHERE id=$1 AND journal_id IS NULL`,
      [m.id, 'bkk-' + crypto.randomBytes(9).toString('base64url')]);
    return (await q('SELECT journal_id FROM bkk_members WHERE id=$1', [m.id])).rows[0].journal_id;
  }
  app.get('/api/bkk/me/:code', async (req, res) => {
    try {
      const m = (await q('SELECT * FROM bkk_members WHERE code = $1', [req.params.code])).rows[0];
      if (!m) return res.status(404).json({ error: 'not found' });
      const passes = (await q(
        `SELECT p.*, pr.name_en, pr.name_th FROM bkk_passes p JOIN bkk_products pr ON pr.id=p.product_id
         WHERE p.member_id=$1 ORDER BY p.id DESC`, [m.id])).rows;
      // classDate is the Bangkok day as text: class_date comes back as a JS
      // Date, which a browser in another timezone can shift a day.
      const bookings = (await q(
        `SELECT b.*, to_char(b.class_date,'YYYY-MM-DD') AS "classDate", s.title, s.start_time, s.is_online FROM bkk_bookings b
         JOIN bkk_class_slots s ON s.id=b.slot_id
         WHERE b.member_id=$1 AND b.status='booked' AND b.start_at >= now()
         ORDER BY b.start_at`, [m.id])).rows;
      // Only what a teacher chose to share. Notes kept for the team never
      // appear here — the student is not the audience for all of them.
      const notes = (await q(
        `SELECT n.to_work_on, n.body, n.class_date, n.created_at, t.name AS teacher
         FROM bkk_notes n LEFT JOIN bkk_teachers t ON t.id=n.teacher_id
         WHERE n.member_id=$1 AND n.share_with_student
           AND (n.to_work_on IS NOT NULL OR n.body IS NOT NULL)
         ORDER BY n.created_at DESC LIMIT 10`, [m.id])).rows;
      // The habit proof: every class they came to, the ones moved over from
      // Rezerv included.
      const [count, recent] = await Promise.all([
        q(`SELECT count(*)::int AS practised, count(DISTINCT b.class_date)::int AS days,
             count(DISTINCT b.class_date) FILTER (WHERE date_trunc('month', b.class_date) = date_trunc('month', $2::date))::int AS this_month
           FROM bkk_bookings b WHERE b.member_id=$1 AND ${ATTENDED}`, [m.id, bkkToday()]),
        q(`SELECT to_char(b.class_date,'YYYY-MM-DD') AS date, ${VISIT_TIME} AS time, coalesce(s.title, b.class_title) AS class
           FROM bkk_bookings b LEFT JOIN bkk_class_slots s ON s.id=b.slot_id
           WHERE b.member_id=$1 AND ${ATTENDED}
           ORDER BY b.start_at DESC, b.id DESC LIMIT 10`, [m.id]),
      ]);
      const c = count.rows[0];
      res.json({
        member: { code: m.code, name: m.name, email: m.email, journalId: await journalId(m) },
        history: { practised: c.practised, days: c.days, thisMonth: c.this_month, recent: recent.rows },
        notes,
        passes: passes.map(p => ({
          name: p.name_en, nameTh: p.name_th, kind: p.kind, status: p.status,
          creditsLeft: p.kind === 'unlimited' ? null : (p.credits_total - p.credits_used),
          validFrom: p.valid_from, validUntil: p.valid_until, dailyCap: p.daily_cap,
        })),
        bookings,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── booking ───────────────────────────────────────────────────────────────
  // Every way into a class goes through takeSeat: a student booking, staff
  // booking for someone, a walk-in added at the door, a paid drop-in. So every
  // one of them puts a name on the list and counts against the same capacity.

  const singleClass = pr => pr.kind === 'credits' && Number(pr.credits) === 1;
  const CLASS_ENDED = 'that class has already ended';
  // A visit moved from Rezerv that matched no slot is history as Rezerv kept it.
  const REZERV_READONLY = 'moved from Rezerv: it cannot be changed here';
  const seatsTaken = async (db, slotId, date) => (await db.query(
    `SELECT count(*)::int AS n FROM bkk_bookings
     WHERE slot_id=$1 AND class_date=$2 AND status='booked'`, [slotId, date])).rows[0].n;

  // Can this class take a name at all? The checks run in the order the student
  // booking always used, so its messages stay the same. The date must be the
  // slot's weekday: each weekday is its own slot with its own capacity and
  // overrides, so Tuesday's slot on a Friday would dodge Friday's full or
  // cancelled class.
  async function classCheck(db, slotId, date, { staff = false, endedMsg } = {}) {
    const slot = (await db.query('SELECT * FROM bkk_class_slots WHERE id=$1 AND active', [slotId])).rows[0];
    if (!slot) throw new Error('class not found');
    if (moonDaysBetween(date, date).size) throw new Error('moon day: the shala is closed');
    if (new Date(`${date}T12:00:00${TZ_OFFSET}`).getUTCDay() !== slot.weekday)
      throw new Error('that class is not on that day');
    const startAt = startAtISO(date, slot.start_time);
    // Students cannot book a class that has begun. Staff can, for the whole
    // length of the class — someone walks in at 05:35 and has to be put on the
    // list before they can be checked in.
    const startedAgoMin = (bkkNow() - new Date(startAt)) / 60000;
    const graceMin = staff ? (slot.duration_min || 120) : 0;
    if (startedAgoMin > graceMin) throw new Error(endedMsg || 'that class has already started');

    const ov = (await db.query(
      'SELECT * FROM bkk_class_overrides WHERE slot_id=$1 AND class_date=$2', [slotId, date])).rows[0];
    if (ov && ov.cancelled) throw new Error('class cancelled');
    const capacity = (ov && ov.capacity != null) ? ov.capacity : slot.capacity;
    return { slot, startAt, capacity };
  }

  // Runs inside the caller's transaction; throws to refuse.
  //   staff     may book a class that has begun, until it ends
  //   allowOver past capacity: the person is standing in the room, or has paid
  //   cover     'pass' (an aybkk.net pass, passId to use one in particular),
  //             'rezerv' (no pass here), or null: only an existing seat counts
  //   source    'student' | 'staff' | 'door' | 'order'
  //   requestId the door's id for this add: a seat already carrying it is the
  //             same add sent twice (out.repeat), even for a second new profile
  //   onList    treat a seat the member already holds as "on the list"
  // The door and paid orders (and staff adding from the calendar) treat a seat
  // the member already holds as "on the list" and just check it in (when
  // checkIn); a student is told they already booked it.
  async function takeSeat(db, { member, slotId, date, staff = false, allowOver = false,
    cover = 'pass', passId = null, checkIn = false, source = 'student', requestId = null,
    onList = source === 'door' || source === 'order' }) {
    const door = onList;
    const { slot, startAt, capacity } = await classCheck(db, slotId, date,
      { staff, endedMsg: door ? CLASS_ENDED : undefined });

    // Serialise everyone booking this same class: a transaction-scoped
    // advisory lock keyed on (slot, date). Counting rows cannot be locked
    // directly (Postgres forbids FOR UPDATE with aggregates), and without
    // this two students can each read "41 booked" and both take seat 42.
    await db.query('SELECT pg_advisory_xact_lock($1::int, $2::int)',
      [slotId, Number(String(date).replace(/-/g, ''))]);

    const out = { slot, startAt, capacity, taken: 0, overCapacity: false, already: false };
    if (door) {
      const on = (await db.query(
        `SELECT * FROM bkk_bookings WHERE slot_id=$1 AND class_date=$2 AND status='booked'
           AND (member_id=$3 OR request_id=$4) ORDER BY request_id IS NOT DISTINCT FROM $4 DESC LIMIT 1`,
        [slotId, date, member.id, requestId])).rows[0];
      if (on) {
        out.booking = checkIn ? (await db.query(
          `UPDATE bkk_bookings SET checked_in_at = COALESCE(checked_in_at, now()) WHERE id=$1 RETURNING *`,
          [on.id])).rows[0] : on;
        out.already = true;
        out.repeat = !!requestId && on.request_id === requestId;
        return out;
      }
      if (!cover) return null;
    }

    out.taken = await seatsTaken(db, slotId, date);
    if (out.taken >= capacity) {
      if (!allowOver) throw new Error('class is full');
      out.overCapacity = true;
    }

    let pass = null;
    if (cover === 'pass') {
      pass = (await db.query(
        `SELECT p.* FROM bkk_passes p
         WHERE p.member_id=$1 AND p.status='active'
           AND (p.valid_until IS NULL OR p.valid_until >= $2::date)
           AND (p.kind='unlimited' OR p.credits_used < p.credits_total)
           ${passId ? 'AND p.id=$3' : ''}
         ORDER BY p.valid_from NULLS LAST, p.id LIMIT 1 FOR UPDATE`,
        passId ? [member.id, date, passId] : [member.id, date])).rows[0];
      if (!pass) throw Object.assign(new Error('no active pass — please buy a package first'), { noPass: true });

      // daily cap (memberships: 2 bookings per day)
      if (pass.daily_cap) {
        const today = (await db.query(
          `SELECT count(*)::int AS n FROM bkk_bookings
           WHERE member_id=$1 AND class_date=$2 AND status='booked'`, [member.id, date])).rows[0].n;
        if (today >= pass.daily_cap)
          throw new Error(`limit is ${pass.daily_cap} classes per day`);
      }

      // First booking starts the validity window — but ONLY for a pass that has
      // no window yet. A pass imported from Rezerv carries an expiry the student
      // already paid for; testing valid_from alone would overwrite that expiry
      // with today + valid_days the moment they booked, silently and invisibly.
      if (!pass.valid_from && !pass.valid_until) {
        const vu = new Date(`${date}T00:00:00${TZ_OFFSET}`);
        vu.setDate(vu.getDate() + pass.valid_days);
        await db.query('UPDATE bkk_passes SET valid_from=$2, valid_until=$3 WHERE id=$1',
          [pass.id, date, ymd(vu)]);
      }
      if (pass.kind !== 'unlimited') {
        await db.query('UPDATE bkk_passes SET credits_used = credits_used + 1 WHERE id=$1', [pass.id]);
      }
    } else if (cover !== 'rezerv') throw new Error('unknown cover');

    out.booking = (await db.query(
      `INSERT INTO bkk_bookings (slot_id,class_date,start_at,member_id,pass_id,cover,source,request_id,checked_in_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,${checkIn ? 'now()' : 'NULL'}) RETURNING *`,
      [slotId, date, startAt, member.id, pass ? pass.id : null, cover, source, requestId])).rows[0];
    return out;
  }

  app.post('/api/bkk/bookings', async (req, res) => {
    const { memberCode: mcode, slotId, date } = req.body || {};
    if (!mcode || !slotId || !date) return res.status(400).json({ error: 'memberCode, slotId and date required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const m = (await client.query('SELECT * FROM bkk_members WHERE code=$1', [mcode])).rows[0];
      if (!m) throw new Error('member not found');
      const staff = isAdmin(req);
      const { booking: b } = await takeSeat(client, { member: m, slotId, date, staff,
        cover: 'pass', source: staff ? 'staff' : 'student' });
      await client.query('COMMIT');
      res.json({ success: true, booking: b });
    } catch (e) {
      await client.query('ROLLBACK');
      const msg = /duplicate key/.test(e.message) ? 'you already booked this class' : e.message;
      res.status(409).json({ error: msg });
    } finally { client.release(); }
  });

  app.post('/api/bkk/bookings/:id/cancel', async (req, res) => {
    const { memberCode: mcode } = req.body || {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const b = (await client.query(
        `SELECT b.*, m.code AS mcode FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id
         WHERE b.id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!b) throw new Error('booking not found');
      // The member code is REQUIRED. It used to be optional, which meant omitting
      // it skipped the ownership check entirely and let anyone cancel any booking
      // by guessing its id. Staff cancel through the admin, not through here.
      if (!isAdmin(req) && b.mcode !== String(mcode || '')) throw new Error('not your booking');
      if (b.slot_id == null) throw new Error(REZERV_READONLY);
      if (b.status !== 'booked') throw new Error('already ' + b.status);

      const hoursLeft = (new Date(b.start_at) - bkkNow()) / 3600000;
      const refund = hoursLeft >= CANCEL_CUTOFF_HOURS;
      await client.query(
        `UPDATE bkk_bookings SET status='cancelled', cancelled_at=now() WHERE id=$1`, [b.id]);
      if (refund && b.pass_id) {
        await client.query(
          `UPDATE bkk_passes SET credits_used = GREATEST(0, credits_used - 1)
           WHERE id=$1 AND kind <> 'unlimited'`, [b.pass_id]);
      }
      await client.query('COMMIT');
      res.json({
        success: true, creditReturned: refund, cutoffHours: CANCEL_CUTOFF_HOURS,
        message: refund ? 'Cancelled — your credit is back.'
          : `Cancelled. Less than ${CANCEL_CUTOFF_HOURS}h before class, so the credit is used.`,
      });
    } catch (e) {
      await client.query('ROLLBACK'); res.status(409).json({ error: e.message });
    } finally { client.release(); }
  });

  // ── check-in (door) ───────────────────────────────────────────────────────
  // "Is this member booked for a class starting around now?"
  // Staff-only: the door page already holds the admin key, and marking someone
  // present is a claim about the real world that a student must not make alone.
  app.post('/api/bkk/checkin', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ ok: false, reason: 'bad key' });
    try {
      const { memberCode: mcode, windowMin } = req.body || {};
      const win = Math.min(180, Math.max(15, parseInt(windowMin) || 90));
      const m = (await q('SELECT * FROM bkk_members WHERE code=$1', [mcode])).rows[0];
      if (!m) return res.status(404).json({ ok: false, reason: 'unknown member' });
      const b = (await q(
        `SELECT b.*, s.title FROM bkk_bookings b JOIN bkk_class_slots s ON s.id=b.slot_id
         WHERE b.member_id=$1 AND b.status='booked'
           AND b.start_at BETWEEN now() - ($2 || ' minutes')::interval
                              AND now() + ($2 || ' minutes')::interval
         ORDER BY abs(extract(epoch FROM (b.start_at - now()))) LIMIT 1`, [m.id, win])).rows[0];
      if (!b) return res.json({ ok: false, name: m.name, reason: 'no booking for this time' });
      await q(`UPDATE bkk_bookings SET checked_in_at = COALESCE(checked_in_at, now()) WHERE id=$1`, [b.id]);
      res.json({ ok: true, name: m.name, className: b.title, startAt: b.start_at });
    } catch (e) { res.status(500).json({ ok: false, reason: e.message }); }
  });

  // ── admin ─────────────────────────────────────────────────────────────────
  // Newest first by when the order was made, so thousands of Rezerv payments
  // (dated when they were paid) never push today's orders off the list.
  // ?from=&to= (Bangkok days, either end), ?source=rezerv|aybkk, ?limit= (≤2000).
  app.get('/api/bkk/admin/orders', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    try {
      const where = [], args = [];
      for (const [k, op] of [['from', '>='], ['to', '<=']]) {
        if (req.query[k] == null || req.query[k] === '') continue;
        if (!realYmd(req.query[k])) return res.status(400).json({ error: `${k} must be a date (YYYY-MM-DD)` });
        args.push(req.query[k]);
        where.push(`${PAY_DAY} ${op} $${args.length}::date`);
      }
      const src = String(req.query.source || '');
      if (src === 'aybkk') where.push('o.source IS NULL');
      else if (src) { args.push(src); where.push(`o.source = $${args.length}`); }
      const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit) || 200));
      // name_en falls back to what Rezerv called it, so a payment for a package
      // that is not in the catalogue still says what was bought.
      const r = await q(
        `SELECT o.*, coalesce(pr.name_en, o.item_name) AS name_en, pr.name_th,
           coalesce(pr.name_en, o.item_name) AS item, m.name AS member_name, m.email, m.code AS member_code
         FROM bkk_orders o LEFT JOIN bkk_products pr ON pr.id=o.product_id
         LEFT JOIN bkk_members m ON m.id=o.member_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY o.created_at DESC, o.id DESC LIMIT ${limit}`, args);
      res.json({ orders: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Money taken at the desk. A real order, so it shows in Payments, the day's
  // cash count and the books, with VAT and a receipt — unlike "Give a pass".
  // No online fee: nothing went through the gateway.
  const DESK_METHODS = ['cash', 'transfer', 'card'];
  // With a class (slotId, date), the sale also books it: staff timing (until the
  // class ends) and over capacity allowed, since the person is at the desk.
  async function deskSale({ member, pr, method, slotId, date, checkIn, source, requestId }) {
    const { vat, total } = breakdown(pr.price_thb, 0);
    let o = null;
    for (let attempt = 0; attempt < 5 && !o; attempt++) {
      try {
        o = (await q(
          `INSERT INTO bkk_orders (refno,product_id,member_id,base_thb,fee_thb,vat_thb,amount_thb,method,slot_id,class_date)
           VALUES ($1,$2,$3,$4,0,$5,$6,$7,$8,$9) RETURNING *`,
          [newRefno(), pr.id, member.id, pr.price_thb, vat, total, method, slotId || null, slotId ? date : null])).rows[0];
      } catch (e) {
        if (!/duplicate key/.test(e.message) || attempt === 4) throw e;
      }
    }
    const act = await activateOrder(o, { note: `${method} at the desk` }, { checkIn, source, requestId });
    return { o, vat, total, act };
  }

  app.post('/api/bkk/admin/sales', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    try {
      const { productCode, name, email, phone, method, slotId, checkIn } = req.body || {};
      if (!DESK_METHODS.includes(method)) return res.status(400).json({ error: 'method must be cash, transfer or card' });
      if (!(name || '').trim()) return res.status(400).json({ error: 'name is required' });
      const pr = (await q('SELECT * FROM bkk_products WHERE code = $1 AND active', [productCode])).rows[0];
      if (!pr) return res.status(404).json({ error: 'product not found' });
      const date = req.body.date || bkkToday();
      if (slotId) {
        if (!Number.isInteger(Number(slotId)) || !isYmd(date)) return res.status(400).json({ error: 'slotId and date (YYYY-MM-DD) needed for a class' });
        try {
          await classCheck(pool, slotId, date, { staff: true, endedMsg: CLASS_ENDED });
        } catch (e) { return res.status(409).json({ error: e.message }); }
      }
      const member = await findOrCreateMember({ name, email, phone });
      const { o, vat, total, act } = await deskSale({ member, pr, method,
        slotId: slotId ? Number(slotId) : null, date, checkIn: !!checkIn });
      res.json({ success: true, member: { code: member.code, name: member.name },
        order: { refno: String(o.refno), amount: total, vat, method },
        booking: act && act.booking || undefined, bookingError: act && act.bookingError || undefined });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // The door: whoever is here goes on the class list, checked in. A student with
  // an aybkk.net pass uses it; most students still hold a Rezerv package that is
  // not in this system yet, so 'rezerv' seats them with no pass; anyone else
  // buys a drop-in on the spot (a real desk sale: today's money, VAT, receipt).
  // Over capacity is allowed and reported: the person is already in the room.
  // The calendar adds the same way, with checkIn: false for a class that has
  // not started: the seat is taken, nobody is checked in, source 'staff'.
  const WALKIN_COVERS = ['pass', 'rezerv', 'dropin'];
  // What a door add with this requestId already did, answered again as it was
  // the first time: staff tap a second time when the first reply is lost.
  async function walkinDone(rid) {
    const r = (await q(
      `SELECT m.name, m.code, s.title, b.start_at, b.cover, o.refno
       FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id JOIN bkk_class_slots s ON s.id=b.slot_id
       LEFT JOIN bkk_passes p ON p.id=b.pass_id
       LEFT JOIN bkk_orders o ON o.id=p.order_id AND o.slot_id=b.slot_id AND o.class_date=b.class_date
       WHERE b.request_id=$1`, [rid])).rows[0];
    return r && { success: true, repeat: true, name: r.name, code: r.code, className: r.title, startAt: r.start_at,
      overCapacity: false, already: false, cover: r.refno ? 'dropin' : r.cover, ...(r.refno ? { refno: String(r.refno) } : {}) };
  }

  app.post('/api/bkk/admin/walkin', async (req, res) => {
    if (adminOnly(req, res)) return;
    const b = req.body || {};
    const date = b.date || bkkToday();
    const cover = b.cover;
    if (!WALKIN_COVERS.includes(cover)) return res.status(400).json({ error: 'cover must be pass, rezerv or dropin' });
    if (!b.slotId || !Number.isInteger(Number(b.slotId)) || !isYmd(date))
      return res.status(400).json({ error: 'slotId and date (YYYY-MM-DD) required' });
    if (cover === 'dropin' && !DESK_METHODS.includes(b.method))
      return res.status(400).json({ error: 'method must be cash, transfer or card' });
    if (b.checkIn !== undefined && typeof b.checkIn !== 'boolean')
      return res.status(400).json({ error: 'checkIn must be true or false' });
    const slotId = Number(b.slotId);
    const rid = b.requestId ? String(b.requestId).slice(0, 64) : null;
    const checkIn = b.checkIn !== false;
    const source = checkIn ? 'door' : 'staff';
    // Nobody is in the room for a class on a later day: the rule of the
    // check-in from inside a class. The door only ever sends today.
    if (checkIn && date > bkkToday()) return res.status(409).json({ error: 'that class is not today yet' });
    try {
      const first = rid && await walkinDone(rid);
      if (first) return res.json(first);
    } catch (e) { return res.status(500).json({ error: e.message }); }
    // Checked again under the lock below; this only spares a new person's
    // profile when the class cannot take them anyway.
    try { await classCheck(pool, slotId, date, { staff: true, endedMsg: CLASS_ENDED }); }
    catch (e) { return res.status(409).json({ error: e.message }); }
    let member;
    try {
      if (b.memberCode) {
        member = (await q('SELECT * FROM bkk_members WHERE code=$1', [b.memberCode])).rows[0];
        if (!member) return res.status(404).json({ error: 'member not found' });
      } else {
        if (!String(b.name || '').trim()) return res.status(400).json({ error: 'name is required for a new person' });
        member = await findOrCreateMember({ name: b.name, email: b.email, phone: b.phone });
      }
    } catch (e) { return res.status(500).json({ error: e.message }); }

    const reply = (seat, extra = {}) => res.json({ success: true, name: member.name, code: member.code,
      className: seat.title, startAt: seat.startAt, overCapacity: !!seat.overCapacity, already: !!seat.already, ...extra });
    // A seat takeSeat found rather than made: the same add sent twice, or
    // someone already on the list (checked in unless checkIn is false, nothing sold).
    const listed = s => s.repeat ? walkinDone(rid).then(r => res.json(r))
      : reply({ title: s.slot.title, startAt: s.startAt, overCapacity: s.overCapacity, already: s.already },
        { cover: s.already ? (s.booking.cover || (s.booking.pass_id ? 'pass' : 'rezerv')) : cover });
    // A drop-in is only sold to someone not on the list yet: takeSeat with no
    // cover checks the class and checks in a seat they already hold.
    const client = await pool.connect();
    let seat;
    try {
      await client.query('BEGIN');
      seat = await takeSeat(client, { member, slotId, date, staff: true, allowOver: true,
        cover: cover === 'dropin' ? null : cover, checkIn, source, requestId: rid, onList: true });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (e.noPass) return res.status(409).json({ error:
        `${member.name} has no aybkk.net pass for that day. Choose Rezerv package or Drop-in.` });
      return res.status(409).json({ error: /duplicate key/.test(e.message) ? 'already on the list' : e.message });
    } finally { client.release(); }

    try {
      if (seat) return await listed(seat);
      const pr = (await q(`SELECT * FROM bkk_products WHERE code='dropin' AND active`)).rows[0];
      if (!pr) return res.status(404).json({ error: 'the drop-in is not on sale' });
      const { o, act } = await deskSale({ member, pr, method: b.method, slotId, date, checkIn,
        source, requestId: rid });
      if (act && act.unsold) return await listed(act.seat);
      // Paid, but the seat went in the moment between: the money and the pass
      // stand, and the shala has the Telegram ping to put them on by hand.
      if (!act || !act.booking) return res.status(409).json({ paid: true, refno: String(o.refno),
        error: `Paid (ref ${o.refno}), but could not add to the class: ${act ? act.bookingError : 'already paid'}. Book them by hand.` });
      reply(act.booking, { cover: 'dropin', refno: String(o.refno) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Deliberate manual override for the day the gateway misbehaves — recorded
  // as such so the books show it was not a verified payment.
  app.post('/api/bkk/admin/orders/:id/force-activate', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    try {
      const o = (await q('SELECT * FROM bkk_orders WHERE id=$1', [req.params.id])).rows[0];
      if (!o) return res.status(404).json({ error: 'not found' });
      if (o.status === 'paid') return res.json({ success: true, already: true });
      if (o.source === 'rezerv') return res.status(409).json({ error: 'a payment moved from Rezerv is history: it cannot be activated' });
      const act = await activateOrder(o, { note: 'MANUAL ACTIVATION by admin' });
      res.json({ success: true, booking: act && act.booking || undefined, bookingError: act && act.bookingError || undefined });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/bkk/start-event', async (req, res) => {
    const b = req.body || {};
    const kind = b.kind === 'tap' ? 'tap' : 'view';
    const clean = (v, n) => String(v || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, n) || null;
    try {
      await q(`INSERT INTO bkk_start_events (kind,src,lang,ch) VALUES ($1,$2,$3,$4)`,
        [kind, clean(b.src, 40), clean(b.lang, 5), clean(b.ch, 10)]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Who gets the Monday letter by email. csv=1 gives the send list: confirmed
  // addresses only, each with its own unsubscribe link for the letter footer.
  app.get('/api/bkk/admin/newsletter', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const counts = (await q(`SELECT status, coalesce(lang,'en') AS lang, count(*)::int AS n
        FROM bkk_newsletter GROUP BY 1,2 ORDER BY 1,2`)).rows;
      if (req.query.csv) {
        const rows = (await q(`SELECT email, coalesce(lang,'en') AS lang, confirmed_at, token
          FROM bkk_newsletter WHERE status='confirmed' ORDER BY confirmed_at`)).rows;
        // A spreadsheet runs a cell that starts with = + - @ as a formula, and the
        // local part of an address is the signer's to choose.
        const cell = v => `"${String(v ?? '').replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`;
        const lines = [['email', 'lang', 'confirmed_at', 'unsubscribe_url'].join(',')].concat(rows.map(r =>
          [r.email, r.lang, r.confirmed_at && r.confirmed_at.toISOString(),
           `${baseUrl()}/api/bkk/newsletter/unsubscribe/${r.token}`].map(cell).join(',')));
        res.set('Content-Type', 'text/csv; charset=utf-8')
          .set('Content-Disposition', 'attachment; filename="aybkk-letter-emails.csv"')
          .set('Cache-Control', 'no-store');
        return res.send('\ufeff' + lines.join('\n'));
      }
      // Which door the letter box's visitors take (LINE, WeChat, Telegram, email).
      const doors = (await q(`SELECT coalesce(ch,'-') AS ch, count(*)::int AS n FROM bkk_start_events
        WHERE src='letter' AND kind='tap' AND created_at > now() - interval '30 days' GROUP BY 1 ORDER BY n DESC`)).rows;
      res.json({ success: true, counts, doors });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/bkk/admin/start-stats', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const { rows } = await q(
        `SELECT coalesce(src, '-') AS src, count(*) FILTER (WHERE kind = 'view')::int AS views,
           count(*) FILTER (WHERE kind = 'tap')::int AS taps
         FROM bkk_start_events WHERE created_at > now() - interval '30 days' AND src IS DISTINCT FROM 'letter'
         GROUP BY 1 ORDER BY taps DESC, views DESC LIMIT 30`);
      res.json({ success: true, sources: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // One look at whether the profile work is being done (Boonchu, 3 Oct): who is
  // in the system, who got a link and opened it, photos and notes today.
  app.get('/api/bkk/admin/progress', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const today = `(now() AT TIME ZONE 'Asia/Bangkok')::date`;
      const one = async (sql) => (await q(sql)).rows[0];
      const [members, links, photos, notes] = await Promise.all([
        one(`SELECT count(*)::int AS total,
               count(*) FILTER (WHERE email IS NOT NULL)::int AS with_email,
               count(*) FILTER (WHERE EXISTS (SELECT 1 FROM bkk_passes p WHERE p.member_id = m.id AND p.status = 'active'
                 AND (p.valid_until IS NULL OR p.valid_until >= ${today})))::int AS active
             FROM bkk_members m`),
        one(`SELECT count(DISTINCT member_id) FILTER (WHERE ip = 'staff')::int AS sent,
               count(DISTINCT member_id) FILTER (WHERE used_at IS NOT NULL)::int AS opened,
               count(*) FILTER (WHERE ip = 'staff' AND (created_at AT TIME ZONE 'Asia/Bangkok')::date = ${today})::int AS sent_today
             FROM bkk_login_tokens`),
        one(`SELECT count(*) FILTER (WHERE p.class_date = ${today})::int AS today,
               count(*) FILTER (WHERE p.class_date = ${today}
                 AND NOT EXISTS (SELECT 1 FROM bkk_photo_members pm WHERE pm.photo_id = p.id))::int AS untagged_today,
               (SELECT count(DISTINCT pm.member_id) FROM bkk_photo_members pm JOIN bkk_photos x ON x.id = pm.photo_id
                 WHERE x.class_date = ${today})::int AS students_today,
               count(*)::int AS total,
               (SELECT count(DISTINCT member_id) FROM bkk_photo_members)::int AS students_total
             FROM bkk_photos p`),
        one(`SELECT count(*) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Bangkok')::date = ${today})::int AS today,
               count(*)::int AS total FROM bkk_notes`),
      ]);
      const byTeacher = (await q(
        `SELECT t.name, count(*)::int AS n FROM bkk_notes n JOIN bkk_teachers t ON t.id = n.teacher_id
         WHERE (n.created_at AT TIME ZONE 'Asia/Bangkok')::date = ${today} GROUP BY t.name ORDER BY n DESC`)).rows;
      const uploaders = (await q(
        `SELECT t.name, count(*)::int AS n FROM bkk_photos p JOIN bkk_teachers t ON t.id = p.uploaded_by
         WHERE p.class_date = ${today} GROUP BY t.name ORDER BY n DESC`)).rows;
      res.json({ members, links, photos, notes: { ...notes, byTeacher }, uploaders });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/bkk/admin/today', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    try {
      const today = bkkToday();
      // pass_name / dropin let the door label a row: a drop-in, or a Rezerv seat.
      const r = await q(
        `SELECT s.title, b.class_date, b.start_at, m.name, m.code, b.checked_in_at,
           b.slot_id, b.cover, b.source, pr.name_en AS pass_name,
           coalesce(pr.kind = 'credits' AND pr.credits = 1, false) AS dropin
         FROM bkk_bookings b JOIN bkk_class_slots s ON s.id=b.slot_id
         JOIN bkk_members m ON m.id=b.member_id
         LEFT JOIN bkk_passes p ON p.id=b.pass_id LEFT JOIN bkk_products pr ON pr.id=p.product_id
         WHERE b.status='booked' AND b.class_date = $1::date
         ORDER BY b.start_at, m.name`, [today]);
      const money = (await q(
        `SELECT method, count(*)::int AS n, sum(amount_thb)::int AS total FROM bkk_orders
         WHERE status='paid' AND (verified_at AT TIME ZONE 'Asia/Bangkok')::date = (now() AT TIME ZONE 'Asia/Bangkok')::date
         GROUP BY method ORDER BY method`)).rows;
      // Today's whole timetable, booked or not: the door built its tabs from
      // bookings, so a class nobody had booked could not take a walk-in.
      let classes = [];
      if (!moonDaysBetween(today, today).size) {
        const wd = new Date(`${today}T12:00:00${TZ_OFFSET}`).getUTCDay();
        const [slots, ovs] = await Promise.all([
          q('SELECT * FROM bkk_class_slots WHERE active AND weekday=$1 ORDER BY start_time, id', [wd]),
          q('SELECT * FROM bkk_class_overrides WHERE class_date=$1::date', [today]),
        ]);
        classes = slots.rows.map(s => {
          const ov = ovs.rows.find(o => o.slot_id === s.id);
          if (ov && ov.cancelled) return null;
          const list = r.rows.filter(b => b.slot_id === s.id);
          return { slotId: s.id, date: today, title: s.title, startAt: startAtISO(today, s.start_time),
            durationMin: s.duration_min, isOnline: s.is_online, capacity: (ov && ov.capacity != null) ? ov.capacity : s.capacity,
            booked: list.length, checkedIn: list.filter(b => b.checked_in_at).length };
        }).filter(Boolean);
      }
      res.json({ bookings: r.rows, money, classes });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Links Boonchu can change himself. An allowlist, not a free-for-all: this
  // writes a table the public read below serves, so an arbitrary key here would
  // be an arbitrary value on the student page.
  const LINK_KEYS = ['instagram', 'youtube', 'tiktok', 'line', 'wechat', 'facebook', 'shop', 'telegram'];

  app.get('/api/bkk/settings', async (req, res) => {
    try {
      const r = await q(`SELECT key, value FROM bkk_settings WHERE key = ANY($1::text[])`,
        [LINK_KEYS.map(k => 'link_' + k)]);
      const links = {};
      for (const row of r.rows) {
        const v = typeof row.value === 'string' ? row.value : (row.value ?? '');
        if (v) links[row.key.replace(/^link_/, '')] = v;
      }
      res.json({ links });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/bkk/admin/settings', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    try {
      if (req.body.surchargePct !== undefined) {
        await q(`INSERT INTO bkk_settings (key,value) VALUES ('surcharge_pct',$1)
                 ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now()`,
          [JSON.stringify(Number(req.body.surchargePct))]);
      }
      const links = req.body.links || {};
      for (const k of LINK_KEYS) {
        if (links[k] === undefined) continue;
        const url = String(links[k] || '').trim();
        // Empty clears the link. Anything else must be a real http(s) URL —
        // a typo here becomes a broken button on every student's page.
        if (url && !/^https?:\/\/[^\s]+$/i.test(url)) {
          return res.status(400).json({ error: `${k} must be a full https:// link, or empty to remove` });
        }
        await q(`INSERT INTO bkk_settings (key,value) VALUES ($1,$2)
                 ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now()`,
          ['link_' + k, JSON.stringify(url)]);
      }
      res.json({ success: true, surchargePct: await surcharge() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── running the shala ─────────────────────────────────────────────────────
  // Everything below exists because Rezerv can do it and this could not, which
  // meant the only way to close a class, pause a pass for an injury, or find a
  // student who lost their code was hand-written SQL against production.

  const adminOnly = (req, res) => {
    if (isAdmin(req)) return false;
    res.status(401).json({ error: 'bad key' });
    return true;
  };

  // ── tees (baht, PaySolutions link per tee) ───────────────────────────────
  const teeOut = t => ({ id: t.id, name: t.name, priceThb: t.price_thb, payLink: t.pay_link,
    photo: t.photo, sizes: t.sizes, active: t.active, sort: t.sort });
  app.get('/api/bkk/tees', async (req, res) => {
    try {
      const r = await q('SELECT * FROM bkk_tees WHERE active ORDER BY sort, id');
      res.json({ tees: r.rows.map(teeOut) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/bkk/admin/tees', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const r = await q('SELECT * FROM bkk_tees ORDER BY sort, id');
      res.json({ tees: r.rows.map(teeOut) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // With an id it changes that tee; without, it adds one.
  app.post('/api/bkk/admin/tees', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const b = req.body || {};
      const name = String(b.name || '').trim().slice(0, 120);
      const price = Number(b.priceThb);
      const link = String(b.payLink || '').trim();
      const photo = String(b.photo || '').trim();
      if (!name) return res.status(400).json({ error: 'name required' });
      if (!(Number.isInteger(price) && price > 0)) return res.status(400).json({ error: 'price must be a whole number of baht' });
      if (!/^https:\/\/\S+$/.test(link)) return res.status(400).json({ error: 'payment link must start with https://' });
      if (photo && !/^(https:\/\/|\/)\S+$/.test(photo)) return res.status(400).json({ error: 'photo must be a link (https://…) or a site path (/img/…)' });
      const vals = [name, price, link, photo || null, String(b.sizes || '').trim().slice(0, 120) || null,
        b.active !== false, Number.isInteger(Number(b.sort)) ? Number(b.sort) : 0];
      const r = b.id
        ? await q(`UPDATE bkk_tees SET name=$1, price_thb=$2, pay_link=$3, photo=$4, sizes=$5, active=$6, sort=$7
                   WHERE id=$8 RETURNING *`, [...vals, Number(b.id)])
        : await q(`INSERT INTO bkk_tees (name, price_thb, pay_link, photo, sizes, active, sort)
                   VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, vals);
      if (!r.rows.length) return res.status(404).json({ error: 'tee not found' });
      res.json({ success: true, tee: teeOut(r.rows[0]) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Find a student. There was no way to do this at all, so "I lost my code" had
  // no answer from either side.
  app.get('/api/bkk/admin/members', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const term = String(req.query.q || '').trim();
      if (term.length < 2) return res.json({ members: [] });
      const like = `%${term.toLowerCase()}%`;
      const r = await q(
        `SELECT m.*,
           (SELECT count(*)::int FROM bkk_bookings b
             WHERE b.member_id = m.id AND b.status='booked' AND b.start_at >= now()) AS booked,
           EXISTS (SELECT 1 FROM bkk_passes p WHERE p.member_id = m.id AND p.status='active'
             AND (p.valid_until IS NULL OR p.valid_until >= (now() AT TIME ZONE 'Asia/Bangkok')::date)
             AND (p.kind='unlimited' OR p.credits_used < p.credits_total)) AS has_pass
         FROM bkk_members m
         WHERE lower(m.name) LIKE $1 OR lower(m.email) LIKE $1
            OR lower(m.code) LIKE $1 OR coalesce(m.phone,'') LIKE $1 OR lower(coalesce(m.rezerv_id,'')) LIKE $1
         ORDER BY m.name LIMIT 25`, [like]);
      const ids = r.rows.map(m => m.id);
      const passes = ids.length ? (await q(
        `SELECT p.*, pr.name_en, pr.name_th FROM bkk_passes p JOIN bkk_products pr ON pr.id=p.product_id
         WHERE p.member_id = ANY($1::int[]) ORDER BY p.id DESC`, [ids])).rows : [];
      res.json({
        members: r.rows.map(m => ({
          ...m, passes: passes.filter(p => p.member_id === m.id),
        })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Grant a pass with no order behind it: migrating a student who already paid
  // Rezerv, or a comp. Deliberately NOT activateOrder(), which would fabricate a
  // paid order, ping Telegram about money that never arrived, and email the
  // student a receipt for a payment they did not make.
  app.post('/api/bkk/admin/passes', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const { memberCode, name, email, phone, productCode,
              validFrom, validUntil, creditsTotal, creditsUsed, note, source } = req.body || {};
      const pr = (await q('SELECT * FROM bkk_products WHERE code=$1', [productCode])).rows[0];
      if (!pr) return res.status(404).json({ error: 'product not found' });

      let m = memberCode
        ? (await q('SELECT * FROM bkk_members WHERE code=$1', [memberCode])).rows[0]
        : await findOrCreateMember({ name, email, phone });
      if (!m) return res.status(404).json({ error: 'member not found' });

      // An imported pass MUST carry both ends of its window. With only one end
      // set, the first booking would rewrite the expiry the student paid for.
      const vFrom = validFrom || null;
      const vUntil = validUntil || null;
      if ((vFrom && !vUntil) || (!vFrom && vUntil)) {
        return res.status(400).json({
          error: 'give both validFrom and validUntil, or neither (neither = starts on first booking)' });
      }

      const p = (await q(
        `INSERT INTO bkk_passes
           (member_id,product_id,order_id,kind,credits_total,credits_used,daily_cap,
            valid_days,valid_from,valid_until,note,source)
         VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [m.id, pr.id, pr.kind,
         creditsTotal != null ? creditsTotal : pr.credits,
         creditsUsed != null ? creditsUsed : 0,
         pr.daily_cap, pr.valid_days, vFrom, vUntil,
         note || null, source || 'manual'])).rows[0];
      console.log(`✓ bkk: pass granted by hand to ${m.code} (${pr.name_en}, source=${source || 'manual'})`);
      res.json({ success: true, member: { code: m.code, name: m.name }, pass: p });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Move students over from Rezerv in one paste (Oct 2026). Safe to run again:
  // a student is matched by email, else by exact name, and a pass with the same
  // package and end date is never added twice. A second run with emails fills
  // them in, which is what lets the student sign in and see their profile.
  const IMPORT_PLANS = [[/^1\s*month/i, 'unlim1'], [/^2\s*months?/i, 'unlim2'], [/^3\s*months?/i, 'unlim3'],
    [/^6\s*months?/i, 'unlim6'], [/^12\s*months?/i, 'unlim12'], [/^10[\s-]*class/i, 'pack10']];
  const RETIRED_PLANS = {
    unlim2: { en: '2 months unlimited', th: '2 เดือน ไม่จำกัด', price: 18200, days: 60, sort: 40 },
    unlim6: { en: '6 months unlimited', th: '6 เดือน ไม่จำกัด', price: 45000, days: 180, sort: 60 },
    unlim12: { en: '12 months unlimited (1 free month)', th: '12 เดือน ไม่จำกัด (ฟรี 1 เดือน)', price: 78000, days: 395, sort: 70 },
  };
  // Rezerv years stay on the 13-month package: valid_from is worked back from
  // the end date, and 365 days on a pass that really runs 395 would start it a
  // month late and block the student's bookings. Too early is harmless.
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function importDate(v) {
    const s = String(v || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
    if (!m || !MONTHS[m[2].toLowerCase()]) return null;
    return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  // 2- and 6-month plans are no longer sold, but Rezerv students still hold
  // them: keep the package as a retired (never for sale) record.
  async function planProduct(db, code) {
    const pr = (await db.query('SELECT * FROM bkk_products WHERE code=$1', [code])).rows[0];
    if (pr || !RETIRED_PLANS[code]) return pr || null;
    const r = RETIRED_PLANS[code];
    return (await db.query(`INSERT INTO bkk_products (code,name_en,name_th,price_thb,kind,credits,valid_days,daily_cap,sort,active)
                   VALUES ($1,$2,$3,$4,'unlimited',NULL,$5,2,$6,false)
                   ON CONFLICT (code) DO UPDATE SET code=EXCLUDED.code RETURNING *`,
      [code, r.en, r.th, r.price, r.days, r.sort])).rows[0];
  }
  app.post('/api/bkk/admin/import', async (req, res) => {
    if (adminOnly(req, res)) return;
    const rows = Array.isArray((req.body || {}).rows) ? req.body.rows.slice(0, 500) : [];
    const out = { members: 0, newMembers: 0, emailsAdded: 0, passes: 0, skipped: [] };
    try {
      for (const row of rows) {
        const name = String(row.name || '').replace(/\s*\((renewed|staff)\)\s*/gi, ' ').trim();
        const email = String(row.email || '').trim().toLowerCase();
        const phone = String(row.phone || '').trim();
        if (!name) continue;
        const plan = IMPORT_PLANS.find(([re]) => re.test(String(row.plan || '').trim()));
        const until = importDate(row.until);
        if (!plan || !until) { out.skipped.push(`${name}: plan or end date not understood`); continue; }
        const pr = await planProduct(pool, plan[1]);
        if (!pr) { out.skipped.push(`${name}: package ${plan[1]} missing`); continue; }

        let m = email && email.includes('@')
          ? (await q('SELECT * FROM bkk_members WHERE lower(email)=$1 LIMIT 1', [email])).rows[0] : null;
        if (!m) m = (await q('SELECT * FROM bkk_members WHERE lower(name)=lower($1) ORDER BY id LIMIT 1', [name])).rows[0];
        if (!m) {
          m = (await q(`INSERT INTO bkk_members (code,name,email,phone) VALUES ($1,$2,$3,$4) RETURNING *`,
            [memberCode(), name, email.includes('@') ? email : null, phone || null])).rows[0];
          out.newMembers++;
        } else if (email.includes('@') && !m.email) {
          await q('UPDATE bkk_members SET email=$2 WHERE id=$1', [m.id, email]);
          out.emailsAdded++;
        }
        if (phone && !m.phone) await q('UPDATE bkk_members SET phone=$2 WHERE id=$1', [m.id, phone]);
        out.members++;

        const dup = await q(`SELECT 1 FROM bkk_passes WHERE member_id=$1 AND product_id=$2 AND valid_until=$3`,
          [m.id, pr.id, until]);
        if (dup.rows.length) continue;
        const from = new Date(Date.parse(until + 'T00:00:00Z') - (pr.valid_days - 1) * 86400e3).toISOString().slice(0, 10);
        const left = row.classesLeft != null && row.classesLeft !== '' ? Number(row.classesLeft) : null;
        const total = pr.kind === 'credits' ? (pr.credits || 10) : null;
        await q(`INSERT INTO bkk_passes
            (member_id,product_id,order_id,kind,credits_total,credits_used,daily_cap,
             valid_days,valid_from,valid_until,note,source)
          VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,'rezerv')`,
          [m.id, pr.id, pr.kind, total,
           total != null && left != null && !isNaN(left) ? Math.max(0, total - left) : 0,
           pr.daily_cap, pr.valid_days, from, until, 'moved from Rezerv']);
        out.passes++;
      }
      console.log(`✓ bkk: Rezerv import ${JSON.stringify({ ...out, skipped: out.skipped.length })}`);
      res.json({ success: true, ...out });
    } catch (e) { res.status(500).json({ error: e.message, ...out }); }
  });

  // ── keep all history: everything from Rezerv (Oct 2026) ───────────────────
  // Rezerv's export columns were not known when this was written, so the admin
  // page maps the file's columns to the field names below and this reads only
  // those: a birthday, address, ID or card number in the file is never read.
  // One transaction per call, and a dry run is that same run rolled back, so it
  // reports exactly what the import would do. Imports never go through
  // activateOrder (no pass, no Telegram, no receipt) and never touch credits.
  const IMPORT_MAX_ROWS = 1000;
  const clean = (v, n) => noCards(String(v ?? '').replace(/\s+/g, ' ').trim()).slice(0, n);
  // Ids and phones are not free text: the card scrub would turn every tenth
  // long id into the same "[card number removed]" and merge people.
  const cleanId = (v, n = 100) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  // Excel drops leading zeros (00123 → 123), so an all-digit id is kept without them.
  const importId = v => { const s = cleanId(v); return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : s; };
  // …and writes long ones as 1.23E+15, which no longer says which id it was.
  const excelId = v => /^\d+(\.\d+)?e\+?\d+$/i.test(cleanId(v));

  // Every skip reason and note carries a code and its values, so the admin
  // page can say it in Thai. The English text is for anything else.
  const THEN = { hand: 'check by hand', made: 'made a new student', madeNoEmail: 'made a new student without the email' };
  const IMPORT_EN = {
    noName: () => 'no name',
    sharePhone: (n, p) => `${n} students share the phone ${p}: add email`,
    sameName: (n, name) => `${n} students named ${name}: add email or phone`,
    noWho: () => 'no student on this row: map a customer id, email, phone or name',
    notFound: () => 'student not found: add their name to make a new one',
    clashEmail: (e, name, code, rz, then) => `${e} is on ${name}'s profile (${code}, Rezerv id ${rz}): ${THEN[then]}`,
    clashPhone: (p, name, code, fileName, then) => `phone ${p} is on ${name}'s profile (${code}), the file says ${fileName}: ${THEN[then]}`,
    clashOtherEmail: (name, code, e, then) => `a student named ${name} (${code}) has another email (${e}): ${THEN[then]}`,
    excelId: v => `id "${v}": Excel changed this id: export again without opening in Excel`,
    badDate: v => `date "${v}" not understood`,
    badTime: v => `time "${v}" not understood`,
    badStatus: v => `status "${v}" not understood`,
    waitlist: () => 'a waiting-list place, not a visit',
    noSlot: (time, date) => `no class on our timetable at ${time || 'that time'} on ${classWhen(date, '').slice(0, -2)}: book it by hand`,
    moonDay: d => `${d} is a moon day: the shala is closed`,
    classOff: (title, d) => `${title} on ${d} is cancelled`,
    idReused: (id, what) => `Rezerv id ${id} is already used for a different ${what}: map a per-line id, or none`,
    badAmount: v => `amount "${v}" not understood`,
    payStatus: v => `payment status "${v}" not understood`,
    notMoney: v => `payment status "${v}": no money came in, so it is not kept`,
    badPlan: v => `package "${v}" not understood`,
    badUntil: v => `end date "${v}" not understood`,
    badStart: v => `start date "${v}" not understood`,
    startsAfterEnd: () => 'it starts after it ends',
    noPackage: c => `package ${c} missing`,
    badLeft: v => `classes left "${v}" not understood`,
    duplicate: () => 'already there (a duplicate)',
    notEmail: v => `"${v}" is not an email address: left out`,
    badJoined: v => `joined date "${v}" not understood: left out`,
    badCheckIn: v => `check-in time "${v}" not understood: left out`,
    overCap: (n, cap, title, d) => `over capacity: ${n} for ${cap} places in ${title} on ${d}`,
    badVat: v => `VAT "${v}" not understood: 0 kept`,
    emailTaken: (e, name, code, to) => `${e} is on ${name}'s profile (${code}): not added to ${to}`,
    keepsEmail: (name, e, fe) => `${name} keeps the email ${e}; the file says ${fe}`,
    keepsRezervId: (name, id, fid) => `${name} keeps the Rezerv id ${id}; the file says ${fid}`,
    leftOver: (left, total) => `${left} classes left is more than the ${total} in the package: ${total} kept`,
    keptHere: (here, file) => `Rezerv says ${file}, but it is ${here} here: kept as it is here`,
    cameDoor: file => `checked in at our door; Rezerv says ${file}: not added`,
    newStudent: name => `new student: ${name}`,
    pastBooked: n => `${n} past visits say booked, not attended: kept as booked, so they do not count as classes practised. `
      + 'If Rezerv never marked attendance, import again with past bookings counted as attended.',
  };
  const why = (code, ...vals) => ({ code, vals, text: IMPORT_EN[code](...vals) });

  // Who a row is about. rezervKey: the column holding their Rezerv customer id.
  function importWho(row, rezervKey, warn) {
    const raw = String(row.email ?? '').trim().toLowerCase();
    const email = raw && raw.length <= 200 && EMAIL_RE.test(raw) ? raw : null;
    if (raw && !email) warn(why('notEmail', raw.slice(0, 60)));
    return { rezervId: importId(row[rezervKey]) || null, email, phone: cleanId(row.phone, 40) || null,
      name: clean(row.name, 120) || null, bad: excelId(row[rezervKey]) ? why('excelId', cleanId(row[rezervKey], 40)) : null };
  }

  // Rezerv id, then email, then phone (the last 9 digits: 081… and +6681… are
  // one number), then the exact name. Someone found by phone or name who
  // carries a different Rezerv id is somebody else. One whose email, or for a
  // phone their name, says it is somebody else is a clash: never merged.
  async function importFind(db, f) {
    if (f.rezervId) {
      const r = (await db.query('SELECT * FROM bkk_members WHERE rezerv_id=$1', [f.rezervId])).rows[0];
      if (r) return { member: r };
    }
    let clash = null;
    if (f.email) {
      const r = (await db.query('SELECT * FROM bkk_members WHERE lower(email)=$1', [f.email])).rows[0];
      if (r && !(f.rezervId && r.rezerv_id && r.rezerv_id !== f.rezervId)) return { member: r };
      if (r) clash = { code: 'clashEmail', vals: [f.email, r.name, r.code, r.rezerv_id] };
    }
    const other = m => f.rezervId && m.rezerv_id && m.rezerv_id !== f.rezervId;
    const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const emailOff = m => f.email && m.email && m.email.toLowerCase() !== f.email;
    const nameOff = m => f.name && norm(m.name) !== norm(f.name);
    const clashOf = m => emailOff(m) ? { code: 'clashOtherEmail', vals: [m.name, m.code, m.email] }
      : { code: 'clashPhone', vals: [f.phone, m.name, m.code, f.name] };
    const digits = String(f.phone || '').replace(/\D/g, '');
    if (digits.length >= 9) {
      const rows = (await db.query(
        `SELECT * FROM bkk_members WHERE right(regexp_replace(coalesce(phone,''), '\\D', '', 'g'), 9) = $1 ORDER BY id`,
        [digits.slice(-9)])).rows.filter(m => !other(m));
      // A shared family phone, or a placeholder like 0000000000, is no proof alone.
      const fits = rows.filter(m => !emailOff(m) && !nameOff(m));
      if (fits.length === 1) return { member: fits[0] };
      if (fits.length > 1) return { reason: why('sharePhone', fits.length, f.phone) };
      if (rows.length && !clash) clash = clashOf(rows[0]);
    }
    if (f.name) {
      const rows = (await db.query(
        `SELECT * FROM bkk_members WHERE lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = lower($1) ORDER BY id`,
        [f.name.replace(/\s+/g, ' ').trim()])).rows.filter(m => !other(m));
      const fits = rows.filter(m => !emailOff(m));
      if (fits.length === 1) return { member: fits[0] };
      if (fits.length > 1) return { reason: why('sameName', fits.length, f.name) };
      if (rows.length && !clash) clash = clashOf(rows[0]);
    }
    return clash ? { clash } : {};
  }

  const importNewMember = (db, f) => db.query(
    `INSERT INTO bkk_members (code,name,email,phone,rezerv_id,joined_on,source)
     VALUES ($1,$2,$3,$4,$5,$6,'rezerv') RETURNING *`,
    [memberCode(), f.name, f.email, f.phone, f.rezervId, f.joinedOn || null]).then(r => r.rows[0]);

  // Fills what a found student is missing. Never overwrites: a different
  // email or Rezerv id on file stays, and the import says so.
  async function fillMember(db, m, f, warn) {
    const set = {};
    if (f.email && !m.email) {
      const o = (await db.query('SELECT code,name FROM bkk_members WHERE lower(email)=$1 AND id<>$2', [f.email, m.id])).rows[0];
      if (o) warn(why('emailTaken', f.email, o.name, o.code, m.name));
      else set.email = f.email;
    } else if (f.email && String(m.email).toLowerCase() !== f.email) {
      warn(why('keepsEmail', m.name, m.email, f.email));
    }
    if (f.phone && !m.phone) set.phone = f.phone;
    if (f.joinedOn && !m.joined_on) set.joined_on = f.joinedOn;
    if (f.rezervId && !m.rezerv_id) set.rezerv_id = f.rezervId;
    else if (f.rezervId && m.rezerv_id !== f.rezervId) warn(why('keepsRezervId', m.name, m.rezerv_id, f.rezervId));
    const keys = Object.keys(set);
    if (!keys.length) return false;
    await db.query(`UPDATE bkk_members SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')} WHERE id=$1`,
      [m.id, ...keys.map(k => set[k])]);
    return true;
  }

  // For visits, payments and passes: a new student only when a name is given
  // and nobody matches.
  async function importStudent(db, row, ctx, warn) {
    const f = importWho(row, 'memberRezervId', warn);
    if (f.bad) return { skip: f.bad };
    if (!f.rezervId && !f.email && !f.phone && !f.name) return { skip: why('noWho') };
    const hit = await importFind(db, f);
    if (hit.reason) return { skip: hit.reason };
    if (hit.member) return { member: hit.member, f };
    // Somebody else's email, phone or name: their visits and money must not
    // land on that profile, and nobody can tell from here who this is.
    if (hit.clash) return { skip: why(hit.clash.code, ...hit.clash.vals, 'hand') };
    if (!f.name) return { skip: why('notFound') };
    ctx.made = f.name;
    return { member: await importNewMember(db, f), f };
  }

  // Rezerv's own id for the row, else a hash of what makes it that row. The
  // nth identical row in a file is its own record (two drop-ins on one day):
  // the page numbers them over the whole file (row.nth), as a batch of 1,000
  // rows cannot see the one before it.
  function importRef(kind, rezervId, parts, row, ctx) {
    const id = importId(rezervId);
    if (id) return id;
    const h = crypto.createHash('sha1').update([kind, ...parts].join('|')).digest('hex').slice(0, 24);
    let n = Number.isInteger(row.nth) && row.nth > 0 ? row.nth : 1;
    while (ctx.seen.has(`${h}#${n}`)) n++;
    ctx.seen.add(`${h}#${n}`);
    return `h:${h}${n > 1 ? '#' + n : ''}`;
  }

  // Weekday + start time (active or not). Online and shala classes share
  // times, so the class name decides between them; with no time, only a name
  // that one slot that weekday carries.
  function matchSlot(slots, date, time, className) {
    const wd = new Date(`${date}T12:00:00${TZ_OFFSET}`).getUTCDay();
    const name = String(className || '').toLowerCase();
    let c = slots.filter(s => s.weekday === wd && (time ? s.start_time === time : name && s.title.toLowerCase() === name));
    if (!time) return c.length === 1 ? c[0] : null;
    if (c.length > 1) {
      const exact = c.filter(s => s.title.toLowerCase() === name);
      const online = /online|zoom|ออนไลน์/i.test(name);
      const kind = c.filter(s => !!s.is_online === online);
      c = exact.length ? exact : kind.length ? kind : c;
    }
    c.sort((a, b) => (b.active - a.active) || a.id - b.id);
    return c[0] || null;
  }

  async function importMemberRow(db, row, ctx, warn) {
    const f = importWho(row, 'rezervId', warn);
    if (f.bad) return { skip: f.bad };
    if (!f.name) return { skip: why('noName') };
    const jRaw = clean(row.joinedOn, 40);
    const joined = jRaw ? parseWhen(jRaw) : null;
    if (jRaw && !joined) warn(why('badJoined', jRaw));
    f.joinedOn = joined ? joined.date : null;
    const hit = await importFind(db, f);
    if (hit.reason) return { skip: hit.reason };
    if (!hit.member) {
      // Somebody else holds that email, phone or name: a new student, never a merge.
      if (hit.clash) {
        const noEmail = hit.clash.code === 'clashEmail';
        warn(why(hit.clash.code, ...hit.clash.vals, noEmail ? 'madeNoEmail' : 'made'));
        if (noEmail) f.email = null;
      }
      await importNewMember(db, f);
      return { result: 'added' };
    }
    return { result: await fillMember(db, hit.member, f, warn) ? 'updated' : 'matched' };
  }

  // A "Checked in" column of Yes/No instead of a time.
  const CI_YES = /^(yes|y|true|1|[✓✔x]|ใช่|มา)$/i, CI_NO = /^(no|n|false|0|[✗✘]|ไม่|ไม่มา)$/i;
  async function importVisit(db, row, ctx, warn) {
    if (excelId(row.rezervId)) return { skip: why('excelId', cleanId(row.rezervId, 40)) };
    const when = parseWhen(row.date);
    if (!when) return { skip: why('badDate', clean(row.date, 40)) };
    const tRaw = clean(row.time, 20);
    // Excel saves a date-only cell as "04/10/2026 0:00": that is no time at all.
    const time = tRaw ? parseClock(tRaw) : when.time === '00:00' ? null : when.time;
    if (tRaw && !time) return { skip: why('badTime', tRaw) };
    let status = visitStatus(row.status);
    if (status === undefined) return { skip: why('badStatus', clean(row.status, 40)) };
    if (status === 'waitlist') return { skip: why('waitlist') };
    const ciRaw = clean(row.checkedInAt, 40);
    const ciSaid = CI_YES.test(ciRaw) ? 'yes' : CI_NO.test(ciRaw) ? 'no' : null;
    let ci = null;
    if (ciRaw && !ciSaid) {
      ci = parseWhen(ciRaw) || (parseClock(ciRaw) ? { date: when.date, time: parseClock(ciRaw) } : null);
      if (!ci) warn(why('badCheckIn', ciRaw));
    }

    const className = clean(row.className, 120) || null;
    const slot = matchSlot(ctx.slots, when.date, time, className);
    const startAt = startAtISO(when.date, slot ? slot.start_time : (time || '00:00'));
    const begun = new Date(startAt) <= ctx.now;
    if ((ci || ciSaid === 'yes') && (status === null || status === 'booked')) status = 'attended';
    if (ciSaid === 'no' && (status === null || status === 'booked')) status = 'unchecked';
    // Said not to have come: a no-show, never counted as attended by the tick box.
    if (status === 'unchecked') status = begun ? 'noshow' : 'booked';
    // No status: a row in a visits file is a visit, or a booking still to come.
    if (status === null) status = begun ? 'attended' : 'booked';
    if (status === 'booked' && begun) {
      if (ctx.pastBookedAttended) status = 'attended'; else ctx.rowPastBooked = true;
    }
    // A booking still to come is a real seat: it must be a class we run.
    const future = when.date >= ctx.today;
    let ov = null;
    if (status === 'booked' && future) {
      if (!slot || !slot.active) return { skip: why('noSlot', time, when.date) };
      if (moonDaysBetween(when.date, when.date).size) return { skip: why('moonDay', when.date) };
      ov = (await db.query('SELECT * FROM bkk_class_overrides WHERE slot_id=$1 AND class_date=$2', [slot.id, when.date])).rows[0];
      if (ov && ov.cancelled) return { skip: why('classOff', slot.title, when.date) };
    }

    const who = await importStudent(db, row, ctx, warn);
    if (who.skip) return who;
    const m = who.member;
    const own = importId(row.rezervId);
    const ref = importRef('visits', row.rezervId, [m.id, when.date, time || '', className || (slot ? slot.title : '')], row, ctx);
    const t = {
      status: status === 'attended' || status === 'booked' ? 'booked' : status === 'late' ? 'cancelled' : status,
      checkedIn: status === 'attended' ? (ci && ci.time ? startAtISO(ci.date, ci.time) : startAt) : null,
      reason: status === 'late' ? 'late cancel (Rezerv)' : status === 'cancelled' ? 'cancelled in Rezerv' : null,
    };
    const had = (await db.query(`SELECT *, to_char(class_date,'YYYY-MM-DD') AS d FROM bkk_bookings
      WHERE source='rezerv' AND source_ref=$1`, [ref])).rows[0];
    if (had) {
      // One Rezerv id on two different visits: a class or order id mapped as the booking id.
      if (own && (had.member_id !== m.id || had.d !== when.date || new Date(had.start_at).getTime() !== Date.parse(startAt))) {
        return { skip: why('idReused', own, 'visit') };
      }
      if (had.status === t.status && !!had.checked_in_at === !!t.checkedIn) return { result: 'matched' };
      // Imported before. Rezerv may since have marked it attended or cancelled,
      // but only forward: a check-in at our door, a seat cancelled on aybkk.net
      // or a no-show is never undone by a later export.
      const here = visitStatusOut(had), file = t.checkedIn ? 'attended' : t.status;
      if (had.status !== 'booked' || had.checked_in_at) {
        // Rezerv never sees our door, so "booked" there next to a check-in here is expected.
        if (!(here === 'attended' && file === 'booked')) warn(why('keptHere', here, file));
        return { result: 'matched' };
      }
      await db.query(`UPDATE bkk_bookings SET status=$2, checked_in_at=coalesce(checked_in_at, $3), cancel_reason=$4,
          cancelled_at=CASE WHEN $2='cancelled' THEN coalesce(cancelled_at, now()) ELSE cancelled_at END WHERE id=$1`,
        [had.id, t.status, t.checkedIn, t.reason]);
      return { result: 'updated' };
    }
    if (slot && t.status !== 'booked') {
      // Checked in at our door, which Rezerv never saw: they came, so its
      // no-show or cancel for that class is not added next to the visit.
      const came = (await db.query(`SELECT 1 FROM bkk_bookings WHERE slot_id=$1 AND class_date=$2 AND member_id=$3
          AND status='booked' AND checked_in_at IS NOT NULL`, [slot.id, when.date, m.id])).rows[0];
      if (came) { warn(why('cameDoor', t.status)); return { result: 'matched' }; }
    }
    if (slot && t.status === 'booked') {
      // On the list here already (the door, or booked on aybkk.net): one visit, not two.
      const seat = (await db.query(
        `SELECT id, checked_in_at FROM bkk_bookings WHERE slot_id=$1 AND class_date=$2 AND member_id=$3 AND status='booked'`,
        [slot.id, when.date, m.id])).rows[0];
      if (seat) {
        if (!t.checkedIn || seat.checked_in_at) return { result: 'matched' };
        await db.query('UPDATE bkk_bookings SET checked_in_at=$2 WHERE id=$1', [seat.id, t.checkedIn]);
        return { result: 'updated' };
      }
      if (future) {
        await db.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [slot.id, Number(when.date.replace(/-/g, ''))]);
        const cap = ov && ov.capacity != null ? ov.capacity : slot.capacity;
        const taken = await seatsTaken(db, slot.id, when.date);
        if (taken >= cap) warn(why('overCap', taken + 1, cap, slot.title, when.date));
      }
    }
    await db.query(
      `INSERT INTO bkk_bookings (slot_id,class_date,start_at,member_id,status,booked_at,checked_in_at,cancel_reason,cover,source,source_ref,class_title)
       VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,'rezerv','rezerv',$8,$9)`,
      [slot ? slot.id : null, when.date, startAt, m.id, t.status, t.checkedIn, t.reason, ref, className]);
    return { result: 'added' };
  }

  // What was bought, as a package in the catalogue when it clearly is one.
  const ITEM_PLANS = [[/drop[\s-]*in|ครั้งเดียว/i, 'dropin'], ...IMPORT_PLANS];
  async function itemProduct(db, item) {
    if (!item) return null;
    const exact = (await db.query(
      `SELECT * FROM bkk_products WHERE lower(name_en)=lower($1) OR lower(coalesce(name_th,''))=lower($1) OR code=lower($1)
       ORDER BY id LIMIT 1`, [item])).rows[0];
    if (exact) return exact;
    const plan = ITEM_PLANS.find(([re]) => re.test(item));
    return plan ? (await db.query('SELECT * FROM bkk_products WHERE code=$1', [plan[1]])).rows[0] || null : null;
  }

  async function importPayment(db, row, ctx, warn) {
    if (excelId(row.rezervId)) return { skip: why('excelId', cleanId(row.rezervId, 40)) };
    const when = parseWhen(row.date);
    if (!when) return { skip: why('badDate', clean(row.date, 40)) };
    const amount = parseAmount(row.amount);
    if (amount == null) return { skip: why('badAmount', clean(row.amount, 40)) };
    // Only money that came in, or went back: a failed, pending or voided payment is not money.
    const st = payStatus(clean(row.status, 60));
    if (st === undefined) return { skip: why('payStatus', clean(row.status, 40)) };
    if (st === 'skip') return { skip: why('notMoney', clean(row.status, 40)) };
    const amt = st === 'refund' ? -Math.abs(Math.round(amount)) : Math.round(amount);
    let vat = 0;
    const vRaw = clean(row.vat, 40);
    if (vRaw) {
      const v = parseAmount(vRaw.replace(/%/g, ''));
      if (v == null) warn(why('badVat', vRaw));
      // "7%" is the rate, so the VAT inside the amount paid. A refund takes its VAT back.
      else vat = Math.abs(Math.round(vRaw.includes('%') ? amt * v / (100 + v) : v)) * (amt < 0 ? -1 : 1);
    }
    const item = clean(row.item, 120) || null;
    const methodRaw = clean(row.method, 60);
    const note = clean(row.note, 300);
    const who = await importStudent(db, row, ctx, warn);
    if (who.skip) return who;
    const own = importId(row.rezervId);
    const ref = importRef('payments', row.rezervId, [who.member.id, when.date, when.time || '', item || '', amt], row, ctx);
    const had = (await db.query(`SELECT o.member_id, o.amount_thb, o.item_name, to_char(${PAY_DAY},'YYYY-MM-DD') AS d
      FROM bkk_orders o WHERE o.source='rezerv' AND o.source_ref=$1`, [ref])).rows[0];
    if (had) {
      // One Rezerv id on two different payments: an order or invoice with several lines.
      if (own && (had.member_id !== who.member.id || had.amount_thb !== amt || had.d !== when.date
        || (had.item_name || '') !== (item || ''))) return { skip: why('idReused', own, 'payment') };
      return { result: 'matched' };
    }
    const pr = await itemProduct(db, item);
    let refno = newRefno();
    for (let i = 0; i < 10 && (await db.query('SELECT 1 FROM bkk_orders WHERE refno=$1', [refno])).rows.length; i++) refno = newRefno();
    const at = startAtISO(when.date, when.time || '00:00');
    await db.query(
      `INSERT INTO bkk_orders (refno,product_id,member_id,base_thb,fee_thb,vat_thb,amount_thb,status,gateway_note,
         verified_at,created_at,method,item_name,source,source_ref)
       VALUES ($1,$2,$3,$4,0,$5,$6,$7,$8,$9,$9,$10,$11,'rezerv',$12)`,
      [refno, pr ? pr.id : null, who.member.id, amt - vat, vat, amt, amt < 0 ? 'refund' : 'paid',
       [methodRaw, note].filter(Boolean).join(' | ') || 'moved from Rezerv', at, payMethod(methodRaw), item, ref]);
    return { result: 'added' };
  }

  // The paste importer's fields plus memberRezervId and start.
  async function importPass(db, row, ctx, warn) {
    row = { ...row, name: String(row.name || '').replace(/\s*\((renewed|staff)\)\s*/gi, ' ') };
    const planRaw = clean(row.plan, 80);
    const plan = IMPORT_PLANS.find(([re]) => re.test(planRaw));
    if (!plan) return { skip: why('badPlan', planRaw) };
    const until = parseWhen(row.until);
    if (!until) return { skip: why('badUntil', clean(row.until, 40)) };
    const sRaw = clean(row.start, 40);
    const start = sRaw ? parseWhen(sRaw) : null;
    if (sRaw && !start) return { skip: why('badStart', sRaw) };
    if (start && start.date > until.date) return { skip: why('startsAfterEnd') };
    // A year sold since 21 Oct 2026 has no free month: one that runs a year
    // or less is the 12-month package, not the old 13-month one.
    const code = plan[1] === 'unlim12' && start && (Date.parse(until.date) - Date.parse(start.date)) / 86400000 <= 366
      ? 'unlim12m' : plan[1];
    const pr = await planProduct(db, code);
    if (!pr) return { skip: why('noPackage', code) };
    const total = pr.kind === 'credits' ? (pr.credits || 10) : null;
    // "3", "3/10" or "3 classes": the number at the start. Unreadable is never "all left".
    let left = null;
    const lRaw = clean(row.classesLeft, 40);
    if (total != null && lRaw) {
      const lm = lRaw.match(/^(\d+)/);
      if (!lm) return { skip: why('badLeft', lRaw) };
      left = Number(lm[1]);
      if (left > total) warn(why('leftOver', left, total));
    }
    const who = await importStudent(db, row, ctx, warn);
    if (who.skip) return who;
    const m = who.member;
    // As the paste importer did: an email or phone on the pass list fills a gap.
    if (!ctx.made) await fillMember(db, m, who.f, warn);
    if ((await db.query('SELECT 1 FROM bkk_passes WHERE member_id=$1 AND product_id=$2 AND valid_until=$3',
      [m.id, pr.id, until.date])).rows.length) return { result: 'matched' };
    const from = start ? start.date
      : new Date(Date.parse(until.date + 'T00:00:00Z') - (pr.valid_days - 1) * 86400e3).toISOString().slice(0, 10);
    await db.query(`INSERT INTO bkk_passes
        (member_id,product_id,order_id,kind,credits_total,credits_used,daily_cap,valid_days,valid_from,valid_until,note,source)
      VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,'moved from Rezerv','rezerv')`,
      [m.id, pr.id, pr.kind, total, left != null ? Math.max(0, total - left) : 0,
       pr.daily_cap, pr.valid_days, from, until.date]);
    return { result: 'added' };
  }

  const IMPORTERS = { members: importMemberRow, visits: importVisit, payments: importPayment, passes: importPass };

  app.post('/api/bkk/admin/import/:kind', async (req, res) => {
    if (adminOnly(req, res)) return;
    const kind = req.params.kind;
    if (!IMPORTERS[kind]) return res.status(404).json({ error: 'kind must be members, visits, payments or passes' });
    const b = req.body || {};
    if (!Array.isArray(b.rows)) return res.status(400).json({ error: 'rows must be a list' });
    if (b.rows.length > IMPORT_MAX_ROWS) return res.status(400).json({ error: `at most ${IMPORT_MAX_ROWS} rows per call: send them in batches` });
    // Writing takes an explicit dryRun:false; anything else only looks.
    const dryRun = b.dryRun !== false;
    const firstRow = Number.isInteger(b.firstRow) && b.firstRow > 0 ? b.firstRow : 1;
    const out = { kind, dryRun, total: b.rows.length, added: 0, matched: 0, updated: 0, newMembers: 0, skipped: [], warnings: [] };
    const ctx = { today: bkkToday(), now: bkkNow(), seen: new Set(), pastBooked: 0, pastBookedAttended: b.pastBookedAttended === true };
    // A reason or note as the page gets it: the English text, plus its code and values to say it in Thai.
    const said = (x, key) => typeof x === 'string' ? { [key]: x } : { [key]: x.text, code: x.code, vals: x.vals };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // One import at a time: two at once could each make the same new student.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('bkk_import'))`);
      ctx.slots = (await client.query('SELECT * FROM bkk_class_slots ORDER BY id')).rows;
      for (let i = 0; i < b.rows.length; i++) {
        const row = firstRow + i;
        const notes = [];
        ctx.made = null; ctx.rowPastBooked = false;
        await client.query('SAVEPOINT import_row');
        let r;
        try {
          const data = b.rows[i] && typeof b.rows[i] === 'object' ? b.rows[i] : {};
          r = await IMPORTERS[kind](client, data, ctx, message => notes.push({ row, ...said(message, 'message') }));
        } catch (e) {
          r = { skip: e.code === '23505' ? why('duplicate') : e.message };
        }
        // A skipped row leaves nothing behind, not even a new student.
        if (r.skip) {
          await client.query('ROLLBACK TO SAVEPOINT import_row');
          out.skipped.push({ row, ...said(r.skip, 'reason') });
          continue;
        }
        await client.query('RELEASE SAVEPOINT import_row');
        out[r.result]++;
        if (ctx.rowPastBooked) ctx.pastBooked++;
        if (ctx.made) { out.newMembers++; out.warnings.push({ row, ...said(why('newStudent', ctx.made), 'message') }); }
        out.warnings.push(...notes);
      }
      if (ctx.pastBooked) out.warnings.push({ row: null, ...said(why('pastBooked', ctx.pastBooked), 'message') });
      await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(500).json({ error: e.message });
    } finally { client.release(); }
    if (!dryRun) console.log(`✓ bkk: Rezerv ${kind} import: ${out.added} added, ${out.matched} matched, ${out.updated} updated, ${out.skipped.length} skipped`);
    res.json(out);
  });

  // ── admin sees everything ─────────────────────────────────────────────────
  // node-postgres reads a DATE as local midnight, so its local parts are the date.
  const pgDate = d => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null;
  const visitStatusOut = v => v.status === 'booked' && v.checked_in_at ? 'attended' : v.status;
  const passOut = p => ({
    id: p.id, name: p.name_en, nameTh: p.name_th, kind: p.kind, status: p.status,
    source: p.source || (p.order_id ? 'order' : 'manual'), note: p.note,
    creditsTotal: p.credits_total, creditsUsed: p.credits_used,
    creditsLeft: p.kind === 'unlimited' ? null : (p.credits_total || 0) - (p.credits_used || 0),
    dailyCap: p.daily_cap, validFrom: p.from_d, validUntil: p.until_d,
    frozenFrom: p.frozen_from_d, frozenUntil: p.frozen_until_d, createdAt: p.created_at,
  });
  const PASS_DATES = `to_char(p.valid_from,'YYYY-MM-DD') AS from_d, to_char(p.valid_until,'YYYY-MM-DD') AS until_d,
    to_char(p.frozen_from,'YYYY-MM-DD') AS frozen_from_d, to_char(p.frozen_until,'YYYY-MM-DD') AS frozen_until_d`;

  // One student, all of it: every visit, payment, pass and note, newest first.
  app.get('/api/bkk/admin/members/:code/history', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const m = (await q('SELECT * FROM bkk_members WHERE code=$1', [req.params.code])).rows[0];
      if (!m) return res.status(404).json({ error: 'member not found' });
      const [visits, pays, passes, notes, photos, checks, active] = await Promise.all([
        q(`SELECT b.id, to_char(b.class_date,'YYYY-MM-DD') AS date, ${VISIT_TIME} AS time,
             coalesce(s.title, b.class_title) AS class, b.status, b.checked_in_at, b.cancelled_at, b.cancel_reason,
             b.cover, b.source, b.slot_id, b.start_at
           FROM bkk_bookings b LEFT JOIN bkk_class_slots s ON s.id=b.slot_id
           WHERE b.member_id=$1 ORDER BY b.class_date DESC, b.start_at DESC, b.id DESC`, [m.id]),
        q(`SELECT o.id, to_char(${PAY_AT} AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') AS date,
             to_char(${PAY_AT} AT TIME ZONE 'Asia/Bangkok','HH24:MI') AS time, coalesce(pr.name_en, o.item_name) AS item,
             o.amount_thb, o.base_thb, o.fee_thb, o.vat_thb, o.method, o.status, o.source, o.refno, o.gateway_note
           FROM bkk_orders o LEFT JOIN bkk_products pr ON pr.id=o.product_id
           WHERE o.member_id=$1 ORDER BY ${PAY_AT} DESC, o.id DESC`, [m.id]),
        q(`SELECT p.*, pr.name_en, pr.name_th, ${PASS_DATES} FROM bkk_passes p LEFT JOIN bkk_products pr ON pr.id=p.product_id
           WHERE p.member_id=$1 ORDER BY coalesce(p.valid_from, (p.created_at AT TIME ZONE 'Asia/Bangkok')::date) DESC, p.id DESC`, [m.id]),
        q(`SELECT n.id, to_char(n.class_date,'YYYY-MM-DD') AS date, n.created_at, n.body, n.to_work_on,
             n.share_with_student, t.name AS teacher
           FROM bkk_notes n LEFT JOIN bkk_teachers t ON t.id=n.teacher_id
           WHERE n.member_id=$1 ORDER BY n.created_at DESC`, [m.id]),
        q('SELECT count(*)::int AS n FROM bkk_photo_members WHERE member_id=$1', [m.id]),
        q(`SELECT to_char(taken_on,'YYYY-MM-DD') AS date, resting_hr, sleep_hours, feel, note
           FROM bkk_checks WHERE member_id=$1 ORDER BY taken_on DESC`, [m.id]),
        activePass(m.id),
      ]);
      const today = bkkToday();
      const daysAgo = n => ymd(new Date(Date.parse(`${today}T12:00:00${TZ_OFFSET}`) - n * 86400000));
      const came = visits.rows.filter(v => visitStatusOut(v) === 'attended');
      const money = pays.rows.filter(o => o.status === 'paid' || o.status === 'refund');
      res.json({
        member: { code: m.code, name: m.name, email: m.email, phone: m.phone, joinedOn: pgDate(m.joined_on),
          source: m.source, rezervId: m.rezerv_id, createdAt: m.created_at },
        summary: {
          visits: came.length,
          visitsLast30: came.filter(v => v.date > daysAgo(30)).length,
          visitsLast90: came.filter(v => v.date > daysAgo(90)).length,
          firstVisit: came.length ? came[came.length - 1].date : null,
          lastVisit: came.length ? came[0].date : null,
          noShows: visits.rows.filter(v => v.status === 'noshow' || (v.status === 'booked' && !v.checked_in_at && v.date < today)).length,
          cancellations: visits.rows.filter(v => v.status === 'cancelled').length,
          totalPaid: money.reduce((s, o) => s + o.amount_thb, 0),
          payments: money.filter(o => o.status === 'paid').length,
          activePass: active ? { name: active.name_en, kind: active.kind,
            until: pgDate(active.valid_until),
            creditsLeft: active.kind === 'unlimited' ? null : active.credits_total - active.credits_used } : null,
        },
        passes: passes.rows.map(passOut),
        visits: visits.rows.map(v => ({ id: v.id, date: v.date, time: v.time, class: v.class, status: visitStatusOut(v),
          checkedInAt: v.checked_in_at, cancelledAt: v.cancelled_at, cancelReason: v.cancel_reason,
          cover: v.cover, source: v.source, upcoming: new Date(v.start_at) > bkkNow() && v.status === 'booked' })),
        payments: pays.rows.map(o => ({ id: o.id, date: o.date, time: o.time, item: o.item, amount: o.amount_thb,
          base: o.base_thb, fee: o.fee_thb, vat: o.vat_thb, method: o.method, status: o.status,
          source: o.source || 'aybkk', refno: String(o.refno), note: o.gateway_note })),
        notes: notes.rows.map(n => ({ id: n.id, date: n.date, createdAt: n.created_at, teacher: n.teacher,
          body: n.body, toWorkOn: n.to_work_on, shared: n.share_with_student })),
        photos: photos.rows[0].n,
        checks: checks.rows.map(c => ({ date: c.date, restingHr: c.resting_hr,
          sleepHours: c.sleep_hours == null ? null : Number(c.sleep_hours), feel: c.feel, note: c.note })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ?from=&to= as Bangkok dates, both ends included.
  function dayRange(qs, { required = false, maxDays = null } = {}) {
    const { from, to } = qs;
    if (!from && !to) return required ? { error: 'from and to (YYYY-MM-DD) required' } : { from: null, to: null };
    if (!realYmd(from) || !realYmd(to)) return { error: 'from and to must both be dates (YYYY-MM-DD)' };
    if (from > to) return { error: 'from is after to' };
    if (maxDays && (Date.parse(to) - Date.parse(from)) / 86400000 + 1 > maxDays) return { error: `at most ${maxDays} days at a time` };
    return { from, to };
  }

  // The shala over a stretch of days: who came, what came in, who to call.
  app.get('/api/bkk/admin/report', async (req, res) => {
    if (adminOnly(req, res)) return;
    const r = dayRange(req.query, { required: true, maxDays: 400 });
    if (r.error) return res.status(400).json({ error: r.error });
    const { from, to } = r;
    const today = bkkToday();
    try {
      const all = async (sql, args = [from, to]) => (await q(sql, args)).rows;
      const inRange = `b.class_date BETWEEN $1::date AND $2::date`;
      const paid = `o.status IN ('paid','refund') AND ${PAY_DAY} BETWEEN $1::date AND $2::date`;
      const [v, first, vDay, vClass, vSource, mTot, mDay, mMethod, mItem, mSource, sold, expiring, notSeen] = await Promise.all([
        all(`SELECT count(*) FILTER (WHERE ${ATTENDED})::int AS total,
               count(*) FILTER (WHERE b.status='booked')::int AS booked,
               count(*) FILTER (WHERE ${NOSHOW})::int AS no_shows,
               count(*) FILTER (WHERE b.status='cancelled')::int AS cancelled,
               count(DISTINCT b.member_id) FILTER (WHERE ${ATTENDED})::int AS students
             FROM bkk_bookings b WHERE ${inRange}`),
        all(`SELECT count(*)::int AS n FROM (SELECT min(b.class_date) AS first FROM bkk_bookings b
               WHERE ${ATTENDED} GROUP BY b.member_id) f WHERE f.first BETWEEN $1::date AND $2::date`),
        all(`SELECT to_char(b.class_date,'YYYY-MM-DD') AS date, count(*) FILTER (WHERE b.checked_in_at IS NOT NULL)::int AS attended,
               count(*)::int AS booked
             FROM bkk_bookings b WHERE b.status='booked' AND ${inRange} GROUP BY b.class_date ORDER BY b.class_date`),
        all(`SELECT coalesce(s.title, b.class_title, 'Class') AS title, ${VISIT_TIME} AS time,
               count(*) FILTER (WHERE b.checked_in_at IS NOT NULL)::int AS attended,
               count(DISTINCT b.class_date) FILTER (WHERE b.checked_in_at IS NOT NULL)::int AS classes
             FROM bkk_bookings b LEFT JOIN bkk_class_slots s ON s.id=b.slot_id
             WHERE b.status='booked' AND ${inRange} GROUP BY 1,2 ORDER BY 2 NULLS LAST, 1`),
        all(`SELECT coalesce(b.source,'aybkk') AS source, count(*)::int AS n FROM bkk_bookings b
             WHERE ${ATTENDED} AND ${inRange} GROUP BY 1 ORDER BY n DESC, 1`),
        all(`SELECT coalesce(sum(o.amount_thb),0)::int AS total, coalesce(sum(o.vat_thb),0)::int AS vat, count(*)::int AS n
             FROM bkk_orders o WHERE ${paid}`),
        all(`SELECT to_char(${PAY_DAY},'YYYY-MM-DD') AS date, sum(o.amount_thb)::int AS total
             FROM bkk_orders o WHERE ${paid} GROUP BY 1 ORDER BY 1`),
        all(`SELECT o.method, count(*)::int AS n, sum(o.amount_thb)::int AS total
             FROM bkk_orders o WHERE ${paid} GROUP BY 1 ORDER BY total DESC, 1`),
        all(`SELECT coalesce(pr.name_en, o.item_name, 'other') AS item, count(*)::int AS n, sum(o.amount_thb)::int AS total
             FROM bkk_orders o LEFT JOIN bkk_products pr ON pr.id=o.product_id WHERE ${paid} GROUP BY 1 ORDER BY total DESC, 1`),
        all(`SELECT coalesce(o.source,'aybkk') AS source, count(*)::int AS n, sum(o.amount_thb)::int AS total
             FROM bkk_orders o WHERE ${paid} GROUP BY 1 ORDER BY total DESC, 1`),
        all(`SELECT count(*)::int AS n FROM bkk_orders o
             WHERE o.status='paid' AND o.product_id IS NOT NULL AND ${PAY_DAY} BETWEEN $1::date AND $2::date`),
        // Ends within 14 days, and nothing after it to carry on with.
        all(`SELECT m.code, m.name, pr.name_en AS item, to_char(p.valid_until,'YYYY-MM-DD') AS until
             FROM bkk_passes p JOIN bkk_members m ON m.id=p.member_id LEFT JOIN bkk_products pr ON pr.id=p.product_id
             WHERE p.status='active' AND p.valid_until BETWEEN $1::date AND $1::date + 14
               AND (p.kind='unlimited' OR p.credits_used < p.credits_total)
               AND NOT EXISTS (SELECT 1 FROM bkk_passes x WHERE x.member_id=p.member_id AND x.id<>p.id
                 AND x.status IN ('active','frozen') AND (x.valid_until IS NULL OR x.valid_until > p.valid_until)
                 AND (x.kind='unlimited' OR x.credits_used < x.credits_total))
             ORDER BY p.valid_until, m.name`, [today]),
        // Holds a pass they can use, and no class in the last 14 days: the "we miss you" list.
        // A pass under 14 days old and no visit yet is a new student, not one who stopped coming.
        all(`SELECT m.code, m.name, to_char(lv.last,'YYYY-MM-DD') AS last_visit, pr.name_en AS pass,
               to_char(p.valid_until,'YYYY-MM-DD') AS until
             FROM bkk_members m
             JOIN LATERAL (SELECT * FROM bkk_passes p WHERE p.member_id=m.id AND p.status='active'
               AND (p.valid_until IS NULL OR p.valid_until >= $1::date)
               AND (p.kind='unlimited' OR p.credits_used < p.credits_total)
               ORDER BY p.valid_from NULLS LAST, p.id LIMIT 1) p ON true
             LEFT JOIN bkk_products pr ON pr.id=p.product_id
             LEFT JOIN LATERAL (SELECT max(b.class_date) AS last FROM bkk_bookings b
               WHERE b.member_id=m.id AND ${ATTENDED}) lv ON true
             WHERE (lv.last IS NULL OR lv.last <= $1::date - 14)
               AND (lv.last IS NOT NULL OR coalesce(p.valid_from, (p.created_at AT TIME ZONE 'Asia/Bangkok')::date) <= $1::date - 14)
             ORDER BY lv.last NULLS FIRST, m.name`, [today]),
      ]);
      const t = v[0], mt = mTot[0];
      res.json({
        from, to,
        visits: {
          total: t.total, booked: t.booked, noShows: t.no_shows, cancelled: t.cancelled,
          uniqueStudents: t.students, newStudents: first[0].n, byDay: vDay,
          byClass: vClass.map(c => ({ ...c, avgPerClass: c.classes ? Math.round(c.attended / c.classes * 10) / 10 : 0 })),
          bySource: vSource,
        },
        money: { total: mt.total, vat: mt.vat, count: mt.n, byDay: mDay, byMethod: mMethod, byItem: mItem, bySource: mSource },
        passes: { sold: sold[0].n, expiringNext14: expiring },
        notSeen: notSeen.map(n => ({ code: n.code, name: n.name, lastVisit: n.last_visit, pass: n.pass, until: n.until })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Spreadsheets of everything. UTF-8 with a BOM so Excel reads Thai; a cell
  // that starts with = + - @ would run as a formula, so it is made plain text.
  const csvCell = v => typeof v === 'number' ? String(v)
    : `"${String(v ?? '').replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`;
  const EXPORTS = {
    visits: {
      head: ['date', 'time', 'class', 'status', 'checked_in', 'student', 'code', 'email', 'cover', 'source', 'cancel_reason', 'rezerv_ref'],
      sql: `SELECT to_char(b.class_date,'YYYY-MM-DD') AS date, ${VISIT_TIME} AS time, coalesce(s.title, b.class_title) AS class,
              CASE WHEN ${ATTENDED} THEN 'attended' ELSE b.status END AS status,
              to_char(b.checked_in_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD HH24:MI') AS checked_in,
              m.name AS student, m.code, m.email, b.cover, coalesce(b.source,'aybkk') AS source, b.cancel_reason,
              CASE WHEN b.source='rezerv' THEN b.source_ref END AS rezerv_ref
            FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id LEFT JOIN bkk_class_slots s ON s.id=b.slot_id
            WHERE ($1::date IS NULL OR b.class_date BETWEEN $1::date AND $2::date) AND ($3::int IS NULL OR b.member_id=$3)
            ORDER BY b.class_date, b.start_at, m.name, b.id`,
    },
    payments: {
      head: ['date', 'time', 'student', 'code', 'email', 'item', 'amount', 'base', 'fee', 'vat', 'method', 'status', 'source', 'refno', 'note', 'rezerv_ref'],
      sql: `SELECT to_char(${PAY_AT} AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') AS date,
              to_char(${PAY_AT} AT TIME ZONE 'Asia/Bangkok','HH24:MI') AS time, m.name AS student, m.code, m.email,
              coalesce(pr.name_en, o.item_name) AS item, o.amount_thb AS amount, o.base_thb AS base, o.fee_thb AS fee,
              o.vat_thb AS vat, o.method, o.status, coalesce(o.source,'aybkk') AS source, o.refno::text AS refno,
              o.gateway_note AS note, CASE WHEN o.source='rezerv' THEN o.source_ref END AS rezerv_ref
            FROM bkk_orders o LEFT JOIN bkk_members m ON m.id=o.member_id LEFT JOIN bkk_products pr ON pr.id=o.product_id
            WHERE ($1::date IS NULL OR ${PAY_DAY} BETWEEN $1::date AND $2::date) AND ($3::int IS NULL OR o.member_id=$3)
            ORDER BY ${PAY_AT}, o.id`,
    },
    // With a range: everyone who booked, came or paid in it, or joined in it.
    members: {
      head: ['code', 'name', 'email', 'phone', 'joined_on', 'source', 'rezerv_id', 'created', 'visits', 'first_visit',
        'last_visit', 'visits_in_range', 'paid_total', 'paid_in_range', 'active_pass', 'pass_until'],
      sql: `SELECT m.code, m.name, m.email, m.phone, to_char(m.joined_on,'YYYY-MM-DD') AS joined_on,
              coalesce(m.source,'aybkk') AS source, m.rezerv_id,
              to_char(m.created_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') AS created,
              v.visits, to_char(v.first,'YYYY-MM-DD') AS first_visit, to_char(v.last,'YYYY-MM-DD') AS last_visit,
              v.in_range AS visits_in_range, coalesce(pd.total,0)::int AS paid_total, coalesce(pd.in_range,0)::int AS paid_in_range,
              ap.name_en AS active_pass, to_char(ap.valid_until,'YYYY-MM-DD') AS pass_until
            FROM bkk_members m
            LEFT JOIN LATERAL (SELECT count(*)::int AS visits, min(b.class_date) AS first, max(b.class_date) AS last,
                count(*) FILTER (WHERE b.class_date BETWEEN $1::date AND $2::date)::int AS in_range
              FROM bkk_bookings b WHERE b.member_id=m.id AND ${ATTENDED}) v ON true
            LEFT JOIN LATERAL (SELECT sum(o.amount_thb) AS total,
                sum(o.amount_thb) FILTER (WHERE ${PAY_DAY} BETWEEN $1::date AND $2::date) AS in_range
              FROM bkk_orders o WHERE o.member_id=m.id AND o.status IN ('paid','refund')) pd ON true
            LEFT JOIN LATERAL (SELECT p.valid_until, pr.name_en FROM bkk_passes p JOIN bkk_products pr ON pr.id=p.product_id
              WHERE p.member_id=m.id AND p.status='active'
                AND (p.valid_until IS NULL OR p.valid_until >= (now() AT TIME ZONE 'Asia/Bangkok')::date)
                AND (p.kind='unlimited' OR p.credits_used < p.credits_total)
              ORDER BY p.valid_from NULLS LAST, p.id LIMIT 1) ap ON true
            WHERE ($3::int IS NULL OR m.id=$3) AND ($1::date IS NULL
              OR EXISTS (SELECT 1 FROM bkk_bookings b WHERE b.member_id=m.id AND b.class_date BETWEEN $1::date AND $2::date)
              OR EXISTS (SELECT 1 FROM bkk_orders o WHERE o.member_id=m.id AND o.status IN ('paid','refund')
                AND ${PAY_DAY} BETWEEN $1::date AND $2::date)
              OR m.joined_on BETWEEN $1::date AND $2::date
              OR (m.created_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1::date AND $2::date)
            ORDER BY lower(m.name), m.id`,
    },
  };
  // /export/visits.csv | payments.csv | members.csv, ?from=&to= (both or
  // neither: neither is all time), ?member=CODE for one student.
  app.get('/api/bkk/admin/export/:file', async (req, res) => {
    if (adminOnly(req, res)) return;
    const what = (String(req.params.file).match(/^(visits|payments|members)\.csv$/) || [])[1];
    if (!what) return res.status(404).json({ error: 'export visits.csv, payments.csv or members.csv' });
    const r = dayRange(req.query);
    if (r.error) return res.status(400).json({ error: r.error });
    try {
      let memberId = null, code = '';
      if (req.query.member) {
        const m = (await q('SELECT id, code FROM bkk_members WHERE code=$1', [String(req.query.member)])).rows[0];
        if (!m) return res.status(404).json({ error: 'member not found' });
        memberId = m.id; code = `-${m.code}`;
      }
      const ex = EXPORTS[what];
      const rows = (await q(ex.sql, [r.from, r.to, memberId])).rows;
      const lines = [ex.head.join(',')].concat(rows.map(row => ex.head.map(h => csvCell(row[h])).join(',')));
      const span = r.from ? `-${r.from}-to-${r.to}` : '';
      res.set('Content-Type', 'text/csv; charset=utf-8')
        .set('Content-Disposition', `attachment; filename="aybkk-${what}${code}${span}.csv"`)
        .set('Cache-Control', 'no-store');
      res.send('﻿' + lines.join('\r\n') + '\r\n');
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Pause a pass — the injury case. The clock stops: the expiry moves out by the
  // frozen days, and the pass cannot book while it is paused.
  app.post('/api/bkk/admin/passes/:id/freeze', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const days = Math.max(1, Math.min(365, parseInt((req.body || {}).days) || 0));
      if (!days) return res.status(400).json({ error: 'days required' });
      const reason = String((req.body || {}).reason || '').slice(0, 200);
      const r = await q(
        `UPDATE bkk_passes SET status='frozen',
           frozen_from = (now() AT TIME ZONE 'Asia/Bangkok')::date,
           frozen_until = (now() AT TIME ZONE 'Asia/Bangkok')::date + $2::int,
           valid_until = CASE WHEN valid_until IS NULL THEN NULL ELSE valid_until + $2::int END,
           note = coalesce(note || ' | ', '') || $3
         WHERE id=$1 AND status='active' RETURNING *`,
        [req.params.id, days, `frozen ${days}d: ${reason || 'no reason given'}`]);
      if (!r.rows.length) return res.status(409).json({ error: 'pass not found, or not active' });
      res.json({ success: true, pass: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Unpause early — and hand back the days that were not used, so a freeze can
  // never quietly become a gift of extra time.
  app.post('/api/bkk/admin/passes/:id/unfreeze', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const r = await q(
        `UPDATE bkk_passes SET status='active',
           valid_until = CASE
             WHEN valid_until IS NULL OR frozen_until IS NULL THEN valid_until
             ELSE valid_until - GREATEST(0,
               frozen_until - (now() AT TIME ZONE 'Asia/Bangkok')::date) END,
           frozen_until = (now() AT TIME ZONE 'Asia/Bangkok')::date
         WHERE id=$1 AND status='frozen' RETURNING *`, [req.params.id]);
      if (!r.rows.length) return res.status(409).json({ error: 'pass not found, or not frozen' });
      res.json({ success: true, pass: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Write off a pass. Nothing ever wrote bkk_passes.status before this, so a bad
  // import or a refunded sale could only be undone by hand in the database.
  app.post('/api/bkk/admin/passes/:id/void', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const reason = String((req.body || {}).reason || '').slice(0, 200);
      const r = await q(
        `UPDATE bkk_passes SET status='void',
           note = coalesce(note || ' | ', '') || $2
         WHERE id=$1 AND status <> 'void' RETURNING *`,
        [req.params.id, `voided: ${reason || 'no reason given'}`]);
      if (!r.rows.length) return res.status(409).json({ error: 'pass not found, or already void' });
      res.json({ success: true, pass: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Goodwill: extra days, extra credits, or both.
  app.post('/api/bkk/admin/passes/:id/extend', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const days = Math.max(0, Math.min(730, parseInt((req.body || {}).days) || 0));
      const credits = Math.max(0, Math.min(100, parseInt((req.body || {}).credits) || 0));
      if (!days && !credits) return res.status(400).json({ error: 'days or credits required' });
      const r = await q(
        `UPDATE bkk_passes SET
           valid_until = CASE WHEN valid_until IS NULL THEN NULL ELSE valid_until + $2::int END,
           credits_total = CASE WHEN credits_total IS NULL THEN NULL ELSE credits_total + $3::int END,
           note = coalesce(note || ' | ', '') || $4
         WHERE id=$1 RETURNING *`,
        [req.params.id, days, credits,
         `extended +${days}d +${credits}cr: ${String((req.body || {}).reason || '').slice(0, 120)}`]);
      if (!r.rows.length) return res.status(404).json({ error: 'pass not found' });
      res.json({ success: true, pass: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── the teaching team ─────────────────────────────────────────────────────
  // Boonchu, Jamsai and M. Each signs in with their own passcode so every note
  // carries a name; the admin passcode is for running the shala, not teaching.

  const hashKey = k => crypto.createHash('sha256').update(String(k)).digest('hex');

  // Returns the teacher, or null. Admin is NOT a teacher: someone has to own
  // each note, and "the admin" is not a person a student can ask about it.
  async function teacherFrom(req) {
    const key = req.headers['x-teacher-key'];
    if (!key) return null;
    const r = await q(
      'SELECT * FROM bkk_teachers WHERE key_hash = $1 AND active', [hashKey(key)]);
    return r.rows[0] || null;
  }

  app.get('/api/bkk/teacher/me', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    res.json({ teacher: { id: t.id, name: t.name } });
  });

  // A teacher's view of one student: everything, including notes kept from them.
  app.get('/api/bkk/teacher/student/:code', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    try {
      const m = (await q('SELECT * FROM bkk_members WHERE code=$1', [req.params.code])).rows[0];
      if (!m) return res.status(404).json({ error: 'not found' });
      const [passes, notes, recent] = await Promise.all([
        q(`SELECT p.*, pr.name_en FROM bkk_passes p JOIN bkk_products pr ON pr.id=p.product_id
           WHERE p.member_id=$1 ORDER BY p.id DESC`, [m.id]),
        q(`SELECT n.*, t.name AS teacher_name FROM bkk_notes n
           LEFT JOIN bkk_teachers t ON t.id=n.teacher_id
           WHERE n.member_id=$1 ORDER BY n.created_at DESC LIMIT 50`, [m.id]),
        q(`SELECT b.class_date, b.checked_in_at, s.title FROM bkk_bookings b
           JOIN bkk_class_slots s ON s.id=b.slot_id
           WHERE b.member_id=$1 AND b.status='booked'
           ORDER BY b.start_at DESC LIMIT 20`, [m.id]),
      ]);
      res.json({
        member: { code: m.code, name: m.name, email: m.email, phone: m.phone, journalId: await journalId(m) },
        passes: passes.rows, notes: notes.rows, recent: recent.rows,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/bkk/teacher/notes', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    try {
      const { memberCode, body, toWorkOn, classDate, shareWithStudent } = req.body || {};
      const m = (await q('SELECT id FROM bkk_members WHERE code=$1', [memberCode])).rows[0];
      if (!m) return res.status(404).json({ error: 'student not found' });
      if (!String(body || '').trim() && !String(toWorkOn || '').trim()) {
        return res.status(400).json({ error: 'write something in one of the two boxes' });
      }
      const n = (await q(
        `INSERT INTO bkk_notes (member_id,teacher_id,class_date,body,to_work_on,share_with_student)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [m.id, t.id, classDate || null,
         String(body || '').slice(0, 2000) || null,
         String(toWorkOn || '').slice(0, 500) || null,
         shareWithStudent !== false])).rows[0];
      res.json({ success: true, note: { ...n, teacher_name: t.name } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/bkk/teacher/today', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    try {
      const r = await q(
        `SELECT m.code, m.name, s.title, b.start_at, b.checked_in_at,
           (SELECT count(*)::int FROM bkk_notes n WHERE n.member_id=m.id) AS notes
         FROM bkk_bookings b
         JOIN bkk_members m ON m.id=b.member_id
         JOIN bkk_class_slots s ON s.id=b.slot_id
         WHERE b.status='booked'
           AND b.class_date = (now() AT TIME ZONE 'Asia/Bangkok')::date
         ORDER BY b.start_at, m.name`);
      res.json({ students: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── profile photos ────────────────────────────────────────────────────────
  // Chay (on a teacher passcode) uploads the day's photos and taps who is in
  // each one. Stored as Cloudinary "authenticated" assets: no plain URL works,
  // only signed ones, and those are handed out only to the tagged students.
  // Tiles show the whole photo (no crop: a 4:5 fill cut off heads and feet).
  // 'save' is a plain JPEG sent as a download: the WebP/AVIF that f_auto gives
  // Android can't be long-pressed into a Samsung gallery or out of LINE's browser.
  const PHOTO_SIZES = {
    thumb: { width: 600, height: 600, crop: 'limit', quality: 'auto', fetch_format: 'auto' },
    full: { width: 2048, height: 2048, crop: 'limit', quality: 'auto', fetch_format: 'auto' },
    save: { width: 2048, height: 2048, crop: 'limit', quality: 90, fetch_format: 'jpg', flags: 'attachment:AYBKK-photo' },
  };
  const photoUrl = (publicId, kind) => cloudinary.url(publicId, {
    type: 'authenticated', sign_url: true, secure: true, transformation: [PHOTO_SIZES[kind]],
  });
  const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
  // A code that no longer exists (the shala gave that profile a new one while
  // this page was open) stops the save: dropping it would silently untag a student.
  async function memberIds(codes) {
    const list = [...new Set((Array.isArray(codes) ? codes : []).map(String))].slice(0, 30);
    if (!list.length) return [];
    const rows = (await q('SELECT id, code FROM bkk_members WHERE code = ANY($1::text[])', [list])).rows;
    if (rows.length < list.length) {
      const e = new Error('A student on this photo has a new code. Reload the page and pick them again. Nothing was saved.');
      e.status = 409;
      throw e;
    }
    return rows.map(r => r.id);
  }
  async function photosWithTags(where, args) {
    const rows = (await q(
      `SELECT p.*, to_char(p.class_date, 'YYYY-MM-DD') AS day, coalesce(json_agg(json_build_object('code', m.code, 'name', m.name))
                FILTER (WHERE m.id IS NOT NULL), '[]') AS members
       FROM bkk_photos p
       LEFT JOIN bkk_photo_members pm ON pm.photo_id = p.id
       LEFT JOIN bkk_members m ON m.id = pm.member_id
       WHERE ${where} GROUP BY p.id ORDER BY p.id`, args)).rows;
    return rows.map(p => ({ id: p.id, date: p.day, members: p.members,
      thumb: photoUrl(p.public_id, 'thumb'), full: photoUrl(p.public_id, 'full'), save: photoUrl(p.public_id, 'save') }));
  }

  // Who Chay can tag: today's bookings first, then a name search, then a quick
  // add for someone not in the system yet (most students are still on Rezerv).
  app.get('/api/bkk/teacher/members', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    try {
      const term = String(req.query.q || '').trim().toLowerCase();
      if (term.length < 2) return res.json({ members: [] });
      const r = await q(
        `SELECT code, name, email FROM bkk_members
         WHERE lower(name) LIKE $1 OR lower(coalesce(email,'')) LIKE $1
         ORDER BY name LIMIT 20`, [`%${term}%`]);
      // Two people (or one person twice) can share a name; a hint of the email
      // tells them apart, without handing the team full addresses.
      const hint = e => e ? String(e).replace(/^(.{2})[^@]*(@.*)$/, '$1…$2') : '';
      res.json({ members: r.rows.map(m => ({ code: m.code, name: m.name, hint: hint(m.email) })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/bkk/teacher/members', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    try {
      const { name, email } = req.body || {};
      if (!String(name || '').trim()) return res.status(400).json({ error: 'name required' });
      if (!String(email || '').includes('@')) {
        return res.status(400).json({ error: 'email required: the student signs in with it to see their photos' });
      }
      const m = await findOrCreateMember({ name, email });
      res.json({ success: true, member: { code: m.code, name: m.name } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/bkk/teacher/photos', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    if (!cloudinary) return res.status(503).json({ error: 'photo storage not configured' });
    const date = isDate(req.query.date) ? req.query.date : ymd(bkkNow());
    try {
      res.json({ date, photos: await photosWithTags('p.class_date = $1', [date]) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/bkk/teacher/photos', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    if (!cloudinary) return res.status(503).json({ error: 'photo storage not configured' });
    try {
      const { date, image, memberCodes } = req.body || {};
      if (!isDate(date)) return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(String(image || ''))) {
        return res.status(400).json({ error: 'image must be a JPEG, PNG or WebP data URL' });
      }
      if (typeof cloudinary.config === 'function' && !cloudinary.config().api_secret) {
        return res.status(503).json({ error: 'Photo storage key is missing in Railway. Nothing was saved: tell Boonchu.' });
      }
      res.json({ success: true, photo: await storePhoto(t, date, image, memberCodes, null) });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // Cloudinary answers some refusals (403: plan limit reached, account paused)
  // with no readable message, so the team saw only "unexpected status code -
  // 403". Say what it means, with the plan usage when Cloudinary will tell us.
  async function cloudUpload(file, date) {
    try {
      return await cloudinary.uploader.upload(file, {
        type: 'authenticated', folder: `aybkk/profile/${date}`, resource_type: 'image',
        transformation: [{ width: 2048, height: 2048, crop: 'limit', quality: 'auto:good' }],
      });
    } catch (e) {
      const err = e && e.error ? e.error : e;
      if (err && err.http_code === 403) {
        let usage = '';
        try {
          const u = await cloudinary.api.usage();
          if (u && u.credits) usage = ` Cloudinary plan usage: ${u.credits.usage} of ${u.credits.limit} credits (${u.credits.used_percent}%).`;
        } catch (_) { /* usage is a bonus */ }
        throw new Error('Cloudinary refused to store the photo (403). Check cloudinary.com: Error Reports shows the reason (API key without upload rights, plan limit, or paused account).' + usage);
      }
      throw new Error((err && err.message) || String(e));
    }
  }

  async function storePhoto(t, date, image, memberCodes, driveId) {
    const ids = await memberIds(memberCodes);
    const up = await cloudUpload(image, date);
    const photo = (await q(
      `INSERT INTO bkk_photos (public_id,class_date,width,height,uploaded_by,drive_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [up.public_id, date, up.width || null, up.height || null, t.id, driveId])).rows[0];
    for (const id of ids) {
      await q('INSERT INTO bkk_photo_members (photo_id,member_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [photo.id, id]);
    }
    return (await photosWithTags('p.id = $1', [photo.id]))[0];
  }

  // ── photos straight from the Drive day folder (Boonchu, 5 Oct) ────────────
  // Chay's camera folder is "Daily Class Photos/Videos › photos › 3Oct26 …" and
  // is link-shared, so the server lists it through Drive's public folder view and
  // downloads files by id: no Google login, no file ever passes through a phone.
  // Only files listed in that day's folder can be imported, so this is not an
  // open proxy for any Drive file.
  const DRIVE_ROOT = process.env.DRIVE_PHOTOS_FOLDER || '10A--d5dX4cGrt9M4deNod-zzEDJP_R90';
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const IMG = /\.(jpe?g|png|webp|heic)$/i;
  const unent = s => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  async function driveList(folderId) {
    const r = await httpFetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}`,
      { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`Drive folder could not be read (${r.status}). Is it still shared by link?`);
    const html = await r.text();
    const out = [];
    const re = /class="flip-entry" id="entry-([\w-]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?class="flip-entry-title">([^<]*)</g;
    for (let m; (m = re.exec(html));) out.push({ id: m[1], name: unent(m[3]), folder: m[2].includes('/folders/') });
    return out;
  }
  // "3Oct26", "03 Oct 2026", "3October26" → 2026-10-03
  function folderDate(name) {
    const m = String(name).match(/^(\d{1,2})\s*([A-Za-z]{3})[A-Za-z]*\s*(\d{4}|\d{2})\b/);
    if (!m || !MON[m[2].toLowerCase()]) return null;
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${String(MON[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  // M picks the day folder himself from the "photos" folder (Boonchu, 5 Oct);
  // only folders directly inside it can be opened.
  const driveCache = new Map();          // folder id -> { at, files }
  async function driveFolders() {
    const days = (await driveList(DRIVE_ROOT)).filter(e => e.folder).map(e => ({ id: e.id, name: e.name, date: folderDate(e.name) }));
    return days.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.name.localeCompare(b.name));
  }
  async function driveFolder(folderId, fresh) {
    const hit = driveCache.get(folderId);
    if (hit && !fresh && Date.now() - hit.at < 10 * 60e3) return hit.files;
    if (!(await driveFolders()).some(d => d.id === folderId)) throw Object.assign(new Error('That folder is not inside the Drive "photos" folder.'), { status: 400 });
    const files = [];
    for (const e of await driveList(folderId)) {
      if (e.folder) {          // one level down: "3Oct26LedP" and the like
        for (const f of await driveList(e.id)) if (!f.folder && IMG.test(f.name)) files.push({ ...f, sub: e.name });
      } else if (IMG.test(e.name)) files.push(e);
    }
    files.sort((a, b) => (a.sub || '').localeCompare(b.sub || '') || a.name.localeCompare(b.name, undefined, { numeric: true }));
    driveCache.set(folderId, { at: Date.now(), files });
    return files;
  }
  const sniff = b => b[0] === 0xFF && b[1] === 0xD8 ? 'image/jpeg'
    : b[0] === 0x89 && b[1] === 0x50 ? 'image/png'
    : b.subarray(0, 4).toString('latin1') === 'RIFF' ? 'image/webp'
    : b.subarray(4, 8).toString('latin1') === 'ftyp' ? 'image/heic' : null;

  app.get('/api/bkk/teacher/drive/folders', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    try { res.json({ folders: await driveFolders() }); }
    catch (e) { res.status(502).json({ error: e.message }); }
  });

  app.get('/api/bkk/teacher/drive', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    try {
      const files = await driveFolder(String(req.query.folder || ''), req.query.fresh === '1');
      // tagged: how many people are on it, so the page can grey a done photo from any class date.
      const done = files.length ? (await q(`SELECT p.id, p.drive_id, count(pm.member_id)::int AS tagged
          FROM bkk_photos p LEFT JOIN bkk_photo_members pm ON pm.photo_id = p.id
          WHERE p.drive_id = ANY($1) GROUP BY p.id`, [files.map(f => f.id)])).rows : [];
      const byDrive = new Map(done.map(r => [r.drive_id, r]));
      res.json({ files: files.map(f => {
        const d = byDrive.get(f.id);
        return { id: f.id, name: f.name, sub: f.sub || '', photoId: d ? d.id : null, tagged: d ? d.tagged : 0 };
      }) });
    } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
  });

  app.post('/api/bkk/teacher/photos/from-drive', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    if (!cloudinary) return res.status(503).json({ error: 'photo storage not configured' });
    try {
      const { date, folder, driveId, memberCodes, add } = req.body || {};
      if (!isDate(date)) return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });
      if (!(await driveFolder(String(folder || ''))).some(f => f.id === driveId)) {
        return res.status(400).json({ error: 'That file is not in the chosen Drive folder.' });
      }
      const had = (await q('SELECT id FROM bkk_photos WHERE drive_id=$1', [driveId])).rows[0];
      if (had) {               // already in: set who is in it (add: keep who is there)
        const ids = await memberIds(memberCodes);
        if (!add) await q('DELETE FROM bkk_photo_members WHERE photo_id=$1', [had.id]);
        for (const id of ids) {
          await q('INSERT INTO bkk_photo_members (photo_id,member_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [had.id, id]);
        }
        return res.json({ success: true, photo: (await photosWithTags('p.id = $1', [had.id]))[0] });
      }
      if (typeof cloudinary.config === 'function' && !cloudinary.config().api_secret) {
        return res.status(503).json({ error: 'Photo storage key is missing in Railway. Nothing was saved: tell Boonchu.' });
      }
      // Ask Drive for a 2048px copy (about 0.5 MB, the size we keep anyway) rather
      // than the 5 MB camera original: smaller to send and store. Original if that fails.
      const grab = async url => {
        const r = await httpFetch(url, { signal: AbortSignal.timeout(60000) });
        const b = Buffer.from(await r.arrayBuffer());
        return r.ok && sniff(b) ? b : null;
      };
      const id = encodeURIComponent(driveId);
      const buf = await grab(`https://drive.google.com/thumbnail?id=${id}&sz=s2048`)
        || await grab(`https://drive.google.com/uc?export=download&id=${id}`);
      const type = buf && sniff(buf);
      if (!type) return res.status(502).json({ error: 'Drive did not send a photo. Is the folder still shared by link?' });
      const photo = await storePhoto(t, date, `data:${type};base64,${buf.toString('base64')}`, memberCodes, driveId);
      res.json({ success: true, photo });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // Replace who is in a photo.
  app.post('/api/bkk/teacher/photos/:id/tags', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    if (!cloudinary) return res.status(503).json({ error: 'photo storage not configured' });
    try {
      const p = (await q('SELECT id FROM bkk_photos WHERE id=$1', [req.params.id])).rows[0];
      if (!p) return res.status(404).json({ error: 'photo not found' });
      const ids = await memberIds((req.body || {}).memberCodes);
      await q('DELETE FROM bkk_photo_members WHERE photo_id=$1', [p.id]);
      for (const id of ids) {
        await q('INSERT INTO bkk_photo_members (photo_id,member_id) VALUES ($1,$2)', [p.id, id]);
      }
      res.json({ success: true, photo: (await photosWithTags('p.id = $1', [p.id]))[0] });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // Pick many photos of one person, then the name once (Boonchu, 8 Oct): the
  // name is ADDED to each photo, so other people already on a photo stay.
  app.post('/api/bkk/teacher/photos/tags/add', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    try {
      const b = req.body || {};
      const photoIds = [...new Set((Array.isArray(b.photoIds) ? b.photoIds : []).map(Number))]
        .filter(n => Number.isInteger(n) && n > 0);
      if (!photoIds.length || photoIds.length > 200) return res.status(400).json({ error: 'choose 1 to 200 photos' });
      const ids = await memberIds(b.memberCodes);
      if (!ids.length) return res.status(400).json({ error: 'choose who is in them' });
      const found = (await q('SELECT id FROM bkk_photos WHERE id = ANY($1::int[])', [photoIds])).rows.map(r => r.id);
      if (found.length < photoIds.length) return res.status(409).json({ error: 'A photo was deleted meanwhile. Reload the page.' });
      await q(`INSERT INTO bkk_photo_members (photo_id, member_id)
               SELECT p, m FROM unnest($1::int[]) p CROSS JOIN unnest($2::int[]) m
               ON CONFLICT DO NOTHING`, [photoIds, ids]);
      res.json({ success: true, photos: await photosWithTags('p.id = ANY($1::int[])', [photoIds]) });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.post('/api/bkk/teacher/photos/:id/delete', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    if (!cloudinary) return res.status(503).json({ error: 'photo storage not configured' });
    try {
      const p = (await q('DELETE FROM bkk_photos WHERE id=$1 RETURNING public_id', [req.params.id])).rows[0];
      if (!p) return res.status(404).json({ error: 'photo not found' });
      await cloudinary.uploader.destroy(p.public_id, { type: 'authenticated', invalidate: true }).catch(() => {});
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // A student's own photos, newest day first. The member code is what the
  // signed-in browser already holds; nobody else's photos can come back here.
  app.get('/api/bkk/me/:code/photos', async (req, res) => {
    if (!cloudinary) return res.json({ days: [] });
    try {
      const m = (await q('SELECT id FROM bkk_members WHERE code=$1', [req.params.code])).rows[0];
      if (!m) return res.status(404).json({ error: 'not found' });
      const photos = await photosWithTags(
        'p.id IN (SELECT photo_id FROM bkk_photo_members WHERE member_id = $1)', [m.id]);
      const byDay = new Map();
      for (const ph of photos.reverse()) {
        if (!byDay.has(ph.date)) byDay.set(ph.date, []);
        byDay.get(ph.date).push({ id: ph.id, thumb: ph.thumb, full: ph.full, save: ph.save });
      }
      res.json({ days: [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]))
        .map(([date, items]) => ({ date, items })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Admin manages who is on the team. Passcodes are shown once, at creation —
  // they are stored hashed, so a forgotten one is reset, never recovered.
  // Admin may type one instead of taking a random one (Boonchu, 2 Oct): at least
  // 8 characters, and never one someone else on the team already uses, since
  // teacherFrom() finds a person by passcode alone.
  async function choosePasscode(wanted, exceptId) {
    if (wanted == null || String(wanted).trim() === '') {
      return { passcode: crypto.randomBytes(6).toString('base64url') };
    }
    const pc = String(wanted).trim();
    if (pc.length < 8) return { error: 'passcode must be at least 8 characters' };
    const taken = await q('SELECT 1 FROM bkk_teachers WHERE key_hash=$1 AND id <> $2',
      [hashKey(pc), exceptId || 0]);
    if (taken.rows.length) return { error: 'someone on the team already uses that passcode' };
    return { passcode: pc };
  }
  app.get('/api/bkk/admin/teachers', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const r = await q('SELECT id,name,email,active,created_at FROM bkk_teachers ORDER BY name');
      res.json({ teachers: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/bkk/admin/teachers', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const { id, name, email, active } = req.body || {};
      if (id) {
        const r = await q(
          `UPDATE bkk_teachers SET name=COALESCE($2,name), email=COALESCE($3,email),
             active=COALESCE($4,active) WHERE id=$1 RETURNING id,name,email,active`,
          [id, name ?? null, email ?? null, active != null ? !!active : null]);
        if (!r.rows.length) return res.status(404).json({ error: 'not found' });
        return res.json({ success: true, teacher: r.rows[0] });
      }
      if (!String(name || '').trim()) return res.status(400).json({ error: 'name required' });
      const { passcode, error } = await choosePasscode((req.body || {}).passcode);
      if (error) return res.status(400).json({ error });
      const r = await q(
        `INSERT INTO bkk_teachers (name,email,key_hash) VALUES ($1,$2,$3)
         RETURNING id,name,email,active`,
        [String(name).trim(), email || null, hashKey(passcode)]);
      res.json({ success: true, teacher: r.rows[0], passcode,
        note: 'Give this passcode to them now — it cannot be shown again.' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/bkk/admin/teachers/:id/reset', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const { passcode, error } = await choosePasscode((req.body || {}).passcode, Number(req.params.id));
      if (error) return res.status(400).json({ error });
      const r = await q('UPDATE bkk_teachers SET key_hash=$2 WHERE id=$1 RETURNING name',
        [req.params.id, hashKey(passcode)]);
      if (!r.rows.length) return res.status(404).json({ error: 'not found' });
      res.json({ success: true, name: r.rows[0].name, passcode });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Packages. price_thb and active were read but never written, so changing a
  // price or retiring a package meant SQL against production.
  app.post('/api/bkk/admin/products', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const b = req.body || {};
      const code = String(b.code || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (!code) return res.status(400).json({ error: 'code required' });
      const existing = (await q('SELECT * FROM bkk_products WHERE code=$1', [code])).rows[0];

      if (existing) {
        // Only what was sent — an omitted field must not blank an existing one.
        const r = await q(
          `UPDATE bkk_products SET
             name_en   = COALESCE($2, name_en),
             name_th   = COALESCE($3, name_th),
             price_thb = COALESCE($4, price_thb),
             active    = COALESCE($5, active),
             sort      = COALESCE($6, sort)
           WHERE code=$1 RETURNING *`,
          [code, b.nameEn ?? null, b.nameTh ?? null,
           b.priceThb != null ? Math.max(0, parseInt(b.priceThb)) : null,
           b.active != null ? !!b.active : null,
           b.sort != null ? parseInt(b.sort) : null]);
        return res.json({ success: true, product: r.rows[0], created: false });
      }

      // kind/credits/valid_days define what the pass DOES, so they are required
      // on creation and deliberately not editable afterwards — changing them
      // under passes already sold would silently rewrite what people bought.
      const kind = ['credits', 'unlimited'].includes(b.kind) ? b.kind : null;
      const validDays = parseInt(b.validDays);
      if (!kind || !b.nameEn || !(validDays > 0) || b.priceThb == null) {
        return res.status(400).json({
          error: 'new package needs nameEn, kind (credits|unlimited), priceThb and validDays' });
      }
      const r = await q(
        `INSERT INTO bkk_products (code,name_en,name_th,price_thb,kind,credits,valid_days,daily_cap,sort,active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true) RETURNING *`,
        [code, b.nameEn, b.nameTh || null, Math.max(0, parseInt(b.priceThb)), kind,
         kind === 'credits' ? Math.max(1, parseInt(b.credits) || 1) : null,
         validDays,
         b.dailyCap != null ? parseInt(b.dailyCap) : (kind === 'unlimited' ? 2 : null),
         b.sort != null ? parseInt(b.sort) : 100]);
      res.json({ success: true, product: r.rows[0], created: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Close a class — moon day, Songkran, illness, travel.
  // Until now the overrides table was read but never written, so a cancelled
  // class was impossible to express AND every booked student silently lost the
  // credit they had spent on a class that would not run.
  app.post('/api/bkk/admin/classes/cancel', async (req, res) => {
    if (adminOnly(req, res)) return;
    const { slotId, date, reason } = req.body || {};
    if (!slotId || !date) return res.status(400).json({ error: 'slotId and date required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO bkk_class_overrides (slot_id,class_date,cancelled,note)
         VALUES ($1,$2,true,$3)
         ON CONFLICT (slot_id,class_date) DO UPDATE SET cancelled=true, note=EXCLUDED.note`,
        [slotId, date, String(reason || '').slice(0, 200) || null]);

      const hit = (await client.query(
        `UPDATE bkk_bookings SET status='cancelled', cancelled_at=now(),
           cancel_reason=$3
         WHERE slot_id=$1 AND class_date=$2 AND status='booked'
         RETURNING id, member_id, pass_id`,
        [slotId, date, `class cancelled: ${reason || 'no reason given'}`])).rows;

      // The shala cancelled, not the student — the credit always comes back,
      // whatever the notice period was.
      for (const b of hit) {
        if (b.pass_id) {
          await client.query(
            `UPDATE bkk_passes SET credits_used = GREATEST(0, credits_used - 1)
             WHERE id=$1 AND kind <> 'unlimited'`, [b.pass_id]);
        }
      }
      await client.query('COMMIT');

      const people = hit.length ? (await q(
        `SELECT m.name, m.email, m.lang, s.title, s.start_time
         FROM bkk_members m, bkk_class_slots s
         WHERE m.id = ANY($1::int[]) AND s.id = $2`,
        [hit.map(b => b.member_id), slotId])).rows : [];
      for (const p of people) {
        if (!p.email) continue;
        const t = render('classCancelled', p.lang || 'en',
          { name: p.name, className: p.title, date, time: p.start_time, reason });
        sendMail({ to: p.email, subject: t.subject, html: t.html, text: t.text, tag: 'cancelled' })
          .catch(e => console.error('[bkk] cancel mail failed:', e.message));
      }
      console.log(`✓ bkk: class ${slotId} on ${date} cancelled — ${hit.length} booking(s) released`);
      res.json({ success: true, released: hit.length, notified: people.filter(p => p.email).length });
    } catch (e) {
      await client.query('ROLLBACK'); res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  app.post('/api/bkk/admin/classes/reopen', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const { slotId, date } = req.body || {};
      if (!slotId || !date) return res.status(400).json({ error: 'slotId and date required' });
      // Bookings are NOT restored: the students were told it was off, and some
      // will have made other plans. They rebook, with their credit back.
      await q(`UPDATE bkk_class_overrides SET cancelled=false
               WHERE slot_id=$1 AND class_date=$2`, [slotId, date]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── the class calendar (admin) ───────────────────────────────────────────
  // Every class over a stretch of days with its counts, past ones included:
  // the timetable as generated (moon days off), a closed class kept so staff
  // can see it and reopen it, and any class with names on it, even one no
  // longer run or on a moon day, so history never drops off the calendar.
  // A Rezerv class moved over with no slot is one read-only class per
  // (day, title, start time). key is what the page sends back for one class.
  const CAL_TIME = `to_char(b.start_at AT TIME ZONE 'Asia/Bangkok','HH24:MI')`;
  const bkkISO = ms => new Date(ms + 7 * 3600000).toISOString().slice(0, 16) + ':00' + TZ_OFFSET;
  function calClass({ slot, date, ov, n = {}, time, title }) {
    const counts = { booked: n.booked || 0, checkedIn: n.checkedIn || 0, noShows: n.noShows || 0 };
    if (!slot) {
      // The import stores a Rezerv visit with no time at 00:00 (VISIT_TIME):
      // the key keeps it, so the class still opens by time=00:00.
      return { key: `x:${date}:${time}:${title}`, slotId: null, date, startAt: startAtISO(date, time),
        timeKnown: time !== '00:00', title,
        kind: null, teachers: '', durationMin: null, isOnline: /online|zoom|ออนไลน์/i.test(title), capacity: null,
        ...counts, cancelled: false, note: null };
    }
    const cancelled = !!(ov && ov.cancelled);
    return { key: `s:${slot.id}:${date}`, slotId: slot.id, date, startAt: startAtISO(date, slot.start_time), timeKnown: true,
      title: slot.title, kind: slot.kind, teachers: rotationTeacher(slot.code, date) || slot.teachers || '',
      durationMin: slot.duration_min, isOnline: slot.is_online,
      // ?? not || — an override capacity of 0 ("closed today") is a real value.
      capacity: ov && ov.capacity != null ? ov.capacity : slot.capacity,
      ...counts, cancelled, note: cancelled ? ov.note : null };
  }

  app.get('/api/bkk/admin/calendar', async (req, res) => {
    if (adminOnly(req, res)) return;
    const r = dayRange(req.query, { required: true, maxDays: SCHEDULE_DAYS });
    if (r.error) return res.status(400).json({ error: r.error });
    const { from, to } = r;
    try {
      const [slots, ovs, counts] = await Promise.all([
        q('SELECT * FROM bkk_class_slots'),
        q(`SELECT slot_id, to_char(class_date,'YYYY-MM-DD') AS date, cancelled, capacity, note
           FROM bkk_class_overrides WHERE class_date BETWEEN $1::date AND $2::date`, [from, to]),
        q(`SELECT b.slot_id, to_char(b.class_date,'YYYY-MM-DD') AS date,
             CASE WHEN b.slot_id IS NULL THEN coalesce(b.class_title,'') END AS title,
             CASE WHEN b.slot_id IS NULL THEN ${CAL_TIME} END AS time,
             count(*) FILTER (WHERE b.status='booked')::int AS booked,
             count(*) FILTER (WHERE b.status='booked' AND b.checked_in_at IS NOT NULL)::int AS checked_in,
             count(*) FILTER (WHERE b.status='noshow')::int AS no_shows
           FROM bkk_bookings b
           WHERE b.class_date BETWEEN $1::date AND $2::date AND b.status IN ('booked','noshow')
           GROUP BY 1, 2, 3, 4`, [from, to]),
      ]);
      const slotById = new Map(slots.rows.map(s => [s.id, s]));
      const ovOf = new Map(ovs.rows.map(o => [`${o.slot_id}:${o.date}`, o]));
      const moon = moonDaysBetween(from, to);
      const found = new Map(), out = [];
      for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += 86400000) {
        const date = new Date(t).toISOString().slice(0, 10);
        if (moon.has(date)) continue;
        const wd = new Date(t).getUTCDay();
        for (const s of slots.rows) if (s.active && s.weekday === wd) found.set(`${s.id}:${date}`, { slot: s, date });
      }
      for (const row of counts.rows) {
        const n = { booked: row.booked, checkedIn: row.checked_in, noShows: row.no_shows };
        if (row.slot_id == null) { out.push(calClass({ date: row.date, time: row.time, title: row.title, n })); continue; }
        if (!slotById.has(row.slot_id)) continue;
        found.set(`${row.slot_id}:${row.date}`, { slot: slotById.get(row.slot_id), date: row.date, n });
      }
      for (const [k, c] of found) out.push(calClass({ ...c, ov: ovOf.get(k) }));
      // A class with no time on file goes last in its day, not first at 00:00.
      out.sort((a, b) => a.date.localeCompare(b.date) || (a.timeKnown ? 0 : 1) - (b.timeKnown ? 0 : 1)
        || a.startAt.localeCompare(b.startAt) || (a.isOnline - b.isOnline) || a.title.localeCompare(b.title));
      res.json({ from, to, today: bkkToday(), moonDays: Object.fromEntries(moon), classes: out });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Inside one class: ?slotId=&date=, or ?date=&time=&title= for a slotless
  // class moved over from Rezerv. No email, phone or birthday on the roster.
  app.get('/api/bkk/admin/class', async (req, res) => {
    if (adminOnly(req, res)) return;
    const { slotId, date } = req.query;
    const bySlot = slotId != null && slotId !== '';
    const time = String(req.query.time || ''), title = String(req.query.title || '');
    if (!realYmd(date)) return res.status(400).json({ error: 'date must be a date (YYYY-MM-DD)' });
    if (bySlot ? !/^\d{1,9}$/.test(String(slotId)) : !/^\d{2}:\d{2}$/.test(time))
      return res.status(400).json({ error: 'slotId, or time (HH:MM) and title, needed' });
    try {
      let slot = null, ov = null;
      if (bySlot) {
        slot = (await q('SELECT * FROM bkk_class_slots WHERE id=$1', [Number(slotId)])).rows[0];
        if (!slot) return res.status(404).json({ error: 'class not found' });
        ov = (await q('SELECT * FROM bkk_class_overrides WHERE slot_id=$1 AND class_date=$2::date', [slot.id, date])).rows[0];
      }
      const rows = (await q(
        `SELECT b.id, b.status, b.checked_in_at, b.booked_at, b.cancelled_at, b.cancel_reason, b.cover, b.source,
           m.code, m.name, pr.name_en AS pass_name, coalesce(pr.kind = 'credits' AND pr.credits = 1, false) AS dropin
         FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id
         LEFT JOIN bkk_passes p ON p.id=b.pass_id LEFT JOIN bkk_products pr ON pr.id=p.product_id
         WHERE b.class_date=$1::date AND ${bySlot ? 'b.slot_id=$2'
           : `b.slot_id IS NULL AND ${CAL_TIME}=$2 AND coalesce(b.class_title,'')=$3`}`,
        bySlot ? [date, slot.id] : [date, time, title])).rows;
      if (!bySlot && !rows.length) return res.status(404).json({ error: 'class not found' });
      const live = rows.filter(b => b.status === 'booked' || b.status === 'noshow');
      // Another weekday's slot is not a class on this day, unless names are
      // already on it: then it is history and is shown.
      const offDay = slot && new Date(`${date}T12:00:00Z`).getUTCDay() !== slot.weekday;
      if (offDay && !live.length) return res.status(400).json({ error: 'that class is not on that day' });
      const c = calClass({ slot, date, ov, time, title, n: {
        booked: live.filter(b => b.status === 'booked').length,
        checkedIn: live.filter(b => b.status === 'booked' && b.checked_in_at).length,
        noShows: live.filter(b => b.status === 'noshow').length } });
      const startMs = Date.parse(c.startAt), now = bkkNow().getTime();
      const dur = slot ? (slot.duration_min || 120) : null;
      const started = now >= startMs;
      // classCheck's staff rule: a name can go on the list until the class ends.
      // A slotless class only exists as Rezerv history, so it is over once begun.
      const ended = slot ? (now - startMs) / 60000 > dur : started;
      const canAdd = !!slot && slot.active && !offDay && !c.cancelled && !ended && !moonDaysBetween(date, date).size;
      res.json({
        class: { ...c, endAt: slot ? bkkISO(startMs + dur * 60000) : null, started, ended, canAdd },
        roster: live.map(b => ({ bookingId: b.id, code: b.code, name: b.name, status: b.status,
          checkedInAt: b.checked_in_at, bookedAt: b.booked_at, cover: b.cover, source: b.source,
          passName: b.pass_name, dropin: b.dropin }))
          .sort((a, b) => String(a.name).localeCompare(String(b.name)) || a.bookingId - b.bookingId),
        cancelledList: rows.filter(b => b.status === 'cancelled')
          .sort((a, b) => (b.cancelled_at || 0) - (a.cancelled_at || 0) || b.id - a.id)
          .map(b => ({ code: b.code, name: b.name, cancelledAt: b.cancelled_at, reason: b.cancel_reason })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Check one name in from inside a class, or undo it. A class that has ended
  // is checked in at its start (as the Rezerv import does; Boonchu, 30 Oct: a
  // tap at 19:33 must not read "In 19:33" for a 05:30 class), a no-show seen
  // after all becomes a visit, and a class not reached yet cannot be: nobody
  // is in the room. Pass credits are never touched here.
  app.post('/api/bkk/admin/bookings/:id/checkin', async (req, res) => {
    if (adminOnly(req, res)) return;
    if (!/^\d{1,9}$/.test(req.params.id)) return res.status(404).json({ error: 'booking not found' });
    const undo = (req.body || {}).undo === true;
    try {
      const b = (await q(`SELECT id, slot_id, status, to_char(class_date,'YYYY-MM-DD') AS date FROM bkk_bookings WHERE id=$1`,
        [Number(req.params.id)])).rows[0];
      if (!b) return res.status(404).json({ error: 'booking not found' });
      if (b.slot_id == null) return res.status(409).json({ error: REZERV_READONLY });
      if (b.status === 'cancelled') return res.status(409).json({ error: 'that booking was cancelled' });
      const today = bkkToday();
      if (!undo && b.date > today) return res.status(409).json({ error: 'that class is not today yet' });
      const r = (await q(undo
        ? `UPDATE bkk_bookings SET checked_in_at=NULL
           WHERE id=$1 AND status IN ('booked','noshow') RETURNING id, status, checked_in_at`
        : `UPDATE bkk_bookings b SET status='booked',
             checked_in_at=COALESCE(b.checked_in_at, CASE WHEN b.class_date < $2::date
               OR now() > b.start_at + make_interval(mins => s.duration_min) THEN b.start_at ELSE now() END)
           FROM bkk_class_slots s
           WHERE b.id=$1 AND s.id=b.slot_id AND b.status IN ('booked','noshow')
           RETURNING b.id, b.status, b.checked_in_at`,
        undo ? [b.id] : [b.id, today])).rows[0];
      if (!r) return res.status(409).json({ error: 'that booking was cancelled' });
      res.json({ success: true, booking: { id: r.id, status: r.status, checkedInAt: r.checked_in_at } });
    } catch (e) {
      // A no-show whose student is on the same class again (booked twice in Rezerv).
      if (/duplicate key/.test(e.message)) return res.status(409).json({ error: 'already on this class list' });
      res.status(500).json({ error: e.message });
    }
  });

  initSchema()
    .then(() => { console.log('✓ bkk-api mounted (/api/bkk/*)'); letterPurge(); })
    .catch(e => console.error('✗ bkk-api schema init failed:', e.message));
}

// PaySolutions posts application/x-www-form-urlencoded; make sure that body is
// parsed even though the app defaults to JSON.
const express = require('express');
const express_urlencoded_safe = express.urlencoded({ extended: false });

module.exports = { mountBkk, CANCEL_CUTOFF_HOURS, SEED_PRODUCTS, SEED_SLOTS, moonDaysBetween, rotationTeacher, parseWhen };
