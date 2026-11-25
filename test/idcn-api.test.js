// In-Depth Mysore course API against a real Postgres. Proves:
//   1. the v3 ฿199,000 discount math to the satang, all six combinations
//   2. the v4 price: ฿180,000 + 7% VAT = ฿192,600, options A and B, no discounts
//   3. a student who signed v3 (or earlier) keeps exactly their terms; only a
//      student who has not signed gets v4
//   4. a student's named link opens with their passcode and nobody else's
//   5. consent is complete-or-nothing, recorded once with the version on screen
//   6. payment proofs uploaded by admin appear on the student's profile
//   7. a later wording bump, or a deploy that overlaps the old instance, never
//      moves a signature onto other terms
//   8. a student who paid before having an option of their terms can't sign
//      until admin confirms one, and the plan on screen is kept with the signature
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const express = require('express');
const { Pool } = require('pg');
const { mountIdcn, quote, applyPct, planError, termsFor, IDCN3_TERMS, IDCN3_TERMS_V4,
  IDCN3_POLICY_VERSION, TERMS_BY_POLICY } = require('../idcn-api.js');

process.env.BKK_ADMIN_KEY = 'test-admin';
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ||
  'postgres://test:test@127.0.0.1:5432/bkktest' });
const app = express();
app.use(express.json({ limit: '10mb' }));

