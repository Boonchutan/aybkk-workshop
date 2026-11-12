// End-to-end test of scripts/rezerv-import.js: the admin page's Rezerv import
// run from the command line, against a real Postgres.
// Every person here is made up, and nothing leaves this machine: the tool is
// always given a local address, and its https proxy is a dead local port.
const stamp = String(Date.now());
// Letters only. It is in every made-up name and email, so it must never show
// in what the tool prints.
const TAG = [...stamp].map(d => 'qwertyuiop'[d]).join('');
const KEY = `cli-test-key-${TAG.slice(-6)}`;
process.env.BKK_ADMIN_KEY = KEY;
process.env.MAIL_DRY_RUN = '1';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), https = require('https');
const { spawn, execFileSync } = require('child_process');
const express = require('express');
const { Pool } = require('pg');
const { mountBkk, moonDaysBetween } = require('../bkk-api.js');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ||
  'postgres://test:test@127.0.0.1:5432/rezervclitest' });
const SCRIPT = path.join(__dirname, '../scripts/rezerv-import.js');
const PAGE = path.join(__dirname, '../public/bkk-admin.html');

let PASS = 0, FAIL = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name} ${extra}`); }
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const one = async (sql, args = []) => (await pool.query(sql, args)).rows[0] || {};

// ── made-up people and Rezerv-shaped files ─────────────────────────────────
const s8 = stamp.slice(-8);
const rz = n => `7${s8}${String(n).padStart(4, '0')}`;        // RezervPass ID
const phone = n => `08${s8.slice(-6)}${String(n).padStart(2, '0')}`;
const who = (n, first) => ({ rz: rz(n), first, last: `Fake${TAG}`, name: `${first} Fake${TAG}`,
  email: `${first.toLowerCase()}.${TAG}@example.com`, phone: phone(n) });
const trx = n => `TRX_${s8}${String(n).padStart(3, '0')}`;
const csv = (head, rows, sep = ',', eol = '\r\n') => '\uFEFF' + [head.split(',').join(sep), ...rows.map(r => head.split(',').map(h => {
  const v = String(r[h] ?? '');
  return /[",\n\t]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}).join(sep))].join(eol) + eol;
const bkkDay = ms => new Date(ms + 7 * 3600000).toISOString().slice(0, 10);
const T0 = bkkDay(Date.now());
const addD = (d, k) => new Date(Date.parse(d + 'T12:00:00Z') + k * 86400000).toISOString().slice(0, 10);
const dmyy = d => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y.slice(2)}`; };
const dmyyyy = d => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; };

// Rezerv's own export headings.
const STUDENTS = 'CustomerName,MobileCode,Mobile,Email,RezervPass ID,DateOfBirth,Gender,AddressLine1,AddressLine2,City,State,PostalCode,Country,Group,Tag,LifeCycle,JoinedDate,Channel,Status,Completed,Booked,No Show,Cancelled,Late Cancelled,Waitlist Cancelled,Waitlist Expired,Total Booking';
const MEMBERSHIPS = 'First_Name,Last_Name,Mobile,Email,RezervPass ID,Membership,Membership Number,Category,Status,Joining Fee,Renews,Renews On,Purchase_Date,Start_Date,Expiration_Date,Cancel,Cancelled date,Booking,Completed,Paid amount,Total class credits,Remaining class credits,Total appointment credits,Remaining appointment credits,Total outlet access credits,Remaining outlet access credits,Credits period,Recognised revenue,Deferred revenue,Amount,Billing cycle,Freeze start date,Freeze end date,Freeze reason,Last_Transaction_ID,Last_Transaction_Date,Last_Transaction_Status,Last_Booking_Completed_Date,Last_Booking_Ref,Last_Booking_Class,Next_Booked_Date,Next_Booking_Ref,Next_Booking_Class';
const PACKAGES = 'First Name,Last Name,Mobile Code,Mobile,Email,RezervPass ID,Packages,Category,Total Credit,Paid Amount,Revenue Per Credit,Used Credits,Recognised Revenue,Unutilised Credit Balance,Deferred Revenue,Expired Credits,Expired Recognised Revenue,Package Status,Purchase Date,Activation Type,Start Date,Expiration Date,Invoice No,Transaction Id,Receipt No,Transaction Status,Last Booking Completed Date,Last Booking Ref,Last Booking Service,Paid On';
const PAYMENTS = 'Paid On,TransactionID,Issued On,Invoice ID,CustomerName,MobileCode,Mobile,Email,RezervPass ID,Item Type,Linked Item,Quantity,Payment Method,Sales Channel,Location,Sold By,Amount,Discount,Tax,Paid Amount,Fee,Net Amount,Promo Code Set,Promo Code,Value,Value Type,Status,Original TransactionId,Brand,Comment,Pis Receipt Number,External Transaction ID,Order ID';
const VISITS = 'Date of service,Start time,End time,Duration,Booking Day,Booking created,Service Type,Category,Service Name,Location,Facility,Staff,Equipment,Booking Ref/No.,Customer,Mobile number,Email address,RezervPass ID,Status,Spot,Booking type,Transaction_ID,Invoice ID,Paid On,Payment,Credit Used,Total pricing plan credit,Slot per booking,Total Slots,Revenue per booking,Total transaction revenue,SoldAt,BusinessName';
const VOIDED = 'Date voided on,Voided transaction ID,Original transaction ID,Customer name,Net amount,Item type,Linked item,Payment method,Staff who\'s voided,Reason for void';

const student = (p, more = {}) => ({ CustomerName: p.name, MobileCode: '66', Mobile: p.phone, Email: p.email, 'RezervPass ID': p.rz,
  DateOfBirth: '01/02/1990', AddressLine1: '1 Made Up Road', City: 'Bangkok', JoinedDate: '15/03/24 07:12', Status: 'Active', Booked: '3', ...more });
const membership = (p, n, plan, status, start, end) => ({ First_Name: p.first, Last_Name: p.last, Mobile: '', Email: p.email,
  'RezervPass ID': p.rz, Membership: plan, 'Membership Number': `8${s8}${String(n).padStart(3, '0')}`, Status: status,
  Start_Date: dmyy(start), Expiration_Date: dmyy(end), 'Remaining class credits': '0', Cancel: 'No', 'Cancelled date': '--',
  'Freeze start date': '--', 'Freeze end date': '--' });
const pack = (p, n, plan, status, start, end, total, left) => ({ 'Transaction Id': trx(900 + n), 'RezervPass ID': p.rz,
  'First Name': p.first, 'Last Name': p.last, Email: p.email, 'Mobile Code': '66', Mobile: '', Packages: plan, 'Package Status': status,
  'Start Date': start === '--' ? '--' : dmyyyy(start), 'Expiration Date': end === '--' ? '--' : dmyyyy(end),
  'Total Credit': total, 'Unutilised Credit Balance': left });
