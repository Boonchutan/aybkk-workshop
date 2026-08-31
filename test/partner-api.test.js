// End-to-end test of partner-api against a real Postgres.
// The two things this file exists to prove:
//   1. the money is right to the fen, through the API, not just in the pure engine
//   2. a partner_viewer for one location can get NOTHING from any other location
const crypto = require('crypto');
const express = require('express');
const { Pool } = require('pg');
const { mountPartner } = require('../partner-api.js');
const { fen } = require('../partner-money.js');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ||
  'postgres://test:test@127.0.0.1:5432/bkktest' });
const app = express();
app.use(express.json());

let PASS = 0, FAIL = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name} ${extra}`); }
};
const sha = k => crypto.createHash('sha256').update(k).digest('hex');

(async () => {
  mountPartner(app, { pgPool: pool });
  await new Promise(r => setTimeout(r, 1500));
  const srv = app.listen(0);
  const B = `http://127.0.0.1:${srv.address().port}`;
  const J = async (path, key, opts = {}) => {
    const r = await fetch(B + path, { ...opts,
      headers: { 'Content-Type': 'application/json',
        ...(key ? { 'x-loc-key': key } : {}), ...(opts.headers || {}) } });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch (_) { body = { raw: text }; }
    return { status: r.status, body, text };
  };
  const post = (p, key, body) => J(p, key, { method: 'POST', body: JSON.stringify(body || {}) });
  const put = (p, key, body) => J(p, key, { method: 'PUT', body: JSON.stringify(body || {}) });

  // ── fixtures: two locations, one user of every role ───────────────────────
  await pool.query(`DELETE FROM loc_audit; DELETE FROM loc_statement_comments;
    DELETE FROM loc_statements; DELETE FROM loc_payments; DELETE FROM loc_settings;
    DELETE FROM loc_users; DELETE FROM locations;`);
  const cd = (await pool.query(`INSERT INTO locations (code,name_en,name_zh,currency,tz)
    VALUES ('chengdu','AYBKK Chengdu (NaSaDi)','AYBKK 成都 (纳萨蒂)','CNY','Asia/Shanghai')
    RETURNING id`)).rows[0].id;
  const other = (await pool.query(`INSERT INTO locations (code,name_en,currency,tz)
    VALUES ('testcity','Test City','CNY','Asia/Shanghai') RETURNING id`)).rows[0].id;
  const mkUser = async (role, name, locId, key) => (await pool.query(
    `INSERT INTO loc_users (location_id,role,name,lang,key_hash)
     VALUES ($1,$2,$3,'zh',$4) RETURNING id`, [locId, role, name, sha(key)])).rows[0].id;
  const OWNER = 'k-owner', MGR = 'k-mgr', ADMIN = 'k-louhan', FEIFEI = 'k-feifei', OTHERV = 'k-otherv';
  await mkUser('aybkk_owner', 'Boonchu', null, OWNER);
  await mkUser('aybkk_manager', 'Manager', null, MGR);
  await mkUser('location_admin', 'Lou Han', cd, ADMIN);
  await mkUser('partner_viewer', 'Feifei', cd, FEIFEI);
  await mkUser('partner_viewer', 'Other Partner', other, OTHERV);
  // one payment in the OTHER location — the thing Feifei must never see
  await pool.query(
    `INSERT INTO loc_payments (location_id,payer_name,amount_fen,currency,method,status,
       collected_by,confirmed_at) VALUES ($1,'SECRET STUDENT',$2,'CNY','cash','confirmed','AYBKK',now())`,
    [other, fen(9999)]);

  console.log('\n— sign in —');
  ok('no key → 401', (await post('/api/loc/login', null)).status === 401);
  ok('wrong key → 401', (await post('/api/loc/login', 'nope')).status === 401);
  const fe = await post('/api/loc/login', FEIFEI);
  ok('Feifei signs in, sees her role and location',
     fe.body.user.role === 'partner_viewer' && fe.body.user.location.code === 'chengdu',
     JSON.stringify(fe.body));

  console.log('\n— money through the API (September, Chengdu) —');
  const pay = async (yuan, method, collectedBy, payer) => {
    const r = await post('/api/loc/chengdu/payments', ADMIN,
      { amountFen: fen(yuan), method, collectedBy, payerName: payer });
    await post(`/api/loc/chengdu/payments/${r.body.payment.id}/confirm`, ADMIN);
    return r.body.payment.id;
  };
  await pay(3000, 'wechat_pay', 'PARTNER', '王小雨');   // 3,000 into NaSaDi's WeChat
  await pay(2000, 'alipay', 'PARTNER', '李梅');          // 2,000 into NaSaDi's Alipay
  await pay(4000, 'bank', 'AYBKK', '陈强');             // 4,000 into AYBKK's account
  const toRefund = await pay(1000, 'cash', 'PARTNER', '退款测试');
  const rf = await post(`/api/loc/chengdu/payments/${toRefund}/refund`, ADMIN,
    { amountFen: fen(1000), reason: 'class cancelled' });
  ok('refund is a new negative confirmed row', rf.status === 200 &&
     Number(rf.body.refund.amount_fen) === -fen(1000), JSON.stringify(rf.body).slice(0, 120));
  const over = await post(`/api/loc/chengdu/payments/${toRefund}/refund`, ADMIN,
    { amountFen: 1, reason: 'again' });
  ok('cannot refund more than the original', over.status === 400, JSON.stringify(over.body));

  const month = new Date().toISOString().slice(0, 7);
  const st = await post(`/api/loc/chengdu/statements/${month}`, OWNER);
  const t = st.body.statement.totals;
  // gross = 3000+2000+4000+1000−1000 = 9,000. NaSaDi 30% = 2,700. AYBKK 6,300.
  // NaSaDi collected 3000+2000+1000−1000 = 5,000 → transfers 5,000−2,700 = 2,300.
  ok('gross ¥9,000', t.grossFen === fen(9000), String(t.grossFen));
  ok('NaSaDi share ¥2,700', t.partnerFen === fen(2700), String(t.partnerFen));
  ok('AYBKK share ¥6,300', t.aybkkFen === fen(6300));
  ok('shares sum to gross exactly', t.partnerFen + t.aybkkFen === t.grossFen);
  ok('collected by partner ¥5,000', t.collectedByPartnerFen === fen(5000), String(t.collectedByPartnerFen));
  ok('net transfer: NaSaDi sends ¥2,300', t.netFen === fen(2300), String(t.netFen));
  ok('refund counted', t.refundCount === 1);

  console.log('\n— the snapshot: old statements never change —');
  await post(`/api/loc/chengdu/statements/${month}/issue`, OWNER);
  const flip = await put('/api/loc/chengdu/settings', OWNER,
    { pcts: { daily_aybkk_pct: 6000, daily_partner_pct: 4000 } });
  ok('owner changes the split to 60/40', flip.status === 200, JSON.stringify(flip.body));
  const after = await J(`/api/loc/chengdu/statements/${month}`, OWNER);
  ok('the ISSUED statement still shows 70/30 and ¥2,700',
     after.body.statement.pct_snapshot.daily_partner_pct === 3000 &&
     after.body.statement.totals.partnerFen === fen(2700),
     JSON.stringify(after.body.statement.pct_snapshot));
  const reissue = await post(`/api/loc/chengdu/statements/${month}`, OWNER);
  ok('an issued statement refuses to be recomputed', reissue.status === 409,
     JSON.stringify(reissue.body));
  const summary = await J('/api/loc/chengdu/summary', OWNER);
  ok('the live summary DOES use the new 40%',
     summary.body.totals.partnerFen === fen(3600), String(summary.body.totals.partnerFen));
  ok('a bad split (70/40) is refused',
     (await put('/api/loc/chengdu/settings', OWNER,
        { pcts: { daily_aybkk_pct: 7000, daily_partner_pct: 4000 } })).status === 400);

  console.log('\n— role walls —');
  ok('manager cannot change splits',
     (await put('/api/loc/chengdu/settings', MGR, { pcts: {} })).status === 404);
  ok('location admin cannot change splits',
     (await put('/api/loc/chengdu/settings', ADMIN, { pcts: {} })).status === 404);
  ok('location admin cannot issue statements',
     (await post(`/api/loc/chengdu/statements/${month}/issue`, ADMIN)).status === 404);
  ok('partner cannot record a payment',
     (await post('/api/loc/chengdu/payments', FEIFEI,
        { amountFen: 100, method: 'cash', collectedBy: 'PARTNER' })).status === 404);
  ok('partner cannot confirm', (await post('/api/loc/chengdu/payments/1/confirm', FEIFEI)).status === 404);
  ok('partner cannot refund', (await post('/api/loc/chengdu/payments/1/refund', FEIFEI)).status === 404);
  ok('only the owner can create users',
     (await post('/api/loc/users', MGR, { role: 'partner_viewer', name: 'x', location: 'chengdu' })).status === 404);

  console.log('\n— what Feifei CAN do —');
  ok('read her payments', (await J('/api/loc/chengdu/payments', FEIFEI)).body.payments.length >= 5);
  ok('read her summary', (await J('/api/loc/chengdu/summary', FEIFEI)).status === 200);
  ok('read the statement', (await J(`/api/loc/chengdu/statements/${month}`, FEIFEI)).status === 200);
  // fetch .text() strips a leading BOM on decode, so the BOM check must read
  // the raw bytes: EF BB BF is what Excel actually receives.
  const csvR = await fetch(`${B}/api/loc/chengdu/statements/${month}/csv`,
    { headers: { 'x-loc-key': FEIFEI } });
  const csvBuf = Buffer.from(await csvR.arrayBuffer());
  ok('download the CSV, bilingual, with BOM',
     csvR.status === 200
       && csvBuf[0] === 0xEF && csvBuf[1] === 0xBB && csvBuf[2] === 0xBF
       && csvBuf.toString('utf8').includes('收款方'),
     csvBuf.slice(0, 12).toString('hex'));
  ok('read the audit log', (await J('/api/loc/chengdu/audit', FEIFEI)).body.audit.length > 5);
  const cm = await post(`/api/loc/chengdu/statements/${month}/comments`, FEIFEI,
    { body: '九月的数字我核对过了，没有问题。' });
  ok('leave a comment on the statement', cm.status === 200);
  const withC = await J(`/api/loc/chengdu/statements/${month}`, OWNER);
  ok('the comment is on the record, under her name',
     withC.body.comments.some(c => c.author === 'Feifei' && /核对/.test(c.body)));

  console.log('\n— ISOLATION: Feifei gets NOTHING from any other location —');
  for (const path of [
    '/api/loc/testcity/payments', '/api/loc/testcity/summary',
    '/api/loc/testcity/statements', `/api/loc/testcity/statements/${month}`,
    `/api/loc/testcity/statements/${month}/csv`, '/api/loc/testcity/audit',
    '/api/loc/testcity/settings',
  ]) {
    const r = await J(path, FEIFEI);
    ok(`404 for ${path}`, r.status === 404, `got ${r.status}`);
    ok(`...and no data leaked in the body of ${path}`,
       !JSON.stringify(r.body).includes('SECRET') && !JSON.stringify(r.body).includes('9999'));
  }
  ok('her locations list contains exactly one location',
     (await J('/api/loc/locations', FEIFEI)).body.locations.length === 1);
  ok('a made-up location is the same 404 as a forbidden one',
     (await J('/api/loc/nowhere/summary', FEIFEI)).status === 404);
  ok("the other location's partner cannot see Chengdu either",
     (await J('/api/loc/chengdu/summary', OTHERV)).status === 404);

  console.log('\n— the audit trail —');
  const aud = (await J('/api/loc/chengdu/audit', OWNER)).body.audit;
  ok('settings change recorded with before and after',
     aud.some(a => a.action === 'settings.change' &&
       a.before.daily_partner_pct === 3000 && a.after.daily_partner_pct === 4000));
  ok('refund recorded', aud.some(a => a.action === 'payment.refund'));
  ok('statement issue recorded', aud.some(a => a.action === 'statement.issue'));
  ok("Feifei's comment recorded", aud.some(a => a.action === 'statement.comment'));

  console.log(`\n${PASS} passed, ${FAIL} failed`);
  srv.close(); await pool.end();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