let PASS = 0, FAIL = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name} ${extra}`); }
};
const B_THB = 100; // satang per baht

(async () => {
  console.log('\n— the money: ฿199,000 with stacked discounts (option first, then 3%) —');
  const t = IDCN3_TERMS;
  ok('option 1 plain: ฿179,100', quote(t, 1, false).totalSatang === 179100 * B_THB);
  ok('option 2 plain: ฿189,050', quote(t, 2, false).totalSatang === 189050 * B_THB);
  ok('option 3 plain: ฿199,000', quote(t, 3, false).totalSatang === 199000 * B_THB);
  ok('option 1 + attendee: ฿173,727 (90% then 97%)',
     quote(t, 1, true).totalSatang === 17372700, String(quote(t, 1, true).totalSatang));
  ok('option 2 + attendee: ฿183,378.50 exactly',
     quote(t, 2, true).totalSatang === 18337850, String(quote(t, 2, true).totalSatang));
  ok('option 3 + attendee: ฿193,030',
     quote(t, 3, true).totalSatang === 19303000);
  const o3 = quote(t, 3, false);
  ok('option 3 split: deposit ฿119,400 + cash ฿79,600 = total',
     o3.depositSatang === 11940000 && o3.cashSatang === 7960000
       && o3.depositSatang + o3.cashSatang === o3.totalSatang);
  const o3a = quote(t, 3, true);
  ok('option 3 + attendee split: ฿115,818 + ฿77,212 = ฿193,030',
     o3a.depositSatang === 11581800 && o3a.cashSatang === 7721200
       && o3a.depositSatang + o3a.cashSatang === o3a.totalSatang);
  ok('discounts are listed separately, never summed into a fake percentage',
     JSON.stringify(quote(t, 1, true).discounts) === '[10,3]'
       && JSON.stringify(quote(t, 3, false).discounts) === '[]');
  ok('fractional satang floors toward the student', applyPct(101, 3) === 97); // 101*.97=97.97
  let threw = false; try { applyPct(1.5, 3); } catch (_) { threw = true; }
  ok('float amounts are refused', threw);

  // what main returned for every v3 combination before v4 existed, verbatim
  const V3_QUOTES = {
    '1false': '{"option":1,"listSatang":19900000,"totalSatang":17910000,"discounts":[10],"due":"2026-09-10","label_en":"100% by 10 Sep 2026","label_zh":"9月10日前全额支付"}',
    '1true': '{"option":1,"listSatang":19900000,"totalSatang":17372700,"discounts":[10,3],"due":"2026-09-10","label_en":"100% by 10 Sep 2026","label_zh":"9月10日前全额支付"}',
    '2false': '{"option":2,"listSatang":19900000,"totalSatang":18905000,"discounts":[5],"due":"2026-09-16","label_en":"100% by 16 Sep 2026","label_zh":"9月16日前全额支付"}',
    '2true': '{"option":2,"listSatang":19900000,"totalSatang":18337850,"discounts":[5,3],"due":"2026-09-16","label_en":"100% by 16 Sep 2026","label_zh":"9月16日前全额支付"}',
    '3false': '{"option":3,"listSatang":19900000,"totalSatang":19900000,"discounts":[],"due":"2026-09-20","label_en":"60% by 20 Sep 2026 + 40% THB cash on 10 Jan 2027 at AYBKK","label_zh":"9月20日前支付60% + 2027年1月10日在AYBKK以泰铢现金支付40%","depositSatang":11940000,"cashSatang":7960000,"cashDue":"2027-01-10"}',
    '3true': '{"option":3,"listSatang":19900000,"totalSatang":19303000,"discounts":[3],"due":"2026-09-20","label_en":"60% by 20 Sep 2026 + 40% THB cash on 10 Jan 2027 at AYBKK","label_zh":"9月20日前支付60% + 2027年1月10日在AYBKK以泰铢现金支付40%","depositSatang":11581800,"cashSatang":7721200,"cashDue":"2027-01-10"}',
  };
  ok('v3 quotes are byte for byte what they were before v4 (all six)',
     [1, 2, 3].every(o => [false, true].every(a =>
       JSON.stringify(quote(t, o, a)) === V3_QUOTES[`${o}${a}`])));

  console.log('\n[v4 money: ฿180,000 + 7% VAT, one price, no discounts]');
  const t4 = IDCN3_TERMS_V4;
  ok('the current policy version is idcn3-v4', IDCN3_POLICY_VERSION === 'idcn3-v4');
  const qa = quote(t4, 4, false), qb = quote(t4, 5, false);
  ok('fee ฿180,000 + VAT ฿12,600 = ฿192,600 (19,260,000 satang)',
     qa.netSatang === 18000000 && qa.vatSatang === 1260000 && qa.totalSatang === 19260000
       && qa.listSatang === 19260000 && qa.vatPct === 7, JSON.stringify(qa));
  ok('option A: 19,260,000 satang in one payment by 10 Dec 2026',
     qa.code === 'A' && JSON.stringify(qa.installments)
       === '[{"amountSatang":19260000,"due":"2026-12-10"}]', JSON.stringify(qa.installments));
  ok('option B: 9,630,000 by 10 Dec 2026 + 9,630,000 by 10 Jan 2027',
     qb.code === 'B' && qb.totalSatang === 19260000 && JSON.stringify(qb.installments)
       === '[{"amountSatang":9630000,"due":"2026-12-10"},{"amountSatang":9630000,"due":"2027-01-10"}]',
     JSON.stringify(qb.installments));
  ok('no discounts in v4: the attendee flag changes nothing',
     JSON.stringify(quote(t4, 4, true)) === JSON.stringify(qa)
       && JSON.stringify(quote(t4, 5, true)) === JSON.stringify(qb) && qa.discounts.length === 0);
  ok('the v3 options (1, 2, 3) do not exist in v4, and v4 keys never reuse them',
     [1, 2, 3].every(o => quote(t4, o, false) === null)
       && Object.keys(t4.options).every(k => !IDCN3_TERMS.options[k]));
  ok('every v4 money field is a whole satang', [qa, qb].every(q =>
     [q.netSatang, q.vatSatang, q.totalSatang, ...q.installments.map(p => p.amountSatang)]
       .every(Number.isSafeInteger)));
  const plan = [{ amountSatang: 10000000, due: '2026-12-10' }, { amountSatang: 9260000, due: '2027-01-05' }];
  ok('option C: a plan agreed on the call is used as typed when it adds up to ฿192,600',
     JSON.stringify(quote(t4, 6, false, plan).installments) === JSON.stringify(plan)
       && quote(t4, 6, false, plan).totalSatang === 19260000);
  ok('a plan that does not add up gives no quote, and says why',
     quote(t4, 6, false, [{ amountSatang: 18000000, due: '2026-12-10' }]) === null
       && /180,000 THB, but the course fee is 192,600 THB/.test(
         planError([{ amountSatang: 18000000, due: '2026-12-10' }], 19260000)));
  ok('a plan with a float amount, a bad date or 7 parts is refused',
     !!planError([{ amountSatang: 19259999.5, due: '2026-12-10' }, { amountSatang: 0.5, due: '2026-12-11' }], 19260000)
       && !!planError([{ amountSatang: 19260000, due: '2026-02-30' }], 19260000)
       && !!planError([{ amountSatang: 19260000, due: '10 Dec' }], 19260000)
       && !!planError(Array.from({ length: 7 }, () => ({ amountSatang: 2751428, due: '2026-12-10' })), 19260000)
       && planError(plan, 19260000) === null);

  console.log('\n[a later wording bump never moves a v4 signature]');
  ok('v4 terms are keyed by the literal version idcn3-v4; v1 to v3 read the stored terms',
     termsFor({ terms: IDCN3_TERMS }, 'idcn3-v4') === IDCN3_TERMS_V4
       && ['idcn3-v1', 'idcn3-v2', 'idcn3-v3'].every(v => termsFor({ terms: IDCN3_TERMS }, v) === IDCN3_TERMS)
       && Object.keys(TERMS_BY_POLICY).join() === 'idcn3-v4');
  ok('the current version has its own terms entry', TERMS_BY_POLICY[IDCN3_POLICY_VERSION] === IDCN3_TERMS_V4);
  const SRC_PATH = path.join(__dirname, '..', 'idcn-api.js');
  const SRC = fs.readFileSync(SRC_PATH, 'utf8');
  const loadSrc = code => {
    const m = new Module(SRC_PATH); m.filename = SRC_PATH; m.paths = module.paths;
    m._compile(code, SRC_PATH); return m.exports;
  };
  const bumped = SRC.replace("const IDCN3_POLICY_VERSION = 'idcn3-v4';", "const IDCN3_POLICY_VERSION = 'idcn3-v5';");
  let refused = ''; try { loadSrc(bumped); } catch (e) { refused = e.message; }
  ok('bumping the version without giving it terms refuses to load',
     bumped !== SRC && /idcn3-v5 has no entry/.test(refused), refused);
  const v5src = bumped.replace("const TERMS_BY_POLICY = { 'idcn3-v4': IDCN3_TERMS_V4 };",
    "const TERMS_BY_POLICY = { 'idcn3-v4': IDCN3_TERMS_V4, 'idcn3-v5': { ...IDCN3_TERMS_V4 } };");
  const v5 = loadSrc(v5src);
  const v5t = v5.termsFor({ terms: v5.IDCN3_TERMS }, 'idcn3-v4');
  ok('after a bump to v5, a v4 signature still gets the v4 terms (option B: 9,630,000 x 2)',
     v5src !== bumped && v5.IDCN3_POLICY_VERSION === 'idcn3-v5' && v5t === v5.IDCN3_TERMS_V4
       && JSON.stringify(v5.quote(v5t, 5, false)) === JSON.stringify(qb) && v5.quote(v5t, 1, false) === null);

  console.log('\n[v4 wording: no banned words]');
  const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'idcn.html'), 'utf8');
  const v4policy = HTML.slice(HTML.indexOf("'idcn3-v4': ["), HTML.indexOf('const MEDIA_PUBLIC'));
  const v4all = v4policy + JSON.stringify(IDCN3_TERMS_V4);
  ok('the v4 policy has all 8 clauses', (v4policy.match(/\{ k: '/g) || []).length === 8);
  ok('no certified, certification, 认证, 训练, 最, "both sessions", 两个阶段 or em dash in v4',
     !/certified|certification|认证|训练|最|both sessions|两个阶段|\u2014/i.test(v4all));
  ok('授权 only for the teachers\' own credential',
     (v4all.match(/授权/g) || []).length === 1 && /两位均获 R\. Sharath Jois 授权 Level 2/.test(v4all));
  ok('"training" and 培训 only in the denial',
     (v4all.match(/training/gi) || []).length === 1 && /This course is not a teacher training\./.test(v4all)
       && (v4all.match(/培训/g) || []).length === 1 && /本课程不是教师培训/.test(v4all));
  ok('the certificate is named "AYBKK Certificate of Completion, In-Depth Mysore"',
     /AYBKK Certificate of Completion, In-Depth Mysore\./.test(v4policy)
       && /AYBKK 深度迈索尔课程结业证书/.test(v4policy));

  mountIdcn(app, { pgPool: pool });
  await new Promise(r => setTimeout(r, 1200));
  await pool.query('DELETE FROM idc_notes; DELETE FROM idc_payments; DELETE FROM idc_consents; DELETE FROM idc_settings; DELETE FROM idc_students;');
  // a calendar left by an earlier run would show to the signers below
  await pool.query('DELETE FROM idc_sessions; DELETE FROM idc_days;');

  console.log('\n[deploy overlap: the old instance keeps stamping the wording it shows]');
  // main's boot leaves the row at idcn3-v3, and main stamps signatures from it
  await pool.query(`UPDATE idc_courses SET policy_version='idcn3-v3' WHERE code='idcn3'`);
  mountIdcn(express(), { pgPool: pool });
  await new Promise(r => setTimeout(r, 1200));
  ok('booting the new code leaves the course row at idcn3-v3 (every test below runs on that row)',
     (await pool.query(`SELECT policy_version FROM idc_courses WHERE code='idcn3'`)).rows[0].policy_version
       === 'idcn3-v3');
  const srv = app.listen(0);
  const B = `http://127.0.0.1:${srv.address().port}`;
  const J = async (path, opts = {}, headers = {}) => {
    const r = await fetch(B + path, { ...opts,
      headers: { 'Content-Type': 'application/json', ...headers } });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const A = { 'x-bkk-key': 'test-admin' };

  console.log('\n— admin creates students —');
  ok('no admin key → 401',
     (await J('/api/idcn/admin/idcn3/students', { method: 'POST', body: '{}' })).status === 401);
  const yy = await J('/api/idcn/admin/idcn3/students', { method: 'POST',
    body: JSON.stringify({ nameEn: 'Yang Yang', nameZh: '杨杨', isAttendee: true }) }, A);
  ok('Yang Yang created, slug from the latin name, passcode shown once',
     yy.status === 200 && yy.body.student.slug === 'yang-yang'
       && typeof yy.body.passcode === 'string' && yy.body.link === '/idcn3/yang-yang',
     JSON.stringify(yy.body).slice(0, 140));
  const YKEY = yy.body.passcode;
  const lm = await J('/api/idcn/admin/idcn3/students', { method: 'POST',
    body: JSON.stringify({ nameEn: 'Li Mei', nameZh: '李梅', slug: 'limei' }) }, A);
  const LKEY = lm.body.passcode, LID = lm.body.student.id;
  ok('duplicate slug refused with 409',
     (await J('/api/idcn/admin/idcn3/students', { method: 'POST',
        body: JSON.stringify({ nameEn: 'Another', slug: 'limei' }) }, A)).status === 409);

  console.log('\n— the passcode wall —');
  ok('no key → 401', (await J('/api/idcn/idcn3/students/yang-yang')).status === 401);
  ok('wrong key → 401',
     (await J('/api/idcn/idcn3/students/yang-yang', {}, { 'x-idcn-key': 'nope' })).status === 401);
  ok("Li Mei's key does not open Yang Yang's page",
     (await J('/api/idcn/idcn3/students/yang-yang', {}, { 'x-idcn-key': LKEY })).status === 401);
  const prof = await J('/api/idcn/idcn3/students/yang-yang', {}, { 'x-idcn-key': YKEY });
  ok('her own key opens her page', prof.status === 200 && prof.body.student.name_zh === '杨杨',
     JSON.stringify(prof.body).slice(0, 120));
  ok('a student who has not signed gets v4: policy idcn3-v4, the new name, sign by 10 Dec 2026',
     prof.body.course.policyVersion === 'idcn3-v4'
       && prof.body.course.name_en === 'In-Depth Mysore: the development of the practice · Generation #3'
       && prof.body.course.confirmBy === '2026-12-10' && prof.body.consent === null
       && prof.body.course.facts.length === 3, JSON.stringify(prof.body.course));
  ok('she is offered exactly options A and B at ฿192,600, no −3% though flagged attendee',
     JSON.stringify(prof.body.quotes) === JSON.stringify([qa, qb]) && prof.body.quote === null,
     JSON.stringify(prof.body.quotes));
  ok('no old discount option is offered to a new signer',
     prof.body.quotes.every(q => q.totalSatang === 19260000 && q.discounts.length === 0
       && ![1, 2, 3].includes(q.option)));
  ok('a made-up course is 404',
     (await J('/api/idcn/idcn9/students/yang-yang', {}, { 'x-idcn-key': YKEY })).status === 404);

  console.log('\n— enrolment: Jamsai sets the tier, the student only signs —');
  const YID = yy.body.student.id;
  const allTicked = {};
  for (const k of prof.body.requiredConsents) allTicked[k] = true;
  ok('a student has NO route to set their own option (Jamsai negotiates it)',
     (await J('/api/idcn/idcn3/students/yang-yang/option', { method: 'POST',
        body: JSON.stringify({ option: 1 }) }, { 'x-idcn-key': YKEY })).status === 404);
  const v3opt = await J(`/api/idcn/admin/idcn3/students/${YID}`, { method: 'PUT',
    body: JSON.stringify({ paymentOption: 2 }) }, A);
  ok('a v3 option cannot be set for a v4 student',
     v3opt.status === 400 && v3opt.body.error === 'option must be A, B or C', JSON.stringify(v3opt.body));
  ok('nor the v3 −3% attendee discount',
     (await J(`/api/idcn/admin/idcn3/students/${YID}`, { method: 'PUT',
        body: JSON.stringify({ isAttendee: true }) }, A)).status === 400);
  ok('admin sets her option to B',
     (await J(`/api/idcn/admin/idcn3/students/${YID}`, { method: 'PUT',
        body: JSON.stringify({ paymentOption: 'b' }) }, A)).status === 200);
  const V4 = { policyVersion: 'idcn3-v4' };
  const stale = await J('/api/idcn/idcn3/students/yang-yang/consent', { method: 'POST',
    body: JSON.stringify({ items: allTicked, signedName: '杨杨 Yang Yang' }) }, { 'x-idcn-key': YKEY });
  ok('a page that does not say which wording it showed cannot sign (a cached v3 page)',
     stale.status === 409 && stale.body.policyVersion === 'idcn3-v4', JSON.stringify(stale.body));
  ok('a page that showed the v3 wording cannot sign v4',
     (await J('/api/idcn/idcn3/students/yang-yang/consent', { method: 'POST',
        body: JSON.stringify({ policyVersion: 'idcn3-v3', items: allTicked, signedName: '杨杨 Yang Yang' }) },
        { 'x-idcn-key': YKEY })).status === 409);
  const partial = { ...allTicked, adjustments: false };
  const inc = await J('/api/idcn/idcn3/students/yang-yang/consent', { method: 'POST',
    body: JSON.stringify({ ...V4, items: partial, signedName: '杨杨 Yang Yang' }) }, { 'x-idcn-key': YKEY });
  ok('one missing tick refuses the whole signature',
     inc.status === 400 && inc.body.missing.includes('adjustments'), JSON.stringify(inc.body));
  ok('no signature name refused',
     (await J('/api/idcn/idcn3/students/yang-yang/consent', { method: 'POST',
        body: JSON.stringify({ ...V4, items: allTicked, signedName: ' ' }) },
        { 'x-idcn-key': YKEY })).status === 400);
  const signed = await J('/api/idcn/idcn3/students/yang-yang/consent', { method: 'POST',
    body: JSON.stringify({ ...V4, items: allTicked, signedName: '杨杨 Yang Yang',
      healthNote: '右肩旧伤 old right shoulder injury', mediaPublic: false }) },
    { 'x-idcn-key': YKEY });
  ok('full consent signs and confirms the spot',
     signed.status === 200 && signed.body.status === 'confirmed', JSON.stringify(signed.body));
  ok('signing twice → 409',
     (await J('/api/idcn/idcn3/students/yang-yang/consent', { method: 'POST',
        body: JSON.stringify({ ...V4, items: allTicked, signedName: 'again' }) },
        { 'x-idcn-key': YKEY })).status === 409);
  const noOpt = await J('/api/idcn/admin/idcn3/students', { method: 'POST',
    body: JSON.stringify({ nameEn: 'Chen Qiang', slug: 'chenqiang' }) }, A);
  const signedNoOpt = await J('/api/idcn/idcn3/students/chenqiang/consent', { method: 'POST',
    body: JSON.stringify({ ...V4, items: allTicked, signedName: '陈强' }) },
    { 'x-idcn-key': noOpt.body.passcode });
  ok('signing works before the tier is settled (option recorded as empty)',
     signedNoOpt.status === 200
       && (await J('/api/idcn/idcn3/students/chenqiang', {}, { 'x-idcn-key': noOpt.body.passcode }))
            .body.consent.payment_option == null);
  const after = await J('/api/idcn/idcn3/students/yang-yang', {}, { 'x-idcn-key': YKEY });
  ok('her profile carries the signed record: version idcn3-v4, option B, name, health note, no public media',
     after.body.consent.policy_version === 'idcn3-v4' && after.body.consent.payment_option === 5
       && after.body.course.policyVersion === 'idcn3-v4'
       && after.body.consent.signed_name === '杨杨 Yang Yang'
       && /右肩/.test(after.body.consent.health_note)
       && after.body.consent.media_public === false
       && after.body.student.status === 'confirmed',
     JSON.stringify(after.body.consent));
  ok('her locked quote is option B: 9,630,000 + 9,630,000 satang',
     JSON.stringify(after.body.quote) === JSON.stringify(qb));
  const yRow = (await pool.query('SELECT policy_version, plan FROM idc_consents WHERE student_id=$1', [YID])).rows[0];
  ok('the stamp comes from the code (idcn3-v4) though the course row says idcn3-v3, '
     + 'and the plan on screen is stored with the signature',
     yRow.policy_version === 'idcn3-v4' && yRow.plan.length === 2
       && yRow.plan.every((p, i) => p.amountSatang === qb.installments[i].amountSatang && p.due === qb.installments[i].due)
       && JSON.stringify(after.body.signedPlan) === JSON.stringify(qb.installments), JSON.stringify(yRow));


  console.log('\n— payment proof on the profile —');
  const pr = await J(`/api/idcn/admin/idcn3/students/${LID}/payments`, { method: 'POST',
    body: JSON.stringify({ label: '60% deposit 定金', amountSatang: 11940000,
      note: 'wechat transfer', uploadedBy: 'Jamsai' }) }, A);
  ok('admin records a proof (no screenshot in tests — Cloudinary is external)',
     pr.status === 200 && pr.body.payment.label.includes('定金'), JSON.stringify(pr.body).slice(0, 120));
  ok('a proof without a label is refused',
     (await J(`/api/idcn/admin/idcn3/students/${LID}/payments`, { method: 'POST',
        body: JSON.stringify({ amountSatang: 1 }) }, A)).status === 400);
  const lprof = await J('/api/idcn/idcn3/students/limei', {}, { 'x-idcn-key': LKEY });
  ok('Li Mei sees her deposit on her own page',
     lprof.body.payments.length === 1 && Number(lprof.body.payments[0].amount_satang) === 11940000);
  ok("payment proofs never appear on someone else's profile",
     (await J('/api/idcn/idcn3/students/yang-yang', {}, { 'x-idcn-key': YKEY })).body.payments.length === 0);

  console.log('\n— notes & assignments from the teaching team —');
  ok('no admin key → 401',
     (await J('/api/idcn/admin/idcn3/notes', { method: 'POST',
        body: JSON.stringify({ studentId: YID, body: 'x' }) })).status === 401);
  ok('a note with no message is refused',
     (await J('/api/idcn/admin/idcn3/notes', { method: 'POST',
        body: JSON.stringify({ studentId: YID, kind: 'assignment' }) }, A)).status === 400);
  ok('an assignment lands on one student',
     (await J('/api/idcn/admin/idcn3/notes', { method: 'POST',
        body: JSON.stringify({ studentId: YID, kind: 'assignment',
          title: 'Week 1', body: '练习 Surya A ×5，拍视频。', createdBy: 'Boonchu' }) }, A))
       .body.sentTo === 1);
  const bc = await J('/api/idcn/admin/idcn3/notes', { method: 'POST',
    body: JSON.stringify({ all: true, kind: 'note', body: '欢迎大家 Welcome everyone' }) }, A);
  ok('a broadcast reaches every non-withdrawn student', bc.body.sentTo === 3, JSON.stringify(bc.body));
  const yNotes = (await J('/api/idcn/idcn3/students/yang-yang', {}, { 'x-idcn-key': YKEY })).body.notes;
  ok('Yang Yang sees her assignment and the broadcast, newest first',
     yNotes.length === 2 && yNotes[0].kind === 'note'
       && yNotes[1].kind === 'assignment' && /Surya/.test(yNotes[1].body)
       && yNotes[1].created_by === 'Boonchu', JSON.stringify(yNotes));
  ok('Li Mei sees only the broadcast',
     (await J('/api/idcn/idcn3/students/limei', {}, { 'x-idcn-key': LKEY })).body.notes.length === 1);

  console.log('\n— daily video submissions (auth + validation; Cloudinary is external) —');
  ok('a submission without a passcode → 401',
     (await J('/api/idcn/idcn3/submissions', { method: 'POST',
        body: JSON.stringify({ slug: 'yang-yang' }) })).status === 401);
  ok('a submission with no file attached → 400',
     (await J('/api/idcn/idcn3/submissions', { method: 'POST',
        body: JSON.stringify({ slug: 'yang-yang', body: 'forgot the video' }) },
        { 'x-idcn-key': YKEY })).status === 400);
  ok("one student cannot submit into another's profile",
     (await J('/api/idcn/idcn3/submissions', { method: 'POST',
        body: JSON.stringify({ slug: 'yang-yang' }) }, { 'x-idcn-key': LKEY })).status === 401);

  console.log('\n— syllabus links + admin overview —');
  ok('links saved and cleaned',
     (await J('/api/idcn/admin/idcn3/links', { method: 'PUT',
        body: JSON.stringify({ links: [
          { title_en: 'Week 1 — Breath', title_zh: '第一周 · 呼吸', url: 'https://example.com/w1' },
          { title_en: '', title_zh: '', url: 'https://dropped.example' },
        ] }) }, A)).body.links.length === 1);
  ok('confirmed student sees the syllabus',
     (await J('/api/idcn/idcn3/students/yang-yang', {}, { 'x-idcn-key': YKEY }))
       .body.links[0].title_zh === '第一周 · 呼吸');
  const list = await J('/api/idcn/admin/idcn3/students', {}, A);
  ok('admin overview: signature state, option, quote and proof count per student',
     list.body.students.length === 3
       && list.body.students.some(s => s.slug === 'yang-yang' && s.signed_at && s.quote.totalSatang === 19260000)
       && list.body.students.some(s => s.slug === 'limei' && !s.signed_at && s.proofs === 1)
       && list.body.students.every(s => s.submissions === 0),
     JSON.stringify(list.body.students.map(s => s.slug)));
  const reset = await J(`/api/idcn/admin/idcn3/students/${LID}`, { method: 'PUT',
    body: JSON.stringify({ resetKey: true }) }, A);
  ok('passcode reset issues a new one and kills the old',
     reset.body.passcode
       && (await J('/api/idcn/idcn3/students/limei', {}, { 'x-idcn-key': LKEY })).status === 401
       && (await J('/api/idcn/idcn3/students/limei', {}, { 'x-idcn-key': reset.body.passcode })).status === 200);

  console.log('\n[v3 signers keep exactly their terms (rows as signed before v4)]');
  const mkRow = async (slug, nameEn, option, attendee, version, signedAt) => {
    const key = 'pass-' + slug;
    const id = (await pool.query(
      `INSERT INTO idc_students (course_code, slug, name_en, lang, key_hash, payment_option,
         is_attendee, status)
       VALUES ('idcn3',$1,$2,'zh',$3,$4,$5,$6) RETURNING id`,
      [slug, nameEn, crypto.createHash('sha256').update(key).digest('hex'), option, attendee,
       version ? 'confirmed' : 'invited'])).rows[0].id;
    if (version) await pool.query(
      `INSERT INTO idc_consents (student_id, policy_version, payment_option, items, signed_name, signed_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, version, option, JSON.stringify(allTicked), 'Test Signature ' + slug, signedAt]);
    return { id, key };
  };
  const PUT = (id, body) => J(`/api/idcn/admin/idcn3/students/${id}`,
    { method: 'PUT', body: JSON.stringify(body) }, A);
  const v3s = await mkRow('test-v3', 'Test Signer V3', 3, true, 'idcn3-v3', '2026-09-12T03:00:00Z');
  const v3get = async () => (await J('/api/idcn/idcn3/students/test-v3', {}, { 'x-idcn-key': v3s.key })).body;
  const v3p = await v3get();
  ok('her quote is v3 option 3 + attendee, byte for byte: ฿115,818 deposit + ฿77,212 cash = ฿193,030',
     JSON.stringify(v3p.quote) === V3_QUOTES['3true'], JSON.stringify(v3p.quote));
  ok('her three v3 quotes are unchanged',
     JSON.stringify(v3p.quotes) === `[${V3_QUOTES['1true']},${V3_QUOTES['2true']},${V3_QUOTES['3true']}]`);
  ok('she sees the same course card: name, dates, confirm-by, policy idcn3-v3, no v4 facts',
     JSON.stringify(v3p.course) === JSON.stringify({ code: 'idcn3',
       name_en: 'AYBKK In-Depth Mysore Course for Chinese Generation #3',
       name_zh: 'AYBKK 深度迈索尔课程 · 中国第三期', sessions: IDCN3_TERMS.sessions,
       confirmBy: '2026-09-10', policyVersion: 'idcn3-v3' }), JSON.stringify(v3p.course));
  ok('her signed record still says idcn3-v3, option 3, attendee',
     v3p.consent.policy_version === 'idcn3-v3' && v3p.consent.payment_option === 3
       && v3p.student.isAttendee === true && v3p.student.paymentOption === 3);
  ok('her profile has the same keys as before v4 (no signedPlan, no held)',
     Object.keys(v3p).join() === 'course,student,quotes,quote,consent,payments,notes,links,requiredConsents'
       && Object.keys(v3p.consent).join()
         === 'policy_version,payment_option,items,signed_name,health_note,media_public,signed_at');
  const v1s = await mkRow('test-v1', 'Test Signer V1', 1, false, 'idcn3-v1', '2026-09-10T03:00:00Z');
  const v1get = async () => (await J('/api/idcn/idcn3/students/test-v1', {}, { 'x-idcn-key': v1s.key })).body;
  ok('a v1 signer keeps the same v3-era money: option 1 at ฿179,100',
     JSON.stringify((await v1get()).quote) === V3_QUOTES['1false']
       && (await v1get()).consent.policy_version === 'idcn3-v1');
  const toA = await PUT(v3s.id, { paymentOption: 'A' });
  ok('a v4 option cannot be set for a v3 signer',
     toA.status === 400 && toA.body.error === 'option must be 1, 2 or 3', JSON.stringify(toA.body));
  ok('nor a custom plan', (await PUT(v3s.id, { paymentOption: 6, customPlan: plan })).status === 400);
  ok('after those refusals her profile is identical, byte for byte',
     JSON.stringify(await v3get()) === JSON.stringify(v3p));
  ok('a v3 signer can still be moved within v3 (option 2 at ฿189,050), as before',
     (await PUT(v1s.id, { paymentOption: 2 })).status === 200
       && JSON.stringify((await v1get()).quote) === V3_QUOTES['2false']);
  const list2 = (await J('/api/idcn/admin/idcn3/students', {}, A)).body;
  const row = slug => list2.students.find(x => x.slug === slug);
  ok('admin sees which terms each student is on',
     list2.policyVersion === 'idcn3-v4' && row('test-v3').terms_version === 'idcn3-v3'
       && row('test-v1').terms_version === 'idcn3-v1' && row('yang-yang').terms_version === 'idcn3-v4'
       && row('limei').terms_version === 'idcn3-v4', JSON.stringify(list2.students.map(x => x.terms_version)));
  ok("admin sees the v3 signer's amount and her v3 options; a v4 student gets A, B, C and no −3%",
     row('test-v3').quote.totalSatang === 19303000 && row('test-v3').attendee_discount === true
       && row('test-v3').options.map(o => o.code).join() === '1,2,3'
       && row('yang-yang').options.map(o => o.code).join() === 'A,B,C'
       && row('yang-yang').attendee_discount === false && row('yang-yang').quote.code === 'B');

  console.log('\n[invited before v4, never signed: gets v4, the old option is not carried over]');
  const inv = await mkRow('test-invited', 'Test Invited', 2, true, null);
  const invGet = async () => (await J('/api/idcn/idcn3/students/test-invited', {}, { 'x-idcn-key': inv.key })).body;
  const ip = await invGet();
  ok('profile is v4, and her v3 option 2 is not read as v4 option B',
     ip.course.policyVersion === 'idcn3-v4' && ip.quote === null
       && JSON.stringify(ip.quotes) === JSON.stringify([qa, qb]), JSON.stringify(ip.quote));
  const invRow = (await J('/api/idcn/admin/idcn3/students', {}, A)).body.students
    .find(x => x.slug === 'test-invited');
  ok('admin sees her old option flagged as stale', invRow.option_stale === true && invRow.quote === null);
  const invSign = await J('/api/idcn/idcn3/students/test-invited/consent', { method: 'POST',
    body: JSON.stringify({ ...V4, items: allTicked, signedName: 'Test Invited' }) }, { 'x-idcn-key': inv.key });
  const ip2 = await invGet();
  ok('when she signs, v4 is recorded and the stale option is not',
     invSign.status === 200 && ip2.consent.policy_version === 'idcn3-v4'
       && ip2.consent.payment_option === null, JSON.stringify(ip2.consent));

  console.log('\n[paid under v3, never signed: held until admin confirms an option]');
  const pd = await mkRow('test-paid', 'Test Paid Unsigned', 3, false, null);
  await pool.query(`INSERT INTO idc_payments (student_id, label, amount_satang, uploaded_by)
    VALUES ($1, '60% deposit', 11940000, 'Test')`, [pd.id]);
  const pdGet = async () => (await J('/api/idcn/idcn3/students/test-paid', {}, { 'x-idcn-key': pd.key })).body;
  const pp = await pdGet();
  ok('she is held: no quote, her payment named, never shown as owing ฿192,600 on top',
     pp.course.policyVersion === 'idcn3-v4' && pp.quote === null && pp.consent === null
       && JSON.stringify(pp.held) === '{"paidSatang":11940000}', JSON.stringify(pp.held));
  const pdSign = await J('/api/idcn/idcn3/students/test-paid/consent', { method: 'POST',
    body: JSON.stringify({ ...V4, items: allTicked, signedName: 'Test Paid' }) }, { 'x-idcn-key': pd.key });
  ok('she cannot sign while held', pdSign.status === 409 && pdSign.body.held === true, JSON.stringify(pdSign.body));
  const pdRow = async () => (await J('/api/idcn/admin/idcn3/students', {}, A)).body.students
    .find(x => x.slug === 'test-paid');
  const pr1 = await pdRow();
  ok('admin sees her held, with the amount paid and the old option',
     pr1.held === true && pr1.paid_satang === 11940000 && pr1.option_stale === true
       && pr1.payment_option === 3 && pr1.quote === null, JSON.stringify(pr1).slice(0, 300));
  const noConfirm = await PUT(pd.id, { paymentOption: 'B' });
  ok('setting a v4 option without confirming is refused, and nothing changes',
     noConfirm.status === 409 && noConfirm.body.held === true && (await pdRow()).payment_option === 3,
     JSON.stringify(noConfirm.body));
  ok('once confirmed (Boonchu decided), admin sets B and the hold ends',
     (await PUT(pd.id, { paymentOption: 'B', confirmHeld: true })).status === 200
       && JSON.stringify((await pdGet()).quote) === JSON.stringify(qb) && !('held' in await pdGet())
       && (await pdRow()).held === false);
  ok('then she can sign v4, and her payment stays on record',
     (await J('/api/idcn/idcn3/students/test-paid/consent', { method: 'POST',
        body: JSON.stringify({ ...V4, items: allTicked, signedName: 'Test Paid' }) }, { 'x-idcn-key': pd.key }))
       .status === 200 && (await pdGet()).consent.payment_option === 5
       && (await pdGet()).payments.length === 1);

  console.log('\n[option C: a plan agreed on the call, for one student]');
  const LKEY2 = reset.body.passcode;
  const short = await PUT(LID, { paymentOption: 'C', customPlan: [{ amountSatang: 18000000, due: '2026-12-10' }] });
  ok('a plan that does not add up to ฿192,600 is refused, with the reason',
     short.status === 400 && /192,600 THB/.test(short.body.error), JSON.stringify(short.body));
  ok('a plan in fractional satang is refused',
     (await PUT(LID, { paymentOption: 'C', customPlan: [{ amountSatang: 9630000.5, due: '2026-12-10' },
       { amountSatang: 9629999.5, due: '2027-01-10' }] })).status === 400);
  ok('option C without its payments is refused', (await PUT(LID, { paymentOption: 'C' })).status === 400);
  const cPlan = [{ amountSatang: 9260000, due: '2027-01-05' }, { amountSatang: 10000000, due: '2026-12-10' }];
  ok('Li Mei has a deposit recorded and no v4 option, so she is held: C needs the confirm',
     (await PUT(LID, { paymentOption: 'C', customPlan: cPlan })).status === 409);
  ok('a plan that adds up is saved',
     (await PUT(LID, { paymentOption: 'C', customPlan: cPlan, confirmHeld: true })).status === 200);
  const lq = (await J('/api/idcn/idcn3/students/limei', {}, { 'x-idcn-key': LKEY2 })).body.quote;
  ok('she sees her plan in date order, adding up to 19,260,000 satang',
     lq.code === 'C' && lq.totalSatang === 19260000 && JSON.stringify(lq.installments) === JSON.stringify(plan),
     JSON.stringify(lq));
  await PUT(LID, { paymentOption: 'A' });
  const lrow = (await J('/api/idcn/admin/idcn3/students', {}, A)).body.students.find(x => x.slug === 'limei');
  ok('moving her to A drops the custom plan',
     lrow.custom_plan === null && JSON.stringify(lrow.quote) === JSON.stringify(qa));

  console.log('\n[option C: the plan signed is kept when admin changes it later]');
  const cs = await J('/api/idcn/admin/idcn3/students', { method: 'POST',
    body: JSON.stringify({ nameEn: 'Test Plan C', slug: 'test-plan-c' }) }, A);
  const CS = { id: cs.body.student.id, key: cs.body.passcode };
  const three = [{ amountSatang: 6420000, due: '2026-12-10' }, { amountSatang: 6420000, due: '2026-12-25' },
    { amountSatang: 6420000, due: '2027-01-05' }];
  await PUT(CS.id, { paymentOption: 'C', customPlan: three });
  ok('she signs on a 3-part plan C',
     (await J('/api/idcn/idcn3/students/test-plan-c/consent', { method: 'POST',
        body: JSON.stringify({ ...V4, items: allTicked, signedName: 'Test Plan C' }) }, { 'x-idcn-key': CS.key }))
       .status === 200);
  const one = [{ amountSatang: 19260000, due: '2026-11-05' }];
  ok('admin can still change her plan (agreed on a later call)',
     (await PUT(CS.id, { paymentOption: 'C', customPlan: one })).status === 200);
  const cp = (await J('/api/idcn/idcn3/students/test-plan-c', {}, { 'x-idcn-key': CS.key })).body;
  const cRow = (await pool.query('SELECT plan FROM idc_consents WHERE student_id=$1', [CS.id])).rows[0];
  ok('her page shows the new plan and the one she signed; the signed row is unchanged',
     JSON.stringify(cp.quote.installments) === JSON.stringify(one)
       && JSON.stringify(cp.signedPlan) === JSON.stringify(three)
       && cRow.plan.length === 3 && cRow.plan.every((p, i) => p.amountSatang === three[i].amountSatang
         && p.due === three[i].due), JSON.stringify({ q: cp.quote, s: cp.signedPlan }));
  const cAdm = (await J('/api/idcn/admin/idcn3/students', {}, A)).body.students.find(x => x.slug === 'test-plan-c');
  ok('admin sees the plan was changed after signing, and what was signed',
     cAdm.plan_changed === true && JSON.stringify(cAdm.signed_plan) === JSON.stringify(three)
       && (await J('/api/idcn/admin/idcn3/students', {}, A)).body.students
         .find(x => x.slug === 'yang-yang').plan_changed === false);

  // ── IDCN#3 (24 Nov 2026): AYBKK accounts, the roster in one go, the calendar,
  // work per session and the teacher's daily comment. Made-up people, made-up
  // session titles: the real calendar is course material and lives in the database.
  const RUN = crypto.randomBytes(3).toString('hex');
  const newCode = () => 'B' + BigInt('0x' + crypto.randomBytes(8).toString('hex')).toString(36).toUpperCase().padStart(13, '0');
  const MULTER_TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'idcn-up-'));
  const keepTmp = process.env.TMPDIR;

  console.log('\n[IDCN#3: a member code opens nothing while no account is linked]');
  const hadMembers = (await pool.query(`SELECT to_regclass('bkk_members') IS NOT NULL AS ok`)).rows[0].ok;
  if (!hadMembers) console.log('  (no bkk_members table yet: these run against the missing table)');
  const nobody = newCode();
  const mine0 = await J(`/api/idcn/mine/${nobody}`);
  ok('an unknown member code has no courses: an empty list, not a 404, never cached',
     mine0.status === 200 && JSON.stringify(mine0.body) === '{"courses":[]}', JSON.stringify(mine0.body));
  ok('...and a member code opens no profile that is not linked to it',
     (await J('/api/idcn/idcn3/students/yang-yang', {}, { 'x-member-code': nobody })).status === 401);
  const noBkk = await J('/api/idcn/admin/idcn3/students/bulk', { method: 'POST', body: JSON.stringify({ dryRun: true,
    rows: [{ nameEn: 'Test Nobody', member: nobody }, { nameEn: 'Test Mailer', member: `mailer-${RUN}@example.com` }] }) }, A);
  ok('without bkk mounted: an unknown code and a new email are row errors, nothing else',
     noBkk.status === 200 && noBkk.body.results.every(r => r.action === 'error' && r.field === 'member')
       && noBkk.body.results[1].error === 'cannot create a member here', JSON.stringify(noBkk.body));

  // bkk mounted next to the course, as server.js does: it makes the AYBKK profiles
  // and the staff sign-in links
  process.env.MAIL_DRY_RUN = '1';
  process.env.TELEGRAM_API_BASE = 'http://127.0.0.1:9';
  const { mountBkk } = require('../bkk-api.js');
  const app2 = express();
  app2.use(express.json({ limit: '10mb' }));
  const bkkReady = mountBkk(app2, { pgPool: pool, timers: false });
  process.env.TMPDIR = MULTER_TMP;
  mountIdcn(app2, { pgPool: pool, bkk: bkkReady });
  if (keepTmp == null) delete process.env.TMPDIR; else process.env.TMPDIR = keepTmp;
  const bkkApi = await bkkReady;
  await new Promise(r => setTimeout(r, 500));
  ok('bkk resolves with findOrCreateMember and staffSigninLink for the course admin',
     typeof bkkApi.findOrCreateMember === 'function' && typeof bkkApi.staffSigninLink === 'function');
  const srv2 = app2.listen(0);
  const B2 = `http://127.0.0.1:${srv2.address().port}`;
  const J2 = async (p, opts = {}, headers = {}) => {
    const r = await fetch(B2 + p, { redirect: 'manual', ...opts, headers: { 'Content-Type': 'application/json', ...headers } });
    return { status: r.status, headers: r.headers, body: await r.json().catch(() => ({})) };
  };
  const mkMember = async (name, email) => (await pool.query(
    'INSERT INTO bkk_members (code, name, email) VALUES ($1,$2,$3) RETURNING id, code', [newCode(), name, email])).rows[0];
  const mA = await mkMember('Test Alum A', `alum-a-${RUN}@example.com`);
  const mBk = await mkMember('Test Alum B', `alum-b-${RUN}@example.com`);
  const mBf = await mkMember('Test Alum B (old profile)', null);
  await pool.query('UPDATE bkk_members SET merged_into=$1, merged_at=now() WHERE id=$2', [mBk.id, mBf.id]);
  const mC = await mkMember('Test Alum C', `alum-c-${RUN}@example.com`);
  const mOut = await mkMember('Test Outsider', `outsider-${RUN}@example.com`);
  const preC = await J2('/api/idcn/admin/idcn3/students', { method: 'POST', body: JSON.stringify({ nameEn: 'Test Alum C' }) }, A);

  console.log('\n[IDCN#3: the roster in one go]');
  const NEW = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];
  const roster = [
    { nameEn: 'Test Alum A', nameZh: '测试甲', member: mA.code, startDate: '2027-01-24', note: 'IDCN #1 alum', arranged: true },
    { nameEn: 'Test Alum B', member: mBf.code.toLowerCase(), startDate: '2027-01-24', note: 'IDCN #2 alum', arranged: true },
    { nameEn: 'Test Alum C', member: `ALUM-C-${RUN}@Example.com`, startDate: '2027-01-24', note: 'IDCN #2 alum', arranged: true },
    ...NEW.map((w, i) => ({ nameEn: `Test New ${w}`, member: `new${i + 1}-${RUN}@example.com`, startDate: '2027-01-11' })),
    { nameEn: 'Test Bad Code', member: 'B0000000000000' },
    { nameEn: 'Test Bad Date', startDate: '2027-02-30' },
    { nameEn: 'Test Money Note', note: 'credit 12,345 THB' },
  ];
  const BULK = '/api/idcn/admin/idcn3/students/bulk';
  const studentCount = async () => (await pool.query(`SELECT count(*)::int AS n FROM idc_students WHERE course_code='idcn3'`)).rows[0].n;
  const newMembers = async () => (await pool.query(`SELECT count(*)::int AS n FROM bkk_members WHERE email LIKE $1`, [`new%-${RUN}@example.com`])).rows[0].n;
  ok('the roster needs the admin key', (await J2(BULK, { method: 'POST', body: JSON.stringify({ rows: roster }) })).status === 401);
  ok('at most 30 rows at a time', (await J2(BULK, { method: 'POST',
    body: JSON.stringify({ rows: Array.from({ length: 31 }, (_, i) => ({ nameEn: `Test Many ${i}` })) }) }, A)).status === 400);
  const before = await studentCount();
  const dry = await J2(BULK, { method: 'POST', body: JSON.stringify({ rows: roster, dryRun: true }) }, A);
  const act = b => b.results.map(r => r.action).join();
  ok('a preview says what would happen to each row: 8 created, the alum already there, 3 errors',
     dry.status === 200 && dry.body.dryRun === true && JSON.stringify(dry.body.counts) === '{"created":8,"exists":1,"error":3}'
       && act(dry.body) === 'created,created,exists,created,created,created,created,created,created,error,error,error',
     JSON.stringify(dry.body).slice(0, 400));
  ok('...each error names its field: the member code, the start date, the money in the note',
     dry.body.results.slice(9).map(r => `${r.row}:${r.field}`).join() === '10:member,11:startDate,12:note'
       && /never an amount/.test(dry.body.results[11].error));
  ok('...and a preview shows no passcode, saves no student and makes no AYBKK profile',
     dry.body.results.every(r => !('passcode' in r)) && await studentCount() === before && await newMembers() === 0
       && dry.body.results[3].member.created === true && dry.body.results[3].member.code === null);
  const real = await J2(BULK, { method: 'POST', body: JSON.stringify({ rows: roster }) }, A);
  const res = slug => real.body.results.find(r => r.slug === slug);
  ok('the roster is added: 8 created with a passcode each and the link, the errors still reported',
     real.status === 200 && JSON.stringify(real.body.counts) === '{"created":8,"exists":1,"error":3}'
       && real.body.results.filter(r => r.passcode).length === 8
       && real.body.results.filter(r => r.action === 'created').every(r => r.passcode && r.id && r.link === `/idcn3/${r.slug}`)
       && await studentCount() === before + 8, JSON.stringify(real.body).slice(0, 300));
  ok('the alumni are linked to their own AYBKK accounts (a folded code lands on the profile kept), none made',
     res('test-alum-a').member.code === mA.code && res('test-alum-a').member.created === false
       && res('test-alum-b').member.code === mBk.code && res('test-alum-b').member.created === false
       && res('test-alum-c').member.code === mC.code);
  ok('the student already on the course is kept, with only its empty fields filled, and no new passcode',
     res('test-alum-c').action === 'exists' && res('test-alum-c').id === preC.body.student.id && !res('test-alum-c').passcode
       && res('test-alum-c').filled.join() === 'member,startDate,note,arranged', JSON.stringify(res('test-alum-c')));
  ok('the six new students each get one new AYBKK profile',
     await newMembers() === 6 && NEW.every(w => res(`test-new-${w.toLowerCase()}`).member.created === true
       && /^B[0-9A-Z]{13}$/.test(res(`test-new-${w.toLowerCase()}`).member.code)));
  const again = await J2(BULK, { method: 'POST', body: JSON.stringify({ rows: roster }) }, A);
  ok('the same roster again duplicates nobody: every one exists, no passcode, no new profile',
     JSON.stringify(again.body.counts) === '{"created":0,"exists":9,"error":3}' && again.body.results.every(r => !r.passcode)
       && await studentCount() === before + 8 && await newMembers() === 6, JSON.stringify(again.body.counts));
  const changed = await J2(BULK, { method: 'POST', body: JSON.stringify({ rows: [{ nameEn: 'Test Alum A', member: mA.code, startDate: '2027-01-25' }] }) }, A);
  ok('a different value for a field already set is reported, never written over',
     changed.body.results[0].action === 'exists' && changed.body.results[0].kept.join() === 'startDate'
       && changed.body.results[0].filled.length === 0, JSON.stringify(changed.body.results[0]));
  const taken = await J2(BULK, { method: 'POST', body: JSON.stringify({ dryRun: true, rows: [{ nameEn: 'Test New One', member: mOut.code }] }) }, A);
  ok('a name whose student is linked to another account is an error, not a second link',
     taken.body.results[0].action === 'error' && taken.body.results[0].field === 'member', JSON.stringify(taken.body.results[0]));
  // accounts made before 8 Oct 2026 have a shorter code ('B' + time in base 36 + 3 characters)
  const oldCode = ('B' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex').slice(0, 3)).toUpperCase();
  await pool.query('INSERT INTO bkk_members (code, name) VALUES ($1,$2)', [oldCode, 'Test Old Account']);
  const oldRow = await J2(BULK, { method: 'POST', body: JSON.stringify({ dryRun: true, rows: [
    { nameEn: 'Test Old Account', member: oldCode.toLowerCase() }, { nameEn: 'Test Typo Code', member: 'BNOSUCHCODE1' }] }) }, A);
  ok('an older, shorter member code links its account; a code no account has is still an error',
     oldCode.length < 14 && oldRow.body.results[0].action === 'created' && oldRow.body.results[0].member.code === oldCode
       && oldRow.body.results[1].action === 'error' && /no AYBKK account has this member code/.test(oldRow.body.results[1].error),
     JSON.stringify(oldRow.body.results));
  const twinMail = `twin-${RUN}@example.com`;
  const twins = await J2(BULK, { method: 'POST', body: JSON.stringify({ dryRun: true, rows: [
    { nameEn: 'Test Twin One', member: twinMail }, { nameEn: 'Test Twin Again', member: twinMail }] }) }, A);
  const [tw1, tw2] = twins.body.results;
  ok('a preview with one new email on two lines: the second is the same student, with no code or id that will not exist',
     tw1.action === 'created' && tw1.member.code === null && tw2.action === 'exists' && tw2.sameAs === 1 && !('id' in tw2)
       && tw2.member.code === null && tw2.member.created === true
       && (await pool.query('SELECT count(*)::int AS n FROM bkk_members WHERE email=$1', [twinMail])).rows[0].n === 0,
     JSON.stringify(twins.body.results));
  const ID = slug => res(slug).id;
  const KEY = slug => res(slug).passcode;
  const codeOf = slug => res(slug).member.code;

  console.log('\n[IDCN#3: the AYBKK member code is the sign-in]');
  const P = (slug, h) => J2(`/api/idcn/idcn3/students/${slug}`, {}, h);
  ok("a new student's own member code opens her course page", (await P('test-new-one', { 'x-member-code': codeOf('test-new-one') })).status === 200);
  ok("...another student's member code does not", (await P('test-new-one', { 'x-member-code': codeOf('test-new-two') })).status === 401);
  ok('...nor an AYBKK account that is not on the course', (await P('test-new-one', { 'x-member-code': mOut.code })).status === 401);
  ok('...nor any code on a student with no account linked', (await P('yang-yang', { 'x-member-code': mOut.code })).status === 401);
  ok('...and her passcode still opens it as before', (await P('test-new-one', { 'x-idcn-key': KEY('test-new-one') })).status === 200);
  ok('the old code of a merged profile opens the page of the profile kept',
     (await P('test-alum-b', { 'x-member-code': mBf.code })).status === 200
       && (await P('test-alum-b', { 'x-member-code': mBk.code })).status === 200);
  const mineOne = await J2(`/api/idcn/mine/${codeOf('test-new-one')}`);
  ok('/mine lists her course: IDCN#3, her link and start date, nobody else',
     mineOne.status === 200 && /no-store/.test(mineOne.headers.get('cache-control') || '')
       && JSON.stringify(mineOne.body) === JSON.stringify({ courses: [{ course: 'idcn3', label: 'IDCN#3',
         name_en: 'Test New One', name_zh: null, slug: 'test-new-one', link: '/idcn3/test-new-one', startDate: '2027-01-11' }] }),
     JSON.stringify(mineOne.body));
  ok('/mine for an account on no course, and for a made-up code, is empty',
     JSON.stringify((await J2(`/api/idcn/mine/${mOut.code}`)).body) === '{"courses":[]}'
       && JSON.stringify((await J2('/api/idcn/mine/not-a-code')).body) === '{"courses":[]}');
  ok('/mine follows a merge: the old code and the kept code list the same course',
     (await J2(`/api/idcn/mine/${mBf.code}`)).body.courses.map(c => c.slug).join() === 'test-alum-b'
       && (await J2(`/api/idcn/mine/${mBk.code}`)).body.courses.map(c => c.slug).join() === 'test-alum-b');
  await pool.query('UPDATE idc_students SET member_id=$1 WHERE id=$2', [mBf.id, ID('test-alum-b')]);
  ok('a link stored on the old profile still opens with the kept code',
     (await P('test-alum-b', { 'x-member-code': mBk.code })).status === 200
       && (await J2(`/api/idcn/mine/${mBk.code}`)).body.courses.length === 1);
  await pool.query('UPDATE idc_students SET member_id=$1 WHERE id=$2', [mBk.id, ID('test-alum-b')]);
  await pool.query(`UPDATE idc_students SET status='withdrawn' WHERE id=$1`, [ID('test-new-six')]);
  ok('a withdrawn student is not listed', (await J2(`/api/idcn/mine/${codeOf('test-new-six')}`)).body.courses.length === 0);
  await pool.query(`UPDATE idc_students SET status='invited' WHERE id=$1`, [ID('test-new-six')]);

  console.log('\n[IDCN#3: the calendar, pasted as Boonchu sends it]');
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let sn = 0;
  const calRows = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.UTC(2027, 0, 11 + i));
    const day = i + 1;
    let morning = 'Morning practice (type TBC)', a = '–', b = '–';
    if (day === 6) { morning = 'Led Intermediate'; a = 'Test party, no class'; }
    else if (day === 7) { morning = 'No practice'; a = 'Day off'; }
    else if (day === 30) { morning = 'Morning'; a = 'S31 Test closing talk, certificates'; }
    else {
      if ([12, 21, 28].includes(day)) a = `#${++sn} Test topic ${sn}`;
      b = `#${++sn} Test topic ${sn}`;
    }
    return [day, `${d.getUTCDate()} ${['Jan', 'Feb'][d.getUTCMonth()]} 2027`, WD[d.getUTCDay()], morning, a, b];
  });
  const HEAD = '| Day no. | Date | Day | Morning class | Slot A 10:30-12:30 | Slot B 13:00-16:00 |';
  const mdOf = (rows, head = HEAD, pre = []) => ['# Test calendar 2027', '', 'Source: a made-up note.',
    'Morning practice is a separate part and is not counted as a session.', ...pre, '',
    head, '| --- | --- | --- | --- | --- | --- |', ...rows.map(r => `| ${r.join(' | ')} |`), '', 'Thank you.'].join('\n');
  const MD = mdOf(calRows);
  const DAYS = '/api/idcn/admin/idcn3/days';
  const putDays = (body, h = A) => J2(DAYS, { method: 'PUT', body: JSON.stringify(body) }, h);
  ok('the calendar needs the admin key', (await putDays({ text: MD }, {})).status === 401
     && (await J2(DAYS)).status === 401);
  const prev = await putDays({ text: MD, dryRun: true });
  const pv = prev.body;
  ok('a preview reads 30 days and 31 sessions: #1 to #30 and S31',
     prev.status === 200 && pv.dryRun === true && pv.saved === false && pv.days.length === 30 && pv.sessions.length === 31
       && pv.sessions.map(s => s.no).join() === Array.from({ length: 31 }, (_, i) => i + 1).join(), JSON.stringify(pv).slice(0, 300));
  const d12 = pv.days.find(d => d.day === 12), d30 = pv.days.find(d => d.day === 30);
  ok('a day with a session in each slot, and S31 in the last morning slot',
     JSON.stringify(d12.sessions) === '[{"no":10,"slot":"A","title":"Test topic 10"},{"no":11,"slot":"B","title":"Test topic 11"}]'
       && JSON.stringify(d30.sessions) === '[{"no":31,"slot":"A","title":"Test closing talk, certificates"}]'
       && d30.slotB === null, JSON.stringify([d12, d30]));
  ok('each day as pasted: day number, date, weekday, morning, a "–" read as empty',
     JSON.stringify(pv.days[0]) === JSON.stringify({ day: 1, date: '2027-01-11', weekday: 'Mon', morning: 'Morning practice (type TBC)',
       slotA: null, slotB: '#1 Test topic 1', note: null, sessions: [{ no: 1, slot: 'B', title: 'Test topic 1' }] }),
     JSON.stringify(pv.days[0]));
  ok('the slot times come from the header', JSON.stringify(pv.slots) === '{"A":"10:30-12:30","B":"13:00-16:00"}', JSON.stringify(pv.slots));
  ok('warnings: the TBC mornings and the two days with no session; the weekdays all match',
     pv.warnings.some(w => /^still to confirm \(TBC\) on days 1, 2, 3/.test(w)) && pv.warnings.includes('no session on days 6, 7')
       && !pv.warnings.some(w => / but .* is a /.test(w)), JSON.stringify(pv.warnings));
  ok('...and a preview saves nothing', (await J2(DAYS, {}, A)).body.days.length === 0);
  const tabs = [HEAD.replace(/^\| | \|$/g, '').split(' | ').join('\t'), ...calRows.map(r => r.join('\t'))].join('\n');
  const tb = (await putDays({ text: tabs, dryRun: true })).body;
  ok('tab rows copied from a spreadsheet read the same', JSON.stringify(tb.days) === JSON.stringify(pv.days)
     && JSON.stringify(tb.slots) === JSON.stringify(pv.slots), JSON.stringify(tb).slice(0, 200));
  const bare = ['Day no. | Date | Day | Morning class | Slot A | Slot B', ...calRows.map(r => r.join(' | '))].join('\n');
  const br = (await putDays({ text: bare + '\nSlot A is 10:30-12:30.\nSlot B is 13:00-16:00.', dryRun: true })).body;
  ok('rows without the outer pipes read the same, the slot times from "Slot A is ..." lines',
     JSON.stringify(br.days) === JSON.stringify(pv.days) && JSON.stringify(br.slots) === JSON.stringify(pv.slots), JSON.stringify(br).slice(0, 200));
  const lineOf = (text, s) => text.split('\n').findIndex(l => l.includes(s)) + 1;
  const badDate = MD.replace('| 3 | 13 Jan 2027 |', '| 3 | 32 Jan 2027 |');
  const bd = await putDays({ text: badDate });
  ok('a date that does not exist → 400 with its line', bd.status === 400 && bd.body.line === lineOf(badDate, '32 Jan')
     && /32 Jan 2027/.test(bd.body.error), JSON.stringify(bd.body));
  const dupDay = MD.replace('| 4 | 14 Jan 2027 |', '| 3 | 14 Jan 2027 |');
  const dd = await putDays({ text: dupDay });
  ok('a day number twice → 400 with the line', dd.status === 400 && dd.body.line === lineOf(dupDay, '| 3 | 14 Jan') && /day 3 appears twice/.test(dd.body.error),
     JSON.stringify(dd.body));
  const dupSes = MD.replace('#5 Test topic 5', '#4 Test topic 5');
  const ds = await putDays({ text: dupSes });
  ok('a session number twice → 400 with the line', ds.status === 400 && ds.body.line === lineOf(dupSes, '#4 Test topic 5')
     && /session #4 appears twice/.test(ds.body.error), JSON.stringify(ds.body));
  const back = await putDays({ text: MD.replace('| 5 | 15 Jan 2027 |', '| 5 | 10 Jan 2027 |') });
  ok('dates that go backwards → 400', back.status === 400 && /go forward/.test(back.body.error));
  const long = await putDays({ text: MD.replace('#1 Test topic 1', '#1 ' + 'x'.repeat(300)) });
  ok('a cell of more than 300 characters → 400', long.status === 400 && long.body.line === lineOf(MD, '#1 Test topic 1'));
  const none = await putDays({ text: 'Just a note, no table.' });
  ok('text with no table → 400', none.status === 400 && /no calendar rows/.test(none.body.error) && 'line' in none.body);
  const wrongWd = (await putDays({ text: MD.replace('| 2 | 12 Jan 2027 | Tue |', '| 2 | 12 Jan 2027 | Wed |'), dryRun: true })).body;
  ok('a weekday that does not match its date is a warning', wrongWd.warnings.includes('day 2: "Wed" but 2027-01-12 is a Tue'),
     JSON.stringify(wrongWd.warnings));
  const rowsMode = (await putDays({ dryRun: true, slots: { A: '10.30 - 12.30' }, rows: [
    { day: 1, date: '11/1/2027', morning: '#5 morning is never a session', slotB: '#1 Test' },
    { day: 2, date: '2027-01-12', weekday: '周二', slotA: 'S2: Test two' }] })).body;
  ok('rows can be sent as JSON too: D/M/YYYY dates, weekdays filled or read in Chinese, the morning never a session',
     JSON.stringify(rowsMode.sessions) === '[{"no":1,"day":1,"slot":"B","title":"Test"},{"no":2,"day":2,"slot":"A","title":"Test two"}]'
       && rowsMode.days[0].weekday === 'Mon' && rowsMode.days[1].weekday === 'Tue' && rowsMode.slots.A === '10:30-12:30',
     JSON.stringify(rowsMode).slice(0, 400));
  const saved = await putDays({ text: MD });
  ok('saving the calendar', saved.status === 200 && saved.body.saved === true);
  const noTimes = (await putDays({ text: mdOf(calRows, '| Day no. | Date | Day | Morning class | Slot A | Slot B |'), dryRun: true })).body;
  ok('a paste with no slot times keeps the ones saved', JSON.stringify(noTimes.slots) === '{"A":"10:30-12:30","B":"13:00-16:00"}');
  const two = await putDays({ rows: [{ day: 1, date: '2027-01-11', slotB: '#1 Test first' }, { day: 2, date: '2027-01-12', slotB: '#2 Test second' }] });
  const cal2 = (await J2(DAYS, {}, A)).body;
  ok('saving again replaces every day and session', two.status === 200 && cal2.days.length === 2 && cal2.sessions.length === 2
     && cal2.sessions[1].title === 'Test second', JSON.stringify(cal2).slice(0, 200));
  await putDays({ text: MD });
  const cal = (await J2(DAYS, {}, A)).body;
  ok('...and back to the 30 days, read back as saved', cal.days.length === 30 && cal.sessions.length === 31
     && JSON.stringify(cal.days) === JSON.stringify(pv.days) && JSON.stringify(cal.slots) === JSON.stringify(pv.slots));

  console.log('\n[IDCN#3: who sees the calendar]');
  const alumA = { 'x-member-code': mA.code };
  const pA = (await P('test-alum-a', alumA)).body;
  ok('an alum whose terms were agreed directly: her cohort card and the whole calendar, without signing',
     JSON.stringify(pA.cohort) === '{"label":"IDCN#3","startDate":"2027-01-24","termsArranged":true}'
       && pA.consent === null && pA.days.length === 30 && JSON.stringify(pA.slots) === JSON.stringify(pv.slots), JSON.stringify(pA.cohort));
  ok("...the staff note stays with staff: not in her own page, only when the admin key opens it",
     !('note' in pA.cohort) && (await P('test-alum-a', A)).body.cohort.note === 'IDCN #1 alum');
  await J2(`/api/idcn/admin/idcn3/students/${ID('test-alum-a')}/payments`, { method: 'POST',
    body: JSON.stringify({ label: 'Test carried credit' }) }, A);
  const pA2 = (await P('test-alum-a', alumA)).body;
  const listA = (await J2('/api/idcn/admin/idcn3/students', {}, A)).body.students.find(s => s.slug === 'test-alum-a');
  ok('...never held, with a payment and no option', !('held' in pA2) && listA.held === false && listA.proofs === 1, JSON.stringify(listA).slice(0, 200));
  const pN = (await P('test-new-one', { 'x-member-code': codeOf('test-new-one') })).body;
  ok('a new student who has not signed: her cohort card, but no calendar or work yet',
     pN.cohort && pN.cohort.termsArranged === false && pN.cohort.startDate === '2027-01-11'
       && !('days' in pN) && !('slots' in pN) && !('sessionsWork' in pN) && !('comments' in pN), Object.keys(pN).join());
  ok('...the admin key sees her calendar', (await P('test-new-one', A)).body.days.length === 30);
  const yy2 = (await J('/api/idcn/idcn3/students/yang-yang', {}, { 'x-idcn-key': YKEY })).body;
  const v3now = await v3get();
  ok('signers with none of the new fields have no cohort card, and only the calendar keys are new',
     !('cohort' in yy2) && yy2.days.length === 30 && !('cohort' in v3now)
       && Object.keys(v3now).join() === 'course,student,quotes,quote,consent,payments,notes,links,requiredConsents,days,slots'
       && JSON.stringify(v3now.course) === JSON.stringify(v3p.course) && JSON.stringify(v3now.quote) === JSON.stringify(v3p.quote),
     Object.keys(v3now).join());

  console.log('\n[IDCN#3: staff edit the new fields]');
  const PUTS = (slug, body, h = A) => J2(`/api/idcn/admin/idcn3/students/${ID(slug)}`, { method: 'PUT', body: JSON.stringify(body) }, h);
  ok('a member code nobody has → 400', (await PUTS('test-new-two', { memberCode: newCode() })).status === 400);
  ok("another student's account → 409", (await PUTS('test-new-two', { memberCode: mA.code })).status === 409);
  const bad = await PUTS('test-new-two', { startDate: '2027-01-12', note: 'paid 99999' });
  ok('a note with an amount → 400, and the start date sent with it is not written',
     bad.status === 400 && (await pool.query('SELECT to_char(start_date, \'YYYY-MM-DD\') AS d FROM idc_students WHERE id=$1',
       [ID('test-new-two')])).rows[0].d === '2027-01-11');
  ok('termsArranged is true or false only', (await PUTS('test-new-two', { termsArranged: 'yes' })).status === 400);
  ok('a start date that does not exist → 400', (await PUTS('test-new-two', { startDate: '2027-13-01' })).status === 400);
  const un = await PUTS('test-new-two', { memberCode: '' });
  ok('unlinking: her code opens nothing and lists nothing', un.status === 200 && un.body.member === null
     && (await P('test-new-two', { 'x-member-code': codeOf('test-new-two') })).status === 401
     && (await J2(`/api/idcn/mine/${codeOf('test-new-two')}`)).body.courses.length === 0);
  const re = await PUTS('test-new-two', { memberCode: codeOf('test-new-two').toLowerCase(), termsArranged: true, note: 'Test cohort note' });
  ok('linking again by code, and terms agreed directly', re.status === 200 && re.body.member.code === codeOf('test-new-two')
     && (await P('test-new-two', { 'x-member-code': codeOf('test-new-two') })).body.days.length === 30);
  const list3 = (await J2('/api/idcn/admin/idcn3/students', {}, A)).body.students;
  const rowOf = slug => list3.find(s => s.slug === slug);
  ok('the admin list shows the live account, start date, note and terms for each student',
     rowOf('test-alum-b').member_code === mBk.code && rowOf('test-alum-b').member_name === 'Test Alum B'
       && rowOf('test-alum-a').start_date === '2027-01-24' && rowOf('test-alum-a').cohort_note === 'IDCN #1 alum'
       && rowOf('test-alum-a').terms_arranged === true && rowOf('yang-yang').member_code === null
       && rowOf('test-new-two').cohort_note === 'Test cohort note', JSON.stringify(rowOf('test-alum-b')).slice(0, 300));

  console.log('\n[IDCN#3: an assignment per session, hand-ins and the daily comment]');
  const NOTES = '/api/idcn/admin/idcn3/notes';
  const onCourse = (await pool.query(`SELECT count(*)::int AS n FROM idc_students WHERE course_code='idcn3' AND status != 'withdrawn'`)).rows[0].n;
  const asg = await J2(NOTES, { method: 'POST', body: JSON.stringify({ all: true, kind: 'assignment', sessionNo: 3,
    title: 'Test drill', body: 'Test: film one vinyasa count.', createdBy: 'Test Teacher' }) }, A);
  ok('an assignment for session #3 goes to everyone on the course', asg.status === 200 && asg.body.sentTo === onCourse && asg.body.session === 3,
     JSON.stringify(asg.body));
  ok('a session the calendar does not have → 400', (await J2(NOTES, { method: 'POST',
    body: JSON.stringify({ all: true, kind: 'assignment', sessionNo: 77, body: 'x' }) }, A)).status === 400);
  ok('a session number that is not one → 400', (await J2(NOTES, { method: 'POST',
    body: JSON.stringify({ studentId: ID('test-alum-a'), sessionNo: 'abc', body: 'x' }) }, A)).status === 400);
  const pA3 = (await P('test-alum-a', alumA)).body;
  ok('she sees it under session #3, and not in the undated feed',
     pA3.sessionsWork['3'].assignments.length === 1 && pA3.sessionsWork['3'].assignments[0].title === 'Test drill'
       && pA3.sessionsWork['3'].assignments[0].session === 3 && pA3.sessionsWork['3'].submissions.length === 0
       && !pA3.notes.some(n => n.title === 'Test drill'), JSON.stringify(pA3.sessionsWork));
  const SUB = '/api/idcn/idcn3/submissions';
  const sub = await J2(SUB, { method: 'POST', body: JSON.stringify({ slug: 'test-alum-a', sessionNo: 3, body: 'Test answer, in words.' }) }, alumA);
  ok('a written hand-in for session #3, no file', sub.status === 200 && sub.body.note.session === 3 && sub.body.note.media_url === null,
     JSON.stringify(sub.body));
  ok('...without a session a file is still needed', (await J2(SUB, { method: 'POST',
    body: JSON.stringify({ slug: 'test-alum-a', body: 'words only' }) }, alumA)).status === 400);
  ok('...an empty hand-in → 400', (await J2(SUB, { method: 'POST', body: JSON.stringify({ slug: 'test-alum-a', sessionNo: 3 }) }, alumA)).status === 400);
  ok('...a session not in the calendar → 400', (await J2(SUB, { method: 'POST',
    body: JSON.stringify({ slug: 'test-alum-a', sessionNo: 77, body: 'x' }) }, alumA)).status === 400);
  ok('...a student who has not confirmed cannot hand in for a session', (await J2(SUB, { method: 'POST',
    body: JSON.stringify({ slug: 'test-new-three', sessionNo: 3, body: 'x' }) }, { 'x-member-code': codeOf('test-new-three') })).status === 403);
  ok("...nor into someone else's page", (await J2(SUB, { method: 'POST',
    body: JSON.stringify({ slug: 'test-alum-a', sessionNo: 3, body: 'x' }) }, { 'x-member-code': codeOf('test-new-two') })).status === 401);
  const COM = (slug, day) => `/api/idcn/admin/idcn3/students/${ID(slug)}/comments/${day}`;
  ok('a comment needs the admin key', (await J2(COM('test-alum-a', 14), { method: 'PUT', body: '{"body":"x"}' })).status === 401);
  ok('a comment on a day the calendar does not have → 404', (await J2(COM('test-alum-a', 45), { method: 'PUT', body: '{"body":"x"}' }, A)).status === 404);
  const c1 = await J2(COM('test-alum-a', 14), { method: 'PUT', body: JSON.stringify({ body: 'Test: steady breath today.', by: 'Test Teacher' }) }, A);
  const c2 = await J2(COM('test-alum-a', 14), { method: 'PUT', body: JSON.stringify({ body: 'Test: steady breath, softer jaw.' }) }, A);
  const comRows = (await pool.query(`SELECT count(*)::int AS n FROM idc_notes WHERE student_id=$1 AND kind='comment' AND day_no=14`, [ID('test-alum-a')])).rows[0].n;
  ok('one comment per day: a second save edits it', c1.status === 200 && c2.status === 200 && c2.body.comment.id === c1.body.comment.id
     && c2.body.comment.body === 'Test: steady breath, softer jaw.' && c2.body.comment.created_by === 'teacher'
     && c1.body.comment.created_by === 'Test Teacher' && c2.body.comment.updated_at && comRows === 1, JSON.stringify(c2.body));
  await J2(COM('test-alum-a', 3), { method: 'PUT', body: JSON.stringify({ body: 'Test: day 3 comment.' }) }, A);
  const pA4 = (await P('test-alum-a', alumA)).body;
  ok('she sees her hand-in under session #3 and her comments by day',
     pA4.sessionsWork['3'].submissions.length === 1 && pA4.sessionsWork['3'].submissions[0].body === 'Test answer, in words.'
       && pA4.comments['14'].body === 'Test: steady breath, softer jaw.' && pA4.comments['14'].day === 14 && pA4.comments['3']
       && !pA4.notes.some(n => n.kind === 'comment' || n.kind === 'submission'), JSON.stringify(pA4.comments));
  const pN2 = (await P('test-new-two', { 'x-member-code': codeOf('test-new-two') })).body;
  ok("another student sees the assignment, never her hand-in or her comments",
     pN2.sessionsWork['3'].assignments.length === 1 && pN2.sessionsWork['3'].submissions.length === 0 && !('comments' in pN2),
     JSON.stringify(pN2.sessionsWork));
  const OV = d => `/api/idcn/admin/idcn3/days/${d}/overview`;
  ok('the day view needs the admin key', (await J2(OV(3))).status === 401);
  ok('...a day not in the calendar → 404', (await J2(OV(45), {}, A)).status === 404);
  await pool.query(`UPDATE idc_students SET status='withdrawn' WHERE id=$1`, [ID('test-new-six')]);
  const ov = (await J2(OV(3), {}, A)).body;
  const ovA = ov.students.find(s => s.slug === 'test-alum-a');
  ok('the day view: the day, its session, and each student with that day\'s work and comment',
     ov.day.day === 3 && ov.day.sessions.map(s => s.no).join() === '3' && ovA.beforeStart === true && ovA.start_date === '2027-01-24'
       && ovA.sessionsWork['3'].submissions.length === 1 && ovA.sessionsWork['3'].assignments.length === 1
       && ovA.comment.body === 'Test: day 3 comment.'
       && ov.students.find(s => s.slug === 'test-new-one').beforeStart === false
       && ov.students.find(s => s.slug === 'test-new-one').comment === null
       && !ov.students.some(s => s.slug === 'test-new-six'), JSON.stringify(ovA).slice(0, 400));
  await pool.query(`UPDATE idc_students SET status='invited' WHERE id=$1`, [ID('test-new-six')]);
  const counts = (await J2('/api/idcn/admin/idcn3/students', {}, A)).body.students.find(s => s.slug === 'test-alum-a');
  ok('the admin list counts her comments and session hand-ins', counts.comments === 2 && counts.session_submissions === 1);
  ok('an empty comment removes it', (await J2(COM('test-alum-a', 3), { method: 'PUT', body: '{"body":""}' }, A)).body.deleted === true
     && !('3' in (await P('test-alum-a', alumA)).body.comments));
  const subId = sub.body.note.id;
  ok('deleting a note needs the admin key', (await J2(`${NOTES}/${subId}`, { method: 'DELETE' })).status === 401);
  ok('staff delete a hand-in put in by mistake', (await J2(`${NOTES}/${subId}`, { method: 'DELETE' }, A)).status === 200
     && (await P('test-alum-a', alumA)).body.sessionsWork['3'].submissions.length === 0
     && (await J2(`${NOTES}/${subId}`, { method: 'DELETE' }, A)).status === 404);

  console.log('\n[IDCN#3: a refused upload leaves no file behind]');
  const tmpFiles = () => fs.readdirSync(MULTER_TMP).length;
  const form = fields => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    fd.append('file', new Blob([Buffer.alloc(2048, 1)], { type: 'video/mp4' }), 'test.mp4'); return fd; };
  const s401 = await fetch(B2 + SUB, { method: 'POST', body: form({ slug: 'test-alum-a' }), headers: { 'x-idcn-key': 'wrong' } });
  const s403 = await fetch(B2 + SUB, { method: 'POST', body: form({ slug: 'test-new-three', sessionNo: '3' }),
    headers: { 'x-member-code': codeOf('test-new-three') } });
  const n401 = await fetch(B2 + NOTES, { method: 'POST', body: form({ all: 'true', body: 'x' }) });
  const n400 = await fetch(B2 + NOTES, { method: 'POST', body: form({ all: 'true', body: 'x', sessionNo: '77' }), headers: A });
  await new Promise(r => setTimeout(r, 200));
  ok('a hand-in or a note refused (401, 403, 400) leaves nothing in the upload folder',
     s401.status === 401 && s403.status === 403 && n401.status === 401 && n400.status === 400 && tmpFiles() === 0,
     `${s401.status} ${s403.status} ${n401.status} ${n400.status} ${tmpFiles()} files`);

  console.log('\n[IDCN#3: one sign-in link per student, for Jamsai to send]');
  const LL = slug => `/api/idcn/admin/idcn3/students/${ID(slug)}/login-link`;
  ok('the link needs the admin key', (await J2(LL('test-new-one'), { method: 'POST' })).status === 401);
  const noLink = await J2(`/api/idcn/admin/idcn3/students/${YID}/login-link`, { method: 'POST' }, A);
  ok('a student with no AYBKK account linked → 409', noLink.status === 409 && /link this student/.test(noLink.body.error));
  const ll = await J2(LL('test-new-one'), { method: 'POST' }, A);
  ok('a linked student gets the staff sign-in link: short, 7 days, her name',
     ll.status === 200 && /\/in\/[23456789abcdefghjkmnpqrstuvwxyz]{10}$/.test(ll.body.short_link) && ll.body.days === 7
       && ll.body.name === 'Test New One' && /\/api\/bkk\/login\/[0-9a-f]{64}$/.test(ll.body.link)
       && Object.keys(ll.body).sort().join() === 'days,link,name,short_link,success', JSON.stringify(ll.body).slice(0, 60));
  const hop = await fetch(`${B2}/in/${ll.body.short_link.split('/in/')[1]}`, { redirect: 'manual' });
  const tok = ll.body.link.split('/').pop();
  const land = await fetch(`${B2}/api/bkk/login/${tok}`, { method: 'POST' }).then(r => r.text());
  ok('...the short link opens the bkk sign-in, which signs her in to her own account',
     hop.status === 302 && hop.headers.get('location') === `/api/bkk/login/${tok}`
       && land.includes(codeOf('test-new-one')) && land.includes('/book?me=1'));
  ok('...where My account finds her course', (await J2(`/api/idcn/mine/${codeOf('test-new-one')}`)).body.courses[0].slug === 'test-new-one');
  ok('without bkk on the server: no link, and it says why', (await J(`/api/idcn/admin/idcn3/students/${ID('test-new-one')}/login-link`,
    { method: 'POST' }, A)).status === 503);
  const viaBkk = await J2(`/api/bkk/admin/members/${codeOf('test-new-one')}/signin-link`, { method: 'POST', body: '{}' }, A);
  ok("bkk's own sign-in link route answers as before", viaBkk.status === 200 && viaBkk.body.success === true
     && Object.keys(viaBkk.body).join() === 'success,name,days,link,short_link', Object.keys(viaBkk.body).join());

  // ── Cloudinary exit (25 Nov 2026): course files in R2, a file that does not arrive, the copy ──
  console.log('\n[course files in R2 (a fake R2 and a fake Cloudinary on this machine)]');
  const { fakeR2, r2On, r2Off, md5 } = require('./fake-r2');
  const { createCanvas } = require('@napi-rs/canvas');
  const r2lib = require('../lib/r2.js');
  const mediaLib = require('../lib/media-store.js');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fr2 = await fakeR2();
  const jpeg = async (w, h) => { const c = createCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#3366aa'; x.fillRect(0, 0, w, h); x.fillStyle = '#ffcc00'; x.fillRect(0, 0, w / 3, h / 3); return c.encode('jpeg', 90); };
  const dataUrl = b => 'data:image/jpeg;base64,' + b.toString('base64');
  // what Cloudinary was asked, an outage switch, its tag search and the originals it delivers
  const cl = { calls: [], searches: 0, down: false, found: [], originals: new Map() };
  const fakeCloud = {
    uploader: { upload: async (src, o) => {
      cl.calls.push(o);
      if (cl.down) throw new Error('Cloudinary is paused (test)');
      const n = cl.calls.length;
      return { secure_url: `https://res.cloudinary.com/dw1uubecu/${o.resource_type}/upload/v1/${o.folder}/t${n}.${o.resource_type === 'video' ? 'mp4' : 'jpg'}`,
        public_id: `${o.folder}/t${n}`, width: 40, height: 30 };
    } },
    search: { expression: () => { const ch = { sort_by: () => ch, max_results: () => ch, execute: async () => {
      cl.searches++;
      if (cl.down) throw new Error('Cloudinary is paused (test)');
      return { resources: cl.found };
    } }; return ch; } },
  };
  const fakeFetch = async url => {
    if (cl.slow) await sleep(cl.slow);
    return cl.originals.has(url) ? new Response(cl.originals.get(url), { status: 200 }) : new Response('gone', { status: 404 });
  };
  r2On();
  process.env.TMPDIR = MULTER_TMP;
  const app3 = express(); app3.use(express.json({ limit: '10mb' }));
  mountIdcn(app3, { pgPool: pool, r2Endpoint: fr2.url, cloudinary: fakeCloud, fetch: fakeFetch, autoCopy: false });
  r2Off();
  const app4 = express(); app4.use(express.json({ limit: '10mb' }));
  mountIdcn(app4, { pgPool: pool, cloudinary: fakeCloud, fetch: fakeFetch });
  if (keepTmp == null) delete process.env.TMPDIR; else process.env.TMPDIR = keepTmp;
  await sleep(800);
  await pool.query('DELETE FROM idc_hub_photos');
  await pool.query(`DELETE FROM idc_settings WHERE key='hub_copied'`);
  const srv3 = app3.listen(0), B3 = `http://127.0.0.1:${srv3.address().port}`;
  const srv4 = app4.listen(0), B4 = `http://127.0.0.1:${srv4.address().port}`;
  const Jx = base => async (p, opts = {}, headers = {}) => {
    const r = await fetch(base + p, { ...opts, headers: { 'Content-Type': 'application/json', ...headers } });
    return { status: r.status, headers: r.headers, body: await r.json().catch(() => ({})) };
  };
  const J3 = Jx(B3), J4 = Jx(B4);
  const multi = (base, p, fields, file, headers = {}) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    if (file) fd.append('file', new Blob([file.body], { type: file.type }), file.name);
    return fetch(base + p, { method: 'POST', body: fd, headers }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  };
  const vid = crypto.randomBytes(2 * 1024 * 1024);
  const clip = { body: vid.subarray(0, 4096), type: 'video/mp4', name: 'test.mp4' };
  const AL = ID('test-alum-a');

  const ph = await jpeg(800, 600);
  const calls0 = cl.calls.length;
  const up1 = await J3('/api/idcn/idcn3/photos', { method: 'POST', body: JSON.stringify({ slug: 'test-alum-a', imageBase64: dataUrl(ph) }) }, alumA);
  ok('R2 on: a hub photo goes to R2, never to Cloudinary, and its link is a path on this site',
     up1.status === 200 && /^\/md\/0\.[\w-]{22}\/idcn\/idcn3\/hub\/[0-9a-f]{32}\.jpg$/.test(up1.body.url) && cl.calls.length === calls0,
     JSON.stringify(up1.body));
  const g1 = await fetch(B3 + up1.body.url), g1b = Buffer.from(await g1.arrayBuffer()), d1 = r2lib.dims(g1b);
  ok('...the link opens a JPEG made again (800 x 600, no EXIF), private, never kept on the way',
     g1.status === 200 && g1.headers.get('content-type') === 'image/jpeg' && d1 && d1.w === 800 && d1.h === 600
       && !g1b.includes(Buffer.from('Exif')) && g1.headers.get('cache-control') === 'private, max-age=86400'
       && g1.headers.get('x-content-type-options') === 'nosniff', `${g1.status} ${g1.headers.get('cache-control')}`);
  const hubRows = (await pool.query(`SELECT media, uploader FROM idc_hub_photos WHERE course_code='idcn3'`)).rows;
  ok('...and the hub has its own row: the R2 key and who uploaded it', hubRows.length === 1
     && /^r2:idcn\/idcn3\/hub\/[0-9a-f]{32}\.jpg$/.test(hubRows[0].media) && hubRows[0].uploader === AL, JSON.stringify(hubRows));
  cl.found = [{ public_id: 'aybkk/idcn3/2026-11-20/testold', secure_url: 'https://res.cloudinary.com/dw1uubecu/image/upload/v1/aybkk/idcn3/2026-11-20/testold.jpg',
    width: 40, height: 30, created_at: '2026-11-20T03:00:00Z' }];
  cl.down = true;
  const l0 = await J3('/api/idcn/idcn3/photos?slug=test-alum-a', {}, alumA);
  ok('Cloudinary down: the hub list still answers, with the photos in R2',
     l0.status === 200 && l0.body.days.length === 1 && l0.body.days[0].items[0].url === up1.body.url, JSON.stringify(l0.body));
  cl.down = false;
  const l1 = await J3('/api/idcn/idcn3/photos?slug=test-alum-a', {}, alumA);
  ok('Cloudinary up: the older photo still only there is listed too, under its own day',
     l1.status === 200 && l1.body.days.length === 2 && l1.body.days[0].items[0].url === up1.body.url
       && l1.body.days[1].date === '2026-11-20' && l1.body.days[1].items[0].url === cl.found[0].secure_url, JSON.stringify(l1.body));

  const h1 = await multi(B3, SUB, { slug: 'test-alum-a', sessionNo: '3', body: 'Test answer with a clip.' },
    { body: vid, type: 'video/mp4', name: 'clip.mp4' }, alumA);
  const vurl = h1.body.note && h1.body.note.media_url;
  ok('a hand-in video goes to R2, its link a signed path on this site',
     h1.status === 200 && /^\/md\/0\.[\w-]{22}\/idcn\/idcn3\/sub\/[0-9a-f]{32}\.mp4$/.test(vurl || '') && h1.body.note.media_type === 'video'
       && !('mediaFailed' in h1.body) && !('media_failed' in h1.body.note), JSON.stringify(h1.body).slice(0, 200));
  const rg = await fetch(B3 + vurl, { headers: { Range: 'bytes=0-1' } }), rgb = Buffer.from(await rg.arrayBuffer());
  ok('...a phone asks for bytes 0-1 and gets a 206 with the whole size (Safari plays nothing without it)',
     rg.status === 206 && rg.headers.get('content-range') === `bytes 0-1/${vid.length}` && rgb.equals(vid.subarray(0, 2))
       && rg.headers.get('accept-ranges') === 'bytes' && rg.headers.get('content-type') === 'video/mp4', `${rg.status} ${rg.headers.get('content-range')}`);
  const open = await fetch(B3 + vurl, { headers: { Range: 'bytes=1048576-' } });
  ok('...an open range runs to the end', open.status === 206 && Buffer.from(await open.arrayBuffer()).equals(vid.subarray(1048576)));
  const whole = await fetch(B3 + vurl);
  ok('...no range: the whole file, byte for byte', whole.status === 200 && whole.headers.get('content-length') === String(vid.length)
     && Buffer.from(await whole.arrayBuffer()).equals(vid));
  ok('...a range past the end → 416', (await fetch(B3 + vurl, { headers: { Range: `bytes=${vid.length + 10}-` } })).status === 416);
  const hd = await fetch(B3 + vurl, { method: 'HEAD' });
  ok('...HEAD gives the size', hd.status === 200 && hd.headers.get('content-length') === String(vid.length));
  const vkey = vurl.split('/').slice(3).join('/');
  const sigAt = vurl.indexOf('.') + 1;
  const badSig = vurl.slice(0, sigAt) + (vurl[sigAt] === 'A' ? 'B' : 'A') + vurl.slice(sigAt + 1);
  ok('a link with a changed signature opens nothing (403)', (await fetch(B3 + badSig)).status === 403);
  const endedR = await fetch(B3 + mediaLib.mdPath(vkey, { days: 1, now: Date.now() - 5 * 86400e3 }));
  ok('a link that ended opens nothing (403, reload the page)', endedR.status === 403 && /ended/.test((await endedR.json()).error));
  ok('...a fresh one opens', (await fetch(B3 + mediaLib.mdPath(vkey, { days: 1 }))).status === 200);
  ok('a signed link to a file that is not there → 404', (await fetch(B3 + mediaLib.mdPath('idcn/idcn3/sub/' + 'a'.repeat(32) + '.mp4'))).status === 404);
  ok('a signed link outside the course files is refused', mediaLib.mdCheck('0', 'x'.repeat(22), 'cls/2026-11-20/abc/v.jpg') === 'bad');

  const notesOf = async id => (await pool.query('SELECT count(*)::int AS n FROM idc_notes WHERE student_id=$1', [id])).rows[0].n;
  fr2.ctl.fail = (m, k) => (m === 'PUT' && k.includes('/sub/') ? 503 : null);
  const n0 = await notesOf(AL);
  const f1 = await multi(B3, SUB, { slug: 'test-alum-a', sessionNo: '3', body: 'Test words kept when the file fails.' }, clip, alumA);
  ok('R2 refuses the file: the written answer is saved all the same, marked, and the page is told to send the file again',
     f1.status === 200 && f1.body.mediaFailed === true && f1.body.note.media_failed === true && f1.body.note.media_url === null
       && f1.body.note.body === 'Test words kept when the file fails.' && (await notesOf(AL)) === n0 + 1, JSON.stringify(f1.body));
  const f0 = await multi(B3, SUB, { slug: 'test-alum-a', sessionNo: '3' }, clip, alumA);
  ok('...a file with no words is an error as before, and nothing is saved', f0.status === 500 && (await notesOf(AL)) === n0 + 1, `${f0.status}`);
  const kept = ((await J3('/api/idcn/idcn3/students/test-alum-a', {}, alumA)).body.sessionsWork['3'].submissions || [])
    .find(n => n.id === f1.body.note.id);
  ok('...her page shows the hand-in waiting for its file', !!kept && kept.media_failed === true && kept.media_url === null);
  const AGAIN = `/api/idcn/idcn3/submissions/${f1.body.note.id}/media`;
  const stateOf = async id => (await pool.query('SELECT media_state, media_url FROM idc_notes WHERE id=$1', [id])).rows[0];
  ok('...sent again while R2 still refuses: 502, still waiting',
     (await multi(B3, AGAIN, { slug: 'test-alum-a' }, clip, alumA)).status === 502 && (await stateOf(f1.body.note.id)).media_state === 'failed');
  fr2.ctl.fail = null;
  ok('...nobody else can send it', (await multi(B3, AGAIN, { slug: 'test-alum-a' }, clip, { 'x-idcn-key': 'wrong' })).status === 401);
  const fix = await multi(B3, AGAIN, { slug: 'test-alum-a' }, clip, alumA);
  ok('...sent again once R2 answers: the hand-in has its file and is no longer marked',
     fix.status === 200 && /^\/md\/0\.[\w-]{22}\/idcn\/idcn3\/sub\//.test(fix.body.note.media_url) && !('media_failed' in fix.body.note)
       && (await stateOf(f1.body.note.id)).media_state === null, JSON.stringify(fix.body).slice(0, 160));
  ok('...a second time nothing is waiting (404)', (await multi(B3, AGAIN, { slug: 'test-alum-a' }, clip, alumA)).status === 404);

  const PAY = id => `/api/idcn/admin/idcn3/students/${id}/payments`;
  const shot = dataUrl(await jpeg(300, 500));
  const p1 = await J3(PAY(AL), { method: 'POST', body: JSON.stringify({ label: 'Test deposit', amountSatang: 100000, imageBase64: shot }) }, A);
  const pexp = p1.body.payment ? Number(p1.body.payment.proof_url.split('/')[2].split('.')[0]) * 1000 : 0;
  ok('R2 on: a payment screenshot goes to R2 under a link that ends within two days',
     p1.status === 200 && /^\/md\/[1-9]\d*\.[\w-]{22}\/idcn\/idcn3\/proof\/[0-9a-f]{32}\.jpg$/.test(p1.body.payment.proof_url)
       && pexp - Date.now() > 86400e3 - 60e3 && pexp - Date.now() <= 2 * 86400e3
       && Object.keys(p1.body.payment).join() === 'id,label,amount_satang,proof_url,note,created_at', JSON.stringify(p1.body));
  const pg = await fetch(B3 + p1.body.payment.proof_url);
  ok('...it opens, private and for an hour at most', pg.status === 200 && pg.headers.get('cache-control') === 'private, max-age=3600');
  const ownPays = (await J3('/api/idcn/idcn3/students/test-alum-a', {}, alumA)).body.payments;
  ok('...her page has it; the database keeps the key, never a link',
     ownPays.some(p => p.id === p1.body.payment.id && /^\/md\//.test(p.proof_url) && !('proof_state' in p))
       && /^r2:idcn\/idcn3\/proof\//.test((await pool.query('SELECT proof_url FROM idc_payments WHERE id=$1', [p1.body.payment.id])).rows[0].proof_url));
  fr2.ctl.fail = (m, k) => (m === 'PUT' && k.includes('/proof/') ? 503 : null);
  const p2 = await J3(PAY(AL), { method: 'POST', body: JSON.stringify({ label: 'Test second payment', amountSatang: 200000, imageBase64: shot }) }, A);
  ok('R2 refuses the screenshot: the payment is saved, marked, and staff are told to send it again',
     p2.status === 200 && p2.body.proofFailed === true && p2.body.payment.proof_failed === true && p2.body.payment.proof_url === null
       && Number(p2.body.payment.amount_satang) === 200000, JSON.stringify(p2.body));
  fr2.ctl.fail = null;
  const PROOF = `/api/idcn/admin/idcn3/payments/${p2.body.payment.id}/proof`;
  ok('...sending it again needs the admin key', (await J3(PROOF, { method: 'POST', body: JSON.stringify({ imageBase64: shot }) })).status === 401);
  const p2r = await J3(PROOF, { method: 'POST', body: JSON.stringify({ imageBase64: shot }) }, A);
  ok('...sent again: the payment has its screenshot', p2r.status === 200 && /\/proof\//.test(p2r.body.payment.proof_url)
     && !('proof_failed' in p2r.body.payment) && p2r.body.payment.id === p2.body.payment.id);

  fr2.ctl.fail = (m, k) => (m === 'PUT' && k.includes('/note/') ? 503 : null);
  const bn = await multi(B3, '/api/idcn/admin/idcn3/notes', { all: 'true', kind: 'note', body: 'Test note to all, its file fails' }, clip, A);
  const bnRows = async () => (await pool.query(`SELECT id, media_state, media_batch, media_url FROM idc_notes WHERE body='Test note to all, its file fails'`)).rows;
  const bn1 = await bnRows();
  ok('R2 refuses a note file: the note still reaches everyone, all marked with one batch',
     bn.status === 200 && bn.body.mediaFailed === true && bn1.length === bn.body.sentTo && bn.body.sentTo > 1
       && bn1.every(r => r.media_state === 'failed' && r.media_batch && r.media_batch === bn1[0].media_batch) && bn1.some(r => r.id === bn.body.retryId),
     JSON.stringify(bn.body));
  fr2.ctl.fail = null;
  const bnr = await multi(B3, `/api/idcn/admin/idcn3/notes/${bn.body.retryId}/media`, {}, clip, A);
  const bn2 = await bnRows();
  ok('...the file sent once reaches every note of that send', bnr.status === 200 && bnr.body.updated === bn.body.sentTo
     && bn2.every(r => r.media_state === null && /^r2:idcn\/idcn3\/note\//.test(r.media_url) && r.media_url === bn2[0].media_url));

  console.log('\n[the copy of the course files still on Cloudinary]');
  const OLD = {
    v: 'https://res.cloudinary.com/dw1uubecu/video/upload/v1/aybkk/idcn3/submissions/test-alum-a/testold1.mov',
    a: 'https://res.cloudinary.com/dw1uubecu/image/upload/v1/aybkk/idcn3/assignments/testdemo1.jpg',
    p: 'https://res.cloudinary.com/dw1uubecu/image/upload/v1/aybkk/idcn3/proofs/test-alum-a/testp1.png',
    gone: 'https://res.cloudinary.com/dw1uubecu/image/upload/v1/aybkk/idcn3/proofs/test-alum-a/testgone.jpg',
  };
  cl.originals.set(OLD.v, crypto.randomBytes(300000));
  cl.originals.set(OLD.a, await jpeg(64, 48));
  cl.originals.set(OLD.p, await createCanvas(20, 20).encode('png'));
  cl.originals.set(cl.found[0].secure_url, await jpeg(40, 30));
  const other = ID('test-new-one');
  await pool.query(`INSERT INTO idc_notes (student_id, kind, body, media_url, media_type, session_no) VALUES ($1,'submission','Test old clip',$2,'video',3)`, [AL, OLD.v]);
  await pool.query(`INSERT INTO idc_notes (student_id, kind, body, media_url, media_type) VALUES ($1,'assignment','Test old demo',$3,'image'), ($2,'assignment','Test old demo',$3,'image')`, [AL, other, OLD.a]);
  const pOld = (await pool.query(`INSERT INTO idc_payments (student_id, label, proof_url) VALUES ($1,'Test old proof',$2), ($1,'Test lost proof',$3) RETURNING id`, [AL, OLD.p, OLD.gone])).rows;
  const COPY = '/api/idcn/admin/idcn3/media-copy';
  ok('the copy needs the admin key', (await J3(COPY, { method: 'POST', body: '{}' })).status === 401 && (await J3(COPY)).status === 401);
  const runCopy = async () => {
    const s = await J3(COPY, { method: 'POST', body: '{}' }, A);
    let st = s.body;
    for (let i = 0; i < 400 && st.running; i++) { await sleep(25); st = (await J3(COPY, {}, A)).body; }
    return { start: s.status, st };
  };
  const cp1 = await runCopy();
  ok('it runs in the background (202) and says how many files were copied, failed and are left',
     cp1.start === 202 && cp1.st.running === false && cp1.st.hub.copied === 1 && cp1.st.hub.left === 0
       && cp1.st.notes.copied === 2 && cp1.st.notes.left === 0 && cp1.st.proofs.copied === 1 && cp1.st.proofs.failed === 1 && cp1.st.proofs.left === 1,
     JSON.stringify(cp1.st));
  const urlOf = async (t, col, where, args) => (await pool.query(`SELECT ${col} AS u FROM ${t} WHERE ${where}`, args)).rows.map(r => r.u);
  const vNow = await urlOf('idc_notes', 'media_url', `body='Test old clip'`, []);
  const aNow = await urlOf('idc_notes', 'media_url', `body='Test old demo'`, []);
  const pNow = await urlOf('idc_payments', 'proof_url', 'id = ANY($1::int[]) ORDER BY id', [pOld.map(r => r.id)]);
  const same = (ref, orig) => !!ref && ref.startsWith('r2:') && fr2.store.has(ref.slice(3)) && md5(fr2.store.get(ref.slice(3)).body) === md5(orig);
  ok('...each row now points at its copy in R2, byte for byte the original (a video keeps .mov, a PNG keeps .png)',
     same(vNow[0], cl.originals.get(OLD.v)) && /\.mov$/.test(vNow[0]) && same(pNow[0], cl.originals.get(OLD.p)) && /\.png$/.test(pNow[0]), JSON.stringify([vNow, pNow]));
  ok('...a note sent to two students shares one copy', aNow.length === 2 && aNow[0] === aNow[1] && same(aNow[0], cl.originals.get(OLD.a)));
  ok('...a file Cloudinary no longer has keeps its old link, nothing lost', pNow[1] === OLD.gone);
  const hubNow = (await pool.query(`SELECT media, to_char(day,'YYYY-MM-DD') AS day FROM idc_hub_photos WHERE public_id=$1`, [cl.found[0].public_id])).rows[0];
  ok('...the older hub photo has its row in the hub list now, its day kept', !!hubNow && same(hubNow.media, cl.originals.get(cl.found[0].secure_url)) && hubNow.day === '2026-11-20');
  const s1 = cl.searches;
  const l2 = await J3('/api/idcn/idcn3/photos?slug=test-alum-a', {}, alumA);
  ok('...every hub photo copied: the list no longer asks Cloudinary, and both are on this site',
     cl.searches === s1 && l2.body.days.length === 2 && l2.body.days.every(d => d.items.every(it => /^\/md\/0\./.test(it.url))), JSON.stringify(l2.body));
  const cp2 = await runCopy();
  ok('pressed again: only what is left, nothing copied twice', cp2.st.hub.copied === 0 && cp2.st.notes.copied === 0 && cp2.st.proofs.copied === 0
     && cp2.st.proofs.failed === 1 && (await urlOf('idc_notes', 'media_url', `body='Test old clip'`, []))[0] === vNow[0], JSON.stringify(cp2.st));
  const OLDP2 = 'https://res.cloudinary.com/dw1uubecu/image/upload/v1/aybkk/idcn3/proofs/test-alum-a/testp2.jpg';
  cl.originals.set(OLDP2, await jpeg(30, 30));
  const pid2 = (await pool.query(`INSERT INTO idc_payments (student_id, label, proof_url) VALUES ($1,'Test checked proof',$2) RETURNING id`, [AL, OLDP2])).rows[0].id;
  fr2.ctl.badEtag = true;
  const cp3 = await runCopy();
  fr2.ctl.badEtag = false;
  ok('a copy R2 does not give back the same is never pointed at, and the run stops',
     (await urlOf('idc_payments', 'proof_url', 'id=$1', [pid2]))[0] === OLDP2 && cp3.st.errors.some(e => /does not match/.test(e)), JSON.stringify(cp3.st));
  const cp4 = await runCopy();
  ok('...pressed again with R2 well: copied', cp4.st.proofs.copied === 1 && same((await urlOf('idc_payments', 'proof_url', 'id=$1', [pid2]))[0], cl.originals.get(OLDP2)));

  console.log('\n[R2 off: Cloudinary exactly as before, but a file that fails never costs the row]');
  const day = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const k0 = cl.calls.length;
  const u4 = await J4('/api/idcn/idcn3/photos', { method: 'POST', body: JSON.stringify({ slug: 'test-alum-a', imageBase64: dataUrl(ph) }) }, alumA);
  ok('a hub photo goes to Cloudinary as before (folder by day, the course tag); the answer is its Cloudinary link',
     u4.status === 200 && JSON.stringify(cl.calls[k0]) === JSON.stringify({ folder: `aybkk/idcn3/${day}`, tags: ['aybkk-idcn3'], resource_type: 'image' })
       && u4.body.url === `https://res.cloudinary.com/dw1uubecu/image/upload/v1/aybkk/idcn3/${day}/t${k0 + 1}.jpg`
       && Object.keys(u4.body).join() === 'success,url', JSON.stringify(u4.body));
  await sleep(150);
  ok('...and it is noted in the hub list, for the copy', (await pool.query('SELECT 1 FROM idc_hub_photos WHERE media=$1 AND public_id IS NOT NULL', [u4.body.url])).rowCount === 1);
  const s4 = cl.searches;
  const l4 = await J4('/api/idcn/idcn3/photos?slug=test-alum-a', {}, alumA);
  ok("the hub list is Cloudinary's tag search, as before", cl.searches === s4 + 1
     && JSON.stringify(l4.body) === JSON.stringify({ days: [{ date: '2026-11-20', items: [{ url: cl.found[0].secure_url, w: 40, h: 30 }] }] }), JSON.stringify(l4.body));
  const pay4 = await J4(PAY(AL), { method: 'POST', body: JSON.stringify({ label: 'Test R2 off', imageBase64: shot }) }, A);
  ok('a screenshot goes to Cloudinary as before, and its link is sent as it is',
     pay4.status === 200 && JSON.stringify(cl.calls[cl.calls.length - 1]) === JSON.stringify({ folder: 'aybkk/idcn3/proofs/test-alum-a', resource_type: 'image' })
       && /^https:\/\/res\.cloudinary\.com\/dw1uubecu\/image\/upload\/v1\/aybkk\/idcn3\/proofs\/test-alum-a\/t\d+\.jpg$/.test(pay4.body.payment.proof_url)
       && Object.keys(pay4.body).join() === 'success,payment'
       && Object.keys(pay4.body.payment).join() === 'id,label,amount_satang,proof_url,note,created_at', JSON.stringify(pay4.body));
  const h4 = await multi(B4, SUB, { slug: 'test-alum-a', sessionNo: '3', body: 'Test R2 off clip' }, clip, alumA);
  const last = cl.calls[cl.calls.length - 1];
  ok('a hand-in video goes to Cloudinary as before (video, 6 MB chunks)', h4.status === 200 && last.folder === 'aybkk/idcn3/submissions/test-alum-a'
     && last.resource_type === 'video' && last.chunk_size === 6 * 1024 * 1024 && /^https:\/\/res\.cloudinary\.com\//.test(h4.body.note.media_url)
     && !('mediaFailed' in h4.body), JSON.stringify(h4.body).slice(0, 200));
  cl.down = true;
  const n4 = await notesOf(AL);
  const h5 = await multi(B4, SUB, { slug: 'test-alum-a', sessionNo: '3', body: 'Test words while Cloudinary is paused' }, clip, alumA);
  ok('Cloudinary paused: the written answer is saved, marked, never lost', h5.status === 200 && h5.body.mediaFailed === true
     && h5.body.note.media_failed === true && (await notesOf(AL)) === n4 + 1);
  const p5 = await J4(PAY(AL), { method: 'POST', body: JSON.stringify({ label: 'Test paused', amountSatang: 5000, imageBase64: shot }) }, A);
  ok('...and so is a payment whose screenshot did not go', p5.status === 200 && p5.body.proofFailed === true && p5.body.payment.proof_failed === true);
  ok('...a hub photo (nothing to keep) is an error as before', (await J4('/api/idcn/idcn3/photos', { method: 'POST',
    body: JSON.stringify({ slug: 'test-alum-a', imageBase64: dataUrl(ph) }) }, alumA)).status === 500);
  cl.down = false;
  const r5 = await multi(B4, `/api/idcn/idcn3/submissions/${h5.body.note.id}/media`, { slug: 'test-alum-a' }, clip, alumA);
  ok('...sent again once Cloudinary answers', r5.status === 200 && /^https:\/\/res\.cloudinary\.com\//.test(r5.body.note.media_url));
  ok('the copy says R2 is not set up', (await J4(COPY, { method: 'POST', body: '{}' }, A)).status === 409);
  const md4 = await fetch(B4 + vurl);
  ok('a signed /md link is a 503 nobody keeps', md4.status === 503 && md4.headers.get('cache-control') === 'no-store');
  ok('...and any other /md path is no route here (404 from express)', (await fetch(B4 + '/md/0.x/idcn/x')).status === 404
     && (await fetch(B4 + badSig)).status === 404);

  console.log('\n[photos R2 cannot use, screenshots at their own size, a missing screenshot, two copies at once, the copy by itself]');
  const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic\0\0\0\0mif1heic', 'latin1'), crypto.randomBytes(300)]);
  const keyOf = u => String(u || '').split('/').slice(3).join('/');
  const hubGif = await J3('/api/idcn/idcn3/photos', { method: 'POST', body: JSON.stringify({ slug: 'test-alum-a', imageBase64: 'data:image/gif;base64,' + GIF.toString('base64') }) }, alumA);
  const gifKey = keyOf(hubGif.body.url);
  ok('R2 on: a GIF in the hub is kept as it came (Cloudinary took GIFs too)', hubGif.status === 200 && /\/hub\/[0-9a-f]{32}\.gif$/.test(gifKey)
     && fr2.store.has(gifKey) && fr2.store.get(gifKey).body.equals(GIF) && fr2.store.get(gifKey).type === 'image/gif', JSON.stringify(hubGif.body));
  const gifGet = await fetch(B3 + hubGif.body.url);
  ok('...and opens as image/gif', gifGet.status === 200 && gifGet.headers.get('content-type') === 'image/gif' && Buffer.from(await gifGet.arrayBuffer()).equals(GIF));
  const hubHeic = await J3('/api/idcn/idcn3/photos', { method: 'POST', body: JSON.stringify({ slug: 'test-alum-a', imageBase64: 'data:image/heic;base64,' + HEIC.toString('base64') }) }, alumA);
  ok("...a HEIC photo: 400 with the reason, and photoType for the page to say it in the student's language",
     hubHeic.status === 400 && hubHeic.body.photoType === true && /JPEG, or a screenshot/.test(hubHeic.body.error), JSON.stringify(hubHeic.body));
  const hh = await multi(B3, SUB, { slug: 'test-alum-a', sessionNo: '3', body: 'Test words with a HEIC photo' }, { body: HEIC, type: 'image/heic', name: 'a.heic' }, alumA);
  ok('a hand-in with words and a HEIC photo: the words are saved, and the answer says why, not "send the file again"',
     hh.status === 200 && hh.body.mediaFailed === true && hh.body.photoType === true && /JPEG, or a screenshot/.test(hh.body.mediaError)
       && hh.body.note.media_failed === true && hh.body.note.body === 'Test words with a HEIC photo', JSON.stringify(hh.body));
  const HH = `/api/idcn/idcn3/submissions/${hh.body.note.id}/media`;
  const hh2 = await multi(B3, HH, { slug: 'test-alum-a' }, { body: HEIC, type: 'image/heic', name: 'a.heic' }, alumA);
  ok('...the same HEIC sent again: 400 with the same reason, so the page never loops on "send again"',
     hh2.status === 400 && hh2.body.photoType === true && /JPEG, or a screenshot/.test(hh2.body.error) && !/send the file again/.test(hh2.body.error), JSON.stringify(hh2.body));
  const hh3 = await multi(B3, HH, { slug: 'test-alum-a' }, { body: await jpeg(320, 240), type: 'image/jpeg', name: 'a.jpg' }, alumA);
  ok('...a JPEG in its place: the hand-in has its photo', hh3.status === 200 && /\/sub\/[0-9a-f]{32}\.jpg$/.test(hh3.body.note.media_url) && !hh3.body.note.media_failed);
  const hg = await multi(B3, SUB, { slug: 'test-alum-a', sessionNo: '3', body: 'Test words with a GIF' }, { body: GIF, type: 'image/gif', name: 'a.gif' }, alumA);
  ok('a hand-in GIF is kept as it came', hg.status === 200 && /\.gif$/.test(hg.body.note.media_url) && !hg.body.mediaFailed, JSON.stringify(hg.body).slice(0, 200));
  const n9 = await notesOf(AL);
  const noWords = await multi(B3, SUB, { slug: 'test-alum-a', sessionNo: '3' }, { body: HEIC, type: 'image/heic', name: 'a.heic' }, alumA);
  ok('...a HEIC with no words: 400 with the reason, nothing saved', noWords.status === 400 && noWords.body.photoType === true && (await notesOf(AL)) === n9);
  const big = await multi(B3, SUB, { slug: 'test-alum-a', sessionNo: '3', body: 'Test words with a huge photo' },
    { body: (() => { const b = Buffer.from(ph); const i = b.indexOf(Buffer.from([0xFF, 0xC0])); b.writeUInt16BE(9000, i + 5); b.writeUInt16BE(9000, i + 7); return b; })(), type: 'image/jpeg', name: 'big.jpg' }, alumA);
  ok('...a photo over 50 megapixels: the words are saved, photoBig says why', big.status === 200 && big.body.mediaFailed === true && big.body.photoBig === true
     && /too large/.test(big.body.mediaError), JSON.stringify(big.body));
  const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 32]), Buffer.from('ftypisom\0\0\x02\0isomiso2avc1mp41', 'latin1'), crypto.randomBytes(3000)]);
  const oct = await multi(B3, SUB, { slug: 'test-alum-a', sessionNo: '3', body: 'Test clip with no type' }, { body: MP4, type: 'application/octet-stream', name: 'clip' }, alumA);
  const octKey = keyOf(oct.body.note && oct.body.note.media_url);
  ok('a video sent as application/octet-stream is known by its first bytes and kept as a video',
     oct.status === 200 && oct.body.note.media_type === 'video' && /\/sub\/[0-9a-f]{32}\.mp4$/.test(octKey) && fr2.store.get(octKey).body.equals(MP4)
       && !oct.body.mediaFailed, JSON.stringify(oct.body).slice(0, 200));
  const md5csp = await fetch(B3 + vurl); await md5csp.arrayBuffer();
  ok('a course file opened on its own can play: no sandbox, photos and video from this site only',
     md5csp.headers.get('content-security-policy') === "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'"
       && md5csp.headers.get('x-content-type-options') === 'nosniff', md5csp.headers.get('content-security-policy'));

  const tallPng = await (() => { const c = createCanvas(1080, 6000), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 1080, 6000);
    x.fillStyle = '#000'; x.font = '28px sans-serif'; for (let y = 40; y < 6000; y += 60) x.fillText('Test transfer 500.00 ref ' + y, 20, y); return c.encode('png'); })();
  const tp = await J3(PAY(AL), { method: 'POST', body: JSON.stringify({ label: 'Test tall screenshot', amountSatang: 1000, imageBase64: 'data:image/png;base64,' + tallPng.toString('base64') }) }, A);
  const refOf = async id => String((await pool.query('SELECT proof_url FROM idc_payments WHERE id=$1', [id])).rows[0].proof_url || '');
  const tpKey = (await refOf(tp.body.payment.id)).slice(3), tpObj = fr2.store.get(tpKey), tpd = tpObj && r2lib.dims(tpObj.body);
  ok('a long payment screenshot keeps its own size (1080 x 6000), a PNG as a PNG',
     tp.status === 200 && /\/proof\/[0-9a-f]{32}\.png$/.test(tpKey) && tpd.w === 1080 && tpd.h === 6000 && tpObj.type === 'image/png', JSON.stringify(tpd));
  const ifd = Buffer.concat([Buffer.from('Exif\0\0MM\0*\0\0\0\x08\0\0\0\0\0\0', 'latin1'), Buffer.from('Test camera GPS')]);
  const wideRaw = await jpeg(3000, 1000);
  const withExif = Buffer.concat([wideRaw.subarray(0, 2), Buffer.from([0xFF, 0xE1]), Buffer.from([0, ifd.length + 2]), ifd, wideRaw.subarray(2)]);
  const wp = await J3(PAY(AL), { method: 'POST', body: JSON.stringify({ label: 'Test wide screenshot', imageBase64: dataUrl(withExif) }) }, A);
  const wpObj = fr2.store.get((await refOf(wp.body.payment.id)).slice(3)), wpd = wpObj && r2lib.dims(wpObj.body);
  ok('...a JPEG wider than 2560 px keeps its width, and its camera data does not go with it',
     wp.status === 200 && wpd.w === 3000 && wpd.h === 1000 && !wpObj.body.includes(Buffer.from('Exif')) && !wpObj.body.includes(Buffer.from('Test camera GPS')), JSON.stringify(wpd));

  fr2.ctl.fail = (m, k) => (m === 'PUT' && k.includes('/proof/') ? 503 : null);
  const mp = await J3(PAY(AL), { method: 'POST', body: JSON.stringify({ label: 'Test missing shot', amountSatang: 70000, imageBase64: shot }) }, A);
  fr2.ctl.fail = null;
  const listed = async () => (await J3('/api/idcn/admin/idcn3/students', {}, A)).body.students;
  const missOf = async () => ((await listed()).find(s => s.id === AL).proofs_missing || []);
  ok('a payment saved without its screenshot waits on the admin card from the server, so Cancel or a reload never loses it',
     mp.body.proofFailed === true && (await missOf()).some(p => p.id === mp.body.payment.id && p.label === 'Test missing shot' && p.amount_satang === 70000));
  ok('...a student with nothing missing has no such key, as before', (await listed()).some(s => s.id !== AL && !('proofs_missing' in s)));
  ok('...a payment that has its screenshot is never removed', (await J3(`/api/idcn/admin/idcn3/payments/${p1.body.payment.id}`, { method: 'DELETE' }, A)).status === 404
     && (await pool.query('SELECT 1 FROM idc_payments WHERE id=$1', [p1.body.payment.id])).rowCount === 1);
  ok('...removing one needs the admin key', (await J3(`/api/idcn/admin/idcn3/payments/${mp.body.payment.id}`, { method: 'DELETE' })).status === 401);
  const dup = await J3(PAY(AL), { method: 'POST', body: JSON.stringify({ label: 'Test missing shot', amountSatang: 70000, imageBase64: shot }) }, A);
  const rm = await J3(`/api/idcn/admin/idcn3/payments/${mp.body.payment.id}`, { method: 'DELETE' }, A);
  const shotRows = (await pool.query(`SELECT id, proof_url FROM idc_payments WHERE student_id=$1 AND label='Test missing shot'`, [AL])).rows;
  ok('...saved twice by mistake: staff remove the row with no screenshot, the one with it stays, and the card is clear',
     dup.status === 200 && !dup.body.proofFailed && rm.status === 200 && rm.body.removed === mp.body.payment.id
       && shotRows.length === 1 && shotRows[0].id === dup.body.payment.id && /^r2:/.test(shotRows[0].proof_url)
       && !(await missOf()).some(p => p.id === mp.body.payment.id), JSON.stringify(shotRows));
  ok('...removed once, it is gone (404)', (await J3(`/api/idcn/admin/idcn3/payments/${mp.body.payment.id}`, { method: 'DELETE' }, A)).status === 404);

  const allR = await J3('/api/idcn/admin/media-copy', {}, A);
  const c3row = (allR.body.courses || []).find(c => c.code === 'idcn3');
  ok('Admin, Settings: one answer for every course: what is still on Cloudinary and the last copy',
     allR.status === 200 && allR.body.r2 === true && allR.body.auto.on === false && !!c3row && !!c3row.job
       && typeof c3row.onCloudinary.notes === 'number' && typeof c3row.onCloudinary.proofs === 'number' && c3row.onCloudinary.hubChecked === true, JSON.stringify(allR.body).slice(0, 300));
  ok('...staff key only', (await J3('/api/idcn/admin/media-copy')).status === 401 && (await J3('/api/idcn/admin/media-copy', { method: 'POST', body: '{}' })).status === 401);
  const off4 = await J4('/api/idcn/admin/media-copy', {}, A);
  ok('...R2 off: it says so, and a copy is refused', off4.status === 200 && off4.body.r2 === false && off4.body.auto.on === false
     && (await J4('/api/idcn/admin/media-copy', { method: 'POST', body: '{}' }, A)).status === 409);

  // a second server on the same database
  r2On(); process.env.TMPDIR = MULTER_TMP;
  const app5 = express(); app5.use(express.json({ limit: '10mb' }));
  mountIdcn(app5, { pgPool: pool, r2Endpoint: fr2.url, cloudinary: fakeCloud, fetch: fakeFetch, autoCopy: false });
  r2Off(); if (keepTmp == null) delete process.env.TMPDIR; else process.env.TMPDIR = keepTmp;
  await sleep(500);
  const srv5 = app5.listen(0), J5 = Jx(`http://127.0.0.1:${srv5.address().port}`);
  // the files the R2-off uploads above left on the fake Cloudinary (and the one it lost) are there
  // again, and copied, so the runs below can leave nothing behind
  for (const r of (await pool.query(`SELECT media_url AS u FROM idc_notes WHERE media_url LIKE 'https://res.cloudinary.com/%'
    UNION SELECT proof_url FROM idc_payments WHERE proof_url LIKE 'https://res.cloudinary.com/%'
    UNION SELECT media FROM idc_hub_photos WHERE media LIKE 'https://res.cloudinary.com/%'`)).rows) if (!cl.originals.has(r.u)) cl.originals.set(r.u, await jpeg(24, 24));
  const cpAll = await runCopy();
  ok('...with every file there, one copy leaves nothing on Cloudinary', ['hub', 'notes', 'proofs'].every(k => !cpAll.st[k].failed && cpAll.st[k].left === 0)
     && !cpAll.st.errors.length, JSON.stringify(cpAll.st));
  const twoOld = [];
  for (let i = 0; i < 6; i++) {
    const u = `https://res.cloudinary.com/dw1uubecu/image/upload/v1/aybkk/idcn3/proofs/test-alum-a/testtwo${i}.jpg`;
    cl.originals.set(u, await jpeg(30 + i, 30)); twoOld.push(u);
    await pool.query(`INSERT INTO idc_payments (student_id, label, proof_url) VALUES ($1,'Test two copies',$2)`, [AL, u]);
  }
  const objs0 = fr2.store.size;
  cl.slow = 60;
  await Promise.all([J3(COPY, { method: 'POST', body: '{}' }, A), J5(COPY, { method: 'POST', body: '{}' }, A)]);
  const settle = async J => { let st = (await J(COPY, {}, A)).body; for (let i = 0; i < 400 && st.running; i++) { await sleep(25); st = (await J(COPY, {}, A)).body; } return st; };
  const [s3, s5] = [await settle(J3), await settle(J5)];
  cl.slow = 0;
  const lost = [s3, s5].find(s => s.errors.some(e => /Another server is copying/.test(e))), won = [s3, s5].find(s => s !== lost);
  const twoNow = (await pool.query(`SELECT proof_url, proof_src FROM idc_payments WHERE label='Test two copies' ORDER BY id`)).rows;
  ok('two servers asked to copy at once: one copies, the other says another server is copying and copies nothing',
     !!lost && !!won && won.proofs.copied === 6 && lost.proofs.copied === 0 && lost.proofs.left === null, JSON.stringify([s3.proofs, s5.proofs, s3.errors, s5.errors]));
  ok('...each file is copied once: every new object in R2 is the one its row points at', fr2.store.size - objs0 === 6
     && twoNow.every(r => /^r2:/.test(r.proof_url) && fr2.store.has(r.proof_url.slice(3))), `${fr2.store.size - objs0} objects`);
  ok('...and each row keeps the Cloudinary link it had', twoNow.every((r, i) => r.proof_src === twoOld[i]));
  const s3b = await (async () => { await J5(COPY, { method: 'POST', body: '{}' }, A); return settle(J5); })();
  ok('...run again on the other server: nothing to copy, nothing counted', s3b.proofs.copied === 0 && s3b.proofs.left === 0 && !s3b.errors.length, JSON.stringify(s3b));
  srv5.close();

  // the copy by itself, a few minutes after a start (here 0.3 s), until nothing is left
  const autoOld = 'https://res.cloudinary.com/dw1uubecu/image/upload/v1/aybkk/idcn3/assignments/testauto1.jpg';
  cl.originals.set(autoOld, await jpeg(50, 40));
  await pool.query(`INSERT INTO idc_notes (student_id, kind, body, media_url, media_type) VALUES ($1,'assignment','Test auto copy',$2,'image')`, [AL, autoOld]);
  r2On(); process.env.TMPDIR = MULTER_TMP;
  const app6 = express(); app6.use(express.json({ limit: '10mb' }));
  mountIdcn(app6, { pgPool: pool, r2Endpoint: fr2.url, cloudinary: fakeCloud, fetch: fakeFetch, autoCopy: { firstMs: 300, everyMs: 400 } });
  r2Off(); if (keepTmp == null) delete process.env.TMPDIR; else process.env.TMPDIR = keepTmp;
  const srv6 = app6.listen(0), J6 = Jx(`http://127.0.0.1:${srv6.address().port}`);
  await sleep(150);
  const a0 = (await J6('/api/idcn/admin/media-copy', {}, A)).body;
  ok('R2 on: the copy is due by itself soon after a start', a0.auto.on === true && !!a0.auto.next && a0.auto.done === false, JSON.stringify(a0.auto));
  let a1 = a0;
  for (let i = 0; i < 200 && !a1.auto.done; i++) { await sleep(25); a1 = (await J6('/api/idcn/admin/media-copy', {}, A)).body; }
  const autoNow = (await pool.query(`SELECT media_url, media_src FROM idc_notes WHERE body='Test auto copy'`)).rows[0];
  ok('...it ran with nobody pressing: the old file is in R2, its row keeps the Cloudinary link',
     /^r2:idcn\/idcn3\/note\//.test(autoNow.media_url) && autoNow.media_src === autoOld && fr2.store.has(autoNow.media_url.slice(3)), JSON.stringify(autoNow));
  ok('...and with nothing left it stops', a1.auto.done === true && a1.auto.next === null
     && (await urlOf('idc_payments', 'proof_url', `proof_url LIKE 'https://res.cloudinary.com/%'`, [])).length === 0, JSON.stringify(a1.auto));
  srv6.close();
  await sleep(200);
  ok('no upload left behind in the temp folder', tmpFiles() === 0, `${tmpFiles()} files`);
  srv3.close(); srv4.close(); await fr2.close();

  srv2.close();
  await pool.query(`DELETE FROM idc_sessions WHERE course_code='idcn3'; DELETE FROM idc_days WHERE course_code='idcn3';`);
  const testMembers = (await pool.query(`SELECT id FROM bkk_members WHERE email LIKE $1 OR id = ANY($2::int[])`,
    [`%-${RUN}@example.com`, [mA.id, mBk.id, mBf.id, mC.id, mOut.id]])).rows.map(r => r.id);
  await pool.query('DELETE FROM bkk_login_tokens WHERE member_id = ANY($1::int[])', [testMembers]).catch(() => {});
  await pool.query('UPDATE bkk_members SET merged_into=NULL WHERE id = ANY($1::int[])', [testMembers]).catch(() => {});
  await pool.query('DELETE FROM bkk_members WHERE id = ANY($1::int[])', [testMembers]).catch(e => console.log('  (left the test profiles: ' + e.message + ')'));
  fs.rmSync(MULTER_TMP, { recursive: true, force: true });

  console.log(`\n${PASS} passed, ${FAIL} failed`);
  srv.close(); await pool.end();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
