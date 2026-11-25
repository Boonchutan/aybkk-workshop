// idcn-api.js — AYBKK In-Depth Mysore courses (idcn3 first: Chinese Generation #3).
//
// Mount:  mountIdcn(app, { pgPool, bkk })   bkk: what mountBkk resolves to (a promise
//         is fine), for making an AYBKK profile or a staff sign-in link; optional
//
// One app from invitation to completion:
//   - each student has a named link  /idcn3/<slug>  behind a per-person passcode
//   - they confirm their spot IN the app: choose a payment option, read the
//     bilingual course policy, tick every consent, type their name — recorded
//     with timestamp and policy version, append-only, never editable
//   - Boonchu/Jamsai (admin key) upload payment screenshots to the profile as
//     transaction proof; the student always sees their own money state
//   - course photo hub with student upload (idc_hub_photos; Cloudinary, tag aybkk-<course>,
//     before R2)
//   - course files (hub photos, hand-ins, notes, payment screenshots) in Cloudflare R2
//     when the four R2_* variables are set, served signed under /md (lib/media-store.js);
//     without them Cloudinary as before
//   - syllabus links editable in the admin, journal links to the existing system
//
// Money: THB satang integers, never floats. Discounts stack multiplicatively
// (Boonchu's decision 9 Sep 2026): option discount first, then attendee 3% on
// the discounted price. Every idcn3 combination lands on exact satang; the
// fractional-satang guard floors toward the student and is pinned by tests.
//
// Terms follow the signature. A student who signed keeps the terms of the
// policy version they signed, forever; a student who has not signed sees the
// current version. Policies v1 to v3 were all signed against IDCN3_TERMS (kept
// in idc_courses.terms); v4 (3 Nov 2026) is IDCN3_TERMS_V4. Each version past
// v3 gets its own literal entry in TERMS_BY_POLICY.

const crypto = require('crypto');
const media = require('./lib/media-store');

const SATANG = 100;
// bumped whenever the policy text in public/idcn.html changes, so every
// signature records exactly which wording was on screen. A new version needs
// its own entry in TERMS_BY_POLICY (the module refuses to load without one).
const IDCN3_POLICY_VERSION = 'idcn3-v4';
const sha = k => crypto.createHash('sha256').update(String(k)).digest('hex');
const newPasscode = () => crypto.randomBytes(6).toString('base64url');

// option pct and deadline live in the course terms so future generations can
// differ without code changes
const IDCN3_TERMS = {
  feeSatang: 199000 * SATANG,
  attendeePct: 3,                       // extra AYBKK-attendee discount, %
  options: {
    1: { pct: 10, due: '2026-09-10', label_en: '100% by 10 Sep 2026', label_zh: '9月10日前全额支付' },
    2: { pct: 5, due: '2026-09-16', label_en: '100% by 16 Sep 2026', label_zh: '9月16日前全额支付' },
    3: {
      pct: 0, due: '2026-09-20', depositPct: 60,
      cashDue: '2027-01-10',
      label_en: '60% by 20 Sep 2026 + 40% THB cash on 10 Jan 2027 at AYBKK',
      label_zh: '9月20日前支付60% + 2027年1月10日在AYBKK以泰铢现金支付40%',
    },
  },
  // rescheduled 19 Sep 2026: one continuous 30-day block
  sessions: [
    { dates: '11 Jan – 9 Feb 2027 (30 days)',
      place_en: 'AYBKK Shala, Bangkok & Khaoyaithieng, Thailand',
      place_zh: '泰国曼谷 AYBKK 及 Khaoyaithieng' },
  ],
  confirmBy: '2026-09-10',
};

// Boonchu, 2-3 Nov 2026: 180,000 THB plus 7% VAT, the same for every v4 signer
// (no option or attendee discounts). Option keys carry on from v3's 1 to 3, so an
// option set under v3 for someone who never signed can't turn into a v4 plan
// with a different meaning. Option C is a plan agreed on the call, stored per
// student in idc_students.custom_plan.
const IDCN3_TERMS_V4 = {
  name_en: 'In-Depth Mysore: the development of the practice · Generation #3',
  name_zh: '深度迈索尔课程：练习的发展 · 第三期',
  netSatang: 180000 * SATANG,
  vatPct: 7,
  options: {
    4: { code: 'A', plan: [{ pct: 100, due: '2026-12-10' }],
      label_en: 'Pay in full', label_zh: '一次付清' },
    5: { code: 'B', plan: [{ pct: 50, due: '2026-12-10' }, { pct: 50, due: '2027-01-10' }],
      label_en: 'Two payments', label_zh: '分两次付款' },
    6: { code: 'C', custom: true,
      label_en: 'A plan agreed with AYBKK', label_zh: '与 AYBKK 约定的付款计划' },
  },
  sessions: [
    { dates: '11 Jan to 9 Feb 2027 (30 days)', dates_zh: '2027年1月11日至2月9日（30天）',
      place_en: 'AYBKK Shala, Bangkok & Khaoyaithieng, Thailand',
      place_zh: '泰国曼谷 AYBKK 及 Khaoyaithieng' },
  ],
  confirmBy: '2026-12-10',
  facts: [
    { en: 'Taught by Boonchu Tanti and Jamsai, both Authorized Level 2 by R. Sharath Jois.',
      zh: '由 Boonchu Tanti 与 Jamsai 授课，两位均获 R. Sharath Jois 授权 Level 2。' },
    { en: 'Taught in English, with Chinese translation in class.',
      zh: '英语授课，课堂上有中文翻译。' },
    { en: 'A group of 12 at most.', zh: '每期不超过 12 人。' },
  ],
};

// Literal keys: a signature stays on its version's terms when a later wording
// fix bumps IDCN3_POLICY_VERSION. Any version without its own entry (v1 to v3)
// was signed against the course's stored terms (IDCN3_TERMS for idcn3).
const TERMS_BY_POLICY = { 'idcn3-v4': IDCN3_TERMS_V4 };
if (!TERMS_BY_POLICY[IDCN3_POLICY_VERSION])
  throw new Error(`idcn-api: policy ${IDCN3_POLICY_VERSION} has no entry in TERMS_BY_POLICY`);
const termsFor = (course, version) => TERMS_BY_POLICY[version] || course.terms;

// The version a new signature records comes from the code, not from the
// idc_courses row: during a deploy the old instance still serves its own
// wording and stamps what it reads from that row, so the row must keep naming
// the old wording until the old instance is gone.
const CURRENT_POLICY = { idcn3: IDCN3_POLICY_VERSION };
const currentVersion = course => CURRENT_POLICY[course.code] || course.policy_version;

// What staff and students call the group; the code stays the one in links and tables.
const COURSE_LABEL = { idcn3: 'IDCN#3' };
const courseLabel = code => COURSE_LABEL[code] || String(code).toUpperCase();
const ymd = v => v == null ? null : v instanceof Date
  ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  : String(v).slice(0, 10);
const realYmd = v => {
  const s = String(v || ''), t = new Date(s + 'T00:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(t) && t.toISOString().slice(0, 10) === s;
};
// a staff label such as "IDCN #1 alum": words only, never money
const COHORT_NOTE_MAX = 80;
const noteError = v => {
  const s = String(v || '').trim();
  if (s.length > COHORT_NOTE_MAX) return `the note holds at most ${COHORT_NOTE_MAX} characters`;
  if (/[฿$¥€]|元|铢|\b(thb|baht|rmb|cny|yuan|usd|satang)\b|\d{1,3}(,\d{3})+|\d{5,}/i.test(s))
    return 'the note is a few words such as "IDCN #1 alum", never an amount';
  return null;
};

// ── the course calendar ─────────────────────────────────────────────────────
// Course material, so it lives in the database (pasted in the admin), never in
// this public repo. Read as pasted: Boonchu's markdown table, tab rows from a
// spreadsheet, or ' | ' rows without the outer pipes. Text around the table is
// ignored, except a line that gives a slot's time ("Slot A is 10:30-12:30.").
// A slot cell that starts with "#N" or "SN" is teaching session N; the morning
// column never is (morning practice is not a session).
const CAL_CELL_MAX = 300;
const CAL_MAX_DAY = 60;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december'];
const ZH_WEEKDAY = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
const DEFAULT_COLUMNS = ['day', 'date', 'weekday', 'morning', 'slotA', 'slotB', 'note'];
const COLUMN_NAMES = { day: 'Day no.', date: 'Date', weekday: 'Day', morning: 'Morning class',
  slotA: 'Slot A', slotB: 'Slot B', note: 'Note' };

class CalError extends Error {
  constructor(msg, line) { super(msg); this.line = line == null ? null : line; }
}
const isoDate = (y, m, d) => {
  const t = new Date(Date.UTC(+y, +m - 1, +d));
  return t.getUTCFullYear() === +y && t.getUTCMonth() === +m - 1 && t.getUTCDate() === +d
    ? t.toISOString().slice(0, 10) : null;
};
const monthNo = w => {
  const s = String(w).toLowerCase();
  const i = s.length >= 3 ? MONTHS.findIndex(n => n.startsWith(s) || (s === 'sept' && n === 'september')) : -1;
  return i < 0 ? null : i + 1;
};
// "11 Jan 2027", "Jan 11, 2027", "2027-01-11", "11/1/2027" (D/M/YYYY), "2027年1月11日"
function calDate(v) {
  const s = String(v == null ? '' : v).trim().replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, '');
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return isoDate(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/))) return isoDate(m[3], m[2], m[1]);
  if ((m = s.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?$/))) return isoDate(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{4})$/)) && monthNo(m[2]))
    return isoDate(m[3], monthNo(m[2]), m[1]);
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/)) && monthNo(m[1]))
    return isoDate(m[3], monthNo(m[1]), m[2]);
  return null;
}
function weekdayIndex(v) {
  const s = String(v || '').trim().toLowerCase().replace(/\.$/, '');
  if (/^[a-z]{3,9}$/.test(s)) {
    const i = WEEKDAYS.findIndex(w => s.startsWith(w.toLowerCase()));
    if (i >= 0) return i;
  }
  const m = s.match(/^(?:周|星期|礼拜)([日天一二三四五六])$/);
  return m ? ZH_WEEKDAY[m[1]] : -1;
}
const TIME_RANGE = /(\d{1,2})[:.](\d{2})\s*(?:-|–|—|~|to|至|到)\s*(\d{1,2})[:.](\d{2})/i;
function timeRange(v) {
  const m = String(v || '').match(TIME_RANGE);
  if (!m || +m[1] > 23 || +m[2] > 59 || +m[3] > 23 || +m[4] > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}-${m[3].padStart(2, '0')}:${m[4]}`;
}
const blankCell = v => /^[-–—−]?$/.test(String(v == null ? '' : v).trim());
function tableCells(line) {
  let cells;
  if (line.includes('\t')) cells = line.split('\t');
  else if (line.includes('|')) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    cells = s.split(/(?<!\\)\|/).map(c => c.replace(/\\\|/g, '|'));
  } else return null;
  cells = cells.map(c => c.trim());
  return cells.filter(Boolean).length >= 2 ? cells : null;
}
const isSeparator = cells => cells.some(Boolean) && cells.every(c => !c || /^:?-{3,}:?$/.test(c));
// 'dayish' is a column named only "Day": the day number when its values are numbers, else the weekday
function headerKind(cell) {
  const h = String(cell).trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^slot ?a(?![a-z])|^时段 ?a/.test(h)) return 'slotA';
  if (/^slot ?b(?![a-z])|^时段 ?b/.test(h)) return 'slotB';
  const w = h.replace(/[.:：]+$/, '').trim();
  if (['day no', 'day number', 'day num', 'day #', 'no', '#', '天数'].includes(w)) return 'day';
  if (['day', '天'].includes(w)) return 'dayish';
  if (['date', '日期'].includes(w)) return 'date';
  if (['weekday', 'day of week', 'day of the week', '星期', '周'].includes(w)) return 'weekday';
  if (/^(morning|上午|早课|早上)/.test(w)) return 'morning';
  if (['note', 'notes', 'remark', 'remarks', '备注'].includes(w)) return 'note';
  return null;
}
const isHeaderRow = kinds => kinds.filter(Boolean).length >= 2
  && kinds.some(k => k === 'date' || k === 'slotA' || k === 'slotB');
const SLOT_LINE = /(?:slot|时段)\s*([AB])(?![a-z])[^0-9\n]{0,20}?(\d{1,2}[:.]\d{2}\s*(?:-|–|—|~|to|至|到)\s*\d{1,2}[:.]\d{2})/gi;
const SESSION_CELL = /^(?:#\s*(\d+)|S(\d+))/i;
const dayList = ns => ns.length === 1 ? `day ${ns[0]}` : `days ${ns.join(', ')}`;

// rows: [{ line, day, date, weekday, morning, slotA, slotB, note }] → the days, their
// sessions and warnings; a CalError names the line (the row's place in rows mode)
function checkDays(input, warnings = []) {
  const days = [], sessions = [], byDay = new Map(), byDate = new Map(), bySession = new Map();
  const tbc = [], idle = [];
  let prev = null, outOfOrder = false;
  for (const r of input) {
    const line = r.line;
    const cell = k => {
      const v = r[k] == null ? '' : String(r[k]).trim();
      if (v.length > CAL_CELL_MAX)
        throw new CalError(`a cell holds at most ${CAL_CELL_MAX} characters (${COLUMN_NAMES[k]})`, line);
      return blankCell(v) ? null : v;
    };
    const dayS = String(r.day == null ? '' : r.day).trim();
    if (!/^\d{1,2}$/.test(dayS) || +dayS < 1 || +dayS > CAL_MAX_DAY)
      throw new CalError(`the day number must be 1 to ${CAL_MAX_DAY}, not "${dayS.slice(0, 20)}"`, line);
    const day = +dayS;
    if (byDay.has(day)) throw new CalError(`day ${day} appears twice (line ${byDay.get(day)} too)`, line);
    const date = calDate(r.date);
    if (!date) throw new CalError(`cannot read the date "${String(r.date == null ? '' : r.date).slice(0, 40)}": `
      + 'write it as 11 Jan 2027, 2027-01-11 or 11/1/2027', line);
    if (byDate.has(date)) throw new CalError(`${date} appears twice (day ${byDate.get(date)} too)`, line);
    if (prev && date < prev.date) throw new CalError(`the dates must go forward: ${date} comes after ${prev.date}`, line);
    if (prev && day < prev.day) outOfOrder = true;
    byDay.set(day, line); byDate.set(date, day);
    const actual = WEEKDAYS[new Date(date + 'T00:00:00Z').getUTCDay()];
    let weekday = cell('weekday');
    if (!weekday) weekday = actual;
    else {
      const wi = weekdayIndex(weekday);
      if (wi >= 0) weekday = WEEKDAYS[wi];
      if (weekday !== actual) warnings.push(`day ${day}: "${weekday}" but ${date} is a ${actual}`);
    }
    const out = { day, date, weekday, morning: cell('morning'), slotA: cell('slotA'), slotB: cell('slotB'),
      note: cell('note'), sessions: [] };
    for (const slot of ['A', 'B']) {
      const text = out['slot' + slot];
      const m = text && text.match(SESSION_CELL);
      if (!m) continue;
      const no = Number(m[1] || m[2]);
      if (no < 1 || no > 99) throw new CalError(`session numbers run 1 to 99, not ${no}`, line);
      if (bySession.has(no)) throw new CalError(`session #${no} appears twice (day ${bySession.get(no)} too)`, line);
      bySession.set(no, day);
      const title = text.slice(m[0].length).replace(/^[\s\-–—:：.,，、)）]+/, '').trim();
      out.sessions.push({ no, slot, title });
      sessions.push({ no, day, slot, title });
    }
    if (['morning', 'slotA', 'slotB', 'note'].some(k => /\bTBC\b|待定/i.test(out[k] || ''))) tbc.push(day);
    if (!out.sessions.length) idle.push(day);
    days.push(out);
    prev = { day, date };
  }
  if (outOfOrder) warnings.push('the day numbers do not follow the dates');
  if (tbc.length) warnings.push(`still to confirm (TBC) on ${dayList(tbc)}`);
  if (days.length && idle.length) warnings.push(`no session on ${dayList(idle)}`);
  sessions.sort((a, b) => a.no - b.no);
  if (sessions.length) {
    const have = new Set(sessions.map(s => s.no));
    const gaps = [];
    for (let n = 1; n < sessions[sessions.length - 1].no; n++) if (!have.has(n)) gaps.push(n);
    if (gaps.length) warnings.push(`no session #${gaps.join(', #')}`);
  }
  days.sort((a, b) => a.day - b.day);
  return { days, sessions, warnings };
}

