// End-to-end test of bkk-api against a real Postgres.
process.env.BKK_ADMIN_KEY = 'testkey';
process.env.MAIL_DRY_RUN = '1';   // capture mail in an outbox instead of sending
const express = require('express');
const { Pool } = require('pg');
const { mountBkk, moonDaysBetween } = require('../bkk-api.js');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ||
  'postgres://test:test@127.0.0.1:5432/bkktest' });
const app = express();
app.use(express.json());

let PASS = 0, FAIL = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name} ${extra}`); }
};

(async () => {
  // Stand-in for Cloudinary: remembers uploads, signs nothing.
  const uploads = [], destroyed = [];
  const fakeCloud = {
    url: (id, o) => `signed://${o.type}/${id}/${o.transformation[0].width}`,
    uploader: {
      upload: async (data, o) => { const r = { public_id: `${o.folder}/p${uploads.length + 1}`, width: 2048, height: 1365, type: o.type };
        uploads.push(r); return r; },
      destroy: async (id, o) => { destroyed.push({ id, type: o.type }); return { result: 'ok' }; },
    },
  };
  global.__uploads = uploads; global.__destroyed = destroyed;
  // Stand-in for Drive's public folder view and download.
  const entry = (id, name, folder) => `<div class="flip-entry" id="entry-${id}" tabindex="0"><div class="flip-entry-info"><a href="https://drive.google.com/${folder ? 'drive/folders/' + id : 'file/d/' + id + '/view'}" target="_blank"><div class="flip-entry-title">${name}</div></a></div></div>`;
  const DRIVE_HTML = {
    ROOTF: entry('DAY5aaaaaaaaaaaaaaaaaaaaa', '5Oct26', true) + entry('DAY4aaaaaaaaaaaaaaaaaaaaa', '4Oct26', true) + entry('RAWaaaaaaaaaaaaaaaaaaaaaa', 'RAW', true),
    DAY5aaaaaaaaaaaaaaaaaaaaa: entry('IMG1aaaaaaaaaaaaaaaaaaaaa', 'AYBKK Oct5-002.jpg') + entry('IMG2aaaaaaaaaaaaaaaaaaaaa', 'AYBKK Oct5-001.jpg')
      + entry('VIDaaaaaaaaaaaaaaaaaaaaaa', 'clip.mp4') + entry('SUBaaaaaaaaaaaaaaaaaaaaaa', '5Oct26LedP', true),
    SUBaaaaaaaaaaaaaaaaaaaaaa: entry('IMG3aaaaaaaaaaaaaaaaaaaaa', 'led-01.jpg'),
  };
  const driveFetches = [];
  const fakeFetch = async url => {
    driveFetches.push(url);
    const id = new URL(url).searchParams.get('id');
    if (url.includes('embeddedfolderview')) return new Response(DRIVE_HTML[id] || '', { status: 200 });
    return new Response(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]), { status: 200 });
  };
  process.env.DRIVE_PHOTOS_FOLDER = 'ROOTF';
  mountBkk(app, { pgPool: pool, cloudinary: fakeCloud, fetch: fakeFetch });
  await new Promise(r => setTimeout(r, 1500));           // let schema init finish
  const srv = app.listen(0);
  const port = srv.address().port;
  const B = `http://127.0.0.1:${port}`;
  const J = async (path, opts) => {
    const r = await fetch(B + path, opts);
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const post = (p, body, headers = {}) => J(p, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body) });
  const ADMIN = { 'x-bkk-key': 'testkey' };

  console.log('\n— catalogue —');
  const prods = await J('/api/bkk/products');
  ok('5 packages listed, no 2- or 6-month', prods.body.products.length === 5 && !prods.body.products.some(p => ['unlim2', 'unlim6'].includes(p.code)),
    `got ${prods.body.products.map(p => p.code)}`);
  const dropin = prods.body.products.find(p => p.code === 'dropin');
  ok('drop-in base ฿1500', dropin.price_thb === 1500);
  ok('3% fee + 7% VAT → ฿1653 total', dropin.total_thb === 1653, `got ${dropin.total_thb}`);
  const unlim1 = prods.body.products.find(p => p.code === 'unlim1');
  ok('1-month total ฿10580', unlim1.total_thb === 10580, `got ${unlim1.total_thb}`);

  const pm = Object.entries(prods.body.moonDays || {});
  ok('catalogue lists moon days for the promotion calculator', pm.length >= 14 && pm.every(([d, n]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && ['new', 'full'].includes(n)),
    `got ${pm.length}`);

  console.log('\n— schedule —');
  const sch = await J('/api/bkk/schedule?days=7');
  // A moon day can close a whole Saturday (4 classes), so the floor is low.
  ok('classes generated for the week', sch.body.classes.length > 5, `got ${sch.body.classes.length}`);
  ok('all classes are in the future', sch.body.classes.every(c => new Date(c.startAt) > new Date()));
  ok('capacity 42 on shala classes',
    sch.body.classes.filter(c => !c.isOnline).every(c => c.capacity === 42));
  const mysore = sch.body.classes.find(c => c.title.includes('Mysore'));
  ok('Mysore class present', !!mysore);

  console.log('\n— moon days and Monday —');
  const moonList = [...moonDaysBetween('2026-09-01', '2026-11-30').keys()].join(',');
  ok('moon days Sep–Nov 2026 match the ephemeris',
    moonList === '2026-09-11,2026-09-26,2026-10-10,2026-10-26,2026-11-09,2026-11-24', moonList);
  const month = await J('/api/bkk/schedule?days=62');
  const moonSet = moonDaysBetween(month.body.classes[0].date, month.body.classes.at(-1).date);
  ok('no class is offered on a moon day', month.body.classes.every(c => !moonSet.has(c.date)));
  const isMon = d => new Date(d + 'T12:00:00+07:00').getUTCDay() === 1;
  ok('no Mysore on Monday', !month.body.classes.some(c => c.kind === 'mysore' && isMon(c.date)));
  ok('Led Primary still on Monday', month.body.classes.some(c => c.kind === 'led_primary' && isMon(c.date)));

  console.log('\n— buy (gateway not configured) —');
  const order = await post('/api/bkk/orders',
    { productCode: 'pack10', name: 'Test Student', email: 'test@example.com' });
  ok('order created', order.status === 200 && order.body.order, JSON.stringify(order.body).slice(0, 120));
  const refno = Number(order.body.order.refno);
  const memberCode = order.body.member.code;
  ok('amount is ฿15429', order.body.order.amount === 15429, `got ${order.body.order.amount}`);
  ok('refno is numeric ≤12 digits', /^\d{1,12}$/.test(String(refno)), String(refno));
  ok('no pay form without credentials', order.body.pay === null);

  console.log('\n— SECURITY: forged postback must not activate —');
  await post('/api/bkk/pay/postback', { refno: String(refno) });
  await new Promise(r => setTimeout(r, 400));
  let me = await J('/api/bkk/me/' + memberCode);
  ok('no pass created from forged postback', me.body.passes.length === 0,
    `passes=${me.body.passes.length}`);
  const ordersAdmin = await J('/api/bkk/admin/orders', { headers: ADMIN });
  ok('order still pending', ordersAdmin.body.orders[0].status === 'pending',
    ordersAdmin.body.orders[0].status);

  console.log('\n— booking blocked without a pass —');
  const slot = sch.body.classes[0];
  let bk = await post('/api/bkk/bookings', { memberCode, slotId: slot.slotId, date: slot.date });
  ok('booking refused with no pass', bk.status === 409 && /no active pass/.test(bk.body.error), bk.body.error);

  console.log('\n— admin force-activate (deliberate manual path) —');
  const fa = await post(`/api/bkk/admin/orders/${ordersAdmin.body.orders[0].id}/force-activate`, {}, ADMIN);
  ok('force-activate works', fa.status === 200, JSON.stringify(fa.body));
  me = await J('/api/bkk/me/' + memberCode);
  ok('pass now exists', me.body.passes.length === 1);
  ok('10 credits available', me.body.passes[0].creditsLeft === 10, String(me.body.passes[0].creditsLeft));
  ok('validity not started before first booking', me.body.passes[0].validUntil === null);

  console.log('\n— booking —');
  bk = await post('/api/bkk/bookings', { memberCode, slotId: slot.slotId, date: slot.date });
  ok('booking succeeds', bk.status === 200, JSON.stringify(bk.body).slice(0, 120));
  me = await J('/api/bkk/me/' + memberCode);
  ok('credit decremented to 9', me.body.passes[0].creditsLeft === 9, String(me.body.passes[0].creditsLeft));
  ok('validity window opened on first booking', !!me.body.passes[0].validUntil, String(me.body.passes[0].validUntil));
  ok('booking listed for member', me.body.bookings.length === 1);

  const dup = await post('/api/bkk/bookings', { memberCode, slotId: slot.slotId, date: slot.date });
  ok('double-booking refused', dup.status === 409, JSON.stringify(dup.body));

  console.log('\n— capacity —');
  // squeeze a slot to 2 seats, then race 5 bookings from 5 members
  await pool.query(`INSERT INTO bkk_class_overrides (slot_id, class_date, capacity)
                    VALUES ($1,$2,2) ON CONFLICT (slot_id,class_date) DO UPDATE SET capacity=2`,
                   [slot.slotId, slot.date]);
  const codes = [];
  for (let i = 0; i < 5; i++) {
    const o = await post('/api/bkk/orders', { productCode: 'dropin', name: 'R' + i, email: `r${i}@x.com` });
    const oid = (await J('/api/bkk/admin/orders', { headers: ADMIN })).body.orders[0].id;
    await post(`/api/bkk/admin/orders/${oid}/force-activate`, {}, ADMIN);
    codes.push(o.body.member.code);
  }
  const races = await Promise.all(codes.map(c =>
    post('/api/bkk/bookings', { memberCode: c, slotId: slot.slotId, date: slot.date })));
  const okCount = races.filter(r => r.status === 200).length;
  // 1 seat already taken by Test Student, capacity 2 → exactly 1 more may pass
  ok('capacity respected under concurrency', okCount === 1, `${okCount} succeeded, expected 1`);

  console.log('\n— daily cap on memberships —');
  const mo = await post('/api/bkk/orders', { productCode: 'unlim1', name: 'Unlimited U', email: 'u@x.com' });
  const moId = (await J('/api/bkk/admin/orders', { headers: ADMIN })).body.orders[0].id;
  await post(`/api/bkk/admin/orders/${moId}/force-activate`, {}, ADMIN);
  const uCode = mo.body.member.code;
  // Re-read the schedule: the capacity test above deliberately filled a class,
  // and booking into a full one would fail for the wrong reason. Pick a day that
  // still has three seats going, so the only thing under test is the daily cap.
  // 28 days: only Saturdays have 3 classes, and a Saturday can be a moon day.
  const fresh = (await J('/api/bkk/schedule?days=28')).body.classes.filter(c => c.seatsLeft > 0);
  const byDate = {};
  for (const c of fresh) (byDate[c.date] = byDate[c.date] || []).push(c);
  const capDay = Object.values(byDate).find(list => list.length >= 3);
  let caps = [];
  for (const c of (capDay || []).slice(0, 3)) {
    caps.push(await post('/api/bkk/bookings', { memberCode: uCode, slotId: c.slotId, date: c.date }));
  }
  const goodCaps = caps.filter(r => r.status === 200).length;
  const lastErr = caps.length ? (caps[caps.length - 1].body.error || '') : 'no classes to test with';
  ok('membership capped at 2 bookings/day', goodCaps === 2 && /per day/.test(lastErr),
     `${goodCaps} succeeded; last error: ${lastErr}`);

  console.log('\n— cancellation —');
  const myB = (await J('/api/bkk/me/' + memberCode)).body.bookings[0];
  const before = (await J('/api/bkk/me/' + memberCode)).body.passes[0].creditsLeft;
  const can = await post(`/api/bkk/bookings/${myB.id}/cancel`, { memberCode });
  const after = (await J('/api/bkk/me/' + memberCode)).body.passes[0].creditsLeft;
  const hoursOut = (new Date(myB.start_at) - new Date()) / 3600000;
  if (hoursOut >= 5) ok('credit returned when >5h out', after === before + 1, `${before}→${after}`);
  else ok('credit kept when <5h out', after === before, `${before}→${after}`);
  ok('cancel reports the rule', typeof can.body.message === 'string', can.body.message);

  console.log('\n— rebooking after a cancellation —');
  // The cancel above freed the seat. A student who changes their mind must be
  // able to take it back; the old table-level UNIQUE counted cancelled rows.
  const reb = await post('/api/bkk/bookings',
    { memberCode, slotId: myB.slot_id, date: String(myB.class_date).slice(0, 10) });
  ok('cancelled class can be rebooked', reb.status === 200, JSON.stringify(reb.body).slice(0, 140));

  console.log('\n— check-in —');
  const ci = await post('/api/bkk/checkin', { memberCode: uCode, windowMin: 180 }, ADMIN);
  ok('check-in responds', ci.status === 200 && typeof ci.body.ok === 'boolean', JSON.stringify(ci.body));
  const ciNoKey = await post('/api/bkk/checkin', { memberCode: uCode, windowMin: 180 });
  ok('check-in refuses without the staff key', ciNoKey.status === 401, JSON.stringify(ciNoKey.body));

  console.log('\n— booking ownership —');
  const victim = (await J('/api/bkk/me/' + memberCode)).body.bookings[0];
  if (victim) {
    const noOwner = await post(`/api/bkk/bookings/${victim.id}/cancel`, {});
    ok('cancel refused with no member code', noOwner.status === 409, JSON.stringify(noOwner.body));
    const wrongOwner = await post(`/api/bkk/bookings/${victim.id}/cancel`, { memberCode: uCode });
    ok('cancel refused with someone else\'s code', wrongOwner.status === 409, JSON.stringify(wrongOwner.body));
    const stillThere = (await J('/api/bkk/me/' + memberCode)).body.bookings.some(b => b.id === victim.id);
    ok('the booking survived both attempts', stillThere);
  } else ok('booking ownership fixture present', false, 'no booking to test with');

  console.log('\n— sign in by email —');
  const { outbox } = require('../mailer');
  // Receipt mail is deliberately fire-and-forget, so it can land between two
  // snapshots. Count only sign-in mail, which is sent inside the request.
  const signins = () => outbox.filter(m => m.tag === 'signin');

  const n0 = signins().length;
  const known = await post('/api/bkk/login/request', { email: 'test@example.com' });
  ok('login request accepted', known.status === 200 && known.body.ok);
  ok('a sign-in mail was queued', signins().length === n0 + 1, `${n0}→${signins().length}`);

  const n1 = signins().length;
  const unknown = await post('/api/bkk/login/request', { email: 'nobody-here@example.com' });
  ok('unknown address gets the identical answer',
     unknown.body.message === known.body.message, String(unknown.body.message));
  ok('...and no mail is sent for it', signins().length === n1, `grew to ${signins().length}`);

  const lastMail = signins()[signins().length - 1];
  const link = lastMail.text.match(/login\/([a-f0-9]{64})/);
  ok('the mail carries a 64-character token', !!link, lastMail.text.slice(0, 80));
  if (link) {
    const peek = await fetch(B + '/api/bkk/login/' + link[1]);
    const peekHtml = await peek.text();
    ok('opening the link (a chat app preview) does not use it up or show the code',
       peek.status === 200 && !peekHtml.includes(memberCode) && peekHtml.includes('method="post"'));
    const first = await fetch(B + '/api/bkk/login/' + link[1], { method: 'POST' });
    const firstHtml = await first.text();
    ok('token signs the student in', first.status === 200 && firstHtml.includes(memberCode),
       `status ${first.status}`);
    const second = await fetch(B + '/api/bkk/login/' + link[1], { method: 'POST' });
    ok('the same emailed token cannot be used twice', second.status === 400, `status ${second.status}`);
  }
  const bogus = await fetch(B + '/api/bkk/login/' + 'f'.repeat(64));
  ok('an invented token is refused', bogus.status === 400, `status ${bogus.status}`);

  await post('/api/bkk/login/request', { email: 'test@example.com' });
  const expTok = signins()[signins().length - 1].text.match(/login\/([a-f0-9]{64})/);
  await pool.query(`UPDATE bkk_login_tokens SET expires_at = now() - interval '1 minute'
                    WHERE token = $1`, [expTok ? expTok[1] : '']);
  const expired = await fetch(B + '/api/bkk/login/' + (expTok ? expTok[1] : 'x'));
  ok('an expired token is refused', expired.status === 400, `status ${expired.status}`);

  const n2 = signins().length;
  for (let i = 0; i < 5; i++) await post('/api/bkk/login/request', { email: 'test@example.com' });
  ok('requests are throttled per address', signins().length - n2 <= 3,
     `${signins().length - n2} mails sent for 5 requests`);

  console.log('\n— finding a student —');
  const found = await J('/api/bkk/admin/members?q=' + encodeURIComponent('Test Stu'), { headers: ADMIN });
  ok('member search by partial name', (found.body.members || []).some(m => m.code === memberCode),
     JSON.stringify((found.body.members || []).map(m => m.name)));
  const byMail = await J('/api/bkk/admin/members?q=' + encodeURIComponent('test@example'), { headers: ADMIN });
  ok('member search by email', (byMail.body.members || []).some(m => m.code === memberCode));
  ok('search returns their passes', (byMail.body.members || [])[0].passes.length >= 1);
  const shortQ = await J('/api/bkk/admin/members?q=a', { headers: ADMIN });
  ok('one-letter search returns nothing', shortQ.body.members.length === 0);

  console.log('\n— granting a pass by hand (migration + comps) —');
  const grant = await post('/api/bkk/admin/passes', {
    name: 'Imported From Rezerv', email: 'imported@x.com', productCode: 'unlim3',
    validFrom: '2026-01-01', validUntil: '2099-01-01', source: 'rezerv', note: 'migration test',
  }, ADMIN);
  ok('pass granted without an order', grant.status === 200 && grant.body.pass,
     JSON.stringify(grant.body).slice(0, 140));
  ok('the granted pass has no order behind it', grant.body.pass.order_id === null);
  ok('...and keeps the expiry it was given', String(grant.body.pass.valid_until).startsWith('2099-01-01'),
     String(grant.body.pass.valid_until));
  const halfWindow = await post('/api/bkk/admin/passes',
    { name: 'Half', email: 'half@x.com', productCode: 'unlim3', validFrom: '2026-01-01' }, ADMIN);
  ok('a half-specified window is refused', halfWindow.status === 400, JSON.stringify(halfWindow.body));

  console.log('\n— an imported expiry survives the first booking —');
  const impCode = grant.body.member.code;
  const openCls = (await J('/api/bkk/schedule?days=14')).body.classes.filter(c => c.seatsLeft > 0)[0];
  await post('/api/bkk/bookings', { memberCode: impCode, slotId: openCls.slotId, date: openCls.date });
  const impPass = (await J('/api/bkk/me/' + impCode)).body.passes[0];
  ok('booking did not overwrite the imported expiry',
     String(impPass.validUntil).startsWith('2099-01-01'), String(impPass.validUntil));

  console.log('\n— freeze, unfreeze, extend, void —');
  const pid = grant.body.pass.id;
  const fz = await post(`/api/bkk/admin/passes/${pid}/freeze`, { days: 30, reason: 'broken wrist' }, ADMIN);
  ok('pass freezes', fz.status === 200 && fz.body.pass.status === 'frozen', JSON.stringify(fz.body).slice(0, 120));
  ok('freezing pushes the expiry out by the frozen days',
     String(fz.body.pass.valid_until).startsWith('2099-01-31'), String(fz.body.pass.valid_until));
  const bookFrozen = await post('/api/bkk/bookings',
    { memberCode: impCode, slotId: openCls.slotId, date: openCls.date });
  ok('a frozen pass cannot book', bookFrozen.status === 409, JSON.stringify(bookFrozen.body));
  const uf = await post(`/api/bkk/admin/passes/${pid}/unfreeze`, {}, ADMIN);
  ok('pass unfreezes', uf.status === 200 && uf.body.pass.status === 'active');
  ok('unfreezing early hands back the unused days',
     String(uf.body.pass.valid_until).startsWith('2099-01-01'), String(uf.body.pass.valid_until));
  const ext = await post(`/api/bkk/admin/passes/${pid}/extend`, { days: 7, reason: 'goodwill' }, ADMIN);
  ok('pass extends', ext.status === 200 && String(ext.body.pass.valid_until).startsWith('2099-01-08'),
     String(ext.body.pass.valid_until));
  const vd = await post(`/api/bkk/admin/passes/${pid}/void`, { reason: 'test' }, ADMIN);
  ok('pass voids', vd.status === 200 && vd.body.pass.status === 'void');
  const bookVoid = await post('/api/bkk/bookings',
    { memberCode: impCode, slotId: openCls.slotId, date: openCls.date });
  ok('a void pass cannot book', bookVoid.status === 409, JSON.stringify(bookVoid.body));
  ok('pass actions need the staff key',
     (await post(`/api/bkk/admin/passes/${pid}/void`, {}, {})).status === 401);

  console.log('\n— closing a class (moon day) —');
  const target = (await J('/api/bkk/schedule?days=14')).body.classes.filter(c => c.seatsLeft > 0).pop();
  const buyer = await post('/api/bkk/admin/passes',
    { name: 'Moon Day', email: 'moon@x.com', productCode: 'pack10' }, ADMIN);
  const moonCode = buyer.body.member.code;
  await post('/api/bkk/bookings', { memberCode: moonCode, slotId: target.slotId, date: target.date });
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const in60 = new Date(Date.now() + 67 * 86400000).toISOString().slice(0, 10);
  const nextMoon = [...moonDaysBetween(today, in60).keys()].find(d => d > today);
  const moonTry = await post('/api/bkk/bookings', { memberCode: moonCode, slotId: target.slotId, date: nextMoon });
  ok('booking on a moon day is refused', moonTry.status !== 200 && /moon day/.test(JSON.stringify(moonTry.body)),
     `${nextMoon} ${JSON.stringify(moonTry.body)}`);
  const creditsBefore = (await J('/api/bkk/me/' + moonCode)).body.passes[0].creditsLeft;
  const closed = await post('/api/bkk/admin/classes/cancel',
    { slotId: target.slotId, date: target.date, reason: 'Full moon' }, ADMIN);
  ok('class closes', closed.status === 200 && closed.body.released >= 1, JSON.stringify(closed.body));
  const creditsAfter = (await J('/api/bkk/me/' + moonCode)).body.passes[0].creditsLeft;
  ok('the shala cancelling returns the credit', creditsAfter === creditsBefore + 1,
     `${creditsBefore}→${creditsAfter}`);
  const gone = (await J('/api/bkk/schedule?days=14')).body.classes
    .some(c => c.slotId === target.slotId && c.date === target.date);
  ok('the closed class disappears from the timetable', !gone);
  ok('students were emailed about it',
     outbox.filter(m => m.tag === 'cancelled').length >= 1,
     String(outbox.filter(m => m.tag === 'cancelled').length));
  await post('/api/bkk/admin/classes/reopen', { slotId: target.slotId, date: target.date }, ADMIN);
  const back = (await J('/api/bkk/schedule?days=14')).body.classes
    .some(c => c.slotId === target.slotId && c.date === target.date);
  ok('reopening puts it back on the timetable', back);

  console.log('\n— the teaching team —');
  const mk = await post('/api/bkk/admin/teachers', { name: 'Jamsai' }, ADMIN);
  ok('teacher added', mk.status === 200 && mk.body.passcode, JSON.stringify(mk.body).slice(0, 120));
  const TKEY = { 'x-teacher-key': mk.body.passcode };
  const whoami = await J('/api/bkk/teacher/me', { headers: TKEY });
  ok('teacher signs in with their own passcode', whoami.body.teacher.name === 'Jamsai');
  ok('a wrong passcode is refused',
     (await J('/api/bkk/teacher/me', { headers: { 'x-teacher-key': 'nope' } })).status === 401);
  ok('the admin key is not a teacher key',
     (await J('/api/bkk/teacher/me', { headers: ADMIN })).status === 401);

  const shared = await post('/api/bkk/teacher/notes', {
    memberCode, toWorkOn: 'Straighten the front leg in Trikonasana',
    body: 'Good breath today', shareWithStudent: true }, TKEY);
  ok('a note saves', shared.status === 200, JSON.stringify(shared.body).slice(0, 140));
  ok('...attributed to the teacher who wrote it', shared.body.note.teacher_name === 'Jamsai');
  await post('/api/bkk/teacher/notes', {
    memberCode, body: 'Shoulder guarding — watch it, do not mention yet',
    shareWithStudent: false }, TKEY);

  const seen = (await J('/api/bkk/me/' + memberCode)).body.notes || [];
  ok('the student sees what to work on',
     seen.some(n => /Trikonasana/.test(n.to_work_on || '')), JSON.stringify(seen).slice(0, 160));
  ok('the student NEVER sees a team-only note',
     !seen.some(n => /Shoulder guarding/.test((n.body || '') + (n.to_work_on || ''))),
     JSON.stringify(seen).slice(0, 200));
  const teacherView = await J('/api/bkk/teacher/student/' + memberCode, { headers: TKEY });
  ok('the teacher sees both', (teacherView.body.notes || []).length >= 2,
     String((teacherView.body.notes || []).length));
  ok('notes need a teacher passcode',
     (await post('/api/bkk/teacher/notes', { memberCode, body: 'x' })).status === 401);
  ok('an empty note is refused',
     (await post('/api/bkk/teacher/notes', { memberCode, body: '  ' }, TKEY)).status === 400);

  await post('/api/bkk/admin/teachers', { id: mk.body.teacher.id, active: false }, ADMIN);
  ok('a retired teacher can no longer sign in',
     (await J('/api/bkk/teacher/me', { headers: TKEY })).status === 401);

  console.log('\n— packages —');
  const newProd = await post('/api/bkk/admin/products', {
    code: 'test5', nameEn: 'Test 5 pack', kind: 'credits',
    priceThb: 5000, validDays: 60, credits: 5 }, ADMIN);
  ok('package created', newProd.status === 200 && newProd.body.created,
     JSON.stringify(newProd.body).slice(0, 140));
  const reprice = await post('/api/bkk/admin/products', { code: 'test5', priceThb: 5500 }, ADMIN);
  ok('price changed', reprice.body.product.price_thb === 5500, String(reprice.body.product.price_thb));
  ok('...without wiping the rest', reprice.body.product.credits === 5 &&
     reprice.body.product.name_en === 'Test 5 pack',
     JSON.stringify(reprice.body.product).slice(0, 120));
  await post('/api/bkk/admin/products', { code: 'test5', active: false }, ADMIN);
  const shown = (await J('/api/bkk/products')).body.products.some(p => p.code === 'test5');
  ok('a retired package leaves the shop', !shown);
  const halfBaked = await post('/api/bkk/admin/products', { code: 'nope', nameEn: 'No kind' }, ADMIN);
  ok('a new package without its rules is refused', halfBaked.status === 400, JSON.stringify(halfBaked.body));
  ok('packages need the staff key',
     (await post('/api/bkk/admin/products', { code: 'x' })).status === 401);

  console.log('\n— editable links —');
  const badLink = await post('/api/bkk/admin/settings',
    { links: { youtube: 'youtube.com/aybkk' } }, ADMIN);
  ok('a link without https is refused', badLink.status === 400, JSON.stringify(badLink.body));
  await post('/api/bkk/admin/settings',
    { links: { youtube: 'https://youtube.com/@aybkk', tiktok: '' } }, ADMIN);
  const links = (await J('/api/bkk/settings')).body.links;
  ok('a saved link is served publicly', links.youtube === 'https://youtube.com/@aybkk',
     JSON.stringify(links));
  ok('a blank link is not served', links.tiktok === undefined, JSON.stringify(links));

  console.log('\n— selling at the desk —');
  const sale = await post('/api/bkk/admin/sales',
    { productCode: 'unlim1', name: 'Cash Student', email: 'cash@x.com', method: 'cash' }, ADMIN);
  ok('cash sale succeeds', sale.status === 200 && sale.body.success, JSON.stringify(sale.body));
  ok('cash price is 9,600 + 7% VAT, no online fee', sale.body.order && sale.body.order.amount === 10272,
     sale.body.order && sale.body.order.amount);
  const cashMe = (await J('/api/bkk/me/' + sale.body.member.code)).body;
  ok('the cash sale gives an active pass', (cashMe.passes || []).length === 1, JSON.stringify(cashMe.passes));
  const ords = (await J('/api/bkk/admin/orders', { headers: ADMIN })).body.orders;
  const cashOrd = ords.find(o => String(o.refno) === sale.body.order.refno);
  ok('the sale is a paid order marked cash', cashOrd && cashOrd.status === 'paid' && cashOrd.method === 'cash',
     JSON.stringify(cashOrd && { status: cashOrd.status, method: cashOrd.method }));
  const todayMoney = (await J('/api/bkk/admin/today', { headers: ADMIN })).body.money || [];
  ok("today's cash total includes the sale", (todayMoney.find(m => m.method === 'cash') || {}).total >= 10272,
     JSON.stringify(todayMoney));
  ok('a sale needs a payment method',
     (await post('/api/bkk/admin/sales', { productCode: 'unlim1', name: 'X', method: 'iou' }, ADMIN)).status === 400);
  ok('selling needs the staff key',
     (await post('/api/bkk/admin/sales', { productCode: 'unlim1', name: 'X', method: 'cash' }, {})).status === 401);

  console.log('\n— profile photos —');
  const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  const chay = await post('/api/bkk/admin/teachers', { name: 'Chay' }, ADMIN);
  ok('a chosen team passcode shorter than 8 is refused',
     (await post('/api/bkk/admin/teachers', { name: 'Short', passcode: 'abc123' }, ADMIN)).status === 400);
  const own = await post('/api/bkk/admin/teachers', { name: 'Own Code', passcode: 'mysore-2026-ok' }, ADMIN);
  ok('admin can set a team passcode of their own', own.status === 200 && own.body.passcode === 'mysore-2026-ok' &&
     (await J('/api/bkk/teacher/me', { headers: { 'x-teacher-key': 'mysore-2026-ok' } })).body.teacher.name === 'Own Code');
  ok('two people cannot share a passcode',
     (await post('/api/bkk/admin/teachers', { name: 'Copy', passcode: 'mysore-2026-ok' }, ADMIN)).status === 400);
  const PKEY = { 'x-teacher-key': chay.body.passcode };
  const ann = (await post('/api/bkk/teacher/members', { name: 'Ann Photo', email: 'ann.photo@example.com' }, PKEY)).body.member;
  const bob = (await post('/api/bkk/teacher/members', { name: 'Bob Photo', email: 'bob.photo@example.com' }, PKEY)).body.member;
  const cat = (await post('/api/bkk/teacher/members', { name: 'Cat Photo', email: 'cat.photo@example.com' }, PKEY)).body.member;
  ok('a teacher can add a student for tagging', ann && ann.code && bob && cat);
  ok('adding a student needs an email (they sign in with it)',
     (await post('/api/bkk/teacher/members', { name: 'No Mail' }, PKEY)).status === 400);
  ok('tagging needs a teacher passcode',
     (await post('/api/bkk/teacher/photos', { date: '2026-10-03', image: IMG, memberCodes: [ann.code] }, ADMIN)).status === 401);
  const up = await post('/api/bkk/teacher/photos', { date: '2026-10-03', image: IMG, memberCodes: [ann.code, bob.code] }, PKEY);
  ok('photo uploaded with two students', up.status === 200 && up.body.photo.members.length === 2, JSON.stringify(up.body).slice(0, 160));
  ok('stored as a private (authenticated) asset', global.__uploads[0] && global.__uploads[0].type === 'authenticated');
  ok('a non-image is refused',
     (await post('/api/bkk/teacher/photos', { date: '2026-10-03', image: 'data:text/html;base64,PGgxPg==', memberCodes: [] }, PKEY)).status === 400);
  const annPics = (await J(`/api/bkk/me/${ann.code}/photos`)).body.days || [];
  const catPics = (await J(`/api/bkk/me/${cat.code}/photos`)).body.days || [];
  ok('a tagged student sees the photo, on its class date', annPics.length === 1 && annPics[0].date === '2026-10-03' && annPics[0].items.length === 1,
     JSON.stringify(annPics));
  ok('the photo link is a signed private one', /^signed:\/\/authenticated\//.test(annPics[0].items[0].thumb));
  ok('a student who is not in the photo sees nothing', catPics.length === 0);
  const day = (await J('/api/bkk/teacher/photos?date=2026-10-03', { headers: PKEY })).body.photos;
  ok("the teacher's day view lists the photo", day.length === 1);
  await post(`/api/bkk/teacher/photos/${up.body.photo.id}/tags`, { memberCodes: [cat.code] }, PKEY);
  ok('re-tagging moves the photo to the right student',
     ((await J(`/api/bkk/me/${ann.code}/photos`)).body.days || []).length === 0 &&
     ((await J(`/api/bkk/me/${cat.code}/photos`)).body.days || []).length === 1);
  const del = await post(`/api/bkk/teacher/photos/${up.body.photo.id}/delete`, {}, PKEY);
  ok('deleting removes it from the profile and from storage',
     del.status === 200 && ((await J(`/api/bkk/me/${cat.code}/photos`)).body.days || []).length === 0 &&
     global.__destroyed.length === 1 && global.__destroyed[0].type === 'authenticated');

  console.log('\n— photos straight from Drive —');
  const fl = await J('/api/bkk/teacher/drive/folders', { headers: PKEY });
  ok('the day folders inside "photos" are listed, newest first, with their dates',
     fl.status === 200 && fl.body.folders[0].name === '5Oct26' && fl.body.folders[0].date === '2026-10-05' && fl.body.folders[1].date === '2026-10-04',
     JSON.stringify(fl.body));
  const dl = await J('/api/bkk/teacher/drive?folder=DAY5aaaaaaaaaaaaaaaaaaaaa', { headers: PKEY });
  const names = (dl.body.files || []).map(f => f.name);
  ok('the day folder is found by its name and photos listed (sub-folder too, videos left out, in order)',
     dl.status === 200 && JSON.stringify(names) === JSON.stringify(['AYBKK Oct5-001.jpg', 'AYBKK Oct5-002.jpg', 'led-01.jpg']), JSON.stringify(dl.body));
  ok('Drive list needs a passcode', (await J('/api/bkk/teacher/drive?folder=DAY5aaaaaaaaaaaaaaaaaaaaa')).status === 401);
  ok('only folders inside "photos" can be opened', (await J('/api/bkk/teacher/drive?folder=SUBaaaaaaaaaaaaaaaaaaaaaa', { headers: PKEY })).status === 400);
  const upBefore = uploads.length;
  const fd = await post('/api/bkk/teacher/photos/from-drive', { date: '2026-10-05', folder: 'DAY5aaaaaaaaaaaaaaaaaaaaa', driveId: 'IMG2aaaaaaaaaaaaaaaaaaaaa', memberCodes: [ann.code] }, PKEY);
  ok('a Drive photo is saved and tagged', fd.status === 200 && uploads.length === upBefore + 1 && fd.body.photo.members.length === 1, JSON.stringify(fd.body));
  const dl2 = await J('/api/bkk/teacher/drive?folder=DAY5aaaaaaaaaaaaaaaaaaaaa', { headers: PKEY });
  ok('the list ticks it as saved', dl2.body.files.find(f => f.id === 'IMG2aaaaaaaaaaaaaaaaaaaaa').photoId === fd.body.photo.id);
  const again = await post('/api/bkk/teacher/photos/from-drive', { date: '2026-10-05', folder: 'DAY5aaaaaaaaaaaaaaaaaaaaa', driveId: 'IMG2aaaaaaaaaaaaaaaaaaaaa', memberCodes: [ann.code, bob.code] }, PKEY);
  ok('the same Drive photo is never saved twice (only its tags change)', again.status === 200 && uploads.length === upBefore + 1 && again.body.photo.members.length === 2);
  ok('a file that is not in that day\'s folder is refused',
     (await post('/api/bkk/teacher/photos/from-drive', { date: '2026-10-05', folder: 'DAY5aaaaaaaaaaaaaaaaaaaaa', driveId: 'SOMEOTHERFILEaaaaaaaaaaaa', memberCodes: [] }, PKEY)).status === 400);
  ok("Ann's profile shows the Drive photo",
     JSON.stringify((await J(`/api/bkk/me/${ann.code}/photos`)).body).includes(fd.body.photo.thumb));

  const realUpload = fakeCloud.uploader.upload;
  fakeCloud.uploader.upload = async () => { throw { error: { message: 'Server returned unexpected status code - 403', http_code: 403 } }; };
  fakeCloud.api = { usage: async () => ({ credits: { usage: 25.3, limit: 25, used_percent: 101.2 } }) };
  const refused = await post('/api/bkk/teacher/photos/from-drive', { date: '2026-10-05', folder: 'DAY5aaaaaaaaaaaaaaaaaaaaa', driveId: 'IMG1aaaaaaaaaaaaaaaaaaaaa', memberCodes: [] }, PKEY);
  ok('a Cloudinary 403 is explained in plain words, with the plan usage',
     refused.status === 500 && /Error Reports/.test(refused.body.error) && /25.3 of 25 credits/.test(refused.body.error), JSON.stringify(refused.body));
  fakeCloud.uploader.upload = realUpload; delete fakeCloud.api;

  console.log('\n— Rezerv import —');
  const imp1 = await post('/api/bkk/admin/import', { rows: [
    { name: 'Imp One (renewed)', plan: '12 months', until: '26 Oct 2026' },
    { name: 'Imp Two', plan: '6 months', until: '2027-03-14' },
    { name: 'Imp Pack', plan: '10 class pack', until: '12 Dec 2026', classesLeft: 7 },
    { name: 'Imp Bad', plan: 'forever', until: 'soon' },
  ] }, ADMIN);
  ok('import adds students and their passes', imp1.body.newMembers === 3 && imp1.body.passes === 3 && imp1.body.skipped.length === 1,
     JSON.stringify(imp1.body));
  const imp2 = await post('/api/bkk/admin/import', { rows: [
    { name: 'Imp One', email: 'imp.one@example.com', plan: '12 months', until: '26 Oct 2026' },
  ] }, ADMIN);
  ok('running it again with an email fills the email in, no duplicate pass',
     imp2.body.newMembers === 0 && imp2.body.emailsAdded === 1 && imp2.body.passes === 0, JSON.stringify(imp2.body));
  const one = (await J('/api/bkk/admin/members?q=imp.one', { headers: ADMIN })).body.members[0];
  const onePass = one.passes[0];
  ok('the imported pass keeps the Rezerv end date and the "(renewed)" note is dropped from the name',
     one.name === 'Imp One' && String(onePass.valid_until).slice(0, 10) === '2026-10-26' && onePass.source === 'rezerv',
     JSON.stringify({ name: one.name, until: onePass.valid_until, source: onePass.source }));
  const pack = (await J('/api/bkk/admin/members?q=imp pack', { headers: ADMIN })).body.members[0].passes[0];
  ok('a 10-class pack keeps the classes left', pack.credits_total - pack.credits_used === 7, JSON.stringify(pack));
  ok('import needs the staff key', (await post('/api/bkk/admin/import', { rows: [] }, {})).status === 401);
  const twoCode = (await J('/api/bkk/admin/members?q=imp two', { headers: ADMIN })).body.members[0].code;
  const sl = await post(`/api/bkk/admin/members/${twoCode}/signin-link`, {}, ADMIN);
  ok('staff can make a sign-in link for a student with no email', sl.status === 200 && /\/api\/bkk\/login\/[0-9a-f]{64}$/.test(sl.body.link),
     JSON.stringify(sl.body).slice(0, 120));
  ok('the sign-in link needs the staff key', (await post(`/api/bkk/admin/members/${twoCode}/signin-link`, {}, {})).status === 401);
  const tok = sl.body.link.split('/').pop();
  await fetch(`${B}/api/bkk/login/${tok}`);
  const land = await fetch(`${B}/api/bkk/login/${tok}`, { method: 'POST' }).then(r => r.text());
  ok('the link signs the student in and opens their profile', land.includes(twoCode) && land.includes('/book?me=1'));
  ok('a staff link still works a second time (re-open, second phone)',
     (await fetch(`${B}/api/bkk/login/${tok}`, { method: 'POST' })).status === 200);
  ok('a student adds their email once',
     (await post(`/api/bkk/me/${twoCode}/email`, { email: 'imp.two@example.com' })).status === 200 &&
     (await post(`/api/bkk/me/${twoCode}/email`, { email: 'other@example.com' })).status === 409);
  ok("a student cannot take another profile's email",
     (await post(`/api/bkk/me/${(await J('/api/bkk/admin/members?q=imp pack', { headers: ADMIN })).body.members[0].code}/email`,
       { email: 'imp.one@example.com' })).status === 409);

  const prog = await J('/api/bkk/admin/progress', { headers: ADMIN });
  ok('progress shows students, links opened and today\'s photos/notes',
     prog.status === 200 && prog.body.members.total > 0 && prog.body.links.sent >= 1 && prog.body.links.opened >= 1
       && typeof prog.body.photos.untagged_today === 'number' && typeof prog.body.notes.today === 'number',
     JSON.stringify(prog.body).slice(0, 200));
  ok('progress needs the staff key', (await J('/api/bkk/admin/progress')).status === 401);

  console.log('\n— teachers on the timetable —');
  const tsch = (await J("/api/bkk/schedule")).body.classes || [];
  const { rotationTeacher } = require('../bkk-api.js');
  const wed = tsch.find(c => c.title === 'Mysore (1st batch)' && new Date(c.date + 'T12:00:00Z').getUTCDay() === 3);
  const fri = tsch.find(c => c.title === 'Mysore (1st batch)' && new Date(c.date + 'T12:00:00Z').getUTCDay() === 5);
  ok('Wednesday 5:30 is M, Friday 5:30 is Boonchu', wed && wed.teachers === 'M' && fri && fri.teachers === 'Boonchu', JSON.stringify([wed, fri]));
  ok('Saturday Primary takes turns, Jamsai first on 17 Oct',
     rotationTeacher('lp_sat_6', '2026-10-17') === 'Jamsai' && rotationTeacher('lp_sat_6', '2026-10-24') === 'M'
       && rotationTeacher('li_sat_6', '2026-10-24') === null);

  console.log('\n— /start counts —');
  await post('/api/bkk/start-event', { kind: 'view', src: 'Reel-Sleep 1!', lang: 'th' });
  await post('/api/bkk/start-event', { kind: 'view', src: 'reel-sleep1' });
  await post('/api/bkk/start-event', { kind: 'tap', src: 'reel-sleep1', ch: 'line' });
  const st = await J('/api/bkk/admin/start-stats', { headers: ADMIN });
  const row = (st.body.sources || []).find(x => x.src === 'reel-sleep1');
  ok('start page views and taps are counted per source, cleaned', row && row.views === 2 && row.taps === 1, JSON.stringify(st.body));
  ok('start stats need the staff key', (await J('/api/bkk/admin/start-stats')).status === 401);

  console.log('\n— 12-week proof check —');
  const ck = (await post('/api/bkk/teacher/members', { name: 'Check Person', email: 'check.person@example.com' }, PKEY)).body.member.code;
  ok('a check needs at least one number', (await post(`/api/bkk/me/${ck}/checks`, { note: 'hi' })).status === 400);
  ok('a silly heart rate is refused', (await post(`/api/bkk/me/${ck}/checks`, { restingHr: 400 })).status === 400);
  ok('a check is saved', (await post(`/api/bkk/me/${ck}/checks`, { restingHr: 68, sleepHours: 6.5, feel: 3, note: 'tired' })).status === 200);
  await post(`/api/bkk/me/${ck}/checks`, { restingHr: 66, sleepHours: 7, feel: 4 });
  const cks = (await J(`/api/bkk/me/${ck}/checks`)).body.checks;
  ok('one check per day: saving again updates it', cks.length === 1 && cks[0].restingHr === 66 && cks[0].sleepHours === 7 && cks[0].feel === 4,
     JSON.stringify(cks));
  ok('an unknown member gets nothing', (await J('/api/bkk/me/NOPE/checks')).status === 404);

  console.log('\n— admin auth —');
  const noKey = await J('/api/bkk/admin/orders');
  ok('admin requires key', noKey.status === 401);
  const queryKey = await J('/api/bkk/admin/orders?key=testkey');
  ok('a key in the query string is not accepted', queryKey.status === 401, String(queryKey.status));

  console.log('\n— Bangkok calendar dates —');
  // The schedule window is built from ymd(); in UTC it drifts a day during the
  // 00:00–07:00 Bangkok window, exactly when the 05:30 Mysore is booked.
  const todayBkk = new Date(new Date().getTime() + 7 * 3600000).toISOString().slice(0, 10);
  const sch2 = await J('/api/bkk/schedule?days=3');
  ok('schedule never offers a date before today in Bangkok',
     sch2.body.classes.every(c => c.date >= todayBkk),
     `today(BKK)=${todayBkk} earliest=${sch2.body.classes.map(c => c.date).sort()[0]}`);

  console.log(`\n${PASS} passed, ${FAIL} failed`);
  srv.close(); await pool.end();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
