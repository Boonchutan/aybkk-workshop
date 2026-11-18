// End-to-end test of the AYBKK help desk (team-brief.js) and the mat tick
// (bkk-api.js) against a real Postgres. LINE is a stub: nothing leaves this machine.
// Every name here is made up.
process.env.BKK_ADMIN_KEY = 'testkey';
process.env.MAIL_DRY_RUN = '1';
process.env.BKK_TIMERS = 'off';   // the payment watch runs only when a test calls it
process.env.HELPDESK_LINE_CHANNEL_SECRET = 'desk-secret';
process.env.HELPDESK_LINE_ACCESS_TOKEN = 'desk-token';
delete process.env.TELEGRAM_BOT_TOKEN;
process.env.TELEGRAM_API_BASE = 'http://127.0.0.1:9';
delete process.env.ANTHROPIC_API_KEY;
const crypto = require('crypto');
const express = require('express');
const { Pool } = require('pg');
const { mountBkk } = require('../bkk-api.js');
const { mountInbox } = require('../inbox.js');
const { mountTeam, HELPDESK_PATH_RE, shortName, splitText } = require('../team-brief.js');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ||
  'postgres://test:test@127.0.0.1:5432/teamtest' });

let PASS = 0, FAIL = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name} ${extra}`); }
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const bkkAt = s => Date.parse(s + '+07:00');

// ── LINE stub ───────────────────────────────────────────────────────────────
const lineCalls = [];
let lineMode = 'ok', reqN = 0;
const lineFetch = async (url, o = {}) => {
  const u = new URL(url);
  if (u.hostname !== 'api.line.me') throw new Error('test: only api.line.me is stubbed, not ' + url);
  lineCalls.push({ path: u.pathname, method: o.method || 'GET', headers: o.headers || {}, body: o.body ? JSON.parse(o.body) : null });
  if ((o.headers || {}).Authorization === 'Bearer refused-token') return Response.json({ message: 'Authentication failed' }, { status: 401 });
  if (u.pathname === '/v2/bot/info') return Response.json({ userId: 'Udesk', basicId: '@000desk', displayName: 'AYBKK help desk' });
  if (u.pathname.endsWith('/members/count')) return Response.json({ count: u.pathname.split('/')[4] === 'Cmanage' ? 7 : 3 });
  if (u.pathname.endsWith('/summary')) {
    const id = u.pathname.split('/')[4];
    return Response.json({ groupId: id, groupName: id === 'Cteam1' ? 'AYBKK teachers' : `Other ${id.slice(1)}` });
  }
  if (/^\/v2\/bot\/group\/[^/]+\/leave$/.test(u.pathname)) return new Response('{}', { status: 200 });
  if (u.pathname === '/v2/bot/message/quota') return Response.json({ type: 'limited', value: 300 });
  if (u.pathname === '/v2/bot/message/quota/consumption') return Response.json({ totalUsage: 42 });
  if (u.pathname === '/v2/bot/message/push') {
    if (lineMode === 'down') throw new TypeError('fetch failed');
    if (lineMode === '500') return Response.json({ message: 'Internal error' }, { status: 500 });
    if (lineMode === '400') return Response.json({ message: 'The request body has 1 error(s)' }, { status: 400 });
    return new Response('{}', { status: 200, headers: { 'x-line-request-id': `req-${++reqN}` } });
  }
  return new Response('{}', { status: 404 });
};
const pushes = () => lineCalls.filter(c => c.path === '/v2/bot/message/push');

// Signed like Cloudinary's private photos: an https URL with the size in it.
const cloudUrl = (id, o) => `https://res.cloudinary.com/demo/image/authenticated/s--sig--/w_${o.transformation[0].width},f_${o.transformation[0].fetch_format}/${id}`;
const fakeCloud = { url: cloudUrl, uploader: { upload: async () => ({}), destroy: async () => ({}) } };

// Neo4j stand-in: two practice journal entries for one member on 10 Nov.
const journalAsks = [];
const fakeDriver = { session: () => ({
  run: async (cypher, p) => {
    journalAsks.push(p);
    return { records: p.to.startsWith('2026-11-10') ? [{ get: k => ({ id: 'bkk-anna', n: { toNumber: () => 2 } })[k] }] : [] };
  },
  close: async () => {},
}) };

