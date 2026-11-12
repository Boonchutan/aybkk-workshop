// Student lists and counts need the staff key (X-Bkk-Key = BKK_ADMIN_KEY).
// Runs the real server.js on a local port against a throwaway Postgres, with Neo4j
// replaced by an empty stand-in. Made-up students only. A failure prints the status
// and the top-level keys, never a body: some locked routes read the committed roster.
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
  ok('a name shared by two students lists nobody without the key', twins.status === 409 && !/locktest|\/j\//i.test(twins.text), `${twins.status}`);
  const twinsStaff = await request('GET', '/j/locktest-twin', STAFF);
  ok('...staff get the list', twinsStaff.status === 409 && (twinsStaff.text.match(/\/j\//g) || []).length === 2, `${twinsStaff.status}`);

  await pool.query(`DELETE FROM journal_entries WHERE student_id = ANY($1::int[])`, [ids]);
  await pool.query(`DELETE FROM students WHERE name LIKE 'Locktest %'`);
  console.log(`\n${PASS} passed, ${FAIL} failed`);
  stop(FAIL ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e.message); process.exit(1); });
