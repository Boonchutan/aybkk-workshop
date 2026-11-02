#!/usr/bin/env node
// AYBKK monthly timetable poster. Usage: node render.js --help
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const DIR = __dirname;
const API = 'https://aybkk.net/api/bkk/schedule?days=62';
const OUT_ROOT = process.env.POSTER_OUT
  || '/tmp/claude-0/-home-user-aybkk-workshop/3b3548ff-02bf-5c45-bd02-b8c67f38ecca/scratchpad/poster-out';
const SIZES = { feed: { W: 1080, H: 1350 }, story: { W: 1080, H: 1920 } };
const LOOKS = ['A', 'B'];
// Single images use A until Boonchu picks a look; --all renders both until then.
const DEFAULT_LOOK = 'A';

const TEXT = {
  en: {
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    year: y => y,
    heads: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    kinds: { mysore: 'Mysore', led_primary: 'Primary', led_inter: 'Inter.' },
    moon: 'Moon day',
    none: 'No classes',
    book: 'Book at aybkk.net · LINE @aybkk',
    where: 'S31 Sukhumvit Hotel, 8th floor, Sukhumvit 31',
    zoom: 'Led classes also live on Zoom',
  },
  th: {
    months: ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'],
    year: y => y + 543,
    heads: ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'],
    kinds: { mysore: 'มายซอร์', led_primary: 'Primary', led_inter: 'Inter.' },
    moon: { new: 'จันทร์ดับ', full: 'จันทร์เต็มดวง' },
    none: 'ไม่มีคลาส',
    book: 'จองที่ aybkk.net · LINE @aybkk',
    where: 'โรงแรม S31 ชั้น 8 สุขุมวิท 31',
    zoom: 'คลาส Led ถ่ายทอดสดทาง Zoom ด้วย',
  },
};

const USAGE = `AYBKK timetable poster

  node render.js --all [--month 2026-12] [--look A|B]
      every image for the month (EN and TH, feed and story) into
      ${OUT_ROOT}/<YYYY-MM>/  (both looks unless --look is given)

  node render.js --month 2026-11 --lang en|th --size feed|story --look A|B --out file.png
      one image (look ${DEFAULT_LOOK} if --look is left out)

Options
  --month YYYY-MM   default: next month (Bangkok time)
  --photo path      background photo (default photo.jpg here). A photo.json beside it may give
                    credit, creditBox and crop positions; see README.md
  --credit "a|b|c"  photo credit to re-stamp if the photo's own credit is cut off or covered
                    (| separates its lines)
  --data file       schedule JSON saved from ${API}
                    (default: fetch it live)
  --outdir dir      folder for --all (default ${OUT_ROOT}, or env POSTER_OUT)
  --today YYYY-MM-DD  pretend today is this Bangkok date (testing)
`;

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) throw new Error('Unexpected argument: ' + k);
    const key = k.slice(2);
    if (key === 'all' || key === 'help') { a[key] = true; continue; }
    const v = argv[++i];
    if (v == null || v.startsWith('--')) throw new Error('Missing value for ' + k);
    a[key] = v;
  }
  return a;
}

const bkkToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const bkkTime = iso => new Date(Date.parse(iso) + 7 * 3600e3).toISOString().slice(11, 16).replace(/^0/, '');
const teacherList = c => String(c.teachers || '').split(/\s*[,&]\s*/).filter(Boolean);

