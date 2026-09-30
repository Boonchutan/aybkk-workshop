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
const { mountInbox } = require('../inbox.js');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ||
  'postgres://test:test@127.0.0.1:5432/inboxtest' });

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
  await pool.query('DROP TABLE IF EXISTS aybkk_inbox, bkk_class_slots CASCADE');
  await pool.query(`CREATE TABLE bkk_class_slots (id SERIAL PRIMARY KEY, code TEXT, title TEXT, weekday INTEGER,
    start_time TEXT, is_online BOOLEAN DEFAULT false, active BOOLEAN DEFAULT true)`);
  await pool.query(`INSERT INTO bkk_class_slots (code, title, weekday, start_time, is_online) VALUES
    ('a','Mysore (1st batch)',1,'05:30',false), ('b','Mysore (1st batch)',2,'05:30',false),
    ('c','[Online] Led Primary series',1,'06:30',true)`);

  const app = express();
  app.use(express.json({ verify: (req, res, buf) => {
    if (/^\/(line|meta)\/webhook/.test(req.url)) req.rawBody = buf;
  } }));
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

  srv.close();
  await pool.end();
  console.log(`\n${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