const payment = (paidOn, n, p, item, method, paid, tax, status = 'Paid') => ({ 'Issued On': paidOn, 'Paid On': paidOn, TransactionID: trx(n),
  'RezervPass ID': p.rz, CustomerName: p.name, Email: p.email, MobileCode: '66', Mobile: '', Status: status, 'Linked Item': item,
  'Payment Method': method, 'Paid Amount': paid, Tax: tax, Amount: (paid - tax).toFixed(2) });
const visit = (date, time, cls, ref, p, status) => ({ 'Booking Ref/No.': ref, 'RezervPass ID': p.rz, Customer: p.name,
  'Email address': p.email, 'Mobile number': '+66', 'Date of service': dmyyyy(date), 'Start time': time, 'Service Name': cls, Status: status });

(async () => {
  // ── the API on the test database, and the address the tool is given ───────
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  const mounted = new Promise(resolve => {
    const log = console.log;
    console.log = (...a) => { if (String(a[0]).includes('bkk-api mounted')) { console.log = log; resolve(); } else log(...a); };
    setTimeout(() => { console.log = log; resolve(); }, 20000);
  });
  mountBkk(app, { pgPool: pool });
  await mounted;
  await wait(700);
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const API = `http://127.0.0.1:${srv.address().port}`;

  // In front of the API: it remembers every request the tool makes, can answer
  // in the API's place, and can add the admin key as the operator's network does.
  const calls = [];
  let hook = null, addKey = false;
  const relay = async (req, res, key) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = null;
    try { body = JSON.parse(raw); } catch { /* not JSON */ }
    const call = { path: req.url, kind: req.url.split('/').pop(), key: req.headers['x-bkk-key'] || null, body,
      dry: body ? body.dryRun : undefined, n: body && Array.isArray(body.rows) ? body.rows.length : 0 };
    calls.push(call);
    const canned = hook && hook(call);
    if (canned === 'hang') return;
    if (canned) { res.writeHead(canned.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(canned.body)); }
    const headers = { 'Content-Type': 'application/json' };
    if (call.key || key) headers['x-bkk-key'] = call.key || key;
    const r = await fetch(API + req.url, { method: req.method, headers, body: raw });
    res.writeHead(r.status, { 'Content-Type': 'application/json' });
    res.end(await r.text());
  };
  const front = http.createServer((req, res) => relay(req, res, addKey ? KEY : null).catch(() => res.destroy()));
  await new Promise(r => front.listen(0, '127.0.0.1', r));
  const FRONT = `http://127.0.0.1:${front.address().port}`;

  // The tool, as a person runs it. key: BKK_ADMIN_KEY in its environment or not.
  let ALL = '';
  const cli = (args, { key = true, env = {}, base = FRONT } = {}) => new Promise(resolve => {
    const e = { ...process.env, HTTPS_PROXY: 'http://127.0.0.1:9', https_proxy: 'http://127.0.0.1:9', NO_PROXY: '', no_proxy: '', ...env };
    if (key) e.BKK_ADMIN_KEY = KEY; else delete e.BKK_ADMIN_KEY;
    delete e.SHOP_ADMIN_KEY;
    const p = spawn(process.execPath, [SCRIPT, ...args, ...(base && args[0] !== 'plan' ? ['--base', base] : [])], { env: e });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => { ALL += out + err; resolve({ code, out, err, all: out + err }); });
  });
  const since = async fn => { const at = calls.length; const r = await fn(); return { ...r, calls: calls.slice(at) }; };
  const num = (r, label) => { const m = r.out.match(new RegExp(`^  ${label}: (\\d+)`, 'm')); return m ? Number(m[1]) : null; };
  const counts = r => ['Rows', 'Added', 'Already there', 'Updated', 'New students', 'Skipped'].map(l => num(r, l)).join(':');

  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rezerv-cli-'));
  const dir = name => { const d = path.join(TMP, name); fs.mkdirSync(d, { recursive: true }); return d; };
  const put = (d, name, text) => { const f = path.join(d, name); fs.writeFileSync(f, text); return f; };
  const members = async ids => (await pool.query('SELECT rezerv_id, name, email, phone FROM bkk_members WHERE rezerv_id = ANY($1) ORDER BY rezerv_id', [ids])).rows;

  console.log('\n— plan: which files, in which order —');
  {
    const d = dir('plan');
    const wanted = ['rezerv-students-2026-11-12.csv', 'rezerv-passes-memberships-2026-11-12.csv', 'rezerv-passes-packages-2026-11-12.csv',
      'rezerv-payments-2024.csv', 'rezerv-payments-2025-jan-jun.csv', 'rezerv-payments-2025-jul-dec.csv', 'rezerv-payments-2026.csv',
      'rezerv-visits-2024.csv', 'rezerv-visits-2025.csv', 'rezerv-visits-2026.csv', 'rezerv-visits-upcoming-2026-11-12.csv'];
    const never = ['rezerv-payments-voided-2026.csv', 'rezerv-payments-refunded-2026.csv', 'rezerv-class-attendance-2026.csv',
      'students.csv', 'notes.txt', 'rezerv-something-else.csv', 'rezerv-students-2026-11-12.xlsx'];
    for (const n of [...wanted].reverse().concat(never)) put(d, n, '');
    fs.mkdirSync(path.join(d, 'rezerv-details'));
    const r = await since(() => cli(['plan', d]));
    const listed = [...r.out.matchAll(/^\s+\d+\. (\w+)\s+(\S+)$/gm)].map(m => `${m[1]} ${m[2]}`);
    const kinds = ['members', 'passes', 'passes', 'payments', 'payments', 'payments', 'payments', 'visits', 'visits', 'visits', 'visits'];
    ok('plan lists the 11 files in import order: students, memberships, packages, payments by year and month, visits by year, upcoming last',
       r.code === 0 && listed.join() === wanted.map((n, i) => `${kinds[i]} ${n}`).join(), r.all);
    const ignored = [...r.out.matchAll(/^\s+- (\S+): (.*)$/gm)].map(m => m[1]).sort();
    ok('...and names what it ignores: voided, refunded, class-attendance, not rezerv-, not a name it knows',
       ignored.join() === [...never].sort().join() && /voided-2026\.csv: its name says voided/.test(r.out)
       && /refunded-2026\.csv: its name says refunded/.test(r.out) && /attendance-2026\.csv: its name says class-attendance/.test(r.out)
       && /notes\.txt: its name does not start with rezerv-/.test(r.out), r.out);
    ok('...without asking the server anything', r.calls.length === 0);
    const parts = dir('plan-parts');
    for (const n of ['rezerv-payments-2025-q3.csv', 'rezerv-payments-2025-10-12.csv', 'rezerv-payments-2025-01-06.csv', 'rezerv-payments-2025.csv',
      'rezerv-payments-2024-part2.csv', 'rezerv-payments-2024-part1.csv']) put(parts, n, '');
    const pr = await cli(['plan', parts]);
    ok('...parts of a year go by where they start, however they are named',
       [...pr.out.matchAll(/^\s+\d+\. payments\s+rezerv-payments-(\S+)\.csv$/gm)].map(m => m[1]).join()
       === '2024-part1,2024-part2,2025,2025-01-06,2025-q3,2025-10-12', pr.out);
    ok('...and plan says which kinds of file a folder lacks', !/Not in this folder/.test(r.out) && pr.out.includes('Not in this folder: '
       + 'rezerv-students-*.csv, rezerv-passes-memberships-*.csv, rezerv-passes-packages-*.csv, rezerv-visits-<year>*.csv, rezerv-visits-upcoming-*.csv'), pr.out);
  }

  // ── one file at a time ────────────────────────────────────────────────────
  const A = dir('one');
  const ada = who(1, 'Ada'), ben = who(2, 'Ben');
  const quoty = { ...who(3, 'Quoty'), name: `Fake${TAG}, Quoty\nJunior` };
  const studentsFile = put(A, 'students.csv', csv(STUDENTS, [student(ada), student(ben), student(quoty)]));
  const ids3 = [ada.rz, ben.rz, quoty.rz];

  console.log('\n— check: a look that saves nothing —');
  const chk = await since(() => cli(['check', 'members', studentsFile]));
  ok('check reports the counts: 3 rows, 3 to add, none there yet', chk.code === 0 && counts(chk) === '3:3:0:0:0:0'
     && /^File: students\.csv$/m.test(chk.out) && /^Kind: members$/m.test(chk.out), chk.all);
  ok('...sends one dry run, numbered from the file\'s row 2', chk.calls.length === 1 && chk.calls[0].dry === true
     && chk.calls[0].body.firstRow === 2 && chk.calls[0].n === 3 && chk.calls[0].path === '/api/bkk/admin/import/members', JSON.stringify(chk.calls.map(c => [c.path, c.dry])));
  ok('...and saves nothing', (await members(ids3)).length === 0);
  const sent = chk.calls[0].body.rows;
  ok('a quoted cell with a comma and a line break is one cell of one row', sent[2].name === `Fake${TAG}, Quoty\nJunior` && sent[2].rezervId === quoty.rz,
     JSON.stringify(sent[2]));
  ok('only the page\'s fields are sent, the phone joined to its country code as the page does',
     sent.every(o => Object.keys(o).every(k => ['rezervId', 'name', 'email', 'phone', 'joinedOn'].includes(k)))
     && sent[0].phone === `+66 ${ada.phone.slice(1)}` && sent[0].joinedOn === '15/03/24 07:12', JSON.stringify(sent[0]));
  ok('with BKK_ADMIN_KEY set the key goes in x-bkk-key', chk.calls[0].key === KEY);
  ok('check prints the command that would save, with its counts', chk.out.includes(`write members '${studentsFile}' --expect "3:3:0:0:0" --base ${FRONT}`), chk.out);

  console.log('\n— write: only when the check gives the counts expected —');
  const wrong = await since(() => cli(['write', 'members', studentsFile, '--expect', '3:2:1:0:0']));
  ok('write with the wrong --expect saves nothing and says so', wrong.code === 1 && /The check gives "3:3:0:0:0", not the "3:2:1:0:0" in --expect/.test(wrong.err)
     && /Nothing was saved/.test(wrong.err) && (await members(ids3)).length === 0, wrong.all);
  ok('...it sent the check only', wrong.calls.length === 1 && wrong.calls[0].dry === true, JSON.stringify(wrong.calls.map(c => c.dry)));
  const right = await since(() => cli(['write', 'members', studentsFile, '--expect', '3:3:0:0:0']));
  const savedM = await members(ids3);
  ok('write with the right --expect checks, then saves', right.code === 0 && right.calls.map(c => c.dry).join() === 'true,false'
     && savedM.length === 3 && /^Saved:$/m.test(right.out), right.all);
  ok('...the quoted name, the email and the phone are on the profile',
     savedM[2].name === `Fake${TAG}, Quoty Junior` && savedM[0].email === ada.email && savedM[0].phone === `+66 ${ada.phone.slice(1)}`, JSON.stringify(savedM));
  const again = await cli(['check', 'members', studentsFile]);
  ok('a second run reports every row as already there', again.code === 0 && counts(again) === '3:0:3:0:0:0', again.all);
  const stale = await since(() => cli(['write', 'members', studentsFile, '--expect', '3:3:0:0:0']));
  ok('...and an --expect from before the save no longer fits: nothing is sent to save',
     stale.code === 1 && stale.calls.every(c => c.dry === true) && (await members(ids3)).length === 3, stale.all);
  const usage = [await since(() => cli(['write', 'members', studentsFile])), await since(() => cli(['check', 'cats', studentsFile])),
    await since(() => cli(['check', 'members', studentsFile], { base: 'http://files.example.com' })),
    await since(() => cli(['run-all', A, '--past-attended']))];
  ok('wrong use (no --expect, an unknown kind, http to another machine, a flag the command does not take) exits 2 and sends nothing',
     usage.every(u => u.code === 2 && u.calls.length === 0), JSON.stringify(usage.map(u => [u.code, u.calls.length])));

  console.log('\n— files as Excel saves them —');
  {
    const uni = who(4, 'Unicode'), thai = { ...who(5, 'Thai'), name: `ทดสอบ Fake${TAG}` };
    const u16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(csv(STUDENTS, [student(uni)], '\t').slice(1), 'utf16le')]);
    const cp874 = Buffer.from([...csv(STUDENTS, [student(thai)]).slice(1)].map(ch => {
      const c = ch.charCodeAt(0);
      return c >= 0x0E01 && c <= 0x0E5B ? c - 0x0E00 + 0xA0 : c;
    }));
    const r16 = await since(() => cli(['check', 'members', put(A, 'utf16.csv', u16)]));
    ok('a UTF-16 file with tabs is read', r16.code === 0 && counts(r16) === '1:1:0:0:0:0' && r16.calls[0].body.rows[0].name === uni.name, r16.all);
    const r874 = await since(() => cli(['check', 'members', put(A, 'thai.csv', cp874)]));
    ok('a file in the Thai Windows code page is read, its Thai name whole',
       r874.code === 0 && counts(r874) === '1:1:0:0:0:0' && r874.calls[0].body.rows[0].name === thai.name, r874.all);
    const xl = await since(() => cli(['check', 'members', put(A, 'book.csv', Buffer.from([0x50, 0x4B, 3, 4, 20, 0]))]));
    ok('an Excel workbook is refused before anything is sent', xl.code === 1 && /Refused \(excel-file\)/.test(xl.err) && xl.calls.length === 0, xl.all);
  }

  console.log('\n— payments: Paid On is month first —');
  const payFile = put(A, 'pay.csv', csv(PAYMENTS, [
    payment('03/15/2024 05:42:10', 1, ada, '1 Year (13 months)', 'CARD', 52000, 3401.87),
    payment('11/02/2025 06:10:00', 2, ben, 'Mysore 5.30am (1st batch)', 'PROMPTPAY', 1685.25, 110.25),
    payment('10/05/2026 07:00:00', 3, ada, '1 Month unlimited', 'CARD', 9600, 628.04, 'Voided'),
  ]));
  const payDay = async n => (await one(`SELECT to_char(o.verified_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') AS d FROM bkk_orders o
    WHERE o.source='rezerv' AND o.source_ref=$1`, [trx(n)])).d;
  const payChk = await since(() => cli(['check', 'payments', payFile]));
  ok('a payments file is read month first, and says so', payChk.code === 0 && /^  Dates read month first: date$/m.test(payChk.out)
     && payChk.calls[0].body.rows[0].date === '15/03/2024 05:42:10' && payChk.calls[0].body.rows[1].date === '02/11/2025 06:10:00', payChk.all);
  ok('...a voided payment is skipped under its code, which is an expected one', counts(payChk) === '3:2:0:0:0:1'
     && /^    notMoney: 1 \(expected: nothing to keep\)$/m.test(payChk.out) && /^For run-all: clean\.$/m.test(payChk.out), payChk.out);
  const payWr = await cli(['write', 'payments', payFile, '--expect', '3:2:0:0:1']);
  ok('...saved on the right days: 15 March 2024, and 2 November 2025, not 11 February',
     payWr.code === 0 && (await payDay(1)) === '2024-03-15' && (await payDay(2)) === '2025-11-02' && (await payDay(3)) === undefined, payWr.all);
  const dayFirst = await cli(['check', 'payments', put(A, 'pay-dayfirst.csv', csv(PAYMENTS, [
    payment('15/03/2024 05:42:10', 4, ada, 'Drop-in', 'CARD', 1605, 105)]))]);
  ok('a Rezerv payments file whose dates do not read month first would stop run-all', dayFirst.code === 0
     && /^  Dates read month first: none$/m.test(dayFirst.out) && /^For run-all: it would stop here \(paid-on-not-month-first\)/m.test(dayFirst.out), dayFirst.out);

  console.log('\n— the page\'s own refusals —');
  const voidFile = put(A, 'old-transactions.csv', csv(VOIDED, [{ 'Date voided on': '5 jan 2024 10:00am', 'Voided transaction ID': 'PISV_1',
    'Original transaction ID': 'PIS_1', 'Customer name': `Void Fake${TAG}`, 'Net amount': '30000.00', 'Linked item': '6 months Unlimited',
    'Payment method': 'CARD', 'Reason for void': 'made up' }]));
  const refused = [await since(() => cli(['check', 'payments', voidFile])), await since(() => cli(['check', 'members', voidFile])),
    await since(() => cli(['write', 'payments', voidFile, '--expect', '1:1:0:0:0']))];
  ok('a voided-payments file is refused as any kind, for check and for write, with nothing sent',
     refused.every(r => r.code === 1 && /Refused \(void-file\)/.test(r.err) && /Nothing was sent/.test(r.err) && r.calls.length === 0),
     JSON.stringify(refused.map(r => [r.code, r.err, r.calls.length])));
  const noCols = await since(() => cli(['check', 'passes', studentsFile]));
  ok('a file without the columns its kind needs is refused, naming our fields, not the file\'s headings',
     noCols.code === 1 && /Refused \(missing-columns\): no column found for: plan, until\./.test(noCols.err) && noCols.calls.length === 0, noCols.all);
  const noWho = await since(() => cli(['check', 'payments', put(A, 'nobody.csv', 'Paid On,Paid Amount\r\n03/15/2024,100\r\n')]));
  ok('...and so is one with no column saying who the student is', noWho.code === 1 && /Refused \(missing-who\)/.test(noWho.err) && noWho.calls.length === 0, noWho.all);
  const empty = await since(() => cli(['check', 'members', put(A, 'empty.csv', STUDENTS + '\r\n')]));
  ok('...and one with headings and no rows', empty.code === 1 && /Refused \(empty-file\)/.test(empty.err) && empty.calls.length === 0, empty.all);
  const dflt = await since(() => cli(['check', 'payments', voidFile], { base: null, key: false }));
  ok('with no --base the server is https://aybkk.net (seen on a refused file: nothing is sent)',
     dflt.code === 1 && /^Server: https:\/\/aybkk\.net$/m.test(dflt.out) && dflt.calls.length === 0, dflt.all);

  console.log('\n— counts on screen, names in the details file —');
  {
    const twinA = { ...who(6, 'Twin') }, twinB = { ...who(7, 'Twin'), email: `twin.two.${TAG}@example.com` };
    const newbie = who(8, 'Newbie');
    await cli(['write', 'members', put(A, 'twins.csv', csv(STUDENTS, [student(twinA, { Email: '' }), student(twinB)])), '--expect', '2:2:0:0:0']);
    // No customer id and no email: the name alone fits two students. And a student nobody has seen before.
    const f = put(A, 'pay-twins.csv', csv(PAYMENTS, [
      { ...payment('03/20/2024 09:00:00', 10, twinA, 'Drop-in', 'CARD', 1605, 105), 'RezervPass ID': '0', Email: '' },
      payment('03/21/2024 09:00:00', 11, newbie, 'Drop-in', 'CARD', 1605, 105)]));
    const det = path.join(A, 'details.json');
    fs.writeFileSync(det, 'old', { mode: 0o644 });
    const r = await cli(['check', 'payments', f, '--details', det]);
    ok('a skip that needs a person is counted under its code, and check says run-all would stop', r.code === 0 && counts(r) === '2:1:0:0:1:1'
       && /^    sameName: 1 \(a person must look\)$/m.test(r.out) && /^    newStudent: 1$/m.test(r.out)
       && /^For run-all: it would stop here \(skip-code-needs-a-person\): .*sameName 1\.$/m.test(r.out), r.out);
    const d = JSON.parse(fs.readFileSync(det, 'utf8'));
    ok('--details holds the full skipped row and note, with the row number and that row\'s name and email',
       d.kind === 'payments' && d.check.skipped.length === 1 && d.check.skipped[0].row === 2 && d.check.skipped[0].code === 'sameName'
       && d.check.skipped[0].reason.includes(twinA.name) && d.check.skipped[0].name === twinA.name && d.check.skipped[0].email === null
       && d.check.warnings[0].row === 3 && d.check.warnings[0].code === 'newStudent' && d.check.warnings[0].message.includes(newbie.name)
       && d.check.warnings[0].name === newbie.name && d.check.warnings[0].email === newbie.email && d.saved === null, JSON.stringify(d));
    ok('...in a file only its owner can read, even where a wider one stood; only its path is printed',
       (fs.statSync(det).mode & 0o777) === 0o600 && r.out.includes(`Details: ${det}`) && !r.all.includes(TAG), r.all);
    const nowhere = await since(() => cli(['check', 'payments', f, '--details', path.join(A, 'no-such-folder', 'details.json')]));
    ok('a details file that cannot be written is found out before anything is sent', nowhere.code === 2 && nowhere.calls.length === 0
       && /Cannot write the details file/.test(nowhere.err), nowhere.all);
  }

  console.log('\n— visits: past bookings —');
  {
    const f = put(A, 'visits-past.csv', csv(VISITS, [visit('2025-03-06', '05:30 AM', 'Mysore 5.30am (1st batch)', `B${s8}90`, ada, 'Booked')]));
    const off = await since(() => cli(['check', 'visits', f]));
    const on = await since(() => cli(['check', 'visits', f, '--past-attended']));
    const mem = await since(() => cli(['check', 'members', studentsFile, '--past-attended']));
    ok('a past visit still marked booked is counted, and stays booked unless --past-attended is given',
       off.code === 0 && /Past visits still marked booked, not attended: 1\./.test(off.out) && !('pastBookedAttended' in off.calls[0].body)
       && on.code === 0 && on.calls[0].body.pastBookedAttended === true && !/Past visits still marked booked/.test(on.out)
       && on.out.includes('--past-attended') && /Past bookings counted as attended: yes/.test(on.out), off.out + on.out);
    ok('...and the flag does nothing for another kind', mem.code === 0 && !('pastBookedAttended' in mem.calls[0].body));
  }

  // ── run-all ───────────────────────────────────────────────────────────────
  console.log('\n— run-all: a whole folder, in order —');
  const cy = who(11, 'Cy'), dee = who(12, 'Dee'), eli = who(13, 'Eli');
  const slots = (await pool.query(`SELECT id, weekday, title FROM bkk_class_slots WHERE code LIKE 'my530_%' AND active ORDER BY weekday`)).rows;
  let fd = addD(T0, 40);
  while (!slots.some(s => s.weekday === new Date(fd + 'T12:00:00Z').getUTCDay()) || moonDaysBetween(fd, fd).size) fd = addD(fd, 1);
  const fdSlot = slots.find(s => s.weekday === new Date(fd + 'T12:00:00Z').getUTCDay());
  const R = dir('all');
  put(R, 'rezerv-visits-upcoming-2026-11-12.csv', csv(VISITS, [visit(fd, '05:30 AM', 'Mysore 5.30am (1st batch)', `B${s8}04`, cy, 'Booked')]));
  put(R, 'rezerv-visits-2025.csv', csv(VISITS, [
    visit('2025-03-04', '05:30 AM', 'Mysore 5.30am (1st batch)', `B${s8}01`, cy, 'Completed'),
    visit('2025-03-05', '05:30 AM', 'Mysore 5.30am (1st batch)', `B${s8}02`, dee, 'No Show'),
    visit('2025-03-06', '05:30 AM', 'Mysore 5.30am (1st batch)', `B${s8}03`, eli, 'Waitlist Expired')]));
  put(R, 'rezerv-payments-2026.csv', csv(PAYMENTS, [
    payment('10/20/2026 08:00:00', 23, eli, '10 classes/3mo (14000thb + online transaction fee 5%)', 'CARD', 15729, 1029),
    payment('10/21/2026 08:00:00', 24, eli, 'Drop-in', 'CARD', 1605, 105, 'Voided')]));
  put(R, 'rezerv-payments-2025-jul-dec.csv', csv(PAYMENTS, [payment('11/02/2025 06:10:00', 22, dee, '3 months Unlimited', 'PROMPTPAY', 23000, 1504.67)]));
  put(R, 'rezerv-payments-2025-jan-jun.csv', csv(PAYMENTS, [payment('03/15/2025 05:42:10', 21, cy, '1 Month unlimited', 'CARD', 10580, 692.15)]));
  put(R, 'rezerv-passes-packages-2026-11-12.csv', csv(PACKAGES, [
    pack(eli, 1, '10 classes/3mo (14000thb + online transaction fee 5%)', 'Active', addD(T0, -10), addD(T0, 80), 10, 7),
    pack(eli, 2, 'Drop-in', 'Expired', '--', '--', 1, 0)]));
  put(R, 'rezerv-passes-memberships-2026-11-12.csv', csv(MEMBERSHIPS, [
    membership(cy, 1, '1 Month unlimited (9600thb + online transaction fee 5%)', 'Active', addD(T0, -5), addD(T0, 24)),
    membership(dee, 2, '3 months Unlimited', 'Expired', '2025-01-01', '2025-03-31')]));
  put(R, 'rezerv-students-2026-11-12.csv', csv(STUDENTS, [student(cy), student(dee), student(eli)]));
  put(R, 'rezerv-payments-voided-2026.csv', fs.readFileSync(voidFile));
  put(R, 'rezerv-class-attendance-2026.csv', 'Class,Date,Attended\r\nMysore,01/03/2025,12\r\n');
  put(R, 'notes.txt', 'not a Rezerv file');
  const idsR = [cy.rz, dee.rz, eli.rz];
  const state = async () => {
    const m = await pool.query('SELECT id, rezerv_id FROM bkk_members WHERE rezerv_id = ANY($1)', [idsR]);
    const by = Object.fromEntries(m.rows.map(x => [x.rezerv_id, x.id])), mids = m.rows.map(x => x.id);
    const passes = (await pool.query(`SELECT p.member_id, pr.code, p.status, p.credits_used FROM bkk_passes p JOIN bkk_products pr ON pr.id=p.product_id
      WHERE p.member_id = ANY($1) ORDER BY pr.code`, [mids])).rows;
    const orders = (await pool.query(`SELECT source_ref, status FROM bkk_orders WHERE member_id = ANY($1) ORDER BY source_ref`, [mids])).rows;
    const visits = (await pool.query(`SELECT member_id, source_ref, status, slot_id, checked_in_at IS NOT NULL AS came, to_char(class_date,'YYYY-MM-DD') AS d
      FROM bkk_bookings WHERE member_id = ANY($1) ORDER BY source_ref`, [mids])).rows;
    return { by, passes, orders, visits };
  };
  const all1 = await since(() => cli(['run-all', R, '--details-dir', path.join(R, 'details')]));
  ok('run-all saves the 8 files of a made-up folder and ends clean', all1.code === 0 && /^Done: 8 files saved, steps 1 to 8 of 8\.$/m.test(all1.out), all1.all);
  ok('...each file checked, then saved, in the order of the plan',
     all1.calls.map(c => `${c.kind}:${c.dry ? 'check' : 'save'}:${c.n}`).join(' ')
     === 'members:check:3 members:save:3 passes:check:2 passes:save:2 passes:check:2 passes:save:2 payments:check:1 payments:save:1 '
       + 'payments:check:1 payments:save:1 payments:check:2 payments:save:2 visits:check:3 visits:save:3 visits:check:1 visits:save:1',
     JSON.stringify(all1.calls.map(c => [c.kind, c.dry, c.n])));
  const payOrder = all1.calls.filter(c => c.kind === 'payments' && c.dry).map(c => c.body.rows[0].rezervId).join();
  const passOrder = all1.calls.filter(c => c.kind === 'passes' && c.dry).map(c => c.body.rows[0].plan.slice(0, 7)).join();
  ok('...memberships before packages, payments by year and by month', payOrder === [trx(21), trx(22), trx(23)].join()
     && passOrder === '1 Month,10 clas', payOrder + ' ' + passOrder);
  ok('...the voided list, the class-attendance list and the notes are named as ignored, and never read',
     /rezerv-payments-voided-2026\.csv: its name says voided/.test(all1.out) && /rezerv-class-attendance-2026\.csv: its name says class-attendance/.test(all1.out)
     && /notes\.txt: its name does not start with rezerv-/.test(all1.out) && !/^File: (rezerv-payments-voided|rezerv-class|notes)/m.test(all1.out), all1.out);
  ok('...skips under an expected code (a pack never started, a voided payment, a waiting-list place) do not stop it',
     /neverStarted: 1 \(expected/.test(all1.out) && /notMoney: 1 \(expected/.test(all1.out) && /waitlist: 1 \(expected/.test(all1.out), all1.out);
  const st1 = await state();
  ok('...students, passes, payments, visits and the booking still to come are all on aybkk\'s side',
     Object.keys(st1.by).length === 3
     && st1.passes.map(p => `${p.code}:${p.status}:${p.credits_used}`).join() === 'pack10:active:3,unlim1:active:0,unlim3:active:0'
     && st1.orders.map(o => `${o.source_ref}:${o.status}`).join() === [21, 22, 23].map(n => `${trx(n)}:paid`).join()
     && st1.visits.map(v => `${v.status}:${v.came}:${v.d}`).join() === `booked:true:2025-03-04,noshow:false:2025-03-05,booked:false:${fd}`
     && st1.visits[2].slot_id === fdSlot.id && st1.visits[2].member_id === st1.by[cy.rz], JSON.stringify(st1));
  const detFiles = fs.readdirSync(path.join(R, 'details')).sort();
  const packDet = JSON.parse(fs.readFileSync(path.join(R, 'details', 'rezerv-passes-packages-2026-11-12.csv.details.json'), 'utf8'));
  ok('--details-dir gets one private file per file read, the check and the save in each',
     detFiles.length === 8 && detFiles.every(f => (fs.statSync(path.join(R, 'details', f)).mode & 0o777) === 0o600)
     && packDet.check.skipped[0].code === 'neverStarted' && packDet.check.skipped[0].name === eli.name && packDet.check.skipped[0].email === eli.email
     && packDet.saved.added === 1 && packDet.saved.skipped.length === 1, JSON.stringify([detFiles, packDet]));
  const all2 = await cli(['run-all', R]);
  const st2 = await state();
  ok('running the folder again adds nothing twice', all2.code === 0 && !/^  Added: [1-9]/m.test(all2.out) && !/^  New students: [1-9]/m.test(all2.out)
     && JSON.stringify(st2) === JSON.stringify(st1), all2.out);

  console.log('\n— run-all: stopping for a person —');
  {
    const S = dir('stop');
    put(S, 'rezerv-students-2026-11-12.csv', csv(STUDENTS, [student(cy)]));
    const packs = put(S, 'rezerv-passes-packages-2026-11-12.csv', csv(PACKAGES, [
      pack(cy, 11, 'Full workshop with Guest Teachers', 'Expired', '2025-03-01', '2025-03-28', 7, 0),
      pack(cy, 12, 'Drop-in (1500thb + online transaction fee 5%)', 'Expired', '2025-05-06', '2025-05-06', 1, 0)]));
    put(S, 'rezerv-payments-2026.csv', csv(PAYMENTS, [payment('10/22/2026 08:00:00', 31, cy, 'Drop-in', 'CARD', 1605, 105)]));
    const paid = async () => (await one(`SELECT count(*)::int AS n FROM bkk_orders WHERE source='rezerv' AND source_ref=$1`, [trx(31)])).n;
    const dropins = async () => (await one(`SELECT count(*)::int AS n FROM bkk_passes WHERE source='rezerv' AND source_ref=$1`, [trx(912)])).n;
    const r = await since(() => cli(['run-all', S]));
    ok('a skip code that needs a person stops the run: which file, which rule, the counts',
       r.code === 1 && /^STOPPED at step 2 of 3: rezerv-passes-packages-2026-11-12\.csv \(passes\)$/m.test(r.err)
       && /^Rule: skip-code-needs-a-person: .*badPlan 1\.$/m.test(r.err)
       && /^Counts: rows 2, added 1, already there 0, updated 0, new students 0, skipped 1\.$/m.test(r.err), r.all);
    ok('...nothing of that file is saved and no later file is touched',
       r.calls.map(c => `${c.kind}:${c.dry}`).join() === 'members:true,members:false,passes:true' && (await dropins()) === 0 && (await paid()) === 0
       && /Nothing from this file was saved, and no later file was touched/.test(r.err), JSON.stringify(r.calls.map(c => [c.kind, c.dry])));
    const exp = (r.err.match(/write passes '([^']+)' --expect "([\d:]+)"/) || []);
    ok('...and it prints how a person accepts the file and carries on', exp[1] === packs && exp[2] === '2:1:0:0:1'
       && r.err.includes(`run-all '${S}' --from-step 3 --base ${FRONT}`), r.err);
    const acc = await cli(['write', 'passes', packs, '--expect', exp[2] || '0:0:0:0:0']);
    const rest = await since(() => cli(['run-all', S, '--from-step', '3']));
    ok('--from-step carries on after it: the earlier steps are left alone', acc.code === 0 && (await dropins()) === 1 && rest.code === 0
       && rest.calls.map(c => `${c.kind}:${c.dry}`).join() === 'payments:true,payments:false' && (await paid()) === 1
       && /^Done: 1 file saved, steps 3 to 3 of 3\.$/m.test(rest.out), rest.all);
    const far = await since(() => cli(['run-all', S, '--from-step', '4']));
    ok('--from-step past the last step is wrong use', far.code === 2 && far.calls.length === 0, far.all);

    // A server that skips rows for a reason this tool has never heard of.
    const U = dir('unknown');
    put(U, 'rezerv-students-2026-11-12.csv', csv(STUDENTS, [student(cy)]));
    put(U, 'rezerv-payments-2026.csv', csv(PAYMENTS, [payment('10/23/2026 08:00:00', 41, cy, 'Drop-in', 'CARD', 1605, 105)]));
    put(U, 'rezerv-visits-2025.csv', csv(VISITS, [visit('2025-03-07', '05:30 AM', 'Mysore 5.30am (1st batch)', `B${s8}41`, cy, 'Completed')]));
    const fake = skipped => c => c.kind === 'payments' ? { status: 200, body: { kind: 'payments', dryRun: c.dry, total: c.n, added: 0, matched: 0,
      updated: 0, newMembers: 0, skipped, warnings: [] } } : null;
    const tries = [];
    for (const skipped of [[{ row: 2, reason: `a new rule about Secret Fake${TAG}`, code: 'brandNewReason', vals: [`Secret Fake${TAG}`] }],
      [{ row: 2, reason: `insert failed for Secret Fake${TAG}` }], [{ row: 2, reason: 'x', code: `Secret Fake${TAG}` }]]) {
      hook = fake(skipped);
      tries.push(await since(() => cli(['run-all', U])));
      hook = null;
    }
    ok('an unknown skip code stops the run before that file is saved, and before any later file',
       tries.every(t => t.code === 1 && /^STOPPED at step 2 of 3: rezerv-payments-2026\.csv \(payments\)$/m.test(t.err) && /^Rule: unknown-skip-code: /m.test(t.err)
         && t.calls.map(c => `${c.kind}:${c.dry}`).join() === 'members:true,members:false,payments:true'), JSON.stringify(tries.map(t => [t.code, t.err])));
    ok('...a new code is named; a reason with no code, or a code that is not a plain word, is "(no code)"',
       /brandNewReason 1\.$/m.test(tries[0].err) && /\(no code\) 1\.$/m.test(tries[1].err) && /\(no code\) 1\.$/m.test(tries[2].err)
       && tries.every(t => !t.all.includes(TAG) && !/new rule|insert failed/.test(t.all)), tries.map(t => t.err).join('\n'));
    hook = c => c.kind === 'payments' ? { status: 200, body: { ok: true } } : null;
    const odd = await since(() => cli(['run-all', U]));
    hook = null;
    ok('an answer that is not an import result is a failed batch, never "0 rows, all fine"',
       odd.code === 1 && /^Rule: failed-batch: a batch failed at row 2 \(the answer was not an import result\)\.$/m.test(odd.err)
       && odd.calls.filter(c => c.kind === 'payments').every(c => c.dry === true), odd.all);
    hook = c => c.kind === 'visits' && c.dry === false ? { status: 500, body: { error: 'the database went away' } } : null;
    const half = await since(() => cli(['run-all', U]));
    hook = null;
    ok('a batch that fails while a file is being saved stops the run there, and says the step can be run again',
       half.code === 1 && /^STOPPED at step 3 of 3: rezerv-visits-2025\.csv \(visits\)$/m.test(half.err)
       && /^Rule: failed-batch \(while saving\): a batch failed at row 2 \(HTTP 500\)\.$/m.test(half.err)
       && half.err.includes(`run-all '${U}' --from-step 3 --base ${FRONT}`) && !/database went away/.test(half.all)
       && half.calls.map(c => `${c.kind}:${c.dry}`).join() === 'members:true,members:false,payments:true,payments:false,visits:true,visits:false', half.all);
    const mend = await cli(['run-all', U, '--from-step', '3']);
    ok('...and running that step again saves it', mend.code === 0 && /^  Added: 1$/m.test(mend.out) && /^Done: 1 file saved, steps 3 to 3 of 3\.$/m.test(mend.out), mend.all);
    const D = dir('day-first');
    put(D, 'rezerv-payments-2026.csv', csv(PAYMENTS, [payment('15/03/2024 05:42:10', 43, cy, 'Drop-in', 'CARD', 1605, 105)]));
    const df = await since(() => cli(['run-all', D]));
    ok('a Rezerv payments file whose Paid On does not read month first stops the run after its check',
       df.code === 1 && /^Rule: paid-on-not-month-first: /m.test(df.err) && df.calls.map(c => `${c.kind}:${c.dry}`).join() === 'payments:true', df.all);
    const V = dir('void-inside');
    put(V, 'rezerv-payments-2026.csv', fs.readFileSync(voidFile));
    put(V, 'rezerv-visits-2025.csv', csv(VISITS, [visit('2025-03-08', '05:30 AM', 'Mysore 5.30am (1st batch)', `B${s8}42`, cy, 'Completed')]));
    const vr = await since(() => cli(['run-all', V]));
    ok('a voided list under a payments name is still refused, and stops the run with nothing sent',
       vr.code === 1 && /^STOPPED at step 1 of 2: rezerv-payments-2026\.csv \(payments\)$/m.test(vr.err) && /^Rule: refused \(void-file\)/m.test(vr.err)
       && vr.calls.length === 0, vr.all);
  }

  console.log('\n— batches of 1,000, and a batch that fails —');
  {
    const bulkId = i => `6${s8}${String(i).padStart(4, '0')}`;
    const f = put(A, 'bulk.csv', csv(STUDENTS, Array.from({ length: 1001 }, (_, i) => ({ CustomerName: `Bulk${i} Fake${TAG}`, 'RezervPass ID': bulkId(i) }))));
    const bulk = async () => (await one(`SELECT count(*)::int AS n FROM bkk_members WHERE rezerv_id LIKE $1`, [`6${s8}%`])).n;
    const c1 = await since(() => cli(['check', 'members', f]));
    ok('1,001 rows go in two batches, numbered by the file\'s rows as the page numbers them',
       c1.code === 0 && counts(c1) === '1001:1001:0:0:0:0' && c1.calls.map(c => `${c.body.firstRow}+${c.n}`).join() === '2+1000,1002+1'
       && /in 2 batches/.test(c1.out), c1.out);
    hook = c => c.dry === false && c.body.firstRow === 1002 ? { status: 500, body: { error: `boom at Secret Fake${TAG}` } } : null;
    const det = path.join(A, 'bulk-details.json');
    const w = await cli(['write', 'members', f, '--expect', '1001:1001:0:0:0', '--details', det]);
    hook = null;
    ok('a batch that fails stops the run at its row; the rows before it are saved', w.code === 1
       && /^  Stopped at row 1002 \(HTTP 500\)\. Rows before it are saved\. Fix it and run again: nothing is added twice\.$/m.test(w.out)
       && /Not every row was saved/.test(w.err) && (await bulk()) === 1000, w.all);
    ok('...what the server said is in the details file only',
       !/boom/.test(w.all) && JSON.parse(fs.readFileSync(det, 'utf8')).saved.stopped.error.includes('boom'), w.all);
    const c2 = await cli(['check', 'members', f]);
    ok('...and running again adds nothing twice: 1,000 already there, 1 to add', c2.code === 0 && counts(c2) === '1001:1:1000:0:0:0', c2.out);
    hook = () => 'hang';
    const slow = await cli(['check', 'members', studentsFile], { env: { REZERV_IMPORT_TIMEOUT_MS: '400' } });
    hook = null;
    ok('a batch with no answer in time stops the run', slow.code === 1 && /Stopped at row 2 \(no answer in 400 ms\)\. Nothing was saved\./.test(slow.out), slow.all);
  }

  console.log('\n— the admin key —');
  {
    const none = await since(() => cli(['check', 'members', studentsFile], { key: false }));
    ok('without the key: the plain message, and exit 4', none.code === 4
       && none.err === 'Not authorised. Run this where the admin key is added by the network.\n' && none.calls[0].key === null, none.all);
    const noneW = await since(() => cli(['write', 'members', studentsFile, '--expect', '3:0:3:0:0'], { key: false }));
    const noneAll = await since(() => cli(['run-all', R], { key: false }));
    ok('...for write and run-all too, with nothing sent to save', noneW.code === 4 && noneAll.code === 4
       && [...noneW.calls, ...noneAll.calls].every(c => c.dry === true) && noneAll.calls.length === 1
       && /Not authorised\. Run this where the admin key is added by the network\./.test(noneW.err + noneAll.err), noneW.all + noneAll.all);
    addKey = true;
    const net = await since(() => cli(['check', 'members', studentsFile], { key: false }));
    addKey = false;
    ok('where the network adds the key, the tool sends none and the import works', net.code === 0 && counts(net) === '3:0:3:0:0:0'
       && net.calls[0].key === null, net.all);
  }

  console.log('\n— https goes through the proxy that holds the key —');
  {
    let certs = null;
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(TMP, 'key.pem'), '-out', path.join(TMP, 'cert.pem'),
        '-days', '2', '-subj', '/CN=importer.test', '-addext', 'subjectAltName=DNS:importer.test'], { stdio: 'ignore' });
      certs = { key: fs.readFileSync(path.join(TMP, 'key.pem')), cert: fs.readFileSync(path.join(TMP, 'cert.pem')) };
    } catch { console.log('  (skipped: no openssl here to make a test certificate)'); }
    if (certs) {
      // The operator's network in small: a proxy that opens the TLS itself and adds the key.
      const seen = [], connects = [];
      let deny = false;
      const inside = https.createServer(certs, (req, res) => {
        seen.push({ host: req.headers.host, key: req.headers['x-bkk-key'] || null });
        relay(req, res, KEY).catch(() => res.destroy());
      });
      const proxy = http.createServer((req, res) => { res.writeHead(405); res.end(); });
      proxy.on('connect', (req, socket) => {
        connects.push(req.url);
        if (deny) return socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        inside.emit('connection', socket);
      });
      await new Promise(r => proxy.listen(0, '127.0.0.1', r));
      const via = `http://127.0.0.1:${proxy.address().port}`, cert = path.join(TMP, 'cert.pem');
      const env = { HTTPS_PROXY: via, https_proxy: via, NODE_EXTRA_CA_CERTS: cert, SSL_CERT_FILE: cert };
      const r = await since(() => cli(['check', 'members', studentsFile], { key: false, base: 'https://importer.test', env }));
      ok('an https server is reached through HTTPS_PROXY, where the key is added: the tool never holds it',
         r.code === 0 && counts(r) === '3:0:3:0:0:0' && connects.join() === 'importer.test:443' && seen.length === 1
         && seen[0].host === 'importer.test' && seen[0].key === null && r.calls.length === 1, r.all + JSON.stringify([connects, seen]));
      deny = true;
      const d = await cli(['check', 'members', studentsFile], { key: false, base: 'https://importer.test', env });
      ok('a proxy that refuses the server stops the run', d.code === 1 && /Stopped at row 2 \(the network proxy answered 403\)/.test(d.out), d.all);
      deny = false;
      const noTrust = await cli(['check', 'members', studentsFile], { key: false, base: 'https://importer.test',
        env: { HTTPS_PROXY: via, https_proxy: via, NODE_EXTRA_CA_CERTS: '', SSL_CERT_FILE: '' } });
      ok('...and a certificate nobody vouches for is never accepted', noTrust.code === 1
         && /Stopped at row 2 \(network error [A-Z0-9_]+\)/.test(noTrust.out) && seen.length === 1, noTrust.all);
      proxy.close(); inside.close();
    }
  }

  console.log('\n— the page is the only parser —');
  {
    const page = fs.readFileSync(PAGE, 'utf8');
    const doctored = (name, from, to) => {
      const f = path.join(TMP, `page-${name}.html`);
      const changed = page.replace(from, to);
      if (changed === page) throw new Error(`test: the page has no ${from}`);
      fs.writeFileSync(f, changed);
      return f;
    };
    const cases = [
      ['rowFor', doctored('rowfor', 'function rowFor(', 'function rowForRows(')],
      ['parseCsv', doctored('parsecsv', 'function parseCsv(', 'function readCsv(')],
      ['CI_KINDS', doctored('kinds', 'const CI_KINDS = {', 'const KINDS = {')],
      ['noWho', doctored('nowho', 'const noWho = ', 'const nobody = ')],
      ['ciBatches', doctored('batches', 'function ciBatches() {', 'function ciBatches() {\n    }\n  function ciBatches() {')],
      ['ciRun', doctored('cirun', 'dryRun: dry,', 'dryRun: !!dry,')],
    ];
    const runs = [];
    for (const [name, file] of cases) runs.push([name, await since(() => cli(['check', 'members', studentsFile], { env: { REZERV_IMPORT_PAGE: file } }))]);
    ok('a page that has lost, renamed or doubled one of its import pieces stops the tool, which names the piece, with nothing sent',
       runs.every(([name, r]) => r.code === 3 && r.err.includes(`"${name}"`) && r.calls.length === 0 && /Nothing was read or sent/.test(r.err)),
       JSON.stringify(runs.map(([name, r]) => [name, r.code, r.err])));
    const works = await cli(['check', 'members', studentsFile], { env: { REZERV_IMPORT_PAGE: PAGE } });
    ok('...and the page as it is in the repository is read', works.code === 0 && counts(works) === '3:0:3:0:0:0', works.all);
  }

  console.log('\n— the skip codes this tool knows are the server\'s —');
  {
    const { SKIP_CODES, KINDS } = require(SCRIPT);
    const api = fs.readFileSync(path.join(__dirname, '../bkk-api.js'), 'utf8');
    const table = api.slice(api.indexOf('const IMPORT_EN = {'), api.indexOf('const why = '));
    const server = [...table.matchAll(/^    (\w+): /gm)].map(m => m[1]);
    // Said next to a row that is kept: never a reason to skip one.
    const notes = ['payVoided', 'passStatus', 'passOff', 'badFreeze', 'freezeLater', 'notEmail', 'badJoined', 'badCheckIn', 'overCap', 'badVat',
      'emailTaken', 'keepsEmail', 'keepsRezervId', 'leftOver', 'keptHere', 'cameDoor', 'newStudent', 'pastBooked'];
    const known = new Set(KINDS.flatMap(k => Object.keys(SKIP_CODES[k])));
    ok('every code in the server\'s table is one this tool has a rule for, or a note that skips nothing',
       server.length > 40 && server.every(c => known.has(c) || notes.includes(c)), server.filter(c => !known.has(c) && !notes.includes(c)).join());
    ok('...and every code this tool has a rule for is in the server\'s table, with "ok" or "ask" and nothing else',
       [...known].every(c => server.includes(c) && !notes.includes(c))
       && KINDS.every(k => Object.values(SKIP_CODES[k]).every(v => v === 'ok' || v === 'ask')), [...known].filter(c => !server.includes(c)).join());
    ok('...the only skips run-all lets through: a pack never started, a payment that brought no money, a waiting-list place',
       KINDS.map(k => `${k}:${Object.keys(SKIP_CODES[k]).filter(c => SKIP_CODES[k][c] === 'ok')}`).join(' ')
       === 'members: passes:neverStarted payments:notMoney visits:waitlist');
  }

  console.log('\n— nothing private on screen —');
  const leaks = [TAG, KEY, s8, 'example.com', 'Fake', 'Made Up Road'].filter(x => ALL.toLowerCase().includes(x.toLowerCase()));
  ok('no name, email, phone, Rezerv id, address or key of this test is anywhere in what the tool printed', leaks.length === 0 && ALL.length > 5000,
     `leaked: ${leaks.join()} in ${ALL.length} characters`);

  console.log(`\n${PASS} passed, ${FAIL} failed`);
  fs.rmSync(TMP, { recursive: true, force: true });
  front.close(); srv.close(); await pool.end();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