function nextMonth(today) {
  const [y, m] = today.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

function loadSchedule(file) {
  let raw;
  if (file) raw = fs.readFileSync(file, 'utf8');
  else {
    console.log('Fetching live timetable: ' + API);
    raw = execFileSync('curl', ['-sS', '-m', '40', '--fail', API], { encoding: 'utf8' });
  }
  const s = JSON.parse(raw);
  if (!Array.isArray(s.classes)) throw new Error('Schedule has no classes list');
  return { s, raw };
}

function loadPhoto(file) {
  const src = path.resolve(file || path.join(DIR, 'photo.jpg'));
  const side = src.replace(/\.[^.]+$/, '.json');
  const meta = fs.existsSync(side) ? JSON.parse(fs.readFileSync(side, 'utf8')) : {};
  const ext = path.extname(src).slice(1).toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return { file: src, meta, url: `data:${mime};base64,` + fs.readFileSync(src).toString('base64') };
}

// The classes of one Bangkok date, one group per class type in start order:
// Mysore 5:30 + 7:30 become one group with two times.
function groupDay(classes) {
  const groups = [];
  for (const c of [...classes].sort((a, b) => a.startAt.localeCompare(b.startAt))) {
    let g = groups.find(x => x.kind === c.kind);
    if (!g) groups.push(g = { kind: c.kind, title: c.title, times: [], teachers: [] });
    g.times.push(bkkTime(c.startAt));
    for (const t of teacherList(c)) if (!g.teachers.includes(t)) g.teachers.push(t);
  }
  return groups;
}

function buildMonth(sched, month, today, warn) {
  const [y, m] = month.split('-').map(Number);
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const moon = { ...sched.moonDays };
  for (const [d, kind] of Object.entries(moonDaysBetween(`${month}-01`, `${month}-${daysIn}`))) if (d < today) moon[d] = kind;
  const byDate = {};
  for (const c of sched.classes) if (!c.isOnline) (byDate[c.date] = byDate[c.date] || []).push(c);
  const lastDate = sched.to || Object.keys(byDate).sort().pop();
  const days = [];
  for (let d = 1; d <= daysIn; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    if (moon[date]) { days.push({ d, date, moon: moon[date] }); continue; }
    let src = date;
    // The live timetable hides classes that have started, so a day that is today or past
    // borrows the same weekday two (or one) weeks later; two keeps the Saturday teacher rotation.
    if (date <= today) {
      src = [14, 7, 21, 28].map(k => addDays(date, k)).find(x => !moon[x] && (byDate[x] || []).length) || null;
      console.log(src ? `  ${date} has started or passed: showing the classes of ${src}, same weekday.`
        : `  ${date} has started or passed and no later week has classes to borrow.`);
      if (!src) warn.push(`${date}: no classes to show`);
    } else if (date > lastDate) {
      warn.push(`${date}: after the last day of the live timetable (${lastDate})`);
    }
    days.push({ d, date, src, groups: groupDay(src ? byDate[src] || [] : []) });
  }
  const rows = Math.ceil((first + daysIn) / 7);
  const online = sched.classes.some(c => c.isOnline && c.date.startsWith(month));
  return { y, m, first, daysIn, rows, days, online };
}

// Same moon formula as bkk-api.js (moonJD, moonDaysBetween). The live timetable lists moon days
// from today on only, so days already past in the month come from here.
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
  const out = {};
  const y = Number(fromYmd.slice(0, 4)) + (Number(fromYmd.slice(5, 7)) - 1) / 12;
  const k0 = Math.floor((y - 1900) * 12.3685) - 2;
  for (let k = k0; k < k0 + 40; k++) {
    for (const [ph, name] of [[0, 'new'], [0.5, 'full']]) {
      const d = new Date((moonJD(k + ph) - 2440587.5) * 864e5 + 7 * 3600e3).toISOString().slice(0, 10);
      if (d >= fromYmd && d <= toYmd) out[d] = name;
    }
  }
  return out;
}

const cleanTitle = t => String(t).replace(/^\[Online\]\s*/, '').replace(/\s+series$/, '').replace(/\s*\((1st|2nd) batch\)/, '');

function payload(month, lang, size, look, photo, credit) {
  const L = TEXT[lang];
  const { W, H } = SIZES[size];
  const cells = month.days.map(day => {
    const i = month.first + day.d - 1;
    let lines;
    if (day.moon) lines = [{ t: typeof L.moon === 'string' ? L.moon : L.moon[day.moon] }];
    else if (!day.groups.length) lines = [{ t: L.none }];
    else lines = day.groups.flatMap(g => [
      { t: L.kinds[g.kind] || cleanTitle(g.title), k: g.kind },
      { t: g.times.join(' ') },
      { t: g.teachers.join(', ') },
    ]);
    return { d: day.d, col: (i % 7) + 1, row: Math.floor(i / 7) + 1, moon: !!day.moon, lines };
  });
  const lead = month.first, trail = month.rows * 7 - month.first - month.daysIn;
  // Six-week months always open with five or six empty days: the month name sits there.
  const titleIn = month.rows >= 6 && lead >= 4 ? 'lead' : 'top';
  const leadFree = titleIn === 'lead' ? 0 : lead;
  let footIn = 'band', creditIn;
  if (trail >= 3) footIn = 'trail';
  else if (leadFree >= 3) footIn = 'lead';
  if (footIn !== 'band') creditIn = 'foot';
  else creditIn = trail >= 2 ? 'trail' : leadFree >= 2 ? 'lead' : 'band';
  const foot = [L.book, L.where];
  if (month.online) foot.push(L.zoom);
  const meta = photo.meta;
  return {
    lang, size, look, W, H,
    title: `${L.months[month.m - 1]} ${L.year(month.y)}`,
    heads: L.heads, rows: month.rows, lead, trail, titleIn, footIn, creditIn, cells, foot,
    photo: {
      src: photo.url,
      pos: (meta.pos && meta.pos[size]) || (size === 'feed' ? '50% 0%' : '50% 50%'),
      credit: credit ? credit.split('|').map(x => x.trim()).filter(Boolean) : [].concat(meta.credit || []),
      box: meta.creditBox || null,
    },
  };
}

