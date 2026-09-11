// In-Depth Mysore course API against a real Postgres. Proves:
//   1. the ฿199,000 discount math to the satang, all six combinations
//   2. a student's named link opens with their passcode and nobody else's
//   3. consent is complete-or-nothing, recorded once, and locks the option
//   4. payment proofs uploaded by admin appear on the student's profile
const express = require('express');
const { Pool } = require('pg');
const { mountIdcn, quote, applyPct, IDCN3_TERMS } = require('../idcn-api.js');

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

  mountIdcn(app, { pgPool: pool });
  await new Promise(r => setTimeout(r, 1200));
  await pool.query('DELETE FROM idc_payments; DELETE FROM idc_consents; DELETE FROM idc_settings; DELETE FROM idc_students;');
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
  ok('her own key opens her page, with her −3% quotes',
     prof.status === 200 && prof.body.student.name_zh === '杨杨'
       && prof.body.quotes[0].totalSatang === 17372700, JSON.stringify(prof.body).slice(0, 120));
  ok('a made-up course is 404',
     (await J('/api/idcn/idcn9/students/yang-yang', {}, { 'x-idcn-key': YKEY })).status === 404);

  console.log('\n— enrolment: Jamsai sets the tier, the student only signs —');
  const YID = yy.body.student.id;
  const allTicked = {};
  for (const k of prof.body.requiredConsents) allTicked[k] = true;
  ok('a student has NO route to set their own option (Jamsai negotiates it)',
     (await J('/api/idcn/idcn3/students/yang-yang/option', { method: 'POST',
        body: JSON.stringify({ option: 1 }) }, { 'x-idcn-key': YKEY })).status === 404);
  ok('admin sets her option to 2',
     (await J(`/api/idcn/admin/idcn3/students/${YID}`, { method: 'PUT',
        body: JSON.stringify({ paymentOption: 2 }) }, A)).status === 200);
  const partial = { ...allTicked, adjustments: false };
  const inc = await J('/api/idcn/idcn3/students/yang-yang/consent', { method: 'POST',
    body: JSON.stringify({ items: partial, signedName: '杨杨 Yang Yang' }) }, { 'x-idcn-key': YKEY });
  ok('one missing tick refuses the whole signature',
     inc.status === 400 && inc.body.missing.includes('adjustments'), JSON.stringify(inc.body));
  ok('no signature name refused',
     (await J('/api/idcn/idcn3/students/yang-yang/consent', { method: 'POST',
        body: JSON.stringify({ items: allTicked, signedName: ' ' }) },
        { 'x-idcn-key': YKEY })).status === 400);
  const signed = await J('/api/idcn/idcn3/students/yang-yang/consent', { method: 'POST',
    body: JSON.stringify({ items: allTicked, signedName: '杨杨 Yang Yang',
      healthNote: '右肩旧伤 old right shoulder injury', mediaPublic: false }) },
    { 'x-idcn-key': YKEY });
  ok('full consent signs and confirms the spot',
     signed.status === 200 && signed.body.status === 'confirmed', JSON.stringify(signed.body));
  ok('signing twice → 409',
     (await J('/api/idcn/idcn3/students/yang-yang/consent', { method: 'POST',
        body: JSON.stringify({ items: allTicked, signedName: 'again' }) },
        { 'x-idcn-key': YKEY })).status === 409);
  const noOpt = await J('/api/idcn/admin/idcn3/students', { method: 'POST',
    body: JSON.stringify({ nameEn: 'Chen Qiang', slug: 'chenqiang' }) }, A);
  const signedNoOpt = await J('/api/idcn/idcn3/students/chenqiang/consent', { method: 'POST',
    body: JSON.stringify({ items: allTicked, signedName: '陈强' }) },
    { 'x-idcn-key': noOpt.body.passcode });
  ok('signing works before the tier is settled (option recorded as empty)',
     signedNoOpt.status === 200
       && (await J('/api/idcn/idcn3/students/chenqiang', {}, { 'x-idcn-key': noOpt.body.passcode }))
            .body.consent.payment_option == null);
  const after = await J('/api/idcn/idcn3/students/yang-yang', {}, { 'x-idcn-key': YKEY });
  ok('her profile carries the signed record: version, name, health note, no public media',
     after.body.consent.policy_version === 'idcn3-v3'
       && after.body.consent.signed_name === '杨杨 Yang Yang'
       && /右肩/.test(after.body.consent.health_note)
       && after.body.consent.media_public === false
       && after.body.student.status === 'confirmed',
     JSON.stringify(after.body.consent));
  ok('her locked quote is option 2 + attendee = ฿183,378.50',
     after.body.quote.totalSatang === 18337850);

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
       && list.body.students.some(s => s.slug === 'yang-yang' && s.signed_at && s.quote.totalSatang === 18337850)
       && list.body.students.some(s => s.slug === 'limei' && !s.signed_at && s.proofs === 1),
     JSON.stringify(list.body.students.map(s => s.slug)));
  const reset = await J(`/api/idcn/admin/idcn3/students/${LID}`, { method: 'PUT',
    body: JSON.stringify({ resetKey: true }) }, A);
  ok('passcode reset issues a new one and kills the old',
     reset.body.passcode
       && (await J('/api/idcn/idcn3/students/limei', {}, { 'x-idcn-key': LKEY })).status === 401
       && (await J('/api/idcn/idcn3/students/limei', {}, { 'x-idcn-key': reset.body.passcode })).status === 200);

  console.log(`\n${PASS} passed, ${FAIL} failed`);
  srv.close(); await pool.end();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
