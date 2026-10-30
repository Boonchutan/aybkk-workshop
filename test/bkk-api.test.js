// End-to-end test of bkk-api against a real Postgres.
process.env.BKK_ADMIN_KEY = 'testkey';
process.env.MAIL_DRY_RUN = '1';   // capture mail in an outbox instead of sending
const express = require('express');
const { Pool } = require('pg');
const { mountBkk, moonDaysBetween, parseWhen, CANCEL_CUTOFF_HOURS } = require('../bkk-api.js');

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
  const year = prods.body.products.find(p => p.code === 'unlim12m');
  ok('a year is 12 months (365 days), no free 13th month on sale', year && year.valid_days === 365 && year.price_thb === 78000 &&
     !prods.body.products.some(p => p.code === 'unlim12' || /free/i.test(p.name_en)), JSON.stringify(year));
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
  // A drop-in order now books its own class when paid, so the racers get a
  // 1-class pass by hand instead: the race below is what is under test.
  const codes = [];
  for (let i = 0; i < 5; i++) {
    const g = await post('/api/bkk/admin/passes', { productCode: 'dropin', name: 'R' + i, email: `r${i}@x.com` }, ADMIN);
    codes.push(g.body.member.code);
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
  ok("...and the rule's hours, so the page never says another number", can.body.cutoffHours === CANCEL_CUTOFF_HOURS
     && (await J('/api/bkk/schedule?days=1')).body.cutoffHours === CANCEL_CUTOFF_HOURS, JSON.stringify(can.body));

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
  ok("...with the package's Thai name for the Thai profile", cashMe.passes[0].nameTh === '1 เดือน ไม่จำกัด',
     JSON.stringify(cashMe.passes[0]));
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
  ok('each photo also has a full-size save link', /^signed:\/\/authenticated\/.+\/2048$/.test(annPics[0].items[0].save || ''), annPics[0].items[0].save);
  ok('a student who is not in the photo sees nothing', catPics.length === 0);
  const annMe = (await J(`/api/bkk/me/${ann.code}`)).body.member;
  ok('a student gets a workshop-journal id that is not their member code',
     /^bkk-[\w-]{12}$/.test(annMe.journalId) && !annMe.journalId.includes(ann.code), annMe.journalId);
  ok('the id never changes, and the teacher sees the same one',
     (await J(`/api/bkk/me/${ann.code}`)).body.member.journalId === annMe.journalId &&
     (await J(`/api/bkk/teacher/student/${ann.code}`, { headers: PKEY })).body.member.journalId === annMe.journalId);
  ok('another student gets their own',
     (await J(`/api/bkk/me/${cat.code}`)).body.member.journalId !== annMe.journalId);
  const day = (await J('/api/bkk/teacher/photos?date=2026-10-03', { headers: PKEY })).body.photos;
  ok("the teacher's day view lists the photo", day.length === 1);
  await post(`/api/bkk/teacher/photos/${up.body.photo.id}/tags`, { memberCodes: [cat.code] }, PKEY);
  ok('re-tagging moves the photo to the right student',
     ((await J(`/api/bkk/me/${ann.code}/photos`)).body.days || []).length === 0 &&
     ((await J(`/api/bkk/me/${cat.code}/photos`)).body.days || []).length === 1);
  const stale = await post(`/api/bkk/teacher/photos/${up.body.photo.id}/tags`, { memberCodes: [cat.code, 'BGONE0000000'] }, PKEY);
  ok('a code that changed while the page was open stops the save instead of untagging someone',
     stale.status === 409 && ((await J(`/api/bkk/me/${cat.code}/photos`)).body.days || []).length === 1, JSON.stringify(stale.body));
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
  ok('the server asks Drive for a 2048px copy, not the 5 MB original', driveFetches.some(u => u.includes('/thumbnail?') && u.includes('sz=s2048')));
  const dl2 = await J('/api/bkk/teacher/drive?folder=DAY5aaaaaaaaaaaaaaaaaaaaa', { headers: PKEY });
  ok('the list ticks it as saved', dl2.body.files.find(f => f.id === 'IMG2aaaaaaaaaaaaaaaaaaaaa').photoId === fd.body.photo.id);
  const again = await post('/api/bkk/teacher/photos/from-drive', { date: '2026-10-05', folder: 'DAY5aaaaaaaaaaaaaaaaaaaaa', driveId: 'IMG2aaaaaaaaaaaaaaaaaaaaa', memberCodes: [ann.code, bob.code] }, PKEY);
  ok('the same Drive photo is never saved twice (only its tags change)', again.status === 200 && uploads.length === upBefore + 1 && again.body.photo.members.length === 2);
  const dl3 = (await J('/api/bkk/teacher/drive?folder=DAY5aaaaaaaaaaaaaaaaaaaaa', { headers: PKEY })).body.files || [];
  ok('the list says how many people are on a saved photo, and 0 for a new one',
     dl3.find(f => f.id === 'IMG2aaaaaaaaaaaaaaaaaaaaa').tagged === 2 && dl3.filter(f => !f.photoId).every(f => f.tagged === 0), JSON.stringify(dl3));
  ok('a file that is not in that day\'s folder is refused',
     (await post('/api/bkk/teacher/photos/from-drive', { date: '2026-10-05', folder: 'DAY5aaaaaaaaaaaaaaaaaaaaa', driveId: 'SOMEOTHERFILEaaaaaaaaaaaa', memberCodes: [] }, PKEY)).status === 400);
  ok("Ann's profile shows the Drive photo",
     JSON.stringify((await J(`/api/bkk/me/${ann.code}/photos`)).body).includes(fd.body.photo.thumb));

  // Many photos of one person, then the name once (8 Oct): the name is added.
  const manyId = fd.body.photo.id;
  const addCat = await post('/api/bkk/teacher/photos/tags/add', { photoIds: [manyId], memberCodes: [cat.code] }, PKEY);
  const namesOn = ph => ph.members.map(m => m.code).sort().join();
  ok('adding a name to picked photos keeps everyone already on them',
     addCat.status === 200 && namesOn(addCat.body.photos[0]) === [ann.code, bob.code, cat.code].sort().join(), JSON.stringify(addCat.body).slice(0, 200));
  ok('adding the same name again changes nothing',
     namesOn((await post('/api/bkk/teacher/photos/tags/add', { photoIds: [manyId, manyId], memberCodes: [cat.code, cat.code] }, PKEY)).body.photos[0]).split(',').length === 3);
  ok('adding names needs a passcode', (await post('/api/bkk/teacher/photos/tags/add', { photoIds: [manyId], memberCodes: [cat.code] }, {})).status === 401);
  ok('no photos or no name is refused',
     (await post('/api/bkk/teacher/photos/tags/add', { photoIds: [], memberCodes: [cat.code] }, PKEY)).status === 400 &&
     (await post('/api/bkk/teacher/photos/tags/add', { photoIds: [manyId], memberCodes: [] }, PKEY)).status === 400);
  ok('a code that changed meanwhile stops it, nothing added',
     (await post('/api/bkk/teacher/photos/tags/add', { photoIds: [manyId], memberCodes: ['BGONE0000000'] }, PKEY)).status === 409);
  ok('a photo deleted meanwhile stops it',
     (await post('/api/bkk/teacher/photos/tags/add', { photoIds: [manyId, 99999999], memberCodes: [cat.code] }, PKEY)).status === 409);
  const upAdd = uploads.length;
  const keepTags = await post('/api/bkk/teacher/photos/from-drive',
    { date: '2026-10-05', folder: 'DAY5aaaaaaaaaaaaaaaaaaaaa', driveId: 'IMG2aaaaaaaaaaaaaaaaaaaaa', memberCodes: [cat.code], add: true }, PKEY);
  ok('picking an already-saved Drive photo adds the name without saving it twice or dropping anyone',
     keepTags.status === 200 && uploads.length === upAdd && namesOn(keepTags.body.photo).split(',').length === 3, JSON.stringify(keepTags.body).slice(0, 200));

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
  const onePassPkg = (await pool.query(`SELECT p.code, p.valid_days, p.active FROM bkk_passes x JOIN bkk_products p ON p.id = x.product_id
    JOIN bkk_members m ON m.id = x.member_id WHERE m.name = 'Imp One'`)).rows[0] || {};
  ok('a Rezerv 12-month pass (sold with 13 months) imports to the old package, kept off sale',
     onePassPkg.code === 'unlim12' && onePassPkg.valid_days === 395 && onePassPkg.active === false, JSON.stringify(onePassPkg));
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

  console.log('\n— the wrong student signed in (8 Oct: Kat got Kate\'s link) —');
  const mkMember = async name => (await post('/api/bkk/admin/passes', { name, productCode: 'pack10' }, ADMIN)).body.member.code;
  const kateCode = await mkMember('Kate Mixup'), katCode = await mkMember('Kat Mixup');
  ok('new member codes are long and random, not the clock', /^B[0-9A-Z]{13}$/.test(kateCode), kateCode);
  const kateLink = (await post(`/api/bkk/admin/members/${kateCode}/signin-link`, {}, ADMIN)).body.link.split('/').pop();
  ok("Kat, holding Kate's link, puts her own email on Kate's profile",
     (await post(`/api/bkk/me/${kateCode}/email`, { email: 'kat.mixup@example.com' })).status === 200);
  ok('...so her own profile refuses it (the reported problem)',
     (await post(`/api/bkk/me/${katCode}/email`, { email: 'kat.mixup@example.com' })).status === 409);
  const nK = signins().length;
  await post('/api/bkk/login/request', { email: 'kat.mixup@example.com' });
  const katMailTok = (signins().slice(nK)[0] || { text: '' }).text.match(/login\/([a-f0-9]{64})/);
  ok("while it sits there, Kat's email sign-in opens Kate's profile", !!katMailTok);
  // A drop-in is bought for a class.
  const dropCls = (await J('/api/bkk/schedule?days=14')).body.classes.find(c => c.seatsLeft > 0);
  const forCls = { slotId: dropCls.slotId, date: dropCls.date };
  ok('checkout with an email that has a profile does not hand that profile to the browser',
     (await post('/api/bkk/orders', { productCode: 'dropin', name: 'Kat', email: 'kat.mixup@example.com', ...forCls })).body.member.code === undefined);
  ok('...but a browser that already holds that profile keeps it',
     (await post('/api/bkk/orders', { productCode: 'dropin', name: 'Kate', email: 'kat.mixup@example.com', memberCode: kateCode, ...forCls })).body.member.code === kateCode);
  ok('...and a brand-new email gets its new profile', /^B/.test((await post('/api/bkk/orders',
     { productCode: 'dropin', name: 'New One', email: 'brand.new.mixup@example.com', ...forCls })).body.member.code || ''));

  ok('changing an email needs the staff key',
     (await post(`/api/bkk/admin/members/${katCode}/email`, { email: 'kat.mixup@example.com' })).status === 401);
  const clash = await post(`/api/bkk/admin/members/${katCode}/email`, { email: 'Kat.Mixup@example.com' }, ADMIN);
  ok('the shala is told whose profile holds the email', clash.status === 409 && clash.body.owner.code === kateCode, JSON.stringify(clash.body));
  ok('naming the wrong profile moves nothing',
     (await post(`/api/bkk/admin/members/${katCode}/email`, { email: 'kat.mixup@example.com', takeFrom: katCode }, ADMIN)).status === 409);
  ok('the email moves to Kat once the shala confirms where it comes from',
     (await post(`/api/bkk/admin/members/${katCode}/email`, { email: 'kat.mixup@example.com', takeFrom: kateCode }, ADMIN)).status === 200);
  const who = async c => (await J(`/api/bkk/admin/members?q=${c}`, { headers: ADMIN })).body.members[0];
  ok("Kat has it, Kate's profile has none", (await who(katCode)).email === 'kat.mixup@example.com' && (await who(kateCode)).email == null);
  ok("the email link Kat got while it sat on Kate's profile no longer opens it",
     katMailTok && (await fetch(`${B}/api/bkk/login/${katMailTok[1]}`, { method: 'POST' })).status === 400);
  ok('a bad email is refused', (await post(`/api/bkk/admin/members/${kateCode}/email`, { email: 'kate@' }, ADMIN)).status === 400);
  await post(`/api/bkk/admin/members/${kateCode}/email`, { email: 'kate.mixup@example.com' }, ADMIN);
  ok('an empty email removes it',
     (await post(`/api/bkk/admin/members/${kateCode}/email`, { email: '' }, ADMIN)).status === 200 && (await who(kateCode)).email == null);
  ok('an unknown profile is a 404', (await post('/api/bkk/admin/members/NOPE/email', { email: '' }, ADMIN)).status === 404);

  ok('signing a profile out everywhere needs the staff key', (await post(`/api/bkk/admin/members/${kateCode}/signout`, {}, {})).status === 401);
  const out = await post(`/api/bkk/admin/members/${kateCode}/signout`, {}, ADMIN);
  const kateNew = out.body.member && out.body.member.code;
  ok("Kate's profile gets a new code and her sign-in link stops", out.status === 200 && kateNew && kateNew !== kateCode && out.body.linksStopped >= 1,
     JSON.stringify(out.body));
  ok("the old code (on Kat's phone) no longer opens anything", (await J(`/api/bkk/me/${kateCode}`)).status === 404);
  ok('...and says so in the words the page listens for', (await J(`/api/bkk/me/${kateCode}`)).body.error === 'not found');
  ok('the link M sent is dead', (await fetch(`${B}/api/bkk/login/${kateLink}`, { method: 'POST' })).status === 400);
  const kateNow = await J(`/api/bkk/me/${kateNew}`);
  ok("Kate's profile and pass are intact under the new code",
     kateNow.status === 200 && kateNow.body.member.name === 'Kate Mixup' && kateNow.body.passes.length === 1, JSON.stringify(kateNow.body).slice(0, 160));
  ok('a fresh link for Kate works', (await post(`/api/bkk/admin/members/${kateNew}/signin-link`, {}, ADMIN)).status === 200);
  ok('signing out an unknown profile is a 404', (await post('/api/bkk/admin/members/NOPE/signout', {}, ADMIN)).status === 404);

  // The other order: M signs out first, while the wrong email still sits there,
  // from a search done before it was typed in (the 8 Oct steps exactly).
  const lenaCode = await mkMember('Lena Mixup');
  await post(`/api/bkk/me/${lenaCode}/email`, { email: 'wrong.person@example.com' });
  const blind = await post(`/api/bkk/admin/members/${lenaCode}/signout`, { expectEmail: null }, ADMIN);
  ok('a sign-out decided on a screen from before the email appeared is refused',
     blind.status === 409 && blind.body.needEmailDecision && blind.body.email === 'wrong.person@example.com', JSON.stringify(blind.body));
  ok('...and so is one with no keep-or-remove answer',
     (await post(`/api/bkk/admin/members/${lenaCode}/signout`, { expectEmail: 'wrong.person@example.com' }, ADMIN)).status === 409);
  ok('...and nothing changed: same code, same links', (await J(`/api/bkk/me/${lenaCode}`)).status === 200);
  const keep = await post(`/api/bkk/admin/members/${lenaCode}/signout`,
    { expectEmail: 'wrong.person@example.com', clearEmail: false }, ADMIN);
  ok('keeping it is an answer M gives on purpose', keep.status === 200 && keep.body.member.email === 'wrong.person@example.com' && !keep.body.removedEmail);
  const wipe = await post(`/api/bkk/admin/members/${keep.body.member.code}/signout`,
    { expectEmail: 'Wrong.Person@example.com', clearEmail: true }, ADMIN);
  ok('...removing it happens in the same step, and says what was removed',
     wipe.status === 200 && wipe.body.member.email === null && wipe.body.removedEmail === 'wrong.person@example.com'
       && (await who(wipe.body.member.code)).email == null, JSON.stringify(wipe.body));
  const nL = signins().length;
  await post('/api/bkk/login/request', { email: 'wrong.person@example.com' });
  ok('so the wrong person cannot email herself back in', signins().length === nL);
  ok('a profile with no email signs out without being asked',
     (await post(`/api/bkk/admin/members/${wipe.body.member.code}/signout`, {}, ADMIN)).status === 200);

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

  console.log('\n— tees —');
  ok('no tees: the public list is empty', (await J('/api/bkk/tees')).body.tees.length === 0);
  ok('adding a tee needs the admin key', (await post('/api/bkk/admin/tees', { name: 'T', priceThb: 900, payLink: 'https://pay.example/x' })).status === 401);
  ok('a payment link must be https',
     (await post('/api/bkk/admin/tees', { name: 'T', priceThb: 900, payLink: 'javascript:alert(1)' }, ADMIN)).status === 400);
  ok('a price must be whole baht',
     (await post('/api/bkk/admin/tees', { name: 'T', priceThb: 9.5, payLink: 'https://pay.example/x' }, ADMIN)).status === 400);
  const tee = (await post('/api/bkk/admin/tees', { name: 'Mysore tee', priceThb: 900, payLink: 'https://pay.example/x',
    photo: '/img/tees/1.jpg', sizes: 'S M L' }, ADMIN)).body.tee;
  ok('admin adds a tee', tee && tee.id && tee.priceThb === 900 && tee.active === true);
  ok('students see it', (await J('/api/bkk/tees')).body.tees.map(x => x.name).join() === 'Mysore tee');
  await post('/api/bkk/admin/tees', { ...tee, active: false }, ADMIN);
  ok('taken off sale: hidden from students, kept for admin',
     (await J('/api/bkk/tees')).body.tees.length === 0 && (await J('/api/bkk/admin/tees', { headers: ADMIN })).body.tees.length === 1);

  console.log('\n— admin auth —');
  const noKey = await J('/api/bkk/admin/orders');
  ok('admin requires key', noKey.status === 401);
  const queryKey = await J('/api/bkk/admin/orders?key=testkey');
  ok('a key in the query string is not accepted', queryKey.status === 401, String(queryKey.status));

  console.log('\n— the Monday letter (email sign-ups) —');
  {
    const { outbox } = require('../mailer');
    const asks = () => outbox.filter(m => m.tag === 'letter-confirm');
    const tokOf = m => ((m || { text: '' }).text.match(/newsletter\/confirm\/([A-Za-z0-9_-]+)/) || [])[1];
    const lastTok = to => tokOf(asks().filter(m => m.to === to).pop());
    const mailsTo = to => asks().filter(m => m.to === to).length;
    const raw = async (path, opts) => { const r = await fetch(B + path, opts); return { status: r.status, text: await r.text(), headers: r.headers }; };
    const sign = (email, ip, extra = {}) => post('/api/bkk/newsletter', { email, consent: true, ...extra }, { 'x-forwarded-for': ip });
    const row = async email => (await pool.query('SELECT * FROM bkk_newsletter WHERE email=$1', [email])).rows[0];
    const ago = (email, iv) => pool.query(`UPDATE bkk_newsletter SET asked_at = now() - interval '${iv}' WHERE email=$1`, [email]);
    const confirmed = async () => ((await J('/api/bkk/admin/newsletter', { headers: ADMIN })).body.counts || []).some(c => c.status === 'confirmed');
    ok('a bad email is refused', (await post('/api/bkk/newsletter', { email: 'nope', consent: true })).status === 400);
    ok('no tick, no sign-up', (await post('/api/bkk/newsletter', { email: 'reader@example.com' })).status === 400);

    const a0 = asks().length;
    const first = await sign(' Reader@Example.com ', '198.51.100.1', { lang: 'th', src: 'site' });
    ok('a sign-up is accepted', first.status === 200 && first.body.ok, JSON.stringify(first.body));
    ok('a confirm mail goes out in the reader\'s language', asks().length === a0 + 1 &&
       /ยืนยัน/.test(asks()[asks().length - 1].subject) && asks()[asks().length - 1].to === 'reader@example.com',
       JSON.stringify(asks().slice(-1)));
    const again = await sign('reader@example.com', '198.51.100.1');
    ok('signing up twice in a row sends no second mail', again.status === 200 && asks().length === a0 + 1, String(asks().length));
    ok('not counted before it is confirmed', !(await confirmed()));

    const token = lastTok('reader@example.com');
    const peek = await raw(`/api/bkk/newsletter/confirm/${token}`);
    ok('opening the confirm link (a mail scanner, even one that runs scripts) does not confirm',
       peek.status === 200 && !/<script/i.test(peek.text) && !(await confirmed()), peek.text.slice(0, 300));
    ok('the confirm page is in the reader\'s language', /lang="th"/.test(peek.text) && /ยืนยัน ส่งจดหมายให้ฉัน/.test(peek.text));
    const yes = await raw(`/api/bkk/newsletter/confirm/${token}`, { method: 'POST' });
    ok('tapping Confirm confirms', yes.status === 200 && /ทุกวันจันทร์/.test(yes.text) && await confirmed(), yes.text.slice(0, 300));
    ok('opening the link again just says thank you',
       /ขอบคุณ/.test((await raw(`/api/bkk/newsletter/confirm/${token}`)).text));

    const after = await J('/api/bkk/admin/newsletter', { headers: ADMIN });
    ok('the staff count shows one confirmed Thai reader',
       (after.body.counts || []).some(c => c.status === 'confirmed' && c.lang === 'th' && c.n === 1), JSON.stringify(after.body));
    const csv = await raw('/api/bkk/admin/newsletter?csv=1', { headers: ADMIN });
    ok('the send list has the address and its own unsubscribe link', csv.status === 200 &&
       csv.text.includes('"reader@example.com"') && csv.text.includes(`/api/bkk/newsletter/unsubscribe/${token}`), csv.text.slice(0, 300));
    ok('the send list needs the staff key', (await raw('/api/bkk/admin/newsletter?csv=1')).status === 401);

    const a1 = asks().length;
    const known = await sign('reader@example.com', '198.51.100.2');
    ok('a confirmed reader signing up again gets the same answer and no mail',
       known.status === 200 && known.body.ok && asks().length === a1);

    const peekOut = await raw(`/api/bkk/newsletter/unsubscribe/${token}`);
    ok('opening the unsubscribe link alone changes nothing', peekOut.status === 200 && /lang="th"/.test(peekOut.text) && await confirmed());
    await pool.query(`UPDATE bkk_newsletter SET confirmed_at = now() - interval '200 days' WHERE email='reader@example.com'`);
    const out = await raw(`/api/bkk/newsletter/unsubscribe/${token}`, { method: 'POST', body: 'List-Unsubscribe=One-Click',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    ok('one-click unsubscribe works', out.status === 200);
    const csv2 = await raw('/api/bkk/admin/newsletter?csv=1', { headers: ADMIN });
    ok('a reader who left is off the send list', !csv2.text.includes('reader@example.com'), csv2.text.slice(0, 200));
    ok('an old confirm link cannot sign a leaver back up',
       (await raw(`/api/bkk/newsletter/confirm/${token}`, { method: 'POST' })).status === 400);
    ok('a made-up token is refused', (await raw('/api/bkk/newsletter/confirm/nope', { method: 'POST' })).status === 400);

    const back = await sign('reader@example.com', '198.51.100.3', { lang: 'en' });
    const newTok = lastTok('reader@example.com');
    ok('a leaver can sign up again and gets a fresh confirm mail with a new link', back.status === 200 &&
       asks().length === a1 + 1 && /Confirm your AYBKK/.test(asks()[asks().length - 1].subject) && newTok && newTok !== token);
    ok('the old link in a forwarded letter cannot confirm the new ask',
       (await raw(`/api/bkk/newsletter/confirm/${token}`, { method: 'POST' })).status === 400 &&
       (await row('reader@example.com')).status === 'pending');
    await raw(`/api/bkk/newsletter/confirm/${newTok}`, { method: 'POST' });
    const rejoined = await row('reader@example.com');
    ok('rejoining records the new consent date and keeps the date they left', rejoined.status === 'confirmed' &&
       Date.now() - rejoined.confirmed_at < 60000 && !!rejoined.unsubscribed_at, JSON.stringify(rejoined));

    await sign('slow@example.com', '198.51.100.10');
    const slow1 = lastTok('slow@example.com');
    await ago('slow@example.com', '11 minutes');
    await sign('slow@example.com', '198.51.100.11');
    ok('a pending address can be asked again after 10 minutes, with a new link',
       mailsTo('slow@example.com') === 2 && lastTok('slow@example.com') !== slow1);
    ok('the first link stops working once a newer one is sent',
       (await raw(`/api/bkk/newsletter/confirm/${slow1}`, { method: 'POST' })).status === 400);
    await ago('slow@example.com', '11 minutes');
    await sign('slow@example.com', '198.51.100.12');
    await ago('slow@example.com', '11 minutes');
    await sign('slow@example.com', '198.51.100.13');
    ok('one address gets at most 3 confirm mails a day', mailsTo('slow@example.com') === 3, String(mailsTo('slow@example.com')));
    await ago('slow@example.com', '25 hours');
    await sign('slow@example.com', '198.51.100.14');
    ok('the next day it can be asked again', mailsTo('slow@example.com') === 4, String(mailsTo('slow@example.com')));
    await ago('slow@example.com', '8 days');
    const stale = lastTok('slow@example.com');
    ok('a confirm link stops working after 7 days',
       (await raw(`/api/bkk/newsletter/confirm/${stale}`)).status === 400 &&
       (await raw(`/api/bkk/newsletter/confirm/${stale}`, { method: 'POST' })).status === 400);

    const keep = { dry: process.env.MAIL_DRY_RUN, key: process.env.RESEND_API_KEY };
    process.env.MAIL_DRY_RUN = '0'; delete process.env.RESEND_API_KEY;
    const off = await sign('off@example.com', '198.51.100.20');
    process.env.MAIL_DRY_RUN = keep.dry; if (keep.key) process.env.RESEND_API_KEY = keep.key;
    ok('when mail is off, the reader is told it failed (not "check your inbox")', off.status === 503, String(off.status));
    const retry = await sign('off@example.com', '198.51.100.20');
    ok('and a retry once mail works sends at once', retry.status === 200 && mailsTo('off@example.com') === 1, String(mailsTo('off@example.com')));

    const flood = [];
    for (let i = 0; i < 11; i++) flood.push(await sign(`flood${i}@example.com`, '192.0.2.50'));
    ok('a class on the shala wifi can sign up, but one place cannot send a flood',
       asks().filter(m => /^flood/.test(m.to)).length === 10 && flood[10].status === 429,
       `${asks().filter(m => /^flood/.test(m.to)).length} ${flood[10].status}`);

    await pool.query('DELETE FROM bkk_letter_asks');
    await pool.query(`INSERT INTO bkk_letter_asks (ip) SELECT '10.0.0.' || g FROM generate_series(1, 30) g`);
    const busy = await sign('busy@example.com', '198.51.100.30');
    ok('past the hourly total, sign-ups are told to come back, and no mail goes out',
       busy.status === 429 && mailsTo('busy@example.com') === 0, String(busy.status));
    await pool.query(`UPDATE bkk_letter_asks SET at = now() - interval '2 hours'`);
    await pool.query(`INSERT INTO bkk_letter_asks (ip, at) SELECT '10.0.1.' || g, now() - interval '3 hours' FROM generate_series(1, 30) g`);
    ok('the same for the daily total', (await sign('busy@example.com', '198.51.100.31')).status === 429);
    await pool.query('DELETE FROM bkk_letter_asks');

    const evil = '=hyperlink("x")@example.com';
    await sign(evil, '203.0.113.9');
    const evilTok = lastTok(evil);
    if (evilTok) await raw(`/api/bkk/newsletter/confirm/${evilTok}`, { method: 'POST' });
    const csv3 = await raw('/api/bkk/admin/newsletter?csv=1', { headers: ADMIN });
    ok('a formula-looking address cannot run in a spreadsheet', !!evilTok && csv3.text.includes(`"'=hyperlink(""x"")@example.com"`), csv3.text.slice(0, 400));

    await post('/api/bkk/start-event', { kind: 'tap', src: 'letter', ch: 'line' });
    const stats = await J('/api/bkk/admin/start-stats', { headers: ADMIN });
    ok('a letter tap is not counted as a booking tap', !(stats.body.sources || []).some(x => x.src === 'letter'), JSON.stringify(stats.body));
    ok('staff see which door letter readers take',
       ((await J('/api/bkk/admin/newsletter', { headers: ADMIN })).body.doors || []).some(d => d.ch === 'line' && d.n === 1));

    await post('/api/bkk/admin/settings', { links: { telegram: 'https://t.me/aybkk_letter' } }, ADMIN);
    ok('the Telegram channel link is served for the letter box',
       (await J('/api/bkk/settings')).body.links.telegram === 'https://t.me/aybkk_letter');
  }

  console.log('\n— every way in puts a name on the class list —');
  {
    const { outbox } = require('../mailer');
    const sched = async () => (await J('/api/bkk/schedule?days=14')).body.classes;
    const seatOf = (list, c) => list.find(x => x.slotId === c.slotId && x.date === c.date) || {};
    const receiptTo = to => outbox.filter(m => m.tag === 'receipt' && m.to === to).pop();
    const settle = () => new Promise(r => setTimeout(r, 300));     // receipts are sent after the reply
    // Classes far enough off that none starts while this runs.
    const later = (await sched()).filter(c => c.seatsLeft > 1 && new Date(c.startAt) - Date.now() > 30 * 60000);
    const dc = later[0], gone = later.find(c => c.slotId !== dc.slotId || c.date !== dc.date);
    const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
    const wdOf = d => new Date(d + 'T12:00:00Z').getUTCDay();
    const isMoon = d => moonDaysBetween(d, d).size > 0;
    // A working day that is not dc's weekday, so only the weekday rule can refuse it.
    let wrongDay = addD(dc.date, 1);
    while (isMoon(wrongDay) || wdOf(wrongDay) === wdOf(dc.date)) wrongDay = addD(wrongDay, 1);

    const noCls = await post('/api/bkk/orders', { productCode: 'dropin', name: 'Drop Without', email: 'drop.without@example.com' });
    ok('a drop-in bought without a class is refused', noCls.status === 400 && /Pick the class/.test(noCls.body.error), JSON.stringify(noCls.body));
    const pack = await post('/api/bkk/orders', { productCode: 'pack10', name: 'Pack Buyer', email: 'pack.buyer@example.com' });
    ok('...other packages need no class', pack.status === 200, JSON.stringify(pack.body).slice(0, 120));
    const wrongWd = await post('/api/bkk/orders', { productCode: 'dropin',
      name: 'Wrong Day', email: 'wrong.day@example.com', slotId: dc.slotId, date: wrongDay });
    ok('a drop-in for a class on the wrong weekday is refused', wrongWd.status === 409 && /not on that day/.test(wrongWd.body.error),
       `${wrongDay} ${JSON.stringify(wrongWd.body)}`);
    // Same weekday as dc, a working day: n weeks on, stepped past a moon day.
    const weeksOn = n => { let d = addD(dc.date, 7 * n); while (isMoon(d)) d = addD(d, 7); return d; };
    const far = await post('/api/bkk/orders', { productCode: 'dropin', name: 'Far Off', email: 'far.off@example.com',
      slotId: dc.slotId, date: weeksOn(104) });
    ok('a drop-in for a class two years off is refused', far.status === 409 && /next 2 months/.test(far.body.error), JSON.stringify(far.body));
    const month = await post('/api/bkk/orders', { productCode: 'dropin', name: 'Month Off', email: 'month.off@example.com',
      slotId: dc.slotId, date: weeksOn(4) });
    ok('...but a class a month off, past the two-week list, is fine', month.status === 200 && month.body.order, JSON.stringify(month.body).slice(0, 160));

    const booked0 = seatOf(await sched(), dc).booked;
    const dOrd = await post('/api/bkk/orders', { productCode: 'dropin', name: 'Drop In', email: 'drop.in@example.com',
      slotId: dc.slotId, date: dc.date });
    ok('a drop-in bought for a class is accepted', dOrd.status === 200 && dOrd.body.order, JSON.stringify(dOrd.body).slice(0, 160));
    ok('...and holds no seat until it is paid', seatOf(await sched(), dc).booked === booked0);
    const dRow = (await pool.query('SELECT id, slot_id FROM bkk_orders WHERE refno=$1', [dOrd.body.order.refno])).rows[0];
    ok('...the class is kept on the order', dRow.slot_id === dc.slotId);
    await post(`/api/bkk/admin/orders/${dRow.id}/force-activate`, {}, ADMIN);
    ok('paying for the drop-in books its class: one more on the timetable', seatOf(await sched(), dc).booked === booked0 + 1,
       `${booked0} → ${seatOf(await sched(), dc).booked}`);
    const dMe = (await J('/api/bkk/me/' + dOrd.body.member.code)).body;
    ok("...it is on the student's own list, and the drop-in is used",
       dMe.bookings.length === 1 && dMe.bookings[0].slot_id === dc.slotId && dMe.passes[0].creditsLeft === 0, JSON.stringify(dMe).slice(0, 240));
    const chk = await J('/api/bkk/pay/check/' + dOrd.body.order.refno);
    ok('pay/check on the paid order says which class it booked',
       chk.body.status === 'paid' && chk.body.booking && chk.body.booking.title === dc.title && !!chk.body.booking.startAt, JSON.stringify(chk.body));
    await settle();
    const rc = receiptTo('drop.in@example.com');
    ok('the receipt names the booked class', rc && rc.text.includes('booked into ' + dc.title) && rc.html.includes(dc.title), rc && rc.text.slice(0, 300));

    await pool.query(`INSERT INTO bkk_class_overrides (slot_id, class_date, capacity) VALUES ($1,$2,$3)
      ON CONFLICT (slot_id, class_date) DO UPDATE SET capacity=$3`, [dc.slotId, dc.date, booked0 + 1]);
    const fullTry = await post('/api/bkk/orders', { productCode: 'dropin', name: 'Too Full', email: 'too.full@example.com',
      slotId: dc.slotId, date: dc.date });
    ok('a drop-in for a full class is refused before anyone pays', fullTry.status === 409 && /full/.test(fullTry.body.error), JSON.stringify(fullTry.body));
    await pool.query('UPDATE bkk_class_overrides SET capacity=NULL WHERE slot_id=$1 AND class_date=$2', [dc.slotId, dc.date]);

    const gOrd = await post('/api/bkk/orders', { productCode: 'dropin', name: 'Paid Late', email: 'paid.late@example.com',
      slotId: gone.slotId, date: gone.date });
    await post('/api/bkk/admin/classes/cancel', { slotId: gone.slotId, date: gone.date, reason: 'test' }, ADMIN);
    const gRow = (await pool.query('SELECT id FROM bkk_orders WHERE refno=$1', [gOrd.body.order.refno])).rows[0];
    const gAct = await post(`/api/bkk/admin/orders/${gRow.id}/force-activate`, {}, ADMIN);
    const gStatus = (await pool.query('SELECT status FROM bkk_orders WHERE id=$1', [gRow.id])).rows[0].status;
    const gMe = (await J('/api/bkk/me/' + gOrd.body.member.code)).body;
    ok('a class cancelled while the student paid: the order still goes through as paid', gAct.status === 200 && gStatus === 'paid',
       `${gAct.status} ${gStatus}`);
    ok('...the drop-in is kept unused for another class, and nothing is booked',
       gMe.passes.length === 1 && gMe.passes[0].creditsLeft === 1 && gMe.bookings.length === 0, JSON.stringify(gMe).slice(0, 240));
    const gChk = (await J('/api/bkk/pay/check/' + gOrd.body.order.refno)).body;
    ok('...and pay/check does not claim a booking, but names the class it could not book',
       gChk.booking === undefined && gChk.notBooked && gChk.notBooked.title === gone.title && gChk.notBooked.startAt === gone.startAt,
       JSON.stringify(gChk));
    await settle();
    const grc = receiptTo('paid.late@example.com');
    ok('...and so does the receipt', grc && grc.text.includes('could not book ' + gone.title) && !grc.text.includes('booked into')
       && grc.html.includes('could not book'), grc && grc.text.slice(0, 300));
    await post('/api/bkk/admin/classes/reopen', { slotId: gone.slotId, date: gone.date }, ADMIN);

    // The door. A class made for this: running right now (started a minute ago,
    // never before midnight), 3 hours long, 3 places. On a moon day the shala
    // is shut, so it goes on the last working day before, in a class long
    // enough to be running still (the door never checks in for a day still to
    // come), and only admin/today's own checks wait.
    const bkkMs = ms => new Date(ms + 7 * 3600000).toISOString();
    const todayB = bkkMs(Date.now()).slice(0, 10);
    let doorDate = todayB;
    while (isMoon(doorDate)) doorDate = addD(doorDate, -1);
    const onToday = doorDate === todayB;
    const skipped = what => console.log(`  - SKIPPED (moon day today, walk-ins tested on ${doorDate}): ${what}`);
    const startNow = !onToday ? '06:00'
      : bkkMs(Date.now() - 60000).slice(0, 10) === todayB ? bkkMs(Date.now() - 60000).slice(11, 16) : '00:00';
    const doorMin = onToday ? 180 : Math.ceil((Date.now() - Date.parse(`${doorDate}T06:00:00+07:00`)) / 60000) + 180;
    const mkSlot = async (code, weekday, start, minutes, cap) => (await pool.query(
      `INSERT INTO bkk_class_slots (code,title,kind,weekday,start_time,duration_min,capacity)
       VALUES ($1,'Door Test','test',$2,$3,$4,$5) RETURNING id`, [code, weekday, start, minutes, cap])).rows[0].id;
    const doorSlot = await mkSlot('test_door_now', wdOf(doorDate), startNow, doorMin, 3);
    const onDay = onToday ? {} : { date: doorDate };      // today is the default
    const walk = (body, h = ADMIN) => post('/api/bkk/admin/walkin', { slotId: doorSlot, ...onDay, ...body }, h);
    const today0 = await J('/api/bkk/admin/today', { headers: ADMIN });
    const dcl = r => (r.body.classes || []).find(x => x.slotId === doorSlot);
    // The door class's list: admin/today's rows, or on a moon day the same
    // columns read from the table, since admin/today shows today only.
    const doorRows = async () => onToday
      ? ((await J('/api/bkk/admin/today', { headers: ADMIN })).body.bookings || []).filter(b => b.slot_id === doorSlot)
      : (await pool.query(`SELECT m.name, b.checked_in_at, b.cover, b.source,
           coalesce(pr.kind = 'credits' AND pr.credits = 1, false) AS dropin
         FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id
         LEFT JOIN bkk_passes p ON p.id=b.pass_id LEFT JOIN bkk_products pr ON pr.id=p.product_id
         WHERE b.slot_id=$1 AND b.status='booked'`, [doorSlot])).rows;

    if (onToday) {
      ok("the door lists today's class with nobody booked", dcl(today0) && dcl(today0).booked === 0 && dcl(today0).capacity === 3,
         JSON.stringify(today0.body.classes));
    } else {
      ok('moon day today: the door lists no class', today0.body.classes.length === 0);
      skipped("the door lists today's class with nobody booked");
    }
    ok('...and still gives bookings and money as before', Array.isArray(today0.body.bookings) && Array.isArray(today0.body.money));
    ok('adding someone at the door needs the staff key', (await walk({ name: 'No Key', cover: 'rezerv' }, {})).status === 401);
    ok('...and a cover', (await walk({ name: 'No Cover' })).status === 400);

    const rz = await walk({ name: 'Rezerv Walker', cover: 'rezerv' });
    ok('a Rezerv student is put on the list, no pass needed', rz.status === 200 && rz.body.success && rz.body.cover === 'rezerv'
       && rz.body.className === 'Door Test' && rz.body.overCapacity === false, JSON.stringify(rz.body));
    const np = await walk({ memberCode: pack.body.member.code, cover: 'pass' });
    ok("'aybkk.net pass' with no usable pass is refused, pointing to Rezerv or Drop-in",
       np.status === 409 && /Rezerv/.test(np.body.error) && /Drop-in/.test(np.body.error), JSON.stringify(np.body));
    const holder = (await post('/api/bkk/admin/passes', { name: 'Pass Walker', email: 'pass.walker@example.com', productCode: 'pack10' }, ADMIN)).body.member.code;
    const pw = await walk({ memberCode: holder, cover: 'pass' });
    ok('a student with an aybkk.net pass is put on the list on it', pw.status === 200 && pw.body.cover === 'pass', JSON.stringify(pw.body));
    ok('...using one credit', (await J('/api/bkk/me/' + holder)).body.passes[0].creditsLeft === 9);

    // Booked ahead (staff may book a class that has begun), not in yet.
    const ahead = (await post('/api/bkk/admin/passes', { name: 'Booked Ahead', email: 'booked.ahead@example.com', productCode: 'pack10' }, ADMIN)).body.member.code;
    const aheadBk = await post('/api/bkk/bookings', { memberCode: ahead, slotId: doorSlot, date: doorDate }, ADMIN);
    const aw = await walk({ memberCode: ahead, cover: 'pass' });
    const aheadRows = (await pool.query(`SELECT count(*)::int AS n, bool_and(checked_in_at IS NOT NULL) AS inn FROM bkk_bookings
      WHERE slot_id=$1 AND member_id=(SELECT id FROM bkk_members WHERE code=$2)`, [doorSlot, ahead])).rows[0];
    ok('someone already booked is just checked in: no second row, no second credit',
       aheadBk.status === 200 && aw.status === 200 && aw.body.already === true && aheadRows.n === 1 && aheadRows.inn
         && (await J('/api/bkk/me/' + ahead)).body.passes[0].creditsLeft === 9, JSON.stringify({ aheadBk: aheadBk.body, aw: aw.body, aheadRows }));
    ok('...and asking again changes nothing', (await walk({ memberCode: ahead, cover: 'rezerv' })).body.already === true);
    // Who has paid for what at the door, by member.
    const held = async code => (await pool.query(
      `SELECT (SELECT count(*)::int FROM bkk_orders o WHERE o.member_id=m.id) AS orders,
              (SELECT count(*)::int FROM bkk_passes p WHERE p.member_id=m.id) AS passes,
              (SELECT count(*)::int FROM bkk_bookings b WHERE b.member_id=m.id AND b.slot_id=$2 AND b.status='booked') AS seats
       FROM bkk_members m WHERE m.code=$1`, [code, doorSlot])).rows[0];
    const aheadCash = await walk({ memberCode: ahead, cover: 'dropin', method: 'cash' });
    const aheadHeld = await held(ahead);
    ok('...and a drop-in for them sells nothing: no order, no second pass, and the reply says so',
       aheadCash.status === 200 && aheadCash.body.already === true && !aheadCash.body.refno
         && aheadHeld.orders === 0 && aheadHeld.passes === 1 && aheadHeld.seats === 1, JSON.stringify({ body: aheadCash.body, aheadHeld }));

    ok('a drop-in at the door needs how it was paid', (await walk({ name: 'No Method', cover: 'dropin' })).status === 400);
    const cash0 = ((today0.body.money || []).find(m => m.method === 'cash') || {}).total || 0;
    const dw = await walk({ name: 'Cash Walker', email: 'cash.walker@example.com', cover: 'dropin', method: 'cash' });
    ok('a full class still takes the person at the door, and says it is over capacity',
       dw.status === 200 && dw.body.cover === 'dropin' && dw.body.overCapacity === true && /^\d+$/.test(dw.body.refno || ''), JSON.stringify(dw.body));

    const t1 = await J('/api/bkk/admin/today', { headers: ADMIN });
    const mine = await doorRows();
    const row = n => mine.find(b => b.name === n) || {};
    ok("pass, Rezerv and drop-in walk-ins are all on the class list, checked in",
       ['Rezerv Walker', 'Pass Walker', 'Cash Walker'].every(n => row(n).checked_in_at), JSON.stringify(mine));
    ok('...with what the door needs to label them', row('Rezerv Walker').cover === 'rezerv' && row('Rezerv Walker').source === 'door'
       && row('Cash Walker').dropin === true && row('Pass Walker').dropin === false && row('Booked Ahead').source === 'staff', JSON.stringify(mine));
    if (onToday) ok('...and every one counts toward the class', dcl(t1).booked === 4 && dcl(t1).checkedIn === 4 && dcl(t1).capacity === 3, JSON.stringify(dcl(t1)));
    else ok('...and every one counts toward the class', (await J(`/api/bkk/admin/class?slotId=${doorSlot}&date=${doorDate}`,
       { headers: ADMIN })).body.class.booked === 4 && mine.length === 4 && mine.every(b => b.checked_in_at));
    ok("the door's drop-in is a real sale: in today's money with VAT", (((t1.body.money || []).find(m => m.method === 'cash') || {}).total || 0) === cash0 + 1605,
       JSON.stringify(t1.body.money));
    await settle();
    const dwr = receiptTo('cash.walker@example.com');
    ok('...with a receipt that names the class', dwr && dwr.text.includes('booked into Door Test'), dwr && dwr.text.slice(0, 200));

    const ds = await post('/api/bkk/admin/sales', { productCode: 'dropin', name: 'Desk Booker', method: 'card', slotId: doorSlot, checkIn: true, ...onDay }, ADMIN);
    const mine2 = await doorRows();
    ok('a desk sale for a class books it: the buyer is on the class list, checked in',
       ds.status === 200 && ds.body.booking && ds.body.booking.title === 'Door Test'
         && mine2.some(b => b.name === 'Desk Booker' && b.checked_in_at) && mine2.length === 5, JSON.stringify(ds.body));
    if (onToday) ok("...and in admin/today's count", dcl(await J('/api/bkk/admin/today', { headers: ADMIN })).booked === 5);
    else skipped("...and in admin/today's count");

    // Two staff phones (or a tap while the first is still on its way) add the
    // same person with a drop-in at the same moment: one sale, one seat.
    const racers = [];
    for (let i = 0; i < 3; i++) racers.push((await pool.query(
      `INSERT INTO bkk_members (code,name) VALUES ($1,$2) RETURNING code`, [`BTESTRACER${i}`, `Door Racer ${i}`])).rows[0].code);
    const rounds = await Promise.all(racers.map(c => Promise.all([1, 2].map(() => walk({ memberCode: c, cover: 'dropin', method: 'cash' })))));
    const racerHeld = await Promise.all(racers.map(held));
    ok('two phones adding the same person with a drop-in at once: one sale, one pass, one seat',
       racerHeld.every(x => x.orders === 1 && x.passes === 1 && x.seats === 1)
         && rounds.every(two => two.every(r => r.status === 200) && two.filter(r => r.body.refno).length === 1),
       JSON.stringify({ racerHeld, rounds: rounds.map(two => two.map(r => r.body)) }));
    ok('...and the reply that sold nothing says they were already on the list',
       rounds.every(two => two.some(r => r.body.already === true && !r.body.refno)));

    // The reply is lost on bad wifi and staff tap Add again: the same requestId
    // comes back, and the first add is answered instead of done twice.
    const lost = { name: 'Anna NoMail', cover: 'dropin', method: 'cash', requestId: 'test-walkin-lost-reply' };
    const lost1 = await walk(lost), lost2 = await walk(lost);
    const annas = (await pool.query(`SELECT code FROM bkk_members WHERE name='Anna NoMail'`)).rows;
    const annaHeld = annas.length === 1 ? await held(annas[0].code) : {};
    ok('tapping Add again after a lost reply adds no one twice: one profile, one sale, one seat',
       lost1.status === 200 && lost2.status === 200 && annas.length === 1
         && annaHeld.orders === 1 && annaHeld.seats === 1, JSON.stringify({ lost1: lost1.body, lost2: lost2.body, annas, annaHeld }));
    ok('...and the second reply is the first one again, sale and all',
       lost2.body.repeat === true && lost2.body.already === false && lost2.body.refno === lost1.body.refno
         && lost2.body.cover === 'dropin' && lost2.body.name === 'Anna NoMail', JSON.stringify(lost2.body));
    const rzAgain = { name: 'Rezerv Again', cover: 'rezerv', requestId: 'test-walkin-rezerv-again' };
    await walk(rzAgain);
    const rzAgain2 = await walk(rzAgain);
    ok('...a Rezerv add too', rzAgain2.status === 200 && rzAgain2.body.repeat === true && rzAgain2.body.cover === 'rezerv'
       && (await pool.query(`SELECT count(*)::int AS n FROM bkk_members WHERE name='Rezerv Again'`)).rows[0].n === 1, JSON.stringify(rzAgain2.body));
    const atOnce = { name: 'Cy NoMail', cover: 'dropin', method: 'card', requestId: 'test-walkin-at-once' };
    const cy = await Promise.all([walk(atOnce), walk(atOnce)]);
    const cyHeld = (await pool.query(
      `SELECT (SELECT count(*)::int FROM bkk_orders o JOIN bkk_members m ON m.id=o.member_id WHERE m.name='Cy NoMail') AS orders,
              (SELECT count(*)::int FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id
                WHERE m.name='Cy NoMail' AND b.slot_id=$1 AND b.status='booked') AS seats`, [doorSlot])).rows[0];
    ok('...even when both taps arrive at once', cy.every(r => r.status === 200 && r.body.refno === cy[0].body.refno)
       && cyHeld.orders === 1 && cyHeld.seats === 1, JSON.stringify({ cy: cy.map(r => r.body), cyHeld }));

    // The last working day before today: any class on it has ended.
    let past = new Date(Date.parse(todayB + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
    while (moonDaysBetween(past, past).size) past = new Date(Date.parse(past + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
    const doneSlot = await mkSlot('test_door_done', wdOf(past), '06:00', 60, 10);
    const late = await post('/api/bkk/admin/walkin', { slotId: doneSlot, date: past, name: 'Late Walker', cover: 'rezerv' }, ADMIN);
    const lateProfiles = (await pool.query(`SELECT count(*)::int AS n FROM bkk_members WHERE name='Late Walker'`)).rows[0].n;
    ok('a walk-in after the class has ended is refused, and leaves no profile behind',
       late.status === 409 && /ended/.test(late.body.error) && lateProfiles === 0, JSON.stringify(late.body));
    const lateCash = await post('/api/bkk/admin/walkin', { slotId: doneSlot, date: past, name: 'Late Cash', cover: 'dropin', method: 'cash' }, ADMIN);
    const lateOrders = (await pool.query(`SELECT count(*)::int AS n FROM bkk_orders o JOIN bkk_members m ON m.id=o.member_id WHERE m.name='Late Cash'`)).rows[0].n;
    ok('...and no drop-in is sold for it', lateCash.status === 409 && lateOrders === 0, JSON.stringify(lateCash.body));

    const twice = (await post('/api/bkk/admin/passes', { name: 'Twice Booker', email: 'twice.booker@example.com', productCode: 'pack10' }, ADMIN)).body.member.code;
    const tw1 = await post('/api/bkk/bookings', { memberCode: twice, slotId: dc.slotId, date: dc.date });
    const tw2 = await post('/api/bkk/bookings', { memberCode: twice, slotId: dc.slotId, date: dc.date });
    ok('a student booking a class twice is still told "you already booked this class"',
       tw1.status === 200 && tw1.body.booking.source === 'student' && tw1.body.booking.cover === 'pass'
         && tw2.status === 409 && tw2.body.error === 'you already booked this class', JSON.stringify([tw1.body, tw2.body]).slice(0, 300));
    // Each weekday is its own slot with its own capacity and cancellations, so
    // one day's slot sent with another day's date would get past both.
    const otherDay = await post('/api/bkk/bookings', { memberCode: twice, slotId: dc.slotId, date: wrongDay });
    ok("a student cannot book one weekday's class on another day", otherDay.status === 409
       && otherDay.body.error === 'that class is not on that day', JSON.stringify(otherDay.body));
    ok('...and keeps the credit', (await J('/api/bkk/me/' + twice)).body.passes[0].creditsLeft === 9);
  }

  console.log('\n— keep all history: the Rezerv import —');
  {
    const { outbox } = require('../mailer');
    const imp = (kind, rows, extra = {}, h = ADMIN) => post(`/api/bkk/admin/import/${kind}`, { rows, dryRun: false, ...extra }, h);
    const dry = (kind, rows, extra = {}) => post(`/api/bkk/admin/import/${kind}`, { rows, dryRun: true, ...extra }, ADMIN);
    // fetch's text() drops a BOM, so the bytes are read as they came.
    const raw = async (path, opts) => {
      const r = await fetch(B + path, opts);
      const buf = Buffer.from(await r.arrayBuffer());
      return { status: r.status, text: buf.toString('utf8'), bom: buf.subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF])), headers: r.headers };
    };
    const one = async (sql, args = []) => (await pool.query(sql, args)).rows[0] || {};
    const sizes = async () => (await Promise.all(['bkk_members', 'bkk_bookings', 'bkk_orders', 'bkk_passes']
      .map(t => one(`SELECT count(*)::int AS n FROM ${t}`)))).map(r => r.n).join();
    const settle = () => new Promise(r => setTimeout(r, 300));
    const bkkMs = ms => new Date(ms + 7 * 3600000).toISOString();
    const todayB = bkkMs(Date.now()).slice(0, 10);
    const addD = (d, k) => new Date(Date.parse(d + 'T12:00:00Z') + k * 86400000).toISOString().slice(0, 10);
    const isMoon = d => moonDaysBetween(d, d).size > 0;
    const codeOf = async rz => (await one('SELECT code FROM bkk_members WHERE rezerv_id=$1', [rz])).code;

    ok('every import needs the staff key', (await imp('members', [], {}, {})).status === 401);
    ok('an unknown kind is refused', (await imp('cats', [])).status === 404);
    ok('more than 1000 rows in one call is refused',
       (await imp('members', Array.from({ length: 1001 }, () => ({ name: 'Too Many' })))).status === 400);
    ok('no dryRun:false means only a look', (await post('/api/bkk/admin/import/members', { rows: [] }, ADMIN)).body.dryRun === true);

    // ── students ──
    const people = [
      { rezervId: 'RZ-1001', name: 'Ploy Testimport', email: 'Ploy.Testimport@example.com', phone: '081-234-5678', joinedOn: '12/11/2569',
        dateOfBirth: '1990-01-01', address: '99 Moo 9 Test Road', passport: 'AA1234567', cardNumber: '4111 1111 1111 1111' },
      { rezervId: 'RZ-1002', name: 'Niran Testimport', phone: '+66 89 765 4321', joinedOn: '12 Nov 2026' },
      { rezervId: 'RZ-1003', name: 'Same Name', email: 'same.one@example.com', joinedOn: '2026-11-12' },
      { rezervId: 'RZ-1004', name: 'Same Name', email: 'same.two@example.com', joinedOn: '12-Nov-2026' },
      { rezervId: 'RZ-1005', name: 'Date Shapes', joinedOn: '12/11/26' },
      { rezervId: 'RZ-1006', name: 'Thai Month', joinedOn: '12 พ.ย. 2569 05:30 น.' },
      { email: 'no.name@example.com' },
    ];
    const s0 = await sizes();
    const d1 = await dry('members', people);
    ok('a dry run of students says what the import would do', d1.status === 200 && d1.body.dryRun === true && d1.body.total === 7
       && d1.body.added === 6 && d1.body.skipped.length === 1 && d1.body.skipped[0].row === 7, JSON.stringify(d1.body));
    ok('...and writes nothing', (await sizes()) === s0);
    const r1 = await imp('members', people);
    ok('the real run does exactly what the dry run said', r1.status === 200 && r1.body.dryRun === false && r1.body.added === 6
       && r1.body.skipped.length === 1, JSON.stringify(r1.body));
    const ploy = await one(`SELECT m.*, row_to_json(m)::text AS j, to_char(joined_on,'YYYY-MM-DD') AS joined FROM bkk_members m WHERE rezerv_id='RZ-1001'`);
    ok('a student keeps name, email (lower case), phone, joined date, Rezerv id and source', ploy.name === 'Ploy Testimport'
       && ploy.email === 'ploy.testimport@example.com' && ploy.phone === '081-234-5678' && ploy.joined === '2026-11-12' && ploy.source === 'rezerv',
       JSON.stringify(ploy));
    ok('...and nothing we do not keep: no birthday, address, passport or card number', !/1990-01-01|Test Road|AA1234567|4111/.test(ploy.j), ploy.j);
    const joined = (await pool.query(`SELECT to_char(joined_on,'YYYY-MM-DD') AS d FROM bkk_members
      WHERE rezerv_id LIKE 'RZ-100%' ORDER BY rezerv_id`)).rows.map(r => r.d);
    ok('every date shape is read: ISO, dd/mm/yyyy, dd/mm/yy, 12 Nov 2026, 12-Nov-2026, Buddhist years, Thai months',
       joined.length === 6 && joined.every(d => d === '2026-11-12'), JSON.stringify(joined));
    const r2 = await imp('members', people);
    ok('importing the same students again adds nobody twice', r2.body.added === 0 && r2.body.matched === 6 && r2.body.updated === 0,
       JSON.stringify(r2.body));
    const fill = await imp('members', [
      { rezervId: 'RZ-1002', name: 'Niran Testimport', email: 'niran.testimport@example.com' },
      { rezervId: 'RZ-1001', name: 'Ploy Testimport', email: 'someone.else@example.com' },
    ]);
    ok('a found student gets a missing email filled in', fill.body.updated === 1
       && (await one(`SELECT email FROM bkk_members WHERE rezerv_id='RZ-1002'`)).email === 'niran.testimport@example.com', JSON.stringify(fill.body));
    ok('...but a different email is never overwritten: a warning says so', fill.body.matched === 1
       && (await one(`SELECT email FROM bkk_members WHERE rezerv_id='RZ-1001'`)).email === 'ploy.testimport@example.com'
       && fill.body.warnings.some(w => w.row === 2 && /someone\.else@example\.com/.test(w.message)), JSON.stringify(fill.body));
    const ployCode = ploy.code, niranCode = await codeOf('RZ-1002');

    // ── visits ──
    await post('/api/bkk/admin/passes', { memberCode: niranCode, productCode: 'pack10' }, ADMIN);
    // Held for a month: a pass bought today is a new student, not one who stopped coming.
    await pool.query(`UPDATE bkk_passes SET created_at = now() - interval '30 days'
      WHERE member_id=(SELECT id FROM bkk_members WHERE code=$1)`, [niranCode]);
    const sched = async () => (await J('/api/bkk/schedule?days=14')).body.classes;
    const fut = (await sched()).find(c => !c.isOnline && c.kind !== 'test' && c.seatsLeft > 0 && c.date > todayB);
    const seatsOf = async () => ((await sched()).find(c => c.slotId === fut.slotId && c.date === fut.date) || {}).booked;
    let far = addD(todayB, 20);
    while (isMoon(far)) far = addD(far, 1);
    const vis = [
      { rezervId: 'V-1', memberRezervId: 'RZ-1001', name: 'Wrong Name On Purpose', date: '06/10/2026', time: '5:30 AM', className: 'Mysore (1st batch)', status: 'Attended' },
      { rezervId: 'V-2', email: 'PLOY.TESTIMPORT@example.com', date: '2569-10-07 05:30:00', className: 'Mysore', status: 'เข้าเรียน' },
      { rezervId: 'V-3', phone: '66-81-234-5678', date: '8 Oct 2026', time: '05:30', status: 'no-show' },
      { rezervId: 'V-4', name: '  date   SHAPES ', date: '13 ต.ค. 2569', time: '18:00', className: 'Evening Yin', status: 'Checked in' },
      { rezervId: 'V-5', memberRezervId: 'RZ-1001', date: '2026-10-09', time: '05:30', status: 'Late cancel' },
      { rezervId: 'V-6', name: 'Same Name', date: '2026-10-09', time: '05:30', status: 'attended' },
      { rezervId: 'V-7', name: 'Brand New Visitor', date: '2026-10-09', time: '07:30', status: 'attended' },
      { rezervId: 'V-8', memberRezervId: 'RZ-1001', date: 'someday', status: 'attended' },
      { rezervId: 'V-9', memberRezervId: 'RZ-1001', date: far, time: '23:45', status: 'booked' },
      { rezervId: 'V-10', memberRezervId: 'RZ-1002', date: fut.date, time: fut.startAt.slice(11, 16), className: fut.title, status: 'Booked' },
      { rezervId: 'V-11', memberRezervId: 'RZ-1005', date: '14/10/2026', time: '07:30', status: 'booked' },
      { rezervId: 'V-12', memberRezervId: 'RZ-1006', date: '2026-10-15', time: '05:30', status: 'maybe later' },
    ];
    const seats0 = await seatsOf();
    const sv = await sizes();
    const dv = await dry('visits', vis, { firstRow: 2 });
    ok('a dry run of visits writes nothing, not even the new student', (await sizes()) === sv && (await seatsOf()) === seats0);
    const rv = await imp('visits', vis, { firstRow: 2 });
    ok('visits: the real run matches the dry run', rv.status === 200 && rv.body.added === 8 && rv.body.skipped.length === 4 && rv.body.newMembers === 1
       && dv.body.added === rv.body.added && JSON.stringify(dv.body.skipped) === JSON.stringify(rv.body.skipped), JSON.stringify([dv.body, rv.body]));
    const vrow = async ref => one(`SELECT b.*, m.rezerv_id AS mrz, m.name AS mname, m.source AS msource, s.code AS scode,
        to_char(b.class_date,'YYYY-MM-DD') AS d FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id
        LEFT JOIN bkk_class_slots s ON s.id=b.slot_id WHERE b.source='rezerv' AND b.source_ref=$1`, [ref]);
    const [v1, v2, v3, v4, v5, v7, v10, v11] = await Promise.all(['V-1', 'V-2', 'V-3', 'V-4', 'V-5', 'V-7', 'V-10', 'V-11'].map(vrow));
    ok('the student is found by Rezerv id first (even with another name on the row)', v1.mrz === 'RZ-1001', JSON.stringify(v1));
    ok('...then by email', v2.mrz === 'RZ-1001');
    ok('...then by phone, the last 9 digits (66-81… is 081…)', v3.mrz === 'RZ-1001');
    ok('...then by exact name, case and spaces aside', v4.mname === 'Date Shapes');
    ok('two students with the same name: the row is skipped with the reason',
       rv.body.skipped.some(s => s.row === 7 && /2 students named Same Name: add email or phone/.test(s.reason)), JSON.stringify(rv.body.skipped));
    ok('an attended visit is on its slot by weekday and time, checked in at the class start (05:30 Bangkok)',
       v1.scode === 'my530_2' && v1.status === 'booked' && v1.checked_in_at && v1.checked_in_at.toISOString() === '2026-10-05T22:30:00.000Z'
       && v1.cover === 'rezerv', JSON.stringify(v1));
    ok('Thai status words and Buddhist dates with seconds read right', v2.scode === 'my530_3' && !!v2.checked_in_at && v2.d === '2026-10-07');
    ok('a no-show and a late cancel keep what happened', v3.status === 'noshow' && !v3.checked_in_at
       && v5.status === 'cancelled' && /late/.test(v5.cancel_reason), JSON.stringify([v3.status, v5.status, v5.cancel_reason]));
    ok('a past class that matches no slot keeps its own title', v4.slot_id === null && v4.class_title === 'Evening Yin'
       && v4.d === '2026-10-13' && !!v4.checked_in_at, JSON.stringify(v4));
    ok('a name nobody has makes a new student, and the import says so', v7.mname === 'Brand New Visitor' && v7.msource === 'rezerv'
       && rv.body.warnings.some(w => w.row === 8 && /new student: Brand New Visitor/.test(w.message)), JSON.stringify(rv.body.warnings));
    ok('unreadable dates and statuses are skipped with the reason', rv.body.skipped.some(s => s.row === 9 && /date/.test(s.reason))
       && rv.body.skipped.some(s => s.row === 13 && /status/.test(s.reason)), JSON.stringify(rv.body.skipped));
    ok('a booking still to come that matches no class is skipped', rv.body.skipped.some(s => s.row === 10 && /timetable/.test(s.reason)));
    ok('a booking still to come takes a real seat: one more on the timetable', (await seatsOf()) === seats0 + 1 && v10.slot_id === fut.slotId
       && v10.status === 'booked' && v10.source === 'rezerv' && v10.cover === 'rezerv', `${seats0} -> ${await seatsOf()}`);
    const niranMe = (await J('/api/bkk/me/' + niranCode)).body;
    ok("...it is on the student's own list, and no pass credit moved",
       niranMe.bookings.some(b => b.source === 'rezerv' && b.pass_id === null) && niranMe.passes.find(p => p.kind === 'credits').creditsLeft === 10,
       JSON.stringify(niranMe).slice(0, 300));
    ok('a past booking with no attendance stays booked, and the import says how many',
       v11.status === 'booked' && !v11.checked_in_at && rv.body.warnings.some(w => w.row === null && /^1 past visits say booked/.test(w.message)));
    const rv2 = await imp('visits', vis, { firstRow: 2 });
    ok('importing the same visits again adds nothing twice', rv2.body.added === 0 && rv2.body.matched === 8 && rv2.body.newMembers === 0
       && (await seatsOf()) === seats0 + 1, JSON.stringify(rv2.body));
    const pba = await imp('visits', [vis[10]], { pastBookedAttended: true });
    ok('importing again with past bookings counted as attended checks them in', pba.body.updated === 1 && !!(await vrow('V-11')).checked_in_at,
       JSON.stringify(pba.body));
    const gone = await imp('visits', [{ ...vis[9], status: 'Cancelled' }]);
    ok('a booking cancelled in Rezerv since: importing again frees the seat', gone.body.updated === 1 && (await seatsOf()) === seats0
       && (await vrow('V-10')).status === 'cancelled', JSON.stringify(gone.body));

    // A booking today goes on the door's list.
    const wdT = new Date(todayB + 'T12:00:00Z').getUTCDay();
    const tSlot = (await one(`INSERT INTO bkk_class_slots (code,title,kind,weekday,start_time,duration_min,capacity)
      VALUES ('test_hist_today','History Today','test',$1,'23:58',60,5) RETURNING id`, [wdT])).id;
    const vt = await imp('visits', [{ rezervId: 'V-13', memberRezervId: 'RZ-1003', date: todayB, time: '23:58', className: 'History Today', status: 'booked' }]);
    if (isMoon(todayB)) {
      ok('moon day today: a booking for today is skipped', vt.body.skipped.length === 1 && /moon day/.test(vt.body.skipped[0].reason));
      console.log('  - SKIPPED (moon day today): an imported booking today shows at the door');
    } else {
      const td = (await J('/api/bkk/admin/today', { headers: ADMIN })).body;
      ok("an imported booking for today is on the door's list, as a Rezerv seat", vt.body.added === 1
         && td.bookings.some(b => b.slot_id === tSlot && b.name === 'Same Name' && b.cover === 'rezerv' && b.source === 'rezerv')
         && (td.classes.find(c => c.slotId === tSlot) || {}).booked === 1, JSON.stringify([vt.body, td.classes.find(c => c.slotId === tSlot)]));
      if (new Date(`${todayB}T23:58:00+07:00`) > new Date()) {
        ok('...and counts in the timetable', ((await J('/api/bkk/schedule?days=1')).body.classes.find(c => c.slotId === tSlot) || {}).booked === 1);
      }
    }

    // ── payments ──
    const receipts = () => outbox.filter(m => m.tag === 'receipt').length;
    const cashToday = async () => ((((await J('/api/bkk/admin/today', { headers: ADMIN })).body.money || []).find(m => m.method === 'cash')) || {}).total || 0;
    const xferToday = async () => ((((await J('/api/bkk/admin/today', { headers: ADMIN })).body.money || []).find(m => m.method === 'transfer')) || {}).total || 0;
    const pays = [
      { rezervId: 'P-1', memberRezervId: 'RZ-1001', date: '15/10/2026 23:30', amount: '9,600.00', vat: '628', item: '1 Month Unlimited',
        method: 'Bank transfer', note: 'card 4111 1111 1111 1111 on file' },
      { rezervId: 'P-2', memberRezervId: 'RZ-1001', date: '16/10/2026', amount: '฿1,500', item: 'Drop-in', method: 'เงินสด' },
      { memberRezervId: 'RZ-1002', date: '2026-10-16 00:15', amount: 14000, item: 'Rezerv Promo Pack', method: 'Visa' },
      { memberRezervId: 'RZ-1002', date: 'never', amount: 100 },
      { memberRezervId: 'RZ-1002', date: '2026-10-16', amount: 'free' },
      { rezervId: 'P-6', memberRezervId: 'RZ-1005', date: '2026-10-20', amount: 100, item: '=cmd|" /c calc"!A1', method: 'cash' },
      { rezervId: 'P-7', memberRezervId: 'RZ-1005', date: `${todayB} 00:01`, amount: 500, item: 'Mat rental', method: 'cash' },
      { rezervId: 'P-8', memberRezervId: 'RZ-1001', date: '2026-10-16', amount: '-1,500', item: 'Drop-in refund', method: 'transfer' },
    ];
    const [cash0, xfer0, rc0, sp] = [await cashToday(), await xferToday(), receipts(), await sizes()];
    const dp = await dry('payments', pays);
    ok('a dry run of payments writes nothing', (await sizes()) === sp && dp.body.added === 6 && dp.body.skipped.length === 2, JSON.stringify(dp.body));
    const rp = await imp('payments', pays);
    ok('payments: 6 added, the unreadable date and amount skipped', rp.body.added === 6 && rp.body.skipped.length === 2
       && rp.body.skipped.some(s => /amount/.test(s.reason)) && rp.body.skipped.some(s => /date/.test(s.reason)), JSON.stringify(rp.body));
    const prow = async ref => one(`SELECT o.*, pr.code AS pcode FROM bkk_orders o LEFT JOIN bkk_products pr ON pr.id=o.product_id
      WHERE o.source='rezerv' AND o.source_ref LIKE $1`, [ref]);
    const p1 = await prow('P-1'), p2 = await prow('P-2'), ph = await prow('h:%'), p8 = await prow('P-8');
    ok('an imported payment is a paid order on the day it was paid (23:30 Bangkok), with its VAT, method and package',
       p1.status === 'paid' && p1.amount_thb === 9600 && p1.vat_thb === 628 && p1.base_thb === 8972 && p1.fee_thb === 0
       && p1.method === 'transfer' && p1.pcode === 'unlim1' && p1.item_name === '1 Month Unlimited'
       && p1.verified_at.toISOString() === '2026-10-15T16:30:00.000Z' && p1.created_at.toISOString() === p1.verified_at.toISOString(),
       JSON.stringify(p1));
    ok('...the raw method is kept, and a card number in a note is not', /Bank transfer/.test(p1.gateway_note) && !/4111/.test(p1.gateway_note),
       p1.gateway_note);
    ok('Thai "cash" is cash, Visa is card, and an item not in the catalogue keeps its own name',
       p2.method === 'cash' && p2.pcode === 'dropin' && ph.method === 'card' && ph.product_id === null && ph.item_name === 'Rezerv Promo Pack');
    ok('a refund is kept as money going back', p8.status === 'refund' && p8.amount_thb === -1500, JSON.stringify(p8));
    ok('no pass is made for an imported payment',
       (await one(`SELECT count(*)::int AS n FROM bkk_passes p JOIN bkk_orders o ON o.id=p.order_id WHERE o.source='rezerv'`)).n === 0);
    await settle();
    ok('...and no receipt is mailed', receipts() === rc0, `${rc0} -> ${receipts()}`);
    ok("an old payment is not in today's money; one dated today is", (await cashToday()) === cash0 + 500 && (await xferToday()) === xfer0,
       `${cash0} -> ${await cashToday()}`);
    const rp2 = await imp('payments', pays);
    ok('importing the same payments again adds nothing twice', rp2.body.added === 0 && rp2.body.matched === 6, JSON.stringify(rp2.body));
    ok('a Rezerv payment cannot be activated', (await post(`/api/bkk/admin/orders/${p8.id}/force-activate`, {}, ADMIN)).status === 409);

    // ── passes ──
    const pp = [
      { memberRezervId: 'RZ-1002', plan: '3 months', start: '01/10/2026', until: '31/12/2026' },
      { name: 'Pass Only Person (renewed)', email: 'pass.only@example.com', plan: '10 class pack', until: '12 Dec 2026', classesLeft: 4 },
      { memberRezervId: 'RZ-1002', plan: 'forever', until: '2026-12-31' },
      { memberRezervId: 'RZ-1002', plan: '1 month', start: '2026-12-01', until: '2026-11-01' },
    ];
    const sps = await sizes();
    const dps = await dry('passes', pp);
    ok('a dry run of passes writes nothing', (await sizes()) === sps && dps.body.added === 2 && dps.body.skipped.length === 2, JSON.stringify(dps.body));
    const rps = await imp('passes', pp);
    const nPass = await one(`SELECT p.*, pr.code, to_char(valid_from,'YYYY-MM-DD') AS f, to_char(valid_until,'YYYY-MM-DD') AS u
      FROM bkk_passes p JOIN bkk_products pr ON pr.id=p.product_id JOIN bkk_members m ON m.id=p.member_id
      WHERE m.rezerv_id='RZ-1002' AND p.source='rezerv'`);
    ok('a Rezerv pass keeps its start and end dates', rps.body.added === 2 && nPass.code === 'unlim3' && nPass.f === '2026-10-01' && nPass.u === '2026-12-31',
       JSON.stringify([rps.body, nPass]));
    const only = await one(`SELECT m.name, m.email, p.credits_total - p.credits_used AS left FROM bkk_passes p JOIN bkk_members m ON m.id=p.member_id
      WHERE m.email='pass.only@example.com'`);
    ok('...a new student comes with it, with the classes left', only.name === 'Pass Only Person' && only.left === 4 && rps.body.newMembers === 1,
       JSON.stringify(only));
    ok('importing the same passes again adds nothing twice', (await imp('passes', pp)).body.matched === 2);

    // ── one student, everything: native and imported together ──
    const sale = await post('/api/bkk/admin/sales', { productCode: 'unlim1', name: 'Ploy Testimport', email: 'ploy.testimport@example.com', method: 'card' }, ADMIN);
    ok('a desk sale finds the imported student by email', sale.status === 200 && sale.body.member.code === ployCode);
    let doorDate = todayB;                        // a moon day: the last working day, as at the door above
    while (isMoon(doorDate)) doorDate = addD(doorDate, -1);
    const onToday = doorDate === todayB;
    const startNow = !onToday ? '06:00'
      : bkkMs(Date.now() - 60000).slice(0, 10) === todayB ? bkkMs(Date.now() - 60000).slice(11, 16) : '00:00';
    const hMin = onToday ? 180 : Math.ceil((Date.now() - Date.parse(`${doorDate}T06:00:00+07:00`)) / 60000) + 180;
    const hSlot = (await one(`INSERT INTO bkk_class_slots (code,title,kind,weekday,start_time,duration_min,capacity)
      VALUES ('test_hist_now','History Walk-in','test',$1,$2,$3,10) RETURNING id`, [new Date(doorDate + 'T12:00:00Z').getUTCDay(), startNow, hMin])).id;
    const walked = await post('/api/bkk/admin/walkin', { slotId: hSlot, ...(onToday ? {} : { date: doorDate }), memberCode: ployCode, cover: 'pass' }, ADMIN);
    ok('...and the door checks her in on her new pass', walked.status === 200, JSON.stringify(walked.body));
    await post('/api/bkk/teacher/notes', { memberCode: ployCode, body: 'Team only: watch the left knee', shareWithStudent: false }, PKEY);

    ok('history needs the staff key', (await J(`/api/bkk/admin/members/${ployCode}/history`)).status === 401);
    ok('history of an unknown code is a 404', (await J('/api/bkk/admin/members/NOPE/history', { headers: ADMIN })).status === 404);
    const h = (await J(`/api/bkk/admin/members/${ployCode}/history`, { headers: ADMIN })).body;
    ok('history: who they are, from Rezerv', h.member && h.member.joinedOn === '2026-11-12' && h.member.source === 'rezerv'
       && h.member.rezervId === 'RZ-1001' && h.member.phone === '081-234-5678', JSON.stringify(h.member));
    const came = ['2026-10-06', '2026-10-07', doorDate];
    ok('history: the summary counts native and imported visits together', h.summary.visits === 3 && h.summary.noShows === 1
       && h.summary.cancellations === 1 && h.summary.firstVisit === '2026-10-06' && h.summary.lastVisit === doorDate
       && h.summary.visitsLast30 === came.filter(d => d > addD(todayB, -30)).length
       && h.summary.visitsLast90 === came.filter(d => d > addD(todayB, -90)).length, JSON.stringify(h.summary));
    ok('history: money paid, refunds taken off, and the pass in use', h.summary.totalPaid === 9600 + 1500 - 1500 + 10272
       && h.summary.payments === 3 && h.summary.activePass && h.summary.activePass.name === '1 month unlimited', JSON.stringify(h.summary));
    const vDates = h.visits.map(v => v.date);
    ok('history: every visit, newest first, with how each got there', h.visits.length === 5 && vDates.join() === [...vDates].sort().reverse().join()
       && h.visits[0].source === 'door' && h.visits[0].status === 'attended'
       && h.visits.some(v => v.status === 'noshow' && v.source === 'rezerv' && v.class === 'Mysore (1st batch)' && v.time === '05:30'),
       JSON.stringify(h.visits));
    ok('history: every payment, newest first, native and imported', h.payments.length === 4 && h.payments[0].source === 'aybkk'
       && h.payments[0].method === 'card' && h.payments.some(p => p.source === 'rezerv' && p.item === '1 month unlimited'
         && p.amount === 9600 && p.vat === 628 && p.date === '2026-10-15' && p.time === '23:30'), JSON.stringify(h.payments));
    ok('history: passes and every note, the team-only one too, with who wrote it', h.passes.length === 1 && h.passes[0].source === 'order'
       && h.notes.some(n => n.teacher === 'Chay' && n.shared === false && /left knee/.test(n.body)) && h.photos === 0 && Array.isArray(h.checks),
       JSON.stringify([h.passes, h.notes]));

    // ── the student's own profile ──
    const meH = (await J('/api/bkk/me/' + ployCode)).body.history;
    ok("a student's profile counts every class they came to, Rezerv ones too", meH && meH.practised === 3 && meH.recent.length === 3
       && meH.recent[0].date === doorDate && meH.recent.some(r => r.date === '2026-10-06' && r.class === 'Mysore (1st batch)' && r.time === '05:30')
       && meH.thisMonth === came.filter(d => d.slice(0, 7) === todayB.slice(0, 7)).length, JSON.stringify(meH));
    ok('...and the student never sees the team-only note', !JSON.stringify((await J('/api/bkk/me/' + ployCode)).body.notes).includes('left knee'));
    const dsH = (await J('/api/bkk/me/' + await codeOf('RZ-1005'))).body.history;
    ok('...a class with no slot shows under its Rezerv name', dsH.practised === 2 && dsH.recent.some(r => r.class === 'Evening Yin' && r.time === '18:00'),
       JSON.stringify(dsH));
    ok('...and nobody else is counted', (await J('/api/bkk/me/' + await codeOf('RZ-1006'))).body.history.practised === 0);

    // ── reports ──
    const exp = await post('/api/bkk/admin/passes', { name: 'Expiring Testperson', productCode: 'unlim1',
      validFrom: addD(todayB, -20), validUntil: addD(todayB, 7) }, ADMIN);
    const ren = await post('/api/bkk/admin/passes', { name: 'Renewed Testperson', productCode: 'unlim1',
      validFrom: addD(todayB, -25), validUntil: addD(todayB, 5) }, ADMIN);
    await post('/api/bkk/admin/passes', { memberCode: ren.body.member.code, productCode: 'unlim3',
      validFrom: addD(todayB, 6), validUntil: addD(todayB, 95) }, ADMIN);
    ok('the report needs the staff key', (await J('/api/bkk/admin/report?from=2026-10-06&to=2026-10-16')).status === 401);
    ok('the report needs a range of at most 400 days, in order',
       (await J('/api/bkk/admin/report', { headers: ADMIN })).status === 400
       && (await J('/api/bkk/admin/report?from=2025-01-01&to=2026-12-31', { headers: ADMIN })).status === 400
       && (await J('/api/bkk/admin/report?from=2026-10-16&to=2026-10-06', { headers: ADMIN })).status === 400
       && (await J('/api/bkk/admin/report?from=2026-02-30&to=2026-03-06', { headers: ADMIN })).status === 400);
    const rep = await J('/api/bkk/admin/report?from=2026-10-06&to=2026-10-16', { headers: ADMIN });
    const rv_ = rep.body.visits || {}, rm = rep.body.money || {};
    ok('report: visits came, booked, no-shows, cancelled, students, new students', rep.status === 200 && rv_.total === 5 && rv_.booked === 5
       && rv_.noShows === 1 && rv_.cancelled === 1 && rv_.uniqueStudents === 3 && rv_.newStudents === 3, JSON.stringify(rv_));
    const day = d => (rv_.byDay || []).find(x => x.date === d) || {};
    ok('report: a 05:30 class lands on its own Bangkok day', day('2026-10-06').attended === 1 && day('2026-10-05').attended === undefined,
       JSON.stringify(rv_.byDay));
    const cls = (t, tm) => (rv_.byClass || []).find(c => c.title === t && c.time === tm) || {};
    ok('report: by class, with the average per class', cls('Mysore (1st batch)', '05:30').attended === 2 && cls('Mysore (1st batch)', '05:30').avgPerClass === 1
       && cls('Mysore (2nd batch)', '07:30').attended === 2 && cls('Evening Yin', '18:00').attended === 1
       && JSON.stringify(rv_.bySource) === JSON.stringify([{ source: 'rezerv', n: 5 }]), JSON.stringify([rv_.byClass, rv_.bySource]));
    const mday = d => ((rm.byDay || []).find(x => x.date === d) || {}).total;
    ok('report: money total, VAT and count', rm.total === 9600 + 1500 + 14000 - 1500 && rm.vat === 628 && rm.count === 4, JSON.stringify(rm));
    ok('report: a payment at 23:30 and one at 00:15 Bangkok land on the right days', mday('2026-10-15') === 9600 && mday('2026-10-16') === 14000,
       JSON.stringify(rm.byDay));
    const by = (list, k, v) => (list || []).find(x => x[k] === v) || {};
    ok('report: money by method, item and source', by(rm.byMethod, 'method', 'transfer').total === 8100 && by(rm.byMethod, 'method', 'card').total === 14000
       && by(rm.byItem, 'item', '1 month unlimited').total === 9600 && by(rm.byItem, 'item', 'Rezerv Promo Pack').n === 1
       && by(rm.bySource, 'source', 'rezerv').total === 23600, JSON.stringify(rm));
    ok('report: packages sold in the range', rep.body.passes.sold === 2, JSON.stringify(rep.body.passes));
    const expiring = rep.body.passes.expiringNext14.map(x => x.name);
    ok('report: passes ending in 14 days, but not for someone who already renewed',
       expiring.includes('Expiring Testperson') && !expiring.includes('Renewed Testperson')
       && rep.body.passes.expiringNext14.find(x => x.name === 'Expiring Testperson').until === addD(todayB, 7), JSON.stringify(rep.body.passes.expiringNext14));
    const miss = rep.body.notSeen.map(x => x.code);
    ok('report: "not seen for 14 days" lists pass holders who stopped coming, not those who came',
       miss.includes(niranCode) && !miss.includes(ployCode) && rep.body.notSeen.find(x => x.code === niranCode).lastVisit === null,
       JSON.stringify(rep.body.notSeen).slice(0, 300));

    // ── payments list and spreadsheets ──
    const ordR = (await J('/api/bkk/admin/orders?source=rezerv&from=2026-10-15&to=2026-10-16', { headers: ADMIN })).body.orders || [];
    ok('the payments list filters by source and Bangkok days', ordR.length === 4 && ordR.every(o => o.source === 'rezerv')
       && ordR.some(o => o.item === 'Rezerv Promo Pack' && o.name_en === 'Rezerv Promo Pack'), JSON.stringify(ordR.map(o => [o.source, o.item])));
    const ordAll = (await J('/api/bkk/admin/orders', { headers: ADMIN })).body.orders || [];
    ok('...and by default the newest orders still come first, not old Rezerv ones', ordAll[0] && String(ordAll[0].refno) === sale.body.order.refno,
       JSON.stringify(ordAll.slice(0, 2).map(o => [o.refno, o.source, o.created_at])));
    ok('...a bad date is refused', (await J('/api/bkk/admin/orders?from=yesterday', { headers: ADMIN })).status === 400);

    ok('exports need the staff key', (await raw('/api/bkk/admin/export/visits.csv')).status === 401);
    ok('only visits, payments and members can be exported', (await raw('/api/bkk/admin/export/notes.csv', { headers: ADMIN })).status === 404
       && (await raw('/api/bkk/admin/export/visits.csv?from=2026-10-06', { headers: ADMIN })).status === 400);
    const vc = await raw('/api/bkk/admin/export/visits.csv?from=2026-10-06&to=2026-10-16', { headers: ADMIN });
    const vLines = vc.text.trim().split('\r\n');
    ok('visits CSV: a BOM for Excel, one row per visit in the range', vc.status === 200 && vc.bom
       && /text\/csv/.test(vc.headers.get('content-type')) && /attachment/.test(vc.headers.get('content-disposition'))
       && vLines.length === 1 + 7 && vc.text.includes('"Evening Yin"') && vc.text.includes('"noshow"'), vc.text.slice(0, 400));
    const mine = await raw(`/api/bkk/admin/export/visits.csv?member=${ployCode}`, { headers: ADMIN });
    ok("one student's visits as a CSV", mine.text.trim().split('\r\n').length === 1 + 5 && !mine.text.includes('Date Shapes'), mine.text.slice(0, 300));
    const pc = await raw('/api/bkk/admin/export/payments.csv?from=2026-10-16&to=2026-10-20', { headers: ADMIN });
    ok('payments CSV: a formula cannot run, a refund stays a number', pc.text.includes(`"'=cmd|"" /c calc""!A1"`) && pc.text.includes(',-1500,'),
       pc.text.slice(0, 600));
    const mc = await raw('/api/bkk/admin/export/members.csv?from=2026-10-06&to=2026-10-16', { headers: ADMIN });
    ok('members CSV for a range: those who came or paid in it', mc.bom && mc.text.includes('"RZ-1001"')
       && mc.text.includes('"Brand New Visitor"') && mc.text.includes('"Niran Testimport"') && !mc.text.includes('"Thai Month"'), mc.text.slice(0, 400));

    // ── what a second look at the import found (28 Oct) ──
    console.log('\n— keep all history: import edge cases —');
    ok('every skip reason and note carries a code and its values, so the Thai admin page can say it',
       rv.body.skipped.every(s => s.code && Array.isArray(s.vals)) && rv.body.warnings.every(w => w.code)
       && rv.body.skipped.find(s => s.row === 9).vals[0] === 'someday', JSON.stringify(rv.body.skipped));

    // Dates and times as files hold them.
    const t0 = Date.now();
    ok('a long date cell is refused at once, not after minutes of work', parseWhen('1' + ', '.repeat(4000) + 'x') === null
       && Date.now() - t0 < 200, `${Date.now() - t0} ms`);
    const shapes = { '06/10/2026 05:30-07:30': '2026-10-06 05:30', 'Tue 6 Oct 2026, 5:30 AM - 7:30 AM': '2026-10-06 05:30',
      '6 ต.ค. พ.ศ. 2569': '2026-10-06 null', 'วันอังคารที่ 6 ตุลาคม พ.ศ. 2569': '2026-10-06 null' };
    const shapesGot = Object.keys(shapes).map(x => { const w = parseWhen(x); return w && `${w.date} ${w.time}`; });
    ok('a class time given as a range, and Thai dates with the era, are read', JSON.stringify(shapesGot) === JSON.stringify(Object.values(shapes)),
       JSON.stringify(shapesGot));
    const sunSlot = (await one(`INSERT INTO bkk_class_slots (code,title,kind,weekday,start_time,duration_min,capacity,active)
      VALUES ('test_hist_sun','History Sunday','test',0,'09:15',60,5,false) RETURNING id`)).id;
    const edge = await imp('visits', [
      { rezervId: 'V-40', memberRezervId: 'RZ-1005', date: '06/10/2026', time: '05:30 - 07:30', status: 'Attended' },
      { rezervId: 'V-41', memberRezervId: 'RZ-1005', date: '04/10/2026 0:00', className: 'History Sunday', status: 'Attended' },
      { rezervId: 'V-42', memberRezervId: 'RZ-1005', date: 'วันพุธที่ 30 กันยายน พ.ศ. 2569 05:30 - 07:30', status: 'Attended' },
    ]);
    const [v40, v41, v42] = await Promise.all(['V-40', 'V-41', 'V-42'].map(vrow));
    ok('visits: a class time range is its start, and finds the class', edge.body.added === 3 && v40.scode === 'my530_2' && !!v40.checked_in_at,
       JSON.stringify([edge.body, v40]));
    ok('...a date-only cell Excel saved as "0:00" is no time, so the class is found by its name',
       v41.slot_id === sunSlot && v41.start_at.toISOString() === '2026-10-04T02:15:00.000Z', JSON.stringify(v41));
    ok('...and a Thai date with the era and a time range is read', v42.d === '2026-09-30' && !!v42.checked_in_at, JSON.stringify(v42));

    // Statuses that say they did not come.
    const neg = ['Not checked in', 'No check-in', 'Unattended', 'Not completed', 'Incomplete', 'ไม่ได้เช็คอิน', 'ยังไม่เข้าเรียน',
      'Not present', 'Check-in pending'];
    const rn = await imp('visits', neg.map((status, i) => ({ rezervId: `V-5${i}`, memberRezervId: 'RZ-1006', date: addD('2026-09-01', i),
      time: '05:30', status })));
    const nrows = await Promise.all(neg.map((_, i) => vrow(`V-5${i}`)));
    ok('"Not checked in", "Unattended", "ยังไม่เข้าเรียน" and the like are no-shows, never attended', rn.body.added === neg.length
       && nrows.every(v => v.status === 'noshow' && !v.checked_in_at), JSON.stringify([rn.body, nrows.map(v => [v.status, !!v.checked_in_at])]));
    const yn = await imp('visits', [
      { rezervId: 'V-60', memberRezervId: 'RZ-1006', date: '2026-09-21', time: '05:30', status: 'Booked', checkedInAt: 'Yes' },
      { rezervId: 'V-61', memberRezervId: 'RZ-1006', date: '2026-09-22', time: '05:30', status: 'Booked', checkedInAt: 'No' },
      { rezervId: 'V-62', memberRezervId: 'RZ-1006', date: '2026-09-23', time: '05:30', status: 'Booked', checkedInAt: 'ไม่' },
    ], { pastBookedAttended: true });
    const [v60, v61, v62] = await Promise.all(['V-60', 'V-61', 'V-62'].map(vrow));
    ok('a Yes/No "Checked in" column: Yes came at the class start, No is a no-show even with past bookings counted as attended',
       yn.body.added === 3 && !yn.body.warnings.length && v60.checked_in_at && v60.checked_in_at.toISOString() === v60.start_at.toISOString()
       && v61.status === 'noshow' && !v61.checked_in_at && v62.status === 'noshow', JSON.stringify([yn.body, v60, v61.status, v62.status]));

    // One person is never filed under another.
    const fam = await imp('members', [
      { name: 'Somchai Testa', email: 'somchai.testa@example.com', phone: '081-234-0001' },
      { name: 'Malee Testa', email: 'malee.testa@example.com', phone: '+66 81 234 0001' },
    ]);
    ok('two people on one family phone, each with their own email, are two students', fam.body.added === 2
       && (await one(`SELECT email FROM bkk_members WHERE name='Malee Testa'`)).email === 'malee.testa@example.com'
       && fam.body.warnings.some(w => w.row === 2 && /made a new student/.test(w.message)), JSON.stringify(fam.body));
    const anns = await imp('members', [{ name: 'Ann Example', email: 'ann1@example.com' }, { name: 'Ann Example', email: 'ann2@example.com' }]);
    const annV = await imp('visits', [{ rezervId: 'V-70', email: 'ann2@example.com', name: 'Ann Example', date: '2026-09-24', time: '05:30', status: 'attended' }]);
    ok('two students with one name and two emails are two, and a visit by the second email is hers', anns.body.added === 2 && annV.body.added === 1
       && (await one(`SELECT m.email FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id WHERE b.source_ref='V-70'`)).email === 'ann2@example.com',
       JSON.stringify([anns.body, annV.body]));
    const ph0 = await imp('members', [{ name: 'Ann One', phone: '0000000000' }, { name: 'Bee Two', phone: '000-000-0000' }]);
    ok('a placeholder phone on two people does not make them one', ph0.body.added === 2, JSON.stringify(ph0.body));
    const fe = await imp('members', [
      { rezervId: 'C-1', name: 'Somchai Family', email: 'family.testa@example.com' },
      { rezervId: 'C-2', name: 'Malee Family', email: 'family.testa@example.com' },
    ]);
    const mf = await one(`SELECT * FROM bkk_members WHERE rezerv_id='C-2'`);
    ok('two Rezerv customers on one email are two students: the second without it, and the import says so', fe.body.added === 2
       && mf.name === 'Malee Family' && mf.email === null
       && fe.body.warnings.some(w => w.row === 2 && w.code === 'clashEmail' && /without the email/.test(w.message)), JSON.stringify(fe.body));
    const fv = await imp('visits', [
      { rezervId: 'V-71', memberRezervId: 'C-2', email: 'family.testa@example.com', date: '2026-09-24', time: '05:30', status: 'attended' },
      { rezervId: 'V-72', memberRezervId: 'C-3', email: 'family.testa@example.com', name: 'Kid Family', date: '2026-09-24', time: '05:30', status: 'attended' },
    ]);
    ok("...her visit is on her own profile, and a third customer on that email is skipped, not merged", fv.body.added === 1
       && (await vrow('V-71')).mrz === 'C-2' && fv.body.newMembers === 0
       && fv.body.skipped.some(x => x.row === 2 && /family\.testa@example\.com is on Somchai Family's profile/.test(x.reason) && /check by hand/.test(x.reason)),
       JSON.stringify(fv.body));
    const anna = await post('/api/bkk/admin/passes', { name: 'Anna Lee', email: 'anna.lee@example.test', phone: '081-234-0009', productCode: 'dropin' }, ADMIN);
    const ben = await imp('members', [{ rezervId: 'C-900', name: 'Ben Lee', email: 'ben.lee@example.test', phone: '+66 81 234 0009' }]);
    ok("a Rezerv customer on a native student's phone, with another name and email, is a new student",
       ben.body.added === 1 && (await one('SELECT rezerv_id FROM bkk_members WHERE code=$1', [anna.body.member.code])).rezerv_id === null
       && (await codeOf('C-900')) !== anna.body.member.code, JSON.stringify(ben.body));
    const nok = await post('/api/bkk/admin/passes', { name: 'Nok', email: 'nok.native@example.test', productCode: 'unlim1' }, ADMIN);
    const nokPay = await imp('payments', [{ rezervId: 'P-90', name: 'Nok', email: 'nok.other@example.test', date: '2026-09-25', amount: 9600, item: '3 months' }]);
    const nokPass = await imp('passes', [{ name: 'Nok', email: 'nok.other@example.test', plan: '3 months', until: '2026-12-25' }]);
    ok("a payment or pass for someone with a native student's name but another email is skipped, not merged",
       nokPay.body.added === 0 && /a student named Nok \(.*\) has another email \(nok\.native@example\.test\): check by hand/.test((nokPay.body.skipped[0] || {}).reason)
       && nokPass.body.added === 0 && nokPass.body.skipped.length === 1
       && (await one('SELECT count(*)::int AS n FROM bkk_passes p JOIN bkk_members m ON m.id=p.member_id WHERE m.code=$1', [nok.body.member.code])).n === 1,
       JSON.stringify([nokPay.body, nokPass.body]));

    // Ids are ids: no card scrub, and Excel's changes are seen.
    const lu = await imp('members', [
      { rezervId: '1730000000001', name: 'Mai Example', email: 'mai@example.test' },
      { rezervId: '1730000000019', name: 'Nok Sample', email: 'nok@example.test', phone: '+86 13812345678' },
    ]);
    const luv = await imp('visits', [
      { rezervId: '1730000000001', memberRezervId: '1730000000019', date: '2026-09-25', time: '05:30', status: 'attended' },
      { rezervId: '1730000000019', memberRezervId: '1730000000001', date: '2026-09-25', time: '05:30', status: 'attended' },
    ]);
    ok('long ids that look like card numbers are kept as they are: two students, two visits, the phone intact', lu.body.added === 2
       && luv.body.added === 2 && (await vrow('1730000000001')).mrz === '1730000000019' && (await vrow('1730000000019')).mrz === '1730000000001'
       && (await one(`SELECT phone FROM bkk_members WHERE rezerv_id='1730000000019'`)).phone === '+86 13812345678', JSON.stringify([lu.body, luv.body]));
    await imp('members', [{ rezervId: '123', name: 'Dao Sample', phone: '0897776666' }]);
    const daoV = await imp('visits', [
      { rezervId: 'V-80', memberRezervId: '00123', name: 'Dao Sample', phone: '0897776666', date: '2026-09-26', time: '05:30', status: 'attended' },
      { rezervId: 'V-81', memberRezervId: '1.23E+15', name: 'Dao Sample', date: '2026-09-26', time: '05:30', status: 'attended' },
    ]);
    ok('a Rezerv id Excel stripped of its leading zeros still finds the student', daoV.body.added === 1 && daoV.body.newMembers === 0
       && (await vrow('V-80')).mname === 'Dao Sample' && (await one(`SELECT count(*)::int AS n FROM bkk_members WHERE name='Dao Sample'`)).n === 1,
       JSON.stringify(daoV.body));
    ok('...and an id Excel wrote as 1.23E+15 is skipped with the reason', daoV.body.skipped.some(x => x.row === 2 && /Excel changed this id/.test(x.reason)));

    // Importing again moves a visit forward only: what happened here stays.
    let rd = addD(todayB, 2);
    while (isMoon(rd)) rd = addD(rd, 1);
    const rSlot = (await one(`INSERT INTO bkk_class_slots (code,title,kind,weekday,start_time,duration_min,capacity)
      VALUES ('test_hist_reimp','History Reimport','test',$1,'10:10',60,5) RETURNING id`, [new Date(rd + 'T12:00:00Z').getUTCDay()])).id;
    const reRows = [
      { rezervId: 'V-90', memberRezervId: 'RZ-1003', date: rd, time: '10:10', className: 'History Reimport', status: 'Booked' },
      { rezervId: 'V-91', memberRezervId: 'RZ-1005', date: rd, time: '10:10', className: 'History Reimport', status: 'Booked' },
    ];
    const re1 = await imp('visits', reRows);
    // Staff find her on the list; the door checks in on the day, so for a
    // class days ahead the check-in is written here.
    const door = await post('/api/bkk/admin/walkin', { slotId: rSlot, date: rd, memberCode: await codeOf('RZ-1003'), cover: 'rezerv', checkIn: false }, ADMIN);
    await pool.query('UPDATE bkk_bookings SET checked_in_at=now() WHERE id=$1', [(await vrow('V-90')).id]);
    const cx = await post(`/api/bkk/bookings/${(await vrow('V-91')).id}/cancel`, { memberCode: await codeOf('RZ-1005') });
    const re2 = await imp('visits', reRows);
    const [a90, a91] = await Promise.all(['V-90', 'V-91'].map(vrow));
    ok('importing visits again never undoes a check-in at our door', re1.body.added === 2 && door.body.already === true
       && a90.status === 'booked' && !!a90.checked_in_at, JSON.stringify([re1.body, door.body, a90]));
    ok('...nor books again a seat the student cancelled here', cx.status === 200 && a91.status === 'cancelled' && re2.body.matched === 2
       && re2.body.updated === 0 && re2.body.warnings.some(w => w.row === 2 && w.code === 'keptHere'), JSON.stringify([cx.body, re2.body, a91.status]));
    const re3 = await imp('visits', [{ ...reRows[0], status: 'No show' }]);
    ok('...a later "no-show" in Rezerv keeps the check-in, with a note', re3.body.matched === 1 && !!(await vrow('V-90')).checked_in_at
       && (await vrow('V-90')).status === 'booked' && re3.body.warnings.some(w => w.code === 'keptHere'), JSON.stringify(re3.body));
    const plain = await imp('visits', [vis[10]]);
    ok('...and a plain run after one that counted past bookings as attended keeps them attended', plain.body.matched === 1
       && !!(await vrow('V-11')).checked_in_at, JSON.stringify(plain.body));
    const nd = await imp('visits', [{ rezervId: 'V-95', memberRezervId: 'RZ-1001', date: doorDate, time: startNow, className: 'History Walk-in', status: 'No show' }]);
    ok('a Rezerv no-show for a class our door checked them into is not added next to the visit', nd.body.matched === 1
       && !(await vrow('V-95')).id && nd.body.warnings.some(w => w.code === 'cameDoor'), JSON.stringify(nd.body));

    // One Rezerv id on two different rows.
    const ordRows = [
      { rezervId: 'ORD-77', memberRezervId: 'RZ-1005', date: '2026-09-20', amount: '9600', item: '1 month' },
      { rezervId: 'ORD-77', memberRezervId: 'RZ-1005', date: '2026-09-20', amount: '300', item: 'Mat rental' },
    ];
    const ord1 = await imp('payments', ordRows), ord2 = await imp('payments', ordRows);
    ok('one Rezerv id on two different payments: the second is skipped with the reason, never taken as already there',
       ord1.body.added === 1 && ord1.body.matched === 0 && ord1.body.skipped.some(x => x.row === 2 && /ORD-77 is already used for a different payment/.test(x.reason))
       && ord2.body.matched === 1 && ord2.body.skipped.length === 1, JSON.stringify([ord1.body, ord2.body]));
    const cls5 = await imp('visits', [
      { rezervId: 'CLS-5', memberRezervId: 'RZ-1005', date: '2026-09-27', time: '05:30', status: 'attended' },
      { rezervId: 'CLS-5', memberRezervId: 'RZ-1006', date: '2026-09-27', time: '05:30', status: 'attended' },
    ]);
    ok('...and the same for one id on two visits', cls5.body.added === 1 && cls5.body.skipped.some(x => x.row === 2 && /different visit/.test(x.reason)),
       JSON.stringify(cls5.body));

    // Money: only what came in, the VAT as it was paid, and every identical row.
    const ps = await imp('payments', ['Failed', 'Pending', 'Voided', 'Refunded', 'Paid', 'Maybe'].map((status, i) => ({
      rezervId: `P-2${i}`, memberRezervId: 'RZ-1005', date: '2026-09-28', amount: i < 3 ? 9600 : 1500, status })));
    const [p23, p24] = [await prow('P-23'), await prow('P-24')];
    ok('a payment status column: failed, pending and voided rows are not money, a refund goes back, an unknown word is skipped',
       ps.body.added === 2 && ps.body.skipped.length === 4 && ps.body.skipped.filter(x => x.code === 'notMoney').length === 3
       && ps.body.skipped.some(x => x.row === 6 && x.code === 'payStatus') && p23.status === 'refund' && p23.amount_thb === -1500
       && p24.status === 'paid' && p24.amount_thb === 1500, JSON.stringify([ps.body, p23, p24]));
    await imp('payments', [
      { rezervId: 'P-30', memberRezervId: 'RZ-1005', date: '2026-09-29', amount: '9600', vat: '7%', item: '1 month' },
      { rezervId: 'P-31', memberRezervId: 'RZ-1005', date: '2026-09-29', amount: '-1,605', vat: '105', item: 'Drop-in refund' },
    ]);
    const [p30, p31] = [await prow('P-30'), await prow('P-31')];
    ok('a VAT column holding the rate (7%) is the VAT inside the amount, not 7 baht', p30.vat_thb === 628 && p30.base_thb === 8972, JSON.stringify(p30));
    ok('a refund takes its VAT back: VAT and base have the sign of the amount', p31.amount_thb === -1605 && p31.vat_thb === -105
       && p31.base_thb === -1500, JSON.stringify(p31));
    const drop = { memberRezervId: 'RZ-1005', date: '30/09/2026', amount: '1,500', item: 'Drop-in', method: 'cash' };
    const b1 = await imp('payments', [drop], { firstRow: 1000 });
    const b2 = await imp('payments', [{ ...drop, nth: 2 }], { firstRow: 1001 });
    const b3 = await imp('payments', [drop, { ...drop, nth: 2 }]);
    const nDrop = (await one(`SELECT count(*)::int AS n FROM bkk_orders o WHERE o.source='rezerv' AND o.amount_thb=1500
      AND (o.created_at AT TIME ZONE 'Asia/Bangkok')::date = '2026-09-30'`)).n;
    ok('two identical payments in two batches are both kept: the page numbers them over the whole file', b1.body.added === 1
       && b2.body.added === 1 && b3.body.matched === 2 && nDrop === 2, JSON.stringify([b1.body, b2.body, b3.body, nDrop]));

    // Passes: classes left as written, and the 12-month package.
    const cl = await imp('passes', [
      { memberRezervId: 'RZ-1006', plan: '10 class pack', until: '2026-12-01', classesLeft: '3/10' },
      { memberRezervId: 'RZ-1006', plan: '10 class pack', until: '2026-12-02', classesLeft: '3 classes' },
      { memberRezervId: 'RZ-1006', plan: '10 class pack', until: '2026-12-03', classesLeft: 'lots' },
      { memberRezervId: 'RZ-1006', plan: '10 class pack', until: '2026-12-04', classesLeft: '12' },
      { memberRezervId: 'RZ-1006', plan: '3 months', until: '2026-12-05', classesLeft: 'Unlimited' },
      { memberRezervId: 'RZ-1006', plan: '12 months', start: '22/10/2026', until: '21/10/2027' },
      { memberRezervId: 'RZ-1006', plan: '12 months', start: '01/10/2025', until: '31/10/2026' },
    ]);
    const held = (await pool.query(`SELECT to_char(p.valid_until,'YYYY-MM-DD') AS u, p.credits_total - p.credits_used AS left, pr.code
      FROM bkk_passes p JOIN bkk_products pr ON pr.id=p.product_id JOIN bkk_members m ON m.id=p.member_id
      WHERE m.rezerv_id='RZ-1006'`)).rows;
    const heldOn = u => held.find(x => x.u === u) || {};
    ok('classes left "3/10" and "3 classes" are 3 left, not all 10', heldOn('2026-12-01').left === 3 && heldOn('2026-12-02').left === 3,
       JSON.stringify(held));
    ok('...unreadable is skipped with the reason, more than the pack is kept with a note, an unlimited pass ignores it',
       cl.body.skipped.length === 1 && cl.body.skipped[0].row === 3 && /classes left "lots"/.test(cl.body.skipped[0].reason)
       && heldOn('2026-12-04').left === 10 && cl.body.warnings.some(w => w.row === 4 && w.code === 'leftOver')
       && heldOn('2026-12-05').code === 'unlim3', JSON.stringify(cl.body));
    ok('a 12-month pass that runs one year is the 12-month package; an older 13-month one keeps its own',
       heldOn('2027-10-21').code === 'unlim12m' && heldOn('2026-10-31').code === 'unlim12', JSON.stringify(held));

    // Reports and the profile.
    const repT = (await J(`/api/bkk/admin/report?from=${todayB}&to=${todayB}`, { headers: ADMIN })).body;
    ok('"not seen for 14 days" leaves out someone who bought their first pass today', !repT.notSeen.some(x => x.code === anna.body.member.code)
       && repT.notSeen.some(x => x.code === niranCode), JSON.stringify(repT.notSeen.map(x => x.name)));
    await pool.query(`INSERT INTO bkk_bookings (slot_id,class_date,start_at,member_id,status,source,cover)
      VALUES ($1,'2026-09-13','2026-09-13T02:15:00Z',(SELECT id FROM bkk_members WHERE code=$2),'booked','student','pass')`,
      [sunSlot, anna.body.member.code]);
    const repNs = (await J('/api/bkk/admin/report?from=2026-09-13&to=2026-09-13', { headers: ADMIN })).body.visits;
    const annaH = (await J(`/api/bkk/admin/members/${anna.body.member.code}/history`, { headers: ADMIN })).body.summary;
    ok('a seat booked here and never checked in is a no-show once its day is over, in the report and the history',
       repNs.noShows === 1 && repNs.booked === 1 && annaH.noShows === 1, JSON.stringify([repNs, annaH]));
    await imp('members', [{ rezervId: 'RZ-2000', name: 'Two Classes Testimport' }]);
    await imp('visits', [
      { rezervId: 'V-96', memberRezervId: 'RZ-2000', date: todayB, time: '00:01', className: 'Early One', status: 'attended' },
      { rezervId: 'V-97', memberRezervId: 'RZ-2000', date: todayB, time: '00:02', className: 'Early Two', status: 'attended' },
    ]);
    const twoH = (await J('/api/bkk/me/' + await codeOf('RZ-2000'))).body.history;
    ok('two classes on one morning are one morning practised, this month too', twoH.practised === 2 && twoH.days === 1 && twoH.thisMonth === 1,
       JSON.stringify(twoH));

    // No admin key set: the admin is closed, not open on a default.
    const keep = [process.env.BKK_ADMIN_KEY, process.env.SHOP_ADMIN_KEY];
    delete process.env.BKK_ADMIN_KEY; delete process.env.SHOP_ADMIN_KEY;
    const app2 = express();
    app2.use(express.json());
    mountBkk(app2, { pgPool: pool });
    process.env.BKK_ADMIN_KEY = keep[0];
    if (keep[1] != null) process.env.SHOP_ADMIN_KEY = keep[1];
    const srv2 = app2.listen(0);
    const st2 = async key => (await fetch(`http://127.0.0.1:${srv2.address().port}/api/bkk/admin/export/members.csv`,
      { headers: key == null ? {} : { 'x-bkk-key': key } })).status;
    ok('with no admin key set, nothing opens the admin: not the old default key, not an empty one',
       (await st2('aybkk2026')) === 401 && (await st2('')) === 401 && (await st2(null)) === 401);
    await new Promise(r => setTimeout(r, 1500));           // let its schema check finish
    srv2.close();
  }

  console.log('\n— the class calendar (admin month, week, day and inside a class) —');
  {
    const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
    const wdOf = d => new Date(d + 'T12:00:00Z').getUTCDay();
    const isMoon = d => moonDaysBetween(d, d).size > 0;
    const todayB = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const back = n => { let d = addD(todayB, -n); while (isMoon(d)) d = addD(d, -1); return d; };
    const P = back(3), P3 = back(5), P2 = back(7);              // past working days, all different
    let F = addD(todayB, 2); while (isMoon(F)) F = addD(F, 1);   // a working day ahead, inside two weeks
    const from = addD(todayB, -20), to = addD(todayB, 20);
    const M = [...moonDaysBetween(from, addD(todayB, -1)).keys()].pop();      // a moon day gone by
    const M2 = [...moonDaysBetween(addD(todayB, 1), to).keys()][0];            // and one to come
    const cal = (f, t, h = ADMIN) => J(`/api/bkk/admin/calendar?from=${f}&to=${t}`, { headers: h });
    const cls = (qs, h = ADMIN) => J('/api/bkk/admin/class?' + new URLSearchParams(qs), { headers: h });
    const checkin = (id, body = {}, h = ADMIN) => post(`/api/bkk/admin/bookings/${id}/checkin`, body, h);
    const mkSlot = async (code, weekday, start, minutes, cap, active = true) => (await pool.query(
      `INSERT INTO bkk_class_slots (code,title,kind,weekday,start_time,duration_min,capacity,active)
       VALUES ($1,'Cal Test','test',$2,$3,$4,$5,$6) RETURNING id`, [code, weekday, start, minutes, cap, active])).rows[0].id;
    const mkMember = async (code, name) => (await pool.query(
      `INSERT INTO bkk_members (code,name,email,phone) VALUES ($1,$2,$3,'080-000-0000') RETURNING id`,
      [code, name, code.toLowerCase() + '@example.com'])).rows[0].id;
    const addBk = async o => (await pool.query(
      `INSERT INTO bkk_bookings (slot_id,class_date,start_at,member_id,pass_id,status,checked_in_at,cancelled_at,cancel_reason,cover,source,class_title,source_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [o.slot ?? null, o.date, o.at, o.member, o.pass ?? null, o.status || 'booked', o.ci ?? null, o.cancelledAt ?? null,
       o.reason ?? null, o.cover || 'rezerv', o.source || 'staff', o.title ?? null, o.ref ?? null])).rows[0].id;
    const at = (d, t) => `${d}T${t}:00+07:00`;

    ok('the calendar needs the staff key', (await cal(from, to, {})).status === 401);
    const bad = await Promise.all([
      J('/api/bkk/admin/calendar', { headers: ADMIN }), cal('2026-02-30', '2026-03-02'), cal(to, from),
      cal('yesterday', to), cal(todayB, addD(todayB, 62))]);
    ok('...and a real range: missing, impossible or backwards dates, or more than 62 days, are refused',
       bad.every(r => r.status === 400 && r.body.error), JSON.stringify(bad.map(r => [r.status, r.body.error])));
    ok('...62 days is fine', (await cal(todayB, addD(todayB, 61))).status === 200);

    // A past class with every kind of name on it.
    const slotA = await mkSlot('test_cal_a', wdOf(P), '06:00', 60, 5);
    const mem = {};
    for (const [k, n] of [['zed', 'Cal Zed'], ['amy', 'Cal Amy'], ['moe', 'Cal Moe'], ['bea', 'Cal Bea'], ['kim', 'Cal Kim'], ['lee', 'Cal Lee']])
      mem[k] = await mkMember('BTESTCAL' + k.toUpperCase(), n);
    const dropPass = (await pool.query(
      `INSERT INTO bkk_passes (member_id,product_id,kind,credits_total,credits_used,valid_days,status)
       VALUES ($1,(SELECT id FROM bkk_products WHERE code='dropin'),'credits',1,1,1,'active') RETURNING id`, [mem.bea])).rows[0].id;
    const sA = at(P, '06:00');
    const bk = {
      zed: await addBk({ slot: slotA, date: P, at: sA, member: mem.zed, ci: sA }),
      amy: await addBk({ slot: slotA, date: P, at: sA, member: mem.amy }),
      bea: await addBk({ slot: slotA, date: P, at: sA, member: mem.bea, ci: sA, pass: dropPass, cover: 'pass', source: 'door' }),
      moe: await addBk({ slot: slotA, date: P, at: sA, member: mem.moe, status: 'noshow' }),
      kim: await addBk({ slot: slotA, date: P, at: sA, member: mem.kim, status: 'cancelled',
        cancelledAt: new Date(Date.now() - 3600000), reason: 'cal test reason' }),
      lee: await addBk({ slot: slotA, date: P, at: sA, member: mem.lee, status: 'cancelled', cancelledAt: new Date() }),
    };

    // A slot no longer run, with a visit on its day and one on another weekday.
    const slotOff = await mkSlot('test_cal_off', wdOf(P2), '09:00', 90, 20, false);
    const offMem = await mkMember('BTESTCALOFF', 'Cal Off');
    await addBk({ slot: slotOff, date: P2, at: at(P2, '09:00'), member: offMem, ci: at(P2, '09:00') });
    await addBk({ slot: slotOff, date: addD(P2, 1), at: at(addD(P2, 1), '09:00'), member: offMem, status: 'noshow' });
    // A visit on a moon day gone by, in a class the timetable runs on that weekday.
    const moonSlot = (await pool.query(`SELECT id FROM bkk_class_slots WHERE active AND weekday=$1 AND kind <> 'test'
      ORDER BY start_time, id LIMIT 1`, [wdOf(M)])).rows[0].id;
    const moonStart = (await pool.query('SELECT start_time FROM bkk_class_slots WHERE id=$1', [moonSlot])).rows[0].start_time;
    await addBk({ slot: moonSlot, date: M, at: at(M, moonStart), member: offMem, ci: at(M, moonStart) });
    // Rezerv classes that matched no slot: kept with their own title.
    const wsMem = [];
    for (let i = 0; i < 5; i++) wsMem.push(await mkMember('BTESTCALWS' + i, 'Cal Workshop ' + i));
    const ws = (i, o) => addBk({ date: P3, at: at(P3, '10:00'), member: wsMem[i], title: 'Cal Workshop', source: 'rezerv',
      ref: 'test-cal-ws-' + i, ...o });
    const wsIn = await ws(0, { ci: at(P3, '10:00') });
    const wsNo = await ws(1, { status: 'noshow' });
    const wsBk = await ws(2, {});
    await ws(3, { status: 'cancelled', cancelledAt: new Date(), reason: 'cancelled in Rezerv' });
    await ws(4, { at: at(P3, '14:00'), ci: at(P3, '14:00') });
    // A Rezerv visit with no time on file is stored at 00:00.
    const wsMid = await mkMember('BTESTCALMID', 'Cal Midnight');
    await addBk({ date: P3, at: at(P3, '00:00'), member: wsMid, title: 'Cal No Time', source: 'rezerv', ref: 'test-cal-mid', ci: at(P3, '00:00') });

    const c1 = await cal(from, to);
    const list = c1.body.classes || [];
    const byKey = k => list.find(c => c.key === k);
    ok('the calendar answers with its range, today in Bangkok and the moon days',
       c1.status === 200 && c1.body.from === from && c1.body.to === to && c1.body.today === todayB
         && c1.body.moonDays[M] && c1.body.moonDays[M2] && Object.keys(c1.body.moonDays).every(d => d >= from && d <= to),
       JSON.stringify({ ...c1.body, classes: list.length }));
    const order = c => c.date + (c.timeKnown ? '0' : '1') + c.startAt;
    ok('...classes in time order, each once', list.every((c, i) => !i || order(list[i - 1]) <= order(c))
       && new Set(list.map(c => c.key)).size === list.length);
    const active = (await pool.query('SELECT id, weekday FROM bkk_class_slots WHERE active')).rows;
    const missing = [];
    for (let d = from; d <= to; d = addD(d, 1)) {
      if (isMoon(d)) continue;
      for (const s of active) if (s.weekday === wdOf(d) && !byKey(`s:${s.id}:${d}`)) missing.push(`${s.id}:${d}`);
    }
    ok('every class the timetable runs is there, past days included', !missing.length && list.some(c => c.date < todayB && c.slotId),
       missing.slice(0, 5).join(' '));
    ok('a moon day to come has no class on it', !list.some(c => c.date === M2), M2);
    const onM = list.filter(c => c.date === M);
    ok('...a moon day gone by shows only a class with names on it',
       onM.length >= 1 && onM.every(c => c.booked + c.noShows > 0) && byKey(`s:${moonSlot}:${M}`)
         && byKey(`s:${moonSlot}:${M}`).booked >= 1, JSON.stringify(onM));

    const a = byKey(`s:${slotA}:${P}`) || {};
    ok('a past class counts booked, checked in and no-shows (cancelled seats are not counted)',
       a.booked === 3 && a.checkedIn === 2 && a.noShows === 1 && a.capacity === 5 && a.cancelled === false && a.note === null,
       JSON.stringify(a));
    ok('...with what the page needs to draw it', a.slotId === slotA && a.date === P && a.startAt === sA && a.title === 'Cal Test'
       && a.kind === 'test' && a.teachers === '' && a.durationMin === 60 && a.isOnline === false, JSON.stringify(a));
    const off = byKey(`s:${slotOff}:${P2}`);
    ok('a slot no longer run still shows the class it had names in',
       off && off.booked === 1 && off.checkedIn === 1, JSON.stringify(off));
    ok('...on another weekday too (history), and nowhere it had none',
       byKey(`s:${slotOff}:${addD(P2, 1)}`) && byKey(`s:${slotOff}:${addD(P2, 1)}`).noShows === 1
         && list.filter(c => c.slotId === slotOff).length === 2);
    const wsKey = `x:${P3}:10:00:Cal Workshop`;
    const w = byKey(wsKey);
    ok('Rezerv visits with no slot are one class per day, title and time',
       w && w.slotId === null && w.title === 'Cal Workshop' && w.capacity === null && w.startAt === at(P3, '10:00')
         && w.booked === 2 && w.checkedIn === 1 && w.noShows === 1 && w.cancelled === false, JSON.stringify(w));
    ok('...another time is another class', byKey(`x:${P3}:14:00:Cal Workshop`) && byKey(`x:${P3}:14:00:Cal Workshop`).booked === 1
       && list.filter(c => c.title === 'Cal Workshop').length === 2);
    const p3 = list.filter(c => c.date === P3), mid = byKey(`x:${P3}:00:00:Cal No Time`);
    ok('a Rezerv visit with no time says so, and comes last in its day, not first at 00:00',
       mid && mid.timeKnown === false && w.timeKnown === true && a.timeKnown === true && p3[p3.length - 1] === mid
         && p3.length > 1, JSON.stringify(p3.map(c => [c.key, c.timeKnown])));

    await pool.query(`INSERT INTO bkk_class_overrides (slot_id, class_date, capacity) VALUES ($1,$2,0)`, [slotA, P]);
    const cap0 = ((await cal(P, P)).body.classes || []).find(c => c.slotId === slotA);
    ok("the day's own capacity is used, 0 included", cap0 && cap0.capacity === 0, JSON.stringify(cap0));
    await pool.query(`UPDATE bkk_class_overrides SET capacity=4 WHERE slot_id=$1 AND class_date=$2`, [slotA, P]);
    ok('...and any other number', ((await cal(P, P)).body.classes || []).find(c => c.slotId === slotA).capacity === 4);

    console.log('  inside a class');
    ok('inside a class needs the staff key', (await cls({ slotId: slotA, date: P }, {})).status === 401);
    const inA = await cls({ slotId: slotA, date: P });
    const r = inA.body.roster || [];
    ok('the roster is everyone booked or no-show, by name',
       inA.status === 200 && r.map(x => x.name).join() === 'Cal Amy,Cal Bea,Cal Moe,Cal Zed', JSON.stringify(inA.body).slice(0, 400));
    const bea = r.find(x => x.name === 'Cal Bea') || {}, moe = r.find(x => x.name === 'Cal Moe') || {};
    ok('...each row with what staff need, and no email, phone or birthday',
       bea.bookingId === bk.bea && bea.code === 'BTESTCALBEA' && bea.status === 'booked' && !!bea.checkedInAt && !!bea.bookedAt
         && bea.cover === 'pass' && bea.source === 'door' && bea.passName === 'Drop-in' && bea.dropin === true
         && moe.status === 'noshow' && moe.checkedInAt === null && moe.dropin === false && moe.passName === null
         && r.every(x => Object.keys(x).sort().join() === 'bookedAt,bookingId,checkedInAt,code,cover,dropin,name,passName,source,status')
         && !JSON.stringify(inA.body).includes('@example.com') && !JSON.stringify(inA.body).includes('080-000'),
       JSON.stringify(r));
    const cl = inA.body.cancelledList || [];
    ok('...then who cancelled, newest first, with the reason',
       cl.length === 2 && cl[0].name === 'Cal Lee' && cl[0].reason === null && cl[1].name === 'Cal Kim' && cl[1].reason === 'cal test reason'
         && cl[1].code === 'BTESTCALKIM' && !!cl[1].cancelledAt, JSON.stringify(cl));
    const ca = inA.body.class || {};
    ok('...and the class: counts, end time, over, nobody more to add',
       ca.key === `s:${slotA}:${P}` && ca.booked === 3 && ca.checkedIn === 2 && ca.noShows === 1 && ca.capacity === 4
         && ca.endAt === at(P, '07:00') && ca.started === true && ca.ended === true && ca.canAdd === false, JSON.stringify(ca));
    const inWs = await cls({ date: P3, time: '10:00', title: 'Cal Workshop' });
    ok('a Rezerv class with no slot opens by day, time and title, read-only',
       inWs.status === 200 && inWs.body.class.slotId === null && inWs.body.class.key === wsKey && inWs.body.class.canAdd === false
         && inWs.body.roster.length === 3 && inWs.body.cancelledList.length === 1
         && inWs.body.cancelledList[0].reason === 'cancelled in Rezerv', JSON.stringify(inWs.body).slice(0, 300));
    ok('...an unknown one is not found', (await cls({ date: P3, time: '11:00', title: 'Cal Workshop' })).status === 404);
    const inMid = await cls({ date: P3, time: '00:00', title: 'Cal No Time' });
    ok('...one with no time still opens by 00:00, and says the time is not known', inMid.status === 200
       && inMid.body.class.timeKnown === false && inMid.body.roster.length === 1, JSON.stringify(inMid.body.class));
    ok('an unknown slot is not found', (await cls({ slotId: 999999, date: P })).status === 404);
    ok('a bad date is refused', (await cls({ slotId: slotA, date: '2026-13-01' })).status === 400
       && (await cls({ slotId: slotA })).status === 400 && (await cls({ date: P })).status === 400);
    const slotF = await mkSlot('test_cal_fut', wdOf(F), '06:00', 60, 4);
    const wrongWd = await cls({ slotId: slotF, date: addD(F, 1) });
    ok("a slot on a day that is not its weekday, with nobody on it, is refused", wrongWd.status === 400
       && /not on that day/.test(wrongWd.body.error), JSON.stringify(wrongWd.body));
    const offOther = await cls({ slotId: slotOff, date: addD(P2, 1) });
    ok('...with names on it, it is history and opens (nothing can be added)', offOther.status === 200
       && offOther.body.roster.length === 1 && offOther.body.class.canAdd === false, JSON.stringify(offOther.body).slice(0, 200));
    const fut0 = await cls({ slotId: slotF, date: F });
    ok('a class to come can take names', fut0.status === 200 && fut0.body.class.canAdd === true && fut0.body.class.started === false
       && fut0.body.class.ended === false && fut0.body.class.endAt === at(F, '07:00') && fut0.body.roster.length === 0,
       JSON.stringify(fut0.body.class));

    console.log('  checking in from the class');
    ok('checking in needs the staff key', (await checkin(bk.amy, {}, {})).status === 401);
    const amyIn = await checkin(bk.amy);
    ok('a past class is checked in at its start', amyIn.status === 200 && amyIn.body.success && amyIn.body.booking.id === bk.amy
       && amyIn.body.booking.status === 'booked' && Date.parse(amyIn.body.booking.checkedInAt) === Date.parse(sA), JSON.stringify(amyIn.body));
    const moeIn = await checkin(bk.moe);
    ok('a no-show who came after all becomes a visit', moeIn.status === 200 && moeIn.body.booking.status === 'booked'
       && Date.parse(moeIn.body.booking.checkedInAt) === Date.parse(sA), JSON.stringify(moeIn.body));
    const zedOut = await checkin(bk.zed, { undo: true });
    ok('undo clears the check-in, the seat stays', zedOut.status === 200 && zedOut.body.booking.status === 'booked'
       && zedOut.body.booking.checkedInAt === null, JSON.stringify(zedOut.body));
    const aAfter = ((await cal(P, P)).body.classes || []).find(c => c.slotId === slotA) || {};
    ok('...and the calendar counts follow', aAfter.booked === 4 && aAfter.checkedIn === 3 && aAfter.noShows === 0, JSON.stringify(aAfter));
    ok('a cancelled seat cannot be checked in', (await checkin(bk.kim)).status === 409);
    ok('an unknown booking is not found', (await checkin(99999999)).status === 404 && (await checkin('abc')).status === 404);
    const wsState = async () => (await pool.query(`SELECT id, status, checked_in_at FROM bkk_bookings WHERE id = ANY($1) ORDER BY id`,
      [[wsIn, wsNo, wsBk]])).rows.map(x => `${x.status}:${!!x.checked_in_at}`).join();
    const ws0 = await wsState();
    const wsTries = [await checkin(wsIn, { undo: true }), await checkin(wsNo), await checkin(wsBk),
      await post(`/api/bkk/bookings/${wsBk}/cancel`, {}, ADMIN)];
    ok('a Rezerv class with no slot stays as Rezerv kept it: no undo, check-in or cancel',
       wsTries.every(x => x.status === 409 && /moved from Rezerv/.test(x.body.error)) && (await wsState()) === ws0
         && ws0 === 'booked:true,noshow:false,booked:false', JSON.stringify([ws0, wsTries.map(x => x.body)]));
    const twiceD = addD(P2, 2);
    await addBk({ slot: slotOff, date: twiceD, at: at(twiceD, '09:00'), member: offMem });
    const twiceNo = await addBk({ slot: slotOff, date: twiceD, at: at(twiceD, '09:00'), member: offMem, status: 'noshow' });
    const twiceIn = await checkin(twiceNo);
    ok('a no-show for someone who also holds a seat in that class stays a no-show', twiceIn.status === 409
       && /already on this class list/.test(twiceIn.body.error), JSON.stringify(twiceIn.body));
    const todaySlot = await mkSlot('test_cal_today', wdOf(todayB), '23:30', 30, 10, false);
    const todayBk = await addBk({ slot: todaySlot, date: todayB, at: at(todayB, '23:30'), member: mem.zed });
    const tIn = await checkin(todayBk);
    ok("today's class is checked in now", tIn.status === 200 && Math.abs(Date.parse(tIn.body.booking.checkedInAt) - Date.now()) < 60000,
       JSON.stringify(tIn.body));
    const credits = async code => (await pool.query(`SELECT coalesce(sum(credits_used),0)::int AS n FROM bkk_passes p
      JOIN bkk_members m ON m.id=p.member_id WHERE m.code=$1`, [code])).rows[0].n;

    console.log('  adding from the calendar');
    const walk = body => post('/api/bkk/admin/walkin', { slotId: slotF, date: F, ...body }, ADMIN);
    const rowOf = async name => (await pool.query(`SELECT b.id, b.checked_in_at, b.source, b.cover FROM bkk_bookings b
      JOIN bkk_members m ON m.id=b.member_id WHERE b.slot_id=$1 AND b.class_date=$2 AND b.status='booked' AND m.name=$3`,
      [slotF, F, name])).rows;
    const nw = await walk({ name: 'Cal New', cover: 'rezerv', checkIn: false, requestId: 'test-cal-new' });
    const nwRows = await rowOf('Cal New');
    ok('a class to come takes a name without checking it in, added by staff',
       nw.status === 200 && nw.body.already === false && nw.body.cover === 'rezerv' && nwRows.length === 1
         && nwRows[0].checked_in_at === null && nwRows[0].source === 'staff', JSON.stringify({ body: nw.body, nwRows }));
    const nw2 = await walk({ name: 'Cal New', cover: 'rezerv', checkIn: false, requestId: 'test-cal-new' });
    ok('...a second tap with the same request adds no one twice', nw2.status === 200 && nw2.body.repeat === true
       && (await pool.query(`SELECT count(*)::int AS n FROM bkk_members WHERE name='Cal New'`)).rows[0].n === 1, JSON.stringify(nw2.body));
    const nw3 = await walk({ memberCode: nw.body.code, cover: 'rezerv', checkIn: false });
    ok('...someone already on the list is said so, and not checked in', nw3.status === 200 && nw3.body.already === true
       && (await rowOf('Cal New')).every(x => x.checked_in_at === null) && (await rowOf('Cal New')).length === 1, JSON.stringify(nw3.body));
    ok('...checking in a class not reached yet is refused', /not today yet/.test((await checkin(nwRows[0].id)).body.error || ''));
    const nwCash = await walk({ memberCode: nw.body.code, cover: 'dropin', method: 'cash', checkIn: false });
    const nwOrders = (await pool.query(`SELECT count(*)::int AS n FROM bkk_orders o JOIN bkk_members m ON m.id=o.member_id
      WHERE m.name='Cal New'`)).rows[0].n;
    ok('...and a drop-in for them sells nothing', nwCash.status === 200 && nwCash.body.already === true && !nwCash.body.refno
       && nwOrders === 0 && (await rowOf('Cal New')).every(x => x.checked_in_at === null), JSON.stringify(nwCash.body));
    const cash = await walk({ name: 'Cal Cash', cover: 'dropin', method: 'cash', checkIn: false });
    const cashRows = await rowOf('Cal Cash');
    ok('...a drop-in sold for it books the seat, not checked in', cash.status === 200 && cash.body.cover === 'dropin'
       && /^\d+$/.test(cash.body.refno || '') && cashRows.length === 1 && cashRows[0].checked_in_at === null
       && cashRows[0].source === 'staff', JSON.stringify({ body: cash.body, cashRows }));
    const holder = (await post('/api/bkk/admin/passes', { name: 'Cal Holder', email: 'cal.holder@example.com', productCode: 'pack10' }, ADMIN)).body.member.code;
    const pw = await walk({ memberCode: holder, cover: 'pass', checkIn: false });
    const pwRows = await rowOf('Cal Holder');
    ok('...an aybkk.net pass too, using one credit', pw.status === 200 && pw.body.cover === 'pass' && pwRows.length === 1
       && pwRows[0].checked_in_at === null && (await credits(holder)) === 1, JSON.stringify(pw.body));
    // The door's add checks in, and nobody is in the room for a later day.
    const doorTries = [await walk({ name: 'Cal Door', cover: 'rezerv' }), await walk({ name: 'Cal Door', cover: 'rezerv', checkIn: true }),
      await walk({ memberCode: nw.body.code, cover: 'rezerv' })];
    ok('with no checkIn (the door\'s add) or checkIn true, a class on a later day is refused', doorTries.every(x => x.status === 409
       && x.body.error === 'that class is not today yet') && !(await rowOf('Cal Door')).length
       && (await pool.query(`SELECT count(*)::int AS n FROM bkk_members WHERE name='Cal Door'`)).rows[0].n === 0
       && (await rowOf('Cal New')).every(x => x.checked_in_at === null), JSON.stringify(doorTries.map(x => x.body)));
    const oddIn = await walk({ name: 'Cal Odd', cover: 'rezerv', checkIn: 'false' });
    ok('...and checkIn must be true or false, never the text "false"', oddIn.status === 400 && !(await rowOf('Cal Odd')).length,
       JSON.stringify(oddIn.body));
    const fourth = await walk({ name: 'Cal Fourth', cover: 'rezerv', checkIn: false });
    const sch14 = (await J('/api/bkk/schedule?days=14')).body.classes.find(c => c.slotId === slotF && c.date === F) || {};
    ok('everyone added counts on the timetable students see', fourth.status === 200 && sch14.booked === 4 && sch14.seatsLeft === 0,
       JSON.stringify(sch14));
    const inF = await cls({ slotId: slotF, date: F });
    ok('...and inside the class', inF.body.class.booked === 4 && inF.body.class.checkedIn === 0 && inF.body.roster.length === 4
       && inF.body.roster.find(x => x.name === 'Cal Cash').dropin === true, JSON.stringify(inF.body.class));

    console.log('  closing and reopening from the calendar');
    await post('/api/bkk/admin/classes/cancel', { slotId: slotF, date: F, reason: 'Cal Holiday' }, ADMIN);
    const fOff = ((await cal(F, F)).body.classes || []).find(c => c.slotId === slotF) || {};
    ok('a closed class stays on the calendar, marked, with the reason', fOff.cancelled === true && fOff.note === 'Cal Holiday'
       && fOff.booked === 0, JSON.stringify(fOff));
    const inOff = await cls({ slotId: slotF, date: F });
    ok('...inside it nobody can be added, and the released seats are listed', inOff.body.class.canAdd === false
       && inOff.body.class.cancelled === true && inOff.body.roster.length === 0 && inOff.body.cancelledList.length === 4
       && inOff.body.cancelledList.every(x => x.reason === 'class cancelled: Cal Holiday'), JSON.stringify(inOff.body).slice(0, 300));
    await post('/api/bkk/admin/classes/reopen', { slotId: slotF, date: F }, ADMIN);
    const fBack = ((await cal(F, F)).body.classes || []).find(c => c.slotId === slotF) || {};
    ok('...reopened, it is a plain class again', fBack.cancelled === false && fBack.note === null, JSON.stringify(fBack));

    // The student's own bookings carry the Bangkok day as text: a 05:30 class
    // is the previous day in UTC.
    const early = (await J('/api/bkk/schedule?days=14')).body.classes.find(c => c.startAt.endsWith('T05:30:00+07:00') && c.seatsLeft > 0);
    const eCode = (await post('/api/bkk/admin/passes', { name: 'Cal Early', email: 'cal.early@example.com', productCode: 'pack10' }, ADMIN)).body.member.code;
    await post('/api/bkk/bookings', { memberCode: eCode, slotId: early.slotId, date: early.date });
    const eMe = (await J('/api/bkk/me/' + eCode)).body.bookings || [];
    ok("/me bookings carry classDate, the Bangkok day of a 05:30 class", eMe.length === 1 && eMe[0].classDate === early.date
       && typeof eMe[0].classDate === 'string' && eMe[0].slot_id === early.slotId && eMe[0].title === early.title,
       JSON.stringify({ early, eMe }));
    await pool.query(`UPDATE bkk_class_slots SET active=false WHERE code IN ('test_cal_a','test_cal_fut')`);
  }

  console.log('\n— Bangkok calendar dates —');
  // The schedule window is built from ymd(); in UTC it drifts a day during the
  // 00:00–07:00 Bangkok window, exactly when the 05:30 Mysore is booked.
  const todayBkk = new Date(new Date().getTime() + 7 * 3600000).toISOString().slice(0, 10);
  const sch2 = await J('/api/bkk/schedule?days=3');
  ok('schedule never offers a date before today in Bangkok',
     sch2.body.classes.every(c => c.date >= todayBkk),
     `today(BKK)=${todayBkk} earliest=${sch2.body.classes.map(c => c.date).sort()[0]}`);
  ok('...and names the last Bangkok day it loaded', sch2.body.to === new Date(Date.parse(todayBkk + 'T12:00:00Z') + 2 * 86400000).toISOString().slice(0, 10),
     `today(BKK)=${todayBkk} to=${sch2.body.to}`);

  console.log(`\n${PASS} passed, ${FAIL} failed`);
  srv.close(); await pool.end();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