// The pasted text → { days, sessions, slots, warnings }, or a CalError with its line.
function parseCalendar(text) {
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  const headSlots = {}, lineSlots = {}, warnings = [], data = [];
  let header = null, headerLine = null;
  lines.forEach((raw, i) => {
    const line = i + 1;
    const cells = tableCells(raw);
    if (!cells) {
      for (const m of raw.matchAll(SLOT_LINE)) {
        const t = timeRange(m[2]);
        if (t) lineSlots[m[1].toUpperCase()] = t;
      }
      return;
    }
    if (isSeparator(cells)) return;
    const kinds = cells.map(headerKind);
    if (isHeaderRow(kinds)) {
      if (header) return;                       // the header pasted again
      header = kinds; headerLine = line;
      kinds.forEach((k, j) => { if (k === 'slotA' || k === 'slotB') {
        const t = timeRange(cells[j]); if (t) headSlots[k.slice(-1)] = t; } });
      return;
    }
    if (!header) {
      // no header (or one it cannot read): rows that start with a day number and a date
      // are read in Boonchu's column order
      if (!(/^\d{1,2}$/.test(cells[0]) && calDate(cells[1]))) return;
      header = DEFAULT_COLUMNS;
      warnings.push(`no header row found: the columns are read as ${DEFAULT_COLUMNS.map(k => COLUMN_NAMES[k]).join(' | ')}`);
    }
    data.push({ line, cells });
  });
  if (!data.length) throw new CalError('no calendar rows found: paste the table with its header row '
    + '(Day no. | Date | Day | Morning class | Slot A | Slot B)', headerLine);
  const kinds = header.slice();
  kinds.forEach((k, j) => {
    if (k !== 'dayish') return;
    const vals = data.map(r => r.cells[j] || '').filter(v => !blankCell(v));
    const numeric = vals.length > 0 && vals.every(v => /^\d{1,2}$/.test(v));
    kinds[j] = numeric && !kinds.includes('day') ? 'day' : !kinds.includes('weekday') ? 'weekday' : null;
  });
  const seen = new Set();
  kinds.forEach((k, j) => {
    if (!k) return;
    if (seen.has(k)) { warnings.push(`two columns read as ${COLUMN_NAMES[k]}: the second is left out`); kinds[j] = null; }
    else seen.add(k);
  });
  if (!seen.has('date')) throw new CalError('the table has no Date column', headerLine);
  const rows = data.map((r, idx) => {
    if (r.cells.slice(kinds.length).some(c => !blankCell(c)))
      throw new CalError(`this row has ${r.cells.length} cells but the header has ${kinds.length}`, r.line);
    const o = { line: r.line };
    kinds.forEach((k, j) => { if (k) o[k] = r.cells[j] == null ? '' : r.cells[j]; });
    if (!seen.has('day')) o.day = idx + 1;
    return o;
  });
  if (!seen.has('day')) warnings.push('no day-number column: the days are numbered in order');
  const out = checkDays(rows, warnings);
  const slots = {};
  for (const k of ['A', 'B']) {
    if (headSlots[k] && lineSlots[k] && headSlots[k] !== lineSlots[k])
      warnings.push(`Slot ${k}: the header says ${headSlots[k]} and a line says ${lineSlots[k]}; the header is kept`);
    if (headSlots[k] || lineSlots[k]) slots[k] = headSlots[k] || lineSlots[k];
  }
  return { ...out, slots };
}

// Money recorded for a student who has not signed and has no option of the
// terms they would sign: they paid under older terms, or before an option was
// set. They can't sign until admin, once Boonchu decides, sets an option.
const isHeld = (terms, s, signed, paymentCount) =>
  !signed && paymentCount > 0 && !(s.payment_option && terms.options[s.payment_option]);

// JSONB hands keys back in its own order; plans are always { amountSatang, due }
const planOf = ps => ps ? ps.map(p => ({ amountSatang: Number(p.amountSatang), due: p.due })) : null;

// Discounted amount in satang: multiply by (100−pct)/100 in integers, flooring
// any fractional satang toward the student. For idcn3 every case is exact.
function applyPct(satang, pct) {
  if (!Number.isSafeInteger(satang) || satang < 0) throw new Error('bad amount');
  return Math.floor((satang * (100 - pct)) / 100);
}

// A plan agreed on the call: 1 to 6 dated payments that add up to the fee.
// Returns the reason it is refused, or null.
function planError(plan, totalSatang) {
  if (!Array.isArray(plan) || !plan.length || plan.length > 6) return 'a plan has 1 to 6 payments';
  let sum = 0;
  for (const p of plan) {
    if (!p || !Number.isSafeInteger(p.amountSatang) || p.amountSatang <= 0)
      return 'every payment needs a positive whole amount in satang';
    const d = String(p.due || ''), t = new Date(d + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(t) || t.toISOString().slice(0, 10) !== d)
      return `"${d}" is not a date (use YYYY-MM-DD)`;
    sum += p.amountSatang;
  }
  if (sum !== totalSatang) return `the payments add up to ${(sum / SATANG).toLocaleString('en-US')} THB, `
    + `but the course fee is ${(totalSatang / SATANG).toLocaleString('en-US')} THB`;
  return null;
}

// v4 shape: one price (net + VAT), no discounts, paid in dated parts. The last
// part takes the remainder, so the parts always add up to the total exactly.
const feeWithVat = terms => terms.netSatang + Math.floor((terms.netSatang * terms.vatPct) / 100);

function planQuote(terms, option, opt, customPlan) {
  const net = terms.netSatang;
  const total = feeWithVat(terms), vat = total - net;
  let installments;
  if (opt.custom) {
    if (planError(customPlan, total)) return null;
    installments = customPlan.map(p => ({ amountSatang: p.amountSatang, due: p.due }));
  } else {
    let left = total;
    installments = opt.plan.map((p, i) => {
      const amountSatang = i === opt.plan.length - 1 ? left : Math.floor((total * p.pct) / 100);
      left -= amountSatang;
      return { amountSatang, due: p.due };
    });
  }
  return { option, code: opt.code, listSatang: total, netSatang: net, vatPct: terms.vatPct,
    vatSatang: vat, totalSatang: total, discounts: [], due: installments[0].due,
    label_en: opt.label_en, label_zh: opt.label_zh, installments };
}

function quote(terms, option, isAttendee, customPlan) {
  const opt = terms.options[option];
  if (!opt) return null;
  if (terms.netSatang != null) return planQuote(terms, Number(option), opt, customPlan);
  let total = applyPct(terms.feeSatang, opt.pct);
  if (isAttendee) total = applyPct(total, terms.attendeePct);
  const out = {
    option: Number(option),
    listSatang: terms.feeSatang,
    totalSatang: total,
    // shown separately ("−10% −3%"), never summed: the discounts stack
    // multiplicatively, so a summed percentage would contradict the price
    discounts: [opt.pct, isAttendee ? terms.attendeePct : 0].filter(Boolean),
    due: opt.due,
    label_en: opt.label_en, label_zh: opt.label_zh,
  };
  if (opt.depositPct) {
    out.depositSatang = Math.floor((total * opt.depositPct) / 100);
    out.cashSatang = total - out.depositSatang;   // remainder to the cash leg, always exact
    out.cashDue = opt.cashDue;
  }
  return out;
}

