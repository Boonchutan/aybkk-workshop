// team-brief.js: the team briefs, sent by the main AYBKK LINE Official Account
// (the same account students follow, token LINE_CHANNEL_ACCESS_TOKEN) to the one
// staff LINE group accepted in Admin:
//   morning        the teaching brief for today, per shala class (booked,
//                  drop-ins, first class, first week, mats), online classes
//                  apart, then who bought and never came, whose pass is ending
//                  and who has not paid. Bangkok time by weekday (BRIEF_AT):
//                  Tue to Fri 05:00, Mon 05:30, Sat and Sun 06:00.
//   20:00 Bangkok  the summary of the day on aybkk.net
//   any time       a message Boonchu approved through the Desk assistant
//
// Mount:  const team = mountTeam(app, { pgPool, cloudinary, driver })
//         team.start() runs the minute timer. server.js calls it; tests call
//         team.tick(fakeNow) instead, so nothing runs on a clock in a test.
//         team.takeLine(req): server.js's LINE webhook (/line/webhook) hands
//         each request here too, next to inbox.takeLine(req).
//
// Env:    LINE_CHANNEL_SECRET        checks the webhook's signature
//         LINE_CHANNEL_ACCESS_TOKEN  pushes to the group (shared with server.js)
//
// From the webhook only which groups the account is in is kept. Text written in
// a group or a 1:1 chat is never read, stored or logged here, and nothing is
// ever sent back to a group: the briefs are scheduled pushes. The main account
// is in several staff groups and anyone can add it to a group of their own,
// while the briefs carry student names: so no group is ever saved by itself,
// not even the first. Every group it hears of (a join, a message, a member
// joining), or that staff add by its ID, waits until staff accept it
// (POST /api/bkk/admin/team/group). Until 19 Nov 2026 a second LINE account
// sent the briefs and kept its group and switches under the same keys: once per
// database (the marker 'team_line_sender') all of that is cleared, so the main
// account starts with no group, nothing waiting and both briefs off.
// Briefs name students by first name and family initial only: no email, phone
// or member code ever goes to LINE.
// The Thai brief keeps class and package names in the original English
// ('Mysore (1st batch)', '1 month unlimited', 'Drop-in'), and every student and
// teacher name is written as stored, never transliterated (Boonchu, 7 Nov 2026).

const crypto = require('crypto');
const { moonDaysBetween, rotationTeacher } = require('./bkk-api');
const { telegram } = require('./inbox');

const LINE_API = 'https://api.line.me/v2/bot';
const PUSH_MAX = 5;                  // message objects per push
const TEXT_MAX = 5000;               // characters per text message
const URL_MAX = 2000;                // LINE's limit for an image URL
const SEND_MAX = PUSH_MAX * TEXT_MAX;
// Bangkok send time. Morning by weekday, 0 Sunday (Boonchu, 18 Nov 2026): 05:00
// on the Mysore days (first class 05:30), 05:30 on Monday (Led Primary 06:30),
// 06:00 on Sunday (Mysore 07:00) and on Saturday, one brief for both Led
// classes (07:00 and 08:45). A moon day or a closed day keeps its weekday's time.
const BRIEF_AT = { morning: ['06:00', '05:30', '05:00', '05:00', '05:00', '05:00', '06:00'], evening: '20:00' };
const briefAt = (kind, ymd) => {
  const t = BRIEF_AT[kind];
  return Array.isArray(t) ? t[new Date(`${ymd}T12:00:00Z`).getUTCDay()] : t;
};
const LATE_MIN = 60;                 // a server that was down sends late, up to this
const TRIES = 3;                     // per brief per day, only when LINE did not answer
const GROUPS_KEPT = 100;             // groups seen, newest first: the saved one is always kept
// A LINE group ID: C and 32 hex characters, as LINE writes it (lower case).
const GROUP_ID_RE = /^C[0-9a-f]{32}$/;
const MARKER = 'team_brief_sent_';
const ATTENDED = `b.status='booked' AND b.checked_in_at IS NOT NULL`;
const MAT_THB = 200;                 // mat rental, flat, VAT included, paid at the shala