async function renderOne(browser, template, data, out) {
  const page = await browser.newPage({ viewport: { width: data.W, height: data.H }, deviceScaleFactor: 1 });
  const html = template
    .replace('__INTER__', () => 'data:font/woff2;base64,' + fs.readFileSync(path.join(DIR, 'fonts/inter.woff2')).toString('base64'))
    .replace('__THAI__', () => 'data:font/ttf;base64,' + fs.readFileSync(path.join(DIR, 'fonts/noto-sans-thai.ttf')).toString('base64'))
    .replace('__DATA__', () => JSON.stringify(data).replace(/</g, '\\u003c'));
  await page.setContent(html, { waitUntil: 'load' });
  const r = await page.evaluate(() => window.layout());
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const jpg = /\.jpe?g$/i.test(out);
  await page.screenshot({ path: out, type: jpg ? 'jpeg' : 'png', quality: jpg ? 92 : undefined, clip: { x: 0, y: 0, width: data.W, height: data.H } });
  await page.close();
  const notes = [`title ${r.title}px`];
  if (r.steps.length) notes.push('fitted: ' + r.steps.join(', '));
  if (r.restamp) notes.push('photo credit re-stamped in the footer');
  console.log(`${r.overflow.length ? 'CHECK' : 'ok   '} ${out}  (${notes.join('; ')})`);
  if (r.overflow.length) console.log('      text does not fit in: ' + r.overflow.join(', '));
  if (r.minSmall < 22) console.log('      small text is ' + r.minSmall + 'px, under 22px');
  return r;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) { console.log(USAGE); return; }
  const today = a.today || bkkToday();
  const month = a.month || nextMonth(today);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('--month must look like 2026-11');
  for (const [k, ok] of [['lang', ['en', 'th']], ['size', Object.keys(SIZES)], ['look', LOOKS]]) {
    if (a[k] && !ok.includes(a[k])) throw new Error(`--${k} must be one of ${ok.join(', ')}`);
  }
  const { s: sched, raw } = loadSchedule(a.data);
  const photo = loadPhoto(a.photo);
  const template = fs.readFileSync(path.join(DIR, 'template.html'), 'utf8');
  console.log(`${month}, today ${today} (Bangkok), photo ${photo.file}`);
  const warn = [];
  const m = buildMonth(sched, month, today, warn);
  for (const w of warn) console.log('  WARNING ' + w);

  const jobs = [];
  if (a.all) {
    const dir = path.join(a.outdir || OUT_ROOT, month);
    for (const look of a.look ? [a.look] : LOOKS) for (const lang of ['en', 'th']) for (const size of ['feed', 'story']) {
      jobs.push({ lang, size, look, out: path.join(dir, `aybkk-${month}-${lang}-${size}-${look}.png`) });
    }
    fs.mkdirSync(dir, { recursive: true });
    if (!a.data) fs.writeFileSync(path.join(dir, 'schedule.json'), raw);
  } else {
    const lang = a.lang || 'en', size = a.size || 'feed', look = a.look || DEFAULT_LOOK;
    jobs.push({ lang, size, look, out: path.resolve(a.out || path.join(a.outdir || OUT_ROOT, month, `aybkk-${month}-${lang}-${size}-${look}.png`)) });
  }

  const browser = await chromium.launch();
  let bad = 0;
  try {
    for (const j of jobs) {
      const r = await renderOne(browser, template, payload(m, j.lang, j.size, j.look, photo, a.credit), j.out);
      if (r.overflow.length) bad++;
    }
  } finally { await browser.close(); }
  if (bad || warn.length) process.exitCode = 1;
}

if (require.main === module) main().catch(e => { console.error('Error: ' + e.message); process.exit(1); });
module.exports = { TEXT, SIZES, buildMonth, payload, loadPhoto, renderOne };
