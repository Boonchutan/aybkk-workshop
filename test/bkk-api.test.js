// End-to-end test of bkk-api against a real Postgres.
process.env.BKK_ADMIN_KEY = 'testkey';
process.env.MAIL_DRY_RUN = '1';   // capture mail in an outbox instead of sending
const express = require('express');
const { Pool } = require('pg');
const { mountBkk, moonDaysBetween, parseWhen, CANCEL_CUTOFF_HOURS, quietRows, quietDraft, firstName, QUIET_TEXTS } = require('../bkk-api.js');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ||
  'postgres://test:test@127.0.0.1:5432/bkktest' });
const app = express();
// server.js reads JSON bodies up to 10 MB; a profile photo can be a few MB.
app.use(express.json({ limit: '10mb' }));

let PASS = 0, FAIL = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name} ${extra}`); }
};

(async () => {
  // Stand-in for Cloudinary: remembers uploads and the links asked for, signs nothing.
  const uploads = [], destroyed = [], urlCalls = [];
  const fakeCloud = {
    url: (id, o) => { urlCalls.push({ id, o }); return `signed://${o.type}/${id}/${o.transformation[0].width}`; },
    uploader: {
      upload: async (data, o) => { const r = { public_id: `${o.folder}/${o.public_id || 'p' + (uploads.length + 1)}`,
        width: 2048, height: 1365, type: o.type, folder: o.folder, given: o.public_id, transformation: o.transformation };
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
  // The price switch reads this clock. It stays on the last minute of the old
  // prices until the test of the switch itself, near the end.
  const bkkAt = s => Date.parse(s + '+07:00');
  let clock = bkkAt('2026-11-11T23:59:00');
  const now = () => clock;
  mountBkk(app, { pgPool: pool, cloudinary: fakeCloud, fetch: fakeFetch, now });
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
  const sch = await J('/api/bkk/schedule?days=7', { headers: ADMIN });
  // A moon day can close a whole Saturday (4 classes), so the floor is low.
  ok('classes generated for the week', sch.body.classes.length > 5, `got ${sch.body.classes.length}`);
  ok('all classes are in the future', sch.body.classes.every(c => new Date(c.startAt) > new Date()));
  ok('capacity 42 on shala classes',
    sch.body.classes.filter(c => !c.isOnline).every(c => c.capacity === 42));
  const pubSch = await J('/api/bkk/schedule?days=7');
  ok('without the staff key the timetable has no capacity and no booked count',
    pubSch.status === 200 && pubSch.body.classes.length === sch.body.classes.length
      && pubSch.body.classes.every(c => !('capacity' in c) && !('booked' in c)), Object.keys(pubSch.body.classes[0] || {}).join());
  ok('...and seatsLeft stops at 4, which is all the booking page reads',
    pubSch.body.classes.every((c, i) => c.seatsLeft === Math.min(4, sch.body.classes[i].seatsLeft)));
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

  console.log('\n— 8 classes / 1 month replaced the 10-class pack (6 Nov 2026) —');
  {
    const marker = async () => (await pool.query(`SELECT count(*)::int AS n FROM bkk_settings WHERE key='pack8_replaces_pack10'`)).rows[0].n;
    const prod = async code => (await pool.query('SELECT * FROM bkk_products WHERE code=$1', [code])).rows[0];
    const passOf = async code => (await pool.query(`SELECT p.credits_total, p.credits_used, p.valid_days, p.status, pr.code,
        to_char(p.valid_from,'YYYY-MM-DD') AS f, p.valid_until - p.valid_from AS span
      FROM bkk_passes p JOIN bkk_products pr ON pr.id=p.product_id JOIN bkk_members m ON m.id=p.member_id WHERE m.code=$1`, [code])).rows[0];
    // A boot only: the schema step runs when the API is mounted.
    const boot = async (db = pool) => { mountBkk(express(), { pgPool: db, now }); await new Promise(r => setTimeout(r, 1500)); };

    const new8 = await prod('pack8'), new10 = await prod('pack10');
    ok('a new database has the 8-class pack on sale and the 10-class pack off sale, listed after it', new8 && new8.active
       && new10 && !new10.active && new10.sort > new8.sort && (await marker()) === 1, JSON.stringify([new8, new10]));

    // A shala that ran before 6 Nov: the 10-class pack on sale, no 8-class pack, no marker.
    await pool.query(`DELETE FROM bkk_settings WHERE key='pack8_replaces_pack10'`);
    await pool.query(`DELETE FROM bkk_products WHERE code='pack8'`);
    await pool.query(`UPDATE bkk_products SET active=true, sort=20 WHERE code='pack10'`);
    const holder = await post('/api/bkk/orders', { productCode: 'pack10', name: 'Tenpack Holder', email: 'tenpack.holder@example.com' });
    await post(`/api/bkk/admin/orders/${holder.body.order.id}/force-activate`, {}, ADMIN);
    const waiting = await post('/api/bkk/orders', { productCode: 'pack10', name: 'Tenpack Waiting', email: 'tenpack.waiting@example.com' });
    ok('(before: a 10-class pack sold online at 14,000 + 3% fee + 7% VAT = 15,429)',
       holder.body.order && holder.body.order.amount === 15429 && waiting.body.order && waiting.body.order.amount === 15429,
       JSON.stringify([holder.body, waiting.body]).slice(0, 200));

    const errs = [], logErr = console.error;
    console.error = (...a) => errs.push(a.join(' '));
    await boot({ query: (sql, p) => /SET active=false WHERE code='pack10'/.test(sql)
      ? Promise.reject(new Error('disk full')) : pool.query(sql, p), connect: () => pool.connect() });
    console.error = logErr;
    ok('a boot that fails to retire the 10-class pack writes no marker, so the next boot tries again',
       (await marker()) === 0 && (await prod('pack10')).active && errs.some(e => /disk full/.test(e)), JSON.stringify(errs));

    await boot();
    const run8 = await prod('pack8'), run10 = await prod('pack10');
    ok('the next boot adds the 8-class pack to the running shala: 7,600, 8 classes, 60 days, on sale', run8 && run8.active
       && run8.price_thb === 7600 && run8.kind === 'credits' && run8.credits === 8 && run8.valid_days === 60 && run8.daily_cap === null
       && run8.name_en === '8 classes / 2 months' && run8.name_th === '8 ครั้ง / 2 เดือน', JSON.stringify(run8));
    ok('...and retires the 10-class pack once, its rules unchanged, with the marker written', !run10.active && run10.price_thb === 14000
       && run10.credits === 10 && run10.valid_days === 90 && (await marker()) === 1, JSON.stringify(run10));

    const seen = [];
    await boot({ query: (sql, p) => { seen.push(sql); return pool.query(sql, p); }, connect: () => pool.connect() });
    ok('a second boot never touches the 10-class pack again, and it stays off sale', seen.length > 20
       && !seen.some(s => /code='pack10'/.test(s)) && !(await prod('pack10')).active && (await marker()) === 1
       && (await prod('pack8')).active, `${seen.length} queries`);

    const late = await post(`/api/bkk/admin/orders/${waiting.body.order.id}/force-activate`, {}, ADMIN);
    const hp = await passOf(holder.body.member.code), wp = await passOf(waiting.body.member.code);
    ok('10-class passes already sold keep 10 classes and 90 days, also one paid before and confirmed after the change',
       late.status === 200 && [hp, wp].every(p => p && p.code === 'pack10' && p.credits_total === 10 && p.credits_used === 0
       && p.valid_days === 90 && p.status === 'active'), JSON.stringify([late.body, hp, wp]));
    const farDay = new Date(Date.now() + (7 * 3600 + 35 * 86400) * 1000).toISOString().slice(0, 10);
    const cls10 = month.body.classes.find(c => c.date >= farDay && c.seatsLeft > 0);
    const bk10 = await post('/api/bkk/bookings', { memberCode: holder.body.member.code, slotId: cls10.slotId, date: cls10.date });
    const used = await passOf(holder.body.member.code);
    ok('...and a 10-class pass still books a class: 9 left, a 90-day window from that class', bk10.status === 200
       && used.credits_total - used.credits_used === 9 && used.f === cls10.date && used.span === 90, JSON.stringify([bk10.body, used]));
    await post(`/api/bkk/bookings/${bk10.body.booking.id}/cancel`, { memberCode: holder.body.member.code });

    const cat = (await J('/api/bkk/products')).body;
    const p8 = cat.products.find(p => p.code === 'pack8');
    ok('GET /api/bkk/products lists the 8-class pack at 7,600, 8 classes, 60 days, after the drop-in',
       p8 && p8.price_thb === 7600 && p8.credits === 8 && p8.valid_days === 60 && cat.products.map(p => p.code).slice(0, 2).join() === 'dropin,pack8',
       JSON.stringify(p8));
    ok('...with the Packages tab total 7,600 + 228 online fee + 548 VAT = 8,376', p8 && p8.fee_thb === 228 && p8.vat_thb === 548
       && p8.total_thb === 8376, JSON.stringify(p8));
    const buy10 = await post('/api/bkk/orders', { productCode: 'pack10', name: 'Tenpack Late', email: 'tenpack.late@example.com' });
    const desk10 = await post('/api/bkk/admin/sales', { productCode: 'pack10', name: 'Tenpack Desk', method: 'cash' }, ADMIN);
    ok('the 10-class pack is not listed, and the checkout and the desk refuse it', !cat.products.some(p => p.code === 'pack10')
       && buy10.status === 404 && desk10.status === 404, JSON.stringify([buy10.body, desk10.body]));

    const desk8 = await post('/api/bkk/admin/sales', { productCode: 'pack8', name: 'Eight Desk', email: 'eight.desk@example.com', method: 'cash' }, ADMIN);
    const row8 = desk8.body.order ? (await pool.query('SELECT base_thb, fee_thb, vat_thb, amount_thb FROM bkk_orders WHERE refno=$1',
      [desk8.body.order.refno])).rows[0] : {};
    ok('the buyer pays 7,600 + 532 VAT = 8,132 for the 8-class pack at the desk', desk8.body.order && desk8.body.order.amount === 8132
       && desk8.body.order.vat === 532 && row8.base_thb === 7600 && row8.fee_thb === 0 && row8.vat_thb === 532 && row8.amount_thb === 8132,
       JSON.stringify([desk8.body, row8]));
    await new Promise(r => setTimeout(r, 300));                    // the receipt goes after the reply
    const rc8 = require('../mailer').outbox.filter(m => m.tag === 'receipt' && m.to === 'eight.desk@example.com').pop();
    ok('...the receipt says so', rc8 && rc8.text.includes('Paid ฿8,132 (฿7,600 + ฿0 online transaction fee + ฿532 VAT 7%)'),
       rc8 && rc8.text.slice(0, 300));
    const dp8 = desk8.body.member ? await passOf(desk8.body.member.code) : null;
    ok('...and gets 8 classes for 60 days', dp8 && dp8.code === 'pack8' && dp8.credits_total === 8 && dp8.valid_days === 60, JSON.stringify(dp8));
    await post('/api/bkk/admin/settings', { surchargePct: 0 }, ADMIN);
    const online8 = await post('/api/bkk/orders', { productCode: 'pack8', name: 'Eight Online', email: 'eight.online@example.com' });
    await post('/api/bkk/admin/settings', { surchargePct: 3 }, ADMIN);
    ok('...and 8,132 online too, with the online fee set to 0', online8.body.order && online8.body.order.amount === 8132,
       JSON.stringify(online8.body).slice(0, 160));

    const imp10 = await post('/api/bkk/admin/import', { rows: [
      { name: 'Tenpack Import', plan: '10 classes/3mo (14000thb + online transaction fee 5%)', until: '2027-01-31', classesLeft: 4 }] }, ADMIN);
    const ip = (await pool.query(`SELECT p.credits_total, p.credits_used, p.valid_days, pr.code FROM bkk_passes p
      JOIN bkk_products pr ON pr.id=p.product_id JOIN bkk_members m ON m.id=p.member_id WHERE m.name='Tenpack Import'`)).rows[0] || {};
    ok('the Rezerv import still maps "10 classes" to the 10-class pack', imp10.body.passes === 1 && ip.code === 'pack10'
       && ip.credits_total === 10 && ip.credits_used === 6 && ip.valid_days === 90, JSON.stringify([imp10.body, ip]));
    const imp8 = await post('/api/bkk/admin/import', { rows: [
      { name: 'Eightpack Import', plan: '8 classes / 1 month', until: '2026-12-05', classesLeft: 5 }] }, ADMIN);
    const i8 = (await pool.query(`SELECT p.credits_total, p.credits_used, p.valid_days, pr.code FROM bkk_passes p
      JOIN bkk_products pr ON pr.id=p.product_id JOIN bkk_members m ON m.id=p.member_id WHERE m.name='Eightpack Import'`)).rows[0] || {};
    ok('the Rezerv import maps "8 classes / 1 month" to the 1-month 8-class record (never for sale)', imp8.body.passes === 1
       && i8.code === 'pack8m1' && i8.credits_total === 8 && i8.credits_used === 3 && i8.valid_days === 30, JSON.stringify([imp8.body, i8]));
    const imp82 = await post('/api/bkk/admin/import', { rows: [
      { name: 'Eightpack Twomonth', plan: '8 classes / 2 months (8 ครั้ง / 2 เดือน)', until: '2027-01-05', classesLeft: 8 }] }, ADMIN);
    const i82 = (await pool.query(`SELECT p.valid_days, pr.code FROM bkk_passes p JOIN bkk_products pr ON pr.id=p.product_id
      JOIN bkk_members m ON m.id=p.member_id WHERE m.name='Eightpack Twomonth'`)).rows[0] || {};
    ok('...and "8 classes / 2 months" to the 8-class pack', imp82.body.passes === 1 && i82.code === 'pack8' && i82.valid_days === 60,
       JSON.stringify([imp82.body, i82]));
    ok('...and the 1-month record is not listed or sold', !cat.products.some(p => p.code === 'pack8m1'));
  }

  console.log('\n— 8 classes last 2 months, not 1 (9 Nov 2026) —');
  {
    const marker = async () => (await pool.query(`SELECT count(*)::int AS n FROM bkk_settings WHERE key='pack8_two_months'`)).rows[0].n;
    const prod = async () => (await pool.query(`SELECT * FROM bkk_products WHERE code='pack8'`)).rows[0];
    const passOf = async name => (await pool.query(`SELECT p.valid_days, p.source, pr.code,
        to_char(p.valid_from,'YYYY-MM-DD') AS f, to_char(p.valid_until,'YYYY-MM-DD') AS u
      FROM bkk_passes p JOIN bkk_products pr ON pr.id=p.product_id JOIN bkk_members m ON m.id=p.member_id WHERE m.name=$1`, [name])).rows[0];
    const boot = async (db = pool) => { mountBkk(express(), { pgPool: db, now }); await new Promise(r => setTimeout(r, 1500)); };
    const sell = async name => {
      const o = await post('/api/bkk/orders', { productCode: 'pack8', name, email: name.toLowerCase().replace(/ /g, '.') + '@example.com' });
      await post(`/api/bkk/admin/orders/${o.body.order.id}/force-activate`, {}, ADMIN);
      return o;
    };

    ok('a new database sells the 8-class pack as 2 months, marker written', (await prod()).valid_days === 60 && (await marker()) === 1);

    // A shala that ran from 6 Nov: the pack is 30 days and some are sold.
    await pool.query(`DELETE FROM bkk_settings WHERE key='pack8_two_months'`);
    await pool.query(`UPDATE bkk_products SET valid_days=30, name_en='8 classes / 1 month', name_th='8 ครั้ง / 1 เดือน' WHERE code='pack8'`);
    await sell('Eightmonth Waiting');
    await sell('Eightmonth Started');
    await pool.query(`UPDATE bkk_passes p SET valid_from='2026-11-07', valid_until='2026-12-07' FROM bkk_members m
                      WHERE m.id=p.member_id AND m.name='Eightmonth Started'`);
    // Before this change a Rezerv 8-class pass was put on pack8 too.
    const rezRow = { name: 'Eightmonth Rezerv', plan: '8 classes / 1 month (8 ครั้ง / 1 เดือน)', until: '2026-12-05', classesLeft: 6 };
    await post('/api/bkk/admin/import', { rows: [rezRow] }, ADMIN);
    await pool.query(`UPDATE bkk_passes p SET product_id=(SELECT id FROM bkk_products WHERE code='pack8') FROM bkk_members m
                      WHERE m.id=p.member_id AND m.name='Eightmonth Rezerv'`);
    await post('/api/bkk/admin/passes', { name: 'Eightmonth Typed', email: 'eightmonth.typed@example.com', productCode: 'pack8',
      validFrom: '2026-11-06', validUntil: '2026-12-06' }, ADMIN);
    await post('/api/bkk/admin/passes', { name: 'Eightmonth Gift', email: 'eightmonth.gift@example.com', productCode: 'pack8' }, ADMIN);
    const names = ['Eightmonth Waiting', 'Eightmonth Started', 'Eightmonth Rezerv', 'Eightmonth Typed', 'Eightmonth Gift'];
    const before = await Promise.all(names.map(passOf));
    ok('(before: every 8-class pass is 30 days)', before.every(p => p && p.code === 'pack8' && p.valid_days === 30), JSON.stringify(before));

    const errs = [], logErr = console.error;
    console.error = (...a) => errs.push(a.join(' '));
    await boot({ query: (sql, p) => /UPDATE bkk_passes p SET valid_days=60/.test(sql)
      ? Promise.reject(new Error('disk full')) : pool.query(sql, p), connect: () => pool.connect() });
    console.error = logErr;
    ok('a boot that fails half way writes no marker, so the next boot tries again', (await marker()) === 0
       && (await passOf('Eightmonth Started')).u === '2026-12-07' && errs.some(e => /disk full/.test(e)), JSON.stringify(errs));

    await boot();
    const p8 = await prod();
    ok('the next boot makes the pack 2 months on the running shala, same price and classes', p8.valid_days === 60 && p8.price_thb === 7600
       && p8.credits === 8 && p8.active && p8.name_en === '8 classes / 2 months' && p8.name_th === '8 ครั้ง / 2 เดือน' && (await marker()) === 1,
       JSON.stringify(p8));
    const waiting = await passOf('Eightmonth Waiting'), started = await passOf('Eightmonth Started'), rez = await passOf('Eightmonth Rezerv');
    ok('...a pack sold but not started yet gets 60 days from its first class', waiting.valid_days === 60 && !waiting.f && !waiting.u,
       JSON.stringify(waiting));
    ok('...a started pack ends 30 days later (7 Dec becomes 6 Jan)', started.valid_days === 60 && started.f === '2026-11-07'
       && started.u === '2027-01-06', JSON.stringify(started));
    const gift = await passOf('Eightmonth Gift'), typed = await passOf('Eightmonth Typed');
    ok('...a pass given by hand, not started, gets 60 days too', gift.code === 'pack8' && gift.valid_days === 60 && !gift.u, JSON.stringify(gift));
    ok('...a pass moved from Rezerv keeps its dates and the 1-month name', rez.source === 'rezerv' && rez.code === 'pack8m1'
       && rez.valid_days === 30 && rez.u === '2026-12-05', JSON.stringify(rez));
    ok('...so does a pass staff typed in with dates', typed.code === 'pack8m1' && typed.valid_days === 30 && typed.f === '2026-11-06'
       && typed.u === '2026-12-06', JSON.stringify(typed));
    const again = await post('/api/bkk/admin/import', { rows: [rezRow] }, ADMIN);
    const rezCount = (await pool.query(`SELECT count(*)::int AS n FROM bkk_passes p JOIN bkk_members m ON m.id=p.member_id
      WHERE m.name='Eightmonth Rezerv'`)).rows[0].n;
    ok('...and importing the same Rezerv row again finds it: no second pass', again.body.passes === 0 && rezCount === 1,
       JSON.stringify([again.body, rezCount]));

    await pool.query(`DELETE FROM bkk_settings WHERE key='pack8_two_months'`);
    await boot();
    ok('running it again never adds 30 days twice', (await passOf('Eightmonth Started')).u === '2027-01-06'
       && (await prod()).valid_days === 60 && (await marker()) === 1);

    await pool.query(`UPDATE bkk_products SET valid_days=45 WHERE code='pack8'`);
    await boot();
    ok('a length staff set afterwards is never put back', (await prod()).valid_days === 45);
    await pool.query(`UPDATE bkk_products SET valid_days=60 WHERE code='pack8'`);
  }

  console.log('\n— the payment names the package (11 Nov 2026) —');
  {
    const keys = ['PAYSO_MERCHANT_ID', 'PAYSO_SECRET_KEY', 'PAYSO_API_KEY'];
    keys.forEach(k => { process.env[k] = 'test-only'; });
    const gw = await post('/api/bkk/orders', { productCode: 'pack8', name: 'Detail Buyer', email: 'detail.buyer@example.com' });
    keys.forEach(k => { delete process.env[k]; });
    const f = gw.body.pay && gw.body.pay.fields;
    ok('the payment says which package it is for, and our ref, with no slash', f
       && f.productdetail === `AYBKK 8 classes - 2 months ref ${f.refno}` && f.refno === String(gw.body.order.refno).padStart(12, '0'),
       JSON.stringify(f));
  }

  console.log('\n— buy (gateway not configured) —');
  const order = await post('/api/bkk/orders',
    { productCode: 'pack8', name: 'Test Student', email: 'test@example.com' });
  ok('order created', order.status === 200 && order.body.order, JSON.stringify(order.body).slice(0, 120));
  const refno = Number(order.body.order.refno);
  const memberCode = order.body.member.code;
  ok('amount is ฿8376 (7,600 + 3% fee + 7% VAT)', order.body.order.amount === 8376, `got ${order.body.order.amount}`);
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
  ok('8 credits available', me.body.passes[0].creditsLeft === 8, String(me.body.passes[0].creditsLeft));
  ok('validity not started before first booking', me.body.passes[0].validUntil === null);

  console.log('\n— booking —');
  bk = await post('/api/bkk/bookings', { memberCode, slotId: slot.slotId, date: slot.date });
  ok('booking succeeds', bk.status === 200, JSON.stringify(bk.body).slice(0, 120));
  me = await J('/api/bkk/me/' + memberCode);
  ok('credit decremented to 7', me.body.passes[0].creditsLeft === 7, String(me.body.passes[0].creditsLeft));
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
  const packPkg = (await pool.query(`SELECT p.code, p.credits, p.valid_days FROM bkk_passes x JOIN bkk_products p ON p.id = x.product_id
    JOIN bkk_members m ON m.id = x.member_id WHERE m.name = 'Imp Pack'`)).rows[0] || {};
  ok('...on the 10-class package, 10 classes and 90 days, as Rezerv sold it', packPkg.code === 'pack10' && packPkg.credits === 10
     && packPkg.valid_days === 90 && pack.credits_total === 10, JSON.stringify(packPkg));
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
  for (const ch of ['q1', 'q2', 'q3', 'done-line', 'done-wchat']) await post('/api/bkk/start-event', { kind: 'step', src: 'reel-sleep1', ch });
  await post('/api/bkk/start-event', { kind: 'Step!', src: 'reel-sleep1', ch: 'q1' });
  await post('/api/bkk/start-event', { kind: 'hack', src: 'reel-sleep1' });
  const evs = (await pool.query(`SELECT kind, ch FROM bkk_start_events WHERE src='reel-sleep1' ORDER BY id`)).rows;
  ok('first-step ladder steps are stored as kind step, with their channel',
     evs.filter(e => e.kind === 'step').map(e => e.ch).join() === 'q1,q2,q3,done-line,done-wchat', JSON.stringify(evs));
  ok('an unknown kind is still counted as a view', evs.filter(e => e.kind === 'view').length === 4 &&
     evs.every(e => ['view', 'tap', 'step'].includes(e.kind)), JSON.stringify(evs));
  const st2 = (await J('/api/bkk/admin/start-stats', { headers: ADMIN })).body.sources.find(x => x.src === 'reel-sleep1');
  ok('ladder steps do not change the views and taps report', st2 && st2.views === 4 && st2.taps === 1, JSON.stringify(st2));

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

  console.log('\n— renewals (the Google review ask) —');
  const renewalsOf = async code => (await J(`/api/bkk/me/${code}`)).body.renewals;
  const stay = (await post('/api/bkk/admin/passes', { name: 'Stay Testperson', email: 'stay.testperson@example.com', productCode: 'unlim1' }, ADMIN)).body.member.code;
  ok('one pass: no renewal yet', await renewalsOf(stay) === 0, String(await renewalsOf(stay)));
  const visit = (await post('/api/bkk/admin/passes', { name: 'Visit Testperson', email: 'visit.testperson@example.com', productCode: 'dropin' }, ADMIN)).body.member.code;
  await post('/api/bkk/admin/passes', { memberCode: visit, productCode: 'dropin' }, ADMIN);
  await post('/api/bkk/admin/passes', { memberCode: visit, productCode: 'pack8', creditsTotal: 1 }, ADMIN);
  ok('drop-ins and 1-class passes only: no renewal', await renewalsOf(visit) === 0, String(await renewalsOf(visit)));
  await post('/api/bkk/admin/passes', { memberCode: stay, productCode: 'dropin' }, ADMIN);
  ok('a drop-in beside a pass is not a renewal', await renewalsOf(stay) === 0, String(await renewalsOf(stay)));
  await post('/api/bkk/admin/passes', { memberCode: stay, productCode: 'unlim3' }, ADMIN);
  ok('a second pass is 1 renewal', await renewalsOf(stay) === 1, String(await renewalsOf(stay)));
  const third = (await post('/api/bkk/admin/passes', { memberCode: stay, productCode: 'pack8' }, ADMIN)).body.pass;
  ok('a third pass is 2 renewals', await renewalsOf(stay) === 2, String(await renewalsOf(stay)));
  await post(`/api/bkk/admin/passes/${third.id}/void`, { reason: 'test' }, ADMIN);
  ok('a void pass is not counted', await renewalsOf(stay) === 1, String(await renewalsOf(stay)));
  ok('a member with no pass has 0, never below', await renewalsOf(ck) === 0, String(await renewalsOf(ck)));
  const inDays = n => new Date(Date.now() + 7 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);
  const rzMail = 'usedup.testperson@example.com';
  await post('/api/bkk/admin/import/passes', { dryRun: false, rows: [
    { name: 'Usedup Testperson', email: rzMail, plan: '10 class pack', start: inDays(-40), until: inDays(50), status: 'Expired', classesLeft: '0' },
    { name: 'Usedup Testperson', email: rzMail, plan: '1 Month unlimited', start: inDays(-20), until: inDays(10), status: 'Refunded' },
    { name: 'Usedup Testperson', email: rzMail, plan: '10 class pack', start: inDays(-5), until: inDays(85), status: 'Active', classesLeft: '9' }] }, ADMIN);
  const rz = (await pool.query(`SELECT m.code, p.status FROM bkk_passes p JOIN bkk_members m ON m.id=p.member_id
    WHERE m.email=$1 ORDER BY p.id`, [rzMail])).rows;
  ok('a Rezerv pack used up before its end date (stored void) counts, a refunded one does not', rz.length === 3
     && rz[0].status === 'void' && rz[1].status === 'void' && rz[2].status === 'active' && await renewalsOf(rz[0].code) === 1,
     JSON.stringify([rz.map(r => r.status), rz[0] && await renewalsOf(rz[0].code)]));

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
    const sched = async () => (await J('/api/bkk/schedule?days=14', { headers: ADMIN })).body.classes;
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
    const pack = await post('/api/bkk/orders', { productCode: 'pack8', name: 'Pack Buyer', email: 'pack.buyer@example.com' });
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
    const sched = async () => (await J('/api/bkk/schedule?days=14', { headers: ADMIN })).body.classes;
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
        ok('...and counts in the timetable', ((await J('/api/bkk/schedule?days=1', { headers: ADMIN })).body.classes.find(c => c.slotId === tSlot) || {}).booked === 1);
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
    const shared = await quietRows((sql, args) => pool.query(sql, args), { date: todayB });
    ok('report: the quiet list is the Today box rule (quietRows), every state: not someone booked ahead, not someone who came',
       JSON.stringify(miss) === JSON.stringify([...shared.todo, ...shared.resting, ...shared.parked].map(x => x.code))
       && !miss.includes(niranCode) && !miss.includes(ployCode) && rep.body.notSeenHeldBack === shared.heldBack,
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

    // ── the profile opens on the membership: its dates, how they came on it, what is booked ──
    console.log('\n— the membership block on the profile —');
    {
      const d = n => addD(todayB, n), at = (day, t = '06:00') => `${day}T${t}:00+07:00`;
      const mk = async (key, name) => (await one(`INSERT INTO bkk_members (code,name,email) VALUES ($1,$2,$3) RETURNING id`,
        ['BTESTMB' + key, name, `mb.${key.toLowerCase()}@example.com`])).id;
      const pass = async (member, code, o = {}) => (await one(`INSERT INTO bkk_passes
          (member_id,product_id,kind,credits_total,credits_used,daily_cap,valid_days,valid_from,valid_until,status,frozen_from,frozen_until,source)
        SELECT $1::int, id, kind, credits, $3::int, daily_cap, valid_days, $4::date, $5::date, $6::text, $7::date, $8::date, 'manual'
        FROM bkk_products WHERE code=$2 RETURNING id`,
        [member, code, o.used || 0, o.from || null, o.until || null, o.status || 'active', o.ffrom || null, o.funtil || null])).id;
      // A seat they came to, unless in: false (booked, no check-in). No pass on it is a Rezerv visit.
      const seat = (member, day, o = {}) => pool.query(`INSERT INTO bkk_bookings
          (slot_id,class_date,start_at,member_id,pass_id,status,checked_in_at,cancelled_at,cover,source,class_title)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Membership Test')`,
        [o.slot || null, day, at(day, o.t), member, o.pass || null, o.status || 'booked', o.in === false || o.status ? null : at(day, o.t),
         o.status === 'cancelled' ? new Date() : null, o.pass ? 'pass' : 'rezerv', o.pass ? 'door' : 'rezerv']);
      const hist = async key => (await J(`/api/bkk/admin/members/BTESTMB${key}/history`, { headers: ADMIN })).body;
      const of = (h, id) => (h.membership || []).find(p => p.passId === id) || {};

      // Mid-way through 3 months, with a paused pack and a month bought for after.
      const mid = await mk('MID', 'Mem Midway');
      const m3 = await pass(mid, 'unlim3', { from: d(-20), until: d(69) });
      const mNext = await pass(mid, 'unlim1', { from: d(70), until: d(99) });
      const mPack = await pass(mid, 'pack8', { status: 'frozen', used: 1, from: d(-10), until: d(150), ffrom: d(-2), funtil: d(80) });
      for (const k of [-19, -15, -12, -9, -5, -2]) await seat(mid, d(k), { pass: m3 });
      await seat(mid, d(-25));                                   // a Rezerv class before the pass began
      await seat(mid, d(-3), { pass: mPack });                   // paid with the pack
      await seat(mid, d(-1), { pass: m3, in: false });           // booked, never checked in
      await seat(mid, d(-6), { pass: m3, status: 'cancelled' });
      const hm = await hist('MID'), a = of(hm, m3), fz = of(hm, mPack), nx = of(hm, mNext);
      ok('membership lists each pass that is live or coming, in use first, with start, end and days left',
         hm.membership.map(p => `${p.passId}:${p.state}`).join() === `${m3}:active,${mPack}:frozen,${mNext}:starts`
         && a.name === '3 months unlimited' && a.nameTh && a.kind === 'unlimited' && a.source === 'manual'
         && a.validFrom === d(-20) && a.validUntil === d(69) && a.daysLeft === 70
         && fz.frozenUntil === d(80) && nx.validFrom === d(70) && nx.validUntil === d(99), JSON.stringify(hm.membership));
      ok('visits before the pass started are not counted on it', a.cameDays === 6 && a.lastCame === d(-2)
         && hm.summary.visits === 8, JSON.stringify([a, hm.summary]));
      ok('the last 28 days count only days inside the pass', a.cameLast28 === 6 && hm.summary.visitsLast30 === 8, JSON.stringify(a));
      ok('a class paid with another pass is counted on that pass only; a no-show or a cancelled seat on none',
         fz.cameDays === 1 && fz.lastCame === d(-3) && nx.cameDays === 0 && nx.lastCame === null && nx.perWeek === null, JSON.stringify([fz, nx]));

      const twice = await mk('TWO', 'Mem Twice');
      const tw = await pass(twice, 'unlim1', { from: d(-5), until: d(24) });
      await seat(twice, d(-2), { pass: tw, t: '05:30' });
      await seat(twice, d(-2), { pass: tw, t: '07:30' });
      await seat(twice, d(-1), { pass: tw });
      const ht = await hist('TWO');
      ok('days came on this pass count days, not seats: two classes in one day are one', of(ht, tw).cameDays === 2
         && of(ht, tw).cameLast28 === 2 && ht.summary.visits === 3, JSON.stringify(ht.membership));
      // 6 days run is under a week; 7 days (today is a day) is one week.
      const week = await mk('WEEK', 'Mem Oneweek');
      const wk = await pass(week, 'unlim1', { from: d(-6), until: d(23) });
      for (const k of [-6, -3, -1]) await seat(week, d(k), { pass: wk });
      ok('about how many a week: 6 days in 3 weeks is 2; under one week it is not shown', a.perWeek === 2 && of(ht, tw).perWeek === null
         && of(await hist('WEEK'), wk).perWeek === 3, JSON.stringify([a, ht.membership]));

      const both = await mk('BOTH', 'Mem Both');
      const bo = await pass(both, 'unlim1', { from: d(-3), until: d(26) });
      await seat(both, d(-2));
      await seat(both, d(-2), { pass: bo });
      ok('a Rezerv visit and a door check-in on the same day count once', of(await hist('BOTH'), bo).cameDays === 1);

      const lastDay = await mk('LAST', 'Mem Lastday');
      const ld = await pass(lastDay, 'unlim1', { from: d(-29), until: d(0) });
      const hl = of(await hist('LAST'), ld);
      ok('a pass ending today has 1 day left', hl.state === 'active' && hl.daysLeft === 1, JSON.stringify(hl));
      ok('last came is null when they have not come on this pass yet', hl.lastCame === null && hl.cameDays === 0 && hl.cameLast28 === 0, JSON.stringify(hl));

      // 28 days run, 14 of them paused: 4 days came is 2 a week, not 1.
      const paused = await mk('PAUSE', 'Mem Paused');
      const pz = await pass(paused, 'unlim3', { from: d(-27), until: d(76), ffrom: d(-20), funtil: d(-6) });
      for (const k of [-26, -24, -4, -1]) await seat(paused, d(k), { pass: pz });
      ok('paused days are taken out of the weeks', of(await hist('PAUSE'), pz).perWeek === 2 && fz.perWeek === 1,
         JSON.stringify([of(await hist('PAUSE'), pz), fz]));

      const packer = await mk('PACK', 'Mem Pack');
      const pk = await pass(packer, 'pack8', { used: 3, from: d(-10), until: d(49) });
      const pkNew = await pass(packer, 'pack8');
      const hp = await hist('PACK');
      ok('a class pack shows classes used and left', of(hp, pk).creditsTotal === 8 && of(hp, pk).creditsUsed === 3 && of(hp, pk).creditsLeft === 5
         && of(hp, pk).kind === 'credits', JSON.stringify(of(hp, pk)));
      const fc = of(hp, pkNew);
      ok('a pass with no dates says it starts on the first class', fc.state === 'firstClass' && fc.validFrom === null && fc.validUntil === null
         && fc.daysLeft === null && fc.cameDays === 0 && fc.perWeek === null && fc.creditsLeft === 8
         && hp.membership.map(p => p.passId).join() === `${pk},${pkNew}`, JSON.stringify(hp.membership));

      const booker = await mk('BOOK', 'Mem Booker');
      for (const k of [5, 2, 7, 1, 4, 6, 3]) await seat(booker, d(k), { in: false });
      await seat(booker, d(1), { in: false, t: '08:00' });
      await seat(booker, d(2), { status: 'cancelled', t: '08:00' });
      await seat(booker, d(-1), { in: false });
      await seat(booker, d(-2));
      const hb = await hist('BOOK');
      ok('next bookings: only seats still to come, soonest first, at most 5; a cancelled or past seat is never one',
         hb.nextBookings.map(b => `${b.date} ${b.time}`).join() === [`${d(1)} 06:00`, `${d(1)} 08:00`, `${d(2)} 06:00`, `${d(3)} 06:00`, `${d(4)} 06:00`].join()
         && hb.nextBookings.every(b => b.class === 'Membership Test' && b.cover === 'rezerv') && hb.nextBookingsMore === 3
         && hb.membership.length === 0 && hm.nextBookings.length === 0 && hm.nextBookingsMore === 0, JSON.stringify([hb.nextBookings, hb.nextBookingsMore]));

      const gone = await mk('GONE', 'Mem Gone');
      await pass(gone, 'unlim1', { from: d(-40), until: d(-1) });
      await pass(gone, 'unlim3', { status: 'void', from: d(-30), until: d(59) });
      await pass(gone, 'pack8', { used: 8, from: d(-30), until: d(29) });
      const hg = await hist('GONE');
      ok('an ended, voided or used-up pass is not in membership but stays in passes', hg.membership.length === 0 && hg.passes.length === 3,
         JSON.stringify([hg.membership, hg.passes.length]));

      // Nobody checks in at home.
      const [onSlot, onSoon, onNow] = await Promise.all([1, 2, 3].map(async n => (await one(
        `INSERT INTO bkk_class_slots (code,title,kind,weekday,start_time,duration_min,capacity,is_online,active)
         VALUES ($1,'[Online] Membership Test','test',1,'06:00',60,10,true,false) RETURNING id`, ['test_mb_online' + n])).id));
      const home = await mk('HOME', 'Mem Online');
      const ho = await pass(home, 'unlim1', { from: d(-3), until: d(26) });
      await seat(home, d(-1), { pass: ho, slot: onSlot, in: false });
      await seat(home, d(-2), { pass: ho, in: false });          // in the shala, no check-in: not came
      await seat(home, d(1), { pass: ho, slot: onSlot, in: false });
      await seat(home, d(1), { pass: ho });                      // checked in, but the day is still to come
      // Starts in an hour; began half an hour ago and runs 60 minutes.
      for (const [slot, ms] of [[onSoon, 3600000], [onNow, -1800000]]) {
        const t = new Date(Date.now() + ms);
        await pool.query(`INSERT INTO bkk_bookings (slot_id,class_date,start_at,member_id,pass_id,status,cover,source)
          VALUES ($1,$2,$3,$4,$5,'booked','pass','student')`, [slot, bkkMs(t.getTime()).slice(0, 10), t, home, ho]);
      }
      const hh = await hist('HOME');
      ok('an online class booked and over counts as came on the pass; one not over yet, or a day still to come, does not',
         of(hh, ho).cameDays === 1 && of(hh, ho).lastCame === d(-1) && hh.nextBookings.length === 4
         && hh.nextBookings[0].class === '[Online] Membership Test' && hh.nextBookings.every(b => b.cover === 'pass'),
         JSON.stringify([hh.membership, hh.nextBookings]));
      ok('a day counted with no check-in (an online class) is told apart from the days checked in',
         of(hh, ho).cameOnline === 1 && a.cameOnline === 0 && a.cameDays === 6, JSON.stringify([of(hh, ho), a]));

      // The staff tag: 3 months, 14 days to go, nothing after it, 3 days came in the last 28.
      const tagOf = async (key, name, code, o, days, after) => {
        const m = await mk(key, name), id = await pass(m, code, o);
        for (const k of days) await seat(m, d(k), { pass: id });
        if (after) await pass(m, 'unlim1', { from: addD(o.until, 1), until: addD(o.until, 30) });
        return of(await hist(key), id);
      };
      const long = { from: d(-75), until: d(14) }, few = [-3, -10, -17];
      const low = await tagOf('END', 'Mem Ending', 'unlim3', long, [-3, -10, -27, -28]);
      ok('the last 28 days are today and the 27 days before it', low.cameDays === 4 && low.cameLast28 === 3, JSON.stringify(low));
      const seven = await tagOf('SEVEN', 'Mem Seven', 'unlim3', long, [-1, -2, -3, -4, -5, -6, -7]);
      ok('"ends soon, came little": a membership over a month long, 14 days or less to go, nothing after it, under 8 days in the last 28',
         low.endsSoonCameLittle === true && low.daysLeft === 15 && seven.endsSoonCameLittle === true && seven.cameLast28 === 7,
         JSON.stringify([low, seven]));
      const not = [
        await tagOf('KEEN', 'Mem Keen', 'unlim3', long, [-1, -2, -3, -4, -5, -6, -7, -8]),
        await tagOf('RENEW', 'Mem Renewed', 'unlim3', long, few, true),
        await tagOf('FAR', 'Mem Far', 'unlim3', { from: d(-74), until: d(15) }, few),
        await tagOf('ICE', 'Mem Iced', 'unlim3', { ...long, status: 'frozen', ffrom: d(-1), funtil: d(6) }, few),
        await tagOf('PKEND', 'Mem Packend', 'pack8', { from: d(-50), until: d(9), used: 3 }, few),
        hl,
      ];
      ok('...not with 8 days came, a pass that carries on, 15 days to go, a paused pass, a class pack or a 1-month pass',
         not.every(p => p.endsSoonCameLittle === false) && not[0].cameLast28 === 8 && not[2].daysLeft === 16, JSON.stringify(not));
      ok('"a week" is rounded to a half: 8 days in 76 is 0.5', not[0].perWeek === 0.5, JSON.stringify(not[0]));

      // ── what a second look found (14 Nov) ──
      // Staff fix a wrong pass by voiding it and giving the right one: the check-ins stay on the void pass.
      const fixed = await mk('FIX', 'Mem Fixed');
      const wrong = await pass(fixed, 'unlim3', { status: 'void', from: d(-70), until: d(19) });
      const right = await pass(fixed, 'unlim3', { from: d(-80), until: d(9) });
      for (const k of [-85, -60, -20, -9, -8, -7, -6, -5, -4, -3, -2]) await seat(fixed, d(k), { pass: wrong });
      const hf = of(await hist('FIX'), right);
      ok('a visit on a voided pass counts by its date on the pass given in its place', hf.cameDays === 10 && hf.cameLast28 === 9
         && hf.lastCame === d(-2) && hf.endsSoonCameLittle === false, JSON.stringify(hf));

      // The tag needs all of the last 28 days on the pass and not paused. A pause is [from, until).
      const span = { from: d(-98), until: d(12) };
      // Paused twice: the first pause is only in the note, and the second began and ended today.
      const twiceM = await mk('TP5', 'Mem Pausedtwice'), twiceP = await pass(twiceM, 'unlim3', { ...span, ffrom: d(0), funtil: d(0) });
      await pool.query(`UPDATE bkk_passes SET note='frozen 20d: test | frozen 6d: test' WHERE id=$1`, [twiceP]);
      for (const k of few) await seat(twiceM, d(k), { pass: twiceP });
      const tags = [
        await tagOf('TP1', 'Mem Pausedlately', 'unlim3', { ...span, ffrom: d(-24), funtil: d(-3) }, [-1, -2, -3, -40, -50]),
        await tagOf('TP2', 'Mem Pausededge', 'unlim3', { ...span, ffrom: d(-60), funtil: d(-26) }, few),
        await tagOf('TP3', 'Mem Shortdates', 'unlim3', { from: d(-26), until: d(9) }, few),
        await tagOf('TP4', 'Mem Nostart', 'unlim3', { until: d(9) }, []),
        of(await hist('TP5'), twiceP),
        await tagOf('TP6', 'Mem Pausedbefore', 'unlim3', { ...span, ffrom: d(-60), funtil: d(-27) }, few),
        await tagOf('TP7', 'Mem Fourweeks', 'unlim3', { from: d(-27), until: d(9) }, few),
        await tagOf('TP8', 'Mem Pausedaday', 'unlim3', { ...span, ffrom: d(0), funtil: d(0) }, few),
      ];
      ok('no "came little" when the last 28 days were not all on the pass: paused in them, begun in them, or no start day on file',
         tags.slice(0, 5).every(p => p.endsSoonCameLittle === false) && tags[0].cameLast28 === 3 && tags[0].perWeek === 0.5
         && tags[3].state === 'active' && tags[3].started === false && tags[4].perWeek === null, JSON.stringify(tags.slice(0, 5)));
      ok('...and it stays when the pause ended before those 28 days, the pass is 28 days old, or a pause began and ended the same day',
         tags.slice(5).every(p => p.endsSoonCameLittle === true), JSON.stringify(tags.slice(5)));

      // Only the latest pause keeps its dates.
      const again = await mk('AGAIN', 'Mem Twicepaused');
      const ag = await pass(again, 'unlim3', { from: d(-27), until: d(62) });
      for (const k of [-26, -24, -22, -20, -5, -3, -2, -1]) await seat(again, d(k), { pass: ag });
      const pw = async () => of(await hist('AGAIN'), ag).perWeek;
      const pwSteps = [await pw()];
      for (const step of ['freeze', 'unfreeze', 'freeze', 'unfreeze']) {
        await post(`/api/bkk/admin/passes/${ag}/${step}`, { days: 6, reason: 'test' }, ADMIN);
        pwSteps.push(await pw());
      }
      const noDates = await mk('NODATES', 'Mem Nopausedates');
      const nd = await pass(noDates, 'unlim3', { status: 'frozen', from: d(-55), until: d(60) });
      for (const k of [-55, -53, -51, -49]) await seat(noDates, d(k));
      const hn = of(await hist('NODATES'), nd);
      ok('no weekly number when the paused days cannot be counted: paused a second time, or paused with no dates on file',
         pwSteps.join() === '2,2,2,,' && hn.perWeek === null && hn.cameDays === 4 && hn.state === 'frozen', JSON.stringify([pwSteps, hn]));
      // A pause that came over from Rezerv is on file until the pass is paused here.
      const moved = await mk('MOVED', 'Mem Movedpause');
      const mv = await pass(moved, 'unlim3', { from: d(-27), until: d(62), ffrom: d(-20), funtil: d(-6) });
      await pool.query(`UPDATE bkk_passes SET note=$2 WHERE id=$1`, [mv, `moved from Rezerv | paused in Rezerv ${d(-20)} to ${d(-6)}`]);
      for (const k of [-26, -24, -4, -1]) await seat(moved, d(k), { pass: mv });
      const mvSteps = [of(await hist('MOVED'), mv).perWeek];
      await post(`/api/bkk/admin/passes/${mv}/freeze`, { days: 3, reason: 'test' }, ADMIN);
      mvSteps.push(of(await hist('MOVED'), mv).perWeek);
      ok('...a pause moved from Rezerv counts as the first one', mvSteps.join() === '2,', JSON.stringify(mvSteps));

      // A new pass starts on the day of the first class booked; an earlier class booked after that is still on it.
      const early = await mk('EARLY', 'Mem Early');
      const ep = await pass(early, 'pack8', { used: 2, from: d(-1), until: d(59) });
      await seat(early, d(-2), { pass: ep });
      await seat(early, d(-1), { pass: ep });
      await seat(early, d(-3));
      const he = await hist('EARLY');
      ok('a class paid with this pass before its start day is counted on it; one with no pass on it is not',
         of(he, ep).cameDays === 2 && of(he, ep).lastCame === d(-1) && he.summary.visits === 3, JSON.stringify(of(he, ep)));

      const r36 = await tagOf('R36', 'Mem Round36', 'unlim3', { from: d(-35), until: d(54) }, [0, -4, -8, -12, -16, -20, -24, -28, -32]);
      const r24 = await tagOf('R24', 'Mem Round24', 'unlim3', { from: d(-23), until: d(66) }, [0, -4, -8, -12, -16, -20]);
      ok('the same rate rounds the same way: 9 days in 36 and 6 days in 24 are both 2 a week', r36.perWeek === 2 && r24.perWeek === 2
         && r36.cameDays === 9 && r24.cameDays === 6, JSON.stringify([r36, r24]));

      // A class is taken from a pack when it is booked.
      const pre = await mk('PRE', 'Mem Prebooked');
      const pp = await pass(pre, 'pack8', { used: 5, from: d(-5), until: d(55) });
      await seat(pre, d(-5), { pass: pp });
      await seat(pre, d(-3), { pass: pp, in: false });           // never came: the class is used all the same
      await seat(pre, d(1), { pass: pp, in: false });
      await seat(pre, d(2), { pass: pp, in: false });
      await seat(pre, d(3), { pass: pp, status: 'cancelled' });
      await seat(pre, d(4), { in: false });                      // a Rezerv seat: not from this pack
      await seat(pre, d(5), { pass: pp });                       // checked in already: used
      const hpre = of(await hist('PRE'), pp);
      ok('a class pack tells seats still to come (booked) from classes that are over (used)', hpre.creditsUsed === 5 && hpre.creditsBooked === 2
         && hpre.creditsDone === 3 && hpre.creditsLeft === 3 && of(hp, pk).creditsBooked === 0 && of(hp, pk).creditsDone === 3
         && a.creditsBooked === null && a.creditsDone === null, JSON.stringify(hpre));

      const notYet = await mk('NOTST', 'Mem Notstarted');
      const ny = await pass(notYet, 'unlim1', { status: 'frozen', from: d(7), until: d(41), ffrom: d(0), funtil: d(5) });
      const hny = of(await hist('NOTST'), ny);
      ok('started says if the start day has come, whatever the state: a pass paused before it starts has not started',
         hny.state === 'frozen' && hny.started === false && hny.cameDays === 0 && hny.perWeek === null
         && a.started === true && fz.started === true && nx.started === false && fc.started === false && hl.started === true, JSON.stringify(hny));

      // A booking does not stop being one at the minute its class starts. Each seat has its own slot, so its time is always on file.
      const [sNow, sShort, sIn, sSoon] = await Promise.all([['now', 120], ['short', 30], ['in', 120], ['soon', 120]].map(async ([k, min]) => (await one(
        `INSERT INTO bkk_class_slots (code,title,kind,weekday,start_time,duration_min,capacity,is_online,active)
         VALUES ($1,$2,'test',1,'06:00',$3,10,false,false) RETURNING id`, ['test_mb_' + k, 'Membership Test ' + k, min])).id));
      const late = await mk('LATE', 'Mem Late');
      const lateSeat = (slot, mins, checkedIn) => { const t = new Date(Date.now() + mins * 60000);
        return pool.query(`INSERT INTO bkk_bookings (slot_id,class_date,start_at,member_id,status,checked_in_at,cover,source)
          VALUES ($1,$2,$3,$4,'booked',$5,'rezerv','staff')`, [slot, bkkMs(t.getTime()).slice(0, 10), t, late, checkedIn ? t : null]); };
      await lateSeat(sNow, -40);            // began 40 minutes ago, runs 120: on now, not in yet
      await lateSeat(sShort, -40);          // began 40 minutes ago, ran 30: over
      await lateSeat(sIn, -10, true);       // on now, and they are in
      await lateSeat(sSoon, 30);
      const hla = await hist('LATE');
      ok('next bookings: a class that is on now while they are not in yet is still one, first and marked; one that is over, or that they are in, is not',
         hla.nextBookings.map(b => `${b.class}:${b.onNow}`).join() === 'Membership Test now:true,Membership Test soon:false'
         && hla.nextBookingsMore === 0 && hla.visits.filter(v => v.upcoming).length === 1, JSON.stringify(hla.nextBookings));
      // Rezerv gives some classes no time: they are stored at 00:00 with no slot.
      const noTime = await mk('NOTIME', 'Mem Notime');
      const rz = (day, checkedIn) => pool.query(`INSERT INTO bkk_bookings (slot_id,class_date,start_at,member_id,status,checked_in_at,cover,source,class_title)
        VALUES (NULL,$1,$2,$3,'booked',$4,'rezerv','rezerv',$5)`, [day, at(day, '00:00'), noTime, checkedIn ? at(day, '00:00') : null, 'No Time ' + day]);
      await rz(d(-1)); await rz(d(0)); await rz(d(1));
      const hnt = await hist('NOTIME');
      ok('next bookings: a Rezerv seat today with no time on file is one for the whole day, with no time; yesterday\'s is not',
         hnt.nextBookings.map(b => `${b.date} ${b.time} ${b.onNow}`).join() === [`${d(0)} null false`, `${d(1)} null false`].join(), JSON.stringify(hnt.nextBookings));
      await pool.query(`UPDATE bkk_bookings SET checked_in_at = start_at WHERE member_id=$1 AND class_date=$2`, [noTime, d(0)]);
      ok('...and once they are checked in it is a visit, not a booking', (await hist('NOTIME')).nextBookings.map(b => b.date).join() === d(1));

      await pool.query(`DELETE FROM bkk_bookings WHERE member_id IN (SELECT id FROM bkk_members WHERE code LIKE 'BTESTMB%')`);
      await pool.query(`DELETE FROM bkk_passes WHERE member_id IN (SELECT id FROM bkk_members WHERE code LIKE 'BTESTMB%')`);
      await pool.query(`DELETE FROM bkk_members WHERE code LIKE 'BTESTMB%'`);
      await pool.query(`DELETE FROM bkk_class_slots WHERE code LIKE 'test_mb_%'`);
    }

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
    // Payments can come before any pass that makes a retired package.
    const no2 = !(await one(`SELECT 1 AS x FROM bkk_products WHERE code='unlim2'`)).x;
    const p32r = await imp('payments', [{ rezervId: 'P-32', memberRezervId: 'RZ-1005', date: '2026-09-29', amount: '19110',
      item: '2 months unlimited (18200thb + online transaction fee 5%)' }]);
    const p32 = await one(`SELECT pr.code, pr.active FROM bkk_orders o JOIN bkk_products pr ON pr.id=o.product_id
      WHERE o.source='rezerv' AND o.source_ref='P-32'`);
    ok('a payment for the retired 2-month package, before any pass: the package is made, never for sale',
       no2 && p32r.body.added === 1 && p32.code === 'unlim2' && p32.active === false, JSON.stringify([no2, p32r.body, p32]));
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
    ok('the quiet list leaves out someone who bought their first pass today', !repT.notSeen.some(x => x.code === anna.body.member.code)
       && repT.notSeen.every(x => ['todo', 'resting', 'parked'].includes(x.state)), JSON.stringify(repT.notSeen.map(x => x.name)));
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

    // ── Rezerv's own export files, read by the admin page as M uploads them (2 Nov 2026) ──
    // The headings and value shapes are Rezerv's exactly; the people are made up.
    console.log('\n— the Rezerv export files, through the admin page —');
    {
      const fs = require('fs'), vm = require('vm'), path = require('path');
      const page = fs.readFileSync(path.join(__dirname, '../public/bkk-admin.html'), 'utf8');
      const seg = page.slice(page.indexOf('  const AL = {'), page.indexOf("  // The server's reasons and notes come in English"));
      // The page's reading code, as it runs in the browser: headings matched, dates put day first, phones joined.
      const readFile = (kind, text) => {
        const ctx = { STR: { en: {} }, T: x => x, TextDecoder, Uint8Array };
        vm.createContext(ctx);
        vm.runInContext(seg + '\n;this.ci = { CI, ciRead, ciBatches, rowFor };', ctx);
        ctx.ci.CI.kind = kind;
        ctx.ci.read = ctx.ci.ciRead(text);
        return ctx.ci;
      };
      const csv = (head, rows) => '﻿' + [head, ...rows.map(r => head.split(',').map(h => {
        const v = String(r[h] ?? '');
        return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
      }).join(','))].join('\r\n') + '\r\n';
      const run = async (kind, text, dryRun = false) => {
        const ci = readFile(kind, text);
        const out = { added: 0, matched: 0, updated: 0, newMembers: 0, skipped: [], warnings: [] };
        for (const b of ci.ciBatches()) {
          const r = await post(`/api/bkk/admin/import/${kind}`, { rows: b.rows, dryRun, firstRow: b.first }, ADMIN);
          for (const k of ['added', 'matched', 'updated', 'newMembers']) out[k] += r.body[k] || 0;
          out.skipped.push(...(r.body.skipped || [])); out.warnings.push(...(r.body.warnings || []));
        }
        out.map = Object.fromEntries(Object.entries(ci.CI.map).map(([f, i]) => [f, ci.CI.heads[i]]));
        out.mdy = [...ci.CI.mdy];
        out.sent = ci.CI.rows.map(r => ci.rowFor(r));
        return out;
      };
      const ymdParts = d => d.split('-');
      const dmyy = d => { const [y, m, dd] = ymdParts(d); return `${dd}/${m}/${y.slice(2)}`; };
      const dmyyyy = d => { const [y, m, dd] = ymdParts(d); return `${dd}/${m}/${y}`; };
      const skipCodes = r => r.skipped.map(s => s.code).sort().join();
      const warnCodes = r => r.warnings.map(w => w.code).sort().join();
      const who = rz => one('SELECT * FROM bkk_members WHERE rezerv_id=$1', [rz]);

      // Students: "Customers" export. Country code apart from the number, joined date DD/MM/YY HH:MM.
      const STUDENTS = 'CustomerName,MobileCode,Mobile,Email,RezervPass ID,DateOfBirth,Gender,AddressLine1,AddressLine2,City,State,PostalCode,Country,Group,Tag,LifeCycle,JoinedDate,Channel,Status,Completed,Booked,No Show,Cancelled,Late Cancelled,Waitlist Cancelled,Waitlist Expired,Total Booking';
      const studs = await run('members', csv(STUDENTS, [
        { CustomerName: 'Mali Rezervtest', MobileCode: '66', Mobile: '0812345601', Email: 'mali.rezervtest@example.com', 'RezervPass ID': '990101',
          DateOfBirth: '01/02/1990', Gender: 'Female', AddressLine1: '1 Test Road', City: 'Bangkok', Country: 'Thailand', JoinedDate: '15/03/24 07:12', Status: 'Active' },
        { CustomerName: 'Ivan Rezervtest', MobileCode: '7', Mobile: '9161234502', Email: 'ivan.rezervtest@example.com', 'RezervPass ID': '990102', JoinedDate: '02/11/26 18:40', Status: 'Active' },
        { CustomerName: 'Wei Rezervtest', MobileCode: '86', Mobile: '13812345603', 'RezervPass ID': '990103', JoinedDate: '09/09/25 05:01', Status: 'Active' },
        { CustomerName: 'Same Rezervtest', MobileCode: '66', Email: 'same.rezervtest@example.com', 'RezervPass ID': '990104', JoinedDate: '01/01/25 10:00', Status: 'Active' },
        { CustomerName: 'Same Rezervtest', 'RezervPass ID': '990105', JoinedDate: '02/01/25 10:00', Status: 'Suspended' },
        { CustomerName: 'Nophone Rezervtest', MobileCode: '66', Email: 'nophone.rezervtest@example.com', 'RezervPass ID': '990106', JoinedDate: '03/01/25 10:00', Status: 'Active' },
      ]));
      ok('students file: Rezerv id, joined date and the country code are matched by their Rezerv headings',
         studs.map.rezervId === 'RezervPass ID' && studs.map.joinedOn === 'JoinedDate' && studs.map.phone === 'Mobile'
         && studs.map.phoneCode === 'MobileCode' && studs.map.name === 'CustomerName' && studs.map.email === 'Email', JSON.stringify(studs.map));
      ok('...a birthday, address or booking count never leaves the page',
         studs.sent.every(o => Object.keys(o).every(k => ['rezervId', 'name', 'email', 'phone', 'joinedOn'].includes(k))), JSON.stringify(studs.sent[0]));
      ok('...every student added, the two with one name kept apart by their Rezerv ids', studs.added === 6 && !studs.skipped.length,
         JSON.stringify(studs));
      const mali = await who('990101'), ivan = await who('990102'), wei = await who('990103'), noph = await who('990106');
      ok('...phones carry the country code, without the local 0; no number is no phone',
         mali.phone === '+66 812345601' && ivan.phone === '+7 9161234502' && wei.phone === '+86 13812345603'
         && (await who('990104')).phone === null && noph.phone === null, JSON.stringify([mali.phone, ivan.phone, wei.phone, noph.phone]));
      ok('...the joined date is read day first', (await one(`SELECT to_char(joined_on,'YYYY-MM-DD') AS d FROM bkk_members WHERE rezerv_id='990101'`)).d === '2024-03-15'
         && (await one(`SELECT to_char(joined_on,'YYYY-MM-DD') AS d FROM bkk_members WHERE rezerv_id='990102'`)).d === '2026-11-02');

      // Memberships: unlimited passes, dates DD/MM/YY, Rezerv's status, cancel and freeze columns.
      const MEMBERSHIPS = 'First_Name,Last_Name,Mobile,Email,RezervPass ID,Membership,Membership Number,Category,Status,Joining Fee,Renews,Renews On,Purchase_Date,Start_Date,Expiration_Date,Cancel,Cancelled date,Booking,Completed,Paid amount,Total class credits,Remaining class credits,Total appointment credits,Remaining appointment credits,Total outlet access credits,Remaining outlet access credits,Credits period,Recognised revenue,Deferred revenue,Amount,Billing cycle,Freeze start date,Freeze end date,Freeze reason,Last_Transaction_ID,Last_Transaction_Date,Last_Transaction_Status,Last_Booking_Completed_Date,Last_Booking_Ref,Last_Booking_Class,Next_Booked_Date,Next_Booking_Ref,Next_Booking_Class';
      const T0 = todayB;
      const ms = (first, last, rz, plan, status, start, end, more = {}) => ({ First_Name: first, Last_Name: last, Mobile: '',
        Email: '', 'RezervPass ID': rz, Membership: plan, Category: 'Dedicated Students membership', Status: status, Renews: 'No', Renews_On: '--',
        Purchase_Date: dmyy(start), Start_Date: dmyy(start), Expiration_Date: dmyy(end), Cancel: 'No', 'Cancelled date': '--',
        'Paid amount': '0.00', 'Remaining class credits': '0', 'Freeze start date': '--', 'Freeze end date': '--', 'Freeze reason': '--',
        Last_Transaction_Status: 'Paid', ...more });
      const memb = await run('passes', csv(MEMBERSHIPS, [
        ms('Mali', 'Rezervtest', '990101', '1 Year (13 months)', 'Active', addD(T0, -30), addD(T0, 365)),
        ms('Mali', 'Rezervtest', '990101', '1 Year (13 months)', 'Inactive', addD(T0, -30), addD(T0, 365)),
        ms('Ivan', 'Rezervtest', '990102', '3 months Unlimited', 'Expired', '2025-01-01', '2025-03-31'),
        ms('Ivan', 'Rezervtest', '990102', '12 Months unlimited (1 free month 78000thb+ online transaction fee 5%))', 'Active',
          addD(T0, -60), addD(T0, 335), { 'Freeze start date': dmyy(addD(T0, -3)), 'Freeze end date': dmyy(addD(T0, 10)), 'Freeze reason': 'injury' }),
        ms('Wei', 'Rezervtest', '990103', '1 Month unlimited (9600thb + online transaction fee 5%)', 'Inactive', addD(T0, 5), addD(T0, 34)),
        ms('Wei', 'Rezervtest', '990103', '1 Month unlimited (9600thb + online transaction fee 5%)', `Starts ${dmyy(addD(T0, 5))}`, addD(T0, 5), addD(T0, 34)),
        ms('Same', 'Rezervtest', '990104', '6 months Unlimited', 'Active', addD(T0, -20), addD(T0, 160), { Cancel: 'Yes', 'Cancelled date': dmyy(addD(T0, -1)) }),
        ms('Same', 'Rezervtest', '990105', '2 months unlimited (18200thb + online transaction fee 5%)', 'Inactive', addD(T0, -10), addD(T0, 50)),
        ms('Nophone', 'Rezervtest', '990106', '1 Year (13 months)', 'Active', addD(T0, -10), addD(T0, 337), { Mobile: '+66' }),
        ms('Wei', 'Rezervtest', '990103', '12 Months unlimited', 'Expired', '2025-01-01', '2026-01-01'),
        ms('Orphan', 'Rezervtest', '990199', '1 Month Unlimited (6900thb + online transaction fee 5%)', 'Expired', '2025-02-01', '2025-03-02',
          { Email: 'orphan.rezervtest@example.com', Mobile: '+66 0899990199' }),
      ]));
      ok('memberships file: package, dates, status, cancel and pause columns are matched by their Rezerv headings',
         memb.map.plan === 'Membership' && memb.map.until === 'Expiration_Date' && memb.map.start === 'Start_Date' && memb.map.status === 'Status'
         && memb.map.cancelled === 'Cancel' && memb.map.cancelledOn === 'Cancelled date' && memb.map.frozenFrom === 'Freeze start date'
         && memb.map.frozenUntil === 'Freeze end date' && memb.map.memberRezervId === 'RezervPass ID' && memb.map.lastName === 'Last_Name'
         && memb.map.rezervId === 'Membership Number', JSON.stringify(memb.map));
      ok('...every pass lands, a pass Rezerv lists twice once, a customer missing from the students file made new',
         memb.added === 9 && memb.matched === 1 && memb.updated === 1 && memb.newMembers === 1 && !memb.skipped.length
         && warnCodes(memb) === 'newStudent,passOff,passOff,passOff', JSON.stringify(memb));
      const passOf = async (rz, extra = '') => (await pool.query(`SELECT p.*, pr.code, to_char(p.valid_from,'YYYY-MM-DD') AS f,
          to_char(p.valid_until,'YYYY-MM-DD') AS u, to_char(p.frozen_from,'YYYY-MM-DD') AS ff, to_char(p.frozen_until,'YYYY-MM-DD') AS fu
        FROM bkk_passes p JOIN bkk_products pr ON pr.id=p.product_id JOIN bkk_members m ON m.id=p.member_id
        WHERE m.rezerv_id=$1 ${extra} ORDER BY p.valid_until`, [rz])).rows;
      const [maliYear] = await passOf('990101');
      ok('"1 Year (13 months)" is the 13-month package, active, with Rezerv\'s own dates; its "Inactive" copy changes nothing',
         maliYear.code === 'unlim12' && maliYear.status === 'active' && maliYear.f === addD(T0, -30) && maliYear.u === addD(T0, 365)
         && (await passOf('990101')).length === 1, JSON.stringify(maliYear));
      const [ivanOld, ivanYear] = await passOf('990102');
      ok('an expired pass is history: kept with its dates, past its end', ivanOld.code === 'unlim3' && ivanOld.u === '2025-03-31' && ivanOld.status === 'active',
         JSON.stringify(ivanOld));
      ok('a pass paused in Rezerv stays paused here, with Rezerv\'s pause dates and its real end date',
         ivanYear.code === 'unlim12' && ivanYear.status === 'frozen' && ivanYear.ff === addD(T0, -3) && ivanYear.fu === addD(T0, 10)
         && ivanYear.u === addD(T0, 335), JSON.stringify(ivanYear));
      const weiPasses = await passOf('990103');
      ok('"Starts …" is a pass that begins on its start date, though its "Inactive" copy came first; a bare "12 Months" year of 365 days is the new 12-month package',
         weiPasses.filter(p => p.code === 'unlim1').length === 1 && weiPasses.some(p => p.code === 'unlim1' && p.status === 'active' && p.f === addD(T0, 5))
         && weiPasses.some(p => p.code === 'unlim12m' && p.u === '2026-01-01'), JSON.stringify(weiPasses));
      const [cancelled] = await passOf('990104'), [inactive] = await passOf('990105');
      ok('a cancelled membership and an "Inactive" one never let anyone in, though their end dates are still to come',
         cancelled.status === 'void' && cancelled.code === 'unlim6' && cancelled.u === addD(T0, 160) && /cancelled on/.test(cancelled.note)
         && inactive.status === 'void' && inactive.code === 'unlim2' && /Inactive in Rezerv/.test(inactive.note), JSON.stringify([cancelled, inactive]));
      const activeOf = async rz => (await J(`/api/bkk/admin/members/${(await who(rz)).code}/history`, { headers: ADMIN })).body.summary.activePass;
      const [actMali, actCancel, actInactive, actFrozen] = await Promise.all(['990101', '990104', '990105', '990102'].map(activeOf));
      ok('...so the cancelled, "Inactive" and paused students hold no pass they can book with; the active year can',
         actMali && actMali.name === '12 months unlimited (1 free month)' && actCancel === null && actInactive === null && actFrozen === null,
         JSON.stringify([actMali, actCancel, actInactive, actFrozen]));
      const [nophYear] = await passOf('990106');
      ok('a "1 Year (13 months)" cut to 347 days by hand stays the 13-month package; "+66" alone is no phone',
         nophYear.code === 'unlim12' && (await who('990106')).phone === null, JSON.stringify(nophYear));
      const orphan = await who('990199');
      ok('...the customer missing from the students file comes with their Rezerv id and email',
         orphan.name === 'Orphan Rezervtest' && orphan.email === 'orphan.rezervtest@example.com' && orphan.phone === '+66 0899990199');

      // Rezerv's own pass id ("Membership Number") finds a pass again after staff
      // paused, extended or voided it here; two pass ids are two passes.
      const mn = (rz, n, plan, status, start, end, more = {}) => ms('Pass', `Idtest${rz.slice(-1)}`, rz, plan, status, start, end,
        { 'Membership Number': n, ...more });
      const MONTH1 = '1 Month unlimited (9600thb + online transaction fee 5%)';
      const byId = [
        mn('990201', '99020101', '3 months Unlimited', 'Active', addD(T0, -10), addD(T0, 79)),
        mn('990202', '99020201', '3 months Unlimited', 'Active', addD(T0, -10), addD(T0, 79)),
        mn('990203', '99020301', MONTH1, 'Expired', addD(T0, -20), addD(T0, 9)),
        mn('990204', '99020401', MONTH1, 'Active', addD(T0, -5), addD(T0, 24),
          { 'Freeze start date': dmyy(addD(T0, 3)), 'Freeze end date': dmyy(addD(T0, 10)), 'Freeze reason': 'travel' }),
        mn('990205', '99020501', '3 months Unlimited', 'Active', addD(T0, -10), addD(T0, 79), { Start_Date: '--' }),
        mn('990206', '99020601', '3 months Unlimited', 'Expired', '2025-01-01', '2025-03-31'),
        mn('990206', '99020602', '3 months Unlimited', 'Inactive', '2025-01-01', '2025-03-31'),
      ];
      const ids1 = await run('passes', csv(MEMBERSHIPS, byId));
      ok('passes with their Membership Number: every one lands, two numbers with one package and end date are two passes',
         ids1.added === 7 && ids1.newMembers === 6 && !ids1.skipped.length
         && warnCodes(ids1) === 'freezeLater,newStudent,newStudent,newStudent,newStudent,newStudent,newStudent,passOff', JSON.stringify(ids1));
      const [ended] = await passOf('990203'), [later] = await passOf('990204'), [noStart] = await passOf('990205'), twoIds = await passOf('990206');
      ok('"Expired" while its end date is still to come is history, never a pass to book with',
         ended.status === 'void' && /Expired in Rezerv/.test(ended.note) && (await activeOf('990203')) === null, JSON.stringify(ended));
      ok('a pause Rezerv has still to come: the pass stays active with no pause dates, and a note says to pause it on that day',
         later.status === 'active' && later.ff === null && later.fu === null
         && ids1.warnings.some(w => w.code === 'freezeLater' && w.vals[0] === addD(T0, 3)), JSON.stringify(later));
      const days3 = (await one(`SELECT valid_days FROM bkk_products WHERE code='unlim3'`)).valid_days;
      ok('a start date of "--" next to a real end date: the start is worked back from the end',
         noStart.status === 'active' && noStart.u === addD(T0, 79) && noStart.f === addD(T0, 79 - (days3 - 1)), JSON.stringify(noStart));
      ok('...the two passes under two numbers keep their own ids, the "Inactive" one void',
         twoIds.length === 2 && twoIds.map(p => `${p.source_ref}:${p.status}`).sort().join() === '99020601:active,99020602:void', JSON.stringify(twoIds));
      const [pA] = await passOf('990201'), [pB] = await passOf('990202');
      const staff = [await post(`/api/bkk/admin/passes/${pA.id}/freeze`, { days: 14, reason: 'test' }, ADMIN),
        await post(`/api/bkk/admin/passes/${pB.id}/extend`, { days: 7, reason: 'test' }, ADMIN),
        await post(`/api/bkk/admin/passes/${noStart.id}/void`, { reason: 'test' }, ADMIN)];
      const ids2 = await run('passes', csv(MEMBERSHIPS, byId));
      ok('the same file again after staff paused, extended and voided passes here: nothing added, nothing changed',
         staff.every(r => r.status === 200) && ids2.added === 0 && ids2.matched === 7 && ids2.updated === 0 && !ids2.skipped.length,
         JSON.stringify([staff.map(r => r.status), ids2]));
      const [aNow, bNow, eNow] = await Promise.all(['990201', '990202', '990205'].map(rz => passOf(rz)));
      ok('...the paused pass stays paused and alone, the extended one keeps its new end, the voided one stays void',
         aNow.length === 1 && aNow[0].status === 'frozen' && aNow[0].u === addD(T0, 93) && bNow.length === 1 && bNow[0].status === 'active'
         && bNow[0].u === addD(T0, 86) && eNow.length === 1 && eNow[0].status === 'void' && (await activeOf('990201')) === null,
         JSON.stringify([aNow, bNow, eNow]));
      const legacy = mn('990207', '', '3 months Unlimited', 'Active', addD(T0, -10), addD(T0, 79));
      const l1 = await run('passes', csv(MEMBERSHIPS, [legacy]));
      const [pL] = await passOf('990207');
      await post(`/api/bkk/admin/passes/${pL.id}/extend`, { days: 5, reason: 'test' }, ADMIN);
      const withId = { ...legacy, 'Membership Number': '99020701' };
      const [l2, l3] = [await run('passes', csv(MEMBERSHIPS, [withId])), await run('passes', csv(MEMBERSHIPS, [withId]))];
      const lNow = await passOf('990207');
      ok('a pass imported before without its number, extended here since: found by its start date and given the number',
         l1.added === 1 && l2.added === 0 && l2.matched === 1 && l3.added === 0 && l3.matched === 1 && lNow.length === 1
         && lNow[0].source_ref === '99020701' && lNow[0].u === addD(T0, 84), JSON.stringify([l2, l3, lNow]));

      // A pass list that is not Rezerv's: a status word we do not know is no status, as before.
      const other = await run('passes', csv('Name,Email,Package,End date,Status', [
        { Name: 'Status Onetest', Email: 'status.one.rezervtest@example.com', Package: '1 month', 'End date': dmyyyy(addD(T0, 20)), Status: 'Paid' },
        { Name: 'Status Twotest', Email: 'status.two.rezervtest@example.com', Package: '3 months', 'End date': dmyyyy(addD(T0, 60)), Status: 'Renewed' },
        { Name: 'Status Threetest', Email: 'status.three.rezervtest@example.com', Package: '10 classes', 'End date': dmyyyy(addD(T0, 60)), Status: 'OK' },
      ]));
      const otherLive = (await one(`SELECT count(*)::int AS n FROM bkk_passes p JOIN bkk_members m ON m.id=p.member_id
        WHERE m.email LIKE 'status.%.rezervtest@example.com' AND p.status='active'`)).n;
      ok('another pass list: an unknown status word ("Paid", "Renewed", "OK") is read as no status with a note, and the pass is kept',
         other.map.status === 'Status' && other.added === 3 && !other.skipped.length && otherLive === 3
         && other.warnings.filter(w => w.code === 'passStatus').length === 3, JSON.stringify([other, otherLive]));

      // Packages: drop-ins and 10-class packs, dates DD/MM/YYYY, no customer id, credits left in "Unutilised Credit Balance".
      const PACKAGES = 'First Name,Last Name,Mobile Code,Mobile,Email,RezervPass ID,Packages,Category,Total Credit,Paid Amount,Revenue Per Credit,Used Credits,Recognised Revenue,Unutilised Credit Balance,Deferred Revenue,Expired Credits,Expired Recognised Revenue,Package Status,Purchase Date,Activation Type,Start Date,Expiration Date,Invoice No,Transaction Id,Receipt No,Transaction Status,Last Booking Completed Date,Last Booking Ref,Last Booking Service,Paid On';
      const pk = (first, email, plan, status, start, end, total, used, left, expired) => ({ 'First Name': first, 'Last Name': 'Rezervtest',
        'Mobile Code': '66', Mobile: '', Email: email, Packages: plan, 'Total Credit': total, 'Used Credits': used, 'Unutilised Credit Balance': left,
        'Expired Credits': expired, 'Package Status': status, 'Purchase Date': start === '--' ? dmyyyy(T0) : dmyyyy(start),
        'Activation Type': 'Date of first booking', 'Start Date': start === '--' ? '--' : dmyyyy(start), 'Expiration Date': end === '--' ? '--' : dmyyyy(end),
        'Transaction Status': 'Paid' });
      const packs = await run('passes', csv(PACKAGES, [
        pk('Mali', 'mali.rezervtest@example.com', '10 classes/3mo (14000thb + online transaction fee 5%)', 'Active', addD(T0, -10), addD(T0, 80), 10, 3, 7, 0),
        pk('Ivan', 'ivan.rezervtest@example.com', 'Drop-in (1500thb + online transaction fee 5%)', 'Expired', '2025-05-06', '2025-05-06', 1, 1, 0, 0),
        pk('Wei', '', 'Full workshop with Guest Teachers', 'Expired', '2025-03-01', '2025-03-28', 7, 4, 0, 3),
        pk('Wei', '', 'Drop-in', 'Expired', '--', '--', 1, 0, 0, 1),
        pk('Mali', 'mali.rezervtest@example.com', 'Mysore 5.30am (1st batch) (Refunded credits)', 'Expired', '2025-06-01', '2025-07-01', 1, 1, 0, 0),
      ]));
      ok('packages file: "Packages", "Unutilised Credit Balance" and "Package Status" are matched',
         packs.map.plan === 'Packages' && packs.map.classesLeft === 'Unutilised Credit Balance' && packs.map.status === 'Package Status'
         && packs.map.phoneCode === 'Mobile Code' && packs.map.rezervId === 'Transaction Id', JSON.stringify(packs.map));
      ok('...a 10-class pack, a drop-in and a credit given back land; a workshop and a drop-in never started do not',
         packs.added === 3 && skipCodes(packs) === 'badPlan,neverStarted', JSON.stringify(packs));
      const maliPasses = await passOf('990101');
      ok('...the 10-class pack keeps the classes left, from the credit balance',
         maliPasses.some(p => p.code === 'pack10' && p.credits_total === 10 && p.credits_used === 3 && p.status === 'active')
         && maliPasses.some(p => p.code === 'dropin' && p.u === '2025-07-01')
         && (await passOf('990102')).some(p => p.code === 'dropin' && p.credits_used === 1 && p.u === '2025-05-06'), JSON.stringify(maliPasses));

      // Visits: one export per year, DD/MM/YYYY and "05:30 AM", Rezerv's booking ref, statuses as Rezerv words them.
      const VISITS = 'Date of service,Start time,End time,Duration,Booking Day,Booking created,Service Type,Category,Service Name,Location,Facility,Staff,Equipment,Booking Ref/No.,Customer,Mobile number,Email address,RezervPass ID,Status,Spot,Booking type,Transaction_ID,Invoice ID,Paid On,Payment,Credit Used,Total pricing plan credit,Slot per booking,Total Slots,Revenue per booking,Total transaction revenue,SoldAt,BusinessName';
      const my530 = (await pool.query(`SELECT id, weekday FROM bkk_class_slots WHERE code LIKE 'my530_%' AND active ORDER BY weekday`)).rows;
      let fd = addD(T0, 40);
      while (!my530.some(s => s.weekday === new Date(fd + 'T12:00:00Z').getUTCDay()) || isMoon(fd)) fd = addD(fd, 1);
      const fdSlot = my530.find(s => s.weekday === new Date(fd + 'T12:00:00Z').getUTCDay()).id;
      const vr = (date, time, cls, ref, name, email, rz, status) => ({ 'Date of service': dmyyyy(date), 'Start time': time, 'End time': '07:30 AM',
        'Booking created': `${dmyyyy(date)} 09:15 PM`, 'Service Type': 'Class', Category: 'Mysore class', 'Service Name': cls, 'Booking Ref/No.': ref,
        Customer: name, 'Mobile number': '+66', 'Email address': email, 'RezervPass ID': rz, Status: status, 'Booking type': 'Single' });
      const visits = await run('visits', csv(VISITS, [
        vr('2025-03-04', '05:30 AM', 'Mysore 5.30am (1st batch)', 'TSTREF01', 'Mali Rezervtest', 'mali.rezervtest@example.com', '990101', 'Completed'),
        vr('2025-03-04', '05:30 AM', 'Mysore 5.30am (1st batch)', 'TSTREF02', 'Mali Rezervtest', 'mali.rezervtest@example.com', '990101', 'Cancelled'),
        vr('2025-03-04', '05:30 AM', 'Mysore 5.30am (1st batch)', 'TSTREF03', 'Ivan Rezervtest', 'ivan.rezervtest@example.com', '990102', 'Late Cancelled'),
        vr('2025-03-05', '05:30 AM', 'Mysore 5.30am (1st batch)', 'TSTREF04', 'Ivan Rezervtest', 'ivan.rezervtest@example.com', '990102', 'No Show'),
        vr('2025-03-01', '08:45 AM', '[Online] Led intermediate series', 'TSTREF05', 'Wei Rezervtest', '', '990103', 'Completed'),
        vr('2025-03-04', '05:30 AM', 'Mysore 5.30am (1st batch)', 'TSTREF01', 'Mali Rezervtest', 'mali.rezervtest@example.com', '990101', 'Completed'),
        vr(fd, '05:30 AM', 'Mysore 5.30am (1st batch)', 'TSTREF07', 'Mali Rezervtest', 'mali.rezervtest@example.com', '990101', 'Booked'),
        vr('2025-03-06', '05:30 AM', 'Mysore 5.30am (1st batch)', 'TSTREF08', 'Guest Onetest', 'guest.one.rezervtest@example.com', '0', 'Completed'),
      ]));
      ok('visits file: "Date of service" and "Booking Ref/No." are matched, no column picked by hand',
         visits.map.date === 'Date of service' && visits.map.rezervId === 'Booking Ref/No.' && visits.map.time === 'Start time'
         && visits.map.className === 'Service Name' && visits.map.memberRezervId === 'RezervPass ID' && visits.map.status === 'Status', JSON.stringify(visits.map));
      ok('...every visit lands once; the copy of one is matched; a guest with customer id 0 is a new student',
         visits.added === 7 && visits.matched === 1 && visits.newMembers === 1 && !visits.skipped.length, JSON.stringify(visits));
      const vis = async ref => one(`SELECT b.*, s.code AS scode, m.rezerv_id AS mrz, m.name AS mname FROM bkk_bookings b
        LEFT JOIN bkk_class_slots s ON s.id=b.slot_id JOIN bkk_members m ON m.id=b.member_id WHERE b.source='rezerv' AND b.source_ref=$1`, [ref]);
      const [v1, v2, v3, v4, v5, v7, v8] = await Promise.all(['TSTREF01', 'TSTREF02', 'TSTREF03', 'TSTREF04', 'TSTREF05', 'TSTREF07', 'TSTREF08'].map(vis));
      ok('Completed is a visit on the 05:30 Mysore; a cancel Rezerv kept next to it is its own record, not "checked in at our door"',
         v1.scode === 'my530_2' && v1.status === 'booked' && v1.checked_in_at && v1.mrz === '990101'
         && v2.status === 'cancelled' && v2.cancel_reason === 'cancelled in Rezerv' && !visits.warnings.some(w => w.code === 'cameDoor'),
         JSON.stringify([v1, v2, visits.warnings]));
      ok('Late Cancelled is a late cancel, No Show a no-show', v3.status === 'cancelled' && v3.cancel_reason === 'late cancel (Rezerv)'
         && v4.status === 'noshow' && v4.mrz === '990102', JSON.stringify([v3, v4]));
      ok('an online class Rezerv ran at 08:45 is not put on the shala\'s 08:45 class', v5.slot_id === null
         && v5.class_title === '[Online] Led intermediate series' && v5.checked_in_at && v5.mrz === '990103', JSON.stringify(v5));
      ok('a booking still to come is a seat on that class\'s list', v7.slot_id === fdSlot && v7.status === 'booked' && !v7.checked_in_at
         && v7.cover === 'rezerv' && String(v7.class_date) && v7.mrz === '990101', JSON.stringify(v7));
      ok('...the guest with customer id 0 has no Rezerv id here', v8.mname === 'Guest Onetest' && v8.mrz === null, JSON.stringify(v8));

      // Payments: "Paid On" is MONTH first (MM/DD/YYYY HH:MM:SS); "Amount" is before VAT, "Paid Amount" what was paid.
      const PAYMENTS = 'Paid On,TransactionID,Issued On,Invoice ID,CustomerName,MobileCode,Mobile,Email,RezervPass ID,Item Type,Linked Item,Quantity,Payment Method,Sales Channel,Location,Sold By,Amount,Discount,Tax,Paid Amount,Fee,Net Amount,Promo Code Set,Promo Code,Value,Value Type,Status,Original TransactionId,Brand,Comment,Pis Receipt Number,External Transaction ID,Order ID';
      const pr_ = (paidOn, id, name, email, rz, type, item, method, amount, tax, paid, more = {}) => ({ 'Paid On': paidOn, TransactionID: id, 'Issued On': paidOn,
        CustomerName: name, MobileCode: '66', Mobile: '', Email: email, 'RezervPass ID': rz, 'Item Type': type, 'Linked Item': item, Quantity: '1',
        'Payment Method': method, 'Sales Channel': 'Business Portal', Amount: amount, Discount: '0.00', Tax: tax, 'Paid Amount': paid,
        Fee: '0.00', 'Net Amount': paid, Status: 'Paid', ...more });
      const payRows = [
        pr_('03/15/2024 05:42:10', 'TRX_99000000001', 'Mali Rezervtest', 'mali.rezervtest@example.com', '990101', 'Membership', '1 Year (13 months)', 'CARD', '48598.13', '3401.87', '52000.00'),
        pr_('11/02/2025 06:10:00', 'TRX_99000000002', 'Ivan Rezervtest', 'ivan.rezervtest@example.com', '990102', 'Booking', 'Mysore 5.30am (1st batch)', 'PROMPTPAY', '1575.00', '110.25', '1685.25'),
        pr_('10/05/2026 07:00:00', 'TRX_99000000003', 'Wei Rezervtest', '', '990103', 'Membership', '6 months Unlimited', 'Free', '0.00', '0.00', '0.00',
          { Discount: '45000.00', Comment: 'paid by bank transfer 45,000' }),
        pr_('01/20/2025 10:00:00', 'TRX_99000000004', 'Same Rezervtest', 'same.rezervtest@example.com', '990104', 'Course', 'Guest teacher workshop Mar 1-4, 2025', 'Other - paysolution', '16000.00', '1120.00', '17120.00'),
        pr_('03/06/2025 05:20:00', 'TRX_99000000005', 'Guest Onetest', 'guest.one.rezervtest@example.com', '0', 'Booking', 'Led Primary series', 'CARD', '1500.00', '105.00', '1605.00'),
        pr_('03/07/2025 05:20:00', 'TRX_99000000006', 'Guest Twotest', 'guest.two.rezervtest@example.com', '0', 'Booking', 'Led Primary series', 'CARD', '1500.00', '105.00', '1605.00'),
      ];
      const pays = await run('payments', csv(PAYMENTS, payRows));
      ok('payments file: "Paid Amount" is the money, "Tax" the VAT, "Linked Item" the item, and Paid On is read month first',
         pays.map.amount === 'Paid Amount' && pays.map.vat === 'Tax' && pays.map.item === 'Linked Item' && pays.map.date === 'Paid On'
         && pays.map.rezervId === 'TransactionID' && pays.map.method === 'Payment Method' && pays.map.note === 'Comment'
         && pays.mdy.join() === 'date', JSON.stringify([pays.map, pays.mdy]));
      ok('...every payment lands; the second guest with customer id 0 is someone else', pays.added === 6 && pays.newMembers === 1 && !pays.skipped.length,
         JSON.stringify(pays));
      const pay = async id => one(`SELECT o.*, pr.code AS pcode, pr.active AS pactive, m.rezerv_id AS mrz, m.name AS mname,
          to_char(o.verified_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD HH24:MI') AS at
        FROM bkk_orders o LEFT JOIN bkk_products pr ON pr.id=o.product_id JOIN bkk_members m ON m.id=o.member_id
        WHERE o.source='rezerv' AND o.source_ref=$1`, [id]);
      const [q1, q2, q3, q4, q5, q6] = await Promise.all([1, 2, 3, 4, 5, 6].map(n => pay(`TRX_9900000000${n}`)));
      ok('a year pass: what the student paid, its VAT, on the day and time it was paid',
         q1.amount_thb === 52000 && q1.vat_thb === 3402 && q1.base_thb === 48598 && q1.at === '2024-03-15 05:42' && q1.method === 'card'
         && q1.pcode === 'unlim12' && q1.item_name === '1 Year (13 months)' && q1.mrz === '990101', JSON.stringify(q1));
      ok('11/02/2025 is 2 Nov, not 11 Feb; a class paid for on its own is a drop-in; PromptPay is a transfer',
         q2.at === '2025-11-02 06:10' && q2.pcode === 'dropin' && q2.amount_thb === 1685 && q2.method === 'transfer', JSON.stringify(q2));
      ok('a pass Rezerv logged as Free stays 0 baht, its comment kept as the note, on the old 6-month package',
         q3.amount_thb === 0 && q3.status === 'paid' && q3.method === 'other' && /paid by bank transfer 45,000/.test(q3.gateway_note)
         && /Free/.test(q3.gateway_note) && q3.pcode === 'unlim6' && q3.pactive === false && q3.at === '2026-10-05 07:00', JSON.stringify(q3));
      ok('a workshop keeps its own name, no package; "Other - paysolution" is an online payment',
         q4.product_id === null && q4.item_name === 'Guest teacher workshop Mar 1-4, 2025' && q4.method === 'online' && q4.amount_thb === 17120, JSON.stringify(q4));
      ok('customer id 0 is no id: each guest is found by email', q5.mname === 'Guest Onetest' && q6.mname === 'Guest Twotest'
         && q5.member_id === v8.member_id && q5.member_id !== q6.member_id, JSON.stringify([q5.member_id, q6.member_id, v8.member_id]));
      const paysAgain = await run('payments', csv(PAYMENTS, payRows));
      ok('importing the same payments again adds nothing twice', paysAgain.added === 0 && paysAgain.matched === 6, JSON.stringify(paysAgain));
      const voided = await run('payments', csv(PAYMENTS, [{ ...payRows[0], Status: 'Voided' }, { ...payRows[1], TransactionID: 'TRX_99000000009', Status: 'Voided' }]));
      ok('a payment Rezerv voided since stops counting as money; a voided one never imported is not kept',
         voided.updated === 1 && skipCodes(voided) === 'notMoney' && (await pay('TRX_99000000001')).status === 'void', JSON.stringify(voided));
      // A short export can hold only days up to the 12th, which reads either way.
      const short = readFile('payments', csv(PAYMENTS, [pr_('11/01/2026 06:00:00', 'TRX_99000000010', 'Mali Rezervtest', '', '990101', 'Booking',
        'Mysore Sunday', 'CARD', '1500.00', '105.00', '1605.00')]));
      const plain = readFile('payments', 'Date,Amount,Name\r\n11/01/2026,1500,Someone Rezervtest\r\n');
      ok('a short Rezerv payments export with only days up to the 12th is still month first; another file is day first',
         short.rowFor(short.CI.rows[0]).date === '01/11/2026 06:00:00' && plain.rowFor(plain.CI.rows[0]).date === '11/01/2026',
         JSON.stringify([short.rowFor(short.CI.rows[0]), plain.rowFor(plain.CI.rows[0])]));
      // Rezerv's voided-payments export, with M picking the date and amount columns by hand.
      const voidCsv = csv('Date voided on,Voided transaction ID,Original transaction ID,Customer name,Net amount,Item type,Linked item,Payment method,Staff who\'s voided,Reason for void',
        [{ 'Date voided on': '5 jan 2024 10:00am', 'Voided transaction ID': 'PISV_99000000001', 'Original transaction ID': 'PIS_99000000001',
          'Customer name': 'Void Rezervtest', 'Net amount': '30000.00', 'Item type': 'Membership', 'Linked item': '6 months Unlimited',
          'Payment method': 'CARD', 'Reason for void': 'made up' }]);
      const refused = ['payments', 'members', 'visits', 'passes'].map(kind => {
        const v = readFile(kind, voidCsv);
        Object.assign(v.CI.map, { date: 0, amount: 4, name: 3 });
        return v.read === 'ciVoidFile' && v.CI.rows.length === 0 && v.ciBatches().length === 0;
      });
      ok('the voided-payments export is refused as any kind: even with the date and amount picked by hand, no row can be sent',
         refused.every(Boolean), JSON.stringify(refused));
    }

    // No admin key set: the admin is closed, not open on a default.
    const keep = [process.env.BKK_ADMIN_KEY, process.env.SHOP_ADMIN_KEY];
    delete process.env.BKK_ADMIN_KEY; delete process.env.SHOP_ADMIN_KEY;
    const app2 = express();
    app2.use(express.json());
    mountBkk(app2, { pgPool: pool, now });
    require('../shop-api.js').mountShop(app2, { dataDir: require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'shop-')) });
    require('../idcn-api.js').mountIdcn(app2, { pgPool: pool });
    require('../partner-api.js').mountPartner(app2, { pgPool: pool });
    process.env.BKK_ADMIN_KEY = keep[0];
    if (keep[1] != null) process.env.SHOP_ADMIN_KEY = keep[1];
    const srv2 = app2.listen(0);
    const at2 = (p, init = {}) => fetch(`http://127.0.0.1:${srv2.address().port}${p}`, init).then(r => r.status);
    const st2 = key => at2('/api/bkk/admin/export/members.csv', { headers: key == null ? {} : { 'x-bkk-key': key } });
    ok('with no admin key set, nothing opens the admin: not the old default key, not an empty one',
       (await st2('aybkk2026')) === 401 && (await st2('')) === 401 && (await st2(null)) === 401);
    const shopSt = key => at2('/api/shop/admin/orders', { headers: key == null ? {} : { 'x-shop-key': key } });
    const idcnSt = key => at2('/api/idcn/admin/idcn3/students', { headers: key == null ? {} : { 'x-bkk-key': key } });
    const locSt = key => at2('/api/loc/seed-demo', { method: 'POST', headers: key == null ? {} : { 'x-bkk-key': key } });
    ok('with no admin key set, the shop, course and partner admins stay closed to the old public default and to no key',
       (await shopSt('aybkk2026')) === 401 && (await shopSt(null)) === 401 && (await at2('/api/shop/admin/orders?key=aybkk2026')) === 401
       && (await idcnSt('aybkk2026')) === 401 && (await idcnSt(null)) === 401
       && (await locSt('aybkk2026')) === 401 && (await locSt(null)) === 401);
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
         && r.every(x => Object.keys(x).sort().join() === 'bookedAt,bookingId,checkedInAt,code,cover,dropin,name,needMat,passName,photo,source,status')
         && !JSON.stringify(inA.body).includes('@example.com') && !JSON.stringify(inA.body).includes('080-000'),
       JSON.stringify(r));
    const cl = inA.body.cancelledList || [];
    ok('...then who cancelled, newest first, with the reason',
       cl.length === 2 && cl[0].name === 'Cal Lee' && cl[0].reason === null && cl[1].name === 'Cal Kim' && cl[1].reason === 'cal test reason'
         && cl[1].code === 'BTESTCALKIM' && !!cl[1].cancelledAt, JSON.stringify(cl));
    const ca = inA.body.class || {};
    ok('...and the class: counts, end time, over, and (a few days back) it still takes someone who came',
       ca.key === `s:${slotA}:${P}` && ca.booked === 3 && ca.checkedIn === 2 && ca.noShows === 1 && ca.capacity === 4
         && ca.endAt === at(P, '07:00') && ca.started === true && ca.ended === true && ca.canAdd === true, JSON.stringify(ca));
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
    // Today's date, with start times set by hand so the test holds at any hour.
    const agoSlot = await mkSlot('test_cal_ago', wdOf(todayB), '05:30', 30, 10, false);
    const endedAt = new Date(Date.now() - 2 * 3600e3).toISOString();
    const endedIn = await checkin(await addBk({ slot: agoSlot, date: todayB, at: endedAt, member: mem.zed }));
    ok("today's class that has ended is checked in at its start, not at the tap",
       endedIn.status === 200 && Date.parse(endedIn.body.booking.checkedInAt) === Date.parse(endedAt), JSON.stringify(endedIn.body));
    const runSlot = await mkSlot('test_cal_run', wdOf(todayB), '06:00', 120, 10, false);
    const runIn = await checkin(await addBk({ slot: runSlot, date: todayB, at: new Date(Date.now() - 10 * 60e3).toISOString(), member: mem.zed }));
    ok('...a class still running is checked in at the tap', runIn.status === 200
       && Math.abs(Date.parse(runIn.body.booking.checkedInAt) - Date.now()) < 60000, JSON.stringify(runIn.body));
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
    const sch14 = (await J('/api/bkk/schedule?days=14', { headers: ADMIN })).body.classes.find(c => c.slotId === slotF && c.date === F) || {};
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

    // Someone came to Friday's 05:30 without booking, and nobody put them on
    // the list before it ended. The class view sends late: true and adds them
    // as came, up to 7 days back; the door never sends it.
    console.log('  adding someone who came to a class that is over');
    const lateWalk = (slotId, date, body, h = ADMIN) => post('/api/bkk/admin/walkin', { slotId, date, late: true, ...body }, h);
    const seatsOf = async (slotId, date, name) => (await pool.query(`SELECT b.id, b.checked_in_at, b.start_at, b.source, b.cover, b.pass_id
      FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id
      WHERE b.slot_id=$1 AND b.class_date=$2 AND b.status='booked' AND m.name=$3`, [slotId, date, name])).rows;
    const people = async name => (await pool.query('SELECT count(*)::int AS n FROM bkk_members WHERE name=$1', [name])).rows[0].n;
    const sameTime = (a, b) => Date.parse(a) === Date.parse(b);
    const L = back(3);                                  // 3 days back, or 4 past a moon day
    let E8 = addD(todayB, -8); while (isMoon(E8)) E8 = addD(E8, -1);
    let offD = addD(L, 1); while (isMoon(offD)) offD = addD(offD, 1);
    const slotL = await mkSlot('test_late_3', wdOf(L), '05:30', 120, 2);
    const slotE8 = await mkSlot('test_late_8', wdOf(E8), '05:30', 120, 20);
    const slotX = await mkSlot('test_late_cxl', wdOf(L), '17:00', 60, 20);
    const slotM = await mkSlot('test_late_moon', wdOf(M), '05:30', 120, 20);
    await pool.query(`INSERT INTO bkk_class_overrides (slot_id, class_date, cancelled, note) VALUES ($1,$2,true,'late test')`, [slotX, L]);

    const inL = (await cls({ slotId: slotL, date: L })).body.class || {};
    const inE8 = (await cls({ slotId: slotE8, date: E8 })).body.class || {};
    const inX = (await cls({ slotId: slotX, date: L })).body.class || {};
    ok('inside a class that ended 3 days ago, someone can be added; 8 days ago or closed, not',
       inL.ended === true && inL.canAdd === true && inE8.ended === true && inE8.canAdd === false
         && inX.cancelled === true && inX.canAdd === false, JSON.stringify({ inL, inE8, inX }));

    ok('a late add needs the staff key', (await lateWalk(slotL, L, { name: 'Late NoKey', cover: 'rezerv' }, {})).status === 401
       && (await people('Late NoKey')) === 0);
    ok('...and late must be true or false', (await post('/api/bkk/admin/walkin',
      { slotId: slotL, date: L, late: 'yes', name: 'Late Odd', cover: 'rezerv' }, ADMIN)).status === 400);
    const doorLate = await post('/api/bkk/admin/walkin', { slotId: slotL, date: L, name: 'Late Door', cover: 'rezerv' }, ADMIN);
    ok("the door's walk-in (no late) for a class that is over is still refused, and leaves no profile",
       doorLate.status === 409 && doorLate.body.error === 'that class has already ended' && (await people('Late Door')) === 0,
       JSON.stringify(doorLate.body));

    const lz = await lateWalk(slotL, L, { name: 'Late Rezerv', cover: 'rezerv', checkIn: false, requestId: 'test-late-rezerv' });
    const lzRows = await seatsOf(slotL, L, 'Late Rezerv');
    ok('a class 3 days ago takes someone who came: on the list, checked in at the class start (even with checkIn false)',
       lz.status === 200 && lz.body.success && lz.body.checkedIn === true && lz.body.cover === 'rezerv' && lzRows.length === 1
         && sameTime(lzRows[0].checked_in_at, at(L, '05:30')) && lzRows[0].source === 'door', JSON.stringify({ body: lz.body, lzRows }));
    const lz2 = await lateWalk(slotL, L, { name: 'Late Rezerv', cover: 'rezerv', checkIn: false, requestId: 'test-late-rezerv' });
    ok('...the same request twice adds no one twice: one profile, one seat',
       lz2.status === 200 && lz2.body.repeat === true && lz2.body.checkedIn === true && (await people('Late Rezerv')) === 1
         && (await seatsOf(slotL, L, 'Late Rezerv')).length === 1, JSON.stringify(lz2.body));
    const inLNow = (await cls({ slotId: slotL, date: L })).body.class || {};
    ok('...and the class counts them as came', inLNow.booked === 1 && inLNow.checkedIn === 1, JSON.stringify(inLNow));

    const pk = (await post('/api/bkk/admin/passes', { name: 'Late Pack', email: 'late.pack@example.com', productCode: 'pack10' }, ADMIN)).body.member.code;
    const lp = await lateWalk(slotL, L, { memberCode: pk, cover: 'pass' });
    const lpRows = await seatsOf(slotL, L, 'Late Pack');
    ok('an aybkk.net pack pays for it: exactly one class used', lp.status === 200 && lp.body.cover === 'pass' && lpRows.length === 1
       && lpRows[0].pass_id && sameTime(lpRows[0].checked_in_at, at(L, '05:30')) && (await credits(pk)) === 1,
       JSON.stringify({ body: lp.body, lpRows, used: await credits(pk) }));
    ok('...and a class over capacity still takes them (they were in the room)', lp.body.overCapacity === false
       && (await lateWalk(slotL, L, { name: 'Late Third', cover: 'rezerv' })).body.overCapacity === true);

    const nw0 = await post('/api/bkk/admin/passes', { name: 'Late Newpass', email: 'late.newpass@example.com', productCode: 'pack10',
      validFrom: todayB, validUntil: addD(todayB, 30) }, ADMIN);
    const lnp = await lateWalk(slotL, L, { memberCode: nw0.body.member.code, cover: 'pass' });
    ok('a pass that starts after the class day is refused, with the day and the way out',
       nw0.status === 200 && lnp.status === 409 && lnp.body.noPass === true && lnp.body.date === L
         && lnp.body.error.includes('Late Newpass has no aybkk.net pass for ') && /Rezerv package or Drop-in/.test(lnp.body.error)
         && !(await seatsOf(slotL, L, 'Late Newpass')).length && (await credits(nw0.body.member.code)) === 0, JSON.stringify(lnp.body));
    // A pass that covered the class day but has run out since.
    const gone = await mkMember('BTESTLATEGONE', 'Late Gone');
    await pool.query(`INSERT INTO bkk_passes (member_id,product_id,kind,credits_total,credits_used,valid_days,valid_from,valid_until,status)
      VALUES ($1,(SELECT id FROM bkk_products WHERE code='pack10'),'credits',10,2,60,$2,$3,'active')`, [gone, addD(L, -20), addD(todayB, -1)]);
    const hasPass = async on => ((await J('/api/bkk/admin/members?' + new URLSearchParams({ q: 'Late Gone', ...(on ? { on } : {}) }),
      { headers: ADMIN })).body.members || []).map(x => x.has_pass).join();
    const hasNew = async on => ((await J('/api/bkk/admin/members?' + new URLSearchParams({ q: 'Late Newpass', ...(on ? { on } : {}) }),
      { headers: ADMIN })).body.members || []).map(x => x.has_pass).join();
    ok("the add's search says who has a pass on the class day (?on=), not only today",
       (await hasPass()) === 'false' && (await hasPass(L)) === 'true' && (await hasNew()) === 'true' && (await hasNew(L)) === 'false',
       JSON.stringify([await hasPass(), await hasPass(L), await hasNew(), await hasNew(L)]));
    const lg = await lateWalk(slotL, L, { memberCode: 'BTESTLATEGONE', cover: 'pass' });
    ok('...and that pass pays for the class it covered', lg.status === 200 && lg.body.cover === 'pass'
       && (await pool.query('SELECT credits_used FROM bkk_passes WHERE member_id=$1', [gone])).rows[0].credits_used === 3, JSON.stringify(lg.body));

    const booked = await mkMember('BTESTLATEBOOKED', 'Late Booked');
    await addBk({ slot: slotL, date: L, at: at(L, '05:30'), member: booked });
    const lb = await lateWalk(slotL, L, { memberCode: 'BTESTLATEBOOKED', cover: 'rezerv' });
    const lbRows = await seatsOf(slotL, L, 'Late Booked');
    ok('someone already on the list is checked in at the class start, no second seat',
       lb.status === 200 && lb.body.already === true && lbRows.length === 1 && sameTime(lbRows[0].checked_in_at, at(L, '05:30')),
       JSON.stringify({ body: lb.body, lbRows }));

    const cash0 = (((await J('/api/bkk/admin/today', { headers: ADMIN })).body.money || []).find(x => x.method === 'transfer') || {}).total || 0;
    const ld = await lateWalk(slotL, L, { name: 'Late Cash', cover: 'dropin', method: 'transfer', requestId: 'test-late-cash' });
    const ldRows = await seatsOf(slotL, L, 'Late Cash');
    const ldOrd = (await pool.query(`SELECT o.status, to_char(o.class_date,'YYYY-MM-DD') AS class_date,
        to_char(o.verified_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') AS paid_on
      FROM bkk_orders o JOIN bkk_members m ON m.id=o.member_id WHERE m.name='Late Cash'`)).rows;
    const cash1 = (((await J('/api/bkk/admin/today', { headers: ADMIN })).body.money || []).find(x => x.method === 'transfer') || {}).total || 0;
    ok("a drop-in sold for it is today's money, and books that class as came",
       ld.status === 200 && ld.body.cover === 'dropin' && /^\d+$/.test(ld.body.refno || '') && ldRows.length === 1
         && sameTime(ldRows[0].checked_in_at, at(L, '05:30')) && ldOrd.length === 1 && ldOrd[0].status === 'paid'
         && ldOrd[0].class_date === L && ldOrd[0].paid_on === todayB && cash1 === cash0 + 1605,
       JSON.stringify({ body: ld.body, ldRows, ldOrd, cash0, cash1 }));
    const ld2 = await lateWalk(slotL, L, { name: 'Late Cash', cover: 'dropin', method: 'transfer', requestId: 'test-late-cash' });
    ok('...sent twice, it is sold once', ld2.status === 200 && ld2.body.repeat === true && ld2.body.refno === ld.body.refno
       && (await pool.query(`SELECT count(*)::int AS n FROM bkk_orders o JOIN bkk_members m ON m.id=o.member_id WHERE m.name='Late Cash'`)).rows[0].n === 1,
       JSON.stringify(ld2.body));

    const mkPass = async (memberId, o) => (await pool.query(`INSERT INTO bkk_passes
        (member_id,product_id,kind,credits_total,credits_used,valid_days,valid_from,valid_until,status,frozen_from,frozen_until)
      VALUES ($1,(SELECT id FROM bkk_products WHERE code='pack10'),'credits',10,$2,60,$3,$4,$5,$6,$7) RETURNING id`,
      [memberId, o.used || 0, o.from, o.until, o.status || 'active', o.ff ?? null, o.fu ?? null])).rows[0].id;
    const rowsOf = async (slotId, date, code) => (await pool.query(`SELECT b.status, b.checked_in_at FROM bkk_bookings b
      JOIN bkk_members m ON m.id=b.member_id WHERE b.slot_id=$1 AND b.class_date=$2 AND m.code=$3 AND b.status <> 'cancelled'
      ORDER BY b.id`, [slotId, date, code])).rows;
    const search = async (name, on) => ((await J('/api/bkk/admin/members?' + new URLSearchParams({ q: name, ...(on ? { on } : {}) }),
      { headers: ADMIN })).body.members || [])[0] || {};

    // The visits import writes a Rezerv no-show for a booking never checked in.
    // They came after all: that seat becomes the visit, nothing is added twice.
    const nsA = await mkMember('BTESTLATENS', 'Late Noshow');
    await addBk({ slot: slotL, date: L, at: at(L, '05:30'), member: nsA, status: 'noshow', source: 'rezerv', ref: 'test-late-ns-1' });
    const ns1 = await lateWalk(slotL, L, { memberCode: 'BTESTLATENS', cover: 'rezerv', requestId: 'test-late-ns-a' });
    const nsRows = await rowsOf(slotL, L, 'BTESTLATENS');
    const nsCls = (await cls({ slotId: slotL, date: L })).body;
    ok('a Rezerv no-show on that class becomes the visit: one seat, checked in at the start, no no-show left',
       ns1.status === 200 && ns1.body.already === true && ns1.body.checkedIn === true && nsRows.length === 1
         && nsRows[0].status === 'booked' && sameTime(nsRows[0].checked_in_at, at(L, '05:30'))
         && nsCls.class.noShows === 0 && nsCls.roster.filter(r => r.code === 'BTESTLATENS').length === 1,
       JSON.stringify({ body: ns1.body, nsRows, c: nsCls.class }));
    const nsB = await mkMember('BTESTLATENSPK', 'Late Noshow Pack');
    await mkPass(nsB, { from: addD(L, -10), until: addD(todayB, 30) });
    await addBk({ slot: slotL, date: L, at: at(L, '05:30'), member: nsB, status: 'noshow', source: 'rezerv', ref: 'test-late-ns-2' });
    const ns2 = await lateWalk(slotL, L, { memberCode: 'BTESTLATENSPK', cover: 'pass' });
    const ns2Rows = await rowsOf(slotL, L, 'BTESTLATENSPK');
    ok('...even with their pass chosen: one seat, no class used', ns2.status === 200 && ns2.body.already === true
       && ns2Rows.length === 1 && ns2Rows[0].status === 'booked' && (await credits('BTESTLATENSPK')) === 0,
       JSON.stringify({ body: ns2.body, ns2Rows }));
    const nsC = await mkMember('BTESTLATENSDI', 'Late Noshow Drop');
    await addBk({ slot: slotL, date: L, at: at(L, '05:30'), member: nsC, status: 'noshow', source: 'rezerv', ref: 'test-late-ns-3' });
    const ns3 = await lateWalk(slotL, L, { memberCode: 'BTESTLATENSDI', cover: 'dropin', method: 'cash' });
    ok('...and no drop-in is sold to them', ns3.status === 200 && ns3.body.already === true && !ns3.body.refno
       && (await rowsOf(slotL, L, 'BTESTLATENSDI')).length === 1
       && (await pool.query('SELECT count(*)::int AS n FROM bkk_orders WHERE member_id=$1', [nsC])).rows[0].n === 0, JSON.stringify(ns3.body));

    // A pause counts on the class day, not today.
    const fzWas = await mkMember('BTESTLATEFZWAS', 'Late Paused Then');
    await mkPass(fzWas, { from: addD(L, -20), until: addD(todayB, 30), ff: addD(L, -1), fu: addD(L, 1) });
    const fw = await lateWalk(slotL, L, { memberCode: 'BTESTLATEFZWAS', cover: 'pass' });
    ok('a pass paused on the class day (unpaused since) does not pay for it, and the search says so',
       fw.status === 409 && fw.body.noPass === true && (await search('Late Paused Then', L)).has_pass === false
         && (await search('Late Paused Then')).has_pass === true && (await credits('BTESTLATEFZWAS')) === 0, JSON.stringify(fw.body));
    const fzNow = await mkMember('BTESTLATEFZNOW', 'Late Paused Now');
    const fzPid = await mkPass(fzNow, { from: addD(L, -20), until: addD(todayB, 30) });
    const fzr = await post(`/api/bkk/admin/passes/${fzPid}/freeze`, { days: 7, reason: 'test' }, ADMIN);
    const fn = await lateWalk(slotL, L, { memberCode: 'BTESTLATEFZNOW', cover: 'pass' });
    ok('a pass live on the class day and paused today pays for it: one class used, and the search says so',
       fzr.status === 200 && fn.status === 200 && fn.body.cover === 'pass' && (await credits('BTESTLATEFZNOW')) === 1
         && (await search('Late Paused Now', L)).has_pass === true && (await search('Late Paused Now')).has_pass === false,
       JSON.stringify(fn.body));
    const fzOld = await mkMember('BTESTLATEFZOLD', 'Late Paused Unknown');
    await mkPass(fzOld, { from: addD(L, -20), until: addD(todayB, 30), status: 'frozen' });
    const fo = await lateWalk(slotL, L, { memberCode: 'BTESTLATEFZOLD', cover: 'pass' });
    ok('...but a pass paused with no start day on file never pays', fo.status === 409 && fo.body.noPass === true
       && (await search('Late Paused Unknown', L)).has_pass === false, JSON.stringify(fo.body));

    // The wrong person picked: staff taking them off give the class back.
    const wr = await mkMember('BTESTLATEWRONG', 'Late Wrong Pick');
    await mkPass(wr, { from: addD(L, -10), until: addD(todayB, 30) });
    await lateWalk(slotL, L, { memberCode: 'BTESTLATEWRONG', cover: 'pass', requestId: 'test-late-wrong-1' });
    const wrUsed = await credits('BTESTLATEWRONG');
    const wrId = (await pool.query(`SELECT id FROM bkk_bookings WHERE request_id='test-late-wrong-1'`)).rows[0].id;
    const wc = await post(`/api/bkk/bookings/${wrId}/cancel`, {}, ADMIN);
    ok('staff cancelling someone added after the class was over gives the class back',
       wrUsed === 1 && wc.status === 200 && wc.body.creditReturned === true && (await credits('BTESTLATEWRONG')) === 0, JSON.stringify(wc.body));
    await lateWalk(slotL, L, { memberCode: 'BTESTLATEWRONG', cover: 'pass', requestId: 'test-late-wrong-2' });
    const wr2 = (await pool.query(`SELECT id FROM bkk_bookings WHERE request_id='test-late-wrong-2'`)).rows[0].id;
    const sc = await post(`/api/bkk/bookings/${wr2}/cancel`, { memberCode: 'BTESTLATEWRONG' });
    ok('...but the student cancelling it does not get it back', sc.status === 200 && sc.body.creditReturned === false
       && (await credits('BTESTLATEWRONG')) === 1, JSON.stringify(sc.body));
    const lateEarly = await mkMember('BTESTLATEEARLY', 'Late Booked Early');
    const ePid = await mkPass(lateEarly, { from: addD(L, -10), until: addD(todayB, 30), used: 1 });
    const eBk = await addBk({ slot: slotL, date: L, at: at(L, '05:30'), member: lateEarly, pass: ePid, cover: 'pass', source: 'student' });
    await pool.query(`UPDATE bkk_bookings SET booked_at = start_at - interval '1 day' WHERE id=$1`, [eBk]);
    const ec = await post(`/api/bkk/bookings/${eBk}/cancel`, {}, ADMIN);
    ok('...and a seat booked before the class, cancelled by staff after it, keeps the 5-hour rule',
       ec.status === 200 && ec.body.creditReturned === false && (await credits('BTESTLATEEARLY')) === 1, JSON.stringify(ec.body));

    const nx = await post('/api/bkk/admin/passes', { name: 'Late Nextweek', email: 'late.nextweek@example.com', productCode: 'pack10',
      validFrom: addD(todayB, 7), validUntil: addD(todayB, 37) }, ADMIN);
    const nxS = await search('Late Nextweek'), nxL = await search('Late Nextweek', L), lpS = await search('Late Pack');
    ok("the add's search says when a pass that has not started yet starts",
       nx.status === 200 && nxS.has_pass === true && nxS.pass_starts === addD(todayB, 7) && nxL.has_pass === false
         && nxL.pass_starts === null && lpS.has_pass === true && lpS.pass_starts === null,
       JSON.stringify({ nxS: [nxS.has_pass, nxS.pass_starts], nxL: [nxL.has_pass, nxL.pass_starts], lpS: [lpS.has_pass, lpS.pass_starts] }));

    const l8 = await lateWalk(slotE8, E8, { name: 'Late Eight', cover: 'rezerv' });
    ok('a class more than 7 days ago is refused, and leaves no profile', l8.status === 409
       && l8.body.error === 'that class was more than 7 days ago' && (await people('Late Eight')) === 0, JSON.stringify(l8.body));
    const l8d = await lateWalk(slotE8, E8, { name: 'Late Eight Cash', cover: 'dropin', method: 'cash' });
    ok('...and nothing is sold for it', l8d.status === 409 && (await people('Late Eight Cash')) === 0);
    const lx = await lateWalk(slotX, L, { name: 'Late Closed', cover: 'rezerv' });
    ok('a closed class is refused', lx.status === 409 && lx.body.error === 'class cancelled' && (await people('Late Closed')) === 0,
       JSON.stringify(lx.body));
    const lm = await lateWalk(slotM, M, { name: 'Late Moon', cover: 'rezerv' });
    const loff = await lateWalk(slotL, offD, { name: 'Late Offday', cover: 'rezerv' });
    ok('a moon day, or a day the class does not run, is refused',
       lm.status === 409 && /moon day/.test(lm.body.error) && loff.status === 409 && loff.body.error === 'that class is not on that day'
         && (await people('Late Moon')) === 0 && (await people('Late Offday')) === 0, JSON.stringify([lm.body, loff.body]));
    const ahead = await post('/api/bkk/admin/walkin', { slotId: slotF, date: F, late: true, checkIn: false, name: 'Late Ahead', cover: 'rezerv' }, ADMIN);
    const aheadRows = (await pool.query(`SELECT b.checked_in_at, b.source FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id
      WHERE b.slot_id=$1 AND b.class_date=$2 AND b.status='booked' AND m.name='Late Ahead'`, [slotF, F])).rows;
    ok('...and a class still to come is as before: late changes nothing there', ahead.status === 200 && ahead.body.checkedIn === false
       && aheadRows.length === 1 && aheadRows[0].checked_in_at === null && aheadRows[0].source === 'staff', JSON.stringify({ body: ahead.body, aheadRows }));

    // Today's class that ended a minute in: 00:00 to 00:01. The same slot a week back is 7 days ago, the last day allowed.
    const hm = new Date(Date.now() + 7 * 3600e3).toISOString().slice(11, 16);
    const slotT = await mkSlot('test_late_today', wdOf(todayB), '00:00', 1, 20);
    if (isMoon(todayB) || hm < '00:02') console.log(`  - SKIPPED (moon day or just after midnight): a class that ended today`);
    else {
      const inT = (await cls({ slotId: slotT, date: todayB })).body.class || {};
      const lt = await lateWalk(slotT, todayB, { name: 'Late Today', cover: 'rezerv', checkIn: false });
      const ltRows = await seatsOf(slotT, todayB, 'Late Today');
      ok("today's class after its end time: added and checked in at its start",
         inT.ended === true && inT.canAdd === true && lt.status === 200 && lt.body.checkedIn === true && ltRows.length === 1
           && sameTime(ltRows[0].checked_in_at, at(todayB, '00:00')), JSON.stringify({ inT, body: lt.body, ltRows }));
    }
    const D7 = addD(todayB, -7);
    if (isMoon(D7)) console.log(`  - SKIPPED (moon day 7 days ago): the last day allowed`);
    else {
      const l7 = await lateWalk(slotT, D7, { name: 'Late Seven', cover: 'rezerv' });
      ok('a class exactly 7 days ago still takes someone who came', l7.status === 200 && l7.body.checkedIn === true
         && (await seatsOf(slotT, D7, 'Late Seven')).length === 1, JSON.stringify(l7.body));
    }
    await pool.query(`UPDATE bkk_class_slots SET active=false WHERE code LIKE 'test_late_%'`);

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

  console.log("\n-- the student's own face (profile photo) --");
  {
    const FACE = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
    const LINK = /^\/api\/bkk\/face\/([0-9a-f]{24})\.([sl])\.(\d+)\.[\w-]{22}$/;
    const faceUps = () => uploads.filter(u => u.folder === 'aybkk-profile');
    const upFace = (code, img = FACE) => post(`/api/bkk/me/${code}/photo`, { imageBase64: img });
    const rowOf = async code => (await pool.query('SELECT id, photo_id, photo_at, photo_tries FROM bkk_members WHERE code=$1', [code])).rows[0];
    const get = async path => { const r = await fetch(B + path); return { status: r.status, type: r.headers.get('content-type'),
      cache: r.headers.get('cache-control'), bytes: Buffer.from(await r.arrayBuffer()) }; };
    const newMember = async (name, email) => (await post('/api/bkk/teacher/members', { name, email }, PKEY)).body.member;
    const sam = await newMember('Sam Faceless', 'sam.face@example.com');
    const tia = await newMember('Tia Facetwo', 'tia.face@example.com');
    const uma = await newMember('Uma Noface', 'uma.face@example.com');
    clock = bkkAt('2026-11-10T00:00:00');

    const me0 = (await J(`/api/bkk/me/${sam.code}`)).body;
    ok('/me says photo: null for a student with no photo', me0.photo === null && me0.member.name === 'Sam Faceless', JSON.stringify(me0.photo));

    const n0 = faceUps().length;
    const up1 = await upFace(sam.code);
    const u1 = faceUps()[n0];
    ok('a student uploads a photo with their own member code', up1.status === 200 && up1.body.success === true
       && LINK.test(up1.body.photo.small) && LINK.test(up1.body.photo.large), JSON.stringify(up1.body));
    ok('stored private (authenticated) in the aybkk-profile folder', u1 && u1.type === 'authenticated' && u1.folder === 'aybkk-profile', JSON.stringify(u1));
    ok('under a random id, never the member code or the name', u1 && /^[0-9a-f]{24}$/.test(u1.given)
       && !u1.public_id.includes(sam.code) && !/sam|face/i.test(u1.given), JSON.stringify(u1));
    const tr = (u1 && u1.transformation || [])[0] || {};
    ok('cropped square around the face, 600 px', tr.width === 600 && tr.height === 600 && tr.crop === 'fill' && tr.gravity === 'face', JSON.stringify(tr));
    const r1 = await rowOf(sam.code);
    ok('the member row keeps the photo id and when it came', r1.photo_id === u1.public_id && r1.photo_at instanceof Date, JSON.stringify(r1));

    const me1 = (await J(`/api/bkk/me/${sam.code}`)).body;
    const [, ref, sz, exp] = LINK.exec(me1.photo && me1.photo.small || '') || [];
    const [, refL, szL] = LINK.exec(me1.photo && me1.photo.large || '') || [];
    ok('/me gives a small and a large signed link to the same photo', sz === 's' && szL === 'l' && ref === u1.given && refL === ref, JSON.stringify(me1.photo));
    const life = Number(exp) - Math.floor(clock / 1000);
    ok('a link lasts 6 to 12 hours', life > 6 * 3600 && life <= 12 * 3600, String(life));
    ok('...and stays the same link meanwhile, so the browser keeps it', (await J(`/api/bkk/me/${sam.code}`)).body.photo.small === me1.photo.small);
    ok('a link never carries the member code', !JSON.stringify(me1.photo).includes(sam.code));

    const calls0 = urlCalls.length;
    const small = await get(me1.photo.small), large = await get(me1.photo.large);
    ok('the small link shows the photo, kept private in the browser cache', small.status === 200 && small.type === 'image/jpeg'
       && small.bytes[0] === 0xFF && /^private, max-age=\d+$/.test(small.cache || ''), JSON.stringify([small.status, small.type, small.cache]));
    const asked = urlCalls.slice(calls0);
    ok('...fetched with signed private Cloudinary links, 160 px and 600 px squares', large.status === 200 && asked.length === 2
       && asked.every(c => c.id === u1.public_id && c.o.type === 'authenticated' && c.o.sign_url === true)
       && asked[0].o.transformation[0].width === 160 && asked[0].o.transformation[0].height === 160 && asked[0].o.transformation[0].crop === 'fill'
       && asked[1].o.transformation[0].width === 600 && driveFetches.includes(`signed://authenticated/${u1.public_id}/160`), JSON.stringify(asked));
    ok('a link changed by hand is refused', (await get(me1.photo.small.replace('.s.', '.l.'))).status === 403
       && (await get(me1.photo.small.replace(/\.\d+\./, `.${Number(exp) + 21600}.`))).status === 403
       && (await get('/api/bkk/face/nonsense')).status === 404);
    clock = bkkAt('2026-11-10T13:00:00');
    ok('a link stops working once it has expired', (await get(me1.photo.small)).status === 410);
    clock = bkkAt('2026-11-10T00:00:00');

    ok('a wrong member code is refused (404)', (await upFace('BNOSUCHCODE00')).status === 404);
    const notImg = await Promise.all([upFace(sam.code, 'data:text/html;base64,PGgxPg=='),
      upFace(sam.code, 'data:image/jpeg;base64,PGgxPmhpPC9oMT4='), post(`/api/bkk/me/${sam.code}/photo`, {})]);
    ok('not a photo is refused (400): another type, HTML dressed as a JPEG, nothing at all', notImg.every(r => r.status === 400),
       JSON.stringify(notImg.map(r => r.status)));
    const b64 = (...parts) => Buffer.concat(parts.map(p => Buffer.from(p, 'latin1'))).toString('base64');
    const wav = 'data:image/jpeg;base64,' + b64('RIFF', '\x24\0\0\0', 'WAVEfmt ', '\0'.repeat(24));
    const mp4 = 'data:image/png;base64,' + b64('\0\0\0\x18', 'ftypisom', '\0'.repeat(24));
    const avi = 'data:image/webp;base64,' + b64('RIFF', '\x24\0\0\0', 'AVI LIST', '\0'.repeat(24));
    const mov = 'data:image/heic;base64,' + b64('\0\0\0\x14', 'ftypqt  ', '\0'.repeat(24));
    const pngAsJpeg = 'data:image/jpeg;base64,' + b64('\x89PNG\r\n\x1a\n', '\0'.repeat(24));
    const fakes = await Promise.all([wav, mp4, avi, mov, pngAsJpeg].map(d => upFace(sam.code, d)));
    ok('a sound or video file called a photo is refused (400), and so is a photo with the wrong label',
       fakes.every(r => r.status === 400 && r.body.error === 'not a photo'), JSON.stringify(fakes.map(r => [r.status, r.body.error])));
    const big = await upFace(sam.code, 'data:image/jpeg;base64,/9j/' + 'A'.repeat(8.5 * 1024 * 1024));
    ok('a photo over 6 MB is refused (413)', big.status === 413, JSON.stringify([big.status, big.body]));
    ok('...and none of those reached storage or counted as a try', faceUps().length === n0 + 1 && (await rowOf(sam.code)).photo_tries === 1);

    const d0 = destroyed.length;
    const up2 = await upFace(sam.code);
    const u2 = faceUps().at(-1);
    ok('a new photo replaces the old one, and the old one is deleted from storage', up2.status === 200 && u2.public_id !== u1.public_id
       && (await rowOf(sam.code)).photo_id === u2.public_id
       && destroyed.slice(d0).length === 1 && destroyed[d0].id === u1.public_id && destroyed[d0].type === 'authenticated', JSON.stringify(destroyed.slice(d0)));
    ok("the old photo's links stop at once", (await get(me1.photo.small)).status === 404);

    for (let i = 0; i < 8; i++) await upFace(sam.code);
    const before11 = faceUps().length;
    const up11 = await upFace(sam.code);
    ok('10 uploads a day, then the 11th is refused (429)', up11.status === 429 && faceUps().length === before11
       && (await rowOf(sam.code)).photo_tries === 10, JSON.stringify([up11.status, up11.body]));
    ok('...another student is not held back', (await upFace(tia.code)).status === 200);
    const realWebp = 'data:image/webp;base64,' + b64('RIFF', '\x24\0\0\0', 'WEBPVP8 ', '\0'.repeat(24));
    const realHeic = 'data:image/heic;base64,' + b64('\0\0\0\x18', 'ftypheic', '\0'.repeat(24));
    const realHeif = 'data:image/heif;base64,' + b64('\0\0\0\x18', 'ftypmif1', '\0'.repeat(24));
    const kinds = [];
    for (const d of [realWebp, realHeic, realHeif]) kinds.push((await upFace(tia.code, d)).status);
    ok('a real WebP or HEIC photo is still taken', kinds.every(s => s === 200), JSON.stringify(kinds));
    await pool.query('UPDATE bkk_members SET photo_tries_on = photo_tries_on - 1 WHERE code=$1', [sam.code]);
    ok('...and the next day the student can upload again', (await upFace(sam.code)).status === 200 && (await rowOf(sam.code)).photo_tries === 1);

    const had = (await rowOf(sam.code)).photo_id, d1 = destroyed.length;
    const both = await Promise.all([upFace(sam.code), upFace(sam.code)]);
    const kept = (await rowOf(sam.code)).photo_id, gone = destroyed.slice(d1).map(d => d.id).sort();
    const two = both.map(r => r.body.photo && LINK.exec(r.body.photo.small)[1]);
    ok('two uploads at once: one photo stays, the other and the old one are deleted, nothing left over',
       both.every(r => r.status === 200) && two.some(id => kept.endsWith(id)) && gone.length === 2 && gone.includes(had)
       && !gone.includes(kept), JSON.stringify({ had, kept, gone, two }));

    // The door and the admin class list: today's seats for one with a face and one without.
    const todayB = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const slot = (await pool.query('SELECT id FROM bkk_class_slots WHERE active ORDER BY id LIMIT 1')).rows[0].id;
    const seats = [];
    for (const m of [sam, uma]) {
      seats.push((await pool.query(`INSERT INTO bkk_bookings (slot_id,class_date,start_at,member_id,status,cover,source)
        VALUES ($1,$2::date,now(),$3,'booked','rezerv','staff') RETURNING id`, [slot, todayB, (await rowOf(m.code)).id])).rows[0].id);
    }
    const door = (await J('/api/bkk/admin/today', { headers: ADMIN })).body.bookings || [];
    const dSam = door.find(b => b.code === sam.code), dUma = door.find(b => b.code === uma.code);
    ok("the door's today list carries the small face link, null for no photo", dSam && LINK.test(dSam.photo)
       && LINK.exec(dSam.photo)[2] === 's' && kept.endsWith(LINK.exec(dSam.photo)[1]) && dUma && dUma.photo === null
       && !door.some(b => 'photo_id' in b), JSON.stringify([dSam, dUma]));
    ok('...and the door can show it', (await get(dSam.photo)).status === 200);
    const roster = (await J(`/api/bkk/admin/class?slotId=${slot}&date=${todayB}`, { headers: ADMIN })).body.roster || [];
    const cSam = roster.find(b => b.code === sam.code), cUma = roster.find(b => b.code === uma.code);
    ok('the admin class list carries it too', cSam && cSam.photo === dSam.photo && cUma && cUma.photo === null, JSON.stringify(roster));
    ok('both lists need the staff key', (await J('/api/bkk/admin/today')).status === 401
       && (await J(`/api/bkk/admin/class?slotId=${slot}&date=${todayB}`)).status === 401);
    const pub = await Promise.all(['/api/bkk/schedule?days=14', '/api/bkk/products', '/api/bkk/settings', '/api/bkk/tees',
      `/api/bkk/me/${uma.code}`].map(p => fetch(B + p).then(r => r.text())));
    ok('public routes, and another student\'s /me, carry no photo of anyone',
       pub.every(t => !t.includes('/api/bkk/face/') && !t.includes('aybkk-profile') && !t.includes(kept.split('/').pop())), pub.map(t => t.slice(0, 80)).join(' | '));

    const d2 = destroyed.length;
    const rm = await post(`/api/bkk/me/${sam.code}/photo/remove`, {});
    const r2 = await rowOf(sam.code);
    ok('removing the photo deletes it from storage and clears the row', rm.status === 200 && r2.photo_id === null && r2.photo_at === null
       && destroyed.length === d2 + 1 && destroyed[d2].id === kept && destroyed[d2].type === 'authenticated', JSON.stringify([rm.body, r2]));
    ok('/me and the door list say no photo again', (await J(`/api/bkk/me/${sam.code}`)).body.photo === null
       && ((await J('/api/bkk/admin/today', { headers: ADMIN })).body.bookings || []).find(b => b.code === sam.code).photo === null);
    ok("the removed photo's link stops at once", (await get(dSam.photo)).status === 404);
    ok('removing with a wrong code is 404; with no photo it does nothing',
       (await post('/api/bkk/me/BNOSUCHCODE00/photo/remove', {})).status === 404
       && (await post(`/api/bkk/me/${uma.code}/photo/remove`, {})).status === 200 && destroyed.length === d2 + 1);

    // Cloudinary down while a photo is removed: the row is cleared at once, and
    // the photo is noted and deleted on the next try.
    const realDestroy = fakeCloud.uploader.destroy;
    const tiaHad = (await rowOf(tia.code)).photo_id;
    fakeCloud.uploader.destroy = async () => { throw new Error('network down'); };
    const rmDown = await post(`/api/bkk/me/${tia.code}/photo/remove`, {});
    fakeCloud.uploader.destroy = realDestroy;
    const orphan = async id => (await pool.query('SELECT tries FROM bkk_face_orphans WHERE photo_id=$1', [id])).rows[0];
    ok('a photo that could not be deleted is noted to delete later, and the row is cleared', rmDown.status === 200
       && (await rowOf(tia.code)).photo_id === null && !!(await orphan(tiaHad)), JSON.stringify([rmDown.body, await orphan(tiaHad)]));
    const d3 = destroyed.length;
    ok('...the next photo stored tries again', (await upFace(tia.code)).status === 200);
    for (let i = 0; i < 40 && await orphan(tiaHad); i++) await new Promise(r => setTimeout(r, 25));
    ok('...and then it is deleted and the note goes', !(await orphan(tiaHad))
       && destroyed.slice(d3).some(d => d.id === tiaHad && d.type === 'authenticated'), JSON.stringify(destroyed.slice(d3)));

    // Staff "sign out everywhere" gives a new code: links given out before stop at once.
    const tiaOld = (await J(`/api/bkk/me/${tia.code}`)).body.photo;
    ok("tia's link works before", (await get(tiaOld.small)).status === 200);
    const so = await post(`/api/bkk/admin/members/${tia.code}/signout`, { expectEmail: 'tia.face@example.com', clearEmail: false }, ADMIN);
    const tiaNew = so.body.member && (await J(`/api/bkk/me/${so.body.member.code}`)).body.photo;
    ok('after staff sign a profile out everywhere, the old links stop and the new code gets new ones', so.status === 200
       && (await get(tiaOld.small)).status === 403 && (await get(tiaOld.large)).status === 403
       && tiaNew && tiaNew.small !== tiaOld.small && (await get(tiaNew.small)).status === 200, JSON.stringify([so.status, tiaNew]));

    await pool.query('DELETE FROM bkk_bookings WHERE id = ANY($1::int[])', [seats]);
    clock = bkkAt('2026-11-11T23:59:00');
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

  console.log('\n— new prices from 12 Nov 2026 00:00 Bangkok —');
  {
    const byCode = async (port = null) => {
      const r = await (port ? fetch(`http://127.0.0.1:${port}/api/bkk/products`).then(x => x.json()) : J('/api/bkk/products').then(x => x.body));
      return Object.fromEntries((r.products || []).map(p => [p.code, p]));
    };
    const mount = (opts = {}) => {
      const a = express(); a.use(express.json());
      mountBkk(a, { pgPool: pool, now, ...opts });
      const srv = a.listen(0);
      return { srv, port: srv.address().port };
    };
    const buyer = n => ({ name: `Switch Buyer ${n}`, email: `switch.buyer${n}@example.com` });
    const marker = async () => (await pool.query(`SELECT count(*)::int AS n FROM bkk_settings WHERE key='prices_from_2026_11_12'`)).rows[0].n;

    clock = bkkAt('2026-11-11T23:59:59');
    const pre = await byCode();
    ok('11 Nov 23:59 Bangkok: old prices, 3 months 25,800 and 12 months 78,000', pre.unlim3.price_thb === 25800
       && pre.unlim12m.price_thb === 78000 && pre.unlim1.price_thb === 9600 && pre.dropin.price_thb === 1500 && pre.pack8.price_thb === 7600 && !pre.pack10,
       JSON.stringify(Object.values(pre).map(p => [p.code, p.price_thb])));
    const pre6 = await post('/api/bkk/orders', { productCode: 'unlim6m', ...buyer(1) });
    const pre6desk = await post('/api/bkk/admin/sales', { productCode: 'unlim6m', name: 'Switch Desk Early', method: 'cash' }, ADMIN);
    ok('...the new 6-month is not listed, not sold online and not sold at the desk', !pre.unlim6m && pre6.status === 404
       && pre6desk.status === 404 && (await marker()) === 0, JSON.stringify([pre6.body, pre6desk.body]));
    const early = await post('/api/bkk/orders', { productCode: 'unlim3', ...buyer(2) });
    ok('...a 3-month order at 23:59 is 25,800 + 3% fee + 7% VAT = 28,434', early.body.order && early.body.order.amount === 28434,
       JSON.stringify(early.body.order));
    const receiptTo = async to => {
      await new Promise(r => setTimeout(r, 300));                  // the receipt goes after the reply
      return require('../mailer').outbox.filter(m => m.tag === 'receipt' && m.to === to).pop();
    };
    const earlyDesk3 = await post('/api/bkk/admin/sales', { productCode: 'unlim3', name: 'Switch Three Early',
      email: 'switch.three.early@example.com', method: 'cash' }, ADMIN);
    const earlyRc3 = await receiptTo('switch.three.early@example.com');
    ok('...a 3-month desk sale at 23:59 is 25,800 + 1,806 VAT = 27,606, and the receipt says so', earlyDesk3.body.order
       && earlyDesk3.body.order.amount === 27606 && earlyDesk3.body.order.vat === 1806 && (await marker()) === 0
       && earlyRc3 && earlyRc3.text.includes('Paid ฿27,606 (฿25,800 + ฿0 online transaction fee + ฿1,806 VAT 7%)'),
       JSON.stringify([earlyDesk3.body, earlyRc3 && earlyRc3.text.slice(0, 300)]));

    // A failure part way leaves no marker behind, so the next request tries again.
    let failing = true;
    const flaky = {
      query: (...a) => pool.query(...a),
      connect: async () => {
        const c = await pool.connect();
        return { query: (sql, p) => failing && /^UPDATE bkk_products SET price_thb/.test(sql)
          ? Promise.reject(new Error('disk full')) : c.query(sql, p), release: (...a) => c.release(...a) };
      },
    };
    const bad = mount({ pgPool: flaky });
    const other = mount();
    await new Promise(r => setTimeout(r, 1500));           // let both schema checks finish
    // As if the boot that seeds the 6-month had failed: the switch must add it, not lock it out.
    await pool.query(`DELETE FROM bkk_products WHERE code='unlim6m'`);
    clock = bkkAt('2026-11-12T00:00:00');
    const badRes = await fetch(`http://127.0.0.1:${bad.port}/api/bkk/products`);
    ok('a switch that fails part way answers 500 and leaves the old prices and no marker', badRes.status === 500
       && (await marker()) === 0 && (await pool.query(`SELECT price_thb FROM bkk_products WHERE code='unlim3'`)).rows[0].price_thb === 25800,
       String(badRes.status));
    bad.srv.close();

    // Two servers take their first request at 00:00 together: the change happens once.
    const said = [], log = console.log;
    console.log = (...a) => { if (/prices from 12 Nov 2026 are live/.test(a.join(' '))) said.push(a); else log(...a); };
    const both = await Promise.all([byCode(), byCode(other.port), byCode(), byCode(other.port)]);
    console.log = log;
    ok('12 Nov 00:00 Bangkok: two servers asking at once apply the switch once', said.length === 1 && (await marker()) === 1,
       `applied ${said.length} times`);
    const post12 = both[0];
    ok('...3 months 19,500, 12 months 63,600, 1 month, drop-in and 8 classes unchanged', both.every(b => b.unlim3.price_thb === 19500
       && b.unlim12m.price_thb === 63600 && b.unlim1.price_thb === 9600 && b.dropin.price_thb === 1500 && b.pack8.price_thb === 7600 && !b.pack10),
       JSON.stringify(Object.values(post12).map(p => [p.code, p.price_thb])));
    const six = post12.unlim6m || {};
    ok('...the 6-month is on sale at 34,200 for 180 days, 2 classes a day, between 3 and 12 months',
       six.price_thb === 34200 && six.valid_days === 180 && six.daily_cap === 2 && six.kind === 'unlimited'
       && Object.keys(post12).join() === 'dropin,pack8,unlim1,unlim3,unlim6m,unlim12m', JSON.stringify(six));
    ok('...even when the boot before it never added the 6-month row', (await pool.query(
       `SELECT 1 FROM bkk_products WHERE code='unlim6m' AND active AND price_thb=34200`)).rows.length === 1);
    ok('...and the old 6-month (45,000, sold by Rezerv) stays off sale', !post12.unlim6
       && (await pool.query(`SELECT active, price_thb FROM bkk_products WHERE code='unlim6'`)).rows.every(r => !r.active && r.price_thb === 45000));

    const o6 = await post('/api/bkk/orders', { productCode: 'unlim6m', ...buyer(3) });
    const o3 = await post('/api/bkk/orders', { productCode: 'unlim3', ...buyer(4) });
    const o12 = await post('/api/bkk/orders', { productCode: 'unlim12m', ...buyer(5) });
    const row6 = (await pool.query('SELECT base_thb, fee_thb, vat_thb, amount_thb FROM bkk_orders WHERE refno=$1', [o6.body.order.refno])).rows[0];
    ok('checkout: 6 months is 34,200 + 1,026 fee + 2,466 VAT = 37,692', o6.body.order.amount === 37692 && row6.base_thb === 34200
       && row6.fee_thb === 1026 && row6.vat_thb === 2466 && row6.amount_thb === 37692 && six.total_thb === 37692, JSON.stringify(row6));
    ok('...3 months 19,500 + 585 fee + 1,406 VAT = 21,491 and 12 months 70,094, as the Packages tab shows', o3.body.order.amount === 21491
       && o12.body.order.amount === 70094 && post12.unlim3.total_thb === 21491 && post12.unlim12m.total_thb === 70094,
       JSON.stringify([o3.body.order, o12.body.order]));
    const earlyRow = (await pool.query('SELECT id, base_thb, amount_thb FROM bkk_orders WHERE refno=$1', [early.body.order.refno])).rows[0];
    ok('an order made before the switch keeps its old price', earlyRow.base_thb === 25800 && earlyRow.amount_thb === 28434, JSON.stringify(earlyRow));
    const desk6 = await post('/api/bkk/admin/sales', { productCode: 'unlim6m', name: 'Switch Desk', method: 'cash' }, ADMIN);
    const deskPass = (await pool.query(`SELECT p.valid_days, p.daily_cap FROM bkk_passes p JOIN bkk_members m ON m.id=p.member_id
      WHERE m.name='Switch Desk'`)).rows[0] || {};
    ok('a desk sale of the 6-month is 34,200 + 7% VAT = 36,594 and gives a 180-day pass', desk6.body.order && desk6.body.order.amount === 36594
       && deskPass.valid_days === 180 && deskPass.daily_cap === 2, JSON.stringify([desk6.body, deskPass]));
    const desk3 = await post('/api/bkk/admin/sales', { productCode: 'unlim3', name: 'Switch Three Desk',
      email: 'switch.three.desk@example.com', method: 'cash' }, ADMIN);
    const row3 = desk3.body.order ? (await pool.query(`SELECT o.base_thb, o.fee_thb, o.vat_thb, o.amount_thb, p.valid_days
      FROM bkk_orders o JOIN bkk_passes p ON p.order_id=o.id WHERE o.refno=$1`, [desk3.body.order.refno])).rows[0] || {} : {};
    ok('a desk sale of the 3-month is 19,500 + 1,365 VAT = 20,865 for a 90-day pass', desk3.body.order && desk3.body.order.amount === 20865
       && desk3.body.order.vat === 1365 && row3.base_thb === 19500 && row3.fee_thb === 0 && row3.vat_thb === 1365
       && row3.amount_thb === 20865 && row3.valid_days === 90, JSON.stringify([desk3.body, row3]));
    const rc3 = await receiptTo('switch.three.desk@example.com');
    ok('...the receipt says so', rc3 && rc3.text.includes('Paid ฿20,865 (฿19,500 + ฿0 online transaction fee + ฿1,365 VAT 7%)'),
       rc3 && rc3.text.slice(0, 300));

    // Staff own the prices from here: a change in the admin page stays.
    clock = bkkAt('2026-11-12T09:00:00');
    const staff = await post('/api/bkk/admin/products', { code: 'unlim3', priceThb: 21000 }, ADMIN);
    const after = await byCode();
    const reboot = mount();
    await new Promise(r => setTimeout(r, 1500));
    const rebooted = await byCode(reboot.port);
    ok('a price staff change after the switch stays, on the next request and after a reboot', staff.status === 200
       && after.unlim3.price_thb === 21000 && rebooted.unlim3.price_thb === 21000 && rebooted.unlim12m.price_thb === 63600
       && (await byCode(other.port)).unlim3.price_thb === 21000, JSON.stringify([after.unlim3.price_thb, rebooted.unlim3.price_thb]));
    reboot.srv.close(); other.srv.close();
    await post('/api/bkk/admin/products', { code: 'unlim3', priceThb: 19500 }, ADMIN);

    // An old 6-month pass from Rezerv is still the old 6-month package.
    const pasted = await post('/api/bkk/admin/import', { rows: [{ name: 'Switch Old Six', plan: '6 months', until: '2027-01-31' }] }, ADMIN);
    const viaPasses = await post('/api/bkk/admin/import/passes', { dryRun: false, rows: [
      { name: 'Switch Old Six Two', plan: '6 Months Unlimited', start: '2026-08-01', until: '2027-01-27' }] }, ADMIN);
    const viaPay = await post('/api/bkk/admin/import/payments', { dryRun: false, rows: [
      { rezervId: 'P-SW6', name: 'Switch Old Six Three', date: '2026-08-01', amount: 45000, item: '6 months unlimited', method: 'transfer' },
      { rezervId: 'P-SW6T', name: 'Switch Old Six Three', date: '2026-08-02', amount: 45000, item: '6 เดือน ไม่จำกัด', method: 'transfer' }] }, ADMIN);
    const sixes = (await pool.query(`SELECT m.name, pr.code, pr.valid_days FROM bkk_passes p JOIN bkk_products pr ON pr.id=p.product_id
      JOIN bkk_members m ON m.id=p.member_id WHERE m.name LIKE 'Switch Old Six%' ORDER BY m.name`)).rows;
    const paid = (await pool.query(`SELECT pr.code FROM bkk_orders o JOIN bkk_products pr ON pr.id=o.product_id
      WHERE o.source='rezerv' AND o.source_ref LIKE 'P-SW6%'`)).rows;
    ok('after the switch, an old Rezerv 6-month pass or payment still maps to the old 6-month, never the new one',
       pasted.body.passes === 1 && viaPasses.body.added === 1 && sixes.length === 2 && sixes.every(x => x.code === 'unlim6' && x.valid_days === 180)
       && viaPay.body.added === 2 && paid.length === 2 && paid.every(x => x.code === 'unlim6'), JSON.stringify([sixes, paid, viaPay.body]));

    // Both 6-month packages are called "6 months unlimited".
    const deskDay = (await pool.query(`SELECT to_char(created_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') AS d
      FROM bkk_orders WHERE refno=$1`, [desk6.body.order.refno])).rows[0].d;
    await post('/api/bkk/admin/import/payments', { dryRun: false, rows: [
      { rezervId: 'P-SW6R', name: 'Switch Old Six Four', date: deskDay, amount: 45000, item: '6 months unlimited', method: 'transfer' }] }, ADMIN);
    const rep6 = ((await J(`/api/bkk/admin/report?from=${deskDay}&to=${deskDay}`, { headers: ADMIN })).body.money || { byItem: [] })
      .byItem.filter(x => x.item === '6 months unlimited');
    ok('the money report keeps the old 6-month and the new one apart, each with its price', rep6.length === 2
       && rep6.some(x => x.price === 45000) && rep6.some(x => x.price === 34200 && x.total === 36594), JSON.stringify(rep6));

    // The first request after midnight is not always a price list read.
    const unswitch = async () => {
      await pool.query(`DELETE FROM bkk_settings WHERE key IN ('prices_from_2026_11_12','prices_6m12m_from_2026_11_12')`);
      await pool.query(`UPDATE bkk_products SET active = code <> 'unlim6m',
        price_thb = CASE code WHEN 'unlim3' THEN 25800 WHEN 'unlim12m' THEN 78000 ELSE price_thb END
        WHERE code IN ('unlim3','unlim6m','unlim12m')`);
    };
    const firstAfterMidnight = async () => {
      clock = bkkAt('2026-11-11T23:59:00');
      await unswitch();
      const a = mount();
      await new Promise(r => setTimeout(r, 1500));
      clock = bkkAt('2026-11-12T00:00:00');
      a.call = (p, body, headers = {}) => fetch(`http://127.0.0.1:${a.port}${p}`, body
        ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) } : {})
        .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
      return a;
    };
    let first = await firstAfterMidnight();
    const firstOrder = await first.call('/api/bkk/orders', { productCode: 'unlim3', ...buyer(6) });
    first.srv.close();
    ok('a checkout as the first request after midnight charges the new price, 21,491',
       firstOrder.body.order && firstOrder.body.order.amount === 21491, JSON.stringify(firstOrder.body));
    first = await firstAfterMidnight();
    const firstDesk = await first.call('/api/bkk/admin/sales', { productCode: 'unlim6m', name: 'Switch Desk First', method: 'cash' }, ADMIN);
    first.srv.close();
    ok('a desk sale of the 6-month as the first request after midnight sells it, 36,594', firstDesk.status === 200
       && firstDesk.body.order && firstDesk.body.order.amount === 36594, JSON.stringify(firstDesk.body));
    first = await firstAfterMidnight();
    const firstEdit = await first.call('/api/bkk/admin/products', { code: 'unlim3', priceThb: 21000 }, ADMIN);
    const firstList = await first.call('/api/bkk/products');
    first.srv.close();
    const firstPrices = Object.fromEntries((firstList.body.products || []).map(p => [p.code, p.price_thb]));
    ok('a staff price change as the first request after midnight stays', firstEdit.status === 200 && firstPrices.unlim3 === 21000,
       JSON.stringify(firstPrices));
    first = await firstAfterMidnight();
    clock = bkkAt('2026-11-11T23:59:30');
    const handEdit = await first.call('/api/bkk/admin/products', { code: 'unlim3', priceThb: 24000 }, ADMIN);
    const handBefore = (await pool.query(`SELECT price_thb FROM bkk_products WHERE code='unlim3'`)).rows[0].price_thb;
    clock = bkkAt('2026-11-12T00:00:00');
    const handList = await first.call('/api/bkk/products');
    first.srv.close();
    const handPrices = Object.fromEntries((handList.body.products || []).map(p => [p.code, p.price_thb]));
    ok('a running shala whose staff changed the 3-month by hand on 11 Nov still sells it at 19,500 from 00:00', handEdit.status === 200
       && handBefore === 24000 && handPrices.unlim3 === 19500 && (await marker()) === 1, JSON.stringify([handBefore, handPrices]));
    await unswitch();
    clock = bkkAt('2026-11-12T08:00:00');
    const late = mount();
    await new Promise(r => setTimeout(r, 1500));
    late.srv.close();
    const lateRows = Object.fromEntries((await pool.query(`SELECT code, price_thb, active FROM bkk_products
      WHERE code IN ('unlim3','unlim6m','unlim12m','unlim1','dropin','pack8')`)).rows.map(r => [r.code, r]));
    ok('a server that boots after midnight switches with no request at all', (await marker()) === 1 && lateRows.unlim3.price_thb === 19500
       && lateRows.unlim12m.price_thb === 63600 && lateRows.unlim6m.price_thb === 34200 && lateRows.unlim6m.active, JSON.stringify(lateRows));
    ok('...and 1 month, drop-in and 8 classes keep their prices', lateRows.unlim1.price_thb === 9600 && lateRows.dropin.price_thb === 1500
       && lateRows.pack8.price_thb === 7600 && lateRows.unlim1.active && lateRows.dropin.active && lateRows.pack8.active, JSON.stringify(lateRows));

    // The marker is the switch's memory: a second boot leaves the prices alone.
    clock = bkkAt('2026-11-12T09:30:00');
    await pool.query(`UPDATE bkk_products SET price_thb=20000 WHERE code='unlim3'`);
    const said2 = [];
    console.log = (...a) => { if (/prices from 12 Nov 2026 are live/.test(a.join(' '))) said2.push(a); else log(...a); };
    const again = mount();
    await new Promise(r => setTimeout(r, 1500));
    const againList = await byCode(again.port);
    console.log = log;
    again.srv.close();
    ok('a second boot after the switch does not run it again', said2.length === 0 && (await marker()) === 1
       && againList.unlim3.price_thb === 20000 && againList.unlim12m.price_thb === 63600 && againList.unlim6m.price_thb === 34200,
       JSON.stringify([said2.length, againList.unlim3, againList.unlim12m]));
    await pool.query(`UPDATE bkk_products SET price_thb=19500 WHERE code='unlim3'`);

    // 11 Nov evening: 6 months 34,200 and 12 months 63,600. A shala that already
    // switched at 32,000 / 59,900 (this change deployed after midnight) moves once.
    await pool.query(`DELETE FROM bkk_settings WHERE key='prices_6m12m_from_2026_11_12'`);
    await pool.query(`UPDATE bkk_products SET price_thb = CASE code WHEN 'unlim6m' THEN 32000 ELSE 59900 END
                      WHERE code IN ('unlim6m','unlim12m')`);
    clock = bkkAt('2026-11-12T01:00:00');
    const raised = mount();
    await new Promise(r => setTimeout(r, 1500));
    const raisedList = await byCode(raised.port);
    raised.srv.close();
    const raiseMark = async () => (await pool.query(`SELECT count(*)::int AS n FROM bkk_settings WHERE key='prices_6m12m_from_2026_11_12'`)).rows[0].n;
    ok('a shala that switched at 32,000 / 59,900 moves to 34,200 / 63,600 once, 3 months untouched',
       raisedList.unlim6m.price_thb === 34200 && raisedList.unlim12m.price_thb === 63600 && raisedList.unlim3.price_thb === 19500
       && (await raiseMark()) === 1, JSON.stringify([raisedList.unlim6m, raisedList.unlim12m]));
    await post('/api/bkk/admin/products', { code: 'unlim12m', priceThb: 61000 }, ADMIN);
    const raisedAgain = mount();
    await new Promise(r => setTimeout(r, 1500));
    const raisedAgainList = await byCode(raisedAgain.port);
    raisedAgain.srv.close();
    ok('...and a price staff set after that stays after a reboot', raisedAgainList.unlim12m.price_thb === 61000
       && raisedAgainList.unlim6m.price_thb === 34200, JSON.stringify(raisedAgainList.unlim12m));
    await pool.query(`DELETE FROM bkk_settings WHERE key='prices_6m12m_from_2026_11_12'`);
    await pool.query(`UPDATE bkk_products SET price_thb=33000 WHERE code='unlim6m'`);
    const handSet = mount();
    await new Promise(r => setTimeout(r, 1500));
    const handSetList = await byCode(handSet.port);
    handSet.srv.close();
    ok('...a 6-month price staff had already changed by hand is not touched', handSetList.unlim6m.price_thb === 33000
       && handSetList.unlim12m.price_thb === 61000 && (await raiseMark()) === 1, JSON.stringify([handSetList.unlim6m, handSetList.unlim12m]));
    await pool.query(`UPDATE bkk_products SET price_thb = CASE code WHEN 'unlim6m' THEN 34200 ELSE 63600 END
                      WHERE code IN ('unlim6m','unlim12m')`);
  }

  // ── "See you tomorrow": students who hold a pass but stopped coming (Nov 2026) ──
  // Every person here is made up. The rule is tested on quietRows with a fixed day
  // (2027, after every other test's dates); the routes use the real Bangkok today.
  console.log('\n# quiet students');
  {
    const QS = (sql, args) => pool.query(sql, args);
    const one = async (sql, args = []) => (await pool.query(sql, args)).rows[0] || {};
    const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
    const todayB = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const CFG = { quietBox: 'on', quietBrief: 'off', quietDays: 7, quietDays2: 14, quietDaysShort: 5, quietDays2Short: 10,
      quietRezerv: 'hide', quietRezervFrom: null };
    let qn = 0;
    const mk = async (name, o = {}) => one(`INSERT INTO bkk_members (code,name,email,phone,source) VALUES ($1,$2,$3,$4,$5) RETURNING id, code, name`,
      [`BTESTQ${++qn}X`, name, `quiet.${qn}@example.com`, `0870000${String(qn).padStart(3, '0')}`, o.source || null]);
    const pass = async (m, code, o = {}) => (await one(`INSERT INTO bkk_passes
        (member_id,product_id,kind,credits_total,credits_used,daily_cap,valid_days,valid_from,valid_until,status,frozen_from,frozen_until,source,created_at)
      SELECT $1::int, id, kind, credits, $3::int, daily_cap, valid_days, $4::date, $5::date, $6::text, $7::date, $8::date, $9::text,
        coalesce($10::timestamptz, now()) FROM bkk_products WHERE code=$2 RETURNING id`,
      [m.id, code, o.used || 0, o.from || null, o.until || null, o.status || 'active', o.ffrom || null, o.funtil || null,
       o.source || 'manual', o.created || null])).id;
    // A seat they came to (checked in at the start), unless in: false. No slot: an on-site class.
    const seat = async (m, day, o = {}) => (await one(`INSERT INTO bkk_bookings
        (slot_id,class_date,start_at,member_id,pass_id,status,checked_in_at,cover,source,class_title)
      VALUES ($1,$2,$3,$4,$5,'booked',$6,$7,$8,'Quiet Test') RETURNING id`,
      [o.slot || null, day, `${day}T${o.t || '06:00'}:00+07:00`, m.id, o.pass || null,
       o.in === false ? null : `${day}T${o.t || '06:00'}:00+07:00`, o.cover || (o.pass ? 'pass' : 'rezerv'), o.source || 'door'])).id;
    // A row in bkk_outreach on a given Bangkok day, as the routes write it.
    const note = async (m, day, o = {}) => (await one(`INSERT INTO bkk_outreach
        (member_id,kind,step,created_at,messaged_at,messaged_by,reason,answered_at,answered_by,mute_until)
      VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [m.id, o.kind || 'message', (o.kind || 'message') === 'message' ? o.step || 1 : null, `${day}T10:00:00+07:00`, 'Test Staff',
       o.reason || null, o.reason ? `${day}T11:00:00+07:00` : null, o.reason ? 'Test Staff' : null, o.mute || null])).id;
    const rows = (date, m, cfg = CFG) => quietRows(QS, { date, cfg, memberId: m.id });
    const look = async (date, m, cfg) => { const r = await rows(date, m, cfg); return r.todo[0] || r.resting[0] || r.parked[0] || null; };
    const show = x => JSON.stringify(x && { state: x.state, kind: x.kind, step: x.step, sender: x.sender, daysQuiet: x.daysQuiet,
      lastCame: x.lastCame, since: x.since, draftKey: x.draftKey, unchecked: x.unchecked });
    const BD = '2027-03-10';
    const quietGet = (ka = 'kha', h = ADMIN) => J(`/api/bkk/admin/quiet?ka=${ka}`, { headers: h });
    const listed = (body, code) => ['todo', 'resting', 'parked'].map(s => (body[s] || []).find(x => x.code === code)).find(Boolean) || null;

    // ── the switch and its settings ──
    ok('quiet needs the staff key', (await quietGet('kha', {})).status === 401
       && (await post('/api/bkk/admin/quiet/BTESTQ1X/messaged', { by: 'M', step: 1 })).status === 401
       && (await post('/api/bkk/admin/quiet/BTESTQ1X/known', { by: 'M', reason: 'work' })).status === 401
       && (await post('/api/bkk/admin/quiet/BTESTQ1X/mute', { by: 'M' })).status === 401
       && (await post('/api/bkk/admin/outreach/1/reason', { by: 'M', reason: 'work' })).status === 401
       && (await J('/api/bkk/admin/settings')).status === 401);
    const s0 = (await J('/api/bkk/admin/settings', { headers: ADMIN })).body.quiet || {};
    ok('everything ships off: the box, the brief section, and Rezerv packages hidden; days 7 and 14, 5 and 10',
       s0.quietBox === 'off' && s0.quietBrief === 'off' && s0.quietRezerv === 'hide' && s0.quietRezervFrom === null
       && s0.quietDays === 7 && s0.quietDays2 === 14 && s0.quietDaysShort === 5 && s0.quietDays2Short === 10, JSON.stringify(s0));
    const early = await mk('Quinn Earlybird');
    await pass(early, 'unlim12m', { from: addD(todayB, -100), until: addD(todayB, 200) });
    await seat(early, addD(todayB, -9));
    const off = await quietGet();
    ok('the box is off until switched on: on is false and there are no rows', off.status === 200 && off.body.on === false
       && off.body.todo.length === 0 && off.body.resting.length === 0 && off.body.parked.length === 0 && off.body.heldBack === 0
       && off.body.questions.length === 0, JSON.stringify(off.body).slice(0, 300));
    const sets = async () => (await J('/api/bkk/admin/settings', { headers: ADMIN })).body.quiet;
    const bads = [{ quietBox: 'yes' }, { quietBox: 1 }, { quietBrief: 'maybe' }, { quietDays: 4 }, { quietDays: 31 }, { quietDays: 7.5 },
      { quietDays: 'seven' }, { quietDays2: 7 }, { quietDays2: 61 }, { quietDaysShort: 2 }, { quietDaysShort: 31 }, { quietDays2Short: 5 },
      { quietDays2Short: 61 }, { quietRezerv: 'open' }, { quietRezerv: true }, { quietDays: 20 }, { quietDaysShort: 12 }];
    const refused = [];
    for (const b of bads) refused.push((await post('/api/bkk/admin/settings', b, ADMIN)).status);
    ok('settings: each field takes only its allowed values, and step 2 must stay above step 1', refused.every(s => s === 400), JSON.stringify(refused));
    const mixed = await post('/api/bkk/admin/settings', { teamBriefMorning: 'on', quietBox: 'on', quietDays: 9, quietDays2: 8 }, ADMIN);
    const after = await sets();
    ok('...a wrong value is refused and nothing is saved, not even the right ones next to it', mixed.status === 400
       && /quietDays2/.test(mixed.body.error) && after.quietBox === 'off' && after.quietDays === 7 && after.quietDays2 === 14
       && (await one(`SELECT count(*)::int AS n FROM bkk_settings WHERE key='team_brief_morning'`)).n === 0, JSON.stringify([mixed.body, after]));
    const good = await post('/api/bkk/admin/settings', { quietDays: '8', quietDays2: 15, quietDaysShort: 4, quietDays2Short: 9 }, ADMIN);
    ok('...right values are saved and returned with the other settings', good.status === 200 && good.body.quiet.quietDays === 8
       && good.body.quiet.quietDays2 === 15 && good.body.quiet.quietDaysShort === 4 && good.body.quiet.quietDays2Short === 9
       && good.body.teamBrief && good.body.quiet.quietBox === 'off', JSON.stringify(good.body));
    await post('/api/bkk/admin/settings', { quietDays: 7, quietDays2: 14, quietDaysShort: 5, quietDays2Short: 10 }, ADMIN);

    // ── who is quiet, and when ──
    const longPass = async (m, o = {}) => pass(m, 'unlim12m', { from: addD(BD, -200), until: addD(BD, 160), ...o });
    const l7 = await mk('Lena Sevenday'), l6 = await mk('Lars Sixday');
    await longPass(l7); await seat(l7, addD(BD, -7));
    await longPass(l6); await seat(l6, addD(BD, -6));
    const rl7 = await look(BD, l7);
    ok('a long membership whose last class was 7 days ago is listed at step 1; 6 days is not',
       rl7 && rl7.state === 'todo' && rl7.step === 1 && rl7.sender === 'staff' && rl7.daysQuiet === 7 && rl7.kind === 'quiet'
       && /^first/.test(rl7.draftKey) && rl7.pass.class === 'long' && (await look(BD, l6)) === null, show(rl7));
    const s5 = await mk('Sami Shortfive'), s4 = await mk('Sara Shortfour'), p14 = await mk('Pia Packfourteen'), p13 = await mk('Pat Packthirteen');
    await pass(s5, 'unlim3', { from: addD(BD, -60), until: addD(BD, 29) }); await seat(s5, addD(BD, -5));
    await pass(s4, 'unlim3', { from: addD(BD, -60), until: addD(BD, 29) }); await seat(s4, addD(BD, -4));
    await pass(p14, 'pack8', { used: 3, from: addD(BD, -30), until: addD(BD, 30) }); await seat(p14, addD(BD, -14));
    await pass(p13, 'pack8', { used: 3, from: addD(BD, -30), until: addD(BD, 30) }); await seat(p13, addD(BD, -13));
    const rs5 = await look(BD, s5), rp14 = await look(BD, p14);
    ok('a membership of 3 months or less is listed at 5 days; a class pack only at 14',
       rs5 && rs5.state === 'todo' && rs5.step === 1 && rs5.pass.class === 'short' && (await look(BD, s4)) === null
       && rp14 && rp14.state === 'todo' && rp14.step === 1 && rp14.pass.class === 'pack' && rp14.pass.creditsLeft === 5
       && (await look(BD, p13)) === null, show(rs5) + show(rp14));
    const l14 = await mk('Leo Longfourteen'), l13 = await mk('Lia Longthirteen'), s10 = await mk('Sol Shortten'), s9 = await mk('Sue Shortnine');
    const p20 = await mk('Pen Packtwenty');
    await longPass(l14); await seat(l14, addD(BD, -14));
    await longPass(l13); await seat(l13, addD(BD, -13));
    await pass(s10, 'unlim1', { from: addD(BD, -20), until: addD(BD, 9) }); await seat(s10, addD(BD, -10));
    await pass(s9, 'unlim1', { from: addD(BD, -20), until: addD(BD, 9) }); await seat(s9, addD(BD, -9));
    await pass(p20, 'pack8', { used: 1, from: addD(BD, -25), until: addD(BD, 35) }); await seat(p20, addD(BD, -20));
    const [rl14, rl13, rs10, rs9, rp20] = await Promise.all([l14, l13, s10, s9, p20].map(m => look(BD, m)));
    ok('step 2 at 14 days (10 for a short pass), marked for the teacher; a pack never gets step 2',
       rl14.step === 2 && rl14.sender === 'teacher' && rl14.draftKey === 'teacher' && rl13.step === 1 && rl13.sender === 'staff'
       && rs10.step === 2 && rs10.sender === 'teacher' && rs9.step === 1 && rp20.step === 1 && rp20.sender === 'staff'
       && rp20.daysQuiet === 20, [rl14, rl13, rs10, rs9, rp20].map(show).join(' '));
    const p21 = await mk('Pam Packtwentyone'), n21 = await mk('Nat Neverthree');
    await pass(p21, 'pack8', { used: 1, from: addD(BD, -30), until: addD(BD, 30) }); await seat(p21, addD(BD, -21));
    await pass(n21, 'unlim1', { from: addD(BD, -21), until: addD(BD, 8) });
    const [rp21, rn21] = [await look(BD, p21), await look(BD, n21)];
    ok('from 21 quiet days with no note yet, the name goes to the teacher only; a pack still has one note',
       rp21.step === 1 && rp21.sender === 'teacher' && rp21.draftKey === 'teacher'
       && rn21.kind === 'new' && rn21.step === 1 && rn21.sender === 'teacher' && rn21.draftKey === 'fresh', show(rp21) + show(rn21));
    const ear = await mk('Eli Earlymorning');
    await pass(ear, 'unlim3', { from: addD(BD, -60), until: addD(BD, 29) });
    await seat(ear, addD(BD, -1), { t: '05:30' });
    const [e3, e4] = [await look(addD(BD, 3), ear), await look(addD(BD, 4), ear)];
    ok('a 05:30 class yesterday is 1 day ago (Bangkok day, not UTC)', e3 === null && e4 && e4.daysQuiet === 5
       && e4.lastCame === addD(BD, -1), show(e4));

    const n3 = await mk('Nora Newthree'), n2 = await mk('Ned Newtwo'), nd = await mk('Nia Nodates'), nd2 = await mk('Nico Nodatesmidnight');
    const np = await mk('Nell Newpack');
    await pass(n3, 'unlim1', { from: addD(BD, -3), until: addD(BD, 26) });
    await pass(n2, 'unlim1', { from: addD(BD, -2), until: addD(BD, 27) });
    await pass(nd, 'unlim1', { created: `${addD(BD, -3)}T23:30:00+07:00` });
    await pass(nd2, 'unlim1', { created: `${addD(BD, -2)}T00:30:00+07:00` });
    await pass(np, 'pack8', { from: addD(BD, -7), until: addD(BD, 53) });
    const [rn3, rnd, rnp] = [await look(BD, n3), await look(BD, nd), await look(BD, np)];
    ok('a first pass never used is listed as new from day 3 with the welcome draft',
       rn3.kind === 'new' && rn3.state === 'todo' && rn3.step === 1 && rn3.sender === 'staff' && rn3.draftKey === 'fresh'
       && rn3.lastCame === null && (await look(BD, n2)) === null, show(rn3));
    ok('...a pass with no dates counts from the Bangkok day it was bought; a new pack from day 7',
       rnd && rnd.kind === 'new' && rnd.daysQuiet === 3 && rnd.since === addD(BD, -3) && (await look(BD, nd2)) === null
       && rnp && rnp.kind === 'new' && rnp.daysQuiet === 7 && (await look(addD(BD, -1), np)) === null, show(rnd) + show(rnp));
    const rz = await mk('Rita Rezervbefore', { source: 'rezerv' }), rzb = await mk('Rob Rezervbooking');
    await pass(rz, 'unlim1', { from: addD(BD, -5), until: addD(BD, 24) });
    await pass(rzb, 'unlim1', { from: addD(BD, -5), until: addD(BD, 24) });
    await seat(rzb, addD(BD, -90), { source: 'rezerv', in: false });
    const [rrz, rrzb] = [await look(BD, rz), await look(BD, rzb)];
    ok('a student who came over from Rezerv is never new', rrz && rrz.kind === 'quiet' && !/fresh/.test(rrz.draftKey)
       && rrzb && rrzb.kind === 'quiet', show(rrz) + show(rrzb));
    const back = await mk('Ben Backagain');
    await pass(back, 'unlim1', { from: addD(BD, -70), until: addD(BD, -41) });
    await seat(back, addD(BD, -45));
    await pass(back, 'unlim1', { from: BD, until: addD(BD, 29) });
    const rbk5 = await look(addD(BD, 5), back);
    ok('a returning student who bought a new pass today is not quiet', (await look(BD, back)) === null && (await look(addD(BD, 4), back)) === null
       && rbk5 && rbk5.kind === 'quiet' && rbk5.since === BD, show(rbk5));
    const bk = await mk('Bea Bookedtoday'), bk2 = await mk('Bo Bookedlater');
    await longPass(bk); await seat(bk, addD(BD, -10)); await seat(bk, BD, { in: false });
    await longPass(bk2); await seat(bk2, addD(BD, -10)); await seat(bk2, addD(BD, 3), { in: false });
    ok('not someone with a booking today or later', (await look(BD, bk)) === null && (await look(BD, bk2)) === null);

    // Paused: the real unpause route, so it runs on the real Bangkok today.
    const fz = await mk('Fay Frozen');
    const fzp = await pass(fz, 'unlim3', { status: 'frozen', from: addD(todayB, -60), until: addD(todayB, 40), ffrom: addD(todayB, -20), funtil: addD(todayB, 5) });
    await seat(fz, addD(todayB, -25), { pass: fzp });
    const fzBefore = await rows(todayB, fz);
    const unf = await post(`/api/bkk/admin/passes/${fzp}/unfreeze`, {}, ADMIN);
    const [fz0, fz4, fz5] = [await look(todayB, fz), await look(addD(todayB, 4), fz), await look(addD(todayB, 5), fz)];
    ok('not a paused pass; after unpausing the count starts on that day', fzBefore.todo.length + fzBefore.resting.length + fzBefore.parked.length === 0
       && unf.status === 200 && fz0 === null && fz4 === null && fz5 && fz5.since === todayB && fz5.daysQuiet === 5, show(fz5));
    const later = await mk('Lou Startslater'), ended = await mk('Eva Ended'), voided = await mk('Vic Voided'), used = await mk('Uma Usedup'),
      drop = await mk('Dot Dropin');
    await longPass(later, { from: addD(BD, 3) }); await seat(later, addD(BD, -30));
    await longPass(ended, { until: addD(BD, -1) }); await seat(ended, addD(BD, -30));
    await longPass(voided, { status: 'void' }); await seat(voided, addD(BD, -30));
    await pass(used, 'pack8', { used: 8, from: addD(BD, -40), until: addD(BD, 20) }); await seat(used, addD(BD, -30));
    await pass(drop, 'dropin', { from: addD(BD, -30), until: addD(BD, 30) }); await seat(drop, addD(BD, -30));
    const none = [];
    for (const m of [later, ended, voided, used, drop]) if (await look(BD, m)) none.push(m.name);
    ok('not a pass that starts later, an ended, voided or used-up pass, or a drop-in', none.length === 0, none.join());
    const online = (await one(`SELECT id FROM bkk_class_slots WHERE is_online AND active ORDER BY id LIMIT 1`)).id;
    const ol = await mk('Oli Online');
    await longPass(ol); await seat(ol, addD(BD, -20)); await seat(ol, addD(BD, -3), { slot: online, in: false, t: '06:30' });
    const rol = await look(addD(BD, 4), ol);
    ok('an online class booked and over counts as came', (await look(BD, ol)) === null && rol && rol.lastCame === addD(BD, -3)
       && rol.daysQuiet === 7 && rol.unchecked === 0, show(rol));
    const door = await mk('Dee Doorrezerv');
    await pass(door, 'unlim3', { from: addD(BD, -60), until: addD(BD, 29) });
    await seat(door, addD(BD, -3), { cover: 'rezerv', source: 'door' });
    const rdoor = await look(addD(BD, 2), door);
    ok('a door check-in on a Rezerv package counts as came', (await look(BD, door)) === null && rdoor && rdoor.lastCame === addD(BD, -3), show(rdoor));
    const two = await mk('Tia Twotimes');
    await longPass(two, { from: addD(BD, -100) });
    await pass(two, 'pack8', { used: 2, from: addD(BD, -20), until: addD(BD, 40) });
    await seat(two, addD(BD, -8), { t: '05:30' }); await seat(two, addD(BD, -8), { t: '07:30' });
    const rtwo = await rows(BD, two);
    ok('two classes on one day change nothing; one row for a student with two usable passes',
       rtwo.todo.length + rtwo.resting.length + rtwo.parked.length === 1 && rtwo.todo[0].daysQuiet === 8
       && rtwo.todo[0].pass.class === 'long', JSON.stringify(rtwo.todo.map(show)));
    const unc = await mk('Una Unchecked');
    await longPass(unc); await seat(unc, addD(BD, -15), { in: false }); await seat(unc, addD(BD, -12));
    await seat(unc, addD(BD, -9), { in: false }); await seat(unc, addD(BD, -5), { in: false });
    const runc = await look(BD, unc);
    ok('a booked seat with no check-in since the last visit shows as unchecked', runc && runc.unchecked === 2 && runc.daysQuiet === 12, show(runc));

    // ── which draft ──
    const moon = [...moonDaysBetween(addD(BD, 20), addD(BD, 60)).keys()][0];
    const dr = await mk('Dora Draftfirst'), de = await mk('Dan Draftending'), dc = await mk('Del Draftcarrieson');
    await longPass(dr, { until: addD(moon, 60) }); await seat(dr, addD(moon, -12));
    await longPass(de, { until: addD(moon, 5) }); await seat(de, addD(moon, -12));
    await longPass(dc, { until: addD(moon, 5) }); await pass(dc, 'unlim3', { from: addD(moon, 6), until: addD(moon, 95) });
    await seat(dc, addD(moon, -12));
    const at = async (d, m) => (await look(d, m) || {}).draftKey;
    const openDay = addD(moon, -3), moonEve = addD(moon, -1), shutEve = addD(moon, -4);
    for (const s of (await pool.query(`SELECT id FROM bkk_class_slots WHERE active AND NOT is_online AND weekday=$1`,
      [new Date(addD(shutEve, 1) + 'T12:00:00Z').getUTCDay()])).rows) {
      await pool.query(`INSERT INTO bkk_class_overrides (slot_id,class_date,cancelled,note) VALUES ($1,$2,true,'made-up closure')`, [s.id, addD(shutEve, 1)]);
    }
    const keys = { open: [await at(openDay, dr), await at(openDay, de), await at(openDay, dc)],
      moon: [await at(moonEve, dr), await at(moonEve, de)], shut: [await at(shutEve, dr), await at(shutEve, de)] };
    ok('draft choice: step 1 gives first; a pass ending within 14 days with nothing carrying on gives ending',
       keys.open.join() === 'first,ending,first', JSON.stringify(keys));
    const says = k => quietDraft(k, 'en', 'Dora', 'kha') + ' ' + quietDraft(k, 'th', 'Dora', 'kha');
    ok('...when tomorrow is a moon day or every class is closed, the draft has no "tomorrow" and no "พรุ่งนี้"',
       keys.moon.join() === 'firstClosed,endingClosed' && keys.shut.join() === 'firstClosed,endingClosed'
       && [...keys.moon, ...keys.shut].every(k => !/tomorrow|พรุ่งนี้/i.test(says(k)))
       && keys.open.slice(0, 2).every(k => /tomorrow/.test(says(k)) && /พรุ่งนี้/.test(says(k))), JSON.stringify(keys));

    // ── the drafts themselves ──
    const bad = [];
    const keyNames = Object.keys(QUIET_TEXTS);
    for (const k of keyNames) for (const lang of ['en', 'th']) for (const ka of ['krub', 'kha']) {
      const t = quietDraft(k, lang, 'Mali', ka), why = [];
      if (/[‐-―−-]/.test(t)) why.push('dash');
      if (/[0-9๐-๙]/.test(t)) why.push('digit');
      if (/฿|baht|บาท/i.test(t)) why.push('baht');
      if (/a week|ต่ออาทิตย์|ไม่ต้องมา/i.test(t)) why.push('count');
      if (/sorry|miss|ขอโทษ|คิดถึง/i.test(t)) why.push('banned');
      if (/[{}]/.test(t)) why.push('placeholder');
      if (/(ไหม|บ้าง|นะ)\s*(ครับ|ค่ะ|คะ)/.test(t)) why.push('particle after a question');
      if (!/^q\d$/.test(k) && !t.includes('Mali')) why.push('no name');
      if (lang === 'en' && t.split(/\s+/).length >= 45) why.push('long');
      if (lang === 'th' && /\{ka\}/.test(QUIET_TEXTS[k].th) && !t.includes(k === 'teacher' || ka === 'krub' ? 'ครับ' : 'ค่ะ')) why.push('ka');
      if (lang === 'th' && k !== 'teacher' && ka === 'kha' && t.includes('ครับ')) why.push('wrong ka');
      if (why.length) bad.push(`${k}/${lang}/${ka}: ${why}`);
    }
    ok('drafts, every key, both languages, both particles: no dash, digit, baht, count, sorry, miss or placeholder; under 45 words; ka never after a question',
       keyNames.length === 13 && bad.length === 0, bad.join(' | '));
    ok('the teacher\'s note is Boonchu\'s own: its Thai always ends ครับ', quietDraft('teacher', 'th', 'Mali', 'kha').endsWith('ครับ')
       && !quietDraft('teacher', 'th', 'Mali', 'kha').includes('ค่ะ'));
    ok('a first name is the first word, never an email, phone or code', firstName('Mali Midway') === 'Mali'
       && firstName('Bo bo@example.com 0812345678 Chan') === 'Bo' && firstName('B1B19BKGPI3QYA Anna') === 'Anna' && firstName('ทดสอบ ใจดี') === 'ทดสอบ');

    // ── the routes, on the real Bangkok today ──
    const on = await post('/api/bkk/admin/settings', { quietBox: 'on' }, ADMIN);
    const mali = await mk('Mali Midway');
    await pass(mali, 'unlim12m', { from: addD(todayB, -100), until: addD(todayB, 200) });
    await seat(mali, addD(todayB, -8));
    const g = await quietGet('kha');
    const gm = listed(g.body, mali.code);
    ok('switched on, the box lists them with the draft built on the server', on.status === 200 && g.body.on === true && g.body.asOf === todayB
       && gm && gm.state === 'todo' && gm.step === 1 && gm.sender === 'staff' && gm.daysQuiet === 8 && gm.draft
       && gm.draft.en === quietDraft(gm.draftKey, 'en', 'Mali', 'kha') && gm.draft.th === quietDraft(gm.draftKey, 'th', 'Mali', 'kha')
       && g.body.questions.length === 3 && g.body.questions[1].th.endsWith('ค่ะ') && listed(g.body, early.code), JSON.stringify(gm));
    const gmText = JSON.stringify(gm);
    ok('...first name only in the draft; no email, phone or member code anywhere in a row', !/Midway/.test(gm.draft.en + gm.draft.th)
       && !gmText.includes('@') && !gmText.includes('0870000') && !('email' in gm) && !('phone' in gm) && !('memberId' in gm)
       && !(gm.draft.en + gm.draft.th).includes(mali.code));
    ok('...ka=krub gives ครับ; a bad ka is refused', (listed((await quietGet('krub')).body, mali.code).draft.th || '').endsWith('ครับ')
       && (await quietGet('ma')).status === 400);
    ok('messaged needs the key, a known student and a name', (await post(`/api/bkk/admin/quiet/${mali.code}/messaged`, { by: 'M', step: 1 })).status === 401
       && (await post('/api/bkk/admin/quiet/BNOSUCHONE/messaged', { by: 'M', step: 1 }, ADMIN)).status === 404
       && (await post(`/api/bkk/admin/quiet/${mali.code}/messaged`, { by: '  ', step: 1 }, ADMIN)).status === 400
       && (await post(`/api/bkk/admin/quiet/${mali.code}/messaged`, { by: 'M', step: 3 }, ADMIN)).status === 400
       && (await post(`/api/bkk/admin/quiet/${mali.code}/messaged`, { by: 'M', step: 1, draftKey: 'replyMoney' }, ADMIN)).status === 400
       && (await one(`SELECT count(*)::int AS n FROM bkk_outreach WHERE member_id=$1`, [mali.id])).n === 0);
    const sent1 = await post(`/api/bkk/admin/quiet/${mali.code}/messaged`, { by: 'M', step: 1, draftKey: gm.draftKey }, ADMIN);
    const sent2 = await post(`/api/bkk/admin/quiet/${mali.code}/messaged`, { by: 'Jamsai', step: 1, draftKey: gm.draftKey }, ADMIN);
    const saved = await one(`SELECT *, to_char(created_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') AS day FROM bkk_outreach WHERE member_id=$1`, [mali.id]);
    ok('messaged records who, when, step and days quiet, and the draft key, never its text', sent1.status === 200 && sent1.body.again === false
       && saved.kind === 'message' && saved.messaged_by === 'M' && saved.step === 1 && saved.days_quiet === 8 && saved.day === todayB
       && saved.draft_key === gm.draftKey && !!saved.messaged_at && !JSON.stringify(saved).includes('see you'), JSON.stringify(saved));
    ok('...a second tap the same day adds nothing', sent2.body.again === true && sent2.body.outreach.id === sent1.body.outreach.id
       && sent2.body.outreach.by === 'M' && (await one(`SELECT count(*)::int AS n FROM bkk_outreach WHERE member_id=$1`, [mali.id])).n === 1);
    const rest = listed((await quietGet()).body, mali.code);
    ok('...and the row rests', rest && rest.state === 'resting' && rest.draft === null && rest.messaged.length === 1
       && rest.messaged[0].by === 'M' && rest.outreachId === sent1.body.outreach.id, JSON.stringify(rest));
    const undo = await post(`/api/bkk/admin/quiet/${mali.code}/messaged`, { undo: true }, ADMIN);
    ok('undo removes today\'s row when it has no reason', undo.body.undone === true
       && (await one(`SELECT count(*)::int AS n FROM bkk_outreach WHERE member_id=$1`, [mali.id])).n === 0
       && listed((await quietGet()).body, mali.code).state === 'todo');
    const sent3 = await post(`/api/bkk/admin/quiet/${mali.code}/messaged`, { by: 'M' }, ADMIN);
    await post(`/api/bkk/admin/outreach/${sent3.body.outreach.id}/reason`, { by: 'M', reason: 'work' }, ADMIN);
    const undo2 = await post(`/api/bkk/admin/quiet/${mali.code}/messaged`, { undo: true }, ADMIN);
    ok('...but not one with an answer on it; step and draft come from the row when not sent', sent3.body.outreach.step === 1
       && sent3.body.outreach.draftKey === gm.draftKey && undo2.body.undone === false
       && (await one(`SELECT count(*)::int AS n FROM bkk_outreach WHERE member_id=$1`, [mali.id])).n === 1);

    // A spell, day by day: notes on the days they were sent, visits added as they happen.
    const sp = await mk('Sky Spell');
    await longPass(sp); await seat(sp, addD(BD, -8));
    await note(sp, BD, { step: 1 });
    const sp1 = await look(addD(BD, 1), sp), sp5 = await look(addD(BD, 5), sp);
    await seat(sp, addD(BD, 3));
    const sp10 = await look(addD(BD, 10), sp);
    await seat(sp, addD(BD, 22));
    const sp29 = await look(addD(BD, 29), sp), sp30 = await look(addD(BD, 30), sp);
    ok('after step 1 the row rests; no second step-1 draft in that spell', sp1.state === 'resting' && sp5.state === 'resting' && sp5.draftKey === null,
       show(sp1) + show(sp5));
    ok('...and none for 30 days even after they came back and went quiet again', sp10.state === 'resting' && sp10.since === addD(BD, 3)
       && sp29.state === 'resting' && sp29.daysQuiet === 7 && sp30.state === 'todo' && sp30.step === 1, [sp10, sp29, sp30].map(show).join(' '));
    const st = await mk('Stu Steptwo');
    await longPass(st); await seat(st, addD(BD, -11));
    await note(st, BD, { step: 1 });
    const [st2, st3, st5] = [await look(addD(BD, 2), st), await look(addD(BD, 3), st), await look(addD(BD, 5), st)];
    ok('step 2 comes at its day and never within 5 days of the step-1 note', st2.state === 'resting' && st2.daysQuiet === 13
       && st3.state === 'resting' && st3.daysQuiet === 14 && st5.state === 'todo' && st5.step === 2 && st5.sender === 'teacher'
       && st5.draftKey === 'teacher', [st2, st3, st5].map(show).join(' '));
    await note(st, addD(BD, 5), { step: 2 });
    const [st6, st40] = [await look(addD(BD, 6), st), await look(addD(BD, 40), st)];
    ok('after step 2 the row is parked: no third draft in that spell', st6.state === 'parked' && st40.state === 'parked'
       && st40.draftKey === null && st40.messaged.length === 2, show(st6) + show(st40));
    const pk = await mk('Pip Packonce');
    await pass(pk, 'pack8', { used: 2, from: addD(BD, -40), until: addD(BD, 30) }); await seat(pk, addD(BD, -14));
    await note(pk, BD, { step: 1 });
    ok('...a pack is parked after its one note', (await look(addD(BD, 1), pk)).state === 'parked' && (await look(addD(BD, 20), pk)).state === 'parked');
    const an = await mk('Ana Answered');
    await longPass(an); await seat(an, addD(BD, -7));
    await note(an, BD, { step: 1, reason: 'work' });
    const an7 = await look(addD(BD, 7), an);
    ok('an answer parks the row: no step 2', an7.state === 'parked' && an7.daysQuiet === 14 && an7.reason === 'work' && an7.step === null, show(an7));

    const kw = await mk('Kit Knownwhy');
    await longPass(kw, { from: addD(todayB, -100), until: addD(todayB, 200) }); await seat(kw, addD(todayB, -9));
    const kn = await post(`/api/bkk/admin/quiet/${kw.code}/known`, { by: 'Jamsai', reason: 'travel', note: 'Away for a family trip (made up)' }, ADMIN);
    const kwRow = listed((await quietGet()).body, kw.code);
    ok('"we know why" parks the row with no message', kn.status === 200 && kn.body.outreach.kind === 'known' && kn.body.outreach.step === null
       && kwRow && kwRow.state === 'parked' && kwRow.reason === 'travel' && kwRow.messaged.length === 0
       && (await one(`SELECT count(*)::int AS n FROM bkk_outreach WHERE member_id=$1 AND kind='message'`, [kw.id])).n === 0, JSON.stringify(kwRow));
    ok('...it takes one of the eight reasons and a name', (await post(`/api/bkk/admin/quiet/${kw.code}/known`, { by: 'M', reason: 'lazy' }, ADMIN)).status === 400
       && (await post(`/api/bkk/admin/quiet/${kw.code}/known`, { reason: 'work' }, ADMIN)).status === 400);
    const mu = await mk('Moe Ownrhythm');
    await longPass(mu, { from: addD(todayB, -100), until: addD(todayB, 200) }); await seat(mu, addD(todayB, -10));
    const muted0 = (await quietGet()).body.muted;
    const mt = await post(`/api/bkk/admin/quiet/${mu.code}/mute`, { by: 'M' }, ADMIN);
    const g2 = (await quietGet()).body;
    const [mu89, mu90, mu91] = [await rows(addD(todayB, 89), mu), await rows(addD(todayB, 90), mu), await look(addD(todayB, 91), mu)];
    ok('"their own rhythm" hides the student for 90 days', mt.status === 200 && mt.body.outreach.muteUntil === addD(todayB, 90)
       && !listed(g2, mu.code) && g2.muted === muted0 + 1 && mu89.muted === 1 && mu90.muted === 1 && mu90.todo.length === 0
       && mu91 !== null, JSON.stringify([mt.body, mu89.muted, mu90.muted, show(mu91)]));

    const ci = await mk('Cal Checkedin');
    await longPass(ci, { from: addD(todayB, -100), until: addD(todayB, 200) }); await seat(ci, addD(todayB, -9));
    const ciSent = await post(`/api/bkk/admin/quiet/${ci.code}/messaged`, { by: 'M' }, ADMIN);
    await post(`/api/bkk/admin/outreach/${ciSent.body.outreach.id}/reason`, { by: 'M', reason: 'habit' }, ADMIN);
    const ciBefore = listed((await quietGet()).body, ci.code);
    await seat(ci, todayB);
    const ciAfter = (await quietGet()).body;
    const [ci7, ci14] = [await look(addD(todayB, 7), ci), await look(addD(todayB, 14), ci)];
    ok('a check-in after the message takes them off every list and starts a new spell', ciBefore.state === 'parked' && !listed(ciAfter, ci.code)
       && ci7.state === 'resting' && ci7.since === todayB && ci7.reason === null && ci14.state === 'todo' && ci14.step === 2,
       [ciBefore, ci7, ci14].map(show).join(' '));

    // ── the Rezerv switch ──
    const rzMk = async name => { const m = await mk(name, { source: 'rezerv' });
      await pass(m, 'unlim3', { from: addD(todayB, -60), until: addD(todayB, 29), source: 'rezerv' });
      await seat(m, addD(todayB, -20), { source: 'rezerv' }); return m; };
    const [rz1, rz2] = [await rzMk('Ray Rezervone'), await rzMk('Roo Rezervtwo')];
    const hid = (await quietGet()).body;
    const direct = await quietRows(QS, { date: todayB, cfg: { ...CFG, quietRezerv: 'hide' } });
    ok('Rezerv guard: a Rezerv pass is held back and counted', !listed(hid, rz1.code) && !listed(hid, rz2.code) && hid.heldBack >= 2
       && hid.heldBack === direct.heldBack && hid.rezerv.show === false && hid.rezerv.openFirst === true, JSON.stringify([hid.heldBack, hid.rezerv]));
    const sw = await post('/api/bkk/admin/settings', { quietRezerv: 'show' }, ADMIN);
    const swDay = (await quietGet()).body;
    const cfgNow = { ...CFG, quietRezerv: 'show', quietRezervFrom: sw.body.quiet.quietRezervFrom };
    ok('...on the day quietRezerv becomes show nobody on a Rezerv pass is listed', sw.status === 200 && sw.body.quiet.quietRezervFrom === todayB
       && swDay.heldBack === 0 && !listed(swDay, rz1.code) && !listed(swDay, rz2.code) && swDay.rezerv.openFirst === true, JSON.stringify(swDay.rezerv));
    await seat(rz2, addD(todayB, 3));
    const [r7a, r7b] = [await look(addD(todayB, 7), rz1, cfgNow), await look(addD(todayB, 7), rz2, cfgNow)];
    ok('...7 days later one with no visit here is listed and one who came here is not', r7a && r7a.daysQuiet === 7 && r7a.since === todayB
       && r7a.kind === 'quiet' && r7b === null, show(r7a));
    await pool.query(`UPDATE bkk_settings SET value=$1 WHERE key='quiet_rezerv_from'`, [JSON.stringify(addD(todayB, -3))]);
    await post('/api/bkk/admin/settings', { quietRezerv: 'hide' }, ADMIN);
    const again = await post('/api/bkk/admin/settings', { quietRezerv: 'show' }, ADMIN);
    ok('...toggling again keeps the first date', again.body.quiet.quietRezervFrom === addD(todayB, -3) && again.body.quiet.quietRezerv === 'show'
       && (await quietGet()).body.rezerv.from === addD(todayB, -3), JSON.stringify(again.body.quiet));
    await post('/api/bkk/admin/settings', { quietRezerv: 'hide' }, ADMIN);

    // ── the profile and the student's own page ──
    const hm = (await J(`/api/bkk/admin/members/${mali.code}/history`, { headers: ADMIN })).body;
    await note(ci, addD(todayB, -40), { step: 1 });
    const hc = (await J(`/api/bkk/admin/members/${ci.code}/history`, { headers: ADMIN })).body;
    ok('history: outreach on the profile, newest first', hm.outreach.length === 1 && hm.outreach[0].reason === 'work' && hm.outreach[0].by === 'M'
       && hm.outreach[0].step === 1 && hm.outreach[0].daysQuiet === 8 && hc.outreach.length === 2
       && Date.parse(hc.outreach[0].at) > Date.parse(hc.outreach[1].at) && hc.outreach[0].reason === 'habit', JSON.stringify(hc.outreach));
    const meText = JSON.stringify((await J(`/api/bkk/me/${kw.code}`)).body) + JSON.stringify((await J(`/api/bkk/me/${mali.code}`)).body);
    ok('the student\'s own page never carries outreach', meText.length > 50 && !/outreach|messaged|travel|family trip|reason/i.test(meText), meText.slice(0, 200));
    await post('/api/bkk/admin/settings', { quietBox: 'off' }, ADMIN);
    ok('...and switched off again, the box is empty', (await quietGet()).body.todo.length === 0);
  }

  console.log('\n# why students go quiet');
  {
    const one = async (sql, args = []) => (await pool.query(sql, args)).rows[0] || {};
    const todayB = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const m = await one(`INSERT INTO bkk_members (code,name,email,phone) VALUES ('BTESTQWHY1X','Wren Whyquiet','wren.why@example.com','0871111111')
      RETURNING id, code`);
    const mkNote = async (day, o = {}) => (await one(`INSERT INTO bkk_outreach (member_id,kind,step,created_at,messaged_at,messaged_by,reason,answered_at)
      VALUES ($1,$2,$3,$4,$4,'Test Staff',$5,$6) RETURNING id`, [o.member || m.id, o.kind || 'message', (o.kind || 'message') === 'message' ? 1 : null,
      `${day}T10:00:00+07:00`, o.reason || null, o.reason ? `${day}T12:00:00+07:00` : null])).id;
    const id = await mkNote(todayB);
    const why = (oid, b, h = ADMIN) => post(`/api/bkk/admin/outreach/${oid}/reason`, b, h);
    const eight = ['work', 'travel', 'health', 'habit', 'money', 'moved', 'us', 'other'];
    const st = [];
    for (const r of eight) st.push((await why(id, { by: 'M', reason: r, ka: 'kha' })).status);
    ok('reason: one of the eight; anything else is refused', st.every(s => s === 200)
       && (await why(id, { by: 'M', reason: 'lazy' })).status === 400 && (await why(id, { by: 'M' })).status === 400, JSON.stringify(st));
    const mute = await one(`INSERT INTO bkk_outreach (member_id,kind,mute_until) VALUES ($1,'mute',now()::date + 90) RETURNING id`, [m.id]);
    ok('needs the key and a real outreach row', (await why(id, { by: 'M', reason: 'work' }, {})).status === 401
       && (await why(999999, { by: 'M', reason: 'work' })).status === 404 && (await why('abc', { by: 'M', reason: 'work' })).status === 404
       && (await why(mute.id, { by: 'M', reason: 'work' })).status === 404 && (await why(id, { reason: 'work' })).status === 400);
    const w1 = await why(id, { by: 'M', reason: 'work', note: 'New job, early shifts (made up)' });
    const row1 = await one('SELECT * FROM bkk_outreach WHERE id=$1', [id]);
    const w2 = await why(id, { by: 'Jamsai', reason: 'habit', note: 'Said mornings slipped (made up)' });
    const row2 = await one('SELECT * FROM bkk_outreach WHERE id=$1', [id]);
    ok('saved with who and when; a second answer replaces the first', w1.status === 200 && row1.reason === 'work' && row1.answered_by === 'M'
       && !!row1.answered_at && row2.reason === 'habit' && row2.answered_by === 'Jamsai' && row2.reason_note === 'Said mornings slipped (made up)'
       && w2.body.outreach.reason === 'habit', JSON.stringify(row2));
    const long = 'ก'.repeat(150) + 'x'.repeat(150);
    await why(id, { by: 'M', reason: 'other', note: long });
    const cut = (await one('SELECT reason_note FROM bkk_outreach WHERE id=$1', [id])).reason_note;
    await why(id, { by: 'M', reason: 'health', note: 'Knee surgery details (made up)' });
    const hl = await one('SELECT reason, reason_note FROM bkk_outreach WHERE id=$1', [id]);
    const kh = await post(`/api/bkk/admin/quiet/${m.code}/known`, { by: 'M', reason: 'health', note: 'Back pain details (made up)' }, ADMIN);
    ok('a note is cut to 200 characters; for health no note is saved', [...cut].length === 200 && hl.reason === 'health' && hl.reason_note === null
       && kh.status === 200 && kh.body.outreach.note === null
       && (await one(`SELECT count(*)::int AS n FROM bkk_outreach WHERE reason_note ~ 'details \\(made up\\)'`)).n === 0, JSON.stringify([[...cut].length, hl, kh.body]));
    const reply = {};
    for (const r of eight) reply[r] = (await why(id, { by: 'M', reason: r, ka: 'krub' })).body.reply;
    const is = (r, key) => reply[r] && reply[r].en === quietDraft(key, 'en', 'Wren', 'krub') && reply[r].th === quietDraft(key, 'th', 'Wren', 'krub');
    ok('the reply draft matches the reason; moved, us and other return none', is('work', 'replyBusy') && is('travel', 'replyBusy')
       && is('health', 'replyHealth') && is('habit', 'replyHabit') && is('money', 'replyMoney')
       && reply.moved === null && reply.us === null && reply.other === null && reply.work.th.includes('ครับ') && !reply.work.en.includes('Whyquiet'),
       JSON.stringify(reply.work));

    // A stretch of days nothing else in these tests touches.
    const m2 = await one(`INSERT INTO bkk_members (code,name,email) VALUES ('BTESTQWHY2X','Ivo Countonly','ivo.count@example.com') RETURNING id, code`);
    const m3 = await one(`INSERT INTO bkk_members (code,name,email) VALUES ('BTESTQWHY3X','Jo Countonly','jo.count@example.com') RETURNING id, code`);
    await mkNote('2026-01-10', { member: m2.id, reason: 'work' });
    await mkNote('2026-01-12', { member: m3.id, reason: 'travel' });
    await mkNote('2026-01-20', { member: m.id });
    await mkNote('2026-01-15', { member: m3.id, kind: 'known', reason: 'travel' });
    await mkNote('2026-02-20', { member: m.id, reason: 'money' });
    const came = (mm, day, t) => pool.query(`INSERT INTO bkk_bookings (class_date,start_at,member_id,status,checked_in_at,cover,source,class_title)
      VALUES ($1,$2,$3,'booked',$2,'rezerv','door','Quiet Test')`, [day, `${day}T${t}:00+07:00`, mm]);
    await came(m2.id, '2026-01-10', '06:00');
    await came(m2.id, '2026-01-22', '06:00');
    await came(m3.id, '2026-01-12', '07:30');
    await came(m3.id, '2026-01-30', '06:00');
    const rep = (await J('/api/bkk/admin/report?from=2026-01-05&to=2026-01-25', { headers: ADMIN })).body;
    const qr = rep.quiet || {};
    ok('report: notes, came back within 14 days and reasons counted for the range, by reason only, no names',
       qr.messaged === 3 && qr.matured === 3 && qr.cameBack14 === 1 && qr.answered === 2
       && JSON.stringify(qr.byReason) === JSON.stringify([{ reason: 'travel', n: 2 }, { reason: 'work', n: 1 }])
       && !/Wren|Ivo|Jo |BTESTQ|example/.test(JSON.stringify(qr)), JSON.stringify(qr));
    const csv = [];
    for (const w of ['visits', 'payments', 'members']) {
      const r = await fetch(`${B}/api/bkk/admin/export/${w}.csv?member=${m.code}`, { headers: ADMIN });
      csv.push(await r.text());
    }
    const csvAll = await (await fetch(`${B}/api/bkk/admin/export/members.csv`, { headers: ADMIN })).text();
    const heads = t => t.replace(/^\uFEFF/, '').split('\r\n')[0].split(',');
    ok('the visits, payments and members spreadsheets carry no reason', csv.every(t => t.length > 10
       && !heads(t).some(h => /^(reason|reason_note|outreach|answered_\w+|mute_until)$/.test(h)) && !/made up|mornings slipped|health|habit/i.test(t))
       && !/made up|mornings slipped|Sick or hurt/i.test(csvAll) && !heads(csvAll).some(h => /^reason/.test(h)), csv.map(t => t.split('\r\n')[0]).join(' | '));
    const meWhy = JSON.stringify((await J(`/api/bkk/me/${m.code}`)).body);
    ok('the student\'s own page never carries a reason', meWhy.length > 20 && !/reason|outreach|health|money|habit|made up/i.test(meWhy), meWhy.slice(0, 200));
  }

  console.log(`\n${PASS} passed, ${FAIL} failed`);
  srv.close(); await pool.end();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
