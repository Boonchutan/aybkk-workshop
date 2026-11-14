// Student lists and counts need the staff key (X-Bkk-Key = BKK_ADMIN_KEY).
// Runs the real server.js on a local port against a throwaway Postgres, with Neo4j
// replaced by an empty stand-in. Made-up students only. A failure prints the status
// and the top-level keys, never a body: some locked routes read the committed roster.
const crypto = require('crypto');
const http = require('http');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Pool } = require('pg');

const DB = process.env.TEST_DATABASE_URL || 'postgres://test:test@127.0.0.1:5432/bkktest';
const KEY = 'lock-test-key';
const STAFF = { 'x-bkk-key': KEY };
const ROOT = path.join(__dirname, '..');

let PASS = 0, FAIL = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name} ${extra}`); }
};

// Neo4j stand-in: every query finds nothing; a count query counts 0.
const PRELOAD = `
const neo4j = require('neo4j-driver');
const rec = { get: k => k === 'teachers' ? [] : neo4j.int(0) };
const run = async q => ({ records: /RETURN\\s+count\\(/i.test(q) ? [rec] : [] });
const session = () => ({ run, close: async () => {} });
neo4j.driver = () => ({ session, close: async () => {}, verifyConnectivity: async () => {} });
require(process.env.LOCK_TEST_SERVER);
`;

// The teacher bot gets made-up updates; its outgoing calls are caught, never sent, and
// reported as one line of JSON each: how many messages and buttons went out.
const BOT_HARNESS = `
const grammy = require('grammy');
const neo4j = require('neo4j-driver');
const recs = Array.from({ length: 11 }, (_, i) => ({ get: k => k === 'name' ? 'Locktest Member ' + i : k === 'id' ? 'lock-' + i : /count/i.test(k) ? neo4j.int(1) : null }));
neo4j.driver = () => ({ session: () => ({ run: async () => ({ records: recs }), close: async () => {} }), close: async () => {}, verifyConnectivity: async () => {} });
let bot, sent = [];
grammy.Bot.prototype.start = function () {
  bot = this;
  this.botInfo = { id: 1, is_bot: true, first_name: 'T', username: 't_bot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false };
  this.api.config.use(async (prev, method, payload) => {
    const kb = payload && payload.reply_markup && (payload.reply_markup.inline_keyboard || payload.reply_markup.keyboard);
    sent.push(kb ? kb.flat().length : 0);
    return { ok: true, result: { message_id: 1, date: 0, chat: { id: 1, type: 'private' } } };
  });
};
require(process.env.LOCK_TEST_BOT);
let n = 1;
(async () => {
  while (!bot) await new Promise(r => setTimeout(r, 20));
  for (const [from, text] of JSON.parse(process.env.LOCK_TEST_UPDATES)) {
    sent = [];
    await bot.handleUpdate({ update_id: n++, message: { message_id: n, date: 0, chat: { id: from, type: 'private' }, from: { id: from, is_bot: false, first_name: 'X' }, text,
      ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] } : {}) } });
    process.stdout.write('@@' + JSON.stringify({ from, text, messages: sent.length, buttons: sent.reduce((a, b) => a + b, 0) }) + '\\n');
  }
  process.exit(0);
})();
`;
function botRun(updates, extra = {}) {
  const env = { ...process.env, TELEGRAM_BOT_TOKEN: '1:lock-test', TEACHER_CHAT_IDS: '5001', BOONCHU_CHAT_ID: '5002',
    LOCK_TEST_BOT: path.join(ROOT, 'assessment-bot.js'), LOCK_TEST_UPDATES: JSON.stringify(updates),
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'lock-bot-')), NEO4J_URI: 'bolt://127.0.0.1:9',
    RUSSIA_BOT_API_BASE: 'http://127.0.0.1:9', ...extra };
  return new Promise(resolve => {
    const c = spawn(process.execPath, ['-e', BOT_HARNESS], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    c.stdout.on('data', d => { out += d; });
    const t = setTimeout(() => c.kill('SIGKILL'), 30000);
    c.on('exit', () => { clearTimeout(t); resolve(out.split('\n').filter(l => l.startsWith('@@')).map(l => JSON.parse(l.slice(2)))); });
  });
}

let PORT;
function request(method, p, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p,
      headers: { ...headers, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
// Status and field names only: no body, and no length (a row count of a real roster is private too).
const shape = r => `${r.status} ${Array.isArray(r.json) ? '[array]'
  : r.json && typeof r.json === 'object' ? '{' + Object.keys(r.json).join(',') + '}' : r.headers['content-type'] || ''}`;
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

// [path, what the staff answer holds]; null = any answer but 401 (an unknown id is 404).
const LOCKED = [
  ['/api/mindmap/students', r => r.status === 200 && r.json.students.length === 3 && r.json.source === 'postgres'],
  ['/api/mindmap/student-data/1', null],
  ['/api/orientations', r => r.status === 200 && Array.isArray(r.json.orientations)],
  ['/api/orientations/bkk', r => r.status === 200 && r.json.students.length === 3],
  ['/api/orientations/ru', r => r.status === 200 && Array.isArray(r.json.students)],
  ['/api/orientations/ru?format=csv', r => r.status === 200 && /text\/csv/.test(r.headers['content-type'])],
  ['/api/orientations/online', r => r.status === 200 && Array.isArray(r.json.students)],
  ['/api/orientations/private', r => r.status === 200 && Array.isArray(r.json.students)],
  ['/api/orientation-status/hefei', r => r.status === 200 && ['total', 'doneCount', 'done', 'pending'].every(k => k in r.json)],
  ['/api/students', r => r.status === 200 && Array.isArray(r.json.students)],
  ['/api/students/lock-test-x', null],
  ['/api/students/1/progress', null],
  ['/api/progress/summary', r => r.status === 200 && Array.isArray(r.json)],
  ['/api/checkin/lock-test-x/week', null],
  ['/api/checkin/lock-test-x/stats', null],
  ['/api/courses/recommend/lock-test-x', null],
  ['/api/reports/generate/lock-test-x', null],
  ['/api/journal/students', r => r.status === 200 && Array.isArray(r.json.students)],
  ['/api/journal/profiles', r => r.status === 200 && Array.isArray(r.json.profiles)],
  ['/api/journal/profile/lock-test-x', null],
  ['/api/journal/history/30', r => r.status === 200 && Array.isArray(r.json.history)],
  ['/api/journal/weekly-recap?workshop=lock-test&weekOf=2026-11-02', r => r.status === 200 && r.json.cohort === 0],
  ['/api/teacher/students', r => r.status === 200 && Array.isArray(r.json.students)],
  ['/api/teacher/assessment/lock-test-x', r => r.status === 200 && Array.isArray(r.json.assessments)],
  ['/api/teacher/today', r => r.status === 200 && r.json.count === 0],
  ['/api/attendance', r => r.status === 200 && Array.isArray(r.json.rows)],
  ['/api/attendance.csv', r => r.status === 200 && /text\/csv/.test(r.headers['content-type'])],
  ['/api/uploads', r => r.status === 200 && Array.isArray(r.json)],
  ['/api/uploads/shop-payments', r => r.status === 200 && Array.isArray(r.json)],
  ['/api/sync/status', r => r.status === 200 && 'totalStudents' in r.json],
  ['/api/notion/sync-status', r => r.status === 200 && 'notionStudents' in r.json],
  ['/api/notion/students', null],
  ['/api/exam/roster', r => r.status === 200 && Array.isArray(r.json.students)],
  ['/api/transmission/bootstrap', r => r.status === 404 && /env-managed/.test(r.json.error)],
  ['/api/graph/visualize?type=students', r => r.status === 200],
  ['/admin/line-status', r => r.status === 200 && /LINE pipeline/.test(r.text)],
  ['/rosters/hefei.json', r => r.status === 200 && Array.isArray(r.json.students)],
  ['/qr-cards/manifest.json', r => r.status === 200],
  ['/qr-cards/hefei/manifest.json', r => r.status === 200],
  ['/downloads/hefei-cards-print.zip', r => r.status === 200],
];

(async () => {
  const pool = new Pool({ connectionString: DB });
  // A Rezerv-like students table with three made-up students, two sharing a name.
  await pool.query(`CREATE TABLE IF NOT EXISTS students (id SERIAL PRIMARY KEY, name TEXT, journal_link TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS journal_entries (id SERIAL PRIMARY KEY, student_id INTEGER, session_date DATE)`);
  await pool.query(`DELETE FROM students WHERE name LIKE 'Locktest %'`);
  const ids = (await pool.query(`INSERT INTO students (name) VALUES ('Locktest Solo'), ('Locktest Twin Alpha'), ('Locktest Twin Beta') RETURNING id`)).rows.map(r => r.id);
  await pool.query(`INSERT INTO journal_entries (student_id, session_date) VALUES ($1, '2026-11-01')`, [ids[0]]);

  PORT = await freePort();
  const env = { ...process.env, PORT: String(PORT), MISSION_CONTROL_PORT: String(PORT), DATABASE_URL: DB,
    BKK_ADMIN_KEY: KEY, TRANSMISSION_KEY: 'lock-test-transmission', MAIL_DRY_RUN: '1',
    NEO4J_URI: 'bolt://127.0.0.1:9', LOCK_TEST_SERVER: path.join(ROOT, 'server.js'),
    UPLOAD_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'lock-uploads-')),
    EXAM_BACKUP_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'lock-exam-')) };
  for (const k of ['SHOP_ADMIN_KEY', 'RAILWAY_ENVIRONMENT', 'RUN_BOT', 'ENABLE_TUNNEL', 'NOTION_API_KEY', 'TELEGRAM_BOT_TOKEN',
    'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'HELPDESK_LINE_ACCESS_TOKEN', 'HELPDESK_LINE_CHANNEL_SECRET', 'LINE_CHANNEL_SECRET',
    'LINE_CHANNEL_ACCESS_TOKEN', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) delete env[k];
  const child = spawn(process.execPath, ['-e', PRELOAD], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', d => { log = (log + d).slice(-4000); });
  child.stderr.on('data', d => { log = (log + d).slice(-4000); });
  const stop = code => { child.kill('SIGKILL'); pool.end().catch(() => {}); process.exit(code); };

  // Up, and the booking tables seeded.
  for (let i = 0; ; i++) {
    try { if ((await request('GET', '/api/bkk/schedule?days=3')).status === 200) break; } catch {}
    if (i > 120 || child.exitCode !== null) { console.error('server did not start:\n' + log); stop(1); }
    await new Promise(r => setTimeout(r, 250));
  }

  console.log('\n— without the key: 401 and nothing else —');
  for (const [p] of LOCKED) {
    const r = await request('GET', p);
    const bare = r.json && Object.keys(r.json).join() === 'error';
    const html = /^text\/html/.test(r.headers['content-type'] || '') && !/\d/.test(r.text.replace(/<[^>]*>/g, '').replace(/\bwidth=device-width,initial-scale=1\b/, ''));
    ok(`GET ${p} → 401`, r.status === 401 && (bare || html), shape(r));
    ok(`...says which key, and is never cached`, r.headers['www-authenticate'] === 'X-Bkk-Key' && /no-store/.test(r.headers['cache-control'] || ''),
      `${r.headers['www-authenticate']} | ${r.headers['cache-control']}`);
  }
  for (const p of ['/api/mindmap/students', '/rosters/hefei.json']) {
    ok(`HEAD ${p} → 401`, (await request('HEAD', p)).status === 401);
    ok(`a wrong key on ${p} → 401`, (await request('GET', p, { 'x-bkk-key': KEY + 'x' })).status === 401);
  }

  console.log('\n— other spellings of the same paths are locked too —');
  for (const p of ['/api/Mindmap/Students', '/API/MINDMAP/STUDENTS', '/api/mindmap//students', '/api/mindmap/students/',
    '/api/orientations/BKK', '/api/Orientations/bkk/', '/api/students/', '/api/journal//students',
    '/%72osters/hefei.json', '//rosters/hefei.json', '/rosters/./hefei.json', '/qr-cards/../rosters/hefei.json',
    '/rosters%2Fhefei.json', '/ROSTERS/hefei.json', '/qr-cards/hefei/%6danifest.json', '/downloads//hefei-cards-print.zip']) {
    const r = await request('GET', p);
    ok(`GET ${p} gives nothing`, r.status === 401 || r.status === 404, shape(r));
  }

  console.log('\n— with the key: the normal answer —');
  for (const [p, want] of LOCKED) {
    const r = await request('GET', p, STAFF);
    ok(`GET ${p} with the key`, want ? want(r) : r.status !== 401, shape(r));
  }
  const csv = await request('GET', '/api/orientations/ru?format=csv', STAFF);
  ok('...and a keyed answer is not cached either', /no-store/.test(csv.headers['cache-control'] || ''));

  console.log('\n— what stays open —');
  const signup = await request('POST', '/api/orientations/private', {}, { name: 'Locktest Signup', contact: 'locktest@example.com', contactType: 'email' });
  ok('a public sign-up form still saves without a key', signup.status === 200 && signup.json.success === true && /^private-/.test(signup.json.studentId), shape(signup));
  const pubSch = await request('GET', '/api/bkk/schedule?days=14');
  ok('the booking timetable is open, without capacity or booked counts', pubSch.status === 200 && pubSch.json.classes.length > 0
    && pubSch.json.classes.every(c => !('capacity' in c) && !('booked' in c) && c.seatsLeft >= 0 && c.seatsLeft <= 4), shape(pubSch));
  const staffSch = await request('GET', '/api/bkk/schedule?days=14', STAFF);
  ok('...staff still get the real numbers', staffSch.json.classes.every(c => 'capacity' in c && 'booked' in c));
  ok('a journal by its own id is not behind the key', (await request('GET', '/api/journal/student/lock-test-x')).status === 404);
  ok('a photo by its own id is not behind the key', (await request('GET', '/api/student/photo/lock-test-x')).status === 200);
  ok('prices are public', (await request('GET', '/api/bkk/products')).status === 200);
  ok('the key helper for team pages is served', /javascript/.test((await request('GET', '/staff-key.js')).headers['content-type'] || ''));
  ok('the Hefei orientation form is served', (await request('GET', '/orientation-hefei.html')).status === 200);
  const link = await request('GET', `/j/${ids[0]}`);
  ok("a student's own short link still opens their journal", link.status === 302 && /^\/student\.html\?id=/.test(link.headers.location || ''));
  const twins = await request('GET', '/j/locktest-twin');
  ok('a name shared by two students lists nobody without the key', twins.status === 404 && !/locktest|\/j\//i.test(twins.text), `${twins.status}`);
  const twinsStaff = await request('GET', '/j/locktest-twin', STAFF);
  ok('...staff get the list', twinsStaff.status === 409 && (twinsStaff.text.match(/\/j\//g) || []).length === 2, `${twinsStaff.status}`);

  console.log('\n— a short link is not a name search —');
  for (const p of ['/j/locktest-solo', '/j/solo', '/j/lockt', '/p/locktest-solo', '/p/solo', '/j/zzzz-none', '/p/locktest-twin']) {
    const r = await request('GET', p);
    ok(`GET ${p} → 404 without the key, no name`, r.status === 404 && !r.headers.location && !/locktest/i.test(r.text), `${r.status}`);
  }
  const solo = await request('GET', '/j/solo', STAFF);
  ok('...staff still find one student by name', solo.status === 302 && /[?&]name=/.test(solo.headers.location || ''), `${solo.status}`);
  const pretty = await request('GET', `/p/locktest-solo-${ids[0]}`);
  ok('a pretty link with the id still opens the profile', pretty.status === 302 && /^\/my-journal\.html\?id=/.test(pretty.headers.location || ''), `${pretty.status}`);

  console.log('\n— a short sign-in link (/in/<code>) leaves /in-depth alone, on every host —');
  const inTok = crypto.randomBytes(32).toString('hex');
  const inCode = Array.from({ length: 10 }, () => '23456789abcdefghjkmnpqrstuvwxyz'[crypto.randomInt(31)]).join('');
  await pool.query(`INSERT INTO bkk_login_tokens (token, member_id, email, ip, expires_at, short_code)
    VALUES ($1, NULL, NULL, 'staff', now() + interval '1 hour', $2)`, [inTok, inCode]);
  for (const host of ['aybkk.net', 'cn.aybkk.net', 'my.aybkk.com']) {
    const depth = await request('GET', '/in-depth', { host });
    ok(`${host}/in-depth still serves its own page`, depth.status === 200
      && (host.startsWith('cn.') ? /深度迈索尔/ : /In-Depth Mysore/).test(depth.text), `${depth.status}`);
    const hop = await request('GET', `/in/${inCode}`, { host });
    ok(`${host}/in/<code> goes on to the long link, with no referrer`, hop.status === 302
      && hop.headers.location === `/api/bkk/login/${inTok}` && hop.headers['referrer-policy'] === 'no-referrer', `${hop.status}`);
    ok(`${host}/in is not a short link`, (await request('GET', '/in', { host })).status === 404);
  }
  await pool.query('DELETE FROM bkk_login_tokens WHERE token=$1', [inTok]);

  console.log('\n— printed Hefei codes do not give the roster —');
  // Read at runtime from the committed roster; nothing from it is printed.
  const roster = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'rosters', 'hefei.json'), 'utf8')).students;
  const one = roster.find(x => x.slug && x.journalId && x.id && x.name);
  for (const [label, p] of [['code', one.id], ['slug', one.slug], ['other id + ?name=', 'gz-lock-test?name=' + encodeURIComponent(one.name)]]) {
    for (const route of ['pass', 'mine']) {
      const r = await request('GET', `/api/attendance/${route}/${p.includes('?') ? p : encodeURIComponent(p)}`);
      ok(`${route} by ${label} → 404 without the key`, r.status === 404 && !(r.json && 'name' in r.json), shape(r));
      const rs = await request('GET', `/api/attendance/${route}/${p.includes('?') ? p : encodeURIComponent(p)}`, STAFF);
      ok(`...staff still find it by ${label}`, rs.status === 200 && 'name' in rs.json, shape(rs));
    }
  }
  const own = await request('GET', '/api/attendance/pass/' + encodeURIComponent(one.journalId));
  ok("a student's own pass by journal id still works", own.status === 200 && 'qrDataUrl' in own.json, shape(own));
  ok('...and no shared cache keeps it', /private/.test(own.headers['cache-control'] || '') && !/public/.test(own.headers['cache-control'] || ''), own.headers['cache-control']);
  ok('their own stamps by journal id still work', (await request('GET', '/api/attendance/mine/' + encodeURIComponent(one.journalId))).status === 200);
  for (const p of [one.id, one.slug]) {
    const r = await request('GET', '/s/' + encodeURIComponent(p));
    ok('a printed card link still opens the journal, without a name', r.status === 302 && /^\/student\.html\?id=/.test(r.headers.location || '') && !/[?&]name=/.test(r.headers.location || ''), `${r.status}`);
  }

  console.log('\n— writes that answer with student data need the key —');
  for (const [m, p, body] of [['PUT', '/api/students/lock-test-x', {}], ['POST', '/api/notion/sync', {}], ['POST', '/api/sync/notion', {}],
    ['POST', '/api/teacher/comment', { studentId: 'lock-test-x', teacherName: 'T', comment: 'c' }],
    ['POST', '/api/teacher/assessment', { studentId: 'lock-test-x', teacherName: 'T' }]]) {
    const r = await request(m, p, {}, body);
    ok(`${m} ${p} → 401 without the key`, r.status === 401 && r.json && Object.keys(r.json).join() === 'error', shape(r));
    ok(`...and with the key it reaches the route`, (await request(m, p, STAFF, body)).status !== 401);
  }

  console.log('\n— team pages hold no student ids or names in their source —');
  for (const f of ['journal.html', 'student-report.html']) {
    const src = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
    ok(`${f} has no journal ids in it`, !/['"][0-9a-f]{6,8}-[0-9a-f]{2,4}-[0-9a-f]{2,4}-[0-9a-f]{2,4}-[0-9a-f]{8,12}['"]/i.test(src)
      && !roster.some(x => src.includes(x.journalId)));
  }

  console.log('\n— the teacher bot lists members to teachers only —');
  const runs = await botRun([[7001, '/students'], [7002, '/search'], [7002, 'all'], [7003, '📋 All'], [5001, '/students'], [5002, '/students'], [7004, '/start']]);
  ok('the bot ran every update', runs.length === 7, `${runs.length}`);
  for (const r of runs.slice(0, 4)) ok(`a stranger sending ${r.text} gets silence`, r.messages === 0, `${r.messages}`);
  ok('a teacher still gets the member list', runs[4] && runs[4].buttons > 0);
  ok('BOONCHU_CHAT_ID still gets the member list', runs[5] && runs[5].buttons > 0);
  ok('a stranger pressing Start still gets the Russia sign-up', runs[6] && runs[6].messages === 1);
  const noAdmin = await botRun([[7005, '/export']], { BOONCHU_CHAT_ID: '' });
  ok('/export gives nothing to anyone while BOONCHU_CHAT_ID is unset', noAdmin.length === 1 && noAdmin[0].messages === 0, JSON.stringify(noAdmin.map(r => r.messages)));

  await pool.query(`DELETE FROM journal_entries WHERE student_id = ANY($1::int[])`, [ids]);
  await pool.query(`DELETE FROM students WHERE name LIKE 'Locktest %'`);
  console.log(`\n${PASS} passed, ${FAIL} failed`);
  stop(FAIL ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e.message); process.exit(1); });
