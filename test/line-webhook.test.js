// The main LINE OA webhook (POST /line/webhook in server.js) acts only on what LINE signed.
// Runs the real server.js on a local port with no database. Neo4j and LINE's push API are
// stand-ins that report each LineAccount write and each push as one '@@' line; nothing
// leaves this machine. Made-up user and group ids and made-up chat text only.
const crypto = require('crypto');
const http = require('http');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SECRET = 'line-webhook-test-secret';

let PASS = 0, FAIL = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name} ${extra}`); }
};
const wait = ms => new Promise(r => setTimeout(r, ms));

const PRELOAD = `
const neo4j = require('neo4j-driver');
const report = o => process.stdout.write('@@' + JSON.stringify(o) + '\\n');
const rec = { get: k => k === 'teachers' ? [] : neo4j.int(0) };
const run = async (q, p = {}) => {
  if (/LineAccount/.test(q) && /\\b(MERGE|SET)\\b/.test(q)) report({ write: 'LineAccount', uid: p.uid });
  return { records: /RETURN\\s+count\\(/i.test(q) ? [rec] : [] };
};
const session = () => ({ run, close: async () => {} });
neo4j.driver = () => ({ session, close: async () => {}, verifyConnectivity: async () => {} });
const localFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  const u = String((url && url.url) || url);
  if (/^http:\\/\\/127\\.0\\.0\\.1[:/]/.test(u)) return localFetch(url, opts);
  if (u.startsWith('https://api.line.me/')) {
    let body = {};
    try { body = JSON.parse(opts.body || '{}'); } catch {}
    report({ push: u.slice('https://api.line.me'.length), to: body.to });
  }
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
};
require(process.env.LINE_TEST_SERVER);
`;

const freePort = () => new Promise(res => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

function startServer(secret) {
  return freePort().then(port => {
    const env = { ...process.env, PORT: String(port), MISSION_CONTROL_PORT: String(port),
      LINE_TEST_SERVER: path.join(ROOT, 'server.js'), NEO4J_URI: 'bolt://127.0.0.1:9',
      LINE_CHANNEL_SECRET: secret, LINE_CHANNEL_ACCESS_TOKEN: 'line-webhook-test-token',
      UPLOAD_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'line-uploads-')),
      PRIVATE_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'line-private-')),
      EXAM_BACKUP_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'line-exam-')),
      // Empty, not deleted: server.js runs dotenv, which fills in a missing key from a developer's .env.
      DATABASE_URL: '', BKK_ADMIN_KEY: 'line-webhook-test-key', MAIL_DRY_RUN: '1', BKK_TIMERS: 'off',
      TELEGRAM_BOT_TOKEN: '', BOONCHU_CHAT_ID: '', TELEGRAM_API_BASE: 'http://127.0.0.1:9',
      PAYSO_MERCHANT_ID: '', PAYSO_SECRET_KEY: '', PAYSO_API_KEY: '' };
    for (const k of ['SHOP_ADMIN_KEY', 'RAILWAY_ENVIRONMENT', 'RUN_BOT', 'ENABLE_TUNNEL', 'NOTION_API_KEY',
      'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'HELPDESK_LINE_ACCESS_TOKEN', 'HELPDESK_LINE_CHANNEL_SECRET',
      'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'META_APP_SECRET', 'INBOX_KEY']) delete env[k];
    const child = spawn(process.execPath, ['-e', PRELOAD], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const srv = { port, child, log: '', reports: [] };
    // The stand-ins' '@@' lines are reports, not the server's log.
    let pending = '';
    child.stdout.on('data', d => {
      pending += d;
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const l of lines) {
        if (l.startsWith('@@')) srv.reports.push(JSON.parse(l.slice(2)));
        else srv.log += l + '\n';
      }
    });
    child.stderr.on('data', d => { srv.log += d; });
    return srv;
  });
}

function request(srv, method, p, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.port, method, path: p,
      headers: { ...headers, ...(body != null ? { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) } : {}) } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (body != null) r.write(body);
    r.end();
  });
}

async function up(srv) {
  for (let i = 0; ; i++) {
    try { if ((await request(srv, 'GET', '/line/webhook')).status === 200) return true; } catch {}
    if (i > 120 || srv.child.exitCode !== null) { console.error('server did not start:\n' + srv.log.slice(-4000)); return false; }
    await wait(250);
  }
}

const sign = (body, secret = SECRET) => crypto.createHmac('sha256', secret).update(body).digest('base64');
const payload = events => JSON.stringify({ destination: 'Utest0destination', events });
// Each webhook call, then a moment for the stand-ins' lines to arrive.
async function hook(srv, body, sig) {
  const before = srv.reports.length;
  const r = await request(srv, 'POST', '/line/webhook', sig === undefined ? {} : { 'X-Line-Signature': sig }, body);
  await wait(150);
  return { status: r.status, reports: srv.reports.slice(before) };
}

const at = Date.now();
const follow = uid => ({ type: 'follow', timestamp: at, replyToken: 'r-follow', mode: 'active', source: { type: 'user', userId: uid } });
const unfollow = uid => ({ type: 'unfollow', timestamp: at, mode: 'active', source: { type: 'user', userId: uid } });
const text = (id, source, words) => ({ type: 'message', timestamp: at, replyToken: 'r-' + id, mode: 'active', source,
  message: { id, type: 'text', text: words } });

const GROUP_WORDS = 'Linetest group words about a made-up student';
const ROOM_WORDS = 'Linetest room words about a made-up booking';
const DM_WORDS = 'Linetest one to one words';
const UNSIGNED_WORDS = 'Linetest words nobody signed';
const IDS = ['Utest0follower1', 'Utest0staff1', 'Ctest0group1', 'Rtest0room1', 'Utest0dm1', 'Utest0forger1'];

(async () => {
  const srv = await startServer(SECRET);
  const stop = code => { srv.child.kill('SIGKILL'); process.exit(code); };
  if (!await up(srv)) stop(1);

  console.log('\n— LINE checks the URL: GET stays open —');
  const get = await request(srv, 'GET', '/line/webhook');
  ok('GET /line/webhook → 200 ok', get.status === 200 && get.text === 'ok');

  console.log('\n— unsigned or badly signed: 401 and nothing happens —');
  ok('an unsigned empty event list → 401', (await hook(srv, '{"events":[]}')).status === 401);
  const forgedFollow = payload([follow('Utest0forger1')]);
  const cases = [
    ['an unsigned follow', forgedFollow, undefined],
    ['a follow with an empty signature', forgedFollow, ''],
    ['a follow signed with the wrong secret', forgedFollow, sign(forgedFollow, 'not-the-secret')],
    ['a follow signed for other bytes', forgedFollow, sign(payload([follow('Utest0someone')]))],
    ['an unsigned unfollow', payload([unfollow('Utest0forger1')]), undefined],
    ['an unsigned group message', payload([text('u1', { type: 'group', groupId: 'Ctest0group1', userId: 'Utest0staff1' }, UNSIGNED_WORDS)]), undefined],
  ];
  for (const [name, body, sig] of cases) {
    const r = await hook(srv, body, sig);
    ok(`${name} → 401, no LineAccount write, no push`, r.status === 401 && r.reports.length === 0,
      `${r.status} ${JSON.stringify(r.reports)}`);
  }
  ok('...each refusal is logged as one line', (srv.log.match(/\[LINE Webhook\] refused: bad or missing signature/g) || []).length === cases.length + 1);

  console.log('\n— signed by LINE: handled as before —');
  const f = await hook(srv, payload([follow('Utest0follower1')]), sign(payload([follow('Utest0follower1')])));
  ok('a signed follow → 200', f.status === 200, String(f.status));
  ok('...writes that LineAccount', f.reports.some(x => x.write === 'LineAccount' && x.uid === 'Utest0follower1'), JSON.stringify(f.reports));
  ok('...and pushes the claim code to that user only', f.reports.filter(x => x.push).length === 1
    && f.reports.some(x => x.push === '/v2/bot/message/push' && x.to === 'Utest0follower1'), JSON.stringify(f.reports));
  const u = await hook(srv, payload([unfollow('Utest0follower1')]), sign(payload([unfollow('Utest0follower1')])));
  ok('a signed unfollow → 200 and marks that LineAccount', u.status === 200
    && u.reports.length === 1 && u.reports[0].write === 'LineAccount' && u.reports[0].uid === 'Utest0follower1', JSON.stringify(u.reports));

  console.log('\n— chats never reach the log —');
  const chats = payload([
    text('g1', { type: 'group', groupId: 'Ctest0group1', userId: 'Utest0staff1' }, GROUP_WORDS),
    text('r1', { type: 'room', roomId: 'Rtest0room1', userId: 'Utest0staff1' }, ROOM_WORDS),
    text('d1', { type: 'user', userId: 'Utest0dm1' }, DM_WORDS),
    { type: 'join', timestamp: at, replyToken: 'r-join', mode: 'active', source: { type: 'group', groupId: 'Ctest0group1' } },
  ]);
  const c = await hook(srv, chats, sign(chats));
  ok('signed group, room and 1:1 messages → 200, no write, no push', c.status === 200 && c.reports.length === 0, JSON.stringify(c.reports));
  const said = [GROUP_WORDS, ROOM_WORDS, DM_WORDS, UNSIGNED_WORDS].filter(w => srv.log.includes(w));
  ok('no chat text in the log, signed or not', said.length === 0, `${said.length} found`);
  const ids = IDS.filter(id => srv.log.includes(id));
  ok('no user, group or room id in the log', ids.length === 0, `${ids.length} found`);
  ok('the log names event and source types', srv.log.includes('[LINE Webhook] message/group message/room message/user join/group'));
  srv.child.kill('SIGKILL');

  console.log('\n— LINE_CHANNEL_SECRET not set: everything refused, and the log says why —');
  const bare = await startServer('');
  if (!await up(bare)) { bare.child.kill('SIGKILL'); stop(1); }
  const b = await hook(bare, payload([follow('Utest0follower1')]), sign(payload([follow('Utest0follower1')]), ''));
  ok('a follow → 401, no write, no push', b.status === 401 && b.reports.length === 0, `${b.status} ${JSON.stringify(b.reports)}`);
  ok('...and the log names the missing setting', bare.log.includes('[LINE Webhook] refused: LINE_CHANNEL_SECRET is not set'));
  bare.child.kill('SIGKILL');

  console.log(`\n${PASS} passed, ${FAIL} failed`);
  stop(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