// A value pasted into Railway with a space or a line end still works.
const env = k => String(process.env[k] || '').trim();
// The main AYBKK LINE Official Account, the one server.js and inbox.js use.
const TOKEN = 'LINE_CHANNEL_ACCESS_TOKEN';
const SECRET = 'LINE_CHANNEL_SECRET';

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
// A name stored as only a phone number or an email has nothing to show: say so,
// never a bare '?' a teacher cannot read at 5 am.
const named = (L, raw) => { const s = shortName(raw); return s === '?' ? L.noName : s; };
const list = (names, max = 15) => names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max}` : names.join(', ');

const WORDS = {
  th: {
    day: d => { const t = new Date(`${d}T12:00:00Z`); return `${WD.th[t.getUTCDay()]} ${t.getUTCDate()} ${MON.th[t.getUTCMonth()]}`; },
    item: en => en || 'แพ็กเกจ',
    noName: 'ไม่มีชื่อในระบบ',
    mHead: d => `☀️ บรีฟเช้า ${d}`,
    closed: c => c.why === 'none' ? 'วันนี้ไม่มีคลาสในตาราง'
      : c.why === 'cancelled' ? `วันนี้ชาลาปิด ยกเลิกทุกคลาส${c.note ? ` (${c.note})` : ''}`
      : `วันนี้ชาลาปิด ${c.why === 'full' ? 'วันพระจันทร์เต็มดวง' : 'วันพระจันทร์ดับ'} (moon day)`,
    cHead: (time, title, teacher) => `🧘 ${time} ${title}${teacher ? ` · ครู ${teacher}` : ''}`,
    cBooked: n => `จอง ${n} คน`,
    cDrop: (n, names) => `ดรอปอิน ${n}: ${names}`,
    cFirst: (n, names) => `มาครั้งแรกวันนี้ ${n}: ${names}`,
    cWeek: (n, names) => `สัปดาห์แรก ${n}: ${names}`,
    cMats: (n, names) => `เช่าเสื่อ ${n} (${baht(MAT_THB)} รวม VAT จ่ายที่ชาลา): ${names}`,
    cOff: (time, title, note) => `${time} ${title} · ยกเลิก${note ? ` (${note})` : ''}`,
    onlineH: '💻 ออนไลน์ (Zoom)',
    oLine: (time, title, n) => `${time} ${title} · จอง ${n}`,
    boughtH: '🛒 ซื้อแล้ว ยังไม่เคยมา',
    newBought: (n, item, day, next) => `• ${n} ซื้อ ${item} เมื่อ ${day} ยังไม่เช็กอินใน aybkk.net${next ? ` (จองไว้ ${next})` : ' ยังไม่มีการจองใน aybkk.net'}`,
    endH: '⏳ ใกล้หมด ชวนคุยเรื่องต่อแพ็กเกจ',
    endDate: (n, item, until) => `• ${n} ${item} หมด ${until}`,
    endLeft: (n, item, left, until) => `• ${n} ${item} เหลือ ${left} ครั้ง${until ? ` ใช้ได้ถึง ${until}` : ''}`,
    payH: '💳 ยังไม่จ่าย ช่วยตามเก็บเงิน',
    payOrder: (n, item, amount, day, ref) => `• ${n} สั่ง ${item} ${amount} ยังไม่ได้จ่าย (สั่ง ${day}, ref ${ref})`,
    paySeat: (n, time, why) => `• ${n} จอง ${time} ${why}`,
    why: { none: 'แต่ยังไม่มีแพ็กเกจ', ended: d => `แต่แพ็กเกจหมดไปแล้ว ${d}`, frozen: 'แต่แพ็กเกจพักไว้อยู่',
      void: 'แต่แพ็กเกจถูกยกเลิกแล้ว' },
    mTotal: o => `รวม ${o.classes} คลาส · จอง ${o.booked} · ดรอปอิน ${o.dropin} · ครั้งแรก ${o.first} · สัปดาห์แรก ${o.week} · เสื่อ ${o.mats} · ใกล้หมด ${o.ending} · ยังไม่จ่าย ${o.unpaid}`,

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
    came: (time, title, came, booked, missed) => `${time} ${title}: เช็กอิน ${came}/${booked}${missed ? ` · ยังไม่เช็กอิน: ${missed}` : ''}`,
    bookings: (made, off, byShala) => `จองใหม่ ${made} · ยกเลิก ${off}${byShala ? ` (ชาลาปิดคลาส ${byShala})` : ''}`,
    doorElse: names => `⚠ แท็บเล็ตหน้าประตู (${names}) มีการใช้จากเครือข่ายอื่น ไม่ใช่ของชาลา เช็กใน Admin หน้า ตั้งค่า ช่อง แท็บเล็ตหน้าประตู`,
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
    eTotal: o => `วันนี้เงินเข้า ${o.money} · เช็กอิน ${o.came} · พรุ่งนี้จองแล้ว ${o.tomorrow}`,
  },
  en: {
    day: d => { const t = new Date(`${d}T12:00:00Z`); return `${WD.en[t.getUTCDay()]} ${t.getUTCDate()} ${MON.en[t.getUTCMonth()]}`; },
    item: en => en || 'pass',
    noName: 'no name on file',
    mHead: d => `☀️ Teaching brief ${d}`,
    closed: c => c.why === 'none' ? 'No classes on the timetable today.'
      : c.why === 'cancelled' ? `The shala is closed today: every class is cancelled${c.note ? ` (${c.note})` : ''}.`
      : `The shala is closed today: ${c.why === 'full' ? 'full moon' : 'new moon'} day.`,
    cHead: (time, title, teacher) => `🧘 ${time} ${title}${teacher ? ` · ${teacher}` : ''}`,
    cBooked: n => `${n} booked`,
    cDrop: (n, names) => `Drop-in ${n}: ${names}`,
    cFirst: (n, names) => `First class today ${n}: ${names}`,
    cWeek: (n, names) => `First week ${n}: ${names}`,
    cMats: (n, names) => `Mat rental ${n} (${baht(MAT_THB)} incl. VAT, paid at the shala): ${names}`,
    cOff: (time, title, note) => `${time} ${title} · cancelled${note ? ` (${note})` : ''}`,
    onlineH: '💻 Online (Zoom)',
    oLine: (time, title, n) => `${time} ${title} · ${n} booked`,
    boughtH: '🛒 Bought, not here yet',
    newBought: (n, item, day, next) => `• ${n} bought ${item} on ${day}, no aybkk.net check-in yet${next ? ` (booked ${next})` : ', no aybkk.net booking yet'}`,
    endH: '⏳ Ending soon, talk about renewing',
    endDate: (n, item, until) => `• ${n}: ${item}, ends ${until}`,
    endLeft: (n, item, left, until) => `• ${n}: ${item}, ${left} left${until ? `, until ${until}` : ''}`,
    payH: '💳 Not paid, please collect',
    payOrder: (n, item, amount, day, ref) => `• ${n}: ${item} ${amount} not paid (ordered ${day}, ref ${ref})`,
    paySeat: (n, time, why) => `• ${n}: booked ${time} but ${why}`,
    why: { none: 'has no pass', ended: d => `the pass ended ${d}`, frozen: 'the pass is paused',
      void: 'the pass was voided' },
    mTotal: o => `Total: ${pl(o.classes, 'class', 'classes')} · ${o.booked} booked · ${o.dropin} drop-in · ${o.first} first time · ${o.week} first week · ${pl(o.mats, 'mat', 'mats')} · ${o.ending} ending · ${o.unpaid} not paid`,

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
    came: (time, title, came, booked, missed) => `${time} ${title}: ${came}/${booked} checked in${missed ? ` · not checked in: ${missed}` : ''}`,
    bookings: (made, off, byShala) => `Bookings made: ${made} · cancelled: ${off}${byShala ? ` (${byShala} by a closed class)` : ''}`,
    doorElse: names => `⚠ The door tablet (${names}) was used from another internet, not the shala's. Check Admin, Settings, Door tablets.`,
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
    eTotal: o => `Today: ${o.money} in · ${o.came} checked in · ${o.tomorrow} booked for tomorrow`,
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
  // Preview and status carry student names: never kept by a browser or a proxy.
  const adminOnly = (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    if (!(ADMIN_KEY && safeEqual(req.headers['x-bkk-key'], ADMIN_KEY))) return res.status(401).json({ error: 'bad key' });
    ready().then(() => next(), e => res.status(503).json({ error: `team brief settings not ready: ${e.message}` }));
  };

  if (!pool) {
    console.warn('⚠ team-brief: no pgPool, LINE team briefs disabled');
    return { tick: async () => [], start() {}, stop() {}, takeLine: async () => {} };
  }
  const q = (sql, params = []) => pool.query(sql, params);
  const stats = { badSignatures: 0, badAt: null };
  const tell = text => Promise.resolve(notify(text)).catch(() => {});

  // Once per database, before anything here reads a group or a switch: what the
  // LINE account used before left under these keys is cleared (see the top).
  // A failure is tried again on the next use, and nothing is sent until then.
  let readyP = null;
  const ready = () => readyP || (readyP = startClean().catch(e => { readyP = null; throw e; }));
  async function startClean() {
    const client = await pool.connect();
    let was = [];
    try {
      await client.query('BEGIN');
      const first = (await client.query(`INSERT INTO bkk_settings (key,value) VALUES ('team_line_sender','"main"')
        ON CONFLICT (key) DO NOTHING RETURNING key`)).rowCount === 1;
      if (first) {
        was = (await client.query(`SELECT key, value FROM bkk_settings
          WHERE key IN ('team_line_group','team_brief_morning','team_brief_evening')`)).rows;
        await client.query(`DELETE FROM bkk_settings
          WHERE key IN ('team_line_group','team_line_groups','team_line_webhook_last','team_brief_error')`);
        await client.query(`UPDATE bkk_settings SET value='"off"', updated_at=now()
          WHERE key IN ('team_brief_morning','team_brief_evening') AND value IS DISTINCT FROM '"off"'`);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
    const had = was.some(r => r.key === 'team_line_group'), on = was.some(r => r.key !== 'team_line_group' && r.value === 'on');
    if (!had && !on) return;
    console.log('[team] briefs now from the main AYBKK LINE account: the old group and switches were cleared');
    tell('The team briefs now come from the main AYBKK LINE account. The group and switches kept for the LINE account '
      + 'used before were cleared: no LINE group gets the briefs, and the morning brief and the evening summary are off. '
      + 'Accept the staff group in Admin, Settings, LINE team brief, then switch on what you want.');
  }

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
      const token = env(TOKEN);
      if (!token) return fail(503, `${TOKEN} is not set on the server`);
      const built = lineMessages(messages);
      if (built.error) return fail(400, built.error);
      if (!built.messages.length) return fail(400, 'nothing to send');
      await ready();
      const to = await savedGroup();
      if (!to) return fail(409, 'No team group yet: accept the staff group in Admin, Settings, LINE team brief (team/group)');
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
  // Students who were already with the shala before aybkk.net (moved over from
  // Rezerv): imported, matched by the member import (rezerv_id), or with any
  // seat on a Rezerv package (the door's add for a Rezerv holder it could not
  // find, cover 'rezerv'; moved_at: a Rezerv seat moved onto a pass here).
  const FROM_REZERV = `(m.source IS NOT DISTINCT FROM 'rezerv' OR m.rezerv_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM bkk_passes x WHERE x.member_id=m.id AND x.source='rezerv')
    OR EXISTS (SELECT 1 FROM bkk_bookings x WHERE x.member_id=m.id
      AND (x.source='rezerv' OR x.cover='rezerv' OR x.moved_at IS NOT NULL)))`;

  // A class Rezerv gave back for a cancelled class is imported as a Drop-in
  // pass (bkk-api.js, CREDIT_NOTE): a regular's credit, never a drop-in.
  const CREDIT_BACK = '%a class Rezerv gave back%';

  async function morning(date, L) {
    const lines = [L.mHead(L.day(date))];
    const { closed, classes } = await classesOn(date);
    if (closed) return { text: [...lines, L.closed(closed)].join('\n') };

    const [seats, news, bought, ending, orders] = await Promise.all([
      // A drop-in seat is one on a pass of the Drop-in product: the door's
      // walk-in and an online drop-in both sell that pass and book with it
      // (cover 'pass'); 'dropin' as a cover is only ever a word in a reply.
      q(`SELECT b.slot_id, b.member_id, b.need_mat, b.cover, b.pass_id, m.name,
           p.status AS pass_status, to_char(p.valid_until,'YYYY-MM-DD') AS until,
           (b.cover IS NOT DISTINCT FROM 'dropin' OR (pr.code IS NOT DISTINCT FROM 'dropin'
             AND coalesce(p.note,'') NOT LIKE $2)) AS dropin
         FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id LEFT JOIN bkk_passes p ON p.id=b.pass_id
         LEFT JOIN bkk_products pr ON pr.id=p.product_id
         WHERE b.class_date=$1::date AND b.status='booked' AND b.slot_id IS NOT NULL ORDER BY lower(m.name), b.id`, [date, CREDIT_BACK]),
      // New to the shala, booked today. fresh: the first class ever is today
      // (joined in the last 7 days, or no join date). Otherwise the first week:
      // came before, and joined or first came in the last 7 days.
      q(`SELECT m.id AS member_id, fv.first IS NULL AS fresh FROM bkk_members m
         JOIN LATERAL (SELECT min(x.class_date) AS first FROM bkk_bookings x WHERE x.member_id=m.id AND x.status='booked'
           AND x.checked_in_at IS NOT NULL AND x.class_date < $1::date) fv ON true
         WHERE EXISTS (SELECT 1 FROM bkk_bookings b WHERE b.member_id=m.id AND b.class_date=$1::date AND b.status='booked')
           AND NOT ${FROM_REZERV}
           AND CASE WHEN fv.first IS NULL THEN m.joined_on IS NULL OR m.joined_on >= $1::date - 7
             ELSE m.joined_on >= $1::date - 7 OR fv.first >= $1::date - 7 END`, [date]),
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
         WHERE o.status='pending' AND o.source IS NULL AND o.method='online' AND o.kind='pass'
           AND o.created_at >= ($1::date - 3)::timestamp AT TIME ZONE 'Asia/Bangkok'
           AND o.created_at < ($1::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'
           AND NOT EXISTS (SELECT 1 FROM bkk_orders x WHERE x.member_id=o.member_id AND x.status='paid' AND x.created_at > o.created_at)
         ORDER BY o.created_at, o.id`, [date]),
    ]);
    const where = new Map(classes.map(c => [c.id, c.online ? `${c.time} (Zoom)` : c.time]));
    const name = r => named(L, r.name);
    const names = rows => list(rows.map(name));
    const isNew = new Map(news.rows.map(r => [r.member_id, r.fresh ? 'first' : 'week']));

    // The shala's classes in timetable order. Someone booked twice today is new
    // under their first class only; drop-ins and mats are per seat.
    const shala = classes.filter(c => !c.online), held = shala.filter(c => !c.off);
    const seen = new Set();
    const total = { classes: held.length, booked: 0, dropin: 0, first: 0, week: 0, mats: 0 };
    for (const c of shala) {
      if (c.off) { lines.push('', L.cOff(c.time, c.title, c.note)); continue; }
      const here = seats.rows.filter(s => s.slot_id === c.id);
      const fresh = here.filter(s => isNew.has(s.member_id) && !seen.has(s.member_id));
      for (const s of fresh) seen.add(s.member_id);
      const part = {
        dropin: here.filter(s => s.dropin), mats: here.filter(s => s.need_mat),
        first: fresh.filter(s => isNew.get(s.member_id) === 'first'), week: fresh.filter(s => isNew.get(s.member_id) === 'week'),
      };
      total.booked += here.length;
      for (const k of Object.keys(part)) total[k] += part[k].length;
      lines.push('', L.cHead(c.time, c.title, c.teacher), L.cBooked(here.length),
        ...[[L.cDrop, part.dropin], [L.cFirst, part.first], [L.cWeek, part.week], [L.cMats, part.mats]]
          .filter(([, rows]) => rows.length).map(([fn, rows]) => fn(rows.length, names(rows))));
    }

    // Online classes (Zoom) apart, a count each: nobody to welcome or hand a mat.
    // Under the Zoom header the title's own "[Online]" says nothing more.
    const online = classes.filter(c => c.online);
    const bare = t => String(t || '').replace(/^\s*\[online\]\s*/i, '');
    if (online.length) lines.push('', L.onlineH, ...online.map(c => c.off ? L.cOff(c.time, bare(c.title), c.note)
      : L.oLine(c.time, bare(c.title), seats.rows.filter(s => s.slot_id === c.id).length)));

    const boughtLines = bought.rows.map(r => L.newBought(name(r), L.item(r.item_en), L.day(r.day), r.next && L.day(r.next)));
    if (boughtLines.length) lines.push('', L.boughtH, ...boughtLines);

    const endLines = ending.rows.map(r => r.kind === 'credits' && r.left <= 2
      ? L.endLeft(name(r), L.item(r.item_en), Math.max(0, r.left), r.until && L.day(r.until))
      : L.endDate(name(r), L.item(r.item_en), L.day(r.until)));
    if (endLines.length) lines.push('', L.endH, ...endLines);

    // A seat booked on an active pass is paid for: booking checked that the
    // pass covers its day (an earlier class moves a window its first class set).
    const why = s => !s.pass_id ? L.why.none : s.pass_status === 'frozen' ? L.why.frozen
      : s.pass_status !== 'active' ? L.why.void : s.until && s.until < date ? L.why.ended(L.day(s.until)) : null;
    const unpaidSeats = seats.rows.filter(s => s.cover !== 'rezerv' && why(s));
    const payLines = [...orders.rows.map(r => L.payOrder(name(r), L.item(r.item_en), baht(r.amount_thb), L.day(r.day), r.refno)),
      ...unpaidSeats.map(s => L.paySeat(name(s), where.get(s.slot_id), why(s)))];
    if (payLines.length) lines.push('', L.payH, ...payLines);

    lines.push('', L.mTotal({ ...total, ending: endLines.length, unpaid: payLines.length }));
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
    const from = bkkAt(addDays(date, -1), briefAt('evening', addDays(date, -1))), to = bkkAt(date, briefAt('evening', date));
    const cut = Math.min(Date.parse(to), nowMs());
    const W = [from, to];
    const tomorrow = addDays(date, 1);
    const one = async (sql, args = W) => (await q(sql, args)).rows[0];
    const all = async (sql, args = W) => (await q(sql, args)).rows;
    // A tee pre-order's lapsed hold is no one to chase: unpaid lists are package orders only.
    const unpaidStill = `o.status='pending' AND o.source IS NULL AND o.kind='pass' AND o.created_at >= $1 AND o.created_at < $2
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
           FROM bkk_start_events WHERE page='start' AND created_at >= $1 AND created_at < $2 AND src IS DISTINCT FROM 'letter'`),
      journalEntries(from, to),
    ]);
    // A door tablet key used from an address other than the one it was paired
    // from (bkk-api.js, 17 Nov 2026). A server without the table still briefs.
    let doorElse = [];
    try {
      doorElse = await all(`SELECT name FROM bkk_door_devices WHERE other_ip_at >= $1 AND other_ip_at < $2 ORDER BY id`);
    } catch (_) {}
    // The inbox has its own table (inbox.js); a server without it still briefs.
    let inbox = [];
    try {
      inbox = await all(`SELECT channel, count(DISTINCT sender_id)::int AS people,
          count(DISTINCT sender_id) FILTER (WHERE NOT EXISTS (SELECT 1 FROM aybkk_inbox y
            WHERE y.channel=x.channel AND y.sender_id=x.sender_id AND y.created_at < $1))::int AS fresh,
          count(DISTINCT sender_id) FILTER (WHERE triage->>'lane'='hot')::int AS hot, count(*)::int AS n
        FROM aybkk_inbox x WHERE direction='in' AND created_at >= $1 AND created_at < $2 GROUP BY channel`);
    } catch (_) {}

    const name = r => named(L, r.name);
    // Sent by hand before 20:00, it says how far the day has got.
    const upTo = cut > Date.parse(from) ? new Date(cut + 7 * 3600000).toISOString().slice(11, 16) : briefAt('evening', date);
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
    if (doorElse.length) lines.push(L.doorElse(doorElse.map(d => d.name).join(', ')));

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
      const t = Date.parse(bkkAt(date, briefAt(kind, date)));
      return at >= t && at < t + LATE_MIN * 60000;
    });
    if (!due.length) return [];
    const out = [];
    try {
      await ready();
      const s = await settings();
      for (const kind of due) if (s[kind] === 'on') out.push(await sendBrief(kind, date, s.lang));
    } catch (e) { await failed('timer', e.message); }
    return out;
  }
  let timer = null;
  function start() {
    if (timer) return;
    ready().catch(e => console.error('[team] could not clear the old team group yet:', e.message));
    const run = () => tick().catch(e => console.error('[team] tick failed:', e.message));
    timer = setInterval(run, 60 * 1000);
    timer.unref();
    setTimeout(run, 20 * 1000).unref();
  }
  const stop = () => { clearInterval(timer); timer = null; };

  // ── webhook ───────────────────────────────────────────────────────────────
  async function groupName(id) {
    const token = env(TOKEN);
    if (!token) return null;
    try {
      const r = await httpFetch(`${LINE_API}/group/${encodeURIComponent(id)}/summary`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
      return r.ok ? String((await r.json()).groupName || '').slice(0, 80) || null : null;
    } catch (_) { return null; }
  }

  // The ids of the groups the account is in, as last read or written here:
  // an event from a group it knows writes nothing.
  let known = null;
  const learn = (groups, saved) => {
    known = new Set(groups.filter(g => g && !g.leftAt).map(g => g.id));
    if (saved) known.add(saved);
    return known;
  };
  async function knownGroups() {
    if (known) return known;
    const r = (await q(`SELECT key, value FROM bkk_settings WHERE key IN ('team_line_groups','team_line_group')`)).rows;
    const v = k => (r.find(x => x.key === k) || {}).value;
    return learn(Array.isArray(v('team_line_groups')) ? v('team_line_groups') : [],
      typeof v('team_line_group') === 'string' ? v('team_line_group') : null);
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
      learn(st.groups, st.saved);
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
  }
  const quoted = name => `"${name || 'no name'}"`;
  // Boonchu's note for a group that waits.
  const waitNote = (name, current) => `The AYBKK LINE account is in ${current ? 'another' : 'the'} LINE group ${quoted(name)}: it waits. ` +
    (current ? `The team briefs still go to ${quoted(current)}. ` : 'No LINE group gets the team briefs yet. ') +
    'Nothing moves unless the Desk or staff accept it (Admin, Settings, LINE team brief). Accept only the staff group: the briefs carry student names.';

  // A group the account is in, heard of by a join or by any other event (a
  // message, a member joining: it was in the group before LINE could reach the
  // webhook), waits until staff accept it. Nothing is ever saved by itself:
  // the main account is in several staff groups, and anyone can add it to a
  // group of their own. Boonchu hears of each one once. An event LINE sends
  // again, or late, from before the account left, changes nothing.
  // asked: the groups taken up here since this server started, so a burst from
  // one group is one name asked of LINE, one write and one ping, even once it
  // has dropped off the list of groups kept (GROUPS_KEPT). A leave forgets it.
  const asked = new Set();
  async function waits(id, ts) {
    const at = new Date(Number.isFinite(ts) ? ts : nowMs()).toISOString();
    const name = await groupName(id);
    const r = await withGroups(st => {
      const had = st.groups.find(g => g.id === id);
      if (had && !had.leftAt) return null;   // known
      if (had && had.leftAt >= at) return 'late';   // from before it left
      const mine = st.saved === id;
      st.groups = [{ id, name: name || (had && had.name) || null, joinedAt: at, leftAt: null, pending: !mine },
        ...st.groups.filter(g => g.id !== id)];
      return mine ? null : { current: (st.groups.find(g => g.id === st.saved) || {}).name || null };
    });
    if (r === 'late') asked.delete(id);   // so a later rejoin is still heard
    if (!r || r === 'late') return;
    console.log('[team] the AYBKK LINE account is in a LINE group staff have not accepted: it waits');
    tell(waitNote(name, r.current));
  }

  async function left(id, ts) {
    asked.delete(id);
    const at = new Date(Number.isFinite(ts) ? ts : nowMs()).toISOString();
    const cleared = await withGroups(st => {
      const had = st.groups.find(g => g.id === id);
      if (had && had.joinedAt > at) return null;   // left before a later join
      if (had) Object.assign(had, { leftAt: at, pending: false });
      if (st.saved !== id) return null;
      st.saved = null;
      return { name: had ? had.name : null };
    });
    if (!cleared) return;
    console.log('[team] the AYBKK LINE account left the team group: briefs wait for a new group');
    tell(`The AYBKK LINE account is not in the LINE group ${quoted(cleared.name)} any more (it left, or someone removed it): `
      + 'the team briefs stop until staff accept another group (Admin, Settings, LINE team brief).');
  }

  // When LINE last reached the webhook with a good signature (its Verify button
  // too), kept at most once a minute, so staff can see LINE gets through.
  let heardAt = 0;
  async function heard() {
    const now = nowMs();
    if (now >= heardAt && now - heardAt < 60000) return;
    heardAt = now;
    try { await putSetting('team_line_webhook_last', new Date(now).toISOString()); }
    catch (e) { heardAt = 0; console.error('[team] could not keep the webhook time:', e.message); }
  }

  // server.js's LINE webhook (/line/webhook) hands every request here, next to
  // inbox.takeLine(req); server.js answers LINE. Signed by LINE (LINE_CHANNEL_SECRET
  // over the raw bytes, constant time) or ignored and counted. Of a signed event
  // only which group it came from is read: a leave as it is, any other event
  // only for a group not known yet. Text is never read, and nothing is ever
  // sent back to a group. Never throws.
  async function takeLine(req) {
    try {
      const secret = env(SECRET);
      if (!secret) return;
      const body = req && req.rawBody;
      if (!signed(body, req.headers && req.headers['x-line-signature'], secret)) {
        stats.badSignatures++;
        stats.badAt = new Date(nowMs()).toISOString();
        return;
      }
      await ready();
      await heard();
      let events = [];
      try { events = JSON.parse(body.toString('utf8')).events; } catch (_) {}
      for (const ev of Array.isArray(events) ? events : []) {
        const src = ev && ev.source;
        const id = src && src.type === 'group' && typeof src.groupId === 'string' ? src.groupId : '';
        if (!GROUP_ID_RE.test(id)) continue;
        try {
          if (ev.type === 'leave') await left(id, ev.timestamp);
          else if (!(await knownGroups()).has(id) && !asked.has(id)) {
            asked.add(id);
            if (asked.size > 500) asked.delete(asked.values().next().value);
            await waits(id, ev.timestamp).catch(e => { asked.delete(id); throw e; });
          }
        } catch (e) { await failed('webhook', e.message); }
      }
    } catch (e) { console.error('[team] webhook:', e.message); }
  }

  // ── admin (x-bkk-key: the Desk assistant, and staff) ──────────────────────
  // What LINE says about the token: whose account it is (the main AYBKK account,
  // its name and basic id), the month's messages (shared with every message to
  // students), or that it refuses the token. Kept 10 minutes.
  const FRESH = 10 * 60000;
  const fresh = at => Math.abs(nowMs() - at) < FRESH;
  const lineGet = (path, token) => httpFetch(`${LINE_API}/${path}`, { headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000) }).then(async r => ({ status: r.status, body: r.ok ? await r.json().catch(() => null) : null }))
    .catch(() => ({ status: 0, body: null }));
  let infoCache = { at: 0, token: null, value: null };
  async function lineInfo() {
    const token = env(TOKEN);
    if (!token) return null;
    if (infoCache.value && infoCache.token === token && fresh(infoCache.at)) return infoCache.value;
    const [bot, limit, used] = await Promise.all(['info', 'message/quota', 'message/quota/consumption'].map(p => lineGet(p, token)));
    const cut = (v, n) => typeof v === 'string' && v ? v.slice(0, n) : null;
    // 401 is a token LINE refuses. A 403 is about the plan or a permission, not the token.
    const refused = [bot, limit, used].find(r => r.status === 401);
    const value = {
      bot: bot.body ? { name: cut(bot.body.displayName, 80), basicId: cut(bot.body.basicId, 40), premiumId: cut(bot.body.premiumId, 40) } : null,
      tokenError: refused ? `LINE refused the access token (${refused.status})` : null,
      quota: limit.body && used.body ? { limit: limit.body.type === 'limited' ? limit.body.value : null, used: used.body.totalUsage } : null,
    };
    if (value.bot || value.tokenError) infoCache = { at: nowMs(), token, value };
    return value;
  }
  // LINE counts a push to a group once per member: the count says what a brief
  // costs, and tells two groups of one name apart.
  const membersCache = new Map();
  async function members(id) {
    const token = env(TOKEN);
    if (!token) return null;
    const c = membersCache.get(id);
    if (c && fresh(c.at)) return c.n;
    const r = await lineGet(`group/${encodeURIComponent(id)}/members/count`, token);
    const n = r.body ? Number(r.body.count) : NaN;
    if (!Number.isFinite(n)) return null;
    membersCache.set(id, { at: nowMs(), n });
    return n;
  }
  // A group first seen while the token was not set (or LINE did not answer)
  // has no name: ask again, at most every 10 minutes for each group.
  const nameAsked = new Map();
  async function fillNames() {
    if (!env(TOKEN)) return;
    const seen = await getSetting('team_line_groups');
    const want = (Array.isArray(seen) ? seen : []).filter(g => g && !g.name && !g.leftAt
      && !(nameAsked.has(g.id) && fresh(nameAsked.get(g.id))));
    if (!want.length) return;
    for (const g of want) nameAsked.set(g.id, nowMs());
    const got = new Map((await Promise.all(want.map(async g => [g.id, await groupName(g.id)]))).filter(([, n]) => n));
    if (got.size) await withGroups(st => { for (const g of st.groups) if (!g.name && got.has(g.id)) g.name = got.get(g.id); });
  }

  app.get('/api/bkk/admin/team/status', adminOnly, async (req, res) => {
    try {
      await fillNames().catch(e => console.warn('[team] group names not filled:', e.message));
      const [s, group, seen, last, error, info, hook] = await Promise.all([settings(), savedGroup(),
        getSetting('team_line_groups'), getSetting('team_brief_last'), getSetting('team_brief_error'), lineInfo(),
        getSetting('team_line_webhook_last')]);
      const groups = Array.isArray(seen) ? seen : [];
      const g = group && groups.find(x => x.id === group);
      const pending = x => !!x.pending && !x.leftAt && x.id !== group;
      const count = new Map(await Promise.all(groups.filter(x => x.id === group || pending(x))
        .map(async x => [x.id, await members(x.id)])));
      // The next time the timer sends each brief: today's at its weekday time;
      // within LATE_MIN after it, while today's has not gone (by hand too) or
      // waits for a retry, at the next minute's tick; else tomorrow's.
      const now = nowMs(), today = bkkYmd(now);
      const marks = (await q(`SELECT key, value->>'state' AS state FROM bkk_settings WHERE key = ANY($1::text[])`,
        [Object.keys(BRIEF_AT).map(k => `${MARKER}${k}_${today}`)])).rows;
      const done = kind => marks.some(m => m.key === `${MARKER}${kind}_${today}` && m.state !== 'retry');
      const next = kind => {
        const t = Date.parse(bkkAt(today, briefAt(kind, today)));
        if (!done(kind) && now < t + LATE_MIN * 60000) return Math.max(t, now);
        return Date.parse(bkkAt(addDays(today, 1), briefAt(kind, addDays(today, 1))));
      };
      const iso = t => new Date(t).toISOString();
      const hhmm = t => new Date(t + 7 * 3600000).toISOString().slice(11, 16);
      res.json({
        channel: { secretSet: !!env(SECRET), tokenSet: !!env(TOKEN),
          // Whose LINE account the token is (name and basic id), or that LINE refuses it.
          bot: info ? info.bot : null, tokenError: info ? info.tokenError : null },
        group: { saved: !!group, ref: group ? groupRef(group) : null, name: g ? g.name : null, joinedAt: g ? g.joinedAt : null,
          members: group ? count.get(group) ?? null : null },
        // pending: the account is in it, it gets nothing until accepted (team/group).
        groupsSeen: groups.map(x => ({ ref: groupRef(x.id), name: x.name, joinedAt: x.joinedAt, leftAt: x.leftAt,
          saved: x.id === group, pending: pending(x), members: count.get(x.id) ?? null })),
        // at: the Bangkok time of each brief's next send; next: when it goes, null while off.
        // dueNow: today's is late by under LATE_MIN and not sent: it goes (or would, once on) within a minute.
        briefs: { morning: s.morning, evening: s.evening, lang: s.lang,
          at: { morning: hhmm(next('morning')), evening: hhmm(next('evening')) }, morningByWeekday: BRIEF_AT.morning,
          next: { morning: s.morning === 'on' ? iso(next('morning')) : null, evening: s.evening === 'on' ? iso(next('evening')) : null },
          dueNow: { morning: next('morning') <= now, evening: next('evening') <= now }, lateMin: LATE_MIN },
        lastSent: last || {},
        lastError: error,
        quota: info ? info.quota : null,
        // LINE reaches /line/webhook: the last signed event, and bad signatures since this server started.
        webhookLastAt: typeof hook === 'string' ? hook : null,
        badSignatures: stats.badSignatures,
        badSignatureLastAt: stats.badAt,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  const briefArgs = (src, res) => {
    const kind = String(src.kind || '');
    if (!Object.hasOwn(BRIEF_AT, kind)) { res.status(400).json({ error: 'kind must be morning or evening' }); return null; }
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
      const sofar = kind === 'evening' && now < Date.parse(bkkAt(date, briefAt('evening', date)));
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

  // { add: groupId }: a group looked up by its LINE ID (the server log of
  // /line/webhook shows it) goes in the list of groups seen as waiting, or has
  // its name refreshed; it is never saved by this. Only ref, name and member
  // count come back, never the id.
  async function addGroup(raw, res) {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!GROUP_ID_RE.test(id)) return res.status(400).json({ error: 'a LINE group ID is C and 32 characters 0-9 and a-f' });
    const token = env(TOKEN);
    if (!token) return res.status(503).json({ error: `${TOKEN} is not set on the server` });
    const [sum, count] = await Promise.all([`group/${id}/summary`, `group/${id}/members/count`].map(p => lineGet(p, token)));
    // line: what LINE answered (0: not reached), so the page can say it in Thai too.
    if (sum.status === 0) return res.status(502).json({ error: 'LINE could not be reached', line: 0 });
    if (sum.status === 403 || sum.status === 404) return res.status(409).json({ error: 'the AYBKK LINE account is not in that group' });
    if (sum.status !== 200) return res.status(502).json({ error: sum.status === 401 ? 'LINE refused the access token (401)' : `LINE answered ${sum.status}`,
      line: sum.status });
    const name = sum.body && typeof sum.body.groupName === 'string' && sum.body.groupName ? sum.body.groupName.slice(0, 80) : null;
    const n = count.body ? Number(count.body.count) : NaN;
    const members = Number.isFinite(n) ? n : null;
    if (members != null) membersCache.set(id, { at: nowMs(), n: members });
    const at = new Date(nowMs()).toISOString();
    const saved = await withGroups(st => {
      const had = st.groups.find(g => g.id === id);
      // A group accepted before and replaced since waits again, so it can be accepted again.
      const kept = had && !had.leftAt ? Object.assign(had, { name: name || had.name, pending: st.saved !== id })
        : { id, name, joinedAt: at, leftAt: null, pending: st.saved !== id };
      st.groups = [kept, ...st.groups.filter(g => g.id !== id)];
      return st.saved === id;
    });
    return res.json({ ok: true, ref: groupRef(id), name, members, saved });
  }

  // Which group gets the briefs: { add: groupId } (above), { accept: ref } moves
  // them to a waiting group, { clear: true } stops them until a group is
  // accepted. ref is from team/status or the add answer. Nothing here makes the
  // account leave a group: it is the students' account too.
  app.post('/api/bkk/admin/team/group', adminOnly, async (req, res) => {
    const b = req.body || {};
    try {
      if (Object.hasOwn(b, 'add')) return await addGroup(b.add, res);
      const ref = typeof b.accept === 'string' ? b.accept : '';
      if (!ref && b.clear !== true) return res.status(400).json({ error: 'send { add: groupId }, { accept: ref } or { clear: true }' });
      if (b.clear === true) {
        const was = await withGroups(st => {
          const w = st.groups.find(g => g.id === st.saved);
          if (w && !w.leftAt) w.pending = true;   // it waits again, so it can be accepted again
          const had = st.saved;
          st.saved = null;
          return had;
        });
        if (was) tell('The team briefs are stopped: no LINE group gets them until staff or the Desk accept one (Admin, Settings, LINE team brief).');
        return res.json({ ok: true, saved: false });
      }
      const seen = await getSetting('team_line_groups');
      const g = (Array.isArray(seen) ? seen : []).find(x => groupRef(x.id) === ref);
      if (!g) return res.status(404).json({ error: 'no group with that ref (see groupsSeen in team/status)' });
      const r = await withGroups(st => {
        const x = st.groups.find(y => y.id === g.id);
        if (!x || x.leftAt) return { gone: true };
        const moved = st.saved !== x.id;
        const prev = moved && st.groups.find(y => y.id === st.saved);
        if (prev && !prev.leftAt) prev.pending = true;   // the group it replaces waits again
        st.saved = x.id;
        x.pending = false;
        return { moved, name: x.name };
      });
      if (r.gone) return res.status(409).json({ error: 'the AYBKK LINE account is not in that group any more' });
      if (r.moved) tell(`The team briefs go to the LINE group ${quoted(r.name)} now (accepted by staff or the Desk).`);
      res.json({ ok: true, saved: true, ref, name: r.name });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return { tick, start, stop, send: teamSend, build, takeLine };
}

module.exports = { mountTeam, shortName, splitText, retryKey };
