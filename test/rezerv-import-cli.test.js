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
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ── made-up people and Rezerv-shaped files ─────────────────────────────────
const s8 = stamp.slice(-8);
const rz = n => `7${s8}${String(n).padStart(4, '0')}`;        // RezervPass ID
const phone = n => `08${s8.slice(-6)}${String(n).padStart(2, '0')}`;
// Every first name used here, so the last test can look for each of them in what the tool printed.
const FIRSTS = new Set(['Void', 'Secret', 'Nadia', 'Runaway']);
const who = (n, first) => {
  FIRSTS.add(first);
  return { rz: rz(n), first, last: `Fake${TAG}`, name: `${first} Fake${TAG}`, email: `${first.toLowerCase()}.${TAG}@example.com`, phone: phone(n) };
};
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
const memberNo = n => `8${s8}${String(n).padStart(3, '0')}`;
const membership = (p, n, plan, status, start, end) => ({ First_Name: p.first, Last_Name: p.last, Mobile: '', Email: p.email,
  'RezervPass ID': p.rz, Membership: plan, 'Membership Number': memberNo(n), Status: status,
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
const MYSORE = 'Mysore 5.30am (1st batch)';

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
    if (canned && canned !== 'late') {
      res.writeHead(canned.status, { 'Content-Type': 'application/json', ...(canned.headers || {}) });
      return res.end(JSON.stringify(canned.body));
    }
    const headers = { 'Content-Type': 'application/json' };
    if (call.key || key) headers['x-bkk-key'] = call.key || key;
    const r = await fetch(API + req.url, { method: req.method, headers, body: raw });
    const text = await r.text();
    // 'late': the server does the work, and its answer never reaches the tool.
    if (canned === 'late') return;
    res.writeHead(r.status, { 'Content-Type': 'application/json' });
    res.end(text);
  };
  const front = http.createServer((req, res) => relay(req, res, addKey ? KEY : null).catch(() => res.destroy()));
  await new Promise(r => front.listen(0, '127.0.0.1', r));
  const FRONT = `http://127.0.0.1:${front.address().port}`;

  // The tool, as a person runs it. key: BKK_ADMIN_KEY in its environment (the
  // test's, or the one given), or none. child: is handed the running process.
  let ALL = '';
  const cli = (args, { key = true, env = {}, base = FRONT, child = null } = {}) => new Promise(resolve => {
    const e = { ...process.env, HTTPS_PROXY: 'http://127.0.0.1:9', https_proxy: 'http://127.0.0.1:9', NO_PROXY: '', no_proxy: '', ...env };
    if (key === true) e.BKK_ADMIN_KEY = KEY; else if (typeof key === 'string') e.BKK_ADMIN_KEY = key; else delete e.BKK_ADMIN_KEY;
    delete e.SHOP_ADMIN_KEY;
    const p = spawn(process.execPath, [SCRIPT, ...args, ...(base && args[0] !== 'plan' ? ['--base', base] : [])], { env: e });
    if (child) child(p);
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => { ALL += out + err; resolve({ code, out, err, all: out + err }); });
  });
  const since = async fn => { const at = calls.length; const r = await fn(); return { ...r, calls: calls.slice(at) }; };
  const num = (r, label) => { const m = r.out.match(new RegExp(`^  ${label}: (\\d+)`, 'm')); return m ? Number(m[1]) : null; };
  const counts = r => ['Rows', 'Added', 'Already there', 'Updated', 'New students', 'Skipped'].map(l => num(r, l)).join(':');
  // The --expect a check (or a stopped run-all) printed. NONE has the right shape and fits no check.
  const NONE = '0:0:0:0:0:0:000000000000';
  const expectIn = r => (r.all.match(/--expect "(\d+(?::\d+){5}:[0-9a-f]{12})"/) || [])[1] || NONE;
  const sent = list => list.map(c => `${c.kind}:${c.dry}`).join();

  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rezerv-cli-'));
  const dir = name => { const d = path.join(TMP, name); fs.mkdirSync(d, { recursive: true }); return d; };
  const put = (d, name, text) => { const f = path.join(d, name); fs.writeFileSync(f, text); return f; };
  const members = async ids => (await pool.query('SELECT rezerv_id, name, email, phone FROM bkk_members WHERE rezerv_id = ANY($1) ORDER BY rezerv_id', [ids])).rows;
  // Check, then write with what the check printed: how a person saves one file.
  const saveFile = async (kind, file, more = []) => cli(['write', kind, file, '--expect', expectIn(await cli(['check', kind, file, ...more])), ...more]);
  const STUDENTS_FILE = 'rezerv-students-2026-11-12.csv', PACKS_FILE = 'rezerv-passes-packages-2026-11-12.csv',
    MEMBERSHIPS_FILE = 'rezerv-passes-memberships-2026-11-12.csv';

  console.log('\n— plan: which files, in which order —');
  {
    const d = dir('plan');
    const wanted = [STUDENTS_FILE, MEMBERSHIPS_FILE, PACKS_FILE,
      'rezerv-payments-2024.csv', 'rezerv-payments-2025-jan-jun.csv', 'rezerv-payments-2025-jul-dec.csv', 'rezerv-payments-2026.csv',
      'rezerv-visits-2024.csv', 'rezerv-visits-2025.csv', 'rezerv-visits-2026.csv', 'rezerv-visits-upcoming-2026-11-12.csv'];
    const named = ['rezerv-payments-voided-2026.csv', 'rezerv-payments-refunded-2026.csv', 'rezerv-class-attendance-2026.csv',
      'rezerv-something-else.csv', 'rezerv-students-2026-11-12.xlsx'];
    // A downloads folder holds slips and forms named after students: counted, never named, never read.
    const quiet = ['students.csv', 'notes.txt', `passport-Nadia Fake${TAG}.pdf`, `rezerv-nadia.${TAG}@example.com.csv`,
      `rezerv-students-nadia.${TAG}@example.com.csv`];
    for (const n of [...wanted].reverse().concat(named, quiet)) put(d, n, '');
    fs.mkdirSync(path.join(d, 'rezerv-details'));
    const r = await since(() => cli(['plan', d]));
    const listed = [...r.out.matchAll(/^\s+\d+\. (\w+)\s+(\S+)$/gm)].map(m => `${m[1]} ${m[2]}`);
    const kinds = ['members', 'passes', 'passes', 'payments', 'payments', 'payments', 'payments', 'visits', 'visits', 'visits', 'visits'];
    ok('plan lists the 11 files in import order: students, memberships, packages, payments by year and month, visits by year, upcoming last',
       r.code === 0 && listed.join() === wanted.map((n, i) => `${kinds[i]} ${n}`).join(), r.all);
    const ignored = [...r.out.matchAll(/^\s+- (rezerv-\S+): (.*)$/gm)].map(m => m[1]).sort();
    ok('...and names what it ignores under a rezerv- name: voided, refunded, class-attendance, not a name it knows',
       ignored.join() === [...named].sort().join() && /voided-2026\.csv: its name says voided/.test(r.out)
       && /refunded-2026\.csv: its name says refunded/.test(r.out) && /attendance-2026\.csv: its name says class-attendance/.test(r.out)
       && /something-else\.csv: its name is not one this tool knows/.test(r.out), r.out);
    ok('...a file that is no rezerv- file, or whose name holds more than plain characters, is counted and never named or read',
       /^Ignored \(10\):$/m.test(r.out) && /^  - 2 files starting with rezerv-, not named here: /m.test(r.out)
       && /^  - 3 other files: the name does not start with rezerv-$/m.test(r.out)
       && ['Nadia', 'passport', 'notes.txt', 'example', TAG].every(x => !r.all.includes(x)), r.out);
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
  const rowsSent = chk.calls[0].body.rows;
  ok('a quoted cell with a comma and a line break is one cell of one row', rowsSent[2].name === `Fake${TAG}, Quoty\nJunior` && rowsSent[2].rezervId === quoty.rz,
     JSON.stringify(rowsSent[2]));
  ok('...and as nobody sees the page\'s preview in run-all, a cell with a line break would stop it',
     /^For run-all: it would stop here \(cells-to-look-at\): 1 cell holds a line break or more than 300 characters/m.test(chk.out), chk.out);
  ok('only the page\'s fields are sent, the phone joined to its country code as the page does',
     rowsSent.every(o => Object.keys(o).every(k => ['rezervId', 'name', 'email', 'phone', 'joinedOn'].includes(k)))
     && rowsSent[0].phone === `+66 ${ada.phone.slice(1)}` && rowsSent[0].joinedOn === '15/03/24 07:12', JSON.stringify(rowsSent[0]));
  ok('with BKK_ADMIN_KEY set the key goes in x-bkk-key', chk.calls[0].key === KEY);
  const tok = expectIn(chk);
  ok('check prints the command that would save: the six counts, then a mark of everything else the check stood on',
     /^3:3:0:0:0:0:[0-9a-f]{12}$/.test(tok) && chk.out.includes(`write members '${studentsFile}' --expect "${tok}" --base ${FRONT}`), chk.out);

  console.log('\n— write: only when the check is the one a person read —');
  const wrongTok = tok.replace(/^3:3:0:/, '3:2:1:');
  const wrong = await since(() => cli(['write', 'members', studentsFile, '--expect', wrongTok]));
  ok('write with the wrong --expect saves nothing and says so', wrong.code === 1 && wrong.err.includes(`The check gives "${tok}", not the "${wrongTok}" in --expect`)
     && /Nothing was saved/.test(wrong.err) && (await members(ids3)).length === 0, wrong.all);
  ok('...it sent the check only', wrong.calls.length === 1 && wrong.calls[0].dry === true, JSON.stringify(wrong.calls.map(c => c.dry)));
  {
    // The same path and the same counts, but another file: one student swapped for somebody else.
    const swapped = who(4, 'Swapped');
    const f = put(A, 'swap.csv', csv(STUDENTS, [student(ada), student(ben)]));
    const first = await cli(['check', 'members', f]);
    put(A, 'swap.csv', csv(STUDENTS, [student(ada), student(swapped)]));
    const r = await since(() => cli(['write', 'members', f, '--expect', expectIn(first)]));
    ok('a file changed after its check is refused, even when its counts are the same', counts(first) === '2:2:0:0:0:0' && counts(r) === '2:2:0:0:0:0'
       && r.code === 1 && /Nothing was saved/.test(r.err) && r.calls.every(c => c.dry === true) && (await members([ada.rz, ben.rz, swapped.rz])).length === 0, r.all);
  }
  const right = await since(() => cli(['write', 'members', studentsFile, '--expect', tok]));
  const savedM = await members(ids3);
  ok('write with the right --expect checks, then saves', right.code === 0 && right.calls.map(c => c.dry).join() === 'true,false'
     && savedM.length === 3 && /^Saved:$/m.test(right.out), right.all);
  ok('...the quoted name, the email and the phone are on the profile',
     savedM[2].name === `Fake${TAG}, Quoty Junior` && savedM[0].email === ada.email && savedM[0].phone === `+66 ${ada.phone.slice(1)}`, JSON.stringify(savedM));
  const again = await cli(['check', 'members', studentsFile]);
  ok('a second run reports every row as already there', again.code === 0 && counts(again) === '3:0:3:0:0:0', again.all);
  const stale = await since(() => cli(['write', 'members', studentsFile, '--expect', tok]));
  ok('...and an --expect from before the save no longer fits: nothing is sent to save',
     stale.code === 1 && stale.calls.every(c => c.dry === true) && (await members(ids3)).length === 3, stale.all);
  const usage = [await since(() => cli(['write', 'members', studentsFile])), await since(() => cli(['check', 'cats', studentsFile])),
    await since(() => cli(['check', 'members', studentsFile], { base: 'http://files.example.com' })),
    await since(() => cli(['check', 'members', studentsFile, '--save'])),
    await since(() => cli(['write', 'members', studentsFile, '--expect', '3:3:0:0:0'])),
    await since(() => cli(['run-all', A, '--save=yes']))];
  ok('wrong use (no --expect, an unknown kind, http to another machine, a flag the command does not take, five bare counts as --expect, '
     + 'a value for --save) exits 2 and sends nothing',
     usage.every(u => u.code === 2 && u.calls.length === 0), JSON.stringify(usage.map(u => [u.code, u.calls.length])));

  console.log('\n— only our own servers —');
  {
    const away = [];
    for (const b of ['https://aybkk.com', 'https://aybkk.net.example.com', 'https://cn.aybkk.net', 'https://aybkk.net:8443',
      'https://other-host.example', 'https://203.0.113.5']) away.push(await since(() => cli(['check', 'members', studentsFile], { base: b })));
    ok('--base takes aybkk.net, my.aybkk.com or this machine: any other https address exits 2 with nothing read or sent',
       away.every(r => r.code === 2 && r.calls.length === 0 && r.out === ''
         && /^--base must be https:\/\/aybkk\.net or https:\/\/my\.aybkk\.com, or a test server on this machine$/m.test(r.err)),
       JSON.stringify(away.map(r => [r.code, r.calls.length, r.out])));
  }

  console.log('\n— files as Excel saves them —');
  {
    const uni = who(5, 'Unicode'), thai = { ...who(6, 'Siam'), name: `ทดสอบ Fake${TAG}` };
    const u16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(csv(STUDENTS, [student(uni)], '\t').slice(1), 'utf16le')]);
    const cp874 = Buffer.from([...csv(STUDENTS, [student(thai)]).slice(1)].map(ch => {
      const c = ch.charCodeAt(0);
      return c >= 0x0E01 && c <= 0x0E5B ? c - 0x0E00 + 0xA0 : c;
    }));
    const r16 = await since(() => cli(['check', 'members', put(A, 'utf16.csv', u16)]));
    ok('a UTF-16 file with tabs is read', r16.code === 0 && counts(r16) === '1:1:0:0:0:0' && r16.calls[0].body.rows[0].name === uni.name, r16.all);
    const r874 = await since(() => cli(['check', 'members', put(A, 'thai.csv', cp874)]));
    ok('a file in the Thai Windows code page is read, its Thai name whole',
       r874.code === 0 && counts(r874) === '1:1:0:0:0:0' && r874.calls[0].body.rows[0].name === thai.name
       && /^For run-all: clean\.$/m.test(r874.out), r874.all);
    // A Western Excel "CSV": the byte 0xFC is no letter in UTF-8 and none in the Thai code page.
    const western = Buffer.from(csv(STUDENTS, [student({ ...who(7, 'Western'), name: `M\u00FCller Fake${TAG}` })]).slice(1), 'latin1');
    const rw = await since(() => cli(['check', 'members', put(A, 'western.csv', western)]));
    ok('a byte with no letter in the Thai code page is sent as the browser sends it (U+FFFD), and run-all would stop on such a file',
       rw.code === 0 && rw.calls[0].body.rows[0].name === `M\uFFFDller Fake${TAG}`
       && /^For run-all: it would stop here \(unreadable-characters\): /m.test(rw.out), rw.all + JSON.stringify(rw.calls[0].body.rows[0].name));
    const xl = await since(() => cli(['check', 'members', put(A, 'book.csv', Buffer.from([0x50, 0x4B, 3, 4, 20, 0]))]));
    ok('an Excel workbook is refused before anything is sent', xl.code === 1 && /Refused \(excel-file\)/.test(xl.err) && xl.calls.length === 0, xl.all);
  }

  console.log('\n— payments: Paid On is month first —');
  const payFile = put(A, 'pay.csv', csv(PAYMENTS, [
    payment('03/15/2024 05:42:10', 1, ada, '1 Year (13 months)', 'CARD', 52000, 3401.87),
    payment('11/02/2025 06:10:00', 2, ben, MYSORE, 'PROMPTPAY', 1685.25, 110.25),
    payment('10/05/2026 07:00:00', 3, ada, '1 Month unlimited', 'CARD', 9600, 628.04, 'Voided'),
  ]));
  const payDay = async n => (await one(`SELECT to_char(o.verified_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') AS d FROM bkk_orders o
    WHERE o.source='rezerv' AND o.source_ref=$1`, [trx(n)])).d;
  const payChk = await since(() => cli(['check', 'payments', payFile]));
  ok('a payments file is read month first, and says so', payChk.code === 0 && /^  Dates read month first: date$/m.test(payChk.out)
     && payChk.calls[0].body.rows[0].date === '15/03/2024 05:42:10' && payChk.calls[0].body.rows[1].date === '02/11/2025 06:10:00', payChk.all);
  ok('...a voided payment is skipped under its code, which is an expected one', counts(payChk) === '3:2:0:0:0:1'
     && /^    notMoney: 1 \(expected: nothing to keep\)$/m.test(payChk.out) && /^For run-all: clean\.$/m.test(payChk.out), payChk.out);
  const payWr = await cli(['write', 'payments', payFile, '--expect', expectIn(payChk)]);
  ok('...saved on the right days: 15 March 2024, and 2 November 2025, not 11 February',
     payWr.code === 0 && (await payDay(1)) === '2024-03-15' && (await payDay(2)) === '2025-11-02' && (await payDay(3)) === undefined, payWr.all);
  const dayFirst = await cli(['check', 'payments', put(A, 'pay-dayfirst.csv', csv(PAYMENTS, [
    payment('15/03/2024 05:42:10', 4, ada, 'Drop-in', 'CARD', 1605, 105)]))]);
  ok('a Rezerv payments file whose dates do not read month first would stop run-all', dayFirst.code === 0
     && /^  Dates read month first: none$/m.test(dayFirst.out) && /^For run-all: it would stop here \(paid-on-not-month-first\)/m.test(dayFirst.out), dayFirst.out);
  const bothWays = await since(() => cli(['check', 'payments', put(A, 'pay-both-ways.csv', csv(PAYMENTS.replace('Issued On,', ''), [
    payment('03/04/2024 09:00:00', 5, ada, 'Drop-in', 'CARD', 1605, 105)]))]));
  ok('a payments file with no "Issued On" and no number over 12 in its dates is sent day first, and would stop run-all: nobody sees which way it was',
     bothWays.code === 0 && bothWays.calls[0].body.rows[0].date === '03/04/2024 09:00:00' && /^  Dates read month first: none$/m.test(bothWays.out)
     && /^For run-all: it would stop here \(dates-read-both-ways\): no date in date has a number over 12/m.test(bothWays.out), bothWays.out);

  console.log('\n— the page\'s own refusals —');
  const voidFile = put(A, 'old-transactions.csv', csv(VOIDED, [{ 'Date voided on': '5 jan 2024 10:00am', 'Voided transaction ID': 'PISV_1',
    'Original transaction ID': 'PIS_1', 'Customer name': `Void Fake${TAG}`, 'Net amount': '30000.00', 'Linked item': '6 months Unlimited',
    'Payment method': 'CARD', 'Reason for void': 'made up' }]));
  const refused = [await since(() => cli(['check', 'payments', voidFile])), await since(() => cli(['check', 'members', voidFile])),
    await since(() => cli(['write', 'payments', voidFile, '--expect', NONE]))];
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
  const dflt = [await since(() => cli(['check', 'payments', voidFile], { base: null, key: false })),
    await since(() => cli(['check', 'payments', voidFile], { base: 'https://my.aybkk.com', key: false }))];
  ok('with no --base the server is https://aybkk.net, and https://my.aybkk.com is taken too (seen on a refused file: nothing is sent)',
     dflt.every(r => r.code === 1 && r.calls.length === 0) && /^Server: https:\/\/aybkk\.net$/m.test(dflt[0].out)
     && /^Server: https:\/\/my\.aybkk\.com$/m.test(dflt[1].out), dflt[0].all + dflt[1].all);

  console.log('\n— counts on screen, names in the details file —');
  {
    const twinA = { ...who(8, 'Twin') }, twinB = { ...who(9, 'Twin'), email: `twin.two.${TAG}@example.com` };
    const newbie = who(10, 'Newbie');
    await saveFile('members', put(A, 'twins.csv', csv(STUDENTS, [student(twinA, { Email: '' }), student(twinB)])));
    // No customer id and no email: the name alone fits two students. And a student nobody has seen before.
    const f = put(A, 'pay-twins.csv', csv(PAYMENTS, [
      { ...payment('03/20/2024 09:00:00', 10, twinA, 'Drop-in', 'CARD', 1605, 105), 'RezervPass ID': '0', Email: '' },
      payment('03/21/2024 09:00:00', 11, newbie, 'Drop-in', 'CARD', 1605, 105)]));
    const det = path.join(A, 'pay-twins.details.json');
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
    ok('...in a file only its owner can read, even where a wider details file stood; only its path is printed',
       (fs.statSync(det).mode & 0o777) === 0o600 && r.out.includes(`Details: ${det}`) && !r.all.includes(TAG), r.all);
    const nowhere = await since(() => cli(['check', 'payments', f, '--details', path.join(A, 'no-such-folder', 'x.details.json')]));
    ok('a details file that cannot be written is found out before anything is sent', nowhere.code === 2 && nowhere.calls.length === 0
       && /Cannot write the details file/.test(nowhere.err), nowhere.all);
    const notes = put(A, 'precious-notes.txt', 'keep me'), export2 = path.join(A, 'rezerv-payments-2024.csv');
    const over = [await since(() => cli(['check', 'payments', f, '--details', notes])),
      await since(() => cli(['check', 'payments', f, '--details', export2]))];
    ok('--details never replaces a file that is not a details file, and never takes the name of an export',
       over.every(o => o.code === 2 && o.calls.length === 0) && fs.readFileSync(notes, 'utf8') === 'keep me' && !fs.existsSync(export2)
       && /does not end in \.details\.json, so it is not replaced/.test(over[0].err) && /that name is an export/.test(over[1].err), over[0].all + over[1].all);
  }

  console.log('\n— visits: past bookings —');
  {
    const ref = `B${s8}90`;
    const f = put(A, 'visits-past.csv', csv(VISITS, [visit('2025-03-06', '05:30 AM', MYSORE, ref, ada, 'Booked')]));
    const off = await since(() => cli(['check', 'visits', f]));
    const on = await since(() => cli(['check', 'visits', f, '--past-attended']));
    const mem = await since(() => cli(['check', 'members', studentsFile, '--past-attended']));
    ok('a past visit still marked booked is counted, and stays booked unless --past-attended is given',
       off.code === 0 && /Past visits still marked booked, not attended: 1\./.test(off.out) && !('pastBookedAttended' in off.calls[0].body)
       && on.code === 0 && on.calls[0].body.pastBookedAttended === true && !/Past visits still marked booked/.test(on.out)
       && on.out.includes('--past-attended') && /Past bookings counted as attended: yes/.test(on.out), off.out + on.out);
    ok('...and the flag does nothing for another kind', mem.code === 0 && !('pastBookedAttended' in mem.calls[0].body));
    const sneak = await since(() => cli(['write', 'visits', f, '--expect', expectIn(off), '--past-attended']));
    ok('--past-attended added at write, after a check without it, is refused: nothing is sent to save',
       expectIn(off) !== expectIn(on) && sneak.code === 1 && /Nothing was saved/.test(sneak.err) && sneak.calls.every(c => c.dry === true)
       && (await one('SELECT count(*)::int AS n FROM bkk_bookings WHERE source_ref=$1', [ref])).n === 0, sneak.all);
  }

  // ── run-all ───────────────────────────────────────────────────────────────
  console.log('\n— run-all: a look first, then a whole folder in order —');
  const cy = who(11, 'Cy'), dee = who(12, 'Dee'), eli = who(13, 'Eli');
  const slots = (await pool.query(`SELECT id, weekday, title FROM bkk_class_slots WHERE code LIKE 'my530_%' AND active ORDER BY weekday`)).rows;
  // A class day still to come, with a day number over 12 so its date reads one way only.
  let fd = addD(T0, 40);
  while (!slots.some(s => s.weekday === new Date(fd + 'T12:00:00Z').getUTCDay()) || moonDaysBetween(fd, fd).size || Number(fd.slice(8)) <= 12) fd = addD(fd, 1);
  const fdSlot = slots.find(s => s.weekday === new Date(fd + 'T12:00:00Z').getUTCDay());
  const R = dir('all');
  put(R, 'rezerv-visits-upcoming-2026-11-12.csv', csv(VISITS, [visit(fd, '05:30 AM', MYSORE, `B${s8}04`, cy, 'Booked')]));
  put(R, 'rezerv-visits-2025.csv', csv(VISITS, [
    visit('2025-03-18', '05:30 AM', MYSORE, `B${s8}01`, cy, 'Completed'),
    visit('2025-03-05', '05:30 AM', MYSORE, `B${s8}02`, dee, 'No Show'),
    visit('2025-03-06', '05:30 AM', MYSORE, `B${s8}03`, eli, 'Waitlist Expired')]));
  put(R, 'rezerv-payments-2026.csv', csv(PAYMENTS, [
    payment('10/20/2026 08:00:00', 23, eli, '10 classes/3mo (14000thb + online transaction fee 5%)', 'CARD', 15729, 1029),
    payment('10/21/2026 08:00:00', 24, eli, 'Drop-in', 'CARD', 1605, 105, 'Voided')]));
  put(R, 'rezerv-payments-2025-jul-dec.csv', csv(PAYMENTS, [payment('11/02/2025 06:10:00', 22, dee, '3 months Unlimited', 'PROMPTPAY', 23000, 1504.67)]));
  put(R, 'rezerv-payments-2025-jan-jun.csv', csv(PAYMENTS, [payment('03/15/2025 05:42:10', 21, cy, '1 Month unlimited', 'CARD', 10580, 692.15)]));
  put(R, PACKS_FILE, csv(PACKAGES, [
    pack(eli, 1, '10 classes/3mo (14000thb + online transaction fee 5%)', 'Active', addD(T0, -10), addD(T0, 80), 10, 7),
    pack(eli, 2, 'Drop-in', 'Expired', '--', '--', 1, 0)]));
  put(R, MEMBERSHIPS_FILE, csv(MEMBERSHIPS, [
    membership(cy, 1, '1 Month unlimited (9600thb + online transaction fee 5%)', 'Active', addD(T0, -5), addD(T0, 24)),
    membership(dee, 2, '3 months Unlimited', 'Expired', '2025-01-01', '2025-03-31')]));
  put(R, STUDENTS_FILE, csv(STUDENTS, [student(cy), student(dee), student(eli)]));
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
  const look = await since(() => cli(['run-all', R]));
  ok('run-all without --save looks at every file and saves nothing: no request to save is made',
     look.code === 0 && look.calls.length === 8 && look.calls.every(c => c.dry === true) && Object.keys((await state()).by).length === 0
     && /^Looking only: every file is checked and nothing is saved\./m.test(look.out) && /^Looked at steps 1 to 8 of 8\. Nothing was saved\.$/m.test(look.out)
     && (look.out.match(/^  Clean: with --save this file would be saved\.$/gm) || []).length === 8, look.all);
  ok('...and it ends with the command that saves', look.out.trimEnd().endsWith(`run-all '${R}' --save --base ${FRONT}`), look.out.slice(-300));
  const all1 = await since(() => cli(['run-all', R, '--save', '--details-dir', path.join(R, 'details')]));
  ok('run-all --save saves the 8 files of a made-up folder and ends clean', all1.code === 0 && /^Done: 8 files saved, steps 1 to 8 of 8\.$/m.test(all1.out), all1.all);
  ok('...each file checked, then saved, in the order of the plan',
     all1.calls.map(c => `${c.kind}:${c.dry ? 'check' : 'save'}:${c.n}`).join(' ')
     === 'members:check:3 members:save:3 passes:check:2 passes:save:2 passes:check:2 passes:save:2 payments:check:1 payments:save:1 '
       + 'payments:check:1 payments:save:1 payments:check:2 payments:save:2 visits:check:3 visits:save:3 visits:check:1 visits:save:1',
     JSON.stringify(all1.calls.map(c => [c.kind, c.dry, c.n])));
  const payOrder = all1.calls.filter(c => c.kind === 'payments' && c.dry).map(c => c.body.rows[0].rezervId).join();
  const passOrder = all1.calls.filter(c => c.kind === 'passes' && c.dry).map(c => c.body.rows[0].plan.slice(0, 7)).join();
  ok('...memberships before packages, payments by year and by month', payOrder === [trx(21), trx(22), trx(23)].join()
     && passOrder === '1 Month,10 clas', payOrder + ' ' + passOrder);
  ok('...the voided list and the class-attendance list are named as ignored, the notes are counted, and none is read',
     /rezerv-payments-voided-2026\.csv: its name says voided/.test(all1.out) && /rezerv-class-attendance-2026\.csv: its name says class-attendance/.test(all1.out)
     && /^  - 1 other file: the name does not start with rezerv-$/m.test(all1.out) && !all1.out.includes('notes.txt')
     && !/^File: (rezerv-payments-voided|rezerv-class|notes)/m.test(all1.out), all1.out);
  ok('...skips under an expected code (a pack never started, a voided payment, a waiting-list place) do not stop it',
     /neverStarted: 1 \(expected/.test(all1.out) && /notMoney: 1 \(expected/.test(all1.out) && /waitlist: 1 \(expected/.test(all1.out), all1.out);
  const st1 = await state();
  ok('...students, passes, payments, visits and the booking still to come are all on aybkk\'s side',
     Object.keys(st1.by).length === 3
     && st1.passes.map(p => `${p.code}:${p.status}:${p.credits_used}`).join() === 'pack10:active:3,unlim1:active:0,unlim3:active:0'
     && st1.orders.map(o => `${o.source_ref}:${o.status}`).join() === [21, 22, 23].map(n => `${trx(n)}:paid`).join()
     && st1.visits.map(v => `${v.status}:${v.came}:${v.d}`).join() === `booked:true:2025-03-18,noshow:false:2025-03-05,booked:false:${fd}`
     && st1.visits[2].slot_id === fdSlot.id && st1.visits[2].member_id === st1.by[cy.rz], JSON.stringify(st1));
  const detFiles = fs.readdirSync(path.join(R, 'details')).sort();
  const packDet = JSON.parse(fs.readFileSync(path.join(R, 'details', `${PACKS_FILE}.details.json`), 'utf8'));
  ok('--details-dir gets one private file per file read, the check and the save in each',
     detFiles.length === 8 && detFiles.every(f => (fs.statSync(path.join(R, 'details', f)).mode & 0o777) === 0o600)
     && packDet.check.skipped[0].code === 'neverStarted' && packDet.check.skipped[0].name === eli.name && packDet.check.skipped[0].email === eli.email
     && packDet.saved.added === 1 && packDet.saved.skipped.length === 1, JSON.stringify([detFiles, packDet]));
  const all2 = await cli(['run-all', R, '--save']);
  const st2 = await state();
  ok('running the folder again adds nothing twice', all2.code === 0 && !/^  Added: [1-9]/m.test(all2.out) && !/^  New students: [1-9]/m.test(all2.out)
     && JSON.stringify(st2) === JSON.stringify(st1), all2.out);

  console.log('\n— run-all: past classes still marked booked —');
  {
    const P = dir('past'), ref = `B${s8}51`;
    put(P, STUDENTS_FILE, csv(STUDENTS, [student(cy)]));
    const vf = put(P, 'rezerv-visits-2025.csv', csv(VISITS, [visit('2025-03-20', '05:30 AM', MYSORE, ref, cy, 'Booked'),
      visit('2025-03-21', '05:30 AM', MYSORE, `B${s8}52`, cy, 'Completed')]));
    const came = async () => (await one('SELECT checked_in_at IS NOT NULL AS came FROM bkk_bookings WHERE source_ref=$1', [ref])).came;
    const lookP = [await since(() => cli(['run-all', P])), await since(() => cli(['run-all', P, '--past-attended']))];
    ok('a look counts them and says to ask the owner once, before saving; with --past-attended the save command it prints carries the flag',
       lookP.every(r => r.code === 0 && r.calls.every(c => c.dry === true))
       && /^Past classes Rezerv still shows as booked: 1\. Ask the owner once, before saving, whether they count as attended\.$/m.test(lookP[0].out)
       && lookP[0].calls.every(c => !('pastBookedAttended' in c.body)) && lookP[0].out.trimEnd().endsWith(`run-all '${P}' --save --base ${FRONT}`)
       && lookP[1].out.trimEnd().endsWith(`run-all '${P}' --save --past-attended --base ${FRONT}`), lookP[0].out + lookP[1].out);
    const no = await since(() => cli(['run-all', P, '--save']));
    ok('run-all --save without the flag keeps them booked, and ends with the file and the command that would count them later',
       no.code === 0 && no.calls.every(c => !('pastBookedAttended' in c.body)) && (await came()) === false
       && /^Past classes still marked booked, saved as booked: 1 in rezerv-visits-2025\.csv\./m.test(no.out)
       && no.out.includes(`check visits '${vf}' --base ${FRONT} --past-attended`), no.all);
    const yes = await since(() => cli(['run-all', P, '--save', '--past-attended']));
    ok('run-all --save --past-attended sends the choice with every visits batch and with no other, and the class is now attended',
       yes.code === 0 && yes.calls.filter(c => c.kind === 'visits').length === 2 && yes.calls.filter(c => c.kind === 'visits').every(c => c.body.pastBookedAttended === true)
       && yes.calls.filter(c => c.kind !== 'visits').every(c => !('pastBookedAttended' in c.body)) && (await came()) === true
       && /^  Past bookings counted as attended: yes$/m.test(yes.out) && !/Past classes still marked booked/.test(yes.out), yes.all);
  }

  console.log('\n— run-all: stopping for a person —');
  {
    const S = dir('stop');
    put(S, STUDENTS_FILE, csv(STUDENTS, [student(cy)]));
    const packs = put(S, PACKS_FILE, csv(PACKAGES, [
      pack(cy, 11, 'Full workshop with Guest Teachers', 'Expired', '2025-03-01', '2025-03-28', 7, 0),
      pack(cy, 12, 'Drop-in (1500thb + online transaction fee 5%)', 'Expired', '2025-05-06', '2025-05-06', 1, 0)]));
    put(S, 'rezerv-payments-2026.csv', csv(PAYMENTS, [payment('10/22/2026 08:00:00', 31, cy, 'Drop-in', 'CARD', 1605, 105)]));
    const paid = async () => (await one(`SELECT count(*)::int AS n FROM bkk_orders WHERE source='rezerv' AND source_ref=$1`, [trx(31)])).n;
    const passN = async n => (await one(`SELECT count(*)::int AS n FROM bkk_passes WHERE source='rezerv' AND source_ref=$1`, [trx(900 + n)])).n;
    const lookS = await since(() => cli(['run-all', S]));
    ok('a look goes through every file and says which one would stop a real run',
       lookS.code === 1 && lookS.calls.length === 3 && lookS.calls.every(c => c.dry === true)
       && /^  Would stop here \(skip-code-needs-a-person\): .*badPlan 1\.$/m.test(lookS.out)
       && lookS.out.includes(`With --save the run would stop at:\n  step 2: ${PACKS_FILE} (skip-code-needs-a-person)\n`), lookS.all);
    const r = await since(() => cli(['run-all', S, '--save']));
    ok('a skip code that needs a person stops the run: which file, which rule, the counts',
       r.code === 1 && new RegExp(`^STOPPED at step 2 of 3: ${PACKS_FILE.replace(/\./g, '\\.')} \\(passes\\)$`, 'm').test(r.err)
       && /^Rule: skip-code-needs-a-person: .*badPlan 1\.$/m.test(r.err)
       && /^Counts: rows 2, added 1, already there 0, updated 0, new students 0, skipped 1\.$/m.test(r.err), r.all);
    ok('...nothing of that file is saved and no later file is touched',
       sent(r.calls) === 'members:true,members:false,passes:true' && (await passN(12)) === 0 && (await paid()) === 0
       && /Nothing from this file was saved, and no later file was touched/.test(r.err), sent(r.calls));
    const exp = (r.err.match(/write passes '([^']+)' --expect "([0-9a-f:]+)"/) || []);
    const next = `run-all '${S}' --save --from-step '3:rezerv-payments-2026.csv' --base ${FRONT}`;
    ok('...and it prints how a person accepts the file and carries on, the next step named with its file',
       exp[1] === packs && /^2:1:0:0:1:0:[0-9a-f]{12}$/.test(exp[2] || '') && r.err.includes(next), r.err);
    const acc = await cli(['write', 'passes', packs, '--expect', exp[2] || NONE]);
    const wrongStep = [await since(() => cli(['run-all', S, '--save', '--from-step', '3'])),
      await since(() => cli(['run-all', S, '--save', '--from-step', '4:rezerv-payments-2026.csv'])),
      await since(() => cli(['run-all', S, '--save', '--from-step', '2:rezerv-payments-2026.csv']))];
    ok('--from-step without its file, past the last step, or naming another file than the one at that step is wrong use: nothing is sent',
       wrongStep.every(w => w.code === 2 && w.calls.length === 0) && /step 2 of this folder is rezerv-passes-packages/.test(wrongStep[2].err),
       JSON.stringify(wrongStep.map(w => [w.code, w.calls.length, w.err.split('\n')[0]])));
    const rest = await since(() => cli(['run-all', S, '--save', '--from-step', '3:rezerv-payments-2026.csv']));
    ok('--from-step carries on after it: the earlier steps are left alone', acc.code === 0 && (await passN(12)) === 1 && rest.code === 0
       && sent(rest.calls) === 'payments:true,payments:false' && (await paid()) === 1
       && /^Done: 1 file saved, steps 3 to 3 of 3\.$/m.test(rest.out), rest.all);
    // A file added to the folder moves the steps: the command printed before no longer fits.
    put(S, MEMBERSHIPS_FILE, csv(MEMBERSHIPS, [membership(cy, 1, '1 Month unlimited', 'Active', addD(T0, -5), addD(T0, 24))]));
    const shifted = await since(() => cli(['run-all', S, '--save', '--from-step', '3:rezerv-payments-2026.csv']));
    ok('...and once the folder has changed, the old --from-step is refused, not run against another file',
       shifted.code === 2 && shifted.calls.length === 0 && /The folder has changed/.test(shifted.err), shifted.all);

    // A server that skips rows for a reason this tool has never heard of.
    const U = dir('unknown');
    put(U, STUDENTS_FILE, csv(STUDENTS, [student(cy)]));
    put(U, 'rezerv-payments-2026.csv', csv(PAYMENTS, [payment('10/23/2026 08:00:00', 41, cy, 'Drop-in', 'CARD', 1605, 105)]));
    put(U, 'rezerv-visits-2025.csv', csv(VISITS, [visit('2025-03-17', '05:30 AM', MYSORE, `B${s8}41`, cy, 'Completed')]));
    const fake = (skipped, warnings = []) => c => c.kind === 'payments' ? { status: 200, body: { kind: 'payments', dryRun: c.dry, total: c.n,
      added: c.n - skipped.length, matched: 0, updated: 0, newMembers: 0, skipped, warnings } } : null;
    const tries = [];
    for (const skipped of [[{ row: 2, reason: `a new rule about Secret Fake${TAG}`, code: 'brandNewReason', vals: [`Secret Fake${TAG}`] }],
      [{ row: 2, reason: `insert failed for Secret Fake${TAG}` }], [{ row: 2, reason: 'x', code: `Secret Fake${TAG}` }], [{ row: 2, reason: 'x', code: 'Zebedee' }]]) {
      hook = fake(skipped);
      tries.push(await since(() => cli(['run-all', U, '--save'])));
      hook = null;
    }
    ok('an unknown skip code stops the run before that file is saved, and before any later file',
       tries.every(t => t.code === 1 && /^STOPPED at step 2 of 3: rezerv-payments-2026\.csv \(payments\)$/m.test(t.err) && /^Rule: unknown-skip-code: /m.test(t.err)
         && sent(t.calls) === 'members:true,members:false,payments:true'), JSON.stringify(tries.map(t => [t.code, t.err])));
    ok('...and only a code from this tool\'s own tables is ever printed: any other word is "(unknown code)", and none is "(no code)"',
       /\(unknown code\) 1\.$/m.test(tries[0].err) && /\(no code\) 1\.$/m.test(tries[1].err) && /\(unknown code\) 1\.$/m.test(tries[2].err)
       && /\(unknown code\) 1\.$/m.test(tries[3].err)
       && tries.every(t => !t.all.includes(TAG) && !/new rule|insert failed|brandNewReason|Zebedee/.test(t.all)), tries.map(t => t.err).join('\n'));
    hook = fake([], [{ row: 2, message: `a new note about Secret Fake${TAG}`, code: 'brandNewNote', vals: [] }]);
    const note = await since(() => cli(['run-all', U, '--save']));
    hook = null;
    ok('a note this tool does not know stops the run before that file is saved, too',
       note.code === 1 && /^Rule: unknown-warning-code: .*\(unknown code\) 1\.$/m.test(note.err) && sent(note.calls) === 'members:true,members:false,payments:true'
       && !/brandNewNote|new note/.test(note.all), note.all);
    hook = c => c.kind === 'payments' ? { status: 200, body: { ok: true } } : null;
    const odd = await since(() => cli(['run-all', U, '--save']));
    hook = null;
    ok('an answer that is not an import result is a failed batch, never "0 rows, all fine"',
       odd.code === 1 && /^Rule: failed-batch: a batch failed at row 2 \(the answer was not an import result\)\.$/m.test(odd.err)
       && odd.calls.filter(c => c.kind === 'payments').every(c => c.dry === true), odd.all);
    hook = c => c.kind === 'visits' && c.dry === false ? { status: 500, body: { error: 'the database went away' } } : null;
    const half = await since(() => cli(['run-all', U, '--save']));
    hook = null;
    const step3 = `run-all '${U}' --save --from-step '3:rezerv-visits-2025.csv' --base ${FRONT}`;
    ok('a batch that fails while a file is being saved stops the run there, and says the step can be run again',
       half.code === 1 && /^STOPPED at step 3 of 3: rezerv-visits-2025\.csv \(visits\)$/m.test(half.err)
       && /^Rule: failed-batch \(while saving\): a batch failed at row 2 \(HTTP 500\)\.$/m.test(half.err)
       && half.err.includes(step3) && !/database went away/.test(half.all)
       && sent(half.calls) === 'members:true,members:false,payments:true,payments:false,visits:true,visits:false', half.all);
    // The server saves the file, and its answer is lost on the way back.
    hook = c => c.kind === 'visits' && c.dry === false ? 'late' : null;
    const lost = await since(() => cli(['run-all', U, '--save', '--from-step', '3:rezerv-visits-2025.csv'], { env: { REZERV_IMPORT_TIMEOUT_MS: '2000' } }));
    hook = null;
    ok('a save with no answer in time is not called unsaved: it may or may not be saved, and the step is run again to see',
       lost.code === 1 && /^Rule: failed-batch \(while saving\): a batch failed at row 2 \(no answer in 2 seconds\)\.$/m.test(lost.err)
       && /^The batch at that row may or may not be saved; the rows before it are saved\. No later file was touched\.$/m.test(lost.err)
       && /^Run this step again to see what was saved and to finish \(nothing is added twice\):$/m.test(lost.err) && lost.err.includes(step3)
       && (await one('SELECT count(*)::int AS n FROM bkk_bookings WHERE source_ref=$1', [`B${s8}41`])).n === 1, lost.all);
    const mend = await cli(['run-all', U, '--save', '--from-step', '3:rezerv-visits-2025.csv']);
    ok('...and running that step again finds it there and ends clean', mend.code === 0 && /^  Already there: 1$/m.test(mend.out)
       && /^Done: 1 file saved, steps 3 to 3 of 3\.$/m.test(mend.out), mend.all);

    const D = dir('day-first');
    put(D, 'rezerv-payments-2026.csv', csv(PAYMENTS, [payment('15/03/2024 05:42:10', 43, cy, 'Drop-in', 'CARD', 1605, 105)]));
    const alone = [await since(() => cli(['run-all', D, '--save'])), await since(() => cli(['run-all', D]))];
    ok('a folder with no students file stops before its first step: payments and visits would make new students of their own rows',
       alone[0].code === 1 && alone[0].calls.length === 0 && /^STOPPED before step 1\.$/m.test(alone[0].err) && /^Rule: no-students-file: /m.test(alone[0].err)
       && alone[1].code === 1 && /^Would stop before step 1 \(no-students-file\)/m.test(alone[1].out) && alone[1].calls.every(c => c.dry === true), alone[0].all + alone[1].all);
    put(D, STUDENTS_FILE, csv(STUDENTS, [student(cy)]));
    const df = await since(() => cli(['run-all', D, '--save']));
    ok('a Rezerv payments file whose Paid On does not read month first stops the run after its check',
       df.code === 1 && /^Rule: paid-on-not-month-first: /m.test(df.err) && sent(df.calls) === 'members:true,members:false,payments:true', df.all);
    const V = dir('void-inside');
    put(V, STUDENTS_FILE, csv(STUDENTS, [student(cy)]));
    put(V, 'rezerv-payments-2026.csv', fs.readFileSync(voidFile));
    put(V, 'rezerv-visits-2025.csv', csv(VISITS, [visit('2025-03-18', '05:30 AM', MYSORE, `B${s8}42`, cy, 'Completed')]));
    const vr = await since(() => cli(['run-all', V, '--save']));
    ok('a voided list under a payments name is still refused, and stops the run with nothing of it sent',
       vr.code === 1 && /^STOPPED at step 2 of 3: rezerv-payments-2026\.csv \(payments\)$/m.test(vr.err) && /^Rule: refused \(void-file\)/m.test(vr.err)
       && sent(vr.calls) === 'members:true,members:false', vr.all);
  }

  console.log('\n— run-all: what the page\'s preview would have shown a person —');
  {
    // A quote that never closes: every line after it is read into one cell.
    const Q = dir('runaway');
    const head = 'CustomerName,MobileCode,Mobile,Email,RezervPass ID';
    put(Q, STUDENTS_FILE, `\uFEFF${head}\r\n"Runaway Fake${TAG},66,0800000001,runaway.${TAG}@example.com,${rz(31)}\r\n`
      + `Other Fake${TAG},66,0800000002,other.${TAG}@example.com,${rz(32)}\r\n`);
    const q = await since(() => cli(['run-all', Q, '--save']));
    ok('a file read as one row with other people\'s cells in its name (a quote that never closes) stops run-all before it is saved',
       q.code === 1 && /^  Rows in the file: 1 /m.test(q.out) && /^Rule: cells-to-look-at: 1 cell holds a line break/m.test(q.err)
       && sent(q.calls) === 'members:true' && (await members([rz(31), rz(32)])).length === 0, q.all);
    const B = dir('both-ways');
    put(B, STUDENTS_FILE, csv(STUDENTS, [student(cy)]));
    put(B, 'rezerv-payments-2024.csv', csv(PAYMENTS.replace('Issued On,', ''), [payment('03/04/2024 09:00:00', 61, cy, 'Drop-in', 'CARD', 1605, 105)]));
    put(B, 'rezerv-visits-2025.csv', csv(VISITS, [visit('2025-03-06', '05:30 AM', MYSORE, `B${s8}61`, cy, 'Completed')]));
    const b = await since(() => cli(['run-all', B]));
    ok('a payments or visits file whose dates can be read both ways would stop it: a look says so for each',
       b.code === 1 && b.calls.every(c => c.dry === true)
       && (b.out.match(/^  Would stop here \(dates-read-both-ways\): no date in date has a number over 12/gm) || []).length === 2, b.all);
    const bs = await since(() => cli(['run-all', B, '--save']));
    ok('...and with --save nothing of that file is saved', bs.code === 1 && /^Rule: dates-read-both-ways: /m.test(bs.err)
       && sent(bs.calls) === 'members:true,members:false,payments:true'
       && (await one(`SELECT count(*)::int AS n FROM bkk_orders WHERE source='rezerv' AND source_ref=$1`, [trx(61)])).n === 0, bs.all);
  }

  console.log('\n— run-all: rows the server kept with a guess —');
  {
    const passOf = async n => (await one(`SELECT count(*)::int AS n FROM bkk_passes WHERE source='rezerv' AND source_ref=$1`, [memberNo(n)])).n;
    const W = dir('guess-status');
    put(W, STUDENTS_FILE, csv(STUDENTS, [student(cy)]));
    // A status word the server does not know, on a pass whose end date is still to come.
    put(W, MEMBERSHIPS_FILE, csv(MEMBERSHIPS, [membership(cy, 21, '3 months Unlimited', 'Unpaid', addD(T0, -3), addD(T0, 27))]));
    const w = await since(() => cli(['run-all', W, '--save']));
    ok('a pass whose status the server did not understand is not saved as a pass that lets someone in: run-all stops for a person',
       w.code === 1 && /^    passStatus: 1 \(a person must look\)$/m.test(w.out) && /^Rule: warning-needs-a-person: .*passStatus 1\.$/m.test(w.err)
       && sent(w.calls) === 'members:true,members:false,passes:true' && (await passOf(21)) === 0, w.all);
    const X = dir('guess-vat');
    put(X, STUDENTS_FILE, csv(STUDENTS, [student(cy)]));
    put(X, 'rezerv-payments-2026.csv', csv(PAYMENTS, [{ ...payment('10/24/2026 08:00:00', 51, cy, 'Drop-in', 'CARD', 1605, 105), Tax: 'n/a' }]));
    const x = await since(() => cli(['run-all', X, '--save']));
    ok('...nor is a payment whose VAT could not be read saved with VAT 0',
       x.code === 1 && /^Rule: warning-needs-a-person: .*badVat 1\.$/m.test(x.err) && sent(x.calls) === 'members:true,members:false,payments:true'
       && (await one(`SELECT count(*)::int AS n FROM bkk_orders WHERE source='rezerv' AND source_ref=$1`, [trx(51)])).n === 0, x.all);
  }

  console.log('\n— run-all: packs not started yet, and files with no rows —');
  {
    const passN = async n => (await one(`SELECT count(*)::int AS n FROM bkk_passes WHERE source='rezerv' AND source_ref=$1`, [trx(900 + n)])).n;
    const N = dir('not-started');
    put(N, STUDENTS_FILE, csv(STUDENTS, [student(eli)]));
    put(N, PACKS_FILE, csv(PACKAGES, [
      pack(eli, 31, 'Drop-in', 'Active', '--', '--', 1, 1), pack(eli, 32, 'Drop-in', 'Not Started', '--', '--', 1, 1),
      pack(eli, 33, 'Drop-in', 'Pending', '--', '--', 1, 1), pack(eli, 34, 'Drop-in', 'Expired', '2025-06-10', '2025-06-10', 1, 0)]));
    const n = await since(() => cli(['run-all', N, '--save', '--details-dir', path.join(N, 'details')]));
    const det = JSON.parse(fs.readFileSync(path.join(N, 'details', `${PACKS_FILE}.details.json`), 'utf8'));
    ok('a pack paid for and not started yet (dates "--": Active, Not Started, Pending) does not stop run-all',
       n.code === 0 && /^Done: 2 files saved, steps 1 to 2 of 2\.$/m.test(n.out)
       && /^    badUntil: 3 \(a pack bought and not started yet: not brought over\)$/m.test(n.out) && (await passN(34)) === 1, n.all);
    ok('...and it is not hidden: the server does not bring it over, so the run ends by saying how many to add by hand, their names in the details file',
       (await passN(31)) + (await passN(32)) + (await passN(33)) === 0
       && new RegExp(`^Packs bought and not started yet, not brought over: 3 in ${PACKS_FILE.replace(/\./g, '\\.')}\\. Names are in its details file\\. Add them by hand\\.$`, 'm').test(n.out)
       && det.saved.skipped.length === 3 && det.saved.skipped.every(x => x.code === 'badUntil' && x.name === eli.name), n.out);
    const N2 = dir('bad-until');
    put(N2, STUDENTS_FILE, csv(STUDENTS, [student(eli)]));
    put(N2, PACKS_FILE, csv(PACKAGES, [{ ...pack(eli, 35, 'Drop-in', 'Active', '2025-06-10', '2025-06-10', 1, 1), 'Expiration Date': 'soon' }]));
    const n2 = await since(() => cli(['run-all', N2, '--save']));
    ok('...an end date that is there and cannot be read still stops it', n2.code === 1 && /^Rule: skip-code-needs-a-person: .*badUntil 1\.$/m.test(n2.err)
       && /^    badUntil: 1 \(a person must look\)$/m.test(n2.out) && sent(n2.calls) === 'members:true,members:false,passes:true', n2.all);

    const E = dir('no-rows');
    put(E, STUDENTS_FILE, csv(STUDENTS, [student(eli)]));
    const none = put(E, 'rezerv-payments-2023.csv', '\uFEFF' + PAYMENTS + '\r\n');
    put(E, 'rezerv-visits-2025.csv', csv(VISITS, [visit('2025-03-19', '05:30 AM', MYSORE, `B${s8}71`, eli, 'Completed')]));
    const e = await since(() => cli(['run-all', E, '--save']));
    ok('a payments file with its headings and no rows (a year with no payments) is a step with nothing to do: the run goes on',
       e.code === 0 && /^Step 2 of 3\nFile: rezerv-payments-2023\.csv\nKind: payments\n  No rows in this file: nothing to do\.$/m.test(e.out)
       && sent(e.calls) === 'members:true,members:false,visits:true,visits:false' && /^Done: 2 files saved, steps 1 to 3 of 3\.$/m.test(e.out), e.all);
    fs.writeFileSync(none, '');
    const e0 = await since(() => cli(['run-all', E, '--save']));
    ok('...a file with nothing in it at all, not even headings, still stops it: that is a download that failed',
       e0.code === 1 && /^Rule: refused \(empty-file\): /m.test(e0.err) && sent(e0.calls) === 'members:true,members:false', e0.all);
  }

  console.log('\n— batches of 1,000, and a batch that fails —');
  {
    const bulkRows = lead => Array.from({ length: 1001 }, (_, i) => ({ CustomerName: `Bulk${i} Fake${TAG}`, 'RezervPass ID': `${lead}${s8}${String(i).padStart(4, '0')}` }));
    const bulk = async lead => (await one(`SELECT count(*)::int AS n FROM bkk_members WHERE rezerv_id LIKE $1`, [`${lead}${s8}%`])).n;
    const f = put(A, 'bulk.csv', csv(STUDENTS, bulkRows(6)));
    const c1 = await since(() => cli(['check', 'members', f]));
    ok('1,001 rows go in two batches, numbered by the file\'s rows as the page numbers them',
       c1.code === 0 && counts(c1) === '1001:1001:0:0:0:0' && c1.calls.map(c => `${c.body.firstRow}+${c.n}`).join() === '2+1000,1002+1'
       && /in 2 batches/.test(c1.out), c1.out);
    hook = c => c.dry === false && c.body.firstRow === 1002 ? { status: 500, body: { error: `boom at Secret Fake${TAG}` } } : null;
    const det = path.join(A, 'bulk.details.json');
    const w = await cli(['write', 'members', f, '--expect', expectIn(c1), '--details', det]);
    hook = null;
    ok('a batch that fails stops the run at its row; the rows before it are saved', w.code === 1
       && /^  Stopped at row 1002 \(HTTP 500\)\. Rows before it are saved\. Fix it and run again: nothing is added twice\.$/m.test(w.out)
       && /^  Batches saved: 1 of 2$/m.test(w.out) && /Not every row was saved/.test(w.err) && (await bulk(6)) === 1000, w.all);
    ok('...what the server said is in the details file only',
       !/boom/.test(w.all) && JSON.parse(fs.readFileSync(det, 'utf8')).saved.stopped.error.includes('boom'), w.all);
    const c2 = await cli(['check', 'members', f]);
    ok('...and running again adds nothing twice: 1,000 already there, 1 to add', c2.code === 0 && counts(c2) === '1001:1:1000:0:0:0', c2.out);
    hook = () => 'hang';
    const slow = await cli(['check', 'members', studentsFile], { env: { REZERV_IMPORT_TIMEOUT_MS: '400' } });
    hook = null;
    ok('a batch with no answer in time stops the run', slow.code === 1 && /Stopped at row 2 \(no answer in 400 ms\)\. Nothing was saved\./.test(slow.out), slow.all);

    // The server finishes the save; its answer comes too late for the tool.
    const lately = who(21, 'Lately'), lateFile = put(A, 'late.csv', csv(STUDENTS, [student(lately)]));
    const lateChk = await cli(['check', 'members', lateFile]);
    hook = c => c.dry === false ? 'late' : null;
    const late = await cli(['write', 'members', lateFile, '--expect', expectIn(lateChk)], { env: { REZERV_IMPORT_TIMEOUT_MS: '2000' } });
    hook = null;
    ok('a save that gets no answer in time is never reported as not saved: it may or may not be, and the tool says to run check',
       late.code === 1 && /Stopped at row 2 \(no answer in 2 seconds\)\. The batch at that row may or may not be saved; .* Run check to see/.test(late.out)
       && /^It is not known whether every row was saved\.$/m.test(late.err) && !/Not every row was saved/.test(late.err)
       && late.err.includes(`check members '${lateFile}' --base ${FRONT}`) && (await members([lately.rz])).length === 1, late.all);

    // Ctrl-C while the first of two batches is being saved.
    const f2 = put(A, 'bulk2.csv', csv(STUDENTS, bulkRows(5))), det2 = path.join(A, 'bulk2.details.json');
    const c3 = await cli(['check', 'members', f2]);
    let kid = null;
    hook = c => { if (c.dry === false && c.body.firstRow === 2 && kid) kid.kill('SIGINT'); return null; };
    const cut = await since(() => cli(['write', 'members', f2, '--expect', expectIn(c3), '--details', det2], { child: p => { kid = p; } }));
    hook = null;
    const d2 = fs.existsSync(det2) && fs.statSync(det2).size ? JSON.parse(fs.readFileSync(det2, 'utf8')) : {};
    ok('Ctrl-C during a save lets the batch on its way finish, sends no further batch, and says where the save stands',
       cut.code === 1 && cut.calls.filter(c => c.dry === false).length === 1 && (await bulk(5)) === 1000
       && /^Interrupted: stopping after the batch that is on its way\./m.test(cut.err) && /^  Batches saved: 1 of 2$/m.test(cut.out)
       && /^  Stopped at row 1002 \(interrupted\)\. Rows before it are saved\. Run it again to finish/m.test(cut.out), cut.all);
    ok('...with the command to run again, and the details file written',
       /^Interrupted: not every row was saved\.$/m.test(cut.err) && cut.err.includes(`check members '${f2}' --base ${FRONT}`)
       && !!d2.saved && d2.saved.added === 1000 && d2.saved.batchesDone === 1 && d2.saved.stopped.interrupted === true, cut.err + JSON.stringify(d2).slice(0, 200));

    hook = () => ({ status: 308, headers: { Location: 'https://www.elsewhere.example/api/bkk/admin/import/members' }, body: {} });
    const mv = await since(() => cli(['check', 'members', studentsFile]));
    hook = null;
    ok('a redirect is not followed: the tool stops and names the address to give with --base',
       mv.code === 1 && mv.calls.length === 1
       && /^  Stopped at row 2 \(HTTP 308: the server moved this address to https:\/\/www\.elsewhere\.example\)\. Nothing was saved\.$/m.test(mv.out)
       && /^  This tool does not follow a redirect\. If https:\/\/www\.elsewhere\.example is the right server, give it with --base\.$/m.test(mv.out), mv.all);
  }

  console.log('\n— the admin key —');
  {
    const none = await since(() => cli(['check', 'members', studentsFile], { key: false }));
    ok('without the key: the plain message, and exit 4', none.code === 4
       && none.err === 'Not authorised. Run this where the admin key is added by the network.\n' && none.calls[0].key === null, none.all);
    const noneW = await since(() => cli(['write', 'members', studentsFile, '--expect', NONE], { key: false }));
    const noneAll = await since(() => cli(['run-all', R, '--save'], { key: false }));
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
      // The names on the certificate: the test server's, and the proxy's own address.
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(TMP, 'key.pem'), '-out', path.join(TMP, 'cert.pem'),
        '-days', '2', '-subj', '/CN=importer.test', '-addext', 'subjectAltName=DNS:importer.test,DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
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
      // importer.test is not one of our servers: only the test switch lets the tool send to it.
      const env = { HTTPS_PROXY: via, https_proxy: via, NODE_EXTRA_CA_CERTS: cert, SSL_CERT_FILE: cert, REZERV_IMPORT_TEST_ANY_HOST: '1' };
      const shut = await since(() => cli(['check', 'members', studentsFile], { key: false, base: 'https://importer.test', env: { ...env, REZERV_IMPORT_TEST_ANY_HOST: '' } }));
      ok('without the test switch even this test\'s own https server is refused, and the proxy is never asked',
         shut.code === 2 && shut.calls.length === 0 && connects.length === 0, shut.all);
      const r = await since(() => cli(['check', 'members', studentsFile], { key: false, base: 'https://importer.test', env }));
      ok('an https server is reached through HTTPS_PROXY, where the key is added: the tool never holds it',
         r.code === 0 && counts(r) === '3:0:3:0:0:0' && connects.join() === 'importer.test:443' && seen.length === 1
         && seen[0].host === 'importer.test' && seen[0].key === null && r.calls.length === 1, r.all + JSON.stringify([connects, seen]));
      const byNumber = await cli(['check', 'members', studentsFile], { key: false, base: 'https://203.0.113.5', env });
      ok('an https address given as a number is held to its certificate too, never to the proxy\'s name',
         byNumber.code === 1 && /Stopped at row 2 \(network error ERR_TLS_CERT_ALTNAME_INVALID\)/.test(byNumber.out) && seen.length === 1, byNumber.all);
      const badKey = await cli(['check', 'members', studentsFile], { key: 'line one\nline two', base: 'https://importer.test', env });
      ok('an error after the tunnel is open is one plain line: no stack trace, no header name',
         badKey.code === 1 && /Stopped at row 2 \(network error ERR_INVALID_CHAR\)/.test(badKey.out) && badKey.err === ''
         && !/TypeError|x-bkk-key|\n\s+at /.test(badKey.all) && seen.length === 1, badKey.all);
      deny = true;
      const d = await cli(['check', 'members', studentsFile], { key: false, base: 'https://importer.test', env });
      ok('a proxy that refuses the server stops the run', d.code === 1 && /Stopped at row 2 \(the network proxy answered 403\)/.test(d.out), d.all);
      deny = false;
      const noTrust = await cli(['check', 'members', studentsFile], { key: false, base: 'https://importer.test',
        env: { ...env, NODE_EXTRA_CA_CERTS: '', SSL_CERT_FILE: '' } });
      ok('...and a certificate nobody vouches for is never accepted', noTrust.code === 1
         && /Stopped at row 2 \(network error [A-Z0-9_]+\)/.test(noTrust.out) && seen.length === 1, noTrust.all);
      proxy.close(); inside.close();
    }
  }

  console.log('\n— exports stay out of git —');
  {
    const G = dir('repo'), G2 = dir('repo-bare');
    let git = true;
    try { for (const g of [G, G2]) execFileSync('git', ['init', '-q', g], { stdio: 'ignore' }); } catch { git = false; console.log('  (skipped: no git here)'); }
    if (git) {
      // The repository's own .gitignore, in a made-up repository.
      fs.copyFileSync(path.join(__dirname, '../.gitignore'), path.join(G, '.gitignore'));
      const loose = put(G, 'students.csv', fs.readFileSync(studentsFile));
      const named = put(G, STUDENTS_FILE, fs.readFileSync(studentsFile));
      const inFolder = put(dir('repo/rezerv-export'), 'students.csv', fs.readFileSync(studentsFile));
      const r1 = await since(() => cli(['check', 'members', loose]));
      ok('a CSV inside a git repository that git does not ignore is refused before it is read or sent',
         r1.code === 2 && r1.calls.length === 0 && r1.out === '' && /this is inside a git repository, and git does not ignore it/.test(r1.err), r1.all);
      const r2 = [await since(() => cli(['check', 'members', named])), await since(() => cli(['check', 'members', inFolder])),
        await since(() => cli(['check', 'members', named, '--details', path.join(G, 'students.details.json')]))];
      ok('...the repository\'s .gitignore covers rezerv-*.csv, the folder rezerv-export/ and *.details.json, so those are taken',
         r2.every(r => r.code === 0 && r.calls.length === 1), JSON.stringify(r2.map(r => [r.code, r.err])));
      const r3 = await since(() => cli(['check', 'members', named, '--details', path.join(G, 'notes-on-students.txt')]));
      ok('...a details file is held to the same rule', r3.code === 2 && r3.calls.length === 0
         && /notes-on-students\.txt: this is inside a git repository/.test(r3.err) && !fs.existsSync(path.join(G, 'notes-on-students.txt')), r3.all);
      // A repository with no such .gitignore: the export would be published by one "git add".
      put(G2, STUDENTS_FILE, fs.readFileSync(studentsFile));
      const r4 = [await since(() => cli(['plan', G2])), await since(() => cli(['run-all', G2])), await since(() => cli(['run-all', G2, '--save']))];
      ok('...and so are plan and run-all, for every file of the folder', r4.every(r => r.code === 2 && r.calls.length === 0 && r.out === ''
         && /this is inside a git repository, and git does not ignore it/.test(r.err)), JSON.stringify(r4.map(r => [r.code, r.out, r.err])));
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
    // Page code that fails on a real row, with that row's first cell in the error's name.
    const thrower = doctored('thrower', 'function rowFor(r) {',
      'function rowFor(r) {\n    if (String(r.cells[0]).startsWith(\'Boom\')) { const e = new Error(\'x\'); e.name = \'Err \' + r.cells[0]; throw e; }');
    const boom = await since(() => cli(['check', 'members', put(A, 'boom.csv', csv(STUDENTS, [student(who(22, 'Boom'))]))], { env: { REZERV_IMPORT_PAGE: thrower } }));
    ok('an error out of the page\'s code is reported by a fixed word: its name, like its text, could quote a row',
       boom.code === 1 && boom.err === 'Stopped: unexpected error.\n' && boom.calls.length === 0 && !boom.all.includes('Boom'), boom.all);
  }

  console.log('\n— the codes this tool knows are the server\'s —');
  {
    const { SKIP_CODES, WARN_CODES, KINDS, SERVERS, DEFAULT_TIMEOUT_MS } = require(SCRIPT);
    const api = fs.readFileSync(path.join(__dirname, '../bkk-api.js'), 'utf8');
    const table = api.slice(api.indexOf('const IMPORT_EN = {'), api.indexOf('const why = '));
    const server = [...table.matchAll(/^    (\w+): /gm)].map(m => m[1]);
    const known = new Set(KINDS.flatMap(k => Object.keys(SKIP_CODES[k])));
    ok('every code in the server\'s table is one this tool has a rule for: a skip, or a note next to a row that is kept',
       server.length > 40 && server.every(c => known.has(c) || has(WARN_CODES, c)), server.filter(c => !known.has(c) && !has(WARN_CODES, c)).join());
    ok('...and every code this tool has a rule for is in the server\'s table: "ok" or "ask" for a skip, "note" or "ask" for a note, nothing else',
       [...known, ...Object.keys(WARN_CODES)].every(c => server.includes(c))
       && KINDS.every(k => Object.values(SKIP_CODES[k]).every(v => v === 'ok' || v === 'ask'))
       && Object.values(WARN_CODES).every(v => v === 'note' || v === 'ask'), [...known, ...Object.keys(WARN_CODES)].filter(c => !server.includes(c)).join());
    // How the server uses each code: warn(...) and said(...) go next to a row that is kept, the rest skip one.
    const uses = [...api.matchAll(/(warn\(|said\()?why\('(\w+)'/g)].map(m => [m[2], !!m[1]]);
    const asNote = [...new Set(uses.filter(u => u[1]).map(u => u[0]))], asSkip = [...new Set(uses.filter(u => !u[1]).map(u => u[0]))];
    const clash = [...new Set([...api.matchAll(/code: '(clash\w+)'/g)].map(m => m[1]))];
    ok('...each on the side the server uses it on: a note it gives is in the notes table, a skip in the skips',
       asNote.length >= 16 && asSkip.length >= 20 && clash.length === 3 && [...asNote, ...clash].every(c => has(WARN_CODES, c))
       && [...asSkip, ...clash].every(c => known.has(c)), JSON.stringify([asNote.filter(c => !has(WARN_CODES, c)), asSkip.filter(c => !known.has(c))]));
    ok('...the only skips run-all lets through: a pack never started, a payment that brought no money, a waiting-list place',
       KINDS.map(k => `${k}:${Object.keys(SKIP_CODES[k]).filter(c => SKIP_CODES[k][c] === 'ok')}`).join(' ')
       === 'members: passes:neverStarted payments:notMoney visits:waitlist');
    ok('...the notes run-all stops on: a status, a VAT or a pause date the server could not read, and more classes left than the pack holds',
       Object.keys(WARN_CODES).filter(c => WARN_CODES[c] === 'ask').sort().join() === 'badFreeze,badVat,leftOver,passStatus');
    ok('a batch is given two minutes, and rows go to aybkk.net or my.aybkk.com only',
       DEFAULT_TIMEOUT_MS === 120000 && SERVERS.join() === 'aybkk.net,my.aybkk.com', `${DEFAULT_TIMEOUT_MS} ${SERVERS}`);
  }

  console.log('\n— nothing private on screen —');
  // The phone's own digits are the last six of the stamp; a first name counts when it stands as a word.
  const leaks = [TAG, KEY, s8, s8.slice(-6), 'example.com', 'Fake', 'Made Up Road'].filter(x => ALL.toLowerCase().includes(x.toLowerCase()))
    .concat([...FIRSTS].filter(n => new RegExp(`\\b${n}\\b`).test(ALL)));
  ok('no name, first name, email, phone, Rezerv id, address or key of this test is anywhere in what the tool printed',
     leaks.length === 0 && ALL.length > 5000 && FIRSTS.size > 15 && phone(1).includes(s8.slice(-6)), `leaked: ${leaks.join()} in ${ALL.length} characters`);

  console.log(`\n${PASS} passed, ${FAIL} failed`);
  fs.rmSync(TMP, { recursive: true, force: true });
  front.close(); srv.close(); await pool.end();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