(async () => {
  let clock = bkkAt('2026-11-10T04:00:00');
  const told = [];
  const app = express();
  // As in server.js: the help desk webhook is left out of the JSON parser.
  const jsonBody = express.json();
  app.use((req, res, next) => HELPDESK_PATH_RE.test(req.path) ? next() : jsonBody(req, res, next));
  // Wait for its schema, not a guess: on a slow run the seeds below wrote bkk_members.source before it existed.
  await mountBkk(app, { pgPool: pool, cloudinary: fakeCloud });
  mountInbox(app, { pgPool: pool, ai: null, notify: async () => true });
  const team = mountTeam(app, { pgPool: pool, cloudinary: fakeCloud, fetch: lineFetch, driver: fakeDriver,
    now: () => clock, notify: async t => { told.push(t); return true; } });
  await wait(1800);
  const srv = app.listen(0);
  const B = `http://127.0.0.1:${srv.address().port}`;
  const J = async (path, opts) => {
    const r = await fetch(B + path, opts);
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const ADMIN = { 'x-bkk-key': 'testkey' };
  const post = (p, body, headers = ADMIN) => J(p, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const get = (p, headers = ADMIN) => J(p, { headers });
  const hook = (events, secret = 'desk-secret') => {
    const body = JSON.stringify({ destination: 'Udesk', events });
    const sig = crypto.createHmac('sha256', secret).update(body).digest('base64');
    return fetch(B + '/line/helpdesk-webhook', { method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Line-Signature': sig }, body });
  };
  const join = (groupId, ts) => ({ type: 'join', timestamp: ts, source: { type: 'group', groupId }, webhookEventId: 'e' + Math.random() });
  const leave = (groupId, ts) => ({ type: 'leave', timestamp: ts, source: { type: 'group', groupId } });
  const setting = async k => ((await pool.query('SELECT value FROM bkk_settings WHERE key=$1', [k])).rows[0] || {}).value;

  console.log('\n# small helpers');
  ok('names are first names and the family initial', shortName('Anna Maria Bell') === 'Anna Maria B.' && shortName('Mai') === 'Mai'
     && shortName('สมชาย ใจดี') === 'สมชาย จ.', [shortName('Anna Maria Bell'), shortName('สมชาย ใจดี')].join(' | '));
  ok('...written as stored: the same script and case, never transliterated', shortName('mai tran') === 'mai t.'
     && shortName('Анна Белова') === 'Анна Б.', [shortName('mai tran'), shortName('Анна Белова')].join(' | '));
  ok('a name never carries an email or a phone number', shortName('Bo bo@example.com 0812345678 Chan') === 'Bo C.', shortName('Bo bo@example.com 0812345678 Chan'));
  ok('...not even one typed in short groups, with a +, or a code-like word', shortName('Lee 08 12 34 56 78') === 'Lee'
     && shortName('Kim +66 81 234 5678') === 'Kim' && shortName('B1B19BKGPI3QYA Anna') === 'Anna',
     [shortName('Lee 08 12 34 56 78'), shortName('Kim +66 81 234 5678'), shortName('B1B19BKGPI3QYA Anna')].join(' | '));
  const parts = splitText(Array.from({ length: 300 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n'));
  ok('text over 5,000 characters is split at line ends', parts.length === 3 && parts.every(p => p.length <= 5000)
     && parts.join('\n').split('\n').length === 300, parts.map(p => p.length).join(','));

  console.log('\n# webhook');
  delete process.env.HELPDESK_LINE_CHANNEL_SECRET;
  ok('with no channel secret the webhook answers 503', (await hook([join('Cnone')])).status === 503);
  process.env.HELPDESK_LINE_CHANNEL_SECRET = 'desk-secret';
  const forged = await hook([join('Cforged')], 'wrong-secret');
  ok('a bad signature is refused and saves nothing', forged.status === 401 && (await setting('team_line_group')) == null);
  const noSig = await fetch(B + '/line/helpdesk-webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: [join('Cnosig')] }) });
  ok('no signature at all is refused too', noSig.status === 401 && (await setting('team_line_group')) == null);
  ok('LINE\'s Verify button (no events) gets 200', (await hook([])).status === 200);

  const j1 = await hook([join('Cteam1', bkkAt('2026-11-07T09:00:00'))]);
  ok('a join in a group saves the group', j1.status === 200 && (await setting('team_line_group')) === 'Cteam1', JSON.stringify(await setting('team_line_group')));
  const seen = await setting('team_line_groups');
  ok('...with the group name and join time in the list of groups seen', Array.isArray(seen) && seen.length === 1
     && seen[0].name === 'AYBKK teachers' && seen[0].joinedAt === '2026-11-07T02:00:00.000Z', JSON.stringify(seen));
  ok('...and Boonchu is told where the briefs go now', told.length === 1 && /AYBKK teachers/.test(told[0]), JSON.stringify(told));

  const logs = [], logIt = console.log, warnIt = console.warn, errIt = console.error;
  console.log = console.warn = console.error = (...a) => logs.push(a.join(' '));
  const said = await hook([
    { type: 'message', timestamp: Date.now(), source: { type: 'group', groupId: 'Cteam1', userId: 'Uteacher' },
      replyToken: 'r1', message: { id: 'm1', type: 'text', text: 'SECRET GROUP WORDS 4471' } },
    { type: 'message', timestamp: Date.now(), source: { type: 'user', userId: 'Ustranger' },
      replyToken: 'r2', message: { id: 'm2', type: 'text', text: 'SECRET DM WORDS 9902' } },
    { type: 'follow', timestamp: Date.now(), source: { type: 'user', userId: 'Ustranger' } },
  ]);
  console.log = logIt; console.warn = warnIt; console.error = errIt;
  const everywhere = (await pool.query(`SELECT
      (SELECT count(*) FROM bkk_settings WHERE value::text ~ 'SECRET')::int
    + (SELECT count(*) FROM aybkk_inbox WHERE text ~ 'SECRET')::int AS n`)).rows[0].n;
  ok('message text from a group or a 1:1 chat is never stored or logged, and still gets 200', said.status === 200
     && everywhere === 0 && !logs.some(l => /SECRET/.test(l)) && (await setting('team_line_group')) === 'Cteam1',
     JSON.stringify({ everywhere, logs }));

  await hook([join('Cteam2', bkkAt('2026-11-07T10:00:00'))]);
  const seen2 = await setting('team_line_groups');
  ok('a join to a second group does not move the briefs: that group waits', (await setting('team_line_group')) === 'Cteam1'
     && seen2.find(g => g.id === 'Cteam2').pending === true && seen2.find(g => g.id === 'Cteam1').pending === false, JSON.stringify(seen2));
  ok('...and Boonchu is told the briefs still go to the team group', told.length === 2
     && /Other team2/.test(told[1]) && /still go to "AYBKK teachers"/.test(told[1]), JSON.stringify(told));
  await hook([join('Cteam1', bkkAt('2026-11-07T09:00:00'))]);
  await hook([join('Cteam2', bkkAt('2026-11-07T10:00:00'))]);
  ok('a join LINE sends again changes nothing and tells nobody twice', (await setting('team_line_group')) === 'Cteam1' && told.length === 2);
  const stW = await get('/api/bkk/admin/team/status');
  const waiting = (stW.body.groupsSeen || []).find(g => g.pending);
  ok('status lists the waiting group by a ref, never by its LINE id', stW.body.group.name === 'AYBKK teachers'
     && waiting && waiting.name === 'Other team2' && /^[0-9a-f]{12}$/.test(waiting.ref) && !waiting.saved
     && !JSON.stringify(stW.body).includes('Cteam'), JSON.stringify(stW.body.groupsSeen));
  ok('team/group needs the key', (await post('/api/bkk/admin/team/group', { accept: waiting.ref }, {})).status === 401
     && (await setting('team_line_group')) === 'Cteam1');
  ok('team/group refuses an empty body or an unknown ref', (await post('/api/bkk/admin/team/group', {})).status === 400
     && (await post('/api/bkk/admin/team/group', { accept: 'ffffffffffff' })).status === 404);
  const acc = await post('/api/bkk/admin/team/group', { accept: waiting.ref });
  ok('accepting the waiting group moves the briefs there, and Boonchu hears of it', acc.status === 200
     && (await setting('team_line_group')) === 'Cteam2' && told.length === 3 && /Other team2/.test(told[2]), JSON.stringify([acc, told.at(-1)]));
  await hook([leave('Cteam1', bkkAt('2026-11-07T10:30:00'))]);
  ok('leaving a group that is not the saved one changes nothing', (await setting('team_line_group')) === 'Cteam2');
  await hook([leave('Cteam2', bkkAt('2026-11-07T11:00:00'))]);
  const afterLeave = await setting('team_line_groups');
  ok('leaving the saved group clears it', (await setting('team_line_group')) == null
     && afterLeave.find(g => g.id === 'Cteam2').leftAt === '2026-11-07T04:00:00.000Z', JSON.stringify(afterLeave));
  ok('a group the help desk has left cannot be accepted', (await post('/api/bkk/admin/team/group', { accept: waiting.ref })).status === 409
     && (await setting('team_line_group')) == null);

  console.log('\n# admin routes need the key');
  for (const [m, p] of [['GET', '/api/bkk/admin/team/status'], ['GET', '/api/bkk/admin/team/preview?kind=morning'],
    ['POST', '/api/bkk/admin/team/send'], ['POST', '/api/bkk/admin/team/brief'], ['POST', '/api/bkk/admin/team/group'],
    ['GET', '/api/bkk/admin/inbox']]) {
    const none = m === 'GET' ? await get(p, {}) : await post(p, { text: 'x', kind: 'morning' }, {});
    const wrong = m === 'GET' ? await get(p, { 'x-bkk-key': 'nope' }) : await post(p, { text: 'x', kind: 'morning' }, { 'x-bkk-key': 'nope' });
    ok(`${m} ${p.split('?')[0]} is 401 without the key, or with a wrong one`, none.status === 401 && wrong.status === 401);
  }
  ok('nothing went to LINE from those', pushes().length === 0);

  console.log('\n# send');
  delete process.env.HELPDESK_LINE_ACCESS_TOKEN;
  const noTok = await post('/api/bkk/admin/team/send', { text: 'Hello team' });
  ok('send with no token gives a clear error', noTok.status === 503 && /HELPDESK_LINE_ACCESS_TOKEN is not set/.test(noTok.body.error), JSON.stringify(noTok));
  process.env.HELPDESK_LINE_ACCESS_TOKEN = 'desk-token';
  const noGroup = await post('/api/bkk/admin/team/send', { text: 'Hello team' });
  ok('send with no group gives a clear error', noGroup.status === 409 && /No team group yet/.test(noGroup.body.error), JSON.stringify(noGroup));
  ok('...and neither reached LINE', pushes().length === 0);
  ok('an empty text is refused', (await post('/api/bkk/admin/team/send', { text: '  ' })).status === 400);

  await hook([join('Cteam1', bkkAt('2026-11-07T12:00:00'))]);
  ok('with no group saved, the next join is saved again', (await setting('team_line_group')) === 'Cteam1');
  await hook([join('Cstranger', bkkAt('2026-11-07T12:30:00'))]);
  ok('(someone adds the help desk to a group of their own: it waits)', (await setting('team_line_group')) === 'Cteam1');
  const sent = await post('/api/bkk/admin/team/send', { text: 'ประชุมครู 10:00 วันเสาร์' });
  const p1 = pushes().at(-1);
  ok('send pushes one text to the saved group with the help desk token', sent.status === 200 && sent.body.ok === true
     && sent.body.requestId === `req-${reqN}` && p1.headers.Authorization === 'Bearer desk-token' && p1.method === 'POST'
     && JSON.stringify(p1.body) === JSON.stringify({ to: 'Cteam1', messages: [{ type: 'text', text: 'ประชุมครู 10:00 วันเสาร์' }] })
     && /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(p1.headers['X-Line-Retry-Key']),
     JSON.stringify([sent, p1]));
  ok('...never to a group that is only waiting', !pushes().some(x => x.body.to === 'Cstranger'));
  const stranger = (await get('/api/bkk/admin/team/status')).body.groupsSeen.find(g => g.name === 'Other stranger');
  const gone = await post('/api/bkk/admin/team/group', { leave: stranger.ref });
  const st2 = (await get('/api/bkk/admin/team/status')).body;
  ok('team/group can make the help desk leave a waiting group', gone.status === 200 && gone.body.saved === true
     && lineCalls.some(c => c.method === 'POST' && c.path === '/v2/bot/group/Cstranger/leave')
     && st2.groupsSeen.find(g => g.name === 'Other stranger').leftAt && !st2.groupsSeen.some(g => g.pending)
     && (await setting('team_line_group')) === 'Cteam1', JSON.stringify([gone, st2.groupsSeen]));
  const long = Array.from({ length: 400 }, (_, i) => `บรรทัด ${i} ${'ก'.repeat(20)}`).join('\n');
  const before = pushes().length;
  const sentLong = await post('/api/bkk/admin/team/send', { text: long });
  const pl = pushes().at(-1);
  ok('a long text goes as several text messages in one push, none over 5,000 characters', sentLong.status === 200
     && pushes().length === before + 1 && pl.body.messages.length === 3 && pl.body.messages.every(m => m.type === 'text' && m.text.length <= 5000),
     JSON.stringify(pl && pl.body.messages.map(m => m.text.length)));
  ok('a text over 25,000 characters is refused', (await post('/api/bkk/admin/team/send', { text: 'x'.repeat(25001) })).status === 400);
  const pushesNow = pushes().length;
  const six = await post('/api/bkk/admin/team/send', { text: Array.from({ length: 6 }, () => 'ก'.repeat(2600)).join('\n') });
  ok('a text that needs more than 5 LINE messages is refused, so one approved message is one push', six.status === 400
     && /too long for one LINE post/.test(six.body.error) && pushes().length === pushesNow, JSON.stringify(six.body));
  lineMode = '400';
  const bad = await post('/api/bkk/admin/team/send', { text: 'Hello' });
  lineMode = 'ok';
  ok('a LINE refusal comes back as a clear error, not a crash', bad.status === 502 && /LINE answered 400: The request body/.test(bad.body.error), JSON.stringify(bad));
  const sendHelper = await team.send([{ type: 'image', originalContentUrl: 'http://not-safe/x.jpg', previewImageUrl: 'https://ok/x.jpg' }]);
  ok('teamSend refuses an image that is not https', sendHelper.ok === false && sendHelper.status === 400, JSON.stringify(sendHelper));

  console.log('\n# settings');
  const st0 = await post('/api/bkk/admin/settings', {});
  ok('briefs are off by default, in Thai', st0.body.teamBrief && st0.body.teamBrief.morning === 'off'
     && st0.body.teamBrief.evening === 'off' && st0.body.teamBrief.lang === 'th', JSON.stringify(st0.body));
  ok('a wrong value is refused', (await post('/api/bkk/admin/settings', { teamBriefLang: 'fr' })).status === 400
     && (await post('/api/bkk/admin/settings', { teamBriefMorning: 'yes' })).status === 400);
  const st1 = await post('/api/bkk/admin/settings', { teamBriefMorning: 'on' });
  ok('the admin settings route switches a brief on', st1.status === 200 && st1.body.teamBrief.morning === 'on' && st1.body.teamBrief.evening === 'off');

  // ── made-up shala data around Tuesday 10 Nov 2026 ─────────────────────────
  const prod = async code => (await pool.query('SELECT id FROM bkk_products WHERE code=$1', [code])).rows[0].id;
  const slot = async code => (await pool.query('SELECT * FROM bkk_class_slots WHERE code=$1', [code])).rows[0];
  let n = 0;
  const member = async (name, o = {}) => (await pool.query(
    `INSERT INTO bkk_members (code,name,email,phone,source,joined_on,journal_id,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,coalesce($8::timestamptz, now())) RETURNING id`,
    [`BTEAM${++n}X`, name, o.email || `team.${n}@example.com`, o.phone || `0899000${String(n).padStart(3, '0')}`,
      o.source || null, o.joined || null, o.journal || null, o.created || null])).rows[0].id;
  const pass = async (mid, code, o = {}) => {
    const pr = (await pool.query('SELECT * FROM bkk_products WHERE code=$1', [code])).rows[0];
    return (await pool.query(
      `INSERT INTO bkk_passes (member_id,product_id,kind,credits_total,credits_used,daily_cap,valid_days,valid_from,valid_until,status,created_at,source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11::timestamptz, now()),$12) RETURNING id`,
      [mid, pr.id, pr.kind, pr.credits, o.used || 0, pr.daily_cap, pr.valid_days, o.from || null, o.until || null,
        o.status || 'active', o.created || null, o.source || null])).rows[0].id;
  };
  const seat = async (mid, code, date, o = {}) => {
    const s = await slot(code);
    return (await pool.query(
      `INSERT INTO bkk_bookings (slot_id,class_date,start_at,member_id,pass_id,status,cover,source,need_mat,checked_in_at,booked_at,cancelled_at,cancel_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11::timestamptz, now()),$12,$13) RETURNING id`,
      [s.id, date, `${date}T${s.start_time}:00+07:00`, mid, o.pass || null, o.status || 'booked', o.cover || 'pass',
        o.source || 'student', !!o.mat, o.in || null, o.booked || null, o.cancelled || null, o.reason || null])).rows[0].id;
  };
  const order = async (mid, code, o = {}) => (await pool.query(
    `INSERT INTO bkk_orders (refno,product_id,member_id,base_thb,fee_thb,vat_thb,amount_thb,status,method,created_at,verified_at,source)
     VALUES ($1,$2,$3,$4,0,$5,$6,$7,$8,$9,$10,$11) RETURNING refno`,
    [o.refno, await prod(code), mid, o.base || o.amount, o.vat || 0, o.amount, o.status || 'paid', o.method || 'online',
      o.created, o.verified || null, o.source || null])).rows[0].refno;
  const D = '2026-11-10';

  const anna = await member('Anna Bell', { journal: 'bkk-anna' });
  const annaPass = await pass(anna, 'unlim3', { from: '2026-08-16', until: '2026-11-14', created: '2026-08-16T08:00:00+07:00' });
  await seat(anna, 'my530_3', '2026-11-04', { pass: annaPass, in: '2026-11-04T05:31:00+07:00' });
  await seat(anna, 'my530_2', D, { pass: annaPass, mat: true, in: '2026-11-10T05:28:00+07:00' });

  const chai = await member('Chai Deeprom');
  const chaiPass = await pass(chai, 'unlim1', { from: D, until: '2026-12-10', created: '2026-11-08T19:00:00+07:00' });
  await seat(chai, 'my730_2', D, { pass: chaiPass, in: '2026-11-10T07:29:00+07:00', booked: '2026-11-10T04:30:00+07:00' });

  const mali = await member('Mali Srisuk');
  await pass(mali, 'unlim1', { created: '2026-11-06T12:00:00+07:00' });

  const ploy = await member('Ploy Wong');
  const ployPass = await pass(ploy, 'pack8', { from: '2026-11-01', until: '2026-12-01', used: 7, created: '2026-11-01T08:00:00+07:00' });
  await seat(ploy, 'my530_5', '2026-11-06', { pass: ployPass, in: '2026-11-06T05:30:00+07:00' });

  const tom = await member('Tom Hart');
  const tomOld = await pass(tom, 'unlim1', { from: '2026-10-01', until: '2026-10-31', created: '2026-10-01T08:00:00+07:00' });
  await seat(tom, 'my_sun_0', '2026-11-01', { pass: tomOld, in: '2026-11-01T05:30:00+07:00', cover: 'rezerv' });
  const tomVoid = await pass(tom, 'unlim1', { from: '2026-11-02', until: '2026-12-02', status: 'void', created: '2026-11-02T08:00:00+07:00' });
  await seat(tom, 'my530_2', D, { pass: tomVoid });

  const rex = await member('Rex Rezerv', { source: 'rezerv', joined: '2025-01-05' });
  await seat(rex, 'my530_2', D, { cover: 'rezerv', in: '2026-11-10T05:35:00+07:00' });

  const kim = await member('Kim Lee');
  const kimRef = await order(kim, 'unlim3', { refno: 990000000001, amount: 26412, status: 'pending', created: '2026-11-09T21:15:00+07:00' });
  const sam = await member('Sam Old');
  await order(sam, 'unlim3', { refno: 990000000002, amount: 26412, status: 'pending', created: '2026-11-05T10:00:00+07:00' });
  const nina = await member('Nina Paid');
  await order(nina, 'unlim1', { refno: 990000000003, amount: 10580, status: 'pending', created: '2026-11-09T08:00:00+07:00' });
  await order(nina, 'unlim1', { refno: 990000000004, amount: 10580, status: 'paid', created: '2026-11-09T08:05:00+07:00', verified: '2026-11-09T08:06:00+07:00' });

  const zoe = await member('Zoe Renewed');
  await pass(zoe, 'unlim1', { from: '2026-10-13', until: '2026-11-12', created: '2026-10-13T08:00:00+07:00' });
  await pass(zoe, 'unlim3', { from: '2026-11-13', until: '2027-02-11', created: '2026-11-05T08:00:00+07:00' });
  await seat(zoe, 'my730_3', '2026-11-04', { in: '2026-11-04T07:30:00+07:00' });
  const gus = await member('Gus Gone');
  await pass(gus, 'unlim1', { from: '2026-10-14', until: '2026-11-13', created: '2026-10-14T08:00:00+07:00' });
  await seat(gus, 'my730_3', '2026-09-02', { in: '2026-09-02T07:30:00+07:00' });

  console.log('\n# morning brief (05:00 Tuesday 10 Nov)');
  const sentBefore = pushes().length;
  const m = await get(`/api/bkk/admin/team/preview?kind=morning&date=${D}`);
  const mt = m.body.text || '';
  console.log(mt.split('\n').map(l => '      | ' + l).join('\n'));
  ok('preview builds the brief and does not send it', m.status === 200 && pushes().length === sentBefore
     && m.body.kind === 'morning' && m.body.date === D && m.body.lang === 'th');
  ok('Thai by default, with the day', mt.startsWith('☀️ บรีฟเช้า อ. 10 พ.ย.'), mt.split('\n')[0]);
  ok('each shala class in time order: its own short section with the teacher, how many booked, who is new, mats',
     mt.includes('\n\n🧘 05:30 Mysore (1st batch) · ครู Boonchu\nจอง 3 คน\nสัปดาห์แรก 1: Anna B.\nเช่าเสื่อ 1 (฿200 รวม VAT จ่ายที่ชาลา): Anna B.\n\n')
     && mt.includes('\n\n🧘 07:30 Mysore (2nd batch) · ครู Boonchu\nจอง 1 คน\nมาครั้งแรกวันนี้ 1: Chai D.\n\n')
     && mt.indexOf('05:30 Mysore') < mt.indexOf('07:30 Mysore'), mt);
  ok('...the count only: the full list of names booked is gone', !mt.includes('Rex R.') && !/Tom H\.(?! จอง 05:30)/.test(mt));
  ok('BOUGHT, NOT HERE YET: a first pass bought this week by someone who has not come, under its own header',
     mt.includes('🛒 ซื้อแล้ว ยังไม่เคยมา\n• Mali S. ซื้อ 1 month unlimited เมื่อ ศ. 6 พ.ย. ยังไม่เช็กอินใน aybkk.net ยังไม่มีการจองใน aybkk.net') && !mt.includes('🌱'));
  ok('...first time and first week never a student who came before the week, or one moved over from Rezerv',
     !/(มาครั้งแรกวันนี้|สัปดาห์แรก) \d+: .*(Tom H\.|Rex R\.)/.test(mt));
  ok('ENDING SOON: a pass ending within 7 days and a credit pass with 2 or fewer classes, with the end date',
     mt.includes('⏳ ใกล้หมด ชวนคุยเรื่องต่อแพ็กเกจ\n• Anna B. 3 months unlimited หมด ส. 14 พ.ย.\n• Ploy W. 8 classes / 2 months เหลือ 1 ครั้ง ใช้ได้ถึง อ. 1 ธ.ค.'));
  ok('...not someone who already renewed, or who has not come for over 30 days', !mt.includes('Zoe R.') && !mt.includes('Gus G.'));
  ok('NOT PAID: an online order pending from the last 3 days, and a booking today with no valid pass',
     mt.includes(`💳 ยังไม่จ่าย ช่วยตามเก็บเงิน\n• Kim L. สั่ง 3 months unlimited ฿26,412 ยังไม่ได้จ่าย (สั่ง จ. 9 พ.ย., ref ${kimRef})\n• Tom H. จอง 05:30 แต่แพ็กเกจถูกยกเลิกแล้ว`));
  ok('...not an older order, one the student paid since, or a Rezerv seat', !mt.includes('Sam O.') && !mt.includes('Nina P.') && !/Rex R\. จอง/.test(mt));
  ok('MATS: in the class, ฿200 with VAT included, paid at the shala; the old day-level mat section is gone',
     mt.includes('เช่าเสื่อ 1 (฿200 รวม VAT จ่ายที่ชาลา): Anna B.') && !mt.includes('เตรียมเสื่อ') && !/฿214/.test(mt));
  ok('class and package names stay in the original English in the Thai brief', !/มายซอร์|รอบแรก|ไม่จำกัด|ครั้ง \/ 1 เดือน/.test(mt), mt);
  ok('one closing line with the shala totals', mt.trim().split('\n').at(-1)
     === 'รวม 2 คลาส · จอง 4 · ดรอปอิน 0 · ครั้งแรก 1 · สัปดาห์แรก 1 · เสื่อ 1 · ใกล้หมด 2 · ยังไม่จ่าย 2', mt.trim().split('\n').at(-1));
  ok('no online section on a day with no online class', !mt.includes('💻'));
  ok('never an email, a phone number or a member code', !/@|0899000|BTEAM/.test(mt));
  ok('no em dash anywhere', !/—/.test(mt));

  const me = await get(`/api/bkk/admin/team/preview?kind=morning&date=${D}&lang=en`);
  const met = me.body.text || '';
  ok('English when asked', met.startsWith('☀️ Teaching brief Tue 10 Nov')
     && met.includes('🧘 05:30 Mysore (1st batch) · Boonchu\n3 booked\nFirst week 1: Anna B.\nMat rental 1 (฿200 incl. VAT, paid at the shala): Anna B.')
     && met.includes('🧘 07:30 Mysore (2nd batch) · Boonchu\n1 booked\nFirst class today 1: Chai D.')
     && met.includes('🛒 Bought, not here yet\n• Mali S. bought 1 month unlimited') && met.includes('• Anna B.: 3 months unlimited, ends Sat 14 Nov')
     && met.includes('💳 Not paid, please collect\n') && met.includes('• Tom H.: booked 05:30 but the pass was voided')
     && met.trim().endsWith('Total: 2 classes · 4 booked · 0 drop-in · 1 first time · 1 first week · 1 mat · 2 ending · 2 not paid'), met);

  const sat = (await get('/api/bkk/admin/team/preview?kind=morning&date=2026-11-14')).body.text || '';
  ok('Saturday in Thai: Led class titles as on the timetable, the rotating teacher as stored, online apart (no "[Online]" under the Zoom header)',
     sat.includes('\n🧘 07:00 Led Primary series · ครู Jamsai\nจอง 0 คน\n') && sat.includes('\n🧘 08:45 Led Intermediate series · ครู Boonchu\nจอง 0 คน\n')
     && sat.includes('\n💻 ออนไลน์ (Zoom)\n07:00 Led Primary series · จอง 0\n09:00 Led Intermediate series · จอง 0\n') && !sat.includes('[Online]'), sat);

  const moon = await get('/api/bkk/admin/team/preview?kind=morning&date=2026-11-09');
  ok('moon day: one line saying the shala is closed and why, then stop',
     moon.body.text === '☀️ บรีฟเช้า จ. 9 พ.ย.\nวันนี้ชาลาปิด วันพระจันทร์ดับ (moon day)', JSON.stringify(moon.body.text));
  const moonEn = await get('/api/bkk/admin/team/preview?kind=morning&date=2026-11-24&lang=en');
  ok('...in English too (a full moon)', moonEn.body.text === '☀️ Teaching brief Tue 24 Nov\nThe shala is closed today: full moon day.', JSON.stringify(moonEn.body.text));
  for (const c of ['my530_4', 'my730_4']) {
    await pool.query(`INSERT INTO bkk_class_overrides (slot_id,class_date,cancelled,note) VALUES ($1,'2026-11-12',true,'teacher training')`, [(await slot(c)).id]);
  }
  const off = await get('/api/bkk/admin/team/preview?kind=morning&date=2026-11-12');
  ok('every class cancelled: closed, with the reason', off.body.text === '☀️ บรีฟเช้า พฤ. 12 พ.ย.\nวันนี้ชาลาปิด ยกเลิกทุกคลาส (teacher training)', JSON.stringify(off.body.text));
  ok('preview refuses a bad kind, date or language', (await get('/api/bkk/admin/team/preview?kind=noon')).status === 400
     && (await get('/api/bkk/admin/team/preview?kind=morning&date=2026-02-30')).status === 400
     && (await get('/api/bkk/admin/team/preview?kind=morning&lang=fr')).status === 400);

  // ── the evening of 10 Nov ─────────────────────────────────────────────────
  const buyer = await member('Una Buyer');
  await order(buyer, 'unlim1', { refno: 990000000011, base: 9600, vat: 692, amount: 10580, created: '2026-11-10T09:00:00+07:00', verified: '2026-11-10T09:01:00+07:00' });
  await order(buyer, 'dropin', { refno: 990000000012, base: 1500, vat: 105, amount: 1605, method: 'cash', created: '2026-11-10T07:20:00+07:00', verified: '2026-11-10T07:20:00+07:00' });
  await order(buyer, 'pack8', { refno: 990000000013, base: 7600, vat: 532, amount: 8132, method: 'transfer', created: '2026-11-10T12:00:00+07:00', verified: '2026-11-10T12:00:00+07:00' });
  await order(buyer, 'unlim1', { refno: 990000000014, amount: 10580, created: '2026-11-10T21:00:00+07:00', verified: '2026-11-10T21:00:00+07:00' });
  await order(buyer, 'unlim1', { refno: 990000000015, amount: 9600, source: 'rezerv', created: '2026-11-10T10:00:00+07:00', verified: '2026-11-10T10:00:00+07:00' });
  const late = await member('Lia Later');
  await order(late, 'unlim3', { refno: 990000000016, amount: 26412, status: 'pending', created: '2026-11-10T11:00:00+07:00' });

  await member('Lin New', { created: '2026-11-10T10:00:00+07:00' });
  await member('Ola Fresh', { created: '2026-11-10T15:00:00+07:00' });
  await member('Rita Imported', { created: '2026-11-10T16:00:00+07:00', source: 'rezerv' });
  const eve = await member('Eve End');
  const evePass = await pass(eve, 'unlim1', { from: '2026-10-11', until: D, created: '2026-10-11T08:00:00+07:00' });
  await seat(eve, 'my530_3', '2026-11-04', { pass: evePass, in: '2026-11-04T05:30:00+07:00' });
  const ray = await member('Ray Renew');
  await pass(ray, 'unlim1', { from: '2026-10-11', until: D, created: '2026-10-11T08:00:00+07:00' });
  await pass(ray, 'unlim1', { created: '2026-11-09T08:00:00+07:00' });

  // Tomorrow, Wednesday: two on the 05:30, one with a mat; one booked today, then cancelled.
  await seat(eve, 'my530_3', '2026-11-11', { booked: '2026-11-10T13:00:00+07:00', mat: true });
  await seat(ploy, 'my530_3', '2026-11-11', { pass: ployPass, booked: '2026-11-10T13:05:00+07:00' });
  await seat(zoe, 'my730_3', '2026-11-11', { status: 'cancelled', booked: '2026-11-09T13:00:00+07:00', cancelled: '2026-11-10T14:00:00+07:00' });

  const teacher = (await pool.query(`INSERT INTO bkk_teachers (name,key_hash) VALUES ('Jamsai','x') RETURNING id`)).rows[0].id;
  for (const [pid, day, tagged] of [['aybkk/profile/2026-11-10/a', '2026-11-10T08:00:00+07:00', [anna, chai]],
    ['aybkk/profile/2026-11-10/b', '2026-11-10T08:01:00+07:00', [anna]], ['aybkk/profile/2026-11-10/c', '2026-11-10T08:02:00+07:00', []],
    ['aybkk/profile/2026-11-09/old', '2026-11-09T08:00:00+07:00', [anna]]]) {
    const ph = (await pool.query(`INSERT INTO bkk_photos (public_id,class_date,uploaded_by,created_at) VALUES ($1,$2,$3,$4) RETURNING id`,
      [pid, day.slice(0, 10), teacher, day])).rows[0].id;
    for (const t of tagged) await pool.query('INSERT INTO bkk_photo_members (photo_id,member_id) VALUES ($1,$2)', [ph, t]);
  }
  await pool.query(`INSERT INTO bkk_notes (member_id,teacher_id,class_date,body,created_at) VALUES
    ($1,$3,'2026-11-10','Shoulder better','2026-11-10T08:30:00+07:00'), ($2,$3,'2026-11-10','Welcome','2026-11-10T08:40:00+07:00')`, [anna, chai, teacher]);
  await pool.query(`INSERT INTO bkk_checks (member_id,taken_on,resting_hr,created_at) VALUES ($1,'2026-11-10',58,'2026-11-10T09:00:00+07:00')`, [anna]);
  await pool.query(`INSERT INTO bkk_login_tokens (token,member_id,email,ip,expires_at,used_at,created_at) VALUES
    ('t-used',$1,'x','203.0.113.9','2026-11-17T00:00:00+07:00','2026-11-10T10:00:00+07:00','2026-11-10T09:55:00+07:00'),
    ('t-sent',$2,NULL,'staff','2026-11-17T00:00:00+07:00',NULL,'2026-11-10T11:00:00+07:00')`, [anna, tom]);
  await pool.query(`INSERT INTO bkk_newsletter (email,status,token,created_at,asked_at,confirmed_at) VALUES
    ('letter.one@example.com','confirmed','tok1','2026-11-10T06:00:00+07:00','2026-11-10T06:00:00+07:00','2026-11-10T06:10:00+07:00'),
    ('letter.two@example.com','pending','tok2','2026-11-10T07:00:00+07:00','2026-11-10T07:00:00+07:00',NULL)`);
  await pool.query(`INSERT INTO bkk_start_events (kind,src,ch,created_at) VALUES
    ('view','reel1',NULL,'2026-11-10T08:00:00+07:00'), ('view','reel1',NULL,'2026-11-10T08:01:00+07:00'), ('view','reel2',NULL,'2026-11-10T09:00:00+07:00'),
    ('tap','reel1','line','2026-11-10T08:02:00+07:00'), ('step','reel1','done-line','2026-11-10T08:03:00+07:00'),
    ('view','letter',NULL,'2026-11-10T08:00:00+07:00')`);
  const inbox = (ch, sender, at, lane, text = 'SECRET INBOX WORDS') => pool.query(
    `INSERT INTO aybkk_inbox (channel,kind,direction,ext_id,sender_id,text,sent_at,created_at,triage)
     VALUES ($1,'dm','in',$2,$3,$4,$5,$5,$6)`, [ch, `${ch}:${crypto.randomUUID()}`, sender, text, at, lane ? { lane } : null]);
  await inbox('line', 'Unew', '2026-11-10T09:00:00+07:00', 'hot');
  await inbox('line', 'Unew', '2026-11-10T09:01:00+07:00', null);
  await inbox('line', 'Uold', '2026-11-01T09:00:00+07:00', 'later');
  await inbox('line', 'Uold', '2026-11-10T12:00:00+07:00', 'later');
  await inbox('lead', 'lead@example.com', '2026-11-10T13:00:00+07:00', 'hot');
  await inbox('apply', 'apply@example.com', '2026-11-10T14:00:00+07:00', 'hot');

  console.log('\n# evening summary (20:00 Tuesday 10 Nov)');
  clock = bkkAt('2026-11-10T20:00:00');
  const e = await get(`/api/bkk/admin/team/preview?kind=evening&date=${D}`);
  const et = e.body.text || '';
  console.log(et.split('\n').map(l => '      | ' + l).join('\n'));
  ok('Thai, from 20:00 yesterday to 20:00 today', e.status === 200 && et.startsWith('🌙 สรุปวันนี้ อ. 10 พ.ย. (ตั้งแต่ 20:00 เมื่อวาน ถึง 20:00)'), et.split('\n')[0]);
  ok('money: orders paid today, the total with VAT, by product', et.includes('💰 เงิน\nจ่ายแล้ว 3 รายการ ฿20,317 (รวม VAT ฿1,329)\n'
     + '• 1 month unlimited ×1 ฿10,580\n• 8 classes / 2 months ×1 ฿8,132\n• Drop-in ×1 ฿1,605'));
  ok('...desk sales by method, online, and what is still pending (an order from 21:15 last night too)',
     et.includes('ที่เคาน์เตอร์ เงินสด 1 ฿1,605 · โอน 1 ฿8,132\nออนไลน์ 1 รายการ ฿10,580\nค้างจ่าย 2 รายการ ฿52,824'), (et.match(/ค้างจ่าย.*/) || [])[0]);
  ok('...not a payment after 20:00 or one moved over from Rezerv', !et.includes('฿9,600') && !et.includes('×2'));
  ok('students: new members, passes started, passes that ended today (renewed or not)', et.includes('👥 นักเรียน\nสมัครใหม่ 2 คน: Lin N., Ola F.\n'
     + 'เริ่มแพ็กเกจ 1 คน: Chai D. (1 month unlimited)\nแพ็กเกจหมดวันนี้ 2 คน: Eve E. (ยังไม่ต่อ), Ray R. (ต่อแล้ว)') && !et.includes('Rita'));
  ok('classes: check-ins per class with the no-shows by name', et.includes('🧘 คลาสวันนี้\n05:30 Mysore (1st batch): เช็กอิน 2/3 · ยังไม่เช็กอิน: Tom H.\n07:30 Mysore (2nd batch): เช็กอิน 1/1'));
  ok('...bookings made and cancelled today', et.includes('จองใหม่ 3 · ยกเลิก 1'), (et.match(/จองใหม่.*/) || [])[0]);
  ok('tomorrow: booked per class, with mats', et.includes('📅 พรุ่งนี้ พ. 11 พ.ย.\n05:30 Mysore (1st batch): จอง 2 · เสื่อ 1\n07:30 Mysore (2nd batch): จอง 0'));
  ok('photos: uploaded today, tagged, on how many profiles', et.includes('📷 รูปคลาส\nอัปโหลด 3 รูป · แท็กแล้ว 2 · ขึ้นโปรไฟล์ 2 คน'));
  ok('profile actions: teacher notes, 12-week checks and journal entries with names, sign-ins',
     et.includes('📝 โปรไฟล์นักเรียน\nโน้ตครู 2 (Jamsai 2)\nเช็กผล 12 สัปดาห์ 1 คน: Anna B.\nบันทึกการฝึก 2 ครั้ง (Anna B.)\nเข้าโปรไฟล์ 1 คน · ครูส่งลิงก์ 1'));
  ok('...journal entries are asked of Neo4j for exactly 20:00 yesterday to 20:00 today', journalAsks.some(p => p.from === '2026-11-09T20:00:00+07:00' && p.to === '2026-11-10T20:00:00+07:00'));
  ok('leads: letter, Start page, first-step forms, LINE chats new and hot, applications (counts only)',
     et.includes('📣 ลีด\nจดหมายวันจันทร์ ยืนยัน 1 · รอยืนยัน 1\nหน้า Start เข้าชม 3 · กดจอง 1 · ทำครบทุกขั้น 1\nฟอร์มสนใจเรียน 1\nLINE แชต 2 คน (คนใหม่ 1) · ด่วน 1\nใบสมัคร In-Depth 1'));
  ok('...and no message text from the inbox', !/SECRET/.test(et));
  ok('one closing line', et.trim().split('\n').at(-1) === 'วันนี้เงินเข้า ฿20,317 · เช็กอิน 3 · พรุ่งนี้จองแล้ว 2', et.trim().split('\n').at(-1));
  ok('never an email, a phone number or a member code; no em dash', !/@|0899000|BTEAM|—/.test(et));
  ok('...and class and package names in English, never the Thai product name', !/มายซอร์|ไม่จำกัด|ครั้งเดียว|ครั้ง \/ 1 เดือน/.test(et), et);
  const imgs = e.body.images || [];
  ok('up to 4 of today\'s photos as LINE images, tagged ones first, https JPEG sized for LINE', imgs.length === 3
     && imgs.every(i => i.original.startsWith('https://') && i.original.includes('w_1600,f_jpg') && i.preview.includes('w_480,f_jpg'))
     && imgs[0].original.endsWith('/b') && imgs[1].original.endsWith('/a') && imgs[2].original.endsWith('/c'), JSON.stringify(imgs));
  ok('...as one push: the text first, then the images', e.body.messages.length === 4 && e.body.messages[0].type === 'text'
     && e.body.messages.slice(1).every(x => x.type === 'image' && x.originalContentUrl && x.previewImageUrl));
  const en = await get(`/api/bkk/admin/team/preview?kind=evening&date=${D}&lang=en`);
  const ent = en.body.text || '';
  ok('English evening', ent.startsWith('🌙 Today on aybkk.net, Tue 10 Nov (20:00 yesterday to 20:00)') && ent.includes('Paid: 3 orders, ฿20,317 (VAT ฿1,329 included)')
     && ent.includes('At the desk: cash 1 ฿1,605 · transfer 1 ฿8,132') && ent.includes('Online: 1 order ฿10,580\nStill pending: 2 orders ฿52,824')
     && ent.includes('05:30 Mysore (1st batch): 2/3 checked in · not checked in: Tom H.')
     && ent.includes('New members (2): Lin N., Ola F.') && ent.includes('Passes started (1): Chai D. (1 month unlimited)')
     && ent.includes('Passes ended today (2): Eve E. (not renewed), Ray R. (renewed)') && ent.includes('05:30 Mysore (1st batch): 2 booked · 1 mat')
     && ent.includes('12-week checks (1): Anna B.') && ent.includes('Practice journal entries: 2 (Anna B.)')
     && ent.includes('Start page: 3 views · 1 tapped Book · 1 finished') && ent.includes('LINE chats: 2 people (1 new) · hot: 1')
     && ent.trim().endsWith('Today: ฿20,317 in · 3 checked in · 2 booked for tomorrow'), ent);
  // The door tablet's key used from another internet today (17 Nov 2026): one line under the classes.
  ok('no door tablet line on a day nobody used its key from elsewhere', !/แท็บเล็ตหน้าประตู|door tablet/i.test(et + ent));
  const dev = (await pool.query(`INSERT INTO bkk_door_devices (name, key_hash, paired_ip, last_ip, last_seen_at, other_ip_at)
    VALUES ('Front door', 'test-hash-team', '203.0.113.1', '198.51.100.7', '2026-11-10T06:00:00+07:00', '2026-11-10T06:00:00+07:00') RETURNING id`)).rows[0].id;
  const eDoor = (await get(`/api/bkk/admin/team/preview?kind=evening&date=${D}`)).body.text || '';
  const eDoorEn = (await get(`/api/bkk/admin/team/preview?kind=evening&date=${D}&lang=en`)).body.text || '';
  ok('...and one line when it was, after the bookings line, naming the tablet, never an address',
     eDoor.includes('จองใหม่ 3 · ยกเลิก 1\n⚠ แท็บเล็ตหน้าประตู (Front door) มีการใช้จากเครือข่ายอื่น ไม่ใช่ของชาลา เช็กใน Admin หน้า ตั้งค่า ช่อง แท็บเล็ตหน้าประตู')
       && eDoorEn.includes("⚠ The door tablet (Front door) was used from another internet, not the shala's. Check Admin, Settings, Door tablets.")
       && !/198\.51|203\.0/.test(eDoor + eDoorEn), (eDoor.match(/⚠.*/) || [])[0]);
  await pool.query('DELETE FROM bkk_door_devices WHERE id=$1', [dev]);
  const next = (await get('/api/bkk/admin/team/preview?kind=evening&date=2026-11-11')).body.text || '';
  ok('a payment at 21:00 is in the next evening\'s summary', next.startsWith('🌙 สรุปวันนี้ พ. 11 พ.ย. (ตั้งแต่ 20:00 เมื่อวาน ถึง 20:00)')
     && next.includes('💰 เงิน\nจ่ายแล้ว 1 รายการ ฿10,580 ') && next.includes('• 1 month unlimited ×1 ฿10,580'), next.split('\n').slice(0, 5).join(' | '));

  const appNoCloud = express();
  const plainCloud = { url: (id, o) => `http://res.cloudinary.com/demo/${id}` };
  const noImg = mountTeam(appNoCloud, { pgPool: pool, cloudinary: plainCloud, fetch: lineFetch, now: () => clock });
  const b2 = await noImg.build('evening', D, 'th');
  ok('no safe https URL for a photo: the summary goes without images', b2.images.length === 0 && b2.messages.length === 1 && b2.text.includes('อัปโหลด 3 รูป'));

  console.log('\n# the timer: exactly once per day');
  const morningPushes = () => pushes().filter(p => p.body.messages[0].text.startsWith('☀️'));
  const eveningPushes = () => pushes().filter(p => p.body.messages[0].text.startsWith('🌙'));
  clock = bkkAt('2026-11-10T04:59:00');
  ok('nothing is due at 04:59', (await team.tick(clock)).length === 0 && morningPushes().length === 0);
  clock = bkkAt('2026-11-10T05:00:00');
  const asBuilt = (await get(`/api/bkk/admin/team/preview?kind=morning&date=${D}`)).body.text;
  const [ta, tb] = await Promise.all([team.tick(clock), team.tick(clock)]);
  ok('two calls at 05:00 send the morning brief once', morningPushes().length === 1
     && [...ta, ...tb].filter(r => r.sent).length === 1 && [...ta, ...tb].filter(r => r.skipped === 'already').length === 1, JSON.stringify([ta, tb]));
  const mp = morningPushes()[0];
  ok('...to the team group, the brief as built', mp.body.to === 'Cteam1' && mp.body.messages[0].text === asBuilt && asBuilt.startsWith('☀️ บรีฟเช้า'));
  const restarted = mountTeam(express(), { pgPool: pool, cloudinary: fakeCloud, fetch: lineFetch, now: () => clock });
  clock = bkkAt('2026-11-10T05:30:00');
  ok('a restart at 05:30 does not send it again', (await restarted.tick(clock))[0].skipped === 'already' && morningPushes().length === 1);
  ok('the evening brief is off, so 20:00 sends nothing', (await team.tick(bkkAt('2026-11-10T20:00:00'))).length === 0 && eveningPushes().length === 0);
  await post('/api/bkk/admin/settings', { teamBriefEvening: 'on' });
  clock = bkkAt('2026-11-10T20:05:00');
  await team.tick(clock);
  ok('switched on, the evening summary goes at 20:05: one push, text and photos', eveningPushes().length === 1
     && eveningPushes()[0].body.messages.length === 4 && eveningPushes()[0].body.messages.filter(x => x.type === 'image').length === 3);
  await team.tick(bkkAt('2026-11-10T20:30:00'));
  ok('...and only once', eveningPushes().length === 1);

  clock = bkkAt('2026-11-11T06:30:00');
  ok('a server down until 06:30 skips that morning', (await team.tick(clock)).length === 0
     && (await team.tick(bkkAt('2026-11-11T06:31:00'))).length === 0 && morningPushes().length === 1
     && (await setting('team_brief_sent_morning_2026-11-11')) == null);
  clock = bkkAt('2026-11-12T05:45:00');
  const lateRun = await team.tick(clock);
  ok('one back at 05:45 sends it late, within the hour', lateRun.length === 1 && lateRun[0].sent && morningPushes().length === 2
     && morningPushes()[1].body.messages[0].text.includes('ยกเลิกทุกคลาส'));

  const status1 = await get('/api/bkk/admin/team/status');
  ok('status: group saved, its name and join time, briefs on, last sent times, LINE quota', status1.status === 200
     && status1.body.group.saved === true && status1.body.group.name === 'AYBKK teachers' && status1.body.group.joinedAt === '2026-11-07T05:00:00.000Z'
     && status1.body.briefs.morning === 'on' && status1.body.briefs.evening === 'on' && status1.body.briefs.lang === 'th'
     && status1.body.lastSent.morning.date === '2026-11-12' && status1.body.lastSent.evening.date === D
     && status1.body.quota.limit === 300 && status1.body.quota.used === 42 && status1.body.channel.tokenSet === true, JSON.stringify(status1.body));
  ok('...and never the token, or a group id', !JSON.stringify(status1.body).includes('desk-token') && !JSON.stringify(status1.body).includes('Cteam'));

  lineMode = 'down';
  clock = bkkAt('2026-11-13T05:00:00');
  const downRun = await team.tick(clock);
  const failedKey = pushes().at(-1).headers['X-Line-Retry-Key'];
  const marker13 = await setting('team_brief_sent_morning_2026-11-13');
  const status2 = await get('/api/bkk/admin/team/status');
  ok('LINE down: nothing crashes, the error is kept for status, and the day may try again', downRun.length === 1 && !downRun[0].sent
     && marker13.state === 'retry' && /LINE could not be reached/.test(status2.body.lastError.error), JSON.stringify([downRun, marker13, status2.body.lastError]));
  lineMode = 'ok';
  clock = bkkAt('2026-11-13T05:01:00');
  const retryRun = await team.tick(clock);
  ok('...the next minute sends it, with the same retry key so LINE never shows it twice', retryRun[0].sent
     && pushes().at(-1).headers['X-Line-Retry-Key'] === failedKey && (await setting('team_brief_sent_morning_2026-11-13')).state === 'sent');
  const countNow = pushes().length;
  await team.tick(bkkAt('2026-11-13T05:02:00'));
  ok('...and then not again', pushes().length === countNow);
  lineMode = '400';
  await team.tick(bkkAt('2026-11-14T06:00:00'));   // a Saturday: 06:00
  lineMode = 'ok';
  const after400 = pushes().length;
  await team.tick(bkkAt('2026-11-14T06:01:00'));
  ok('a LINE refusal (400) is not tried again that day', pushes().length === after400
     && (await setting('team_brief_sent_morning_2026-11-14')).state === 'failed');

  console.log('\n# a brief by hand');
  clock = bkkAt('2026-11-10T21:00:00');
  const twice = await post('/api/bkk/admin/team/brief', { kind: 'evening' });
  ok('POST brief after the timer sent it is refused, with how to post it again', twice.status === 409
     && /already sent at 20:05/.test(twice.body.error) && /force/.test(twice.body.error) && eveningPushes().length === 1, JSON.stringify(twice.body));
  const byHand = await post('/api/bkk/admin/team/brief', { kind: 'evening', force: true });
  ok('...with force it sends one brief now', byHand.status === 200 && byHand.body.ok && byHand.body.date === D && eveningPushes().length === 2);
  clock = bkkAt('2026-11-10T15:12:00');
  const early = (await get(`/api/bkk/admin/team/preview?kind=evening&date=${D}`)).body.text || '';
  ok('...and an evening summary made before 20:00 says how far the day has got', early.startsWith('🌙 สรุปวันนี้ อ. 10 พ.ย. (ตั้งแต่ 20:00 เมื่อวาน ถึง 15:12)'), early.split('\n')[0]);
  ok('...and a bad kind is refused', (await post('/api/bkk/admin/team/brief', { kind: 'lunch' })).status === 400);

  const forDay = (list, d) => list.filter(p => p.body.messages[0].text.split('\n')[0].includes(d));
  clock = bkkAt('2026-11-16T04:58:00');
  const early16 = await post('/api/bkk/admin/team/brief', { kind: 'morning' });
  clock = bkkAt('2026-11-16T05:30:00');   // a Monday: 05:30
  const tick16 = await team.tick(clock);
  ok('a morning brief sent by hand at 04:58 is the day\'s brief: 05:30 does not send another', early16.status === 200
     && tick16[0].skipped === 'already' && forDay(morningPushes(), ' 16 พ.ย.').length === 1, JSON.stringify([early16.body, tick16]));
  clock = bkkAt('2026-11-16T15:12:00');
  const sofar = await post('/api/bkk/admin/team/brief', { kind: 'evening' });
  ok('an evening summary by hand before 20:00 is "so far" and leaves the day\'s marker alone', sofar.status === 200 && sofar.body.sofar === true
     && (await setting('team_brief_sent_evening_2026-11-16')) == null);
  clock = bkkAt('2026-11-16T20:00:00');
  const eve16 = await team.tick(clock);
  ok('...so the 20:00 summary still goes', eve16.length === 1 && eve16[0].sent && forDay(eveningPushes(), ' 16 พ.ย.').length === 2);

  lineMode = 'down';
  clock = bkkAt('2026-11-17T05:00:00');
  const down17 = await team.tick(clock);
  const key17 = pushes().at(-1).headers['X-Line-Retry-Key'];
  lineMode = 'ok';
  clock = bkkAt('2026-11-17T05:01:00');
  const hand17 = await post('/api/bkk/admin/team/brief', { kind: 'morning' });
  const handKey = pushes().at(-1).headers['X-Line-Retry-Key'];
  clock = bkkAt('2026-11-17T05:02:00');
  const after17 = pushes().length;
  const tick17 = await team.tick(clock);
  ok('LINE down at 05:00, sent by hand at 05:01: the timer at 05:02 sends nothing', !down17[0].sent && hand17.status === 200
     && handKey === key17 && pushes().length === after17 && tick17[0].skipped === 'already'
     && (await setting('team_brief_sent_morning_2026-11-17')).state === 'sent'
     && forDay(morningPushes(), ' 17 พ.ย.').length === 2,   // the one tried while LINE was down, and the one by hand
     JSON.stringify([down17, hand17.body, tick17]));

  console.log('\n# the morning brief by class: Thu 19, Fri 20, Sat 21, Mon 23 Nov (made-up people)');
  const ana = await member('Ana Example', { email: 'ana.example@example.com' });
  const anaDrop = await pass(ana, 'dropin', { from: '2026-11-19', until: '2026-11-20', used: 1, created: '2026-11-18T20:00:00+07:00' });
  await seat(ana, 'my530_4', '2026-11-19', { pass: anaDrop, mat: true, in: '2026-11-19T05:29:00+07:00' });
  const anaPack = await pass(ana, 'pack8', { from: '2026-11-21', until: '2027-01-20', used: 3, created: '2026-11-19T08:00:00+07:00' });
  await seat(ana, 'lp_sat_6', '2026-11-21', { pass: anaPack, mat: true, in: '2026-11-21T06:55:00+07:00' });
  await seat(ana, 'li_sat_6', '2026-11-21', { pass: anaPack, in: '2026-11-21T08:40:00+07:00' });
  await seat(ana, 'lp_mon_1', '2026-11-23', { pass: anaPack });
  const wang = await member('王小明', { email: 'wang.xm@example.com' });
  const wangPass = await pass(wang, 'unlim1', { from: '2026-11-16', until: '2026-12-16', created: '2026-11-15T09:00:00+07:00' });
  await seat(wang, 'lp_mon_1', '2026-11-16', { pass: wangPass, in: '2026-11-16T06:31:00+07:00' });
  await seat(wang, 'my530_4', '2026-11-19', { pass: wangPass });
  await seat(wang, 'my730_4', '2026-11-19', { pass: wangPass });
  await seat(wang, 'li_sat_6', '2026-11-21', { pass: wangPass, in: '2026-11-21T08:41:00+07:00' });
  await seat(wang, 'olp_mon_1', '2026-11-23', { pass: wangPass });
  // Moved over from Rezerv, first visit on aybkk.net two days ago, on a class Rezerv gave back (a Drop-in pass): never new, never a drop-in.
  const rosa = await member('Rosa Example');
  const rosaPass = await pass(rosa, 'unlim1', { from: '2026-11-01', until: '2026-12-01', source: 'rezerv', created: '2026-11-16T09:00:00+07:00' });
  await seat(rosa, 'my530_3', '2026-11-17', { pass: rosaPass, in: '2026-11-17T05:30:00+07:00' });
  const rosaBack = await pass(rosa, 'dropin', { source: 'rezerv', created: '2026-11-16T09:00:00+07:00' });
  await pool.query(`UPDATE bkk_passes SET note='moved from Rezerv; a class Rezerv gave back' WHERE id=$1`, [rosaBack]);
  await seat(rosa, 'my530_4', '2026-11-19', { pass: rosaBack });
  // Joined 10 days ago, first came 8 days ago: past the first week.
  const tess = await member('Tess Example', { joined: '2026-11-09' });
  const tessPass = await pass(tess, 'unlim1', { from: '2026-11-11', until: '2026-12-11', created: '2026-11-09T09:00:00+07:00' });
  await seat(tess, 'my530_3', '2026-11-11', { pass: tessPass, in: '2026-11-11T05:30:00+07:00' });
  await seat(tess, 'my730_4', '2026-11-19', { pass: tessPass });
  const ben = await member('Ben Example');
  const benPass = await pass(ben, 'unlim3', { from: '2026-10-06', until: '2027-01-04', created: '2026-10-05T09:00:00+07:00' });
  await seat(ben, 'my730_2', '2026-10-06', { pass: benPass, in: '2026-10-06T07:30:00+07:00' });
  await seat(ben, 'my730_4', '2026-11-19', { pass: benPass, mat: true });
  await seat(ben, 'li_sat_6', '2026-11-21', { pass: benPass });
  await seat(ben, 'my530_5', '2026-11-20', { pass: benPass });
  await seat(ben, 'my730_5', '2026-11-20', { pass: benPass });
  // The walk-in a teacher sold at the desk: a Drop-in pass, first class ever.
  const leo = await member('Leo Example');
  const leoDrop = await pass(leo, 'dropin', { from: '2026-11-19', until: '2026-11-20', used: 1, created: '2026-11-19T07:20:00+07:00' });
  await seat(leo, 'my730_4', '2026-11-19', { pass: leoDrop, source: 'door', in: '2026-11-19T07:21:00+07:00' });
  const nora = await member('Nora Example');
  await seat(nora, 'my730_4', '2026-11-19', {});
  const mia = await member('Mia Example');
  const miaDrop = await pass(mia, 'dropin', { from: '2026-11-21', until: '2026-11-22', used: 1, created: '2026-11-20T18:00:00+07:00' });
  await seat(mia, 'lp_sat_6', '2026-11-21', { pass: miaDrop, mat: true, in: '2026-11-21T06:58:00+07:00' });
  // Online only: Zoom students are counted, never named.
  const olga = await member('Olga Example');
  const olgaPass = await pass(olga, 'unlim1', { from: '2026-11-21', until: '2026-12-21', created: '2026-11-20T09:00:00+07:00' });
  await seat(olga, 'olp_sat_6', '2026-11-21', { pass: olgaPass });
  await seat(olga, 'olp_mon_1', '2026-11-23', { pass: olgaPass });
  await pool.query(`INSERT INTO bkk_class_overrides (slot_id,class_date,cancelled,note) VALUES ($1,'2026-11-20',true,'teacher away')`, [(await slot('my730_5')).id]);
  await pool.query(`INSERT INTO bkk_class_overrides (slot_id,class_date,cancelled,note) VALUES ($1,'2026-11-23',true,'Zoom training')`, [(await slot('olp_mon_1')).id]);
  const brief = async (d, lang = 'th') => (await get(`/api/bkk/admin/team/preview?kind=morning&date=${d}&lang=${lang}`)).body.text || '';
  const section = (t, head) => t.split('\n\n').find(x => x.startsWith(head)) || '';
  const tu19 = await brief('2026-11-19');
  console.log(tu19.split('\n').map(l => '      | ' + l).join('\n'));
  const c530 = section(tu19, '🧘 05:30 '), c730 = section(tu19, '🧘 07:30 ');
  ok('Thursday: each Mysore batch has its own block, the booked count, then only the lines that have someone',
     c530.split('\n')[1] === 'จอง 3 คน' && c730.split('\n')[1] === 'จอง 5 คน' && tu19.indexOf(c530) < tu19.indexOf(c730), JSON.stringify([c530, c730]));
  ok('DROP-IN: a seat on a pass of the Drop-in product (bought online, or sold at the desk), per class',
     c530.includes('\nดรอปอิน 1: Ana E.') && c730.includes('\nดรอปอิน 1: Leo E.'), JSON.stringify([c530, c730]));
  ok('...never a class Rezerv gave back, though it is imported as a Drop-in pass', !/ดรอปอิน[^\n]*Rosa/.test(tu19));
  ok('FIRST TIME: first class ever today', c530.includes('\nมาครั้งแรกวันนี้ 1: Ana E.') && c730.includes('\nมาครั้งแรกวันนี้ 2: Leo E., Nora E.'), JSON.stringify([c530, c730]));
  ok('FIRST WEEK: came before, first visit in the last 7 days; booked twice today, listed under the first class only',
     c530.includes('\nสัปดาห์แรก 1: 王小明') && !c730.includes('สัปดาห์แรก'), JSON.stringify([c530, c730]));
  ok('...never a student from Rezerv, or one who joined 10 days ago', !/Rosa E\.|Tess E\./.test(tu19), tu19);
  ok('MATS: per seat, ฿200 including VAT, paid at the shala', c530.endsWith('\nเช่าเสื่อ 1 (฿200 รวม VAT จ่ายที่ชาลา): Ana E.')
     && c730.endsWith('\nเช่าเสื่อ 1 (฿200 รวม VAT จ่ายที่ชาลา): Ben E.'), JSON.stringify([c530, c730]));
  ok('...a class block in this order: header, booked, drop-in, first time, first week, mats',
     c530 === '🧘 05:30 Mysore (1st batch) · ครู M\nจอง 3 คน\nดรอปอิน 1: Ana E.\nมาครั้งแรกวันนี้ 1: Ana E.\nสัปดาห์แรก 1: 王小明\nเช่าเสื่อ 1 (฿200 รวม VAT จ่ายที่ชาลา): Ana E.', c530);
  ok('...the seat with no pass is still in not paid', tu19.includes('💳 ยังไม่จ่าย ช่วยตามเก็บเงิน\n• Nora E. จอง 07:30 แต่ยังไม่มีแพ็กเกจ'), tu19);
  ok('...and the total counts shala classes, first time and first week once per person',
     tu19.trim().split('\n').at(-1) === 'รวม 2 คลาส · จอง 8 · ดรอปอิน 2 · ครั้งแรก 3 · สัปดาห์แรก 1 · เสื่อ 2 · ใกล้หมด 1 · ยังไม่จ่าย 1', tu19.trim().split('\n').at(-1));
  const fr20 = await brief('2026-11-20');
  ok('a cancelled class keeps its cancelled line, the other class its block', fr20.includes('\n\n07:30 Mysore (2nd batch) · ยกเลิก (teacher away)')
     && section(fr20, '🧘 05:30 ').split('\n')[1] === 'จอง 1 คน' && fr20.trim().endsWith('รวม 1 คลาส · จอง 1 · ดรอปอิน 0 · ครั้งแรก 0 · สัปดาห์แรก 0 · เสื่อ 0 · ใกล้หมด 1 · ยังไม่จ่าย 0'), fr20);
  const sa21 = await brief('2026-11-21');
  console.log(sa21.split('\n').map(l => '      | ' + l).join('\n'));
  const lp = section(sa21, '🧘 07:00 Led Primary'), li = section(sa21, '🧘 08:45 Led Intermediate');
  ok('Saturday: one brief, Led Primary and Led Intermediate each with their own details',
     lp.startsWith('🧘 07:00 Led Primary series · ครู ') && lp.includes('\nจอง 2 คน\nดรอปอิน 1: Mia E.\nมาครั้งแรกวันนี้ 1: Mia E.\nสัปดาห์แรก 1: Ana E.\nเช่าเสื่อ 2 (฿200 รวม VAT จ่ายที่ชาลา): Ana E., Mia E.')
     && li === '🧘 08:45 Led Intermediate series · ครู Boonchu\nจอง 3 คน\nสัปดาห์แรก 1: 王小明', JSON.stringify([lp, li]));
  ok('...online classes kept apart after them: a count each, no names, no mats',
     section(sa21, '💻') === '💻 ออนไลน์ (Zoom)\n07:00 Led Primary series · จอง 1\n09:00 Led Intermediate series · จอง 0'
     && sa21.indexOf('💻') > sa21.indexOf('🧘 08:45') && !sa21.includes('Olga'), sa21);
  ok('...and the total is the shala only', sa21.trim().endsWith('รวม 2 คลาส · จอง 5 · ดรอปอิน 1 · ครั้งแรก 1 · สัปดาห์แรก 2 · เสื่อ 2 · ใกล้หมด 1 · ยังไม่จ่าย 0'), sa21.trim().split('\n').at(-1));
  const sa21en = await brief('2026-11-21', 'en');
  ok('...in English in step', section(sa21en, '🧘 08:45 ') === '🧘 08:45 Led Intermediate series · Boonchu\n3 booked\nFirst week 1: 王小明'
     && section(sa21en, '🧘 07:00 ').includes('\n2 booked\nDrop-in 1: Mia E.\nFirst class today 1: Mia E.\nFirst week 1: Ana E.\nMat rental 2 (฿200 incl. VAT, paid at the shala): Ana E., Mia E.')
     && section(sa21en, '💻') === '💻 Online (Zoom)\n07:00 Led Primary series · 1 booked\n09:00 Led Intermediate series · 0 booked'
     && sa21en.trim().endsWith('Total: 2 classes · 5 booked · 1 drop-in · 1 first time · 2 first week · 2 mats · 1 ending · 0 not paid'), sa21en);
  const mo23 = await brief('2026-11-23');
  console.log(mo23.split('\n').map(l => '      | ' + l).join('\n'));
  ok('Monday: Led Primary in the shala, and a cancelled online class says so', section(mo23, '🧘 06:30 ') === '🧘 06:30 Led Primary series · ครู Boonchu\nจอง 1 คน\nสัปดาห์แรก 1: Ana E.'
     && section(mo23, '💻') === '💻 ออนไลน์ (Zoom)\n06:30 Led Primary series · ยกเลิก (Zoom training)', mo23);
  const every = [tu19, fr20, sa21, sa21en, mo23].join('\n');
  ok('never an email, a phone number or a member code in any of them, and no em dash', !/@|example\.com|0899000|BTEAM|\u2014/.test(every));

  console.log('\n# the morning send time by weekday');
  const nextAt = async at => { clock = bkkAt(at); return (await get('/api/bkk/admin/team/status')).body.briefs; };
  const nexts = [];
  // Within the hour after its time, today's brief not sent yet: the timer sends it at its next tick, so next is now.
  for (const [at, want, hhmm, due] of [['2026-11-19T04:00:00', '2026-11-19T05:00:00', '05:00', false],
    ['2026-11-19T05:00:00', '2026-11-19T05:00:00', '05:00', true], ['2026-11-20T05:01:00', '2026-11-20T05:01:00', '05:01', true],
    ['2026-11-20T06:00:00', '2026-11-21T06:00:00', '06:00', false], ['2026-11-21T05:30:00', '2026-11-21T06:00:00', '06:00', false],
    ['2026-11-21T06:00:00', '2026-11-21T06:00:00', '06:00', true], ['2026-11-22T06:30:00', '2026-11-22T06:30:00', '06:30', true],
    ['2026-11-22T07:00:00', '2026-11-23T05:30:00', '05:30', false], ['2026-11-23T05:00:00', '2026-11-23T05:30:00', '05:30', false],
    ['2026-11-23T05:31:00', '2026-11-23T05:31:00', '05:31', true], ['2026-11-23T06:30:00', '2026-11-24T05:00:00', '05:00', false]]) {
    const b = await nextAt(at);
    nexts.push([at, b.next.morning, b.at.morning, b.dueNow.morning]);
    if (b.next.morning !== new Date(bkkAt(want)).toISOString() || b.at.morning !== hhmm || b.dueNow.morning !== due) nexts.push('WRONG');
  }
  ok('status says when the next morning brief really goes, on each weekday, late by under an hour too (and the evening stays 20:00)', !nexts.includes('WRONG')
     && (await nextAt('2026-11-22T06:30:00')).at.evening === '20:00', JSON.stringify(nexts));
  const forDate = d => morningPushes().filter(p => p.body.messages[0].text.split('\n')[0].endsWith(d));
  const moonMon = [await team.tick(bkkAt('2026-11-09T05:00:00')), await team.tick(bkkAt('2026-11-09T05:29:00'))];
  clock = bkkAt('2026-11-09T05:30:00');
  const moonMon2 = await team.tick(clock);
  ok('Monday: 05:00 sends nothing; 05:30 sends, a moon day with the shala closed text', moonMon.every(r => r.length === 0) && moonMon2.length === 1 && moonMon2[0].sent
     && forDate('จ. 9 พ.ย.').length === 1 && forDate('จ. 9 พ.ย.')[0].body.messages[0].text === '☀️ บรีฟเช้า จ. 9 พ.ย.\nวันนี้ชาลาปิด วันพระจันทร์ดับ (moon day)',
     JSON.stringify([moonMon, moonMon2]));
  clock = bkkAt('2026-11-24T05:00:00');
  const fullMoon = await team.tick(clock);
  ok('a full moon Tuesday: the closed text at the Tuesday time, 05:00', fullMoon.length === 1 && fullMoon[0].sent
     && forDate('อ. 24 พ.ย.')[0].body.messages[0].text === '☀️ บรีฟเช้า อ. 24 พ.ย.\nวันนี้ชาลาปิด วันพระจันทร์เต็มดวง (moon day)', JSON.stringify(fullMoon));
  clock = bkkAt('2026-11-19T05:00:00');
  const thu = await team.tick(clock);
  ok('Thursday 05:00 sends the brief as built', thu.length === 1 && thu[0].sent && forDate('พฤ. 19 พ.ย.').length === 1
     && forDate('พฤ. 19 พ.ย.')[0].body.messages[0].text === tu19, JSON.stringify(thu));
  const satEarly = [await team.tick(bkkAt('2026-11-21T05:00:00')), await team.tick(bkkAt('2026-11-21T05:59:00'))];
  clock = bkkAt('2026-11-21T06:00:00');
  const satRun = await team.tick(clock);
  const satPush = forDate('ส. 21 พ.ย.');
  ok('Saturday: nothing before 06:00, then one push with both Led classes and the online section',
     satEarly.every(r => r.length === 0) && satRun.length === 1 && satRun[0].sent && satPush.length === 1
     && satPush[0].body.messages.length === 1 && satPush[0].body.messages[0].text === sa21, JSON.stringify([satEarly, satRun]));
  const sunEarly = await team.tick(bkkAt('2026-11-22T05:00:00'));
  clock = bkkAt('2026-11-22T06:00:00');
  const sunRun = await team.tick(clock);
  ok('Sunday: nothing at 05:00, the brief at 06:00', sunEarly.length === 0 && sunRun.length === 1 && sunRun[0].sent
     && forDate('อา. 22 พ.ย.').length === 1 && forDate('อา. 22 พ.ย.')[0].body.messages[0].text.includes('🧘 07:00 Mysore Sunday'), JSON.stringify(sunRun));
  const monEarly = await team.tick(bkkAt('2026-11-23T05:00:00'));
  clock = bkkAt('2026-11-23T06:15:00');
  const monLate = await team.tick(clock);
  clock = bkkAt('2026-11-23T06:20:00');
  const monAgain = await team.tick(clock);
  ok('Monday 23: nothing at 05:00; a server back at 06:15 (late by under an hour) sends it once',
     monEarly.length === 0 && monLate.length === 1 && monLate[0].sent && monAgain[0].skipped === 'already'
     && forDate('จ. 23 พ.ย.').length === 1 && forDate('จ. 23 พ.ย.')[0].body.messages[0].text === mo23, JSON.stringify([monEarly, monLate, monAgain]));
  ok('...and after it went, status says the next one is Tuesday 05:00', (await nextAt('2026-11-23T06:16:00')).next.morning
     === new Date(bkkAt('2026-11-24T05:00:00')).toISOString());

  console.log('\n# never new: Rezerv students the import did not mark; a name with nothing to show; Zoom seats (Wed 25, Sat 28 Nov)');
  // The door's add for a Rezerv package holder it could not find (POST /api/bkk/admin/walkin, cover rezerv):
  // a new profile with no source and no join date, and a checked-in seat on cover 'rezerv'.
  const ruth = await member('Ruth Example');
  await seat(ruth, 'my530_5', '2026-11-20', { cover: 'rezerv', source: 'door', in: '2026-11-20T05:40:00+07:00' });
  const ruthPass = await pass(ruth, 'unlim1', { from: '2026-11-21', until: '2026-12-21', created: '2026-11-20T09:00:00+07:00' });
  await seat(ruth, 'my530_3', '2026-11-25', { pass: ruthPass });
  // A profile from aybkk.net the Rezerv member import matched: rezerv_id and the old join date, no source.
  const ines = await member('Ines Example', { joined: '2019-03-01' });
  await pool.query(`UPDATE bkk_members SET rezerv_id='RZ-TEST-1' WHERE id=$1`, [ines]);
  const inesPass = await pass(ines, 'unlim1', { from: '2026-11-20', until: '2026-12-20', created: '2026-11-20T08:00:00+07:00' });
  await seat(ines, 'my530_5', '2026-11-20', { pass: inesPass, in: '2026-11-20T05:31:00+07:00' });
  await seat(ines, 'my530_3', '2026-11-25', { pass: inesPass });
  // A Rezerv seat staff moved onto a pass here (moved_at), then a first visit on aybkk.net.
  const moe = await member('Moe Example');
  const moePass = await pass(moe, 'unlim1', { from: '2026-11-20', until: '2026-12-20', created: '2026-11-20T08:00:00+07:00' });
  const moeSeat = await seat(moe, 'my530_5', '2026-11-20', { pass: moePass, in: '2026-11-20T05:32:00+07:00' });
  await pool.query(`UPDATE bkk_bookings SET moved_at='2026-11-20T09:00:00+07:00' WHERE id=$1`, [moeSeat]);
  await seat(moe, 'my530_3', '2026-11-25', { pass: moePass });
  // Really new this week, to show the rule still finds them.
  const pia = await member('Pia Example', { joined: '2026-11-20' });
  const piaPass = await pass(pia, 'unlim1', { from: '2026-11-20', until: '2026-12-20', created: '2026-11-20T08:00:00+07:00' });
  await seat(pia, 'my530_5', '2026-11-20', { pass: piaPass, in: '2026-11-20T05:33:00+07:00' });
  await seat(pia, 'my530_3', '2026-11-25', { pass: piaPass });
  // A name stored as only a phone number: a drop-in with a mat.
  const phoneOnly = await member('0812345678');
  const phoneDrop = await pass(phoneOnly, 'dropin', { from: '2026-11-25', until: '2026-11-26', used: 1, created: '2026-11-24T09:00:00+07:00' });
  await seat(phoneOnly, 'my530_3', '2026-11-25', { pass: phoneDrop, mat: true });
  const we25 = await brief('2026-11-25');
  console.log(we25.split('\n').map(l => '      | ' + l).join('\n'));
  const w530 = section(we25, '🧘 05:30 ');
  ok('a Rezerv student is never new: added at the door on a Rezerv package, matched by the import, or a moved Rezerv seat',
     !/Ruth E\.|Ines E\.|Moe E\./.test(we25) && w530.includes('\nสัปดาห์แรก 1: Pia E.'), w530);
  ok('a name with nothing to show (only a phone number) says so, never "?" and never the number',
     w530.includes('\nดรอปอิน 1: ไม่มีชื่อในระบบ') && w530.includes('\nมาครั้งแรกวันนี้ 1: ไม่มีชื่อในระบบ')
     && w530.includes('(฿200 รวม VAT จ่ายที่ชาลา): ไม่มีชื่อในระบบ') && !/\?|0812345678/.test(we25), we25);
  ok('...in English too', (await brief('2026-11-25', 'en')).includes('\nDrop-in 1: no name on file'));
  const zed = await member('Zed Example');
  await seat(zed, 'olp_sat_6', '2026-11-28', {});
  await seat(zed, 'lp_sat_6', '2026-11-28', {});
  const sa28 = await brief('2026-11-28');
  ok('not paid: a Zoom seat at the same time as a shala class says (Zoom)', sa28.includes('\n• Zed E. จอง 07:00 (Zoom) แต่ยังไม่มีแพ็กเกจ')
     && sa28.includes('\n• Zed E. จอง 07:00 แต่ยังไม่มีแพ็กเกจ'), sa28);

  console.log('\n# switched on, or back up, within the hour after the time: status says now, and the timer sends');
  clock = bkkAt('2026-11-26T05:20:00');
  await post('/api/bkk/admin/settings', { teamBriefMorning: 'off' });
  const offLate = (await get('/api/bkk/admin/team/status')).body.briefs;
  ok('off at Thu 05:20: no next, but status says switching on sends today\'s within a minute', offLate.next.morning === null
     && offLate.dueNow.morning === true && offLate.at.morning === '05:20', JSON.stringify(offLate));
  await post('/api/bkk/admin/settings', { teamBriefMorning: 'on' });
  const onLate = (await get('/api/bkk/admin/team/status')).body.briefs;
  const late26 = pushes().length;
  clock = bkkAt('2026-11-26T05:21:00');
  const tick26 = await team.tick(clock);
  ok('...switched on at 05:20: next is now, and the 05:21 tick posts it', onLate.next.morning === new Date(bkkAt('2026-11-26T05:20:00')).toISOString()
     && onLate.dueNow.morning === true && tick26.length === 1 && tick26[0].sent && pushes().length === late26 + 1, JSON.stringify([onLate, tick26]));
  const after26 = (await get('/api/bkk/admin/team/status')).body.briefs;
  ok('...once sent, next is Friday 05:00', after26.next.morning === new Date(bkkAt('2026-11-27T05:00:00')).toISOString() && after26.dueNow.morning === false);
  await pool.query(`INSERT INTO bkk_settings (key,value) VALUES ('team_brief_sent_morning_2026-11-27','{"state":"retry","tries":1}')`);
  clock = bkkAt('2026-11-27T05:10:00');
  const retry27 = (await get('/api/bkk/admin/team/status')).body.briefs;
  const tick27 = await team.tick(clock);
  ok('LINE was down at Fri 05:00 (a retry waits): status says now, and the next tick sends it', retry27.dueNow.morning === true
     && retry27.next.morning === new Date(clock).toISOString() && tick27.length === 1 && tick27[0].sent, JSON.stringify([retry27, tick27]));
  clock = bkkAt('2026-11-27T06:00:00');
  ok('...an hour after the time, with nothing to send, next is Saturday 06:00', (await get('/api/bkk/admin/team/status')).body.briefs.next.morning
     === new Date(bkkAt('2026-11-28T06:00:00')).toISOString());

  console.log('\n# the mat tick on bookings');
  const sch = (await get('/api/bkk/schedule?days=14')).body.classes || [];
  // An empty class: the brief tests above fill fixed dates (10, 11, 17 Nov) with made-up bookings and mats,
  // so 'the next class' collided with them on some real dates (9 Nov, a moon day, made it 10 Nov).
  const room = sch.find(c => !c.isOnline && !c.started && c.seatsLeft === c.capacity && c.capacity > 2),
    home = sch.find(c => c.isOnline && !c.started && c.seatsLeft > 1);
  const mp1 = await post('/api/bkk/admin/passes', { name: 'Mat Tester', email: 'mat.tester@example.com', productCode: 'unlim1' });
  const code = mp1.body.member.code;
  const bk = await post('/api/bkk/bookings', { memberCode: code, slotId: room.slotId, date: room.date, needMat: true }, {});
  ok('booking with "I need a mat" saves it on the booking', bk.status === 200 && bk.body.booking.need_mat === true, JSON.stringify(bk.body));
  const inClass = await get(`/api/bkk/admin/class?slotId=${room.slotId}&date=${room.date}`);
  const row = (inClass.body.roster || []).find(r => r.code === code);
  ok('...and the admin class data shows it', row && row.needMat === true && inClass.body.class.mats === 1, JSON.stringify(inClass.body).slice(0, 300));
  const mine = await get(`/api/bkk/me/${code}`, {});
  ok('...and the student\'s own bookings carry it', mine.body.bookings.find(b => b.id === bk.body.booking.id).need_mat === true);
  ok('someone else cannot change it', (await post(`/api/bkk/bookings/${bk.body.booking.id}/mat`, { memberCode: 'BNOTYOU', needMat: false }, {})).status === 404);
  ok('needMat must be true or false', (await post(`/api/bkk/bookings/${bk.body.booking.id}/mat`, { memberCode: code, needMat: 'no' }, {})).status === 400);
  const untick = await post(`/api/bkk/bookings/${bk.body.booking.id}/mat`, { memberCode: code, needMat: false }, {});
  const inClass2 = await get(`/api/bkk/admin/class?slotId=${room.slotId}&date=${room.date}`);
  ok('the student can untick it on the booking', untick.status === 200 && inClass2.body.roster.find(r => r.code === code).needMat === false
     && inClass2.body.class.mats === 0);
  const plain = await post('/api/bkk/bookings', { memberCode: (await post('/api/bkk/admin/passes', { name: 'No Mat', email: 'no.mat@example.com', productCode: 'unlim1' })).body.member.code,
    slotId: room.slotId, date: room.date }, {});
  ok('a booking without the tick needs no mat', plain.status === 200 && plain.body.booking.need_mat === false);
  if (home) {
    const hb = await post('/api/bkk/bookings', { memberCode: code, slotId: home.slotId, date: home.date, needMat: true }, {});
    ok('an online class never needs a mat from the shala', hb.status === 200 && hb.body.booking.need_mat === false
       && (await post(`/api/bkk/bookings/${hb.body.booking.id}/mat`, { memberCode: code, needMat: true }, {})).status === 409);
  }
  const drop = await post('/api/bkk/orders', { productCode: 'dropin', name: 'Drop Mat', email: 'drop.mat@example.com',
    slotId: room.slotId, date: room.date, needMat: true }, {});
  const dropNoMat = await post('/api/bkk/orders', { productCode: 'dropin', name: 'Drop Plain', email: 'drop.plain@example.com',
    slotId: room.slotId, date: room.date }, {});
  ok('the mat is never charged online: a drop-in with the tick costs the same as one without', drop.status === 200
     && dropNoMat.status === 200 && drop.body.order.amount === dropNoMat.body.order.amount, JSON.stringify([drop.body.order, dropNoMat.body.order]));
  await post(`/api/bkk/admin/orders/${drop.body.order.id}/force-activate`, {});
  const inClass3 = await get(`/api/bkk/admin/class?slotId=${room.slotId}&date=${room.date}`);
  ok('a drop-in bought for the class carries the tick to its seat', inClass3.body.roster.some(r => r.name === 'Drop Mat' && r.needMat === true));
  // The other way a drop-in is sold: at the desk or from the calendar (walk-in, cover dropin). Both book on a Drop-in pass.
  const walk = await post('/api/bkk/admin/walkin', { cover: 'dropin', method: 'cash', slotId: room.slotId, date: room.date, checkIn: false,
    name: 'Leo Walkin', email: 'leo.walkin@example.com' });
  const walkSeat = (await pool.query(`SELECT b.cover, pr.code FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id
    JOIN bkk_passes p ON p.id=b.pass_id JOIN bkk_products pr ON pr.id=p.product_id WHERE m.name='Leo Walkin'`)).rows[0];
  const roomAt = new Date(Date.parse(room.startAt) + 7 * 3600000).toISOString().slice(11, 16);
  const roomText = (await get(`/api/bkk/admin/team/preview?kind=morning&date=${room.date}`)).body.text || '';
  const roomBlock = roomText.split('\n\n').find(x => x.startsWith(`🧘 ${roomAt} ${room.title}`)) || '';
  ok('the morning brief counts both as drop-ins in their class: the seat says cover pass, its pass is the Drop-in product',
     walk.status === 200 && walk.body.cover === 'dropin' && walkSeat && walkSeat.cover === 'pass' && walkSeat.code === 'dropin'
     && roomBlock.includes('\nดรอปอิน 2: Drop M., Leo W.') && roomBlock.includes('\nเช่าเสื่อ 1 (฿200 รวม VAT จ่ายที่ชาลา): Drop M.'),
     JSON.stringify([walk.body, walkSeat, roomBlock]));

  // A far class booked first starts the pass window there; a nearer seat on
  // the same pass moves the start to it (same length), so both are paid for.
  const inRoom = sch.filter(c => !c.isOnline && !c.started && c.seatsLeft > 0);
  const near = inRoom[0], far = inRoom.find(c => c.date > near.date);
  const pita = (await post('/api/bkk/admin/passes', { name: 'Pita Probe', email: 'pita.probe@example.com', productCode: 'unlim1' })).body.member.code;
  const farBk = await post('/api/bkk/bookings', { memberCode: pita, slotId: far.slotId, date: far.date }, {});
  const nearBk = await post('/api/bkk/bookings', { memberCode: pita, slotId: near.slotId, date: near.date }, {});
  const win = (await pool.query(`SELECT to_char(valid_from,'YYYY-MM-DD') AS f FROM bkk_passes WHERE id=$1`, [nearBk.body.booking && nearBk.body.booking.pass_id])).rows[0];
  const nearText = (await get(`/api/bkk/admin/team/preview?kind=morning&date=${near.date}`)).body.text || '';
  const paySection = nearText.split('\n\n').find(x => x.startsWith('💳')) || '';
  ok('a nearer seat moves the pass start to it, and is not listed as not paid', farBk.status === 200 && nearBk.status === 200
     && farBk.body.booking.pass_id === nearBk.body.booking.pass_id && win && win.f === near.date
     && nearText.includes('Pita P.') && !paySection.includes('Pita P.'), JSON.stringify([far.date, near.date, win, paySection]));
  // The door's list is today's bookings.
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const wd = new Date(`${today}T12:00:00Z`).getUTCDay();
  const ts = (await pool.query('SELECT id, start_time FROM bkk_class_slots WHERE weekday=$1 AND active ORDER BY start_time LIMIT 1', [wd])).rows[0];
  await pool.query(`INSERT INTO bkk_bookings (slot_id,class_date,start_at,member_id,cover,source,need_mat) VALUES ($1,$2,$3,$4,'rezerv','staff',true)`,
    [ts.id, today, `${today}T${ts.start_time}:00+07:00`, anna]);
  const door = await get('/api/bkk/admin/today');
  ok('the door\'s check-in list carries the mat mark', door.body.bookings.some(b => b.name === 'Anna Bell' && b.need_mat === true), JSON.stringify(door.body.bookings).slice(0, 200));

  // The booking page: the tick and the first-class guide say ฿200 in all 4 languages, no VAT added.
  const page = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'bkk.html'), 'utf8');
  const tick = Object.fromEntries([...page.matchAll(/Object\.assign\(STR\.(en|th|zh|ru), \{ needMat: '([^']*)' \}\)/g)].map(x => [x[1], x[2]]));
  ok('the mat tick says ฿200, pay at the shala, in all 4 languages', tick.en === 'I need a mat (฿200, pay at the shala)'
     && tick.th === 'ต้องการเช่าเสื่อ (฿200 จ่ายที่ชาลา)' && tick.zh === '需要租瑜伽垫（฿200，在道场付款）'
     && tick.ru === 'Нужен коврик (฿200, оплата в шале)', JSON.stringify(tick));
  const f3 = [...page.matchAll(/\bf3: '([^']*)'/g)].map(x => x[1]);
  ok('...and the first-class guide (f3) says the mat is ฿200 if you tick it, in all 4', f3.length === 4
     && f3.every(x => x.includes('฿200') && !/VAT|НДС|增值税|ภาษี/.test(x)), JSON.stringify(f3));

  console.log('\n# a group the help desk is in, but never heard joining');
  clock = bkkAt('2026-11-25T10:00:00');
  const groupsText = async () => JSON.stringify((await setting('team_line_groups')) || []);
  const toldBefore = told.length;
  const groupEv = (type, groupId, extra = {}) => ({ type, timestamp: clock, source: { type: 'group', groupId, userId: 'Ustaff' }, ...extra });
  const textEv = (groupId, text) => groupEv('message', groupId, { replyToken: 'r9', message: { id: 'm9', type: 'text', text } });
  const unsigned = await fetch(B + '/line/helpdesk-webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ destination: 'Udesk', events: [textEv('Cmanage', 'hello')] }) });
  const badSig = await hook([textEv('Cmanage', 'hello')], 'not-the-secret');
  ok('an unsigned or badly signed message from an unknown group is refused and changes nothing', unsigned.status === 401 && badSig.status === 401
     && !(await groupsText()).includes('Cmanage') && told.length === toldBefore);
  const stBad = (await get('/api/bkk/admin/team/status')).body;
  ok('...and status counts bad signatures since the restart, with the last one\'s time', stBad.badSignatures >= 3
     && stBad.badSignatureLastAt === new Date(clock).toISOString(), JSON.stringify([stBad.badSignatures, stBad.badSignatureLastAt]));
  // The real case: the help desk was put in the staff group before LINE could reach the webhook, so no group is saved.
  await post('/api/bkk/admin/team/group', { clear: true });
  const toldClear = told.length;
  const capLogs = [];
  console.log = console.warn = console.error = (...a) => capLogs.push(a.join(' '));
  const first = await hook([textEv('Cmanage', 'SECRET CAPTURE WORDS 7731')]);
  console.log = logIt; console.warn = warnIt; console.error = errIt;
  const capSeen = await setting('team_line_groups');
  const cm = (capSeen || []).find(g => g.id === 'Cmanage');
  ok('a signed message from a group not known yet adds it as waiting, never saved by itself', first.status === 200
     && cm && cm.pending === true && cm.name === 'Other manage' && !cm.leftAt && (await setting('team_line_group')) == null, JSON.stringify(capSeen));
  ok('...and Boonchu gets the waiting note, naming the group', told.length === toldClear + 1 && /"Other manage", waiting/.test(told.at(-1))
     && /No LINE group gets the team briefs yet/.test(told.at(-1)) && /accept/.test(told.at(-1)), JSON.stringify(told.slice(toldClear)));
  const capStored = (await pool.query(`SELECT count(*)::int AS n FROM bkk_settings WHERE value::text ~ 'SECRET CAPTURE'`)).rows[0].n;
  ok('...the message text is never stored or logged', capStored === 0 && !capLogs.some(l => /SECRET CAPTURE/.test(l)), JSON.stringify(capLogs));
  const stCap = (await get('/api/bkk/admin/team/status')).body;
  ok('status: the waiting group by its ref, and when LINE last reached the webhook with a good signature',
     stCap.group.saved === false && stCap.groupsSeen.some(g => g.name === 'Other manage' && g.pending)
     && stCap.webhookLastAt === new Date(clock).toISOString() && !JSON.stringify(stCap).includes('Cmanage'), JSON.stringify(stCap));
  await hook([groupEv('memberJoined', 'Cmembers', { joined: { members: [{ type: 'user', userId: 'Unew' }] } })]);
  ok('any group event counts: a member joining another unknown group makes it wait too',
     (await setting('team_line_groups')).find(g => g.id === 'Cmembers').pending === true && told.length === toldClear + 2
     && (await setting('team_line_group')) == null);
  // A known group (waiting or saved) talks all day: no write, no lock, not even a read.
  const sqls = [];
  let connects = 0;
  const realQuery = pool.query, realConnect = pool.connect;
  pool.query = function (sql, ...rest) { sqls.push(typeof sql === 'string' ? sql : (sql && sql.text) || ''); return realQuery.call(this, sql, ...rest); };
  pool.connect = function (...a) { connects++; return realConnect.apply(this, a); };
  clock += 20 * 1000;
  const again = await hook([textEv('Cmanage', 'more words'), groupEv('memberLeft', 'Cmanage', { left: { members: [{ type: 'user', userId: 'Uold' }] } }),
    textEv('Cmembers', 'hi')]);
  pool.query = realQuery; pool.connect = realConnect;
  ok('a known group\'s messages write nothing (and the webhook time is kept at most once a minute)', again.status === 200
     && !sqls.some(s => /bkk_settings/.test(s)) && connects === 0 && told.length === toldClear + 2
     && (await setting('team_line_webhook_last')) === new Date(clock - 20 * 1000).toISOString(), JSON.stringify({ sqls, connects }));
  clock += 60 * 1000;
  await hook([]);
  ok('...a minute later LINE\'s Verify (no events) moves the webhook time on', (await setting('team_line_webhook_last')) === new Date(clock).toISOString());
  const capRef = stCap.groupsSeen.find(g => g.name === 'Other manage').ref;
  const capAcc = await post('/api/bkk/admin/team/group', { accept: capRef });
  ok('accepting the waiting group saves it: the briefs go there now', capAcc.status === 200 && (await setting('team_line_group')) === 'Cmanage'
     && /"Other manage" now/.test(told.at(-1)), JSON.stringify(capAcc.body));
  await hook([join('Cmanage', clock - 3600 * 1000)]);
  ok('the join LINE sends late, from before the message, changes nothing', (await setting('team_line_group')) === 'Cmanage'
     && (await setting('team_line_groups')).find(g => g.id === 'Cmanage').pending === false);
  await hook([leave('Cmembers', clock + 1000)]);
  clock += 5000;
  await hook([textEv('Cmembers', 'back again')]);
  const back = (await setting('team_line_groups')).find(g => g.id === 'Cmembers');
  ok('a group the help desk left, heard from again later, waits again', back.pending === true && !back.leftAt
     && (await setting('team_line_group')) === 'Cmanage', JSON.stringify(back));

  console.log('\n# capture: one ping per group, names filled in later, whose token, what a brief costs');
  const summaries = id => lineCalls.filter(c => c.path === `/v2/bot/group/${id}/summary`).length;
  const toldBurst = told.length;
  const burst = await Promise.all(Array.from({ length: 8 }, (_, i) => hook([textEv('Cburst', `burst ${i}`)])));
  ok('a burst of messages from one unknown group: one name asked of LINE, one ping, it waits once', burst.every(r => r.status === 200)
     && summaries('Cburst') === 1 && told.length === toldBurst + 1 && (await setting('team_line_groups')).filter(g => g.id === 'Cburst').length === 1);
  const toldFlood = told.length;
  let floodConnects = 0;
  const connect0 = pool.connect;
  pool.connect = function (...a) { floodConnects++; return connect0.apply(this, a); };
  for (let round = 0; round < 3; round++) for (let i = 0; i < 12; i++) await hook([textEv(`Cflood${i}`, 'hi')]);
  pool.connect = connect0;
  const keptFlood = await setting('team_line_groups');
  ok('more unknown groups than the list keeps, talking for three rounds: each pings once, one write each, the saved group kept',
     told.length === toldFlood + 12 && floodConnects === 12 && keptFlood.length === 10 && keptFlood.some(g => g.id === 'Cmanage')
     && (await setting('team_line_group')) === 'Cmanage', JSON.stringify({ pings: told.length - toldFlood, floodConnects }));
  // Heard while the token was not set: no name. Once it is set, status asks LINE again.
  delete process.env.HELPDESK_LINE_ACCESS_TOKEN;
  await hook([textEv('Cnoname', 'hello')]);
  const nameless = (await setting('team_line_groups')).find(g => g.id === 'Cnoname');
  const stNoTok = (await get('/api/bkk/admin/team/status')).body;
  process.env.HELPDESK_LINE_ACCESS_TOKEN = ' desk-token\n';
  const stTok = (await get('/api/bkk/admin/team/status')).body;
  ok('a group first heard while the token was not set has no name; once the token is set, status fills it in',
     nameless && nameless.name === null && nameless.pending && stNoTok.channel.tokenSet === false && stNoTok.channel.bot === null
     && stTok.groupsSeen.some(g => g.pending && g.name === 'Other noname') && (await setting('team_line_groups')).find(g => g.id === 'Cnoname').name === 'Other noname',
     JSON.stringify([nameless, stTok.groupsSeen]));
  ok('...status says whose LINE account the token is, and how many people each group has (LINE counts a group push per member)',
     stTok.channel.tokenSet === true && stTok.channel.bot && stTok.channel.bot.name === 'AYBKK help desk' && stTok.channel.bot.basicId === '@000desk'
     && stTok.channel.tokenError === null && stTok.group.members === 7 && stTok.groupsSeen.find(g => g.name === 'Other noname').members === 3,
     JSON.stringify([stTok.channel, stTok.group]));
  const before0 = pushes().length;
  await post('/api/bkk/admin/team/send', { text: 'Trim check' });
  ok('...a token pasted with a space and a line end still works', pushes().length === before0 + 1
     && pushes().at(-1).headers.Authorization === 'Bearer desk-token');
  process.env.HELPDESK_LINE_ACCESS_TOKEN = 'refused-token';
  const stRef = (await get('/api/bkk/admin/team/status')).body;
  ok('...a token LINE refuses says so', stRef.channel.tokenSet === true && /refused the access token \(401\)/.test(stRef.channel.tokenError || '')
     && stRef.channel.bot === null && stRef.quota === null, JSON.stringify(stRef.channel));
  process.env.HELPDESK_LINE_ACCESS_TOKEN = 'desk-token';
  process.env.HELPDESK_LINE_CHANNEL_SECRET = 'desk-secret \n';
  ok('a channel secret pasted with a line end still checks signatures', (await hook([])).status === 200);
  process.env.HELPDESK_LINE_CHANNEL_SECRET = 'desk-secret';
  const noStore = await Promise.all(['/api/bkk/admin/team/status', '/api/bkk/admin/team/preview?kind=morning&date=2026-11-25']
    .map(u => fetch(B + u, { headers: ADMIN }).then(r => r.headers.get('cache-control'))));
  ok('status and preview (student names) are never kept by a browser or a proxy', noStore.every(h => h === 'private, no-store'), JSON.stringify(noStore));

  console.log(`\n${PASS} passed, ${FAIL} failed`);
  srv.close(); await pool.end();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
