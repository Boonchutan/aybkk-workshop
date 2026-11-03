// In-Depth Mysore course API against a real Postgres. Proves:
//   1. the v3 ฿199,000 discount math to the satang, all six combinations
//   2. the v4 price: ฿180,000 + 7% VAT = ฿192,600, options A and B, no discounts
//   3. a student who signed v3 (or earlier) keeps exactly their terms; only a
//      student who has not signed gets v4
//   4. a student's named link opens with their passcode and nobody else's
//   5. consent is complete-or-nothing, recorded once with the version on screen
//   6. payment proofs uploaded by admin appear on the student's profile
const crypto = require('crypto');
const express = require('express');
const { Pool } = require('pg');
const { mountIdcn, quote, applyPct, planError, IDCN3_TERMS, IDCN3_TERMS_V4,
  IDCN3_POLICY_VERSION } = require('../idcn-api.js');

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

  mountIdcn(app, { pgPool: pool });
  await new Promise(r => setTimeout(r, 1200));
  await pool.query('DELETE FROM idc_notes; DELETE FROM idc_payments; DELETE FROM idc_consents; DELETE FROM idc_settings; DELETE FROM idc_students;');
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

  console.log('\n[option C: a plan agreed on the call, for one student]');
  const LKEY2 = reset.body.passcode;
  const short = await PUT(LID, { paymentOption: 'C', customPlan: [{ amountSatang: 18000000, due: '2026-12-10' }] });
  ok('a plan that does not add up to ฿192,600 is refused, with the reason',
     short.status === 400 && /192,600 THB/.test(short.body.error), JSON.stringify(short.body));
  ok('a plan in fractional satang is refused',
     (await PUT(LID, { paymentOption: 'C', customPlan: [{ amountSatang: 9630000.5, due: '2026-12-10' },
       { amountSatang: 9629999.5, due: '2027-01-10' }] })).status === 400);
  ok('option C without its payments is refused', (await PUT(LID, { paymentOption: 'C' })).status === 400);
  ok('a plan that adds up is saved',
     (await PUT(LID, { paymentOption: 'C', customPlan: [{ amountSatang: 9260000, due: '2027-01-05' },
       { amountSatang: 10000000, due: '2026-12-10' }] })).status === 200);
  const lq = (await J('/api/idcn/idcn3/students/limei', {}, { 'x-idcn-key': LKEY2 })).body.quote;
  ok('she sees her plan in date order, adding up to 19,260,000 satang',
     lq.code === 'C' && lq.totalSatang === 19260000 && JSON.stringify(lq.installments) === JSON.stringify(plan),
     JSON.stringify(lq));
  await PUT(LID, { paymentOption: 'A' });
  const lrow = (await J('/api/idcn/admin/idcn3/students', {}, A)).body.students.find(x => x.slug === 'limei');
  ok('moving her to A drops the custom plan',
     lrow.custom_plan === null && JSON.stringify(lrow.quote) === JSON.stringify(qa));

  console.log(`\n${PASS} passed, ${FAIL} failed`);
  srv.close(); await pool.end();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