function mountIdcn(app, opts = {}) {
  const pool = opts.pgPool;
  if (!pool) { console.warn('⚠ idcn-api: no pgPool — in-depth courses disabled'); return; }
  const q = (sql, params = []) => pool.query(sql, params);
  const ADMIN_KEY = process.env.BKK_ADMIN_KEY || process.env.SHOP_ADMIN_KEY || '';
  if (!ADMIN_KEY) console.warn('⚠ idcn-api: BKK_ADMIN_KEY not set — course admin is closed');
  const isAdmin = req => !!ADMIN_KEY && req.headers['x-bkk-key'] === ADMIN_KEY;

  // Video uploads arrive as real multipart files (never base64 JSON — the app
  // body limit is 10MB) and are pushed to Cloudinary from a temp file.
  // 100MB is Cloudinary's per-video ceiling on this plan.
  const multer = require('multer');
  const os = require('os');
  const fs = require('fs');
  const mediaUpload = multer({ dest: os.tmpdir(),
    limits: { fileSize: 100 * 1024 * 1024 } }).single('file');
  // R2 when its four variables are set (opts.r2Endpoint: a test's fake R2), else Cloudinary.
  const store = media.makeStore({ endpoint: opts.r2Endpoint });
  const cloud = () => opts.cloudinary || require('cloudinary').v2;
  const httpFetch = opts.fetch || fetch;
  // prefix: where in R2 (idcn/<course>/sub|note), folder: where on Cloudinary
  async function pushMedia(file, folder, prefix) {
    if (store) {
      try { return await media.putFile(store, prefix, file); } finally { fs.unlink(file.path, () => {}); }
    }
    const cloudinary = cloud();
    const isVideo = /^video\//.test(file.mimetype || '');
    try {
      // upload_large rejects with a broken error in this SDK version; plain
      // upload handles videos to ~100MB, which is also the multer cap here
      const up = await cloudinary.uploader.upload(file.path, isVideo
        ? { folder, resource_type: 'video', chunk_size: 6 * 1024 * 1024 }
        : { folder, resource_type: 'image' });
      return { url: up.secure_url, type: isVideo ? 'video' : 'image' };
    } finally { fs.unlink(file.path, () => {}); }
  }

  async function initSchema() {
    await q(`CREATE TABLE IF NOT EXISTS idc_courses (
      code TEXT PRIMARY KEY, name_en TEXT NOT NULL, name_zh TEXT,
      terms JSONB NOT NULL, policy_version TEXT NOT NULL,
      active BOOLEAN DEFAULT true)`);
    await q(`CREATE TABLE IF NOT EXISTS idc_students (
      id SERIAL PRIMARY KEY,
      course_code TEXT NOT NULL REFERENCES idc_courses(code),
      slug TEXT NOT NULL,
      name_en TEXT NOT NULL, name_zh TEXT, lang TEXT DEFAULT 'zh',
      key_hash TEXT NOT NULL,
      journal_url TEXT,
      payment_option INTEGER,
      is_attendee BOOLEAN DEFAULT false,
      status TEXT NOT NULL DEFAULT 'invited',
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (course_code, slug))`);
    // append-only: signing is an event, never a row that gets edited
    await q(`CREATE TABLE IF NOT EXISTS idc_consents (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES idc_students(id),
      policy_version TEXT NOT NULL,
      payment_option INTEGER NOT NULL,
      items JSONB NOT NULL,
      signed_name TEXT NOT NULL,
      health_note TEXT,
      media_public BOOLEAN DEFAULT false,
      signed_at TIMESTAMPTZ DEFAULT now(),
      ip TEXT)`);
    await q(`CREATE TABLE IF NOT EXISTS idc_payments (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES idc_students(id),
      label TEXT NOT NULL,
      amount_satang BIGINT,
      proof_url TEXT,
      note TEXT,
      uploaded_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now())`);
    // notes & assignments the teaching team sends into a student's profile
    await q(`CREATE TABLE IF NOT EXISTS idc_notes (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES idc_students(id),
      kind TEXT NOT NULL DEFAULT 'note',
      title TEXT, body TEXT NOT NULL,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now())`);
    // Jamsai negotiates the tier with each student, so the option is admin-set
    // and a student may sign the consent before their plan is settled
    await q(`ALTER TABLE idc_consents ALTER COLUMN payment_option DROP NOT NULL`)
      .catch(() => {});
    await q(`CREATE TABLE IF NOT EXISTS idc_settings (
      course_code TEXT NOT NULL REFERENCES idc_courses(code),
      key TEXT NOT NULL, value JSONB,
      updated_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (course_code, key))`);
    await q(`INSERT INTO idc_courses (code, name_en, name_zh, terms, policy_version)
      VALUES ('idcn3', 'AYBKK In-Depth Mysore Course for Chinese Generation #3',
              'AYBKK 深度迈索尔课程 · 中国第三期', $1, $2)
      ON CONFLICT (code) DO NOTHING`, [JSON.stringify(IDCN3_TERMS), IDCN3_POLICY_VERSION]);
    // the code is the source of truth for idcn3's dates and deadlines
    await q(`UPDATE idc_courses SET terms=$1 WHERE code='idcn3'`,
      [JSON.stringify(IDCN3_TERMS)]);
    await q(`ALTER TABLE idc_notes ADD COLUMN IF NOT EXISTS media_url TEXT`);
    await q(`ALTER TABLE idc_notes ADD COLUMN IF NOT EXISTS media_type TEXT`);
    await q(`ALTER TABLE idc_students ADD COLUMN IF NOT EXISTS custom_plan JSONB`);
    // the dated payments on screen when the student signed (insert-only, like
    // the rest of the row): a plan changed later never hides what was signed
    await q(`ALTER TABLE idc_consents ADD COLUMN IF NOT EXISTS plan JSONB`);
    // IDCN#3 (24 Nov 2026): the student's own AYBKK account (bkk_members.id, no FK:
    // this module also runs without bkk), a later start for alumni, a staff label,
    // and terms agreed directly with AYBKK instead of the online signature
    await q(`ALTER TABLE idc_students ADD COLUMN IF NOT EXISTS member_id INTEGER`);
    await q(`ALTER TABLE idc_students ADD COLUMN IF NOT EXISTS start_date DATE`);
    await q(`ALTER TABLE idc_students ADD COLUMN IF NOT EXISTS cohort_note TEXT`);
    await q(`ALTER TABLE idc_students ADD COLUMN IF NOT EXISTS terms_arranged BOOLEAN NOT NULL DEFAULT false`);
    await q(`CREATE INDEX IF NOT EXISTS idc_students_member ON idc_students (member_id)`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS idc_students_course_member ON idc_students (course_code, member_id)
      WHERE member_id IS NOT NULL`);
    // the daily calendar, pasted in the admin; sessions are rebuilt from it on every save
    await q(`CREATE TABLE IF NOT EXISTS idc_days (
      course_code TEXT NOT NULL REFERENCES idc_courses(code),
      day_no INTEGER NOT NULL, date DATE, weekday TEXT,
      morning TEXT, slot_a TEXT, slot_b TEXT, note TEXT,
      PRIMARY KEY (course_code, day_no))`);
    await q(`CREATE TABLE IF NOT EXISTS idc_sessions (
      course_code TEXT NOT NULL, session_no INTEGER NOT NULL,
      day_no INTEGER NOT NULL, slot TEXT NOT NULL, title TEXT,
      PRIMARY KEY (course_code, session_no),
      FOREIGN KEY (course_code, day_no) REFERENCES idc_days (course_code, day_no) ON DELETE CASCADE)`);
    // assignments and hand-ins belong to a session, the teacher's comment to a day
    // (one per student per day); both empty = undated, as before
    await q(`ALTER TABLE idc_notes ADD COLUMN IF NOT EXISTS session_no INTEGER`);
    await q(`ALTER TABLE idc_notes ADD COLUMN IF NOT EXISTS day_no INTEGER`);
    await q(`ALTER TABLE idc_notes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS idc_notes_day_comment ON idc_notes (student_id, day_no)
      WHERE kind='comment'`);
    // Nov 2026: a file that did not arrive never costs the words or the payment with it.
    // 'failed' until it is sent again; media_batch ties the notes of one send together.
    await q(`ALTER TABLE idc_notes ADD COLUMN IF NOT EXISTS media_state TEXT`);
    await q(`ALTER TABLE idc_notes ADD COLUMN IF NOT EXISTS media_batch TEXT`);
    await q(`ALTER TABLE idc_payments ADD COLUMN IF NOT EXISTS proof_state TEXT`);
    // the photo hub's own list: media is "r2:<key>" or a Cloudinary link (public_id
    // then names it, so its copy in R2 takes the same row); uploader is the student, null for staff
    await q(`CREATE TABLE IF NOT EXISTS idc_hub_photos (
      id SERIAL PRIMARY KEY,
      course_code TEXT NOT NULL REFERENCES idc_courses(code),
      media TEXT NOT NULL, public_id TEXT UNIQUE,
      day DATE NOT NULL, width INTEGER, height INTEGER,
      uploader INTEGER,
      created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS idc_hub_photos_course ON idc_hub_photos (course_code, day)`);
  }

  // the policy a student signed, or the one they would sign now
  async function termsOf(course, studentId) {
    const signed = (await q(
      'SELECT policy_version FROM idc_consents WHERE student_id=$1 ORDER BY id ASC LIMIT 1',
      [studentId])).rows[0];
    const version = signed ? signed.policy_version : currentVersion(course);
    const paid = (await q('SELECT count(*)::int AS n FROM idc_payments WHERE student_id=$1',
      [studentId])).rows[0].n;
    return { version, terms: termsFor(course, version), signed: !!signed, paid };
  }
  const studentQuote = (terms, s) => s.payment_option
    ? quote(terms, s.payment_option, s.is_attendee, s.custom_plan) : null;
  const optionList = terms => Object.entries(terms.options).map(([k, o]) =>
    ({ key: Number(k), code: o.code || k, label_en: o.label_en, custom: !!o.custom,
       installments: o.plan ? quote(terms, k, false).installments : undefined }));

  const courseFor = async (req, res) => {
    const c = (await q('SELECT * FROM idc_courses WHERE code=$1 AND active',
      [String(req.params.course || '')])).rows[0];
    if (!c) { res.status(404).json({ error: 'not found' }); return null; }
    return c;
  };
  // terms agreed directly with AYBKK: never held, whatever was paid
  const heldFor = (terms, s, signed, paymentCount) =>
    !s.terms_arranged && isHeld(terms, s, signed, paymentCount);
  const mayLearn = (s, signed, admin) => !!(signed || s.terms_arranged || admin);
  const bkkOf = async () => { try { return (await opts.bkk) || null; } catch (_) { return null; } };

  // ── the student's AYBKK account (bkk_members, owned by bkk-api.js) ─────────
  // Read only here, merges followed (a folded profile points at the one kept).
  // Without bkk's tables (this module's own tests) every account is "not found".
  let membersTable = false;
  async function hasMembers(db = pool) {
    if (!membersTable)
      membersTable = (await db.query(`SELECT to_regclass('bkk_members') IS NOT NULL AS ok`)).rows[0].ok;
    return membersTable;
  }
  // stored member ids → Map(stored id → the live profile { id, code, name })
  async function liveMembers(ids, db = pool) {
    const out = new Map();
    const want = [...new Set(ids.map(Number).filter(Number.isSafeInteger))];
    if (!want.length || !(await hasMembers(db))) return out;
    const r = await db.query(`WITH RECURSIVE ch (start, id, code, name, merged_into, d) AS (
        SELECT id, id, code, name, merged_into, 0 FROM bkk_members WHERE id = ANY($1::int[])
        UNION ALL
        SELECT ch.start, m.id, m.code, m.name, m.merged_into, ch.d + 1
        FROM ch JOIN bkk_members m ON m.id = ch.merged_into WHERE ch.d < 10)
      SELECT start, id, code, name FROM ch WHERE merged_into IS NULL`, [want]);
    for (const x of r.rows) out.set(x.start, { id: x.id, code: x.code, name: x.name });
    return out;
  }
  async function memberWhere(where, val, db = pool) {
    if (!(await hasMembers(db))) return null;
    const r = (await db.query(`SELECT id FROM bkk_members WHERE ${where} ORDER BY id LIMIT 1`, [val])).rows[0];
    return r ? (await liveMembers([r.id], db)).get(r.id) || null : null;
  }
  const memberByCode = (code, db) => memberWhere('code=$1', String(code || ''), db);
  const memberByEmail = (email, db) => memberWhere('lower(email)=$1', String(email || '').trim().toLowerCase(), db);
  // every stored id that leads to this live profile (itself and the profiles folded into it)
  async function foldedInto(liveId, db = pool) {
    if (!(await hasMembers(db))) return [liveId];
    return (await db.query(`WITH RECURSIVE f (id, d) AS (
        SELECT $1::int, 0
        UNION ALL
        SELECT m.id, f.d + 1 FROM bkk_members m JOIN f ON m.merged_into = f.id WHERE f.d < 10)
      SELECT DISTINCT id FROM f`, [liveId])).rows.map(r => r.id);
  }
  // a member code opens the idcn row linked to the same live profile, and nothing else
  async function memberOpens(code, storedId) {
    const c = String(code || '').trim();
    if (!c || c.length > 40 || storedId == null) return false;
    const m = await memberByCode(c);
    const linked = m && (await liveMembers([storedId])).get(Number(storedId));
    return !!linked && linked.id === m.id;
  }

  // ── calendar and dated notes ──────────────────────────────────────────────
  async function getSetting(code, key, db = pool) {
    const r = (await db.query(`SELECT value FROM idc_settings WHERE course_code=$1 AND key=$2`,
      [code, key])).rows[0];
    return r ? r.value : null;
  }
  async function calendarOf(code, db = pool) {
    const days = (await db.query(
      `SELECT day_no, to_char(date, 'YYYY-MM-DD') AS date, weekday, morning, slot_a, slot_b, note
       FROM idc_days WHERE course_code=$1 ORDER BY day_no`, [code])).rows;
    const sessions = (await db.query(
      `SELECT session_no, day_no, slot, title FROM idc_sessions WHERE course_code=$1
       ORDER BY session_no`, [code])).rows;
    const slots = { A: null, B: null, ...((await getSetting(code, 'slots', db)) || {}) };
    const byDay = new Map();
    for (const s of [...sessions].sort((a, b) => a.slot.localeCompare(b.slot) || a.session_no - b.session_no)) {
      if (!byDay.has(s.day_no)) byDay.set(s.day_no, []);
      byDay.get(s.day_no).push({ no: s.session_no, slot: s.slot, title: s.title });
    }
    return {
      days: days.map(d => ({ day: d.day_no, date: d.date, weekday: d.weekday, morning: d.morning,
        slotA: d.slot_a, slotB: d.slot_b, note: d.note, sessions: byDay.get(d.day_no) || [] })),
      sessions: sessions.map(s => ({ no: s.session_no, day: s.day_no, slot: s.slot, title: s.title })),
      slots,
    };
  }
  const NOTE_FIELDS = ['id', 'kind', 'title', 'body', 'media_url', 'media_type', 'created_by', 'created_at',
    'updated_at', 'session_no', 'day_no', 'media_state'];
  const NOTE_COLS = NOTE_FIELDS.join(', ');
  // a file in R2 goes out as a signed link; media_failed only when the file did not arrive
  const failedKey = (state, key) => state === 'failed' ? { [key]: true } : {};
  const FILE_AGAIN = { mediaFailed: true, mediaError: 'saved, but the file did not upload: send the file again' };
  const noteOut = n => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, media_url: media.linkFor(n.media_url),
    media_type: n.media_type, created_by: n.created_by, created_at: n.created_at,
    updated_at: n.updated_at || null, session: n.session_no, day: n.day_no, ...failedKey(n.media_state, 'media_failed') });
  const feedNote = ({ media_state, ...n }) => ({ ...n, media_url: media.linkFor(n.media_url), ...failedKey(media_state, 'media_failed') });
  // a payment screenshot's link ends within two days
  const payOut = ({ proof_state, ...p }) => ({ ...p, proof_url: media.linkFor(p.proof_url, { days: 1 }), ...failedKey(proof_state, 'proof_failed') });
  // dated notes → { sessionsWork: { "<no>": { assignments, submissions } }, comments: { "<day>": note } }
  function workOf(rows) {
    const sessionsWork = {}, comments = {};
    for (const n of rows) {
      if (n.kind === 'comment') { if (n.day_no != null) comments[n.day_no] = noteOut(n); continue; }
      if (n.session_no == null) continue;
      const w = sessionsWork[n.session_no] || (sessionsWork[n.session_no] = { assignments: [], submissions: [] });
      (n.kind === 'submission' ? w.submissions : w.assignments).push(noteOut(n));
    }
    return { sessionsWork, comments };
  }
  const sessionExists = async (code, no) => (await q(
    'SELECT 1 FROM idc_sessions WHERE course_code=$1 AND session_no=$2', [code, no])).rowCount > 0;
  // a sessionNo field: absent/empty → null, a whole number 1 to 99, or false when it is not one
  const sessionField = v => {
    if (v == null || String(v).trim() === '') return null;
    const s = String(v).trim().replace(/^[#sS]/, '');
    return /^\d{1,2}$/.test(s) && +s >= 1 ? +s : false;
  };
  // multer keeps the upload in tmp until something moves it; on any refusal it goes
  const dropUpload = req => { if (req.file && req.file.path) fs.unlink(req.file.path, () => {}); };

  // A student key only ever opens its own row; the admin key opens any slug in
  // the course. Wrong key and wrong slug are the same 401/404 — a named link
  // must not confirm whose passcode is whose. The student's own AYBKK member code
  // (x-member-code, the same trust as every /api/bkk/me/:code route) opens the row
  // linked to that account.
  async function studentFrom(req, res, course, slug) {
    const row = (await q(
      'SELECT * FROM idc_students WHERE course_code=$1 AND slug=$2',
      [course.code, String(slug || '').toLowerCase()])).rows[0];
    if (isAdmin(req)) {
      if (!row) { res.status(404).json({ error: 'not found' }); return null; }
      return row;
    }
    const key = req.headers['x-idcn-key'];
    if (row && key && row.key_hash === sha(key)) return row;
    if (row && row.member_id != null && await memberOpens(req.headers['x-member-code'], row.member_id)) return row;
    res.status(401).json({ error: 'passcode needed' }); return null;
  }

  const REQUIRED_CONSENTS = ['payment_final', 'adjustments', 'risk_health',
    'instructions', 'travel', 'schedule', 'media_course', 'privacy'];

  async function profileJson(course, s, view = {}) {
    const signedRow = (await q(
      `SELECT policy_version, payment_option, items, signed_name, health_note,
              media_public, signed_at, plan
       FROM idc_consents WHERE student_id=$1 ORDER BY id ASC LIMIT 1`, [s.id])).rows[0] || null;
    let consent = null, signedPlan = null;
    if (signedRow) ({ plan: signedPlan, ...consent } = signedRow);
    signedPlan = planOf(signedPlan);
    const payments = (await q(
      `SELECT id, label, amount_satang, proof_url, note, created_at, proof_state
       FROM idc_payments WHERE student_id=$1 ORDER BY id ASC`, [s.id])).rows.map(payOut);
    const links = (await q(
      `SELECT value FROM idc_settings WHERE course_code=$1 AND key='links'`,
      [course.code])).rows[0];
    // the undated feed; work for a session and the day's comment come in their own keys
    const notes = (await q(
      `SELECT id, kind, title, body, created_by, media_url, media_type, created_at, media_state
       FROM idc_notes WHERE student_id=$1 AND session_no IS NULL AND day_no IS NULL
       ORDER BY id DESC LIMIT 100`, [s.id])).rows.map(feedNote);
    const version = consent ? consent.policy_version : currentVersion(course);
    const terms = termsFor(course, version);
    const held = heldFor(terms, s, !!consent, payments.length);
    // new keys only when there is something in them, so earlier profiles keep their shape
    const more = {};
    if (s.member_id != null || s.start_date || s.cohort_note || s.terms_arranged)
      more.cohort = { label: courseLabel(course.code), startDate: ymd(s.start_date),
        ...(view.admin ? { note: s.cohort_note || null } : {}), termsArranged: !!s.terms_arranged };
    if (mayLearn(s, !!consent, view.admin)) {
      const cal = await calendarOf(course.code);
      if (cal.days.length) { more.days = cal.days; more.slots = cal.slots; }
      const dated = (await q(
        `SELECT ${NOTE_COLS} FROM idc_notes
         WHERE student_id=$1 AND (session_no IS NOT NULL OR day_no IS NOT NULL) ORDER BY id`, [s.id])).rows;
      const w = workOf(dated);
      if (Object.keys(w.sessionsWork).length) more.sessionsWork = w.sessionsWork;
      if (Object.keys(w.comments).length) more.comments = w.comments;
    }
    const c = { code: course.code, name_en: terms.name_en || course.name_en,
      name_zh: terms.name_zh || course.name_zh,
      sessions: terms.sessions, confirmBy: terms.confirmBy, policyVersion: version };
    if (terms.facts) c.facts = terms.facts;
    return {
      course: c,
      student: { slug: s.slug, name_en: s.name_en, name_zh: s.name_zh, lang: s.lang,
        status: s.status, paymentOption: s.payment_option, isAttendee: s.is_attendee,
        journalUrl: s.journal_url || null },
      quotes: Object.keys(terms.options).filter(o => !terms.options[o].custom)
        .map(o => quote(terms, o, s.is_attendee)),
      quote: studentQuote(terms, s),
      consent, payments, notes,
      links: (links && links.value) || [],
      requiredConsents: REQUIRED_CONSENTS,
      // only in v4-era profiles, so a v3 signer's profile stays as it was
      ...(signedPlan ? { signedPlan } : {}),
      ...(held ? { held: { paidSatang: payments.reduce((n, p) => n + Number(p.amount_satang || 0), 0) } } : {}),
      ...more,
    };
  }

  // ── student endpoints ─────────────────────────────────────────────────────
  // The courses an AYBKK account is enrolled in, for My account on /book and the
  // cohort landing (/idcn3). Opened by the member code alone, like /api/bkk/me/:code;
  // an unknown code is an empty list, never a 404 (the page asks for every member).
  app.get('/api/idcn/mine/:code', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try {
      const m = await memberByCode(req.params.code);
      if (!m) return res.json({ courses: [] });
      const rows = (await q(
        `SELECT s.course_code, s.slug, s.name_en, s.name_zh, to_char(s.start_date, 'YYYY-MM-DD') AS start_date
         FROM idc_students s JOIN idc_courses c ON c.code = s.course_code AND c.active
         WHERE s.member_id = ANY($1::int[]) AND s.status != 'withdrawn'
         ORDER BY s.course_code, s.id`, [await foldedInto(m.id)])).rows;
      res.json({ courses: rows.map(r => ({ course: r.course_code, label: courseLabel(r.course_code),
        name_en: r.name_en, name_zh: r.name_zh, slug: r.slug, link: `/${r.course_code}/${r.slug}`,
        startDate: r.start_date })) });
    } catch (e) { res.status(500).json({ error: 'something went wrong' }); }
  });

  app.get('/api/idcn/:course/students/:slug', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try {
      const course = await courseFor(req, res); if (!course) return;
      const s = await studentFrom(req, res, course, req.params.slug); if (!s) return;
      res.json(await profileJson(course, s, { admin: isAdmin(req) }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/idcn/:course/students/:slug/consent', async (req, res) => {
    try {
      const course = await courseFor(req, res); if (!course) return;
      const s = await studentFrom(req, res, course, req.params.slug); if (!s) return;
      const b = req.body || {};
      const already = (await q('SELECT 1 FROM idc_consents WHERE student_id=$1', [s.id])).rows[0];
      if (already) return res.status(409).json({ error: 'already signed' });
      // the page says which wording it showed; a page loaded before the terms
      // changed must not sign the new ones
      const version = currentVersion(course);
      if (b.policyVersion !== version)
        return res.status(409).json({ error: 'the course terms changed: reload the page and read them again',
          policyVersion: version });
      const terms = termsFor(course, version);
      const paid = (await q('SELECT count(*)::int AS n FROM idc_payments WHERE student_id=$1',
        [s.id])).rows[0].n;
      if (heldFor(terms, s, false, paid))
        return res.status(409).json({ held: true,
          error: 'AYBKK will confirm your payment plan with you before you sign' });
      const items = b.items || {};
      const missing = REQUIRED_CONSENTS.filter(k => items[k] !== true);
      if (missing.length)
        return res.status(400).json({ error: 'every consent is required', missing });
      const signedName = String(b.signedName || '').trim();
      if (signedName.length < 2) return res.status(400).json({ error: 'type your full name to sign' });
      const kept = {}; for (const k of REQUIRED_CONSENTS) kept[k] = true;
      const qt = studentQuote(terms, s);
      await q(
        `INSERT INTO idc_consents (student_id, policy_version, payment_option, items,
           signed_name, health_note, media_public, ip, plan)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [s.id, version, terms.options[s.payment_option] ? s.payment_option : null,
         JSON.stringify(kept),
         signedName, String(b.healthNote || '').slice(0, 2000) || null,
         b.mediaPublic === true,
         String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(),
         qt && qt.installments ? JSON.stringify(qt.installments) : null]);
      await q(`UPDATE idc_students SET status='confirmed' WHERE id=$1`, [s.id]);
      res.json({ success: true, status: 'confirmed' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // daily drill videos: a student sends their assignment work into their own
  // profile. Kept per-student (never in the shared course feed). For a session
  // of the calendar (sessionNo) a written answer alone is enough.
  app.post('/api/idcn/:course/submissions', (req, res) => mediaUpload(req, res, async (mErr) => {
    try {
      if (mErr) return res.status(400).json({ error: mErr.code === 'LIMIT_FILE_SIZE'
        ? 'video too large — keep it under 100MB' : mErr.message });
      const course = await courseFor(req, res); if (!course) return;
      const b = req.body || {};
      const s = await studentFrom(req, res, course, b.slug); if (!s) return;
      const sessionNo = sessionField(b.sessionNo);
      if (sessionNo === false) return res.status(400).json({ error: 'sessionNo is a session number (1 to 99)' });
      const body = String(b.body || '').trim();
      if (sessionNo != null) {
        const signed = (await q('SELECT 1 FROM idc_consents WHERE student_id=$1', [s.id])).rowCount > 0;
        if (!mayLearn(s, signed, isAdmin(req)))
          return res.status(403).json({ error: 'confirm your spot first' });
        if (!(await sessionExists(course.code, sessionNo)))
          return res.status(400).json({ error: `there is no session #${sessionNo} in the calendar` });
        if (!req.file && !body)
          return res.status(400).json({ error: 'write your answer, or attach the video (or photo) file' });
        if (body.length > 4000) return res.status(400).json({ error: 'keep the answer under 4000 characters' });
      } else if (!req.file) return res.status(400).json({ error: 'attach the video (or photo) file' });
      // A file that does not arrive never costs the written answer: it is saved, marked,
      // and the student sends the file again. With no words to keep, the error as before.
      let up = { url: null, type: null }, upFailed = false;
      if (req.file) {
        try {
          up = await pushMedia(req.file, `aybkk/${course.code}/submissions/${s.slug}`, `idcn/${course.code}/sub`);
        } catch (e) {
          if (!body) throw e;
          upFailed = true;
          up = { url: null, type: /^video\//.test(req.file.mimetype || '') ? 'video' : 'image' };
          console.warn('[idcn] a hand-in is saved without its file:', e.message);
        }
      }
      const r = await q(
        `INSERT INTO idc_notes (student_id, kind, title, body, created_by, media_url, media_type, session_no, media_state)
         VALUES ($1,'submission',$2,$3,$4,$5,$6,$7,$8)
         RETURNING ${NOTE_COLS}`,
        [s.id, String(b.title || '').slice(0, 200) || null,
         sessionNo != null ? body : String(b.body || '').slice(0, 4000),
         s.name_zh || s.name_en, up.url, up.type, sessionNo, upFailed ? 'failed' : null]);
      const n = r.rows[0];
      res.json({ success: true, note: sessionNo != null ? noteOut(n) : { id: n.id, kind: n.kind, title: n.title,
        body: n.body, created_by: n.created_by, media_url: media.linkFor(n.media_url), media_type: n.media_type,
        created_at: n.created_at, ...failedKey(n.media_state, 'media_failed') }, ...(upFailed ? FILE_AGAIN : {}) });
    } catch (e) { res.status(store && e.status === 400 ? 400 : 500).json({ error: e.message }); }
    finally { dropUpload(req); }
  }));

  // The file of a hand-in saved without it, sent again: the student's own, or staff.
  app.post('/api/idcn/:course/submissions/:id/media', (req, res) => mediaUpload(req, res, async (mErr) => {
    try {
      if (mErr) return res.status(400).json({ error: mErr.code === 'LIMIT_FILE_SIZE'
        ? 'video too large: keep it under 100MB' : mErr.message });
      const course = await courseFor(req, res); if (!course) return;
      const s = await studentFrom(req, res, course, (req.body || {}).slug); if (!s) return;
      const id = idParam(req.params.id);
      const n = id && (await q(`SELECT id FROM idc_notes WHERE id=$1 AND student_id=$2 AND kind='submission'
        AND media_state='failed'`, [id, s.id])).rows[0];
      if (!n) return res.status(404).json({ error: 'no hand-in is waiting for its file' });
      if (!req.file) return res.status(400).json({ error: 'attach the video (or photo) file' });
      let up;
      try {
        up = await pushMedia(req.file, `aybkk/${course.code}/submissions/${s.slug}`, `idcn/${course.code}/sub`);
      } catch (e) {
        console.warn('[idcn] a hand-in file did not arrive again:', e.message);
        return res.status(e.status === 400 ? 400 : 502).json({ error: FILE_AGAIN.mediaError });
      }
      const r = await q(`UPDATE idc_notes SET media_url=$2, media_type=$3, media_state=NULL
        WHERE id=$1 AND media_state='failed' RETURNING ${NOTE_COLS}`, [n.id, up.url, up.type]);
      if (!r.rowCount) return res.status(409).json({ error: 'this hand-in has its file already' });
      res.json({ success: true, note: noteOut(r.rows[0]) });
    } catch (e) { res.status(500).json({ error: e.message }); }
    finally { dropUpload(req); }
  }));

  // ── course photo hub ──────────────────────────────────────────────────────
  // With R2: the hub's own list (idc_hub_photos), and Cloudinary's tag search only for
  // photos from before, until the copy below has taken them all (hub_copied); a search
  // that fails or hangs leaves those out, never the list. Without R2: Cloudinary's tag
  // search as before (own tag so nothing leaks between feeds), and each upload is also
  // noted in idc_hub_photos for the copy.
  const photoCache = new Map();
  const hubDay = r => { const m = String(r.public_id).match(/\/(\d{4}-\d{2}-\d{2})\//); return m ? m[1] : String(r.created_at).slice(0, 10); };
  const hubSearch = code => cloud().search.expression(`tags=aybkk-${code} AND resource_type:image`)
    .sort_by('created_at', 'desc').max_results(200).execute();
  const within = (p, ms) => { let t; return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(new Error('no answer in time')), ms); })]).finally(() => clearTimeout(t)); };
  async function hubList(code) {
    const rows = (await q(`SELECT media, public_id, to_char(day, 'YYYY-MM-DD') AS day, width, height, created_at
      FROM idc_hub_photos WHERE course_code=$1 ORDER BY created_at DESC, id DESC LIMIT 1000`, [code])).rows;
    const items = rows.map(r => ({ day: r.day, at: new Date(r.created_at).getTime(), url: media.linkFor(r.media), w: r.width || 0, h: r.height || 0 }));
    let whole = true;
    if (!(await getSetting(code, 'hub_copied'))) {
      const known = new Set(rows.map(r => r.public_id).filter(Boolean));
      try {
        for (const r of (await within(hubSearch(code), 8000)).resources || []) if (!known.has(r.public_id))
          items.push({ day: hubDay(r), at: new Date(r.created_at).getTime() || 0, url: r.secure_url, w: r.width || 0, h: r.height || 0 });
      } catch (e) { whole = false; console.warn('[idcn] photo hub: the photos still on Cloudinary are not listed:', e.message); }
    }
    items.sort((a, b) => b.day.localeCompare(a.day) || b.at - a.at);
    const byDay = new Map();
    for (const it of items) {
      if (!byDay.has(it.day)) byDay.set(it.day, []);
      byDay.get(it.day).push({ url: it.url, w: it.w, h: it.h });
    }
    return { whole, data: { days: [...byDay.entries()].map(([date, items]) => ({ date, items })) } };
  }
  app.get('/api/idcn/:course/photos', async (req, res) => {
    try {
      const course = await courseFor(req, res); if (!course) return;
      const s = await studentFrom(req, res, course, req.query.slug); if (!s) return;
      const cached = photoCache.get(course.code);
      if (cached && Date.now() - cached.at < 5 * 60 * 1000) return res.json(cached.data);
      if (store) {
        const { whole, data } = await hubList(course.code);
        if (whole) photoCache.set(course.code, { at: Date.now(), data });
        return res.json(data);
      }
      const cloudinary = cloud();
      const result = await cloudinary.search
        .expression(`tags=aybkk-${course.code} AND resource_type:image`)
        .sort_by('created_at', 'desc').max_results(200).execute();
      const byDay = new Map();
      for (const r of result.resources || []) {
        const day = hubDay(r);
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push({ url: r.secure_url, w: r.width || 0, h: r.height || 0 });
      }
      const data = { days: [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]))
        .map(([date, items]) => ({ date, items })) };
      photoCache.set(course.code, { at: Date.now(), data });
      res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/idcn/:course/photos', async (req, res) => {
    try {
      const course = await courseFor(req, res); if (!course) return;
      const s = await studentFrom(req, res, course, (req.body || {}).slug); if (!s) return;
      const imageBase64 = (req.body || {}).imageBase64;
      if (!imageBase64 || !/^data:image\//.test(imageBase64))
        return res.status(400).json({ error: 'imageBase64 (data:image/...) required' });
      const day = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
      const uploader = isAdmin(req) ? null : s.id;
      if (store) {
        const put = await media.putImage(store, `idcn/${course.code}/hub`, media.dataUrlBytes(imageBase64));
        await q(`INSERT INTO idc_hub_photos (course_code, media, day, width, height, uploader) VALUES ($1,$2,$3,$4,$5,$6)`,
          [course.code, put.ref, day, put.width, put.height, uploader]);
        photoCache.delete(course.code);
        return res.json({ success: true, url: media.linkFor(put.ref) });
      }
      const cloudinary = cloud();
      const up = await cloudinary.uploader.upload(imageBase64, {
        folder: `aybkk/${course.code}/${day}`,
        tags: [`aybkk-${course.code}`],
        resource_type: 'image',
      });
      // noted for the copy to R2; the answer does not wait on it
      q(`INSERT INTO idc_hub_photos (course_code, media, public_id, day, width, height, uploader)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (public_id) DO NOTHING`,
        [course.code, up.secure_url, up.public_id || null, day, up.width || null, up.height || null, uploader])
        .catch(e => console.warn('[idcn] photo hub: not noted for the copy:', e.message));
      photoCache.delete(course.code);
      res.json({ success: true, url: up.secure_url });
    } catch (e) { res.status(store && e.status === 400 ? 400 : 500).json({ error: e.message }); }
  });

  // ── admin (Boonchu + Jamsai, x-bkk-key) ───────────────────────────────────
  // never cached on the way, and the 401 names the key (as lib/staff-key.js does)
  const needAdmin = (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    if (!isAdmin(req)) {
      res.set('WWW-Authenticate', 'X-Bkk-Key').status(401).json({ error: 'bad key' }); return false;
    }
    return true;
  };
  const slugOf = v => String(v || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  app.post('/api/idcn/admin/:course/students', async (req, res) => {
    if (!needAdmin(req, res)) return;
    try {
      const course = await courseFor(req, res); if (!course) return;
      const b = req.body || {};
      const nameEn = String(b.nameEn || '').trim();
      if (!nameEn) return res.status(400).json({ error: 'nameEn required' });
      const slug = slugOf(b.slug || nameEn);
      if (!slug) return res.status(400).json({ error: 'slug required (latin letters)' });
      const passcode = newPasscode();
      try {
        const r = await q(
          `INSERT INTO idc_students (course_code, slug, name_en, name_zh, lang,
             key_hash, journal_url, is_attendee)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id, slug, name_en, name_zh, status`,
          [course.code, slug, nameEn, String(b.nameZh || '').trim() || null,
           ['zh', 'en'].includes(b.lang) ? b.lang : 'zh',
           sha(passcode), String(b.journalUrl || '').trim() || null,
           b.isAttendee === true]);
        res.json({ success: true, student: r.rows[0], passcode,
          link: `/${course.code}/${slug}`,
          note: 'Passcode is shown once. Send them the link and the passcode together.' });
      } catch (e) {
        if (String(e.message).includes('idc_students_course_code_slug_key'))
          return res.status(409).json({ error: `slug '${slug}' is taken in ${course.code}` });
        throw e;
      }
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/idcn/admin/:course/students', async (req, res) => {
    if (!needAdmin(req, res)) return;
    try {
      const course = await courseFor(req, res); if (!course) return;
      const rows = (await q(
        `SELECT s.id, s.slug, s.name_en, s.name_zh, s.lang, s.status,
                s.payment_option, s.is_attendee, s.journal_url, s.custom_plan,
                c.signed_at, c.signed_name, c.health_note, c.media_public, c.policy_version,
                c.plan AS signed_plan,
                (SELECT count(*)::int FROM idc_payments p WHERE p.student_id=s.id) AS proofs,
                (SELECT COALESCE(sum(p.amount_satang), 0)::bigint FROM idc_payments p
                  WHERE p.student_id=s.id) AS paid_satang,
                (SELECT count(*)::int FROM idc_notes n
                  WHERE n.student_id=s.id AND n.kind='submission') AS submissions,
                s.member_id, to_char(s.start_date, 'YYYY-MM-DD') AS start_date, s.cohort_note,
                s.terms_arranged,
                (SELECT count(*)::int FROM idc_notes n
                  WHERE n.student_id=s.id AND n.kind='comment') AS comments,
                (SELECT count(*)::int FROM idc_notes n
                  WHERE n.student_id=s.id AND n.kind='submission' AND n.session_no IS NOT NULL)
                  AS session_submissions
         FROM idc_students s
         LEFT JOIN idc_consents c ON c.student_id=s.id
         WHERE s.course_code=$1 ORDER BY s.name_en`, [course.code])).rows;
      const members = await liveMembers(rows.map(r => r.member_id).filter(x => x != null));
      res.json({ policyVersion: currentVersion(course), students: rows.map(r => {
        const version = r.policy_version || currentVersion(course);
        const terms = termsFor(course, version);
        const qt = studentQuote(terms, r);
        r.signed_plan = planOf(r.signed_plan);
        const m = r.member_id != null ? members.get(r.member_id) : null;
        return { ...r, paid_satang: Number(r.paid_satang), terms_version: version, quote: qt,
          // the live AYBKK profile (merges followed); null when not linked or gone
          member_code: m ? m.code : null, member_name: m ? m.name : null,
          // an option set under older terms for someone who never signed
          option_stale: r.payment_option != null && !terms.options[r.payment_option],
          held: heldFor(terms, r, !!r.signed_at, r.proofs),
          plan_changed: !!r.signed_plan && JSON.stringify(r.signed_plan)
            !== JSON.stringify((qt && qt.installments) || null),
          attendee_discount: !!terms.attendeePct, options: optionList(terms) };
      }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/idcn/admin/:course/students/:id', async (req, res) => {
    if (!needAdmin(req, res)) return;
    try {
      const course = await courseFor(req, res); if (!course) return;
      const b = req.body || {};
      const s = (await q('SELECT * FROM idc_students WHERE id=$1 AND course_code=$2',
        [Number(req.params.id), course.code])).rows[0];
      if (!s) return res.status(404).json({ error: 'not found' });
      const out = { success: true };
      // the IDCN#3 fields are all checked before anything below is written
      const set = {};
      if (b.memberCode !== undefined) {
        const code = String(b.memberCode || '').trim().toUpperCase();
        out.member = null;
        if (!code) set.member_id = null;
        else {
          const m = await memberByCode(code);
          if (!m) return res.status(400).json({ error: 'no AYBKK account has this member code' });
          const other = (await q(`SELECT slug FROM idc_students
            WHERE course_code=$1 AND id != $2 AND member_id = ANY($3::int[])`,
            [course.code, s.id, await foldedInto(m.id)])).rows[0];
          if (other) return res.status(409).json({ error: `this AYBKK account is already linked to ${other.slug}` });
          set.member_id = m.id; out.member = { code: m.code, name: m.name };
        }
      }
      if (b.startDate !== undefined) {
        const d = String(b.startDate || '').trim();
        if (d && !realYmd(d)) return res.status(400).json({ error: 'startDate is a date (YYYY-MM-DD)' });
        set.start_date = d || null;
      }
      if (b.note !== undefined) {
        const err = noteError(b.note);
        if (err) return res.status(400).json({ error: err });
        set.cohort_note = String(b.note || '').trim() || null;
      }
      if (b.termsArranged !== undefined) {
        if (typeof b.termsArranged !== 'boolean')
          return res.status(400).json({ error: 'termsArranged is true or false' });
        set.terms_arranged = b.termsArranged;
      }
      const cols = Object.keys(set);
      if (cols.length) {
        try {
          await q(`UPDATE idc_students SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')} WHERE id=$1`,
            [s.id, ...cols.map(c => set[c])]);
        } catch (e) {
          if (String(e.message).includes('idc_students_course_member'))
            return res.status(409).json({ error: 'this AYBKK account is already linked to another student' });
          throw e;
        }
        Object.assign(s, set);
      }
      if (b.resetKey === true) {
        const passcode = newPasscode();
        await q('UPDATE idc_students SET key_hash=$1 WHERE id=$2', [sha(passcode), s.id]);
        out.passcode = passcode;
      }
      if (b.journalUrl !== undefined)
        await q('UPDATE idc_students SET journal_url=$1 WHERE id=$2',
          [String(b.journalUrl || '').trim() || null, s.id]);
      const { terms, signed, paid } = await termsOf(course, s.id);
      if (b.isAttendee !== undefined) {
        if (!terms.attendeePct && b.isAttendee === true)
          return res.status(400).json({ error: 'these terms have no attendee discount' });
        await q('UPDATE idc_students SET is_attendee=$1 WHERE id=$2', [b.isAttendee === true, s.id]);
      }
      if (b.paymentOption !== undefined) {
        // the key (1, 4…) or its letter (A, B, C), within this student's terms
        const want = String(b.paymentOption).trim().toUpperCase();
        const opts = optionList(terms);
        const o = opts.find(x => String(x.key) === want || x.code === want);
        if (!o) return res.status(400).json({ error: 'option must be '
          + opts.map(x => x.code).join(', ').replace(/, ([^,]*)$/, ' or $1') });
        let plan = null;
        if (o.custom) {
          const err = planError(b.customPlan, feeWithVat(terms));
          if (err) return res.status(400).json({ error: err });
          plan = b.customPlan.map(p => ({ amountSatang: p.amountSatang, due: p.due }))
            .sort((x, y) => x.due.localeCompare(y.due));
        }
        if (heldFor(terms, s, signed, paid) && b.confirmHeld !== true)
          return res.status(409).json({ held: true, error: 'this student paid before they had an option '
            + 'of these terms: if that was under older terms, Boonchu decides what they pay first' });
        await q('UPDATE idc_students SET payment_option=$1, custom_plan=$2 WHERE id=$3',
          [o.key, plan && JSON.stringify(plan), s.id]);
      }
      if (b.status !== undefined) {
        if (!['invited', 'confirmed', 'completed', 'withdrawn'].includes(b.status))
          return res.status(400).json({ error: 'bad status' });
        await q('UPDATE idc_students SET status=$1 WHERE id=$2', [b.status, s.id]);
      }
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // payment proof: a screenshot Boonchu or Jamsai uploads onto the profile. A
  // screenshot that does not arrive never costs the payment row: it is saved,
  // marked, and the screenshot is sent again to /payments/:id/proof.
  // Proofs live OUTSIDE the tagged photo folders so they can never surface in any
  // moments/course feed (in R2: idcn/<course>/proof, opened only by a link that ends).
  async function pushProof(course, slug, dataUrl) {
    if (store) return (await media.putImage(store, `idcn/${course.code}/proof`, media.dataUrlBytes(dataUrl))).ref;
    const up = await cloud().uploader.upload(dataUrl, {
      folder: `aybkk/${course.code}/proofs/${slug}`, resource_type: 'image' });
    return up.secure_url;
  }
  const PAY_COLS = 'id, label, amount_satang, proof_url, note, created_at, proof_state';
  app.post('/api/idcn/admin/:course/students/:id/payments', async (req, res) => {
    if (!needAdmin(req, res)) return;
    try {
      const course = await courseFor(req, res); if (!course) return;
      const s = (await q('SELECT * FROM idc_students WHERE id=$1 AND course_code=$2',
        [Number(req.params.id), course.code])).rows[0];
      if (!s) return res.status(404).json({ error: 'not found' });
      const b = req.body || {};
      const label = String(b.label || '').trim();
      if (!label) return res.status(400).json({ error: 'label required (e.g. "60% deposit 定金")' });
      if (b.imageBase64 && !/^data:image\//.test(b.imageBase64))
        return res.status(400).json({ error: 'imageBase64 must be data:image/...' });
      const amount = b.amountSatang != null ? Number(b.amountSatang) : null;
      if (amount != null && (!Number.isSafeInteger(amount) || amount <= 0))
        return res.status(400).json({ error: 'amountSatang must be a positive integer' });
      let proofUrl = null, proofFailed = false;
      if (b.imageBase64) {
        try { proofUrl = await pushProof(course, s.slug, b.imageBase64); } catch (e) {
          proofFailed = true;
          console.warn('[idcn] a payment is saved without its screenshot:', e.message);
        }
      }
      const r = await q(
        `INSERT INTO idc_payments (student_id, label, amount_satang, proof_url, note, uploaded_by, proof_state)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${PAY_COLS}`,
        [s.id, label, amount, proofUrl, String(b.note || '').trim() || null,
         String(b.uploadedBy || 'AYBKK').slice(0, 60), proofFailed ? 'failed' : null]);
      res.json({ success: true, payment: payOut(r.rows[0]),
        ...(proofFailed ? { proofFailed: true, mediaError: 'the payment is saved, but the screenshot did not upload: send it again' } : {}) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // the screenshot of a payment saved without it, sent again
  app.post('/api/idcn/admin/:course/payments/:id/proof', async (req, res) => {
    if (!needAdmin(req, res)) return;
    try {
      const course = await courseFor(req, res); if (!course) return;
      const id = idParam(req.params.id);
      const p = id && (await q(`SELECT p.id, s.slug FROM idc_payments p JOIN idc_students s ON s.id = p.student_id
        WHERE p.id=$1 AND s.course_code=$2 AND p.proof_state='failed'`, [id, course.code])).rows[0];
      if (!p) return res.status(404).json({ error: 'no payment is waiting for its screenshot' });
      const img = (req.body || {}).imageBase64;
      if (!img || !/^data:image\//.test(img)) return res.status(400).json({ error: 'imageBase64 must be data:image/...' });
      let url;
      try { url = await pushProof(course, p.slug, img); } catch (e) {
        console.warn('[idcn] a payment screenshot did not arrive again:', e.message);
        return res.status(e.status === 400 ? 400 : 502).json({ error: 'the screenshot did not upload: try again' });
      }
      const r = await q(`UPDATE idc_payments SET proof_url=$2, proof_state=NULL WHERE id=$1 AND proof_state='failed'
        RETURNING ${PAY_COLS}`, [p.id, url]);
      if (!r.rowCount) return res.status(409).json({ error: 'this payment has its screenshot already' });
      res.json({ success: true, payment: payOut(r.rows[0]) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // a note or assignment into one profile, or every profile in the course —
  // multipart so an assignment can carry a demo video (uploaded once, the URL
  // shared by every recipient)
  // With sessionNo the note belongs to that session of the calendar (all=true:
  // every non-withdrawn student gets it under the same session).
  app.post('/api/idcn/admin/:course/notes', (req, res) => mediaUpload(req, res, async (mErr) => {
    if (!needAdmin(req, res)) return dropUpload(req);
    try {
      if (mErr) return res.status(400).json({ error: mErr.code === 'LIMIT_FILE_SIZE'
        ? 'video too large — keep it under 100MB' : mErr.message });
      const course = await courseFor(req, res); if (!course) return;
      const b = req.body || {};
      const kind = b.kind === 'assignment' ? 'assignment' : 'note';
      const body = String(b.body || '').trim();
      if (!body) return res.status(400).json({ error: 'body required' });
      const sessionNo = sessionField(b.sessionNo);
      if (sessionNo === false) return res.status(400).json({ error: 'sessionNo is a session number (1 to 99)' });
      if (sessionNo != null && !(await sessionExists(course.code, sessionNo)))
        return res.status(400).json({ error: `there is no session #${sessionNo} in the calendar` });
      let ids;
      if (b.all === true || b.all === 'true') {
        ids = (await q(
          `SELECT id FROM idc_students WHERE course_code=$1 AND status != 'withdrawn'`,
          [course.code])).rows.map(r => r.id);
      } else {
        const s = (await q('SELECT id FROM idc_students WHERE id=$1 AND course_code=$2',
          [Number(b.studentId), course.code])).rows[0];
        if (!s) return res.status(404).json({ error: 'student not found' });
        ids = [s.id];
      }
      // a file that does not arrive: the notes go out without it, all marked with one
      // batch, and the file sent again to /notes/<any of them>/media reaches them all
      let up = { url: null, type: null }, batch = null;
      if (req.file) {
        try { up = await pushMedia(req.file, `aybkk/${course.code}/assignments`, `idcn/${course.code}/note`); } catch (e) {
          batch = crypto.randomBytes(8).toString('hex');
          up = { url: null, type: /^video\//.test(req.file.mimetype || '') ? 'video' : 'image' };
          console.warn('[idcn] a note is sent without its file:', e.message);
        }
      }
      let firstId = null;
      for (const id of ids) {
        const r = await q(`INSERT INTO idc_notes (student_id, kind, title, body, created_by, media_url, media_type, session_no,
                   media_state, media_batch)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [id, kind, String(b.title || '').slice(0, 200) || null, body.slice(0, 8000),
           String(b.createdBy || 'AYBKK').slice(0, 60), up.url, up.type, sessionNo, batch ? 'failed' : null, batch]);
        if (firstId == null) firstId = r.rows[0].id;
      }
      res.json({ success: true, sentTo: ids.length, ...(sessionNo != null ? { session: sessionNo } : {}),
        ...(batch && firstId != null ? { ...FILE_AGAIN, retryId: firstId } : {}) });
    } catch (e) { res.status(500).json({ error: e.message }); }
    finally { dropUpload(req); }
  }));

  // The file of a note (or a hand-in) saved without it, sent again: it reaches every
  // note of the same send.
  app.post('/api/idcn/admin/:course/notes/:id/media', (req, res) => mediaUpload(req, res, async (mErr) => {
    if (!needAdmin(req, res)) return dropUpload(req);
    try {
      if (mErr) return res.status(400).json({ error: mErr.code === 'LIMIT_FILE_SIZE'
        ? 'video too large: keep it under 100MB' : mErr.message });
      const course = await courseFor(req, res); if (!course) return;
      const id = idParam(req.params.id);
      const n = id && (await q(`SELECT n.id, n.kind, n.media_batch, s.slug FROM idc_notes n JOIN idc_students s ON s.id = n.student_id
        WHERE n.id=$1 AND s.course_code=$2 AND n.media_state='failed'`, [id, course.code])).rows[0];
      if (!n) return res.status(404).json({ error: 'no note is waiting for its file' });
      if (!req.file) return res.status(400).json({ error: 'attach the video (or photo) file' });
      let up;
      try {
        up = n.kind === 'submission'
          ? await pushMedia(req.file, `aybkk/${course.code}/submissions/${n.slug}`, `idcn/${course.code}/sub`)
          : await pushMedia(req.file, `aybkk/${course.code}/assignments`, `idcn/${course.code}/note`);
      } catch (e) {
        console.warn('[idcn] a note file did not arrive again:', e.message);
        return res.status(e.status === 400 ? 400 : 502).json({ error: FILE_AGAIN.mediaError });
      }
      const r = await q(`UPDATE idc_notes n SET media_url=$3, media_type=$4, media_state=NULL FROM idc_students s
        WHERE s.id = n.student_id AND s.course_code=$2 AND n.media_state='failed'
          AND (n.id=$1 OR (n.media_batch IS NOT NULL AND n.media_batch=$5))`,
        [n.id, course.code, up.url, up.type, n.media_batch]);
      res.json({ success: true, updated: r.rowCount });
    } catch (e) { res.status(500).json({ error: e.message }); }
    finally { dropUpload(req); }
  }));

  // ── /md: course files in R2, served by this site ──────────────────────────
  // Not under /api. Only a signed link opens a file (lib/media-store.js), and nothing
  // on the way keeps a copy (private), so a link that ended opens nothing. A video
  // plays by byte ranges. With R2 off a signed link is a 503 nobody keeps; any other
  // /md path is passed on, as when there was no such route.
  app.get(/^\/md\/(\d{1,12})\.([\w-]{22})\/(idcn\/[\w/.-]{1,120})$/, async (req, res, next) => {
    const [exp, sig, key] = [req.params[0], req.params[1], req.params[2]];
    const check = media.mdCheck(exp, sig, key);
    const no = (status, error) => res.status(status).set('Cache-Control', 'no-store').json({ error });
    if (check === 'bad') return store ? no(403, 'bad link') : next();
    if (!store) return no(503, 'file storage is switched off');
    if (check === 'expired') return no(403, 'this link has ended: reload the page');
    try {
      await media.sendObject(req, res, store, key, exp === '0' ? 'private, max-age=86400' : 'private, max-age=3600');
    } catch (e) {
      console.warn('[idcn] /md not served:', e.message);
      if (!res.headersSent) no(502, 'file not available');
    }
  });

  // ── one press: the course files still only on Cloudinary, copied into R2 ──
  // Hub photos, hand-ins and notes, payment screenshots, in the background. A row is
  // pointed at its copy only after a HEAD of the copy matches the original (size and
  // MD5); Cloudinary's file is kept. Pressed again it copies only what is left.
  // Counts of files only.
  const copyJobs = new Map();
  async function copyCourse(code, job) {
    const one = async (part, url, prefix, fallback, ms, point) => {
      try {
        const key = `${prefix}/${crypto.randomBytes(16).toString('hex')}.${media.extOf(url, fallback)}`;
        await media.copyIn(store, url, key, { fetch: httpFetch, ms });
        await point(media.REF + key);
        job[part].copied++;
      } catch (e) {
        job[part].failed++;
        if (e.r2) throw e;      // R2 itself refused: the next ones would fail the same way
      }
    };
    // hub photos: the ones noted here, and the tag search for the ones from before the list
    let listed = null;
    try { listed = (await within(hubSearch(code), 30000)).resources || []; } catch (e) {
      job.errors.push(`Cloudinary search: ${e.message || 'no answer'}`);
    }
    const rows = (await q(`SELECT media, public_id FROM idc_hub_photos WHERE course_code=$1`, [code])).rows;
    const done = new Set(rows.filter(r => media.isRef(r.media)).map(r => r.public_id).filter(Boolean));
    const hub = new Map();
    for (const r of rows) if (!media.isRef(r.media) && media.CLOUD.test(r.media)) hub.set(r.public_id || r.media, { url: r.media, row: true });
    for (const r of listed || []) if (!done.has(r.public_id) && !hub.has(r.public_id) && media.CLOUD.test(r.secure_url || ''))
      hub.set(r.public_id, { url: r.secure_url, public_id: r.public_id, day: hubDay(r), at: r.created_at, w: r.width, h: r.height });
    job.hub.left = hub.size;
    for (const t of hub.values()) await one('hub', t.url, `idcn/${code}/hub`, 'jpg', 60000, async ref => {
      if (t.row) await q(`UPDATE idc_hub_photos SET media=$3 WHERE course_code=$1 AND media=$2`, [code, t.url, ref]);
      else await q(`INSERT INTO idc_hub_photos (course_code, media, public_id, day, width, height, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, now()))
          ON CONFLICT (public_id) DO UPDATE SET media=EXCLUDED.media WHERE idc_hub_photos.media NOT LIKE 'r2:%'`,
        [code, ref, t.public_id, t.day, t.w || null, t.h || null, t.at || null]);
      job.hub.left--;
    });
    if (listed && !job.hub.left) await q(`INSERT INTO idc_settings (course_code, key, value) VALUES ($1,'hub_copied','true')
      ON CONFLICT (course_code, key) DO UPDATE SET value='true', updated_at=now()`, [code]);
    photoCache.delete(code);
    // hand-ins and notes (a note sent to everyone shares one file)
    const notes = (await q(`SELECT DISTINCT n.media_url, n.media_type FROM idc_notes n JOIN idc_students s ON s.id = n.student_id
      WHERE s.course_code=$1 AND n.media_url LIKE 'https://res.cloudinary.com/%'`, [code])).rows;
    job.notes.left = notes.length;
    for (const n of notes) {
      const video = n.media_type === 'video';
      await one('notes', n.media_url, `idcn/${code}/${/\/submissions\//.test(n.media_url) ? 'sub' : 'note'}`,
        video ? 'mp4' : 'jpg', video ? 300000 : 60000, async ref => {
          await q(`UPDATE idc_notes n SET media_url=$3 FROM idc_students s
            WHERE s.id = n.student_id AND s.course_code=$1 AND n.media_url=$2`, [code, n.media_url, ref]);
          job.notes.left--;
        });
    }
    // payment screenshots
    const proofs = (await q(`SELECT DISTINCT p.proof_url FROM idc_payments p JOIN idc_students s ON s.id = p.student_id
      WHERE s.course_code=$1 AND p.proof_url LIKE 'https://res.cloudinary.com/%'`, [code])).rows;
    job.proofs.left = proofs.length;
    for (const p of proofs) await one('proofs', p.proof_url, `idcn/${code}/proof`, 'jpg', 60000, async ref => {
      await q(`UPDATE idc_payments p SET proof_url=$3 FROM idc_students s
        WHERE s.id = p.student_id AND s.course_code=$1 AND p.proof_url=$2`, [code, p.proof_url, ref]);
      job.proofs.left--;
    });
  }
  app.get('/api/idcn/admin/:course/media-copy', async (req, res) => {
    if (!needAdmin(req, res)) return;
    try {
      const course = await courseFor(req, res); if (!course) return;
      res.json({ r2: !!store, ...(copyJobs.get(course.code) || { running: false }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/idcn/admin/:course/media-copy', async (req, res) => {
    if (!needAdmin(req, res)) return;
    try {
      const course = await courseFor(req, res); if (!course) return;
      if (!store) return res.status(409).json({ error: 'R2 is not set up: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET are needed in Railway.' });
      let job = copyJobs.get(course.code);
      if (!job || !job.running) {
        const part = () => ({ copied: 0, failed: 0, left: null });
        job = { running: true, startedAt: new Date().toISOString(), finishedAt: null,
          hub: part(), notes: part(), proofs: part(), errors: [] };
        copyJobs.set(course.code, job);
        copyCourse(course.code, job).catch(e => job.errors.push(e.message))
          .finally(() => { job.running = false; job.finishedAt = new Date().toISOString(); });
      }
      res.status(202).json({ r2: true, ...job });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/idcn/admin/:course/links', async (req, res) => {
    if (!needAdmin(req, res)) return;
    try {
      const course = await courseFor(req, res); if (!course) return;
      const r = (await q(`SELECT value FROM idc_settings WHERE course_code=$1 AND key='links'`,
        [course.code])).rows[0];
      res.json({ links: (r && r.value) || [] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/idcn/admin/:course/links', async (req, res) => {
    if (!needAdmin(req, res)) return;
    try {
      const course = await courseFor(req, res); if (!course) return;
      const links = Array.isArray((req.body || {}).links) ? req.body.links : null;
      if (!links) return res.status(400).json({ error: 'links must be an array' });
      const clean = links.map(l => ({
        title_en: String(l.title_en || '').slice(0, 200),
        title_zh: String(l.title_zh || '').slice(0, 200),
        url: String(l.url || '').slice(0, 500),
      })).filter(l => l.url && (l.title_en || l.title_zh));
      await q(`INSERT INTO idc_settings (course_code, key, value) VALUES ($1,'links',$2)
        ON CONFLICT (course_code, key) DO UPDATE SET value=$2, updated_at=now()`,
        [course.code, JSON.stringify(clean)]);
      res.json({ success: true, links: clean });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── IDCN#3 (24 Nov 2026): the roster in one go, the calendar, daily work ──
  class RowError extends Error { constructor(field, msg) { super(msg); this.field = field; } }
  const BULK_MAX = 30;
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // One roster line: an existing student of the course (same AYBKK account first,
  // then the same link name) only gets its empty fields filled; anyone else is
  // created like the single add, passcode once.
  async function bulkRow(db, course, r, row, { dryRun, seen }) {
    const nameEn = String(r.nameEn || '').trim();
    if (!nameEn) throw new RowError('nameEn', 'the name in latin letters is needed');
    if (nameEn.length > 120) throw new RowError('nameEn', 'the name holds at most 120 characters');
    const nameZh = String(r.nameZh || '').trim() || null;
    if (nameZh && nameZh.length > 120) throw new RowError('nameZh', 'the name holds at most 120 characters');
    const slug = slugOf(r.slug || nameEn);
    if (!slug) throw new RowError('nameEn', 'the name needs latin letters for the link');
    const startDate = String(r.startDate || '').trim() || null;
    if (startDate && !realYmd(startDate)) throw new RowError('startDate', 'the start date is YYYY-MM-DD');
    const noteErr = noteError(r.note);
    if (noteErr) throw new RowError('note', noteErr);
    const note = String(r.note || '').trim() || null;
    if (r.arranged != null && typeof r.arranged !== 'boolean')
      throw new RowError('arranged', 'arranged is true or false');
    const arranged = r.arranged === true;
    const lang = ['zh', 'en'].includes(r.lang) ? r.lang : 'zh';

    let member = null, memberNew = false;
    const given = String(r.member || '').trim();
    if (given) {
      // codes made before 8 Oct 2026 are shorter, so any code an account has is taken
      if (!given.includes('@')) {
        if (given.length > 40 || /\s/.test(given)) throw new RowError('member', 'member is an AYBKK member code or an email');
        member = await memberByCode(given.toUpperCase(), db);
        if (!member) throw new RowError('member', 'no AYBKK account has this member code');
      } else if (EMAIL.test(given)) {
        member = await memberByEmail(given, db);
        if (!member) {
          const bkk = await bkkOf();
          if (!bkk || typeof bkk.findOrCreateMember !== 'function')
            throw new RowError('member', 'cannot create a member here');
          const made = await bkk.findOrCreateMember({ name: nameEn, email: given }, db);
          member = (await liveMembers([made.id], db)).get(made.id) || { id: made.id, code: made.code, name: made.name };
          // made in this transaction (created_at is its start), or found by bkk's own email rules
          memberNew = (await db.query('SELECT created_at = now() AS fresh FROM bkk_members WHERE id=$1',
            [made.id])).rows[0].fresh === true;
        }
      } else throw new RowError('member', 'member is an AYBKK member code or an email');
    }
    if (member && memberNew) seen.members.add(member.id);
    // an account an earlier line of this same preview made is still only a plan
    const planned = dryRun && member && seen.members.has(member.id);
    const memberOut = member
      ? { code: planned ? null : member.code, name: member.name, created: memberNew || planned } : null;

    let ex = null;
    if (member) ex = (await db.query(
      `SELECT * FROM idc_students WHERE course_code=$1 AND member_id = ANY($2::int[]) ORDER BY id LIMIT 1`,
      [course.code, await foldedInto(member.id, db)])).rows[0] || null;
    let exMember = null;
    if (!ex) {
      ex = (await db.query('SELECT * FROM idc_students WHERE course_code=$1 AND slug=$2',
        [course.code, slug])).rows[0] || null;
      if (ex && ex.member_id != null) {
        exMember = (await liveMembers([ex.member_id], db)).get(ex.member_id) || null;
        if (member && (!exMember || exMember.id !== member.id))
          throw new RowError('member', `${slug} is linked to another AYBKK account`);
      }
    }
    if (ex) {
      const set = {}, filled = [], kept = [];
      const fill = (col, field, v, now) => {
        if (v == null || v === false) return;
        if (ex[col] == null || ex[col] === false) { set[col] = v; filled.push(field); }
        else if (now !== v) kept.push(field);
      };
      // a linked row was matched by this same account, so only an unlinked one takes it
      if (member && ex.member_id == null) { set.member_id = member.id; filled.push('member'); }
      fill('start_date', 'startDate', startDate, ymd(ex.start_date));
      fill('cohort_note', 'note', note, ex.cohort_note);
      fill('name_zh', 'nameZh', nameZh, ex.name_zh);
      fill('terms_arranged', 'arranged', arranged, ex.terms_arranged);
      const cols = Object.keys(set);
      if (cols.length) await db.query(
        `UPDATE idc_students SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')} WHERE id=$1`,
        [ex.id, ...cols.map(c => set[c])]);
      const sameAs = seen.students.get(ex.id);
      return { row, action: 'exists', ...(dryRun && sameAs ? { sameAs } : { id: ex.id }), slug: ex.slug, status: ex.status,
        link: `/${course.code}/${ex.slug}`, filled, kept,
        member: memberOut || (exMember ? { code: exMember.code, name: exMember.name, created: false } : null) };
    }
    const passcode = newPasscode();
    let made;
    try {
      made = (await db.query(
        `INSERT INTO idc_students (course_code, slug, name_en, name_zh, lang, key_hash,
           member_id, start_date, cohort_note, terms_arranged)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [course.code, slug, nameEn, nameZh, lang, sha(passcode), member ? member.id : null,
         startDate, note, arranged])).rows[0];
    } catch (e) {
      if (String(e.message).includes('idc_students_course_code_slug_key'))
        throw new RowError('nameEn', `the link name '${slug}' is taken`);
      if (String(e.message).includes('idc_students_course_member'))
        throw new RowError('member', 'this AYBKK account is already linked to another student');
      throw e;
    }
    seen.students.set(made.id, row);
    const out = { row, action: 'created', slug, link: `/${course.code}/${slug}`, member: memberOut };
    if (!dryRun) Object.assign(out, { id: made.id, passcode });
    return out;
  }

  app.post('/api/idcn/admin/:course/students/bulk', async (req, res) => {
    if (!needAdmin(req, res)) return;
    let client = null;
    try {
      const course = await courseFor(req, res); if (!course) return;
      const b = req.body || {};
      const rows = Array.isArray(b.rows) ? b.rows : null;
      if (!rows || !rows.length) return res.status(400).json({ error: 'rows is the list of students' });
      if (rows.length > BULK_MAX) return res.status(400).json({ error: `at most ${BULK_MAX} students at a time` });
      const dryRun = b.dryRun === true || b.dryRun === 'true';
      client = await pool.connect();
      await client.query('BEGIN');
      // one roster at a time per course, so a double click never adds anyone twice
      await client.query('SELECT 1 FROM idc_courses WHERE code=$1 FOR UPDATE', [course.code]);
      const results = [], seen = { members: new Set(), students: new Map() };
      for (let i = 0; i < rows.length; i++) {
        await client.query('SAVEPOINT roster_row');
        try {
          const r = rows[i] && typeof rows[i] === 'object' ? rows[i] : {};
          results.push(await bulkRow(client, course, r, i + 1, { dryRun, seen }));
          await client.query('RELEASE SAVEPOINT roster_row');
        } catch (e) {
          await client.query('ROLLBACK TO SAVEPOINT roster_row');
          if (!(e instanceof RowError)) throw e;
          results.push({ row: i + 1, action: 'error', field: e.field, error: e.message });
        }
      }
      await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
      const counts = { created: 0, exists: 0, error: 0 };
      for (const r of results) counts[r.action]++;
      res.json({ success: true, dryRun, counts, results,
        ...(counts.created && !dryRun ? { note: 'Passcodes are shown once.' } : {}) });
    } catch (e) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: e.message });
    } finally { if (client) client.release(); }
  });

  // the calendar: { text } as pasted, or { rows, slots }; a CalError is a 400 with its line
  const CAL_TEXT_MAX = 200000;
  function calendarFrom(b) {
    if (typeof b.text === 'string') {
      if (b.text.length > CAL_TEXT_MAX) throw new CalError('the text is too long for a calendar', null);
      return parseCalendar(b.text);
    }
    if (Array.isArray(b.rows)) {
      if (b.rows.length > CAL_MAX_DAY) throw new CalError(`a calendar has at most ${CAL_MAX_DAY} days`, null);
      const out = checkDays(b.rows.map((r, i) => ({ ...(r && typeof r === 'object' ? r : {}), line: i + 1 })));
      const slots = {};
      if (b.slots != null) {
        if (typeof b.slots !== 'object') throw new CalError('slots is { "A": "10:30-12:30", "B": "13:00-16:00" }', null);
        for (const k of ['A', 'B']) {
          if (b.slots[k] == null || String(b.slots[k]).trim() === '') continue;
          const t = timeRange(b.slots[k]);
          if (!t) throw new CalError(`Slot ${k}: write the time as 10:30-12:30`, null);
          slots[k] = t;
        }
      }
      if (!out.days.length) out.warnings.push('the calendar is empty');
      return { ...out, slots };
    }
    throw new CalError('send the pasted table as text, or the days as rows', null);
  }

  app.get('/api/idcn/admin/:course/days', async (req, res) => {
    if (!needAdmin(req, res)) return;
    try {
      const course = await courseFor(req, res); if (!course) return;
      res.json(await calendarOf(course.code));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Replaces every day and session of the course in one go (dryRun: only shows it).
  app.put('/api/idcn/admin/:course/days', async (req, res) => {
    if (!needAdmin(req, res)) return;
    let client = null;
    try {
      const course = await courseFor(req, res); if (!course) return;
      const b = req.body || {};
      let cal;
      try { cal = calendarFrom(b); } catch (e) {
        if (e instanceof CalError) return res.status(400).json({ error: e.message, line: e.line });
        throw e;
      }
      const slots = { A: null, B: null, ...((await getSetting(course.code, 'slots')) || {}), ...cal.slots };
      // work already saved under a session or day this calendar does not have
      const sessionNos = new Set(cal.sessions.map(s => s.no)), dayNos = new Set(cal.days.map(d => d.day));
      const dated = (await q(
        `SELECT DISTINCT n.session_no, n.day_no FROM idc_notes n JOIN idc_students s ON s.id = n.student_id
         WHERE s.course_code=$1 AND (n.session_no IS NOT NULL OR n.day_no IS NOT NULL)`, [course.code])).rows;
      const lostS = [...new Set(dated.map(x => x.session_no).filter(n => n != null && !sessionNos.has(n)))].sort((a, b) => a - b);
      const lostD = [...new Set(dated.map(x => x.day_no).filter(n => n != null && !dayNos.has(n)))].sort((a, b) => a - b);
      const warnings = [...cal.warnings];
      if (lostS.length) warnings.push(`work saved under session #${lostS.join(', #')} is kept, but this calendar `
        + 'has no such session, so nobody sees it until the session is back');
      if (lostD.length) warnings.push(`teacher comments saved for ${dayList(lostD)} are kept, but this calendar `
        + 'has no such day, so nobody sees them until the day is back');
      const dryRun = b.dryRun === true || b.dryRun === 'true';
      if (!dryRun) {
        client = await pool.connect();
        await client.query('BEGIN');
        await client.query('SELECT 1 FROM idc_courses WHERE code=$1 FOR UPDATE', [course.code]);
        await client.query('DELETE FROM idc_sessions WHERE course_code=$1', [course.code]);
        await client.query('DELETE FROM idc_days WHERE course_code=$1', [course.code]);
        const col = k => cal.days.map(d => d[k]);
        if (cal.days.length) await client.query(
          `INSERT INTO idc_days (course_code, day_no, date, weekday, morning, slot_a, slot_b, note)
           SELECT $1, * FROM unnest($2::int[], $3::date[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[])`,
          [course.code, col('day'), col('date'), col('weekday'), col('morning'), col('slotA'), col('slotB'), col('note')]);
        if (cal.sessions.length) await client.query(
          `INSERT INTO idc_sessions (course_code, session_no, day_no, slot, title)
           SELECT $1, * FROM unnest($2::int[], $3::int[], $4::text[], $5::text[])`,
          [course.code, cal.sessions.map(s => s.no), cal.sessions.map(s => s.day),
           cal.sessions.map(s => s.slot), cal.sessions.map(s => s.title)]);
        await client.query(`INSERT INTO idc_settings (course_code, key, value) VALUES ($1,'slots',$2)
          ON CONFLICT (course_code, key) DO UPDATE SET value=$2, updated_at=now()`,
          [course.code, JSON.stringify(slots)]);
        await client.query('COMMIT');
      }
      res.json({ success: true, dryRun, saved: !dryRun, days: cal.days, sessions: cal.sessions, slots, warnings });
    } catch (e) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: e.message });
    } finally { if (client) client.release(); }
  });

  const dayIn = async (code, day) => Number.isSafeInteger(day)
    && (await q('SELECT 1 FROM idc_days WHERE course_code=$1 AND day_no=$2', [code, day])).rowCount > 0;
  const idParam = v => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };

  // The teacher's comment for one student on one day: saved again it is edited,
  // saved empty it is gone.
  app.put('/api/idcn/admin/:course/students/:id/comments/:day', async (req, res) => {
    if (!needAdmin(req, res)) return;
    try {
      const course = await courseFor(req, res); if (!course) return;
      const id = idParam(req.params.id);
      const s = id && (await q('SELECT id FROM idc_students WHERE id=$1 AND course_code=$2',
        [id, course.code])).rows[0];
      if (!s) return res.status(404).json({ error: 'student not found' });
      const day = Number(req.params.day);
      if (!(await dayIn(course.code, day)))
        return res.status(404).json({ error: `there is no day ${String(req.params.day).slice(0, 10)} in the calendar` });
      const b = req.body || {};
      const body = String(b.body || '').trim();
      if (!body) {
        const gone = await q(`DELETE FROM idc_notes WHERE student_id=$1 AND day_no=$2 AND kind='comment'`, [s.id, day]);
        return res.json({ success: true, comment: null, deleted: gone.rowCount > 0 });
      }
      if (body.length > 4000) return res.status(400).json({ error: 'keep the comment under 4000 characters' });
      const by = String(b.by || '').trim().slice(0, 40) || 'teacher';
      const r = await q(
        `INSERT INTO idc_notes (student_id, kind, body, created_by, day_no, updated_at)
         VALUES ($1,'comment',$2,$3,$4,now())
         ON CONFLICT (student_id, day_no) WHERE kind='comment'
         DO UPDATE SET body=EXCLUDED.body, created_by=EXCLUDED.created_by, updated_at=now()
         RETURNING ${NOTE_COLS}`, [s.id, body, by, day]);
      res.json({ success: true, comment: noteOut(r.rows[0]) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // One day for the teacher: its schedule and sessions, and every student still on
  // the course with that day's assignments, hand-ins and comment.
  app.get('/api/idcn/admin/:course/days/:day/overview', async (req, res) => {
    if (!needAdmin(req, res)) return;
    try {
      const course = await courseFor(req, res); if (!course) return;
      const day = Number(req.params.day);
      const cal = await calendarOf(course.code);
      const d = cal.days.find(x => x.day === day);
      if (!d) return res.status(404).json({ error: `there is no day ${String(req.params.day).slice(0, 10)} in the calendar` });
      const nos = d.sessions.map(x => x.no);
      const students = (await q(
        `SELECT id, slug, name_en, name_zh, status, to_char(start_date, 'YYYY-MM-DD') AS start_date
         FROM idc_students WHERE course_code=$1 AND status != 'withdrawn' ORDER BY name_en, id`,
        [course.code])).rows;
      const notes = (await q(
        `SELECT n.student_id, ${NOTE_FIELDS.map(c => 'n.' + c).join(', ')}
         FROM idc_notes n JOIN idc_students s ON s.id = n.student_id
         WHERE s.course_code=$1 AND s.status != 'withdrawn'
           AND ((n.kind='comment' AND n.day_no=$2) OR (n.kind != 'comment' AND n.session_no = ANY($3::int[])))
         ORDER BY n.id`, [course.code, day, nos])).rows;
      const byStudent = new Map(students.map(s => [s.id, []]));
      for (const n of notes) if (byStudent.has(n.student_id)) byStudent.get(n.student_id).push(n);
      res.json({ day: d, slots: cal.slots, students: students.map(s => {
        const w = workOf(byStudent.get(s.id));
        return { id: s.id, slug: s.slug, name_en: s.name_en, name_zh: s.name_zh, status: s.status,
          start_date: s.start_date, beforeStart: !!s.start_date && d.date < s.start_date,
          sessionsWork: Object.fromEntries(nos.map(no => [no, w.sessionsWork[no] || { assignments: [], submissions: [] }])),
          comment: w.comments[day] || null };
      }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // a note, assignment, hand-in or comment put in by mistake (its file stays where it is)
  app.delete('/api/idcn/admin/:course/notes/:id', async (req, res) => {
    if (!needAdmin(req, res)) return;
    try {
      const course = await courseFor(req, res); if (!course) return;
      const id = idParam(req.params.id);
      const r = id ? await q(`DELETE FROM idc_notes n USING idc_students s
        WHERE n.id=$1 AND s.id = n.student_id AND s.course_code=$2 RETURNING n.id, n.kind`, [id, course.code]) : null;
      if (!r || !r.rowCount) return res.status(404).json({ error: 'note not found' });
      res.json({ success: true, id: r.rows[0].id, kind: r.rows[0].kind });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // The staff sign-in link of bkk's admin (same token table, days and short /in/ code),
  // for the student's linked AYBKK account: it opens My account, which links the course page.
  app.post('/api/idcn/admin/:course/students/:id/login-link', async (req, res) => {
    if (!needAdmin(req, res)) return;
    try {
      const course = await courseFor(req, res); if (!course) return;
      const id = idParam(req.params.id);
      const s = id && (await q('SELECT id, member_id FROM idc_students WHERE id=$1 AND course_code=$2',
        [id, course.code])).rows[0];
      if (!s) return res.status(404).json({ error: 'student not found' });
      if (s.member_id == null) return res.status(409).json({ error: 'link this student to an AYBKK account first' });
      const m = (await liveMembers([s.member_id])).get(s.member_id);
      const bkk = m ? await bkkOf() : null;
      if (m && (!bkk || typeof bkk.staffSigninLink !== 'function'))
        return res.status(503).json({ error: 'sign-in links are not available on this server' });
      const made = m ? await bkk.staffSigninLink(m.id) : null;
      if (!made) return res.status(409).json({ error: 'the linked AYBKK account is not there any more: link it again' });
      res.json({ success: true, link: made.link, short_link: made.short_link, days: made.days, name: made.name });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  initSchema()
    .then(() => console.log('✓ idcn-api mounted (/api/idcn/*)'))
    .catch(e => console.error('✗ idcn-api schema init failed:', e.message));
}

module.exports = { mountIdcn, quote, applyPct, planError, termsFor, IDCN3_TERMS, IDCN3_TERMS_V4,
  IDCN3_POLICY_VERSION, TERMS_BY_POLICY, parseCalendar };
