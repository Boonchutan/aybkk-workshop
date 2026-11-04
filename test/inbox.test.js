// End-to-end test of inbox.js against a real Postgres, with a fake Claude
// client and a fake Telegram so nothing is sent or billed.
process.env.LINE_CHANNEL_SECRET = 'line-secret';
process.env.META_APP_SECRET = 'meta-secret';
process.env.META_VERIFY_TOKEN = 'verify-me';
delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
delete process.env.META_PAGE_TOKEN;
delete process.env.INBOX_KEY;
const crypto = require('crypto');
const express = require('express');
const { Pool } = require('pg');
const { mountInbox, telegram, APPLY_PATH_RE } = require('../inbox.js');

// Own schema, so the fake timetable never touches the bkk tests' tables
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ||
  'postgres://test:test@127.0.0.1:5432/inboxtest', options: '-c search_path=inbox_test' });

let PASS = 0, FAIL = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name} ${extra}`); }
};
const wait = ms => new Promise(r => setTimeout(r, ms));

const aiCalls = [];
let aiAnswer = { lane: 'hot', summary: 'First-timer wants Mysore tomorrow.', reply: 'Hi Anna, welcome! Come at [time].' };
const fakeAi = { messages: { create: async params => {
  aiCalls.push(params);
  return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(aiAnswer) }] };
} } };
const alerts = [];

(async () => {
  await pool.query('DROP SCHEMA IF EXISTS inbox_test CASCADE');
  await pool.query('CREATE SCHEMA inbox_test');
  await pool.query(`CREATE TABLE bkk_class_slots (id SERIAL PRIMARY KEY, code TEXT, title TEXT, weekday INTEGER,
    start_time TEXT, is_online BOOLEAN DEFAULT false, active BOOLEAN DEFAULT true)`);
  await pool.query(`INSERT INTO bkk_class_slots (code, title, weekday, start_time, is_online) VALUES
    ('a','Mysore (1st batch)',1,'05:30',false), ('b','Mysore (1st batch)',2,'05:30',false),
    ('c','[Online] Led Primary series',1,'06:30',true)`);

  const app = express();
  // As in server.js: the application route reads its own body
  const jsonBody = express.json({ verify: (req, res, buf) => {
    if (/^\/(line|meta)\/webhook/.test(req.url)) req.rawBody = buf;
  } });
  app.use((req, res, next) => APPLY_PATH_RE.test(req.path) ? next() : jsonBody(req, res, next));
  const inbox = mountInbox(app, { pgPool: pool, ai: fakeAi, burstMs: 150,
    notify: async text => { alerts.push(text); return true; } });
  app.post('/line/webhook', (req, res) => { inbox.takeLine(req); res.json({ ok: true }); });
  await wait(500);
  const srv = app.listen(0);
  const B = `http://127.0.0.1:${srv.address().port}`;

  const lineSend = (events, secret = 'line-secret') => {
    const body = JSON.stringify({ destination: 'Uoa', events });
    const sig = crypto.createHmac('sha256', secret).update(body).digest('base64');
    return fetch(B + '/line/webhook', { method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Line-Signature': sig }, body });
  };
  const metaSend = (payload, secret = 'meta-secret') => {
    const body = JSON.stringify(payload);
    const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    return fetch(B + '/meta/webhook', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body });
  };
  const lineText = (id, uid, text, type = 'user') => ({ type: 'message', timestamp: Date.now(),
    source: type === 'user' ? { type, userId: uid } : { type, groupId: 'G1', userId: uid },
    message: { id, type: 'text', text } });
  const readInbox = async (qs = '', key = 'inbox-key') => {
    const r = await fetch(B + '/api/inbox' + qs, { headers: { 'x-inbox-key': key } });
    return { status: r.status, body: await r.json() };
  };
  const rows = async () => (await pool.query('SELECT * FROM aybkk_inbox ORDER BY id')).rows;

  console.log('\n— LINE —');
  await lineSend([lineText('m0', 'Ufake', 'forged')], 'wrong-secret');
  await wait(100);
  ok('a forged signature stores nothing', (await rows()).length === 0);

  await lineSend([lineText('m1', 'Uanna', 'Hi, can I join Mysore tomorrow? First time')]);
  await lineSend([lineText('m2', 'Uanna', 'I am in Bangkok for one week')]);
  await lineSend([lineText('m1', 'Uanna', 'Hi, can I join Mysore tomorrow? First time')]);   // LINE redelivery
  await lineSend([lineText('g1', 'Ustaff', 'staff group chat', 'group')]);
  await lineSend([{ type: 'message', timestamp: Date.now(), source: { type: 'user', userId: 'Ubob' },
    message: { id: 'm3', type: 'sticker', packageId: '1', stickerId: '2' } }]);
  await wait(100);
  let r = await rows();
  ok('1:1 chats stored, redelivery deduped, group chat skipped', r.length === 3, `got ${r.length}`);
  ok('a sticker is kept as a placeholder', r.some(x => x.sender_id === 'Ubob' && x.text === '(sticker)'));

  console.log('\n— instant sort —');
  await wait(400);
  ok('a burst of two messages is sorted once', aiCalls.length === 1, `got ${aiCalls.length}`);
  ok('a sticker alone costs no AI call', !aiCalls.some(c => JSON.stringify(c).includes('(sticker)')));
  const call = aiCalls[0] || {};
  ok('uses Opus 5.5 with a JSON schema', call.model === 'claude-opus-5-5' &&
    call.output_config.format.type === 'json_schema' && call.output_config.effort === 'low');
  ok('the whole burst is in the prompt', /tomorrow/.test(call.messages[0].content) && /one week/.test(call.messages[0].content));
  ok('in-person class times are in the system prompt', /Mysore \(1st batch\) 05:30: Mon Tue/.test(call.system) &&
    !/Online/.test(call.system));
  ok('one Telegram alert with the suggested reply', alerts.length === 1 && /🔥 LINE/.test(alerts[0]) &&
    /Suggested reply:\nHi Anna/.test(alerts[0]) && /tomorrow/.test(alerts[0]), alerts.join(' | '));
  r = await rows();
  const last = r.find(x => x.ext_id === 'line:m2');
  ok('sort result and alert time saved on the last message', last.triage && last.triage.lane === 'hot' && last.alerted_at);

  aiAnswer = { lane: 'later', summary: 'Says thanks.', reply: 'You are welcome!' };
  await lineSend([lineText('m4', 'Ucara', 'Thank you for today')]);
  await wait(400);
  ok('a "later" message is sorted but not pinged', aiCalls.length === 2 && alerts.length === 1);

  console.log('\n— Meta —');
  let v = await fetch(B + '/meta/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345');
  ok('Meta URL check answers the challenge', v.status === 200 && await v.text() === '12345');
  v = await fetch(B + '/meta/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345');
  ok('a wrong verify token is refused', v.status === 403);
  v = await metaSend({ object: 'instagram', entry: [] }, 'wrong');
  ok('an unsigned Meta post is refused', v.status === 403);

  const t = Date.now();
  v = await metaSend({ object: 'instagram', entry: [{ id: 'IG1', time: t, messaging: [
    { sender: { id: 'IGSID9' }, recipient: { id: 'IG1' }, timestamp: t, message: { mid: 'ig-m1', text: 'Price for teacher training?' } },
    { sender: { id: 'IG1' }, recipient: { id: 'IGSID9' }, timestamp: t + 1, message: { mid: 'ig-m2', text: 'Hi! How long have you practised?', is_echo: true } },
    { sender: { id: 'IGSID9' }, recipient: { id: 'IG1' }, timestamp: t + 2, read: { mid: 'ig-m2' } },
  ], changes: [
    { field: 'comments', value: { from: { id: 'IGU5', username: 'yogi_li' }, media: { id: 'MEDIA1' }, id: 'c1', text: 'Where is the shala?' } },
    { field: 'comments', value: { from: { id: 'IG1', username: 'aybkk' }, media: { id: 'MEDIA1' }, id: 'c2', parent_id: 'c1', text: 'Sukhumvit 31' } },
  ] }] });
  ok('a signed Instagram post is accepted', v.status === 200);
  await metaSend({ object: 'page', entry: [{ id: 'PAGE1', time: t, messaging: [
    { sender: { id: 'PSID3' }, recipient: { id: 'PAGE1' }, timestamp: t, message: { mid: 'fb-m1', attachments: [{ type: 'image' }] } },
  ], changes: [
    { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'fc1', post_id: 'P1', from: { id: 'U77', name: 'Olga' }, message: 'Is there a class on Sunday?', created_time: Math.floor(t / 1000) } },
    { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'fc2', post_id: 'P1', from: { id: 'PAGE1', name: 'AYBKK' }, message: 'Yes, 7am', parent_id: 'fc1', created_time: Math.floor(t / 1000) } },
    { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'fc3', post_id: 'P1', parent_id: 'PAGE1_P1', from: { id: 'PAGE1', name: 'AYBKK' }, message: 'Class photos!', created_time: Math.floor(t / 1000) } },
    { field: 'feed', value: { item: 'reaction', verb: 'add', post_id: 'P1', from: { id: 'U78' } } },
  ] }] });
  await wait(200);
  r = await rows();
  const by = id => r.find(x => x.ext_id === id) || {};
  ok('IG DM stored as incoming', by('instagram:ig-m1').direction === 'in' && by('instagram:ig-m1').sender_id === 'IGSID9');
  ok('IG echo stored as our reply on the same thread', by('instagram:ig-m2').direction === 'out' && by('instagram:ig-m2').sender_id === 'IGSID9');
  ok('IG comment keeps username and post', by('instagram:c:c1').sender_name === '@yogi_li' && by('instagram:c:c1').ref === 'MEDIA1');
  ok('FB photo DM stored as a placeholder', by('facebook:fb-m1').text === '(image)');
  ok('FB comment stored, page reply marked as ours', by('facebook:c:fc1').direction === 'in' && by('facebook:c:fc2').direction === 'out');
  ok('our comment replies join the thread of the person answered', by('facebook:c:fc2').sender_id === 'U77' &&
    by('instagram:c:c2').sender_id === 'IGU5' && by('instagram:c:c2').direction === 'out');
  ok('our own top-level comments, reads and reactions are skipped', !by('facebook:c:fc3').id && r.length === 11, `got ${r.length}`);

  console.log('\n— /api/inbox —');
  let res = await readInbox();
  ok('no INBOX_KEY on the server → 503', res.status === 503);
  process.env.INBOX_KEY = 'inbox-key';
  res = await readInbox('', 'wrong-key');
  ok('a wrong key → 401', res.status === 401);
  res = await readInbox('?since=not-a-date');
  ok('a bad since → 400', res.status === 400);
  res = await readInbox();
  const th = res.body.threads || [];
  const anna = th.find(x => x.sender === 'Uanna');
  ok('threads grouped per person', th.length === 7, `got ${th.length}`);
  ok('a thread carries its sort result', anna && anna.sorted && anna.sorted.lane === 'hot' && anna.alerted === true);
  ok('instant mode and signature failures reported', res.body.instant === true && res.body.lineBadSignatures === 1);
  const ig = th.find(x => x.sender === 'IGSID9');
  ok('our IG reply shows in its thread', ig && ig.messages.length === 2 && ig.messages[1].from === 'aybkk');

  const mark = new Date().toISOString();
  await wait(50);
  aiAnswer = { lane: 'hot', summary: 'x', reply: 'y' };
  await lineSend([lineText('m5', 'Uanna', 'Also, do you have mats?')]);
  await wait(50);
  res = await readInbox(`?since=${encodeURIComponent(mark)}`);
  const anna2 = (res.body.threads || []).find(x => x.sender === 'Uanna');
  ok('since returns only threads with news, with earlier context', res.body.threads.length === 1 &&
    anna2.new === 1 && anna2.messages.length === 3 && anna2.messages[0].new === false);
  ok('an unsorted newer message hides the stale sort result', anna2.sorted === null);

  console.log('\n— In-Depth Mysore applications —');
  await wait(400);   // let the last LINE burst finish its sort and ping first
  let ipN = 0;
  const apply = (body, ip = `10.0.0.${++ipN}`) => fetch(B + '/api/in-depth/apply', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify(body) });
  const good = (over = {}) => ({ name: 'Mei', email: 'Mei@Example.com', contact: 'WeChat mei123', country: 'China',
    call_lang: 'zh', primary: 'yes', rooms: 'yes', dates: 'yes', years: '6', mornings: 6, series: 'intermediate',
    teaching: 'yes', teach: 'A small Mysore room, 2 years', why: 'I want to understand why my students stop coming.',
    stuck: 'Kapotasana, for two years.', injury: '', video: 'https://youtu.be/abc123', heard: 'Instagram',
    question: '', consent: true, list: 'gen3-zh', website: '', ...over });
  const applied = async () => (await pool.query(`SELECT * FROM aybkk_inbox WHERE channel='apply' ORDER BY id`)).rows;
  const aiBefore = aiCalls.length, alertsBefore = alerts.length;

  let ar = await apply(good());
  let aj = await ar.json();
  await wait(100);
  let ap = await applied();
  ok('a good application is stored on channel apply', ar.status === 200 && aj.ok === true && ap.length === 1 &&
    ap[0].kind === 'application' && ap[0].direction === 'in', `${ar.status} ${JSON.stringify(aj)} ${ap.length}`);
  ok('one thread per email, named, with the video as ref', ap[0].sender_id === 'mei@example.com' &&
    ap[0].sender_name === 'Mei' && ap[0].ref === 'https://youtu.be/abc123');
  ok('the stored text names the list and carries every answer',
    /^In-Depth Mysore application, list gen3-zh \(Generation #3, the private Chinese page\)\n/.test(ap[0].text) &&
    /All 30 days in person: yes/.test(ap[0].text) && /Series now: Intermediate/.test(ap[0].text) && /Why this course, and why now:\nI want to understand/.test(ap[0].text) &&
    /Practice video:\nhttps:\/\/youtu.be\/abc123/.test(ap[0].text) && !/Pain or injury/.test(ap[0].text));
  ok('marked hot without an AI call, with the list stored', ap[0].triage && ap[0].triage.lane === 'hot' &&
    ap[0].triage.list === 'gen3-zh' && /list gen3-zh/.test(ap[0].triage.summary) && aiCalls.length === aiBefore);
  const ping = alerts[alerts.length - 1] || '';
  ok('one Telegram ping with country and fit only, no name', alerts.length === alertsBefore + 1 &&
    /^New In-Depth Mysore application, list gen3-zh \(Generation #3, the private Chinese page\), from China\n/.test(ping) &&
    /All 30 days: yes\. Call in Chinese\./.test(ping) && !ping.includes('Mei') &&
    !/mei123|example\.com|youtu|students stop/i.test(ping), ping);
  ok('the ping time is saved', !!ap[0].alerted_at);

  ar = await apply(good({ email: 'li@example.cn', name: 'Li', video: '链接: https://pan.baidu.com/s/1AbC-x 提取码: x1y2 \n--来自百度网盘的分享' }));
  ap = await applied();
  ok('a Baidu share text is accepted; the link is pulled out and the code kept', ar.status === 200 &&
    ap[1].ref === 'https://pan.baidu.com/s/1AbC-x' && /提取码: x1y2/.test(ap[1].text));

  // The public English page joins the priority list: no Gen #3 dates question.
  const en = good({ list: 'priority-en', email: 'anna@example.de', name: 'Anna', country: 'Germany', call_lang: 'en' });
  delete en.dates;
  let pingsBefore = alerts.length;
  ar = await apply(en);
  await wait(100);
  ap = await applied();
  let enRow = ap[ap.length - 1];
  ok('an English priority-list application needs no dates answer', ar.status === 200 && enRow.sender_id === 'anna@example.de',
    String(ar.status));
  ok('its text and triage say priority-en, with no 30-day line', enRow.triage.list === 'priority-en' &&
    /^In-Depth Mysore application, list priority-en \(priority list for the next English intake, the public English page\)\n/.test(enRow.text) &&
    !/30 days/.test(enRow.text) && !/30 days/.test(enRow.triage.summary), enRow.text.split('\n')[0]);
  const enPing = alerts[alerts.length - 1] || '';
  ok('its ping names the list and leaves out the dates', alerts.length === pingsBefore + 1 &&
    /^New In-Depth Mysore application, list priority-en \(priority list for the next English intake, the public English page\), from Germany\n/.test(enPing) &&
    !/30 days/.test(enPing) && /Call in English\./.test(enPing) && !enPing.includes('Anna'), enPing);
  ar = await apply(good({ list: 'priority-en', email: 'ben@example.de', dates: 'no' }));
  ap = await applied();
  enRow = ap[ap.length - 1];
  ok('a dates answer sent to the English list is not asked there, so it is dropped', ar.status === 200 &&
    enRow.sender_id === 'ben@example.de' && !/30 days/.test(enRow.text));

  const n = (await applied()).length;
  const fails = async (body, status, field, name) => {
    const r = await apply(body), j = await r.json();
    ok(name, r.status === status && (j.fields || []).includes(field) && (await applied()).length === n,
      `${r.status} ${JSON.stringify(j)}`);
  };
  const noVideo = good(); delete noVideo.video;
  await fails(noVideo, 400, 'video', 'no video link → 400, nothing stored');
  await fails(good({ video: 'my video is on my phone' }), 400, 'video', 'a video answer with no link → 400');
  await fails(good({ video: 'http://youtu.be/abc' }), 400, 'video', 'an http:// link → 400');
  await fails(good({ email: 'mei@example' }), 400, 'email', 'a bad email → 400');
  await fails(good({ consent: 'yes' }), 400, 'consent', 'consent must be a real tick → 400');
  await fails(good({ why: 'x'.repeat(2001) }), 400, 'why', 'a 2,001-character answer → 400');
  await fails(good({ name: 'N'.repeat(101) }), 400, 'name', 'a 101-character name → 400');
  await fails(good({ years: '6 years' }), 400, 'years', 'years must be a number → 400');
  await fails(good({ series: 'third' }), 400, 'series', 'an unknown series → 400');
  await fails(good({ mornings: '8' }), 400, 'mornings', '8 mornings a week → 400');
  await fails(good({ years: '61' }), 400, 'years', '61 years → 400');
  for (const k of ['contact', 'why', 'stuck']) await fails(good({ [k]: '  ' }), 400, k, `an empty ${k} → 400`);
  await fails(good({ primary: 'not_yet' }), 422, 'primary', 'Primary not yet by heart → 422, below the bar');
  await fails(good({ rooms: 'not_yet' }), 422, 'rooms', 'no Mysore or led classes yet → 422');
  await fails(good({ dates: 'no' }), 422, 'dates', 'cannot come all 30 days → 422');
  const noDates = good(); delete noDates.dates;
  await fails(noDates, 400, 'dates', 'Generation #3 without the dates answer → 400');
  const noList = good(); delete noList.list;
  await fails(noList, 400, 'list', 'no list → 400');
  await fails(good({ list: 'gen4-zh' }), 400, 'list', 'an unknown list → 400');
  await fails(good({ list: ['gen3-zh'] }), 400, 'list', 'a list sent as an array → 400');
  await fails(good({ list: 'toString' }), 400, 'list', 'an inherited key is not a list → 400');

  const big = JSON.stringify(good({ email: 'big@example.com', filler: 'x'.repeat(70 * 1024) }));
  ar = await fetch(B + '/api/in-depth/apply', { method: 'POST', duplex: 'half',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.7.7.7' },
    body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } }) });
  ok('a body over 64 KB, even sent in chunks → 413, nothing stored', ar.status === 413 && (await applied()).length === n,
    String(ar.status));
  for (const [i, p] of ['/api/in-depth/apply/', '/API/In-Depth/Apply'].entries()) {
    ar = await fetch(B + p, { method: 'POST', body: big,
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.7.8.${i}` } });
    ok(`the 64 KB limit also holds at ${p} → 413`, ar.status === 413 && (await applied()).length === n, String(ar.status));
  }
  ar = await fetch(B + '/api/in-depth/apply', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.7.7.8' }, body: '{"name":"<b>Mei</b>",' });
  const badJson = await ar.text();
  ok('broken JSON → 400 with no echo', ar.status === 400 && !/Mei/.test(badJson), badJson);

  const before = alerts.length;
  ar = await apply(good({ website: 'http://spam.example' }));
  aj = await ar.json();
  await wait(50);
  ok('a filled honeypot looks accepted but stores and pings nothing', ar.status === 200 && aj.ok === true &&
    (await applied()).length === n && alerts.length === before);

  ar = await apply(good({ email: 'bad', name: '<script>alert(1)</script>' }));
  const errText = await ar.text();
  ok('an error answer names fields only, never echoes input', ar.status === 400 && !/script|alert/.test(errText), errText);

  const evil = '<img src=x onerror=alert(1)>', evilWhy = '<script>alert("x")</script> & "quotes"';
  ar = await apply(good({ email: 'x@example.org', name: evil, why: evilWhy + '‮\u0007' }));
  const okText = await ar.text();
  ok('a good answer is exactly {"ok":true}', ar.status === 200 && okText === '{"ok":true}', okText);
  ap = await applied();
  const evilRow = ap[ap.length - 1];
  ok('text is stored as typed (escaping is the reader\'s job), control and bidi characters dropped',
    evilRow.sender_name === evil && evilRow.text.includes(evilWhy) &&
    !/[‮\u0007]/.test(evilRow.text));
  res = await readInbox(`?since=${encodeURIComponent(mark)}`);
  const ir = await fetch(B + '/api/inbox', { headers: { 'x-inbox-key': 'inbox-key' } });
  ok('the inbox serves applications as JSON, never as HTML', /^application\/json/.test(ir.headers.get('content-type')));
  const at = (res.body.threads || []).filter(x => x.channel === 'apply');
  const atEvil = at.find(x => x.sender === 'x@example.org');
  ok('applications show in GET /api/inbox, hot, with the video link and the list', at.length === 5 &&
    at.find(x => x.sender === 'anna@example.de').sorted.list === 'priority-en' &&
    at.find(x => x.sender === 'mei@example.com').sorted.list === 'gen3-zh' &&
    at.every(x => x.sorted && x.sorted.lane === 'hot') && at.find(x => x.sender === 'mei@example.com').messages[0].ref === 'https://youtu.be/abc123',
    JSON.stringify(at.map(x => x.sender)));
  ok('the JSON string round-trips exactly', atEvil && atEvil.name === evil && atEvil.messages[0].text.includes(evilWhy));

  const realFetch = global.fetch;
  let tgBody = null;
  process.env.TELEGRAM_BOT_TOKEN = 't'; process.env.BOONCHU_CHAT_ID = 'c';
  global.fetch = async (url, init) => { tgBody = JSON.parse(init.body); return { ok: true }; };
  try { await telegram(`New In-Depth Mysore application\n${evil}, China`); } finally { global.fetch = realFetch; }
  delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.BOONCHU_CHAT_ID;
  ok('Telegram gets plain text (no parse_mode) and shows no link previews',
    tgBody && !('parse_mode' in tgBody) && tgBody.text.includes(evil) && tgBody.link_preview_options?.is_disabled === true);

  ar = await apply(good({ email: 'nl@example.com', name: 'Line\nTwo', country: 'https://evil.example/verify' }));
  await wait(50);
  ap = await applied();
  ok('a name stays on one line', ar.status === 200 && ap[ap.length - 1].sender_name === 'Line Two' &&
    /\nName: Line Two\n/.test(ap[ap.length - 1].text));
  ok('a link typed as the country stays out of the ping', /from \(see the inbox\)\n/.test(alerts[alerts.length - 1]) &&
    !/evil/.test(alerts[alerts.length - 1]), alerts[alerts.length - 1]);

  for (let i = 0; i < 3; i++) await apply(good({ email: 'same@example.com', name: `S${i}` }));
  ar = await apply(good({ email: 'SAME@example.com', name: 'S3' }));
  ok('a 4th application from one email in a day → 429', ar.status === 429 &&
    (await applied()).filter(x => x.sender_id === 'same@example.com').length === 3);

  const seed = (count, alerted) => pool.query(`INSERT INTO aybkk_inbox
      (channel, kind, direction, ext_id, sender_id, sender_name, text, sent_at, alerted_at)
    SELECT 'apply', 'application', 'in', 'apply:seed-' || $1 || '-' || g, 'seed-' || $1 || '-' || g || '@example.com',
      'Seed', 'seed', now(), CASE WHEN $2 THEN now() END FROM generate_series(1, $3::int) g`,
    [crypto.randomUUID(), alerted, count]);
  const pinged = async () => (await pool.query(`SELECT count(*)::int AS c FROM aybkk_inbox
    WHERE channel='apply' AND alerted_at > now() - interval '1 hour'`)).rows[0].c;
  await seed(10 - await pinged(), true);
  let pings = alerts.length;
  ar = await apply(good({ email: 'p1@example.com' }));
  await wait(100);
  ok('after 10 pings in an hour, one note says pings pause', ar.status === 200 && alerts.length === pings + 1 &&
    /Pings pause/.test(alerts[alerts.length - 1]), alerts[alerts.length - 1]);
  ar = await apply(good({ email: 'p2@example.com' }));
  await wait(100);
  ok('then applications are still saved, with no ping', ar.status === 200 && alerts.length === pings + 1 &&
    (await applied()).some(x => x.sender_id === 'p2@example.com'));

  const hourCount = async () => (await pool.query(`SELECT count(*)::int AS c FROM aybkk_inbox
    WHERE channel='apply' AND created_at > now() - interval '1 hour'`)).rows[0].c;
  await seed(200 - await hourCount(), false);
  ar = await apply(good({ email: 'late@example.com' }));
  ok('200 applications in an hour from everywhere, then 429', ar.status === 429 &&
    !(await applied()).some(x => x.sender_id === 'late@example.com'), String(ar.status));

  const statuses = [];
  for (let i = 0; i < 11; i++) statuses.push((await apply({}, '10.9.9.9')).status);
  ok('10 tries an hour from one address, valid or not, then 429', statuses.slice(0, 10).every(s => s === 400) &&
    statuses[10] === 429, statuses.join(','));
  ar = await apply(good({ email: 'other@example.com' }), '10.9.9.9');
  ok('the address stays blocked even for a good application', ar.status === 429);

  console.log('\n— keeping the priority list —');
  const oldRow = (ext, channel, list) => pool.query(`INSERT INTO aybkk_inbox
      (channel, kind, direction, ext_id, sender_id, sender_name, text, sent_at, created_at, triage)
    VALUES ($1, $2, 'in', $3, $4, 'Old', 'old', now() - interval '91 days', now() - interval '91 days', $5)`,
    [channel, channel === 'apply' ? 'application' : 'dm', `old:${ext}`, `${ext}@example.com`,
      list ? { lane: 'hot', list, summary: `old ${list}`, reply: '' } : null]);
  await oldRow('old-en', 'apply', 'priority-en');
  await oldRow('old-zh', 'apply', 'gen3-zh');
  await oldRow('old-bare', 'apply', null);
  await oldRow('old-chat', 'line', null);
  await inbox.purge();
  const left = (await pool.query(`SELECT ext_id FROM aybkk_inbox WHERE ext_id LIKE 'old:%'`)).rows.map(r => r.ext_id);
  ok('after 90 days the purge keeps priority-list applications and deletes the rest',
    left.length === 1 && left[0] === 'old:old-en', JSON.stringify(left));

  await pool.query(`INSERT INTO aybkk_inbox (channel, kind, direction, ext_id, sender_id, sender_name, text, ref, sent_at, triage)
    VALUES ('apply', 'application', 'in', 'apply:anna-again', 'anna@example.de', 'Anna K', 'second try',
      'https://youtu.be/anna2', now(), $1)`, [{ lane: 'hot', list: 'priority-en', summary: 'second', reply: '' }]);
  const readList = async (qs, key = 'inbox-key') => {
    const r = await fetch(B + '/api/inbox/applications' + qs, { headers: key ? { 'x-inbox-key': key } : {} });
    return { status: r.status, body: await r.json() };
  };
  ok('the list needs the inbox key', (await readList('?list=priority-en', null)).status === 401 &&
    (await readList('?list=priority-en', 'wrong')).status === 401);
  ok('an unknown list → 400', (await readList('?list=nope')).status === 400 &&
    (await readList('?list=priority-en&list=gen3-zh')).status === 400);
  const pl = (await readList('?list=priority-en')).body;
  const places = (pl.applications || []).map(x => `${x.place}:${x.email}:${x.tries}`);
  ok('the priority list comes in the order people joined, one place per email, the 91-day-old one first',
    pl.list === 'priority-en' && pl.count === 3 &&
    places.join(',') === '1:old-en@example.com:1,2:anna@example.de:2,3:ben@example.de:1', places.join(','));
  const annaEntry = (pl.applications || [])[1] || {};
  ok('a second try keeps the first place and shows the latest answers', annaEntry.name === 'Anna K' &&
    annaEntry.text === 'second try' && annaEntry.video === 'https://youtu.be/anna2' && new Date(annaEntry.joined) < new Date(annaEntry.last));
  const zl = (await readList('?list=gen3-zh')).body;
  ok('the Gen #3 list holds only its own applications', zl.count > 0 &&
    zl.applications.every(x => !['anna@example.de', 'ben@example.de', 'old-en@example.com'].includes(x.email)) &&
    !zl.applications.some(x => x.email === 'old-zh@example.com'));


  const bare = express();
  mountInbox(bare, {});
  const srv2 = bare.listen(0);
  ar = await fetch(`http://127.0.0.1:${srv2.address().port}/api/in-depth/apply`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(good()) });
  ok('with no database the form answers 503', ar.status === 503);
  srv2.close();

  srv.close();
  await pool.end();
  console.log(`\n${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
