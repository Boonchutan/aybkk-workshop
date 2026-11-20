// End-to-end test of bkk-api against a real Postgres.
process.env.BKK_ADMIN_KEY = 'testkey';
process.env.MAIL_DRY_RUN = '1';   // capture mail in an outbox instead of sending
process.env.BKK_TIMERS = 'off';   // the payment watch runs only when a test calls it
delete process.env.TELEGRAM_BOT_TOKEN;   // a ping goes to the Telegram stub only, when a block sets one
process.env.TELEGRAM_API_BASE = 'http://127.0.0.1:9';
const crypto = require('crypto');
const express = require('express');
const { Pool } = require('pg');
const { mountBkk, moonDaysBetween, parseWhen, CANCEL_CUTOFF_HOURS } = require('../bkk-api.js');

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
    url: (id, o) => { urlCalls.push({ id, o });
      return `signed://${o.type}/${id}/${o.transformation ? o.transformation[0].width : 'original.' + o.format}`; },
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
  const watch = await mountBkk(app, { pgPool: pool, cloudinary: fakeCloud, fetch: fakeFetch, now });
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
  // The teacher quick-add answers no member code (17 Nov 2026): tests that go on
  // to act as the student read it from the database.
  const quickAdd = async (body, headers) => {
    const m = (await post('/api/bkk/teacher/members', body, headers)).body.member;
    return m && { ...m, code: (await pool.query('SELECT code FROM bkk_members WHERE lower(email)=lower($1) AND merged_into IS NULL', [body.email])).rows[0].code };
  };

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
  // Today's classes stay listed after they start (16 Nov 2026), marked started: only today's.
  const todayList = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  ok("every class is still to come, or today's and marked started", sch.body.classes.every(c => new Date(c.startAt) > new Date()
    ? !c.started && !c.closed : c.started === true && c.date === todayList), JSON.stringify(sch.body.classes.slice(0, 3)));
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

  console.log('\n— booking open for the whole of 2027; teacher names by confirmed month (17 Nov 2026) —');
  {
    const today = todayList;
    const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
    const nextOf = m => addD(m + '-28', 7).slice(0, 7);
    const floor = addD(today, 61), cap = addD(today, 730);
    const dflt = '2027-12-31' < floor ? floor : '2027-12-31' > cap ? cap : '2027-12-31';
    ok('the timetable says how far booking is open: the whole of 2027 by default (never under 2 months)',
       (await J('/api/bkk/schedule?days=62')).body.openUntil === dflt, dflt);
    const g0 = (await J('/api/bkk/admin/settings', { headers: ADMIN })).body.booking || {};
    ok('Settings show it, with the month whose teachers students see', g0.openUntil === dflt && /^\d{4}-\d{2}$/.test(g0.teachersThrough)
       && g0.min === floor && g0.max === cap && g0.nextMonth === nextOf(today.slice(0, 7))
       && /^\d{4}-\d{2}$/.test(g0.showMonth) && g0.showMonth >= today.slice(0, 7) && typeof g0.teachersDue === 'boolean', JSON.stringify(g0));
    const bad = async body => (await post('/api/bkk/admin/settings', body, ADMIN)).status;
    ok('a booking window under 2 months, over 2 years, or not a date is refused',
       await bad({ bookingOpenUntil: addD(today, 10) }) === 400 && await bad({ bookingOpenUntil: addD(today, 800) }) === 400
       && await bad({ bookingOpenUntil: '31/12/2027' }) === 400);
    const lastM = addD(today.slice(0, 7) + '-01', -1).slice(0, 7);
    ok('a teacher month that is not a month, or is already over (even last month), is refused; this month is fine',
       await bad({ teachersThrough: '2027-13' }) === 400 && await bad({ teachersThrough: '2020-01' }) === 400
       && await bad({ teachersThrough: lastM }) === 400 && await bad({ teachersThrough: today.slice(0, 7) }) === 200);
    ok('changing them needs the staff key', (await post('/api/bkk/admin/settings', { bookingOpenUntil: addD(today, 300) })).status === 401);

    const until = addD(today, 300);
    const set = await post('/api/bkk/admin/settings', { bookingOpenUntil: until, teachersThrough: today.slice(0, 7) }, ADMIN);
    ok('staff open booking 300 days ahead', set.status === 200 && set.body.booking.openUntil === until
       && (await J('/api/bkk/schedule?days=1')).body.openUntil === until, JSON.stringify(set.body.booking));
    const far = addD(today, 150).slice(0, 7);
    const daysIn = m => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
    const fm = await J(`/api/bkk/schedule?days=${daysIn(far)}&from=${far}-01`);
    ok('a month 5 months ahead loads on its own (from=), with its classes and moon days', fm.status === 200 && fm.body.from === `${far}-01`
       && fm.body.classes.length > 20 && fm.body.classes.every(c => c.date.startsWith(far) && c.seatsLeft >= 0)
       && Object.keys(fm.body.moonDays).every(d => d.startsWith(far)) && Object.keys(fm.body.moonDays).length >= 1, `${fm.body.classes.length}`);
    ok('...a day before today reads as today, and a bad from is refused',
       (await J('/api/bkk/schedule?days=1&from=2020-01-01')).body.from === today && (await J('/api/bkk/schedule?from=2027-1-1')).status === 400);
    const after = await J(`/api/bkk/schedule?days=10&from=${addD(until, 1)}`);
    const edge = await J(`/api/bkk/schedule?days=62&from=${addD(until, -5)}`);
    ok('nothing is listed after the last open day, and a call running past it stops there',
       after.status === 200 && after.body.classes.length === 0 && after.body.to === until
       && edge.body.to === until && edge.body.classes.every(c => c.date <= until) && edge.body.classes.length > 0, JSON.stringify([after.body.to, edge.body.to]));

    // Teacher names: shown only up to the confirmed month; staff always see the plan.
    const n1 = nextOf(today.slice(0, 7)), n2 = nextOf(n1);
    const names = async (m, h) => (await J(`/api/bkk/schedule?days=${daysIn(m)}&from=${m}-01`, h ? { headers: h } : undefined)).body.classes
      .filter(c => c.date.startsWith(m)).map(c => c.teachers);
    const pubN1 = await names(n1), staffN1 = await names(n1, ADMIN);
    ok('next month not confirmed: students see its classes with no teacher name; staff still see the names',
       pubN1.length > 10 && pubN1.every(t => t === '') && staffN1.filter(Boolean).length > 10, JSON.stringify([pubN1.slice(0, 3), staffN1.slice(0, 3)]));
    const conf = await post('/api/bkk/admin/settings', { teachersThrough: n1 }, ADMIN);
    const pubN1b = await names(n1), pubN2 = await names(n2);
    ok('staff confirm next month: its teacher names show; the month after stays without them', conf.status === 200
       && conf.body.booking.teachersThrough === n1 && pubN1b.filter(Boolean).length > 10 && pubN2.length > 10 && pubN2.every(t => t === ''),
       JSON.stringify([pubN1b.slice(0, 3), pubN2.slice(0, 3)]));

    // Booking and drop-ins stop at the last open day.
    await post('/api/bkk/admin/settings', { bookingOpenUntil: floor }, ADMIN);
    const slots = (await pool.query(`SELECT id, weekday FROM bkk_class_slots WHERE active AND NOT is_online`)).rows;
    let shut = null;
    for (let i = 1; i <= 21 && !shut; i++) {
      const d = addD(floor, i), wd = new Date(d + 'T12:00:00Z').getUTCDay(), sl = slots.find(x => x.weekday === wd);
      if (sl && !moonDaysBetween(d, d).size) shut = { d, id: sl.id };
    }
    const who = (await pool.query(`INSERT INTO bkk_members (code,name,email) VALUES ('BTESTOPEN0001','Open Window','open.window@example.com') RETURNING code`)).rows[0].code;
    const bk = await post('/api/bkk/bookings', { memberCode: who, slotId: shut.id, date: shut.d });
    ok('a student cannot book a class after the last open day', bk.status === 409 && /not open yet/.test(bk.body.error), JSON.stringify(bk.body));
    const sbk = await post('/api/bkk/bookings', { memberCode: who, slotId: shut.id, date: shut.d }, ADMIN);
    ok('...staff still can (it only asks for a pass)', sbk.status === 409 && /no active pass/.test(sbk.body.error), JSON.stringify(sbk.body));
    const dr = await post('/api/bkk/orders', { productCode: 'dropin', name: 'Open Window', email: 'open.window@example.com', slotId: shut.id, date: shut.d });
    ok('...nor buy a drop-in for one (drop-ins open 2 weeks before the class), and the reply names the last day', dr.status === 409
       && dr.body.dropinUntil === addD(today, 13) && dr.body.error.includes(addD(today, 13)), JSON.stringify(dr.body));
    await pool.query(`UPDATE bkk_settings SET value='"2020-01-01"' WHERE key='booking_open_until'`);
    ok('a day left behind in Settings never closes booking: it stays open the next 2 months',
       (await J('/api/bkk/schedule?days=1')).body.openUntil === floor);

    // A pass first booked for a far class starts there and covers no day before
    // it: a 1-month pass is never a pass for every month up to that class.
    await post('/api/bkk/admin/settings', { bookingOpenUntil: addD(today, 300) }, ADMIN);
    const pick = async from => (await J(`/api/bkk/schedule?days=14&from=${from}`)).body.classes
      .find(c => !c.isOnline && !c.started && c.seatsLeft > 0 && c.date >= from);
    const grant = async (code, name) => (await post('/api/bkk/admin/passes', { name, email: `${code}@example.com`, productCode: code }, ADMIN)).body.member.code;
    const book = (m, c) => post('/api/bkk/bookings', { memberCode: m, slotId: c.slotId, date: c.date });
    const win = async m => (await pool.query(`SELECT to_char(p.valid_from,'YYYY-MM-DD') AS f, to_char(p.valid_until,'YYYY-MM-DD') AS u,
        p.credits_used AS used FROM bkk_passes p JOIN bkk_members m ON m.id=p.member_id WHERE m.code=$1`, [m])).rows[0];
    const farC = await pick(addD(today, 200)), nearC = await pick(addD(today, 1)), midC = await pick(addD(today, 100));
    const u1 = await grant('unlim1', 'Far First');
    const fb = await book(u1, farC);
    ok('a 1-month pass can book a class 200 days ahead first: its month starts there', fb.status === 200
       && (await win(u1)).f === farC.date && (await win(u1)).u === addD(farC.date, 30), JSON.stringify([fb.body, await win(u1)]));
    const nb = await book(u1, nearC), mb = await book(u1, midC);
    ok('...then it covers no class months before that month (no free year)', nb.status === 409 && mb.status === 409
       && /no active pass/.test(nb.body.error) && nb.body.error.includes(farC.date) && (await win(u1)).f === farC.date,
       JSON.stringify([nb.body, mb.body]));
    const shiftC = await pick(addD(farC.date, -20));
    const sb = await book(u1, shiftC);
    ok('...a class a few days before its first one moves the start there, same length, the far class still inside', sb.status === 200
       && sb.body.booking.pass_id === fb.body.booking.pass_id && (await win(u1)).f === shiftC.date
       && (await win(u1)).u === addD(shiftC.date, 30) && (await win(u1)).u >= farC.date, JSON.stringify(await win(u1)));
    const tooEarly = await book(u1, await pick(addD(shiftC.date, -25)));
    ok('...but never so far that a class already booked falls outside it', tooEarly.status === 409 && (await win(u1)).f === shiftC.date,
       JSON.stringify(tooEarly.body));
    const p8 = await grant('pack8', 'Far Pack');
    const fb8 = await book(p8, farC), nb8 = await book(p8, nearC);
    ok('the same for 8 classes: a near class is refused and uses no class', fb8.status === 200 && nb8.status === 409
       && (await win(p8)).used === 1 && (await win(p8)).f === farC.date, JSON.stringify([nb8.body, await win(p8)]));
    await post(`/api/bkk/bookings/${fb8.body.booking.id}/cancel`, { memberCode: p8 });
    const nb8b = await book(p8, nearC);
    ok('...once the far class is cancelled, a near class starts the pass there', nb8b.status === 200 && (await win(p8)).f === nearC.date
       && (await win(p8)).u === addD(nearC.date, 60), JSON.stringify([nb8b.body, await win(p8)]));
    for (const m of [u1, p8]) {
      await pool.query(`DELETE FROM bkk_bookings WHERE member_id=(SELECT id FROM bkk_members WHERE code=$1)`, [m]);
      await pool.query(`DELETE FROM bkk_passes WHERE member_id=(SELECT id FROM bkk_members WHERE code=$1)`, [m]);
      await pool.query(`DELETE FROM bkk_members WHERE code=$1`, [m]);
    }
    await pool.query(`DELETE FROM bkk_settings WHERE key IN ('booking_open_until', 'teachers_shown_through')`);
    await pool.query(`DELETE FROM bkk_members WHERE code='BTESTOPEN0001'`);
  }

  console.log('\n- the booking page loads later months: run from the page itself (17 Nov 2026) -');
  {
    const fs = require('fs'), vm = require('vm'), path = require('path');
    const page = fs.readFileSync(path.join(__dirname, '../public/bkk.html'), 'utf8');
    const seg = page.slice(page.indexOf('  const bkkToday = () =>'), page.indexOf('  const MONTHS = ['));
    const pageDays = page.match(/  const addDays = .*\n/)[0];
    const plus = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
    // A stand-in server: one class a day, 62 days a call, nothing after its last open day.
    const make = () => {
      const srv = { open: '2027-12-31', fail: false, calls: [], seats: {} };
      const day = (from, n) => { const out = []; for (let i = 0; i < n; i++) { const d = plus(from, i); if (d > srv.open) break; out.push(d); } return out; };
      const reply = from => {
        const ds = day(from, 62);
        return { classes: ds.map(d => ({ slotId: 1, date: d, seatsLeft: srv.seats[d] ?? 5 })), moonDays: {},
          from, to: ds.length ? ds[ds.length - 1] : srv.open, openUntil: srv.open };
      };
      const ctx = { clock: () => Date.parse('2026-11-17T03:00:00Z'), t: k => k, esc: s => String(s), noteClock: x => x,
        getJSON: async url => { const from = new URL(url, 'https://aybkk.net').searchParams.get('from'); srv.calls.push(from);
          if (srv.fail) throw new Error('HTTP 503'); return reply(from); } };
      vm.createContext(ctx);
      vm.runInContext(`let CLASSES = [], MOON = {};\n${pageDays}${seg}
        ;this.pg = { takeSchedule, loadTo, refreshFar, calWaits, calMayLoad, farNote, calEnd,
          month: m => { CALVIEW = 'month'; calMonth = m; }, retry: () => { FAR_FAIL = 0; },
          st: () => ({ CLASSES, LOAD_TO, OPEN_UNTIL, FAR_TO, FAR_FAIL, FAR_LOAD, selDate, n: CLASSES.length,
            dupes: CLASSES.length - new Set(CLASSES.map(c => c.date)).size }) };`, ctx);
      ctx.pg.takeSchedule(reply('2026-11-17'));
      return { srv, pg: ctx.pg };
    };
    {
      const { srv, pg } = make();
      pg.month('2027-12');
      await pg.loadTo(pg.calEnd());
      const far = srv.calls.length;
      pg.month('2027-03'); await pg.loadTo(pg.calEnd());
      ok('walking to December 2027 loads each 62 days once, and back loads nothing', far === 6 && srv.calls.length === 6
         && pg.st().LOAD_TO === '2027-12-31' && pg.st().dupes === 0 && !pg.calWaits(), JSON.stringify([srv.calls, pg.st().LOAD_TO]));
    }
    {
      const { srv, pg } = make();
      pg.month('2027-05'); await pg.loadTo(pg.calEnd());
      const was = pg.st().LOAD_TO;
      srv.open = '2027-04-30'; srv.calls.length = 0;
      pg.month('2027-08');
      await pg.loadTo(pg.calEnd()); await pg.loadTo(pg.calEnd());
      ok('staff shorten the window: one call, the later days go, and it stops asking', was > '2027-04-30' && srv.calls.length === 1
         && !pg.calWaits() && pg.st().OPEN_UNTIL === '2027-04-30' && pg.st().CLASSES.every(c => c.date <= '2027-04-30')
         && pg.st().LOAD_TO === '2027-04-30' && pg.st().FAR_TO === '2027-04-30',
         JSON.stringify([srv.calls, pg.st().LOAD_TO]));
    }
    {
      const { srv, pg } = make();
      srv.fail = true; pg.month('2027-02');
      await pg.loadTo(pg.calEnd());
      const failNote = pg.farNote('loadingMonth');
      ok('a far month that fails to load says so with Try again, and is not asked again at once', pg.calWaits() && !pg.calMayLoad()
         && /loadFail/.test(failNote) && /data-act="farRetry"/.test(failNote) && srv.calls.length === 1, failNote);
      srv.fail = false; pg.retry();
      ok('...Try again asks again and loads it', pg.calMayLoad() && /loadingMonth/.test(pg.farNote('loadingMonth')));
      await pg.loadTo(pg.calEnd());
      ok('...and the note goes', !pg.calWaits() && pg.farNote('loadingMonth') === '' && pg.st().LOAD_TO >= '2027-02-28');
    }
    {
      const { srv, pg } = make();
      pg.month('2027-12'); await pg.loadTo(pg.calEnd());
      pg.month('2027-03');
      srv.seats['2027-03-10'] = 0; srv.calls.length = 0;
      pg.takeSchedule((() => { const ds = []; for (let i = 0; i < 62; i++) ds.push(plus('2026-11-17', i));
        return { classes: ds.map(d => ({ slotId: 1, date: d, seatsLeft: 5 })), moonDays: {}, to: ds[61], openUntil: srv.open }; })());
      const ok1 = await pg.refreshFar();
      const c10 = pg.st().CLASSES.find(c => c.date === '2027-03-10');
      ok('a fresh first call also reloads the later month on screen (a class that filled shows full); later ones load fresh when visited',
         ok1 && c10 && c10.seatsLeft === 0 && srv.calls.length === 2 && pg.st().FAR_TO < '2027-06-01' && pg.st().dupes === 0
           && !pg.calWaits(), JSON.stringify([srv.calls, pg.st().FAR_TO, c10]));
      pg.month('2026-12'); srv.calls.length = 0;
      await pg.refreshFar();
      ok('...back on a near month, a refresh drops the later days and asks for nothing', srv.calls.length === 0 && pg.st().FAR_TO === null
         && pg.st().CLASSES.every(c => c.date <= '2027-01-17'));
    }
  }

  console.log('\n— staff change a student\'s name; the old one still finds her (20 Nov 2026) —');
  {
    // Made-up people only: this repo is public.
    const OLD = 'ทดลอง ชื่อเก่า', NEW = 'Renamo';
    const imp = rows => post('/api/bkk/admin/import/members', { rows, dryRun: false }, ADMIN);
    const one = async (sql, args = []) => (await pool.query(sql, args)).rows[0] || {};
    await imp([{ name: OLD, phone: '085-111-2299' }, { name: 'Fold Renamo', email: 'fold.renamo@example.com' }]);
    const who = await one(`SELECT code FROM bkk_members WHERE name=$1`, [OLD]);
    const rn = (code, name, h = ADMIN) => post(`/api/bkk/admin/members/${encodeURIComponent(code)}/name`, { name }, h);
    const r1 = await rn(who.code, `  ${NEW}  `);
    const row = await one(`SELECT name, former_names FROM bkk_members WHERE code=$1`, [who.code]);
    ok('staff change a name: the new one is saved (spaces trimmed), the old one kept', r1.status === 200 && r1.body.member.name === NEW
       && row.name === NEW && JSON.stringify(row.former_names) === JSON.stringify([OLD]) && JSON.stringify(r1.body.member.formerNames) === JSON.stringify([OLD]),
       JSON.stringify([r1.body, row]));
    const find = async (term, h = ADMIN) => ((await J('/api/bkk/admin/members?q=' + encodeURIComponent(term), { headers: h })).body.members || [])
      .filter(m => m.code === who.code);
    const byOld = await find('ชื่อเก่า'), byNew = await find('renamo');
    ok('...Admin search finds her by the new name and by the old one, and shows the old one', byNew.length === 1 && byOld.length === 1
       && JSON.stringify(byOld[0].former_names) === JSON.stringify([OLD]), JSON.stringify(byOld));
    const again = await imp([{ name: OLD, phone: '+66 85 111 2299' }, { name: OLD }]);
    const count = await one(`SELECT count(*)::int AS n FROM bkk_members WHERE name=$1 OR name=$2`, [OLD, NEW]);
    ok('...a Rezerv import under the old name (with her phone, or name only) finds her: no second profile', again.status === 200
       && again.body.added === 0 && again.body.matched === 2 && count.n === 1, JSON.stringify([again.body, count]));
    const csv = await post('/api/bkk/admin/import', { rows: [{ name: OLD, plan: '1 month', until: '2027-01-31' }] }, ADMIN);
    ok('...and so does the old CSV import', csv.status === 200 && (await one(`SELECT count(*)::int AS n FROM bkk_members WHERE name=$1`, [OLD])).n === 0
       && (await one(`SELECT count(*)::int AS n FROM bkk_passes p JOIN bkk_members m ON m.id=p.member_id WHERE m.code=$1`, [who.code])).n === 1,
       JSON.stringify(csv.body));
    // Another student really named OLD: her phone still picks her, never "2 students named …".
    await pool.query(`INSERT INTO bkk_members (code,name,email) VALUES ('BTESTTWIN001',$1,'other.oldname@example.com')`, [OLD]);
    const twin = await imp([{ name: OLD, phone: '0851112299' }]);
    ok('...with someone else now named the old name, her phone still finds her', twin.body.matched === 1 && twin.body.added === 0
       && !(twin.body.skipped || []).length, JSON.stringify(twin.body));
    await pool.query(`DELETE FROM bkk_members WHERE code='BTESTTWIN001'`);
    const tch = await post('/api/bkk/admin/teachers', { name: 'Rename Tagger' }, ADMIN);
    const tagged = (await J('/api/bkk/teacher/members?q=' + encodeURIComponent('ชื่อเก่า'), { headers: { 'x-teacher-key': tch.body.passcode } })).body.members || [];
    ok('...and the photo tagging search (teachers) finds her by the old name too', tagged.some(m => m.name === NEW), JSON.stringify(tagged));
    const back = await rn(who.code, OLD);
    const row2 = await one(`SELECT name, former_names FROM bkk_members WHERE code=$1`, [who.code]);
    ok('changing it back keeps each old name once, never the name in use', back.status === 200 && row2.name === OLD
       && JSON.stringify(row2.former_names) === JSON.stringify([NEW]), JSON.stringify(row2));
    const bad = await Promise.all(['', '   ', 'x'.repeat(81), 'Evil <b>', 'bell\u0007name'].map(n => rn(who.code, n)));
    ok('a name that is empty, over 80 characters, or has < > or control characters is refused', bad.every(r => r.status === 400)
       && (await one(`SELECT name FROM bkk_members WHERE code=$1`, [who.code])).name === OLD, JSON.stringify(bad.map(r => r.status)));
    const tab = await rn(who.code, 'Tab\tName\n');
    ok('...a tab or line break pasted in becomes one space', tab.status === 200 && tab.body.member.name === 'Tab Name', JSON.stringify(tab.body));
    await rn(who.code, OLD);
    ok('...without it: 401, and nothing changes', (await rn(who.code, 'Sneaky', {})).status === 401
       && (await one(`SELECT name FROM bkk_members WHERE code=$1`, [who.code])).name === OLD);
    ok('an unknown code is 404', (await rn('NOSUCHCODE1', 'Anyone')).status === 404);
    // A folded (merged) code changes the profile it was folded into.
    const fold = await one(`SELECT code FROM bkk_members WHERE email='fold.renamo@example.com'`);
    await pool.query(`UPDATE bkk_members SET merged_into=(SELECT id FROM bkk_members WHERE code=$1) WHERE code=$2`, [who.code, fold.code]);
    const viaFold = await rn(fold.code, NEW);
    ok('a folded code changes the kept profile, not the folded one', viaFold.status === 200 && viaFold.body.member.code === who.code
       && (await one(`SELECT name FROM bkk_members WHERE code=$1`, [who.code])).name === NEW
       && (await one(`SELECT name FROM bkk_members WHERE code=$1`, [fold.code])).name === 'Fold Renamo', JSON.stringify(viaFold.body));
    for (const c of [fold.code, who.code]) {
      await pool.query(`DELETE FROM bkk_passes WHERE member_id=(SELECT id FROM bkk_members WHERE code=$1)`, [c]);
      await pool.query(`UPDATE bkk_members SET merged_into=NULL WHERE code=$1`, [c]);
    }

    // Capitals or spaces only: the name is tidied, no "old name" is made.
    let seq = 0;
    const mk = async (name, email) => (await pool.query(`INSERT INTO bkk_members (code,name,email) VALUES ($1,$2,$3) RETURNING code`,
      ['BTRENAME' + String(++seq).padStart(5, '0'), name, email])).rows[0].code;
    const hits = async (term, code) => ((await J('/api/bkk/admin/members?q=' + encodeURIComponent(term), { headers: ADMIN })).body.members || [])
      .some(m => m.code === code);
    const cs = await mk('beta  lower', 'beta.lower@example.com');
    await rn(cs, 'Beta Lower');
    const csRow = await one(`SELECT name, former_names FROM bkk_members WHERE code=$1`, [cs]);
    ok('a fix of capitals or double spaces only keeps no old name', csRow.name === 'Beta Lower' && csRow.former_names === null, JSON.stringify(csRow));

    // A wrong rename can be taken back off: forget drops that old name only.
    await rn(cs, 'Wrong Pick');
    await rn(cs, 'Beta Lower');
    const before = await hits('wrong pick', cs);
    const fg = await post(`/api/bkk/admin/members/${cs}/name`, { forget: '  wrong   PICK ' }, ADMIN);
    const fgRow = await one(`SELECT name, former_names FROM bkk_members WHERE code=$1`, [cs]);
    ok('...and a wrong old name is removed (any capitals or spaces), the name kept', fg.status === 200 && fgRow.name === 'Beta Lower'
       && fgRow.former_names === null && before && !(await hits('wrong pick', cs)), JSON.stringify([fg.body, fgRow, before]));

    // A renamed profile folded into another by the real merge: both searches still find the kept one by the old name.
    const A = await mk('Merge Oldname', 'merge.a@example.com');
    await rn(A, 'Merge Newname');
    const K = await mk('Merge Newname', 'merge.k@example.com');
    const mg = await post(`/api/bkk/admin/members/${K}/merge`, { from: A, sure: true }, ADMIN);
    const adm = ((await J('/api/bkk/admin/members?q=' + encodeURIComponent('merge oldname'), { headers: ADMIN })).body.members || []).map(m => m.code);
    const tch2 = (await J('/api/bkk/teacher/members?q=' + encodeURIComponent('merge oldname'), { headers: { 'x-teacher-key': tch.body.passcode } })).body.members || [];
    ok('a renamed profile merged into another: Admin and teacher search still find the kept one by the old name', mg.status === 200
       && adm.join() === K && tch2.length === 1 && tch2[0].name === 'Merge Newname', JSON.stringify([mg.status, mg.body.error, adm, tch2]));

    // The old CSV import never guesses: a name someone has now goes to them; one two students had before is skipped.
    const X = 'Csv Shared';
    const p1 = await mk(X, 'csv.p1@example.com'); await rn(p1, 'Csv Moved One');
    const p2 = await mk(X, 'csv.p2@example.com'); await rn(p2, 'Csv Moved Two');
    const twoWas = await post('/api/bkk/admin/import', { rows: [{ name: X, plan: '1 month', until: '2027-01-31' }] }, ADMIN);
    const passesOf = async c => (await one(`SELECT count(*)::int AS n FROM bkk_passes p JOIN bkk_members m ON m.id=p.member_id WHERE m.code=$1`, [c])).n;
    ok('the old CSV import skips a name two students had before, and gives no pass', twoWas.status === 200
       && (twoWas.body.skipped || []).some(x => /2 students had this name before/.test(x)) && await passesOf(p1) === 0 && await passesOf(p2) === 0,
       JSON.stringify(twoWas.body));
    const nowX = await mk(X, 'csv.now@example.com');
    const cur = await post('/api/bkk/admin/import', { rows: [{ name: X, plan: '1 month', until: '2027-01-31' }] }, ADMIN);
    ok('...and a name one student has now goes to that student, not to one who had it before', cur.status === 200
       && await passesOf(nowX) === 1 && await passesOf(p1) === 0 && await passesOf(p2) === 0, JSON.stringify(cur.body));

    // A merge landing while the rename waits for its lock: the rename follows it to the kept profile.
    const F2 = await mk('Race Folded', 'race.f@example.com'), K2 = await mk('Race Kept', 'race.k@example.com');
    const hold = await pool.connect();
    await hold.query('BEGIN');
    await hold.query(`UPDATE bkk_members SET merged_into=(SELECT id FROM bkk_members WHERE code=$1) WHERE code=$2`, [K2, F2]);
    const racing = rn(F2, 'Race Winner');
    await new Promise(r => setTimeout(r, 400));
    await hold.query('COMMIT'); hold.release();
    const raced = await racing;
    const kRow = await one(`SELECT name FROM bkk_members WHERE code=$1`, [K2]), fRow = await one(`SELECT name FROM bkk_members WHERE code=$1`, [F2]);
    ok('a merge that lands while a rename waits: the kept profile gets the name, the folded one keeps its own', raced.status === 200
       && raced.body.member.code === K2 && kRow.name === 'Race Winner' && fRow.name === 'Race Folded', JSON.stringify([raced.body, kRow, fRow]));

    // The Admin page's own code: Change name and the × on an old name.
    const vm = require('vm');
    const page = require('fs').readFileSync(require('path').join(__dirname, '../public/bkk-admin.html'), 'utf8');
    const seg = page.slice(page.indexOf('  let FOUND = {};'), page.indexOf('  // Fix a wrong email.'));
    const run = (answer, member, okConfirm = true) => {
      const seen = { posts: [], alerts: [], found: 0 };
      const ctx = { ask: () => answer, alert: m => seen.alerts.push(m), confirm: () => okConfirm, T: (k, ...a) => `${k}(${a.join(',')})`,
        api: async (url, o) => { seen.posts.push([url, JSON.parse(o.body)]); return { ok: true }; }, shout: async () => ({ success: true }),
        findStudents: () => { seen.found++; }, encodeURIComponent };
      vm.createContext(ctx);
      vm.runInContext(seg + '\n;FOUND.B1 = ' + JSON.stringify(member) + ';this.pg = { changeName: window.changeName, forgetName: window.forgetName };',
        Object.assign(ctx, { window: ctx }));
      return { seen, pg: ctx.pg };
    };
    const tries = [[null], ['Same  Name'], [''], ['a<b'], ['  New   Name ']];
    const outs = [];
    // Stored with a double space (checkout only trims): OK on the untouched prompt is no change.
    for (const [ans] of tries) { const r = run(ans, { code: 'B1', name: 'Same  Name' }); await r.pg.changeName('B1'); outs.push(r.seen); }
    ok('Admin page: Cancel, an unchanged name (spaces aside), an empty name or one with < > send nothing; a good one is sent tidied, then the list refreshes',
       outs[0].posts.length === 0 && outs[1].posts.length === 0 && outs[2].posts.length === 0 && outs[2].alerts[0] === 'nameBad()'
         && outs[3].posts.length === 0 && outs[4].posts.length === 1 && outs[4].posts[0][0] === '/api/bkk/admin/members/B1/name'
         && outs[4].posts[0][1].name === 'New Name' && outs[4].found === 1, JSON.stringify(outs));
    const fz = run(null, { code: 'B1', name: 'Now', former_names: ['Then'] });
    await fz.pg.forgetName('B1', 0);
    const fzNo = run(null, { code: 'B1', name: 'Now', former_names: ['Then'] }, false);
    await fzNo.pg.forgetName('B1', 0);
    ok('...the × on an old name asks first, then sends forget for that name only', fz.seen.posts.length === 1
       && fz.seen.posts[0][1].forget === 'Then' && fzNo.seen.posts.length === 0, JSON.stringify([fz.seen, fzNo.seen]));
    ok('...each old name is shown escaped, with its × found by position (never the name inside the onclick)',
       /m\.former_names\.map\(\(n, i\) => `\$\{esc\(n\)\} <button/.test(page) && /onclick="forgetName\('\$\{esc\(m\.code\)\}',\$\{i\}\)"/.test(page)
       && page.includes(`onclick="changeName('\${esc(m.code)}')"`) && /nameBtn: 'Change name'/.test(page) && /nameBtn: 'เปลี่ยนชื่อ'/.test(page));
  }

  console.log('\n— 8 classes / 1 month replaced the 10-class pack (6 Nov 2026) —');
  {
    const marker = async () => (await pool.query(`SELECT count(*)::int AS n FROM bkk_settings WHERE key='pack8_replaces_pack10'`)).rows[0].n;
    const prod = async code => (await pool.query('SELECT * FROM bkk_products WHERE code=$1', [code])).rows[0];
    const passOf = async code => (await pool.query(`SELECT p.credits_total, p.credits_used, p.valid_days, p.status, pr.code,
        to_char(p.valid_from,'YYYY-MM-DD') AS f, p.valid_until - p.valid_from AS span
      FROM bkk_passes p JOIN bkk_products pr ON pr.id=p.product_id JOIN bkk_members m ON m.id=p.member_id WHERE m.code=$1`, [code])).rows[0];
    // A boot only: the schema step runs when the API is mounted.
    const boot = (db = pool) => mountBkk(express(), { pgPool: db, now });

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
    const boot = (db = pool) => mountBkk(express(), { pgPool: db, now });
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
  const slot = sch.body.classes.find(c => !c.started);
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
  const fresh = (await J('/api/bkk/schedule?days=28')).body.classes.filter(c => c.seatsLeft > 0 && !c.started);
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
  const openCls = (await J('/api/bkk/schedule?days=14')).body.classes.filter(c => c.seatsLeft > 0 && !c.started)[0];
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
  const annAdd = await post('/api/bkk/teacher/members', { name: 'Ann Photo', email: 'ann.photo@example.com' }, PKEY);
  const ann = await quickAdd({ name: 'Ann Photo', email: 'ann.photo@example.com' }, PKEY);
  const bob = await quickAdd({ name: 'Bob Photo', email: 'bob.photo@example.com' }, PKEY);
  const cat = await quickAdd({ name: 'Cat Photo', email: 'cat.photo@example.com' }, PKEY);
  ok('a teacher can add a student for tagging: a ref and the name, never the member code (their sign-in)', ann && ann.code && bob && cat
     && annAdd.body.member.ref === ann.ref && Object.keys(annAdd.body.member).sort().join() === 'name,ref'
     && !JSON.stringify(annAdd.body).includes(ann.code), JSON.stringify(annAdd.body));
  ok('adding a student needs an email (they sign in with it)',
     (await post('/api/bkk/teacher/members', { name: 'No Mail' }, PKEY)).status === 400);
  ok('tagging needs a teacher passcode',
     (await post('/api/bkk/teacher/photos', { date: '2026-10-03', image: IMG, memberCodes: [ann.code] }, ADMIN)).status === 401);
  const up = await post('/api/bkk/teacher/photos', { date: '2026-10-03', image: IMG, memberCodes: [ann.code, bob.code] }, PKEY);
  ok('photo uploaded with two students', up.status === 200 && up.body.photo.members.length === 2, JSON.stringify(up.body).slice(0, 160));
  ok('...the people on it come back by ref and name, with no member code',
     up.body.photo.members.every(m => Object.keys(m).sort().join() === 'name,ref,role') && !JSON.stringify(up.body).includes(ann.code)
       && !JSON.stringify(up.body).includes(bob.code), JSON.stringify(up.body.photo.members));
  ok('stored as a private (authenticated) asset', global.__uploads[0] && global.__uploads[0].type === 'authenticated');
  ok('a non-image is refused',
     (await post('/api/bkk/teacher/photos', { date: '2026-10-03', image: 'data:text/html;base64,PGgxPg==', memberCodes: [] }, PKEY)).status === 400);
  const annPics = (await J(`/api/bkk/me/${ann.code}/photos`)).body.days || [];
  const catPics = (await J(`/api/bkk/me/${cat.code}/photos`)).body.days || [];
  ok('a tagged student sees the photo, on its class date', annPics.length === 1 && annPics[0].date === '2026-10-03' && annPics[0].items.length === 1,
     JSON.stringify(annPics));
  ok('the photo link is a signed private one', /^signed:\/\/authenticated\//.test(annPics[0].items[0].thumb));
  ok('each photo also has a full-size save link', /^signed:\/\/authenticated\/.+\/2048$/.test(annPics[0].items[0].save || ''), annPics[0].items[0].save);
  ok('the photo a student taps open is the stored JPEG itself, with no resized copy made',
     /^signed:\/\/authenticated\/.+\/original\.jpg$/.test(annPics[0].items[0].full || '')
       && urlCalls.some(c => !c.o.transformation && c.o.format === 'jpg' && c.o.type === 'authenticated' && c.o.sign_url === true),
     annPics[0].items[0].full);
  ok('the tile is one fixed WebP, not one copy per browser', urlCalls.some(c => c.o.transformation
       && c.o.transformation[0].width === 600 && c.o.transformation[0].fetch_format === 'webp')
       && !urlCalls.some(c => c.o.transformation && c.o.transformation[0].fetch_format === 'auto' && c.o.transformation[0].width === 600));
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
  const namesOn = ph => ph.members.map(m => m.ref).sort().join();
  ok('adding a name to picked photos keeps everyone already on them',
     addCat.status === 200 && namesOn(addCat.body.photos[0]) === [ann.ref, bob.ref, cat.ref].sort().join(), JSON.stringify(addCat.body).slice(0, 200));
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

  console.log('\n-- main student and others in the frame --');
  {
    const tp = (path, body) => post(path, body, PKEY);
    const tg = (path) => J(path, { headers: PKEY });
    const mem = async name => quickAdd({ name, email: name.toLowerCase().replace(/\W+/g, '.') + '@example.com' }, PKEY);
    const mia = await mem('Mia Maintag'), oto = await mem('Oto Frametag'), pip = await mem('Pip Thirdtag'), nia = await mem('Nia Nophoto');
    const roles = ph => ph.members.map(m => `${m.name.split(' ')[0]}:${m.role}`).join();
    const inDb = async id => (await pool.query(`SELECT m.name, pm.role FROM bkk_photo_members pm JOIN bkk_members m ON m.id=pm.member_id
      WHERE pm.photo_id=$1 ORDER BY (pm.role <> 'main'), m.name`, [id])).rows.map(r => `${r.name.split(' ')[0]}:${r.role}`).join();
    const mine = async code => ((await J(`/api/bkk/me/${code}/photos`)).body.days || []).flatMap(d => d.items.map(i => i.id));
    const shot = async (date, tags) => (await tp('/api/bkk/teacher/photos', { date, image: IMG, tags })).body.photo;
    const boot = async () => {
      const errs = [], logErr = console.error;
      console.error = (...a) => errs.push(a.join(' '));
      await mountBkk(express(), { pgPool: pool, now });
      console.error = logErr;
      return errs.filter(e => /schema init failed/.test(e));
    };
    const driveId = manyId;            // the Drive photo from above: Ann, Bob and Cat, tagged before roles existed

    // A database from before roles: the column is not there yet.
    await pool.query('ALTER TABLE bkk_photo_members DROP COLUMN role');
    const oldRows = (await pool.query('SELECT count(*)::int AS n FROM bkk_photo_members')).rows[0].n;
    const boot1 = await boot();
    const afterBoot = (await pool.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE role = 'main')::int AS main FROM bkk_photo_members`)).rows[0];
    ok('the boot adds the role column, and every tag from before reads as main',
       boot1.length === 0 && oldRows === 3 && afterBoot.n === 3 && afterBoot.main === 3
         && roles((await tg('/api/bkk/teacher/photos?date=2026-10-05')).body.photos[0]) === 'Ann:main,Bob:main,Cat:main', JSON.stringify([boot1, oldRows, afterBoot]));
    ok('...so each of those students still sees the photo',
       (await mine(ann.code)).includes(driveId) && (await mine(bob.code)).includes(driveId) && (await mine(cat.code)).includes(driveId));
    const setCat = await tp(`/api/bkk/teacher/photos/${driveId}/tags`,
      { tags: [{ code: ann.code, role: 'main' }, { code: bob.code, role: 'main' }, { code: cat.code, role: 'other' }] });
    const boot2 = await boot();
    ok('a second boot changes nothing: a role set meanwhile stays', boot2.length === 0 && setCat.status === 200
       && (await inDb(driveId)) === 'Ann:main,Bob:main,Cat:other', JSON.stringify([boot2, await inDb(driveId)]));
    ok('the database refuses any role but main or other',
       await pool.query(`UPDATE bkk_photo_members SET role='star' WHERE photo_id=$1`, [driveId]).then(() => false, () => true));

    const p1 = await shot('2026-10-03', [{ code: oto.code, role: 'other' }, { code: mia.code, role: 'main' }, { code: pip.code }]);
    ok('a role is saved and returned with each name, main names first; no role given means main',
       roles(p1) === 'Mia:main,Pip:main,Oto:other' && (await inDb(p1.id)) === 'Mia:main,Pip:main,Oto:other', JSON.stringify(p1.members));
    const oldUp = await tp('/api/bkk/teacher/photos', { date: '2026-10-03', image: IMG, memberCodes: [mia.code, oto.code] });
    ok('the old memberCodes upload still works, everyone main', oldUp.status === 200 && roles(oldUp.body.photo) === 'Mia:main,Oto:main', JSON.stringify(oldUp.body));
    const p2 = oldUp.body.photo;

    const keep = await tp(`/api/bkk/teacher/photos/${p1.id}/tags`, { memberCodes: [oto.code, mia.code, nia.code] });
    ok('the old memberCodes body on a photo keeps the roles there, a new name is main, a missing name leaves',
       keep.status === 200 && roles(keep.body.photo) === 'Mia:main,Nia:main,Oto:other', JSON.stringify(keep.body));
    const swap = await tp(`/api/bkk/teacher/photos/${p1.id}/tags`, { tags: [{ code: mia.code, role: 'other' }, { code: pip.code, role: 'main' }] });
    ok('tags [{ code, role }] replaces who is on the photo and sets each role',
       swap.status === 200 && roles(swap.body.photo) === 'Pip:main,Mia:other' && (await inDb(p1.id)) === 'Pip:main,Mia:other', JSON.stringify(swap.body));
    const bad = await tp(`/api/bkk/teacher/photos/${p1.id}/tags`, { tags: [{ code: mia.code, role: 'star' }, { code: oto.code, role: 'main' }] });
    const gone = await tp(`/api/bkk/teacher/photos/${p1.id}/tags`, { tags: [{ code: 'BGONE0000000', role: 'main' }] });
    ok('a role that is not main or other is refused (400), a code that changed too (409), and nothing is saved',
       bad.status === 400 && /main or other/.test(bad.body.error) && gone.status === 409 && (await inDb(p1.id)) === 'Pip:main,Mia:other',
       JSON.stringify([bad.status, bad.body, gone.status]));
    ok('the same name twice on one photo is one tag, main if either says so',
       roles((await tp(`/api/bkk/teacher/photos/${p2.id}/tags`, { tags: [{ code: oto.code, role: 'other' }, { code: oto.code, role: 'main' }, { code: mia.code, role: 'main' }] })).body.photo) === 'Mia:main,Oto:main');

    // Many photos, one name: now with Main or In the frame. p1 is Pip main + Mia other, p2 is Mia main + Oto main.
    const frame = await tp('/api/bkk/teacher/photos/tags/add', { photoIds: [p1.id, p2.id], memberCodes: [nia.code], role: 'other' });
    ok('a name added to many photos as "in the frame" is other on each',
       frame.status === 200 && frame.body.photos.map(roles).join(' | ') === 'Pip:main,Mia:other,Nia:other | Mia:main,Oto:main,Nia:other', JSON.stringify(frame.body.photos.map(roles)));
    const up2 = await tp('/api/bkk/teacher/photos/tags/add', { photoIds: [p1.id, p2.id], memberCodes: [mia.code], role: 'main' });
    ok('added as main, someone who was in the frame becomes main',
       up2.body.photos.map(roles).join(' | ') === 'Mia:main,Pip:main,Nia:other | Mia:main,Oto:main,Nia:other', JSON.stringify(up2.body.photos.map(roles)));
    const down = await tp('/api/bkk/teacher/photos/tags/add', { photoIds: [p1.id, p2.id], memberCodes: [mia.code, pip.code], role: 'other' });
    ok('added as "in the frame", a main stays main and only the new name is other',
       down.body.photos.map(roles).join(' | ') === 'Mia:main,Pip:main,Nia:other | Mia:main,Oto:main,Nia:other,Pip:other', JSON.stringify(down.body.photos.map(roles)));
    const plain = await tp('/api/bkk/teacher/photos/tags/add', { photoIds: [p2.id], memberCodes: [nia.code] });
    ok('with no role a bulk add is main, as before', roles(plain.body.photos[0]) === 'Mia:main,Nia:main,Oto:main,Pip:other', roles(plain.body.photos[0]));
    const badAdd = await tp('/api/bkk/teacher/photos/tags/add', { photoIds: [p1.id], memberCodes: [oto.code], role: 'boss' });
    ok('a bad role on a bulk add is refused and adds nobody', badAdd.status === 400 && (await inDb(p1.id)) === 'Mia:main,Pip:main,Nia:other', JSON.stringify(badAdd.body));

    // Drive photos take the same shapes. The saved one is Ann main, Bob main, Cat other.
    const DRV = { date: '2026-10-05', folder: 'DAY5aaaaaaaaaaaaaaaaaaaaa' };
    const ups = uploads.length;
    const dAdd = await tp('/api/bkk/teacher/photos/from-drive', { ...DRV, driveId: 'IMG2aaaaaaaaaaaaaaaaaaaaa', memberCodes: [mia.code], role: 'other', add: true });
    const dUp = await tp('/api/bkk/teacher/photos/from-drive', { ...DRV, driveId: 'IMG2aaaaaaaaaaaaaaaaaaaaa', memberCodes: [cat.code, ann.code], role: 'main', add: true });
    const dKeep = await tp('/api/bkk/teacher/photos/from-drive', { ...DRV, driveId: 'IMG2aaaaaaaaaaaaaaaaaaaaa', memberCodes: [ann.code, mia.code, oto.code] });
    const dSet = await tp('/api/bkk/teacher/photos/from-drive', { ...DRV, driveId: 'IMG2aaaaaaaaaaaaaaaaaaaaa', tags: [{ code: ann.code, role: 'other' }, { code: bob.code, role: 'main' }] });
    ok('a saved Drive photo: adding keeps everyone (in the frame, or up to main), the old body keeps roles, tags set them',
       roles(dAdd.body.photo) === 'Ann:main,Bob:main,Cat:other,Mia:other' && roles(dUp.body.photo) === 'Ann:main,Bob:main,Cat:main,Mia:other'
         && roles(dKeep.body.photo) === 'Ann:main,Oto:main,Mia:other' && roles(dSet.body.photo) === 'Bob:main,Ann:other' && uploads.length === ups,
       JSON.stringify([dAdd.body, dUp.body, dKeep.body, dSet.body].map(b => b.photo && roles(b.photo))));
    const dNew = await tp('/api/bkk/teacher/photos/from-drive', { ...DRV, driveId: 'IMG3aaaaaaaaaaaaaaaaaaaaa', tags: [{ code: bob.code, role: 'main' }, { code: ann.code, role: 'other' }] });
    const dBad = await tp('/api/bkk/teacher/photos/from-drive', { ...DRV, driveId: 'IMG1aaaaaaaaaaaaaaaaaaaaa', memberCodes: [ann.code], role: 'boss', add: true });
    ok('a new Drive photo is saved with its roles; a bad role stops it before anything is stored',
       dNew.status === 200 && roles(dNew.body.photo) === 'Bob:main,Ann:other' && dBad.status === 400 && uploads.length === ups + 1, JSON.stringify([dNew.body, dBad.body]));
    ok('the Drive list still counts everyone on a photo, main or not',
       (await tg('/api/bkk/teacher/drive?folder=DAY5aaaaaaaaaaaaaaaaaaaaa')).body.files.find(f => f.id === 'IMG3aaaaaaaaaaaaaaaaaaaaa').tagged === 2);

    // What a student sees. Ann is main in nothing now: in the frame of both Drive photos.
    const dayView = () => tg('/api/bkk/teacher/photos?date=2026-10-05');
    ok('a student in the frame does not see the photo; the main student does',
       (await mine(ann.code)).length === 0 && (await mine(bob.code)).join() === [dNew.body.photo.id, driveId].join()
         && (await dayView()).body.othersVisible === false, JSON.stringify([await mine(ann.code), await mine(bob.code)]));
    // Pip, one morning: in the frame (first), main, in the frame (last).
    const d1 = await shot('2026-10-07', [{ code: pip.code, role: 'other' }, { code: mia.code, role: 'main' }]);
    const d2 = await shot('2026-10-07', [{ code: pip.code, role: 'main' }]);
    const d3 = await shot('2026-10-07', [{ code: pip.code, role: 'other' }]);
    const pipDay = async () => ((await J(`/api/bkk/me/${pip.code}/photos`)).body.days || []).find(d => d.date === '2026-10-07');
    const hidden = await pipDay();
    ok('...and a day shows only the photos the student is main in', hidden && hidden.items.map(i => i.id).join() === String(d2.id), JSON.stringify(hidden));
    await pool.query(`INSERT INTO bkk_settings (key,value) VALUES ('photos_others_visible','true')`);
    const shown = await pipDay();
    ok('with photos_others_visible on, the in-the-frame photos follow the main ones of that day',
       shown.items.map(i => i.id).join() === [d2.id, d3.id, d1.id].join() && (await mine(ann.code)).join() === [dNew.body.photo.id, driveId].join()
         && (await dayView()).body.othersVisible === true
         && Object.keys(shown.items[0]).sort().join() === 'full,id,save,thumb', JSON.stringify(shown));
    await pool.query(`UPDATE bkk_settings SET value='false' WHERE key='photos_others_visible'`);
    const off = (await mine(ann.code)).length;
    await pool.query(`UPDATE bkk_settings SET value='"true"' WHERE key='photos_others_visible'`);
    const word = (await mine(ann.code)).length;
    await pool.query(`DELETE FROM bkk_settings WHERE key='photos_others_visible'`);
    ok('the setting set to false, to anything but true, or removed hides them again',
       off === 0 && word === 0 && (await mine(ann.code)).length === 0 && (await pipDay()).items.length === 1);

    // Pip's photo profile. 3 Oct: main (p1), in the frame (p2). 7 Oct: main (d2), in the frame (d1, d3). Then one in September.
    const sep = await shot('2026-09-28', [{ code: pip.code, role: 'other' }, { code: oto.code, role: 'main' }]);
    await pool.query(`UPDATE bkk_members SET phone='080-000-4321' WHERE code=$1`, [pip.code]);
    const daysSince = async d => (await pool.query(`SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date - $1::date AS n`, [d])).rows[0].n;
    const prof = async (code, qs = '') => tg(`/api/bkk/teacher/members/${code}/photos${qs}`);
    const pf = await prof(pip.code);
    const t = pf.body.totals || {};
    ok('the photo profile counts photos, main, in the frame and mornings',
       pf.status === 200 && t.photos === 6 && t.main === 2 && t.other === 4 && t.mornings === 3, JSON.stringify(t));
    ok('...with the first and last photo, and the last main one with how many days ago',
       t.first === '2026-09-28' && t.last === '2026-10-07' && t.lastMain === '2026-10-07' && t.lastMainDays === await daysSince('2026-10-07'), JSON.stringify(t));
    ok('...by month, newest first',
       JSON.stringify(pf.body.months) === JSON.stringify([{ month: '2026-10', main: 2, other: 3 }, { month: '2026-09', main: 0, other: 1 }]), JSON.stringify(pf.body.months));
    ok('...then the photos: newest day first, main first in a day, each with its role',
       pf.body.photos.map(p => `${p.id}:${p.date.slice(5)}:${p.role}`).join()
         === [[d2.id, '10-07', 'main'], [d3.id, '10-07', 'other'], [d1.id, '10-07', 'other'], [p1.id, '10-03', 'main'], [p2.id, '10-03', 'other'], [sep.id, '09-28', 'other']]
           .map(x => x.join(':')).join() && pf.body.photos.every(p => /^signed:\/\/authenticated\/.+\/600$/.test(p.thumb))
         && pf.body.limit === 60 && pf.body.offset === 0, JSON.stringify(pf.body.photos));
    const pg1 = await prof(pip.code, '?limit=4'), pg2 = await prof(pip.code, '?limit=4&offset=4'), pg3 = await prof(pip.code, '?limit=4&offset=8');
    ok('...in pages: limit and offset, the totals the same on each page',
       pg1.body.photos.length === 4 && pg2.body.photos.map(p => p.id).join() === [p2.id, sep.id].join() && pg3.body.photos.length === 0
         && pg2.body.totals.photos === 6 && pg2.body.offset === 4 && pg2.body.limit === 4
         && (await prof(pip.code, '?limit=9999&offset=-3')).body.limit === 200, JSON.stringify([pg1.body.photos.length, pg2.body, pg3.body.photos]));
    ok('the photo profile needs the teacher passcode (401), and an unknown code is 404',
       (await J(`/api/bkk/teacher/members/${pip.code}/photos`)).status === 401
         && (await J(`/api/bkk/teacher/members/${pip.code}/photos`, { headers: ADMIN })).status === 401
         && (await prof('BNOSUCHCODE00')).status === 404);
    const raw = JSON.stringify(pf.body);
    ok('it carries photo data only: no email past the masked hint, no phone, pass, payment or visit',
       Object.keys(pf.body).sort().join() === 'limit,member,months,offset,photos,totals'
         && Object.keys(pf.body.member).sort().join() === 'code,hint,name' && pf.body.member.hint === 'pi…@example.com'
         && Object.keys(t).sort().join() === 'first,last,lastMain,lastMainDays,main,mornings,other,photos'
         && pf.body.photos.every(p => Object.keys(p).sort().join() === 'date,id,role,thumb')
         && !raw.includes('pip.thirdtag') && !raw.includes('080-000') && !/phone|email|pass|order|paid|amount|visit|booking/i.test(raw), raw.slice(0, 300));
    const none = (await prof(nia.code)).body;
    await tp(`/api/bkk/teacher/photos/${p2.id}/tags`, { tags: [] });
    const empty = (await prof(nia.code)).body;
    ok('a student with no photos, or only in the frame so far, has no last main photo',
       none.totals.photos === 2 && none.totals.main === 1 && empty.totals.photos === 1 && empty.totals.main === 0 && empty.totals.lastMain === null
         && empty.totals.lastMainDays === null && empty.totals.last === '2026-10-03' && (await prof(cat.code)).body.totals.photos === 0
         && (await prof(cat.code)).body.photos.length === 0 && (await prof(cat.code)).body.months.length === 0, JSON.stringify([none.totals, empty.totals]));
    ok('staff counts still count every tag, main or not',
       (await J(`/api/bkk/admin/members/${pip.code}/history`, { headers: ADMIN })).body.photos === 5);

    await tp(`/api/bkk/teacher/photos/${d2.id}/delete`, {});
    const cut = (await prof(pip.code)).body;
    ok('deleting a photo changes the counts and the last main photo',
       cut.totals.photos === 4 && cut.totals.main === 1 && cut.totals.other === 3 && cut.totals.mornings === 3 && cut.totals.lastMain === '2026-10-03'
         && cut.totals.lastMainDays === await daysSince('2026-10-03') && cut.photos.length === 4 && !cut.photos.some(p => p.id === d2.id)
         && JSON.stringify(cut.months[0]) === JSON.stringify({ month: '2026-10', main: 1, other: 2 }), JSON.stringify([cut.totals, cut.months]));

    // Today's list, the shot list: when each booked student was last the main one.
    const slot = (await pool.query('SELECT id FROM bkk_class_slots ORDER BY id LIMIT 1')).rows[0].id;
    const booked = (await pool.query(`INSERT INTO bkk_bookings (slot_id, class_date, start_at, member_id)
      SELECT $1, (now() AT TIME ZONE 'Asia/Bangkok')::date, now(), id FROM bkk_members WHERE code = ANY($2::text[]) RETURNING id`,
      [slot, [pip.code, ann.code, cat.code]])).rows.map(r => r.id);
    const list = (await tg('/api/bkk/teacher/today')).body.students || [];
    const row = m => list.find(s => s.ref === m.ref) || {};
    ok("today's list carries each student's last main photo: the date and how many days ago",
       row(pip).last_main === '2026-10-03' && row(pip).last_main_days === await daysSince('2026-10-03')
         && row(pip).name === 'Pip Thirdtag' && 'notes' in row(pip), JSON.stringify(row(pip)));
    ok('...and null for a student only in the frame so far, or with no photo',
       row(ann).ref === ann.ref && row(ann).last_main === null && row(ann).last_main_days === null
         && row(cat).ref === cat.ref && row(cat).last_main === null && list.every(s => !('code' in s)), JSON.stringify([row(ann), row(cat)]));
    await pool.query('DELETE FROM bkk_bookings WHERE id = ANY($1::int[])', [booked]);

    // The hint never shows a whole email, however short the name part is.
    const short = async (name, email) => quickAdd({ name, email }, PKEY);
    const h1 = await short('Uno Hintone', 'q@hint.example.com'), h2 = await short('Duo Hinttwo', 'qz@hint.example.com');
    const h3 = await short('Tri Hintthree', 'qzx@hint.example.com'), h0 = await short('Nul Hintnone', 'nul.hintnone@hint.example.com');
    await pool.query(`UPDATE bkk_members SET email='no-at-sign' WHERE code=$1`, [h0.code]);
    const hintOf = async m => (await prof(m.code)).body.member.hint;
    const found = (await tg('/api/bkk/teacher/members?q=hint')).body.members;
    ok('the email hint hides part of every address: one letter, two letters, or no @ at all',
       (await hintOf(h1)) === '…@hint.example.com' && (await hintOf(h2)) === 'q…@hint.example.com'
         && (await hintOf(h3)) === 'qz…@hint.example.com' && (await hintOf(h0)) === '…' && (await hintOf(pip)) === 'pi…@example.com',
       JSON.stringify([await hintOf(h1), await hintOf(h2), await hintOf(h3), await hintOf(h0)]));
    ok('...in the name search too',
       found.length === 4 && found.find(m => m.ref === h1.ref).hint === '…@hint.example.com'
         && found.find(m => m.ref === h2.ref).hint === 'q…@hint.example.com' && found.find(m => m.ref === h0.ref).hint === '…', JSON.stringify(found));
    ok('...and the search answers no member code: a ref, the name, the hint and passToday',
       found.every(m => Object.keys(m).sort().join() === 'hint,name,passToday,ref') && ![h0, h1, h2, h3].some(m => JSON.stringify(found).includes(m.code)),
       JSON.stringify(found[0]));

    // More than 30 names on one photo: refused whole, never cut short (the cut could drop the main student).
    const crowd = [];
    for (let i = 1; i <= 31; i++) crowd.push((await mem(`Crowd Person${i}`)).code);
    const many31 = [...crowd.slice(0, 30).map(code => ({ code, role: 'other' })), { code: crowd[30], role: 'main' }];
    const photosNow = async () => (await pool.query('SELECT count(*)::int AS n FROM bkk_photos')).rows[0].n;
    const [nBefore, upBefore] = [await photosNow(), uploads.length];
    const tooMany = await tp('/api/bkk/teacher/photos', { date: '2026-10-04', image: IMG, tags: many31 });
    ok('31 names on a new photo is refused (400) and nothing is stored',
       tooMany.status === 400 && /30 names/.test(tooMany.body.error) && (await photosNow()) === nBefore && uploads.length === upBefore, JSON.stringify(tooMany.body));
    const full = await tp('/api/bkk/teacher/photos', { date: '2026-10-04', image: IMG, tags: many31.slice(1) });
    ok('30 names is fine, and the main one is among them',
       full.status === 200 && full.body.photo.members.length === 30 && full.body.photo.members[0].role === 'main', JSON.stringify(full.body).slice(0, 200));
    const p1Was = await inDb(p1.id);
    const over = await tp(`/api/bkk/teacher/photos/${full.body.photo.id}/tags`, { tags: many31 });
    const overOld = await tp(`/api/bkk/teacher/photos/${full.body.photo.id}/tags`, { memberCodes: crowd });
    const overAdd = await tp('/api/bkk/teacher/photos/tags/add', { photoIds: [p1.id], memberCodes: crowd });
    ok('31 names on a saved photo, in the old body, or in a bulk add: refused, and who was on the photos stays',
       over.status === 400 && overOld.status === 400 && overAdd.status === 400
         && (await inDb(full.body.photo.id)).split(',').length === 30 && p1Was.length > 0 && (await inDb(p1.id)) === p1Was, JSON.stringify([over.body, overAdd.body, p1Was, await inDb(p1.id)]));
    const twice = await tp(`/api/bkk/teacher/photos/${full.body.photo.id}/tags`,
      { tags: [...many31.slice(1), ...many31.slice(1).map(x => ({ code: x.code, role: 'other' }))] });
    ok('a name sent twice counts once: 30 people named 60 times is still 30', twice.status === 200 && twice.body.photo.members.length === 30
       && twice.body.photo.members[0].role === 'main', JSON.stringify(twice.body).slice(0, 200));
    await tp(`/api/bkk/teacher/photos/${full.body.photo.id}/delete`, {});
  }

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

  console.log('\n— short sign-in links (14 Nov: the long link looked like spam in LINE) —');
  {
    const SHORT = /^https?:\/\/[^/]+\/in\/[23456789abcdefghjkmnpqrstuvwxyz]{10}$/;
    ok('the staff link comes with a short link on the same host, 10 letters with no 0/o/1/l/i',
       SHORT.test(sl.body.short_link || '') && sl.body.short_link.split('/in/')[0] === sl.body.link.split('/api/')[0],
       String(sl.body.short_link));
    ok('...and the long link is still there for anything that reads it', /\/api\/bkk\/login\/[0-9a-f]{64}$/.test(sl.body.link));
    const codeOf = b => b.short_link.split('/in/')[1];
    const stored = (await pool.query('SELECT token, short_code FROM bkk_login_tokens WHERE short_code=$1', [codeOf(sl.body)])).rows;
    ok('the short code is stored on that link', stored.length === 1 && stored[0].token === tok, JSON.stringify(stored));

    let ipN = 0;
    const from = () => ({ 'x-forwarded-for': `10.77.0.${++ipN}` });
    const open = (code, headers = from()) => fetch(`${B}/in/${code}`, { redirect: 'manual', headers });
    const fresh = (await post(`/api/bkk/admin/members/${twoCode}/signin-link`, {}, ADMIN)).body;
    const freshTok = fresh.link.split('/').pop();
    ok('two links get two different short codes', codeOf(fresh) !== codeOf(sl.body));
    const hop = await open(codeOf(fresh));
    ok('/in/<code> sends the browser on to the long link', hop.status === 302 && hop.headers.get('location') === `/api/bkk/login/${freshTok}`,
       `${hop.status} ${hop.headers.get('location')}`);
    ok('...never cached, and with no referrer', /no-store/.test(hop.headers.get('cache-control') || '')
       && hop.headers.get('referrer-policy') === 'no-referrer', `${hop.headers.get('cache-control')} ${hop.headers.get('referrer-policy')}`);
    const page = await fetch(B + hop.headers.get('location'));
    const pageHtml = await page.text();
    ok('the long link it lands on still opens the page', page.status === 200 && pageHtml.includes('Open my profile'));
    ok("...whose form posts to the long link, so a proxy that follows the redirect itself can't break it",
       pageHtml.includes(`action="/api/bkk/login/${freshTok}"`));
    const followed = await fetch(`${B}/in/${codeOf(fresh)}`, { headers: from() });
    ok('a chat preview following the short link only sees the page', followed.status === 200
       && (await pool.query('SELECT used_at FROM bkk_login_tokens WHERE token=$1', [freshTok])).rows[0].used_at === null);
    const inLand = await fetch(`${B}/api/bkk/login/${freshTok}`, { method: 'POST' }).then(r => r.text());
    ok('tapping through signs the student in', inLand.includes(twoCode) && inLand.includes('/book?me=1'));
    ok('a used staff short link still opens, like the long one (re-open, second phone)', (await open(codeOf(fresh))).status === 302);

    const dead = async (code, status) => { const r = await open(code); const t = await r.text();
      return r.status === status && t.includes('already been used, or it has expired') ? true : `${r.status}`; };
    const used = (await post(`/api/bkk/admin/members/${twoCode}/signin-link`, {}, ADMIN)).body;
    await pool.query(`UPDATE bkk_login_tokens SET used_at=now(), ip='receipt' WHERE short_code=$1`, [codeOf(used)]);
    ok('a short code follows the long link\'s rule: a used one-time link is dead', await dead(codeOf(used), 400) === true);
    const old = (await post(`/api/bkk/admin/members/${twoCode}/signin-link`, {}, ADMIN)).body;
    await pool.query(`UPDATE bkk_login_tokens SET expires_at=now() - interval '1 minute' WHERE short_code=$1`, [codeOf(old)]);
    ok('an expired short link shows the dead-link page', await dead(codeOf(old), 400) === true);
    ok('...and so does a code nobody was given', await dead('23456789ab', 400) === true);
    for (const bad of ['abc', 'ABCDEFGHJK', '0000000000', 'lllllllll1', 'abcdefghjkm', 'abcdefghi%2F', '%27%3B--abcdef'])
      ok(`a malformed code (${bad}) is a 404 with the same page`, await dead(bad, 404) === true);

    const guesser = { 'x-forwarded-for': '10.78.0.1' };
    const guesses = [];
    for (let i = 0; i < 20; i++) guesses.push((await open(`zzzzzzzz${'abcdefghjkmnpqrstuvw'[i]}2`, guesser)).status);
    ok('20 wrong codes from one address each get the dead page', guesses.every(s => s === 400), guesses.join());
    const stopped = await open('abcdefghjk', guesser);
    ok('the 21st is refused with 429 and a short plain message', stopped.status === 429
       && /text\/plain/.test(stopped.headers.get('content-type') || '') && (await stopped.text()).length < 80);
    ok('...even with a real code, so a guess that hits looks like any other', (await open(codeOf(fresh), guesser)).status === 429);
    ok('another address is not held up', (await open(codeOf(fresh))).status === 302);

    // Review, 14 Nov: the count must hold against a burst, a made-up first
    // x-forwarded-for entry, and students tapping old links on one wifi.
    const anyCode = () => Array.from({ length: 10 }, () => '23456789abcdefghjkmnpqrstuvwxyz'[crypto.randomInt(31)]).join('');
    const wifi = { 'x-forwarded-for': '10.78.0.2' };
    const stale = [];
    for (let i = 0; i < 25; i++) stale.push((await open(codeOf(old), wifi)).status);
    for (let i = 0; i < 25; i++) stale.push((await open(codeOf(used), wifi)).status);
    for (let i = 0; i < 25; i++) stale.push((await open('abc', wifi)).status);
    ok('expired and used-up links and typos are not guesses: 75 of them from one wifi...',
       stale.every((s, i) => s === (i < 50 ? 400 : 404)), stale.join());
    ok('...and a student there can still open the new link the desk just sent', (await open(codeOf(fresh), wifi)).status === 302);
    const burst = await Promise.all(Array.from({ length: 60 }, () =>
      open(anyCode(), { 'x-forwarded-for': '10.78.0.3' }).then(r => r.status)));
    ok('60 guesses at once from one address: 20 are looked up, 40 get 429',
       burst.filter(s => s === 400).length === 20 && burst.filter(s => s === 429).length === 40,
       `${burst.filter(s => s === 400).length} looked up`);
    // cn.aybkk.net arrives from cloudflared on localhost: Cloudflare sets cf-connecting-ip
    // and puts the real address last in x-forwarded-for, after whatever the client sent.
    const tunnel = (real, sent) => ({ 'cf-connecting-ip': real, 'x-forwarded-for': `${sent}, ${real}` });
    const rotated = [];
    for (let i = 0; i < 21; i++) rotated.push((await open(anyCode(), tunnel('198.51.100.7', `10.80.0.${i}`))).status);
    ok('through the tunnel, a new made-up x-forwarded-for each time does not get round the count',
       rotated.slice(0, 20).every(s => s === 400) && rotated[20] === 429, rotated.join());
    for (let i = 0; i < 20; i++) await open(anyCode(), tunnel('198.51.100.8', '198.51.100.9'));
    ok("...and a guesser who writes someone else's address first does not lock that person out",
       (await open(codeOf(fresh), tunnel('198.51.100.9', '198.51.100.9'))).status === 302
       && (await open(codeOf(fresh), tunnel('198.51.100.8', '198.51.100.10'))).status === 429);
    const lan = Object.values(require('os').networkInterfaces()).flat().find(a => a && a.family === 'IPv4' && !a.internal);
    if (lan) {
      const direct = [];
      for (let i = 0; i < 21; i++) direct.push((await fetch(`http://${lan.address}:${port}/in/${anyCode()}`,
        { redirect: 'manual', headers: { 'cf-connecting-ip': `10.81.0.${i}`, 'x-forwarded-for': '10.81.1.1' } })).status);
      ok('cf-connecting-ip counts only from localhost: anywhere else anyone can send it',
         direct.slice(0, 20).every(s => s === 400) && direct[20] === 429, direct.join());
    } else console.log('  (no network card besides localhost: the cf-connecting-ip check from elsewhere is skipped)');

    const realRandomInt = crypto.randomInt;
    crypto.randomInt = () => 0;
    const twos = await post(`/api/bkk/admin/members/${twoCode}/signin-link`, {}, ADMIN);
    let n = 0;
    crypto.randomInt = (...a) => n++ < 10 ? 0 : realRandomInt(...a);
    const retried = await post(`/api/bkk/admin/members/${twoCode}/signin-link`, {}, ADMIN);
    crypto.randomInt = () => 0;
    const stuck = await post(`/api/bkk/admin/members/${twoCode}/signin-link`, {}, ADMIN);
    crypto.randomInt = realRandomInt;
    ok('a short code that is taken is drawn again', twos.status === 200 && codeOf(twos.body) === '2222222222'
       && retried.status === 200 && SHORT.test(retried.body.short_link) && codeOf(retried.body) !== '2222222222', JSON.stringify(retried.body));
    ok('...and a run of bad luck is an error, not a link to someone else', stuck.status === 500 && !stuck.body.link);

    const plain = (await post(`/api/bkk/admin/members/${twoCode}/signin-link`, {}, ADMIN)).body.link.split('/').pop();
    ok('the long link alone still works, without ever opening the short one',
       (await fetch(`${B}/api/bkk/login/${plain}`)).status === 200
       && (await fetch(`${B}/api/bkk/login/${plain}`, { method: 'POST' }).then(r => r.text())).includes(twoCode));
  }
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
  const kateSent = (await post(`/api/bkk/admin/members/${kateCode}/signin-link`, {}, ADMIN)).body;
  const kateLink = kateSent.link.split('/').pop();
  ok("Kat, holding Kate's link, puts her own email on Kate's profile",
     (await post(`/api/bkk/me/${kateCode}/email`, { email: 'kat.mixup@example.com' })).status === 200);
  ok('...so her own profile refuses it (the reported problem)',
     (await post(`/api/bkk/me/${katCode}/email`, { email: 'kat.mixup@example.com' })).status === 409);
  const nK = signins().length;
  await post('/api/bkk/login/request', { email: 'kat.mixup@example.com' });
  const katMailTok = (signins().slice(nK)[0] || { text: '' }).text.match(/login\/([a-f0-9]{64})/);
  ok("while it sits there, Kat's email sign-in opens Kate's profile", !!katMailTok);
  // A drop-in is bought for a class.
  const dropCls = (await J('/api/bkk/schedule?days=14')).body.classes.find(c => c.seatsLeft > 0 && !c.started);
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
  ok('...and so is its short link', (await fetch(`${B}/in/${kateSent.short_link.split('/in/')[1]}`,
    { redirect: 'manual', headers: { 'x-forwarded-for': '10.79.0.1' } })).status === 400);
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
  const tsch = (await J("/api/bkk/schedule", { headers: ADMIN })).body.classes || [];
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

  console.log('\n-- In-Depth page counts, and landing pages by week --');
  {
    const evRows = async src => (await pool.query(`SELECT page, kind, src, tag, lang, ch FROM bkk_start_events WHERE src=$1 ORDER BY id`, [src])).rows;
    for (const kind of ['view', 'step2', 'step3']) {
      const r = await post('/api/bkk/start-event', { page: 'in-depth-zh', kind, src: 'WX-Test!', tag: 'Teacher', lang: 'zh', ch: 'line' });
      ok(`an In-Depth page counts ${kind}`, r.status === 200 && r.body.success === true, JSON.stringify(r));
    }
    let ev = await evRows('wx-test');
    ok('...stored with its page, src and tag cleaned, and no channel', ev.length === 3 && ev.every(e => e.page === 'in-depth-zh'
      && e.tag === 'teacher' && e.lang === 'zh' && e.ch === null) && ev.map(e => e.kind).join() === 'view,step2,step3', JSON.stringify(ev));
    ok('the table has no column for an address, name, email or member', (await pool.query(`SELECT column_name FROM information_schema.columns
      WHERE table_name='bkk_start_events'`)).rows.map(r => r.column_name).sort().join() === 'ch,created_at,id,kind,lang,page,src,tag');
    for (const kind of ['sent', 'fit', 'tap', 'step', 'Step2', 'hack', undefined]) {
      const r = await post('/api/bkk/start-event', { page: 'in-depth-en', kind, src: 'wx-test' });
      ok(`a page cannot send kind ${kind} for an In-Depth page → 400`, r.status === 400 && r.body.error === 'kind', JSON.stringify(r));
    }
    for (const page of ['in-depth', 'Start', ['start'], 'toString']) {
      const r = await post('/api/bkk/start-event', { page, kind: 'view', src: 'wx-test' });
      ok(`an unknown page ${JSON.stringify(page)} → 400`, r.status === 400 && r.body.error === 'page', JSON.stringify(r));
    }
    ok('...and none of those is stored', (await evRows('wx-test')).length === 3);
    // /start, its ladder, the letter doors and the evening summary read page 'start' only.
    for (const kind of ['view', 'step2']) await post('/api/bkk/start-event', { page: 'in-depth-en', kind, src: 'reel-sleep1' });
    await post('/api/bkk/start-event', { page: 'in-depth-en', kind: 'view', src: 'letter' });
    const st3 = (await J('/api/bkk/admin/start-stats', { headers: ADMIN })).body.sources.find(x => x.src === 'reel-sleep1');
    ok('In-Depth counts do not move the /start views and taps report', st3 && st3.views === 4 && st3.taps === 1, JSON.stringify(st3));
    ok('an old caller with no page is still /start', (await pool.query(`SELECT count(*)::int AS n FROM bkk_start_events
      WHERE src='reel-sleep1' AND page='start'`)).rows[0].n === 10);

    const wr = await J('/api/bkk/admin/landing-weeks');
    ok('landing pages by week need the staff key', wr.status === 401 && !wr.body.pages, JSON.stringify(wr));
    ok('...a wrong key too', (await J('/api/bkk/admin/landing-weeks', { headers: { 'x-bkk-key': 'nope' } })).status === 401);
    // Week edges in Bangkok: this Monday 00:00 is this week, last Sunday 23:59:59 is last week,
    // the Monday 7 weeks back is the oldest week shown, and the Sunday before it is not shown.
    const mon = (await pool.query(`SELECT to_char(date_trunc('week', now() AT TIME ZONE 'Asia/Bangkok'), 'YYYY-MM-DD') AS d`)).rows[0].d;
    const at = (days, hms) => new Date(Date.parse(`${mon}T${hms}+07:00`) + days * 864e5).toISOString();
    const put = (page, kind, src, tag, when, ch = null) => pool.query(`INSERT INTO bkk_start_events (page,kind,src,tag,lang,ch,created_at)
      VALUES ($1,$2,$3,$4,'zh',$5,$6)`, [page, kind, src, tag, ch, when]);
    for (const [kind, n] of [['view', 4], ['step2', 3], ['step3', 2], ['sent', 2], ['fit', 1]]) {
      for (let i = 0; i < n; i++) await put('in-depth-zh', kind, i ? 'wk-reel' : 'wk-article', i < 2 ? 'teacher' : null, at(0, '00:00:00'));
    }
    await put('in-depth-zh', 'view', 'wk-article', 'room', at(-1, '23:59:59'));
    await put('in-depth-zh', 'sent', 'wk-article', 'room', at(-1, '23:59:59'));
    await put('in-depth-zh', 'view', 'wk-old', null, at(-49, '00:00:00'));
    await put('in-depth-zh', 'view', 'wk-older', null, at(-50, '23:59:59'));
    await put('in-depth-en', 'view', 'wk-en', 'practice', at(0, '09:00:00'));
    for (const [kind, ch] of [['view', null], ['view', null], ['tap', 'line'], ['step', 'q1'], ['step', 'q2'], ['step', 'q3'],
      ['step', 'done-line'], ['step', 'done-wa']]) await put('start', kind, 'wk-start', null, at(0, '10:00:00'), ch);
    await put('start', 'tap', 'letter', null, at(0, '10:00:00'), 'line');
    const w = await J('/api/bkk/admin/landing-weeks', { headers: ADMIN });
    const wb = w.body, pg = id => (wb.pages || []).find(p => p.page === id);
    ok('8 weeks, newest first, each a Monday', w.status === 200 && wb.weeks.length === 8 && wb.weeks[0] === mon
      && wb.weeks.every(d => new Date(d + 'T12:00:00Z').getUTCDay() === 1)
      && wb.weeks.every((d, i) => !i || Date.parse(wb.weeks[i - 1]) - Date.parse(d) === 7 * 864e5), JSON.stringify(wb.weeks));
    ok('one block per page, its ladder in order', pg('in-depth-zh').cols.join() === 'view,step2,step3,sent,fit'
      && pg('in-depth-en').cols.join() === 'view,step2,step3,sent,fit' && pg('start').cols.join() === 'view,tap,q1,q2,q3,done'
      && (wb.pages || []).every(p => p.weeks.length === 8));
    const zh0 = pg('in-depth-zh').weeks[0], zh1 = pg('in-depth-zh').weeks[1], zh7 = pg('in-depth-zh').weeks[7];
    // This week also holds the three counts the page sent above (wx-test).
    ok('this week: opens, step 2, step 3, sent, real fit', JSON.stringify(zh0.n) === JSON.stringify({ view: 5, step2: 4, step3: 3, sent: 2, fit: 1 }),
      JSON.stringify(zh0.n));
    ok('Sunday 23:59:59 Bangkok counts in the week before', JSON.stringify(zh1.n) === JSON.stringify({ view: 1, step2: 0, step3: 0, sent: 1, fit: 0 }),
      JSON.stringify(zh1.n));
    ok('the oldest week starts on its Monday 00:00; the Sunday before is not shown', zh7.n.view === 1
      && zh7.bySrc.length === 1 && zh7.bySrc[0].src === 'wk-old' && !pg('in-depth-zh').weeks.some(x => x.bySrc.some(s => s.src === 'wk-older')),
      JSON.stringify(zh7));
    const art = zh0.bySrc.find(x => x.src === 'wk-article'), reel = zh0.bySrc.find(x => x.src === 'wk-reel');
    ok('a week splits by source, biggest first', zh0.bySrc[0].src === 'wk-reel' && reel && JSON.stringify(reel.n) === JSON.stringify({ view: 3, step2: 2, step3: 1, sent: 1, fit: 0 })
      && art && JSON.stringify(art.n) === JSON.stringify({ view: 1, step2: 1, step3: 1, sent: 1, fit: 1 }), JSON.stringify(zh0.bySrc));
    const tTeacher = zh0.byTag.find(x => x.tag === 'teacher'), tNone = zh0.byTag.find(x => x.tag === null);
    ok('...and by headline tag, with no tag as null', tTeacher && JSON.stringify(tTeacher.n) === JSON.stringify({ view: 3, step2: 3, step3: 3, sent: 2, fit: 1 })
      && tNone && JSON.stringify(tNone.n) === JSON.stringify({ view: 2, step2: 1, step3: 0, sent: 0, fit: 0 }), JSON.stringify(zh0.byTag));
    ok('the English page has its own block', pg('in-depth-en').weeks[0].bySrc.some(x => x.src === 'wk-en' && x.n.view === 1)
      && pg('in-depth-en').weeks[0].byTag.some(x => x.tag === 'practice' && x.n.view === 1) && !pg('in-depth-zh').weeks[0].bySrc.some(x => x.src === 'wk-en'));
    const ws = pg('start').weeks[0].bySrc.find(x => x.src === 'wk-start');
    ok('/start by week: views, taps and its ladder, every done door as one', ws
      && JSON.stringify(ws.n) === JSON.stringify({ view: 2, tap: 1, q1: 1, q2: 1, q3: 1, done: 2 }), JSON.stringify(ws));
    ok('...not the letter box taps', !pg('start').weeks.some(x => x.bySrc.some(s => s.src === 'letter')));
    ok('the real fit rule comes with the numbers', wb.fitRule && wb.fitRule.mornings === 4 && wb.fitRule.years === 2 && wb.fitRule.dates === 'yes');
    const wtext = JSON.stringify(wb);
    ok('the weekly answer holds counts only: no name, email, member code or address', !/@|example|member|"ip"|code/i.test(wtext), wtext.slice(0, 200));

    // Review fixes (18 Nov 2026): no-kind bodies, tags, contact-looking sources, crawlers, a cap per address.
    const { REAL_FIT_ID } = require('../inbox.js');
    const evN = async () => (await pool.query(`SELECT count(*)::int AS n FROM bkk_start_events`)).rows[0].n;
    let n0 = await evN();
    for (const [what, r] of [['an empty body', await post('/api/bkk/start-event', {})],
      ['page null and no kind', await post('/api/bkk/start-event', { page: null, src: 'nokind' })],
      ['a /start body with no kind', await post('/api/bkk/start-event', { src: 'nokind', lang: 'en' })],
      ['a body that is not JSON', await J('/api/bkk/start-event', { method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ page: 'in-depth-zh', kind: 'step3' }) })]]) {
      ok(`${what} is not a visit → 400`, r.status === 400 && r.body.error === 'kind', JSON.stringify(r));
    }
    ok('...and none of those is stored as a /start view', await evN() === n0);
    await post('/api/bkk/start-event', { page: 'in-depth-zh', kind: 'view', src: 'tag-test', tag: 'Anything' });
    await post('/api/bkk/start-event', { page: 'in-depth-zh', kind: 'view', src: 'tag-test', tag: 'Room' });
    await post('/api/bkk/start-event', { kind: 'view', src: 'tag-test', tag: 'teacher' });
    ok('a tag is one of the three headlines or none, and /start has none', (await evRows('tag-test')).map(e => `${e.page}:${e.tag}`).join()
      === 'in-depth-zh:null,in-depth-zh:room,start:null', JSON.stringify(await evRows('tag-test')));
    for (const src of ['ana@example.com', 'wa +66 81 234 5678', 'line-081-234-5678']) {
      await post('/api/bkk/start-event', { page: 'in-depth-en', kind: 'view', src, tag: 'practice' });
    }
    await post('/api/bkk/start-event', { page: 'in-depth-en', kind: 'view', src: 'Reel-2026-11-18', tag: 'practice' });
    ok('a source that looks like an email or a phone number is dropped; a dated post code is kept',
      JSON.stringify((await pool.query(`SELECT src FROM bkk_start_events WHERE tag='practice' AND page='in-depth-en' AND id > (SELECT max(id) - 4 FROM bkk_start_events) ORDER BY id`)).rows.map(r => r.src))
      === '[null,null,null,"reel-2026-11-18"]');
    n0 = await evN();
    for (const ua of ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Mozilla/5.0 (Linux; Android 10) HeadlessChrome/120.0',
      'Mozilla/5.0 (compatible; Baiduspider/2.0)', 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Mobile Safari/537.36 (compatible; Bytespider)']) {
      const r = await post('/api/bkk/start-event', { page: 'in-depth-zh', kind: 'view', src: 'bot-test' }, { 'User-Agent': ua });
      ok(`a crawler is not counted (${ua.slice(25, 45)}) → 204`, r.status === 204, JSON.stringify(r));
    }
    ok('...and nothing is stored for them', await evN() === n0);
    for (const ua of ['Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.40 NetType/WIFI Language/zh_CN']) {
      ok(`a phone is counted (${ua.includes('CUBOT') ? 'Cubot' : 'WeChat'})`, (await post('/api/bkk/start-event', { page: 'in-depth-zh', kind: 'view', src: 'phone-test' },
        { 'User-Agent': ua })).status === 200);
    }
    const codes = {};
    for (let b = 0; b < 7; b++) await Promise.all(Array.from({ length: 50 }, () => post('/api/bkk/start-event',
      { page: 'in-depth-en', kind: 'view', src: 'cap-test' }, { 'X-Forwarded-For': '10.20.30.40' }).then(r => { codes[r.status] = (codes[r.status] || 0) + 1; })));
    ok('one address counts 300 an hour, then 429', codes[200] === 300 && codes[429] === 50 && (await evRows('cap-test')).length === 300, JSON.stringify(codes));
    ok('...another address still counts', (await post('/api/bkk/start-event', { page: 'in-depth-en', kind: 'view', src: 'cap-test2' },
      { 'X-Forwarded-For': '10.20.30.41' })).status === 200);
    await pool.query(`DELETE FROM bkk_start_events WHERE src IN ('cap-test', 'cap-test2', 'phone-test', 'tag-test')
      OR (tag = 'practice' AND page = 'in-depth-en' AND src IS DISTINCT FROM 'wk-en')`);

    // A week with more sources than the split shows: the rest is one "other" row, so the split adds up.
    for (let i = 0; i < 33; i++) await put('in-depth-en', 'view', `many-${String(i).padStart(2, '0')}`, null, at(0, '11:00:00'));
    await put('in-depth-en', 'sent', 'many-32', null, at(0, '11:00:00'), REAL_FIT_ID);
    // A sent row counted under an earlier rule marks its week; the rule in force does not.
    await put('in-depth-zh', 'sent', 'wk-article', null, at(-14, '09:00:00'), 'r00000000');
    await put('in-depth-zh', 'fit', 'wk-article', null, at(0, '09:00:00'), REAL_FIT_ID);
    const w2 = (await J('/api/bkk/admin/landing-weeks', { headers: ADMIN })).body;
    const en0 = w2.pages.find(p => p.page === 'in-depth-en').weeks[0], zhW = w2.pages.find(p => p.page === 'in-depth-zh').weeks;
    const sumBy = (list, c) => list.reduce((s, x) => s + x.n[c], 0);
    ok('a split keeps the 30 biggest and puts the rest in one "other" row', en0.bySrc.length === 31 && en0.bySrc[30].other === true
      && !('src' in en0.bySrc[30]) && en0.bySrc.slice(0, 30).every(x => !x.other), JSON.stringify(en0.bySrc.slice(-2)));
    ok('...so the split adds up to the week, for every number', en0.n.view === pg('in-depth-en').weeks[0].n.view + 33 && ['view', 'step2', 'sent']
      .every(c => sumBy(en0.bySrc, c) === en0.n[c] && sumBy(en0.byTag, c) === en0.n[c]), JSON.stringify(en0.n));
    ok('a week counted under an earlier real-fit rule is marked; this week is not', zhW[2].olderRule === true && zhW[0].olderRule === false
      && zhW[1].olderRule === false && w2.fitRuleId === REAL_FIT_ID, JSON.stringify(zhW.map(w => w.olderRule)));
    await pool.query(`DELETE FROM bkk_start_events WHERE src LIKE 'many-%' OR ch IN ('r00000000', $1)`, [REAL_FIT_ID]);
    // The letter box's own tests below count its taps.
    await pool.query(`DELETE FROM bkk_start_events WHERE src='letter'`);
  }

  console.log('\n— 12-week proof check —');
  const ck = (await quickAdd({ name: 'Check Person', email: 'check.person@example.com' }, PKEY)).code;
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
    const lastDrop = addD(new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), 13);
    ok('a drop-in for a class two years off is refused, naming the last day drop-ins are open', far.status === 409
       && far.body.dropinUntil === lastDrop && /open 2 weeks before/.test(far.body.error) && far.body.error.includes(lastDrop), JSON.stringify(far.body));
    const month = await post('/api/bkk/orders', { productCode: 'dropin', name: 'Month Off', email: 'month.off@example.com',
      slotId: dc.slotId, date: weeksOn(4) });
    ok('...and so is a class a month off (Boonchu, 19 Nov 2026: drop-ins open 2 weeks before)', month.status === 409
       && month.body.dropinUntil === lastDrop && !month.body.order, JSON.stringify(month.body).slice(0, 160));
    const pageSrc = require('fs').readFileSync(require('path').join(__dirname, '../public/bkk.html'), 'utf8');
    const apiSrc = require('fs').readFileSync(require('path').join(__dirname, '../bkk-api.js'), 'utf8');
    {
      // The page's own code (19 Nov 2026): the drop-in class list, and the offer when a student has no pass for a class.
      const vm = require('vm');
      const seg = pageSrc.slice(pageSrc.indexOf('  const singleClass = p =>'), pageSrc.indexOf('  window.buy = (code, pre, intro) =>'))
        + pageSrc.slice(pageSrc.indexOf('  // A class more than 2 weeks off: the day its drop-ins open'), pageSrc.indexOf('  // Book and cancel keep the student where they are'));
      const make = code => {
        const seen = { buys: [], tabs: [], els: {} };
        const el = sel => seen.els[sel] || (seen.els[sel] = { innerHTML: '', open: false, showModal() { this.open = true; }, close() { this.open = false; } });
        const ctx = { PRODUCTS: [{ code: 'dropin', kind: 'credits', credits: 1 }], buy: (...a) => seen.buys.push(a),
          t: (k, ...a) => `${k}(${a.join(',')})`, esc: x => String(x), fmtDay: iso => iso.slice(0, 10), myCode: () => code,
          $: el, tab: x => seen.tabs.push(x), isClosed: c => !!c.closed,
          bkkToday: () => '2026-11-19', addDays: (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10) };
        vm.createContext(ctx);
        vm.runInContext(seg + '\n;this.pg = { offer: offerDropin, dropOpts, dropLast };', ctx);
        return { pg: ctx.pg, seen };
      };
      const list = [['2026-11-20', 3], ['2026-12-02', 1], ['2026-12-03', 5], ['2026-12-09', 5], ['2026-11-25', 0], ['2026-11-26', 4, true]]
        .map(([date, seatsLeft, closed]) => ({ date, seatsLeft, closed }));
      const a = make('');
      ok('the page: the drop-in list keeps classes with a place up to today + 13 (2 Dec on 19 Nov), never later, full or closed',
         a.pg.dropOpts(list, a.pg.dropLast()).map(c => c.date).join() === '2026-11-20,2026-12-02');
      const far = a.pg.offer(7, '2026-12-03'), farHtml = a.seen.els['#dlgIn'].innerHTML;
      const near = a.pg.offer(7, '2026-12-02');
      ok('the page, signed out: a class on day 15 shows when its drop-ins open (20 Nov for 3 Dec), packages, and "I already have a pass"; day 14 opens the drop-in form',
         far && near && a.seen.els['#dlg'].open && farHtml.includes('dropLater(2026-11-20)') && farHtml.includes('havePass()')
           && farHtml.includes('seePkgs()') && !farHtml.includes('passLaterFar') && a.seen.buys.length === 1
           && a.seen.buys[0][1].date === '2026-12-02' && a.seen.buys[0][2] === 'noPassDrop()', JSON.stringify([farHtml, a.seen.buys]));
      a.seen.els['#fdHave'].onclick();
      ok('...and "I already have a pass" goes to My account', a.seen.tabs.join() === 'me' && !a.seen.els['#dlg'].open);
      const b = make('BTESTCODE');
      b.pg.offer(7, '2026-12-20', '2027-02-15');
      const bHtml = b.seen.els['#dlgIn'].innerHTML;
      b.pg.offer(7, '2026-11-25', '2027-02-15');
      ok('the page, signed in with a pass that starts later: a far class says why the pass does not cover it, a near one opens the form saying so',
         bHtml.includes('passLaterFar(2027-02-15)') && bHtml.includes('dropLater(2026-12-07)') && !bHtml.includes('havePass')
           && b.seen.buys.length === 1 && b.seen.buys[0][2] === 'passLater(2027-02-15)', JSON.stringify([bHtml, b.seen.buys]));
    }
    ok('the booking page lists the same 2 weeks the server sells (DROP_DAYS = DROPIN_DAYS = 14), through dropOpts',
       /const DROP_DAYS = 14;/.test(pageSrc) && /const DROPIN_DAYS = 14;/.test(apiSrc) && /const opts = single \? dropOpts\(CLASSES, last\) : \[\];/.test(pageSrc));

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
    // The count is payments that brought money in (15 Nov 2026): the refund is in the money, not in the count.
    ok('report: money total, VAT and count', rm.total === 9600 + 1500 + 14000 - 1500 && rm.vat === 628 && rm.count === 3, JSON.stringify(rm));
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
    const early = (await J('/api/bkk/schedule?days=14')).body.classes.find(c => c.startAt.endsWith('T05:30:00+07:00') && c.seatsLeft > 0 && !c.started);
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
    const newMember = async (name, email) => quickAdd({ name, email }, PKEY);
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

  // ── one sale, one row (15 Nov 2026) ────────────────────────────────────────
  // The owner saw one person's payment many times over in Payments: Rezerv's ฿0
  // lines, sales recorded in both systems, a second Activate, a desk sale sent
  // twice. Made-up people only.
  console.log('\n:: Payments: one sale, one row (the page\'s own sorting) ::');
  {
    const fs = require('fs'), vm = require('vm'), path = require('path');
    const page = fs.readFileSync(path.join(__dirname, '../public/bkk-admin.html'), 'utf8');
    const seg = page.slice(page.indexOf('  const HOUR = 3600e3;'), page.indexOf('  const ordPill'));
    const ctx = { PAY_MODE: 'gateway', bkkYmd: (ms = Date.now()) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10),
      cls: t => t, ymdLong: d => d };
    vm.createContext(ctx);
    vm.runInContext(seg + '\n;this.po = { sortOrders, ordClass };', ctx);
    const { sortOrders, ordClass } = ctx.po;
    const NOW = Date.parse('2026-11-15T03:00:00Z');
    let fid = 0;
    const at = h => new Date(NOW - h * 3600e3).toISOString();
    const row = o => ({ id: ++fid, member_id: 1, member_code: 'OSA1', member_name: 'Ana Example', product_id: 3, name_en: '3 months unlimited',
      item_name: null, status: 'paid', amount_thb: 20865, base_thb: 19500, fee_thb: 0, vat_thb: 1365, method: 'cash', source: null,
      slot_id: null, class_date: null, created_at: at(2), gateway_note: null, twin_of: null, ...o });
    const ids = list => list.map(o => o.id).join();

    const rzReal = row({ source: 'rezerv', method: 'card', created_at: at(30) });
    const rzZero = [1, 2, 3].map(k => row({ source: 'rezerv', method: 'other', amount_thb: 0, base_thb: 0, vat_thb: 0,
      created_at: at(30 - k / 60), gateway_note: 'Free | promo bonus' }));
    const s1 = sortOrders([rzReal, ...rzZero], NOW);
    ok('1 real Rezerv payment and 3 ฿0 Rezerv lines: nothing in the main list, one row in the Rezerv fold with "+3 at ฿0"',
       s1.main.length === 0 && ids(s1.rz) === String(rzReal.id) && s1.rzAll === 4 && s1.bonusN[rzReal.id] === 3, JSON.stringify([ids(s1.main), ids(s1.rz), s1.bonusN]));

    const desk = row({ member_id: 2, member_code: 'OSB2', member_name: 'Ben Example', created_at: at(5) });
    const deskCopy = row({ member_id: 2, member_code: 'OSB2', member_name: 'Ben Example', source: 'rezerv', method: 'other',
      amount_thb: 0, base_thb: 0, vat_thb: 0, created_at: at(4), gateway_note: 'Free' });
    const s2 = sortOrders([deskCopy, desk], NOW);
    ok('a desk sale and its ฿0 Rezerv copy: the desk row in the main list with the Rezerv note, the Rezerv row in the fold',
       ids(s2.main) === String(desk.id) && s2.alsoRz[desk.id] === deskCopy && ids(s2.rz) === String(deskCopy.id) && !s2.bonusN[desk.id],
       JSON.stringify([ids(s2.main), ids(s2.rz), Object.keys(s2.alsoRz)]));
    // A twin (the import paired it) still says so, from another profile it never does.
    const twin = { ...deskCopy, id: ++fid, status: 'twin', twin_of: desk.id };
    const other = row({ member_id: 9, member_code: 'OSZ9', member_name: 'Zed Example', source: 'rezerv', amount_thb: 0, created_at: at(4) });
    const s2b = sortOrders([twin, other, desk], NOW);
    ok('...a Rezerv line kept as the twin of that sale says it too, and another person\'s ฿0 line says nothing about it',
       s2b.alsoRz[desk.id] === twin && s2b.rz.length === 2, JSON.stringify(Object.keys(s2b.alsoRz)));

    const t1 = row({ member_id: 3, member_code: 'OSC3', member_name: 'Cai Example', method: 'online', status: 'pending', created_at: at(1) });
    const t2 = { ...t1, id: ++fid, created_at: at(0.5) };
    const s3 = sortOrders([t2, t1], NOW);
    ok('two unpaid tries 30 minutes apart: one row in the main list (the newer), the older one in Unpaid tries, counted on it',
       ids(s3.main) === String(t2.id) && ids(s3.tries) === String(t1.id) && s3.triesN[t2.id] === 1, JSON.stringify([ids(s3.main), ids(s3.tries), s3.triesN]));

    const paid = row({ member_id: 4, member_code: 'OSD4', member_name: 'Dee Example', method: 'online', created_at: at(3) });
    const again = { ...paid, id: ++fid, status: 'pending', created_at: at(2) };
    const s4 = sortOrders([again, paid], NOW);
    ok('a try made after a paid order for the same package folds onto that paid row: "tapped Buy again after paying"',
       ids(s4.main) === String(paid.id) && ids(s4.tries) === String(again.id) && s4.againN[paid.id] === 1 && !s4.triesN[paid.id],
       JSON.stringify([ids(s4.main), s4.againN, s4.triesN]));

    const d1 = row({ member_id: 5, member_code: 'OSE5', member_name: 'Eli Example', created_at: at(1) });
    const d2 = { ...d1, id: ++fid, created_at: new Date(Date.parse(d1.created_at) + 5 * 60e3).toISOString() };
    const s5 = sortOrders([d2, d1], NOW);
    ok('two paid desk rows 5 minutes apart: both in the main list, the newer marked 2nd',
       s5.main.length === 2 && s5.nth[d2.id] === 2 && !s5.nth[d1.id], JSON.stringify(s5.nth));
    const o1 = { ...d1, id: ++fid, method: 'online', created_at: new Date(Date.parse(d1.created_at) + 60 * 60e3).toISOString() };
    ok('...and an online payment after them is the 3rd, online and desk counted together',
       sortOrders([o1, d2, d1], NOW).nth[o1.id] === 3);

    const di = o => row({ member_id: 6, member_code: 'OSF6', member_name: 'Fay Example', product_id: 1, name_en: 'Drop-in', amount_thb: 1605,
      method: 'online', ...o });
    const dA = di({ slot_id: 11, class_date: '2026-11-16', class_title: 'Mysore 5.30am (1st batch)', class_day: '2026-11-16', created_at: at(3) });
    const dB = di({ slot_id: 12, class_date: '2026-11-17', class_title: 'Led Primary', class_day: '2026-11-17', created_at: at(2) });
    const s6 = sortOrders([dB, dA], NOW);
    ok('drop-ins for two different classes stay 2 rows, each with its own class and day',
       s6.main.length === 2 && !s6.nth[dB.id] && ordClass(dA) !== ordClass(dB) && ordClass(dA).includes('Mysore') && ordClass(dB).includes('2026-11-17'),
       JSON.stringify([ordClass(dA), ordClass(dB)]));

    const old = row({ member_id: 7, member_code: 'OSG7', member_name: 'Gus Example', created_at: at(24 * 40) });
    const late = { ...old, id: ++fid, method: 'online', status: 'paid', created_at: at(1) };
    const rzPaid = row({ member_id: 7, member_code: 'OSG7', member_name: 'Gus Example', source: 'rezerv', created_at: at(48) });
    const rzRefund = { ...rzPaid, id: ++fid, status: 'refund', amount_thb: -20865, created_at: at(47) };
    const s7 = sortOrders([late, rzRefund, rzPaid, old], NOW);
    ok('a refund and every aybkk.net row with money stay as rows: an old payment, a newer one, the Rezerv payment and its refund',
       ids(s7.main) === [late.id, old.id].join() && ids(s7.rz) === [rzRefund.id, rzPaid.id].join() && !s7.bonusN[rzPaid.id], JSON.stringify([ids(s7.main), ids(s7.rz)]));

    const n1 = row({ member_id: 8, member_code: 'OSH8', member_name: 'Hana Example' });
    const n2 = row({ member_id: 9, member_code: 'OSI9', member_name: 'example, hana.', product_id: 5, name_en: '1 month unlimited' });
    const n3 = row({ member_id: 10, member_code: 'OSJ10', member_name: 'Ivy Example' });
    const s8 = sortOrders([n1, n2, n3], NOW);
    ok('two member codes with one name (any case, punctuation or word order) each say "same name as" the other; a third name says nothing',
       s8.sameName[n1.id] === 'OSI9' && s8.sameName[n2.id] === 'OSH8' && !s8.sameName[n3.id], JSON.stringify(s8.sameName));

    // Review fixes: the server pairs by the day the money came in, and a twin is always this sale's.
    const late2 = row({ member_id: 11, member_code: 'OSK11', member_name: 'Kai Example', method: 'online',
      created_at: '2026-11-11T16:50:00Z', verified_at: '2026-11-11T17:20:00Z' });
    const lateTwin = row({ member_id: 11, member_code: 'OSK11', member_name: 'Kai Example', source: 'rezerv', status: 'twin', method: 'other',
      amount_thb: 0, base_thb: 0, vat_thb: 0, twin_of: late2.id, created_at: '2026-11-15T01:00:00Z' });
    const s9 = sortOrders([lateTwin, late2], NOW);
    ok('a sale tapped before Bangkok midnight and paid after it keeps its Rezerv note: the twin is always its own, and settled (grey)',
       s9.alsoRz[late2.id] === lateTwin && s9.rzLinked[late2.id] === true, JSON.stringify([Object.keys(s9.alsoRz), s9.rzLinked]));
    const s9b = sortOrders([lateTwin, { ...late2, rz_pass: true }], NOW);
    ok('...but while the server sees a live Rezerv pass for that sale it still asks to check the passes',
       s9b.alsoRz[late2.id] === lateTwin && !s9b.rzLinked[late2.id]);
    const loose = row({ member_id: 11, member_code: 'OSK11', member_name: 'Kai Example', source: 'rezerv', method: 'other',
      amount_thb: 0, base_thb: 0, vat_thb: 0, created_at: '2026-11-13T01:00:00Z' });
    const s9c = sortOrders([loose, lateTwin, late2], NOW);
    ok('...and a Rezerv line not linked to it is the one the note names, with a warning',
       s9c.alsoRz[late2.id] === loose && !s9c.rzLinked[late2.id]);
    const otherSale = row({ member_id: 11, member_code: 'OSK11', member_name: 'Kai Example', created_at: '2026-11-12T03:00:00Z' });
    ok('...a Rezerv line linked to another sale says nothing on this one',
       !sortOrders([lateTwin, otherSale], NOW).alsoRz[otherSale.id]);
    const p8 = row({ member_id: 12, member_code: 'OSL12', member_name: 'Lia Example', product_id: 2, product_code: 'pack8',
      name_en: '8 classes / 2 months', created_at: at(3) });
    const p8m1 = row({ member_id: 12, member_code: 'OSL12', member_name: 'Lia Example', product_id: 7, product_code: 'pack8m1',
      name_en: '8 classes / 1 month', source: 'rezerv', method: 'other', amount_thb: 0, created_at: at(2) });
    ok('a Rezerv line under the other name of the package family (8 classes in 1 month next to 2 months) gets the note too',
       sortOrders([p8m1, p8], NOW).alsoRz[p8.id] === p8m1);
  }

  console.log('\n:: one sale, one row: counts, guards and repairs ::');
  {
    const q1 = async (sql, args = []) => (await pool.query(sql, args)).rows[0] || {};
    const bkkD = ms => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10);
    const today = bkkD(Date.now());
    const addDay = (d, k) => new Date(Date.parse(d + 'T12:00:00Z') + k * 86400000).toISOString().slice(0, 10);
    const dmy = d => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; };
    const imp = (kind, rows) => post(`/api/bkk/admin/import/${kind}`, { rows, dryRun: false }, ADMIN);
    const sell = (body, extra = {}) => post('/api/bkk/admin/sales', { method: 'cash', ...body, ...extra }, ADMIN);
    const ord = refno => q1('SELECT * FROM bkk_orders WHERE refno=$1', [refno]);
    const hist = async code => (await J(`/api/bkk/admin/members/${code}/history`, { headers: ADMIN })).body;
    const report = async (from, to = from) => (await J(`/api/bkk/admin/report?from=${from}&to=${to}`, { headers: ADMIN })).body;
    const person = async (rz, name, email) => {
      await imp('members', [{ rezervId: rz, name, email }]);
      return (await q1('SELECT * FROM bkk_members WHERE rezerv_id=$1', [rz]));
    };

    // ── counts are payments, money is money ──
    const cnt = await person('OS-100', 'Kim Example', 'kim.os@example.test');
    const cday = '2025-06-17';
    const cImp = await imp('payments', [
      { rezervId: 'OS-P1', memberRezervId: 'OS-100', date: `${dmy(cday)} 09:00`, amount: 20865, item: '3 months Unlimited', method: 'CARD' },
      ...[2, 3, 4].map(k => ({ rezervId: `OS-P${k}`, memberRezervId: 'OS-100', date: `${dmy(cday)} 09:0${k}`, amount: '0.00',
        item: '3 months Unlimited', method: 'Free', note: 'promo bonus' }))]);
    const cRep = await report(cday), cH = await hist(cnt.code);
    ok('1 paid line and 3 ฿0 lines: Payments 1, Packages sold 1, by item 1, the money unchanged, no empty "other ฿0" line',
       cImp.body.added === 4 && cRep.money.count === 1 && cRep.passes.sold === 1 && cRep.money.total === 20865
       && cRep.money.byItem[0].n === 1 && cRep.money.byMethod.reduce((s, x) => s + x.n, 0) === 1
       && !cRep.money.byMethod.some(x => x.method === 'other'), JSON.stringify([cImp.body.added, cRep.money, cRep.passes.sold]));
    ok('...and the profile says 1 payment, paid ฿20,865', cH.summary.payments === 1 && cH.summary.totalPaid === 20865, JSON.stringify(cH.summary));

    // ── the orders list: the class of a drop-in, and how many there are in all ──
    const sch = (await J('/api/bkk/schedule?days=7', { headers: ADMIN })).body.classes.filter(c => !c.isOnline && c.seatsLeft > 2 && !c.started);
    const cl = sch[0], cl2 = sch.find(c => c.slotId !== cl.slotId || c.date !== cl.date);
    const dropSale = await sell({ productCode: 'dropin', name: 'Lin Example', email: 'lin.os@example.test', slotId: cl.slotId, date: cl.date });
    const ol = (await J('/api/bkk/admin/orders?limit=5', { headers: ADMIN })).body;
    const dRow = (ol.orders || []).find(o => String(o.refno) === dropSale.body.order.refno) || {};
    ok('the payments list gives a drop-in its class and class day, and the number of rows past the limit',
       dropSale.status === 200 && dRow.class_title === cl.title && dRow.class_day === cl.date && ol.orders.length === 5 && ol.total > 5,
       JSON.stringify([dropSale.body, dRow.class_title, dRow.class_day, ol.total]));

    // ── Activate on a try whose package is paid already ──
    const mia = { name: 'Mia Example', email: 'mia.os@example.test' };
    const miaDesk = await sell({ productCode: 'unlim1', ...mia, requestId: 'os-mia-1' });
    const miaTry = await post('/api/bkk/orders', { productCode: 'unlim1', ...mia });
    const fa1 = await post(`/api/bkk/admin/orders/${miaTry.body.order.id}/force-activate`, {}, ADMIN);
    ok('Activate on a try whose package was paid within 72 hours answers 409 with that payment: ref, when, method',
       fa1.status === 409 && fa1.body.paidAlready && fa1.body.paidAlready.refno === miaDesk.body.order.refno
       && fa1.body.paidAlready.method === 'cash' && !!fa1.body.paidAlready.at && (await ord(miaTry.body.order.refno)).status === 'pending',
       JSON.stringify(fa1.body));
    const fa2 = await post(`/api/bkk/admin/orders/${miaTry.body.order.id}/force-activate`, { confirm: true }, ADMIN);
    const miaRow = await ord(miaTry.body.order.refno);
    ok('...with confirm it goes ahead, and the note names the paid ref', fa2.status === 200 && miaRow.status === 'paid'
       && miaRow.gateway_note === `MANUAL ACTIVATION by admin, paid already as ref ${miaDesk.body.order.refno}`, miaRow.gateway_note);
    const miaOther = await post('/api/bkk/orders', { productCode: 'pack8', ...mia });
    const oldTry = await post('/api/bkk/orders', { productCode: 'unlim3', ...mia });
    const oldPaid = await sell({ productCode: 'unlim3', ...mia, requestId: 'os-mia-2' });
    await pool.query(`UPDATE bkk_orders SET created_at = now() - interval '4 days', verified_at = now() - interval '4 days' WHERE refno=$1`,
      [oldPaid.body.order.refno]);
    const fa3 = await post(`/api/bkk/admin/orders/${miaOther.body.order.id}/force-activate`, {}, ADMIN);
    const fa4 = await post(`/api/bkk/admin/orders/${oldTry.body.order.id}/force-activate`, {}, ADMIN);
    ok('...another package, or a payment more than 72 hours away, activates with no question', fa3.status === 200 && fa4.status === 200,
       JSON.stringify([fa3.body, fa4.body]));
    const manualRep = (await report(today)).money.manual;
    ok('Reports count what was activated by hand in the range, and its money', manualRep.n >= 3
       && manualRep.total >= (await ord(miaTry.body.order.refno)).amount_thb, JSON.stringify(manualRep));

    // ── desk sales: one id, one sale ──
    const nia = { productCode: 'unlim1', name: 'Nia Example', email: 'nia.os@example.test' };
    const s1 = await sell(nia, { requestId: 'os-nia-1' }), s2 = await sell(nia, { requestId: 'os-nia-1' });
    const niaN = async () => (await q1(`SELECT count(*)::int AS n FROM bkk_orders o JOIN bkk_members m ON m.id=o.member_id
      WHERE lower(m.email)='nia.os@example.test'`)).n;
    ok('the same sale id sent twice, one after the other: 1 order, the second reply is the first sale (repeat)',
       s1.status === 200 && s2.status === 200 && s2.body.repeat === true && s2.body.order.refno === s1.body.order.refno && (await niaN()) === 1,
       JSON.stringify([s1.body, s2.body]));
    const both = await Promise.all([1, 2].map(() => sell({ productCode: 'pack8', name: 'Oli Example', email: 'oli.os@example.test' }, { requestId: 'os-oli-1' })));
    const oliN = await q1(`SELECT count(*)::int AS n, count(DISTINCT o.member_id)::int AS m FROM bkk_orders o WHERE o.request_id='os-oli-1'`);
    const oliM = await q1(`SELECT count(*)::int AS n FROM bkk_members WHERE lower(email)='oli.os@example.test'`);
    ok('...sent twice at once for a new person: 1 order, 1 profile, both replies the same sale',
       both.every(b => b.status === 200) && both[0].body.order.refno === both[1].body.order.refno && both.some(b => b.body.repeat)
       && oliN.n === 1 && oliM.n === 1, JSON.stringify([both.map(b => b.body), oliN, oliM]));
    const blank = await Promise.all([1, 2].map(() => sell({ productCode: 'dropin', name: 'Pat Noemail Example' }, { requestId: 'os-pat-1' })));
    ok('...and for a new person with no email: 1 order, 1 profile', blank.every(b => b.status === 200)
       && (await q1(`SELECT count(*)::int AS n FROM bkk_members WHERE name='Pat Noemail Example'`)).n === 1
       && (await q1(`SELECT count(*)::int AS n FROM bkk_orders WHERE request_id='os-pat-1'`)).n === 1, JSON.stringify(blank.map(b => b.body)));
    const s3 = await sell(nia, { requestId: 'os-nia-2' });
    ok('the same person, package and class sold at the desk 15 minutes ago or less: 409 repeatOf, nothing sold',
       s3.status === 409 && s3.body.repeatOf && s3.body.repeatOf.refno === s1.body.order.refno && s3.body.repeatOf.method === 'cash'
       && s3.body.repeatOf.amount === s1.body.order.amount && (await niaN()) === 1, JSON.stringify(s3.body));
    const s4 = await sell(nia, { requestId: 'os-nia-2', confirmRepeat: true });
    ok('...confirmRepeat sells it', s4.status === 200 && !s4.body.repeat && s4.body.order.refno !== s1.body.order.refno && (await niaN()) === 2,
       JSON.stringify(s4.body));
    const ona = { productCode: 'unlim1', name: 'Ona Example', email: 'ona.os@example.test' };
    const onaWeb = await post('/api/bkk/orders', ona);
    await pool.query(`UPDATE bkk_orders SET status='paid', verified_at=now() - interval '2 days', created_at=now() - interval '2 days',
      gateway_note='confirmed' WHERE id=$1`, [onaWeb.body.order.id]);
    const onaDesk = await sell(ona, { requestId: 'os-ona-1' });
    ok('...and so does a desk sale of what the student paid for online in the last 72 hours',
       onaDesk.status === 409 && onaDesk.body.repeatOf.refno === onaWeb.body.order.refno && onaDesk.body.repeatOf.method === 'online', JSON.stringify(onaDesk.body));

    // ── the Rezerv import finds the aybkk.net sale it copies ──
    const tw = await person('OS-200', 'Quinn Example', 'quinn.os@example.test');
    const twSale = await sell({ productCode: 'unlim3', name: tw.name, email: tw.email, requestId: 'os-quinn-1' });
    const twPay = { rezervId: 'OS-T1', memberRezervId: 'OS-200', date: `${dmy(today)} 08:00`, amount: '0.00', item: '3 months Unlimited', method: 'Free' };
    const tw1 = await imp('payments', [twPay]);
    const twRow = await q1(`SELECT * FROM bkk_orders WHERE source='rezerv' AND source_ref='OS-T1'`);
    const twDesk = await ord(twSale.body.order.refno);
    const twH = await hist(tw.code);
    ok('a desk sale and a ฿0 Rezerv line for it the same day: the Rezerv line is its twin, with the note, and a note for the import',
       tw1.body.added === 1 && twRow.status === 'twin' && twRow.twin_of === twDesk.id
       && twRow.gateway_note.startsWith(`entered in Rezerv for check-in; paid on aybkk.net ref ${twSale.body.order.refno}`)
       && tw1.body.warnings.some(w => w.code === 'twinOfAybkk' && w.vals[0] === twSale.body.order.refno), JSON.stringify([tw1.body, twRow]));
    ok('...the profile counts 1 payment and the desk amount', twH.summary.payments === 1 && twH.summary.totalPaid === twDesk.amount_thb,
       JSON.stringify(twH.summary));
    const tw2 = await imp('payments', [twPay]);
    ok('...importing it again: already there, nothing changes', tw2.body.matched === 1 && tw2.body.added === 0
       && (await q1(`SELECT status FROM bkk_orders WHERE source='rezerv' AND source_ref='OS-T1'`)).status === 'twin', JSON.stringify(tw2.body));
    const mt = await person('OS-201', 'Rae Example', 'rae.os@example.test');
    const mtSale = await sell({ productCode: 'unlim1', name: mt.name, email: mt.email, requestId: 'os-rae-1' });
    const mt1 = await imp('payments', [{ rezervId: 'OS-T2', memberRezervId: 'OS-201', date: `${dmy(addDay(today, -1))} 18:00`,
      amount: mtSale.body.order.amount, item: '1 Month unlimited', method: 'CASH' }]);
    ok('a Rezerv line with money for a package paid here within 5 days stays paid, and asks a person (maybeTwin)',
       (await q1(`SELECT status, twin_of FROM bkk_orders WHERE source_ref='OS-T2'`)).status === 'paid'
       && mt1.body.warnings.some(w => w.code === 'maybeTwin' && w.vals[0] === mtSale.body.order.refno), JSON.stringify(mt1.body));
    const far = await person('OS-202', 'Sam Example', 'sam.os@example.test');
    await sell({ productCode: 'unlim3', name: far.name, email: far.email, requestId: 'os-sam-1' });
    const far1 = await imp('payments', [
      { rezervId: 'OS-T3', memberRezervId: 'OS-202', date: `${dmy(addDay(today, -10))} 08:00`, amount: 0, item: '3 months Unlimited', method: 'Free' },
      { rezervId: 'OS-T4', memberRezervId: 'OS-202', date: `${dmy(today)} 08:00`, amount: 0, item: 'Drop-in', method: 'Free' }]);
    const farRows = (await pool.query(`SELECT status, twin_of FROM bkk_orders WHERE source_ref IN ('OS-T3','OS-T4') ORDER BY source_ref`)).rows;
    ok('10 days apart, or another package: no link, no warning', far1.body.added === 2 && farRows.every(r => r.status === 'paid' && r.twin_of === null)
       && !far1.body.warnings.some(w => ['twinOfAybkk', 'maybeTwin'].includes(w.code)), JSON.stringify([farRows, far1.body.warnings]));
    const two = await person('OS-203', 'Tia Example', 'tia.os@example.test');
    const twoA = await sell({ productCode: 'unlim1', name: two.name, email: two.email, requestId: 'os-tia-1' });
    const twoB = await sell({ productCode: 'unlim1', name: two.name, email: two.email, requestId: 'os-tia-2', confirmRepeat: true });
    const fourZero = [5, 6, 7, 8].map(k => ({ rezervId: `OS-T${k}`, memberRezervId: 'OS-203', date: `${dmy(today)} 07:0${k}`, amount: 0,
      item: '1 Month unlimited', method: 'Free' }));
    const two1 = await imp('payments', fourZero);
    const twoRows = (await pool.query(`SELECT o.status, t.refno::text AS of FROM bkk_orders o LEFT JOIN bkk_orders t ON t.id=o.twin_of
      WHERE o.source_ref = ANY($1) ORDER BY o.source_ref`, [fourZero.map(r => r.rezervId)])).rows;
    ok('2 aybkk.net sales and 4 ฿0 Rezerv lines: exactly 2 twins, one for each sale, the other 2 stay',
       twoB.status === 200 && twoRows.filter(r => r.status === 'twin').length === 2 && twoRows.filter(r => r.status === 'paid').length === 2
       && [...new Set(twoRows.filter(r => r.of).map(r => r.of))].sort().join() === [twoA.body.order.refno, twoB.body.order.refno].sort().join(),
       JSON.stringify(twoRows));
    ok('...and importing them again matches all 4', (await imp('payments', fourZero)).body.matched === 4);
    // One Rezerv payment from a file with Rezerv's id, then again from one without it.
    const rr = await imp('payments', [{ memberRezervId: 'OS-201', date: `${dmy(addDay(today, -30))} 10:00`, amount: 1605, item: 'Drop-in', method: 'CARD' }]);
    const rr0 = await q1(`SELECT count(*)::int AS n FROM bkk_orders WHERE member_id=$1 AND source='rezerv'`, [mt.id]);
    const rr2 = await imp('payments', [{ rezervId: 'OS-T9', memberRezervId: 'OS-201', date: `${dmy(addDay(today, -30))} 10:00`, amount: 1605,
      item: 'drop-in', method: 'CARD' }]);
    ok('one Rezerv payment from a file without its id and again with it: already there (rezervTwin), not added twice',
       rr.body.added === 1 && rr2.body.matched === 1 && rr2.body.added === 0 && rr2.body.warnings.some(w => w.code === 'rezervTwin')
       && (await q1(`SELECT count(*)::int AS n FROM bkk_orders WHERE member_id=$1 AND source='rezerv'`, [mt.id])).n === rr0.n, JSON.stringify(rr2.body));

    // ── and the pass it copies ──
    const ps = await person('OS-300', 'Uma Example', 'uma.os@example.test');
    const psSale = await sell({ productCode: 'unlim3', name: ps.name, email: ps.email, requestId: 'os-uma-1' });
    const psPass = { rezervId: 'OS-M1', memberRezervId: 'OS-300', plan: '3 months Unlimited', status: 'Active',
      start: dmy(addDay(today, -1)), until: dmy(addDay(today, 88)) };
    const ps1 = await imp('passes', [psPass]);
    const psRows = async () => (await pool.query(`SELECT p.id, p.status, p.source, p.order_id, p.note, p.twin_of FROM bkk_passes p
      WHERE p.member_id=$1 ORDER BY p.id`, [ps.id])).rows;
    const pr1 = await psRows(), orderPass = pr1.find(p => p.order_id);
    const rzPass = pr1.find(p => p.source === 'rezerv');
    ok('a desk sale and the Rezerv membership for it: 1 live pass (the sale\'s) and 1 void Rezerv pass that says why, and a person is asked',
       ps1.body.added === 1 && pr1.length === 2 && orderPass.status === 'active' && rzPass.status === 'void' && rzPass.twin_of === orderPass.id
       && rzPass.note.startsWith(`voided: same sale as aybkk.net ref ${psSale.body.order.refno}`)
       && ps1.body.warnings.some(w => w.code === 'twinPass' && w.vals[0] === psSale.body.order.refno), JSON.stringify([ps1.body, pr1]));
    const ps2 = await imp('passes', [psPass]);
    ok('...importing it again keeps it void', ps2.body.matched === 1 && (await psRows()).find(p => p.source === 'rezerv').status === 'void',
       JSON.stringify(ps2.body));
    const book = await post('/api/bkk/bookings', { memberCode: ps.code, slotId: cl.slotId, date: cl.date }, ADMIN);
    const bookRow = await q1(`SELECT pass_id FROM bkk_bookings WHERE member_id=$1 AND status='booked' ORDER BY id DESC LIMIT 1`, [ps.id]);
    ok('...and a booking uses the pass of the sale', book.status === 200 && bookRow.pass_id === orderPass.id, JSON.stringify([book.body, bookRow]));
    const ps3 = await imp('passes', [{ rezervId: 'OS-M2', memberRezervId: 'OS-300', plan: '3 months Unlimited', status: 'Active',
      start: dmy(addDay(today, 89)), until: dmy(addDay(today, 178)) }]);
    const bonus = (await psRows()).find(p => p.source === 'rezerv' && p.id !== rzPass.id) || {};
    ok('a promo bonus pass from Rezerv for the same sale is no twin: it stays live', ps3.body.added === 1 && bonus.status === 'active'
       && !ps3.body.warnings.some(w => w.code === 'twinPass'), JSON.stringify([ps3.body, bonus]));

    // ── what is already in the data: a list first, then only what a rule settles ──
    const mk = async (rz, name) => person(rz, name, `${name.split(' ')[0].toLowerCase()}.dbl@example.test`);
    const pa = await mk('OS-400', 'Vic Example'), pb = await mk('OS-401', 'Wen Example'), pc = await mk('OS-402', 'Xia Example');
    const pd1 = await mk('OS-403', 'Yan Example'), pd2 = await mk('OS-404', 'Zoe Example'), pd3 = await mk('OS-405', 'Abe Example');
    const sa = await sell({ productCode: 'unlim1', name: pa.name, email: pa.email, requestId: 'os-dbl-a' });
    const prodId = async code => (await q1('SELECT id FROM bkk_products WHERE code=$1', [code])).id;
    const plant = (m, ref, amount, item, at, code) => pool.query(`INSERT INTO bkk_orders (refno,product_id,member_id,base_thb,fee_thb,vat_thb,amount_thb,
        status,gateway_note,verified_at,created_at,method,item_name,source,source_ref)
      VALUES ($1,$2,$3,$4,0,0,$4,'paid','moved from Rezerv',$5,$5,'other',$6,'rezerv',$7) RETURNING id, refno::text`,
      [String(800000000000 + Math.floor(Math.random() * 99999999)), code, m.id, amount, at, item, ref]).then(r => r.rows[0]);
    const aCopy = await plant(pa, 'OS-D1', 0, '1 Month unlimited', new Date().toISOString(), await prodId('unlim1'));
    const bAt = new Date(Date.now() - 5 * 86400e3).toISOString();
    const bFirst = await plant(pb, 'TRX_9001', 1605, 'Drop-in', bAt, await prodId('dropin'));
    const bCopy = await plant(pb, 'h:0123456789abcdef01234567', 1605, 'Drop-in', bAt, await prodId('dropin'));
    const bReal2 = await plant(pb, 'TRX_9002', 1605, 'Drop-in', bAt, await prodId('dropin'));
    const scSale = await sell({ productCode: 'unlim3', name: pc.name, email: pc.email, requestId: 'os-dbl-c' });
    const cRz = (await pool.query(`INSERT INTO bkk_passes (member_id,product_id,kind,daily_cap,valid_days,valid_from,valid_until,note,source,source_ref)
      VALUES ($1,$2,'unlimited',2,90,$3,$4,'moved from Rezerv','rezerv','OS-DM1') RETURNING id`,
      [pc.id, await prodId('unlim3'), today, addDay(today, 89)])).rows[0];
    await pool.query(`INSERT INTO bkk_bookings (slot_id,class_date,start_at,member_id,pass_id,status,cover,source)
      VALUES ($1,$2,$3,$4,$5,'booked','pass','staff')`, [cl2.slotId, cl2.date, cl2.startAt, pc.id, cRz.id]);
    const d1a = await sell({ productCode: 'pack8', name: pd1.name, email: pd1.email, requestId: 'os-dbl-d1a' });
    const d1b = await sell({ productCode: 'pack8', name: pd1.name, email: pd1.email, requestId: 'os-dbl-d1b', confirmRepeat: true });
    const d2Desk = await sell({ productCode: 'unlim1', name: pd2.name, email: pd2.email, requestId: 'os-dbl-d2' });
    const d2Try = await post('/api/bkk/orders', { productCode: 'unlim1', name: pd2.name, email: pd2.email });
    await post(`/api/bkk/admin/orders/${d2Try.body.order.id}/force-activate`, { confirm: true }, ADMIN);
    const d3Web = await post('/api/bkk/orders', { productCode: 'unlim1', name: pd3.name, email: pd3.email });
    await pool.query(`UPDATE bkk_orders SET status='paid', verified_at=now() - interval '1 day', created_at=now() - interval '1 day',
      gateway_note='confirmed' WHERE id=$1`, [d3Web.body.order.id]);
    const d3Desk = await sell({ productCode: 'unlim1', name: pd3.name, email: pd3.email, requestId: 'os-dbl-d3', confirmRepeat: true });
    const mine = new Set([pa, pb, pc, pd1, pd2, pd3].map(m => m.code));
    const look = async () => ((await J('/api/bkk/admin/doubles', { headers: ADMIN })).body.items || []).filter(x => mine.has(x.member.code));
    const L1 = await look(), L1b = await look();
    const kinds = L => L.map(x => `${x.kind}:${x.member.code}`).sort().join();
    const want = [`a:${pa.code}`, `b:${pb.code}`, `c:${pc.code}`, `d:${pd1.code}`, `d:${pd2.code}`, `d:${pd3.code}`].sort().join();
    const it = k => L1.find(x => x.kind === k) || {};
    ok('the doubles list shows exactly the planted pairs, one of each kind and three of kind d, with the same ids each time',
       kinds(L1) === want && L1.map(x => x.id).join() === L1b.map(x => x.id).join() && L1.every(x => x.reason && x.apply), kinds(L1));
    ok('...a: the ฿0 Rezerv line and the sale it copies; b: the copy from the second file, never the second real payment',
       it('a').orders[0].id === aCopy.id && it('a').orders[1].refno === sa.body.order.refno
       && it('b').orders[0].id === bCopy.id && it('b').orders[1].id === bFirst.id && !L1.some(x => x.orders && x.orders[0].id === bReal2.id),
       JSON.stringify([it('a').orders, it('b').orders]));
    ok('...c: both passes, with the class booked ahead on the Rezerv one; d: desk twice, by hand next to paid, online and desk',
       it('c').passes.length === 2 && it('c').passes[0].source === 'rezerv' && it('c').passes[0].bookingsAhead === 1
       && it('c').reason.includes(scSale.body.order.refno)
       && L1.filter(x => x.kind === 'd').map(x => x.reason.split(': ')[1]).sort().join('|')
         === ['one was activated by hand next to a paid order.', 'paid online and sold at the desk within 72 hours.',
           'sold at the desk twice within 30 minutes.'].join('|')
       && !!d1a.body.order && !!d1b.body.order && !!d2Desk.body.order && !!d3Desk.body.order, JSON.stringify([it('c'), L1.filter(x => x.kind === 'd').map(x => x.reason)]));
    const snap = async () => JSON.stringify((await pool.query(`SELECT id, status, twin_of, gateway_note FROM bkk_orders WHERE member_id = ANY($1) ORDER BY id`,
      [[pa, pb, pc, pd1, pd2, pd3].map(m => m.id)])).rows) + JSON.stringify((await pool.query(`SELECT id, status, note FROM bkk_passes
      WHERE member_id = ANY($1) ORDER BY id`, [[pa, pb, pc, pd1, pd2, pd3].map(m => m.id)])).rows);
    const ap1 = await post('/api/bkk/admin/doubles/apply', { ids: L1.map(x => x.id) }, ADMIN);
    const aRow = await q1('SELECT status, twin_of, gateway_note FROM bkk_orders WHERE id=$1', [aCopy.id]);
    const bRow = await q1('SELECT status, gateway_note FROM bkk_orders WHERE id=$1', [bCopy.id]);
    ok('apply changes only a and b: the ฿0 line becomes the twin, the copy from the second file becomes void with the note',
       ap1.status === 200 && ap1.body.applied.map(x => x.kind).sort().join() === 'a,b' && ap1.body.skipped.length === 4
       && aRow.status === 'twin' && aRow.twin_of === (await ord(sa.body.order.refno)).id
       && bRow.status === 'void' && bRow.gateway_note.startsWith(`same Rezerv payment as order ${bFirst.refno}, imported twice`)
       && (await q1('SELECT status FROM bkk_orders WHERE id=$1', [bFirst.id])).status === 'paid'
       && (await q1('SELECT status FROM bkk_orders WHERE id=$1', [bReal2.id])).status === 'paid', JSON.stringify([ap1.body, aRow, bRow]));
    const s0 = await snap();
    const ap2 = await post('/api/bkk/admin/doubles/apply', { ids: L1.map(x => x.id) }, ADMIN);
    ok('...applying again changes nothing', ap2.status === 200 && ap2.body.applied.length === 0 && (await snap()) === s0, JSON.stringify(ap2.body));
    ok('...c and d are never applied: both passes live, every order still paid, and they are still listed',
       (await q1(`SELECT count(*)::int AS n FROM bkk_passes WHERE member_id=$1 AND status='active'`, [pc.id])).n === 2
       && (await q1(`SELECT count(*)::int AS n FROM bkk_orders WHERE member_id = ANY($1) AND status='paid'`, [[pd1.id, pd2.id, pd3.id]])).n === 6
       && kinds(await look()) === [`c:${pc.code}`, `d:${pd1.code}`, `d:${pd2.code}`, `d:${pd3.code}`].sort().join()
       && (await post('/api/bkk/admin/doubles/apply', { ids: 'all' }, ADMIN)).status === 400
       && (await J('/api/bkk/admin/doubles')).status === 401, kinds(await look()));
    const paH = await hist(pa.code), pbH = await hist(pb.code);
    ok('...and a twin or void row is no money: one payment on the profile with the copy, the two real ones on the other',
       paH.summary.payments === 1 && paH.summary.totalPaid === (await ord(sa.body.order.refno)).amount_thb
       && pbH.summary.payments === 2 && pbH.summary.totalPaid === 3210, JSON.stringify([paH.summary, pbH.summary]));

    // ── a person voids an aybkk.net order they checked ──
    const vo = { name: 'Bea Example', email: 'bea.os@example.test' };
    const vA = await sell({ productCode: 'pack8', ...vo, requestId: 'os-void-1' });
    const vB = await sell({ productCode: 'pack8', ...vo, requestId: 'os-void-2', confirmRepeat: true });
    const r0 = await report(today);
    const cash0 = (((await J('/api/bkk/admin/today', { headers: ADMIN })).body.money || []).find(m => m.method === 'cash') || {}).total || 0;
    const vB0 = await ord(vB.body.order.refno);
    ok('voiding needs a reason', (await post(`/api/bkk/admin/orders/${vB0.id}/void`, {}, ADMIN)).status === 400);
    const v1 = await post(`/api/bkk/admin/orders/${vB0.id}/void`, { reason: 'recorded twice, one slip in the bank' }, ADMIN);
    const r1 = await report(today);
    const cash1 = (((await J('/api/bkk/admin/today', { headers: ADMIN })).body.money || []).find(m => m.method === 'cash') || {}).total || 0;
    const vRow = await ord(vB.body.order.refno);
    const vPass = await q1('SELECT status FROM bkk_passes WHERE order_id=$1', [vB0.id]);
    ok('a void order: "Void:" and the reason, its unused pass voided, and Reports and Money in today lower by its amount and by one sale',
       v1.status === 200 && vRow.status === 'void' && vRow.gateway_note.startsWith(`Void: recorded twice, one slip in the bank (by staff, ${today})`)
       && vPass.status === 'void' && r1.money.total === r0.money.total - vB0.amount_thb && r1.money.count === r0.money.count - 1
       && r1.passes.sold === r0.passes.sold - 1 && cash1 === cash0 - vB0.amount_thb, JSON.stringify([v1.body, r0.money.total, r1.money.total, cash0, cash1]));
    ok('...voiding it again changes nothing', (await post(`/api/bkk/admin/orders/${vB0.id}/void`, { reason: 'again' }, ADMIN)).body.already === true
       && (await ord(vB.body.order.refno)).gateway_note === vRow.gateway_note);
    const vA0 = await ord(vA.body.order.refno);
    await post('/api/bkk/bookings', { memberCode: vA.body.member.code, slotId: cl2.slotId, date: cl2.date }, ADMIN);
    const v2 = await post(`/api/bkk/admin/orders/${vA0.id}/void`, { reason: 'test' }, ADMIN);
    ok('an order whose pass has a class booked on it is not voided: 409, and nothing changes',
       v2.status === 409 && v2.body.classUsed === true && (await ord(vA.body.order.refno)).status === 'paid'
       && (await q1('SELECT status FROM bkk_passes WHERE order_id=$1', [vA0.id])).status === 'active', JSON.stringify(v2.body));
    ok('a Rezerv line is never voided here: the doubles check does that',
       (await post(`/api/bkk/admin/orders/${twRow.id}/void`, { reason: 'test' }, ADMIN)).status === 409
       && (await post(`/api/bkk/admin/orders/${twRow.id}/void`, { reason: 'test' })).status === 401);
    const beaH = await hist(vA.body.member.code);
    ok('...and the profile leaves the void order out of what was paid', beaH.summary.payments === 1 && beaH.summary.totalPaid === vA0.amount_thb,
       JSON.stringify(beaH.summary));

    // ── review fixes (15 Nov 2026) ──
    // A void is final: the public payment check, the postback and Activate never bring it back.
    const stubApp = express(); stubApp.use(express.json());
    let stubAns = null, stubAsked = 0;
    stubApp.post('/order/orderdetailpost', (req, res) => { stubAsked++; return stubAns ? res.json([stubAns]) : res.send(''); });
    const stubSrv = stubApp.listen(0, '127.0.0.1');
    await new Promise(r => stubSrv.once('listening', r));
    const gwEnv = { PAYSO_MERCHANT_ID: '000000012345', PAYSO_SECRET_KEY: 'test-only', PAYSO_API_KEY: 'test-only',
      PAYSO_INQUIRY_BASE: `http://127.0.0.1:${stubSrv.address().port}` };
    Object.assign(process.env, gwEnv);
    try {
      const gw1 = await post('/api/bkk/orders', { productCode: 'unlim1', name: 'Vera Example', email: 'vera.os@example.test' });
      stubAns = { Status: 'CP', Total: gw1.body.order.amount };
      const gwPaid = (await J('/api/bkk/pay/check/' + gw1.body.order.refno)).body;
      const gwId = (await ord(gw1.body.order.refno)).id;
      const gwVoid = await post(`/api/bkk/admin/orders/${gwId}/void`, { reason: 'paid twice, one sent back' }, ADMIN);
      const gwRep0 = await report(today);
      // The postback answers first and then runs the same verify as the public
      // check, so the check (which answers after its verify) shows what the
      // postback does: a void order is never asked about at the gateway.
      const asked0 = stubAsked;
      const gwChk = (await J('/api/bkk/pay/check/' + gw1.body.order.refno)).body;
      const gwAsked = stubAsked - asked0;
      await post('/api/bkk/pay/postback', { refno: String(gw1.body.order.refno) });
      const gwFa = await post(`/api/bkk/admin/orders/${gwId}/force-activate`, { confirm: true }, ADMIN);
      const gwRow = await ord(gw1.body.order.refno), gwRep1 = await report(today);
      const gwLive = (await q1(`SELECT count(*)::int AS n FROM bkk_passes WHERE order_id=$1 AND status <> 'void'`, [gwId])).n;
      ok('a void online order stays void: the public check, the postback and Activate (409) never make it paid or give a pass',
         gwPaid.status === 'paid' && gwVoid.status === 200 && gwChk.status === 'void' && gwAsked === 0 && gwFa.status === 409 && gwRow.status === 'void'
         && gwRow.gateway_note.startsWith('Void: paid twice, one sent back') && gwLive === 0
         && gwRep1.money.total === gwRep0.money.total && gwRep1.money.count === gwRep0.money.count, JSON.stringify([gwChk, gwFa.body, gwRow.gateway_note]));
      stubAns = null;
      await J('/api/bkk/pay/check/' + vB.body.order.refno);
      ok('...and a void desk sale keeps its "Void:" note when the public check asks about it',
         (await ord(vB.body.order.refno)).gateway_note === vRow.gateway_note);
    } finally {
      for (const k of Object.keys(gwEnv)) delete process.env[k];
      stubSrv.close();
    }

    // Many desk sales at once never use up the database pool.
    const many = await Promise.all(Array.from({ length: 12 }, (_, i) => sell({ productCode: 'dropin', name: `Pool Example ${i}`,
      email: `pool${i}.os@example.test` }, { requestId: `os-pool-${i}` })));
    const after12 = await J('/api/bkk/products');
    ok('12 desk sales at once, each with its own id: all sold, and the rest of the app still answers',
       many.every(r => r.status === 200 && r.body.order) && after12.status === 200, JSON.stringify(many.map(r => r.status)));

    // Doubles b is one to one, and a different time is a different payment.
    const pe = await mk('OS-410', 'Eve Example');
    const eAt = '2026-11-10T09:00:00+07:00';
    const eHash = await plant(pe, 'h:aaaaaaaaaaaaaaaaaaaaaaaa', 1605, 'Drop-in', eAt, await prodId('dropin'));
    const eId1 = await plant(pe, 'TRX_5001', 1605, 'Drop-in', eAt, await prodId('dropin'));
    const eId2 = await plant(pe, 'TRX_5002', 1605, 'Drop-in', eAt, await prodId('dropin'));
    const eLate = await plant(pe, 'h:bbbbbbbbbbbbbbbbbbbbbbbb', 1605, 'Drop-in', '2026-11-10T18:00:00+07:00', await prodId('dropin'));
    const eList = ((await J('/api/bkk/admin/doubles', { headers: ADMIN })).body.items || []).filter(x => x.member.code === pe.code);
    ok('a hash row and two Rezerv ids of the same payment shape: one copy, never both ids against one row; 18:00 is another payment',
       eList.length === 1 && eList[0].kind === 'b' && eList[0].orders[1].id === eHash.id && eList[0].orders[0].id === eId1.id
       && !eList.some(x => x.orders[0].id === eLate.id || x.orders[0].id === eId2.id) && /09:00/.test(eList[0].reason), JSON.stringify(eList));
    await post('/api/bkk/admin/doubles/apply', { ids: eList.map(x => x.id) }, ADMIN);
    const eH = await hist(pe.code);
    ok('...applied: 3 payments stay on the profile', eH.summary.payments === 3 && eH.summary.totalPaid === 3 * 1605, JSON.stringify(eH.summary));

    // The import's copy check is one to one too, and keeps the time.
    const pf = await person('OS-411', 'Fia Example', 'fia.os@example.test');
    const fA = await imp('payments', [{ rezervId: 'TRX_7002', memberRezervId: 'OS-411', date: '10/11/2026 10:00', amount: 1605, item: 'Drop-in', method: 'CARD' }]);
    const fLines = [10, 18].map(h => ({ memberRezervId: 'OS-411', date: `10/11/2026 ${h}:00`, amount: 1605, item: 'Drop-in', method: 'CARD' }));
    const fB = await imp('payments', fLines);
    const fB2 = await imp('payments', fLines);
    ok('one Rezerv id at 10:00, then a file without ids at 10:00 and 18:00: the 10:00 line is the copy, the 18:00 one is added',
       fA.body.added === 1 && fB.body.added === 1 && fB.body.matched === 1 && fB.body.warnings.filter(w => w.code === 'rezervTwin').length === 1
       && fB2.body.added === 0 && fB2.body.matched === 2 && (await hist(pf.code)).summary.payments === 2, JSON.stringify([fB.body, fB2.body]));

    // A money line asks a person whatever came before it in the file.
    const pg = await person('OS-412', 'Gia Example', 'gia.os@example.test');
    const gSale = await sell({ productCode: 'unlim3', name: pg.name, email: pg.email, requestId: 'os-gia-1' });
    const gImp = await imp('payments', [
      { rezervId: 'OS-G1', memberRezervId: 'OS-412', date: `${dmy(today)} 07:11`, amount: 0, item: '3 months Unlimited', method: 'Free' },
      { rezervId: 'OS-G2', memberRezervId: 'OS-412', date: `${dmy(today)} 07:10`, amount: 15600, item: '3 months Unlimited', method: 'TRANSFER' }]);
    ok('a ฿0 line first, then a line with money for the same sale: the ฿0 line is the twin and the money line still asks (maybeTwin)',
       gImp.body.added === 2 && gImp.body.warnings.some(w => w.code === 'twinOfAybkk')
       && gImp.body.warnings.some(w => w.code === 'maybeTwin' && w.vals[0] === gSale.body.order.refno), JSON.stringify(gImp.body.warnings));
    const gE = ((await J('/api/bkk/admin/doubles', { headers: ADMIN })).body.items || []).filter(x => x.member.code === pg.code);
    ok('...and the doubles list shows that line for a person to decide (kind e), and never applies it',
       gE.length === 1 && gE[0].kind === 'e' && gE[0].orders[1].refno === gSale.body.order.refno
       && (await post('/api/bkk/admin/doubles/apply', { ids: [gE[0].id] }, ADMIN)).body.applied.length === 0, JSON.stringify(gE));
    const gRz = await q1(`SELECT id FROM bkk_orders WHERE source_ref='OS-G2'`);
    const gNo = await post(`/api/bkk/admin/orders/${gRz.id}/void`, { reason: 'test' }, ADMIN);
    ok('...and the Rezerv line is not voided here, with a reply that names the list', gNo.status === 409 && /kind|\(e\)/.test(gNo.body.error),
       gNo.body.error);

    // Voiding the sale brings back the Rezerv pass that was kept void as its copy, with what was used on it.
    const ph = await person('OS-413', 'Hal Example', 'hal.os@example.test');
    const hSale = await sell({ productCode: 'pack8', name: ph.name, email: ph.email, requestId: 'os-hal-1' });
    const hImp = await imp('passes', [{ rezervId: 'OS-HM1', memberRezervId: 'OS-413', plan: '8 classes / 2 months', status: 'Active',
      start: dmy(today), until: dmy(addDay(today, 59)), classesLeft: 5 }]);
    const hPass = async () => (await pool.query(`SELECT id, status, source, credits_used, to_char(valid_from,'YYYY-MM-DD') AS f, note, twin_of
      FROM bkk_passes WHERE member_id=$1 ORDER BY id`, [ph.id])).rows;
    const h1 = await hPass(), hOrd = h1.find(p => !p.source), hRz = h1.find(p => p.source === 'rezerv');
    ok('the Rezerv copy of a pack: void, and the 3 classes used in Rezerv and its start day go onto the pass kept, said in the warning',
       hRz.status === 'void' && hOrd.status === 'active' && hOrd.credits_used === 3 && hOrd.f === today
       && hImp.body.warnings.some(w => w.code === 'twinPass' && w.vals[1] === 3 && w.vals[3] === today), JSON.stringify([h1, hImp.body.warnings]));
    const hUndo = (await pool.query('SELECT twin_undo FROM bkk_passes WHERE id=$1', [hRz.id])).rows[0].twin_undo;
    ok('...and the copy keeps the day its classes came over (for taking a Rezerv class from the pass later)',
       hUndo.on === today && hUndo.used === 3 && !isNaN(Date.parse(hUndo.at)), JSON.stringify(hUndo));
    const hId = (await ord(hSale.body.order.refno)).id;
    const hV = await post(`/api/bkk/admin/orders/${hId}/void`, { reason: 'the money was taken in Rezerv' }, ADMIN);
    const h2 = await hPass(), hH = await hist(ph.code);
    ok('...voiding the sale: its pass void, the Rezerv pass live again with its own 3 used, and the profile has a pass',
       hV.status === 200 && hV.body.rezervPassBack.length === 1 && h2.find(p => !p.source).status === 'void'
       && h2.find(p => p.source === 'rezerv').status === 'active' && h2.find(p => p.source === 'rezerv').twin_of === null
       && !/voided:/.test(h2.find(p => p.source === 'rezerv').note) && hH.summary.activePass && hH.summary.activePass.creditsLeft === 5,
       JSON.stringify([hV.body, h2, hH.summary.activePass]));
    await imp('passes', [{ rezervId: 'OS-HM1', memberRezervId: 'OS-413', plan: '8 classes / 2 months', status: 'Active',
      start: dmy(today), until: dmy(addDay(today, 59)), classesLeft: 5 }]);
    ok('...importing it again keeps it live', (await hPass()).find(p => p.source === 'rezerv').status === 'active');
    const pi = await person('OS-414', 'Ida Example', 'ida.os@example.test');
    await sell({ productCode: 'unlim3', name: pi.name, email: pi.email, requestId: 'os-ida-1' });
    await imp('passes', [{ rezervId: 'OS-IM1', memberRezervId: 'OS-414', plan: '3 months Unlimited', status: 'Active',
      start: dmy(today), until: dmy(addDay(today, 89)) }]);
    const iOrdPass = await q1(`SELECT id FROM bkk_passes WHERE member_id=$1 AND source IS NULL`, [pi.id]);
    const iV = await post(`/api/bkk/admin/passes/${iOrdPass.id}/void`, { reason: 'test' }, ADMIN);
    ok('...and voiding that pass on the profile does the same', iV.status === 200 && iV.body.rezervPassBack.length === 1
       && (await q1(`SELECT status FROM bkk_passes WHERE member_id=$1 AND source='rezerv'`, [pi.id])).status === 'active', JSON.stringify(iV.body));

    // 8 classes in 1 month in Rezerv, in 2 months here: one package family, so one sale.
    const pj = await person('OS-415', 'Jai Example', 'jai.os@example.test');
    const jSale = await sell({ productCode: 'pack8', name: pj.name, email: pj.email, requestId: 'os-jai-1' });
    const jPass = await imp('passes', [{ rezervId: 'OS-JM1', memberRezervId: 'OS-415', plan: '8 classes / 1 month', status: 'Active',
      start: dmy(today), until: dmy(addDay(today, 29)), classesLeft: 8 }]);
    const jPay = await imp('payments', [{ rezervId: 'OS-J1', memberRezervId: 'OS-415', date: `${dmy(today)} 07:10`, amount: 0,
      item: '8 classes / 1 month', method: 'Free' }]);
    const jList = ((await J('/api/bkk/admin/doubles', { headers: ADMIN })).body.items || []).filter(x => x.member.code === pj.code);
    const jRz = await q1(`SELECT status, twin_of FROM bkk_passes WHERE member_id=$1 AND source='rezerv'`, [pj.id]);
    const jKept = await q1(`SELECT to_char(valid_from,'YYYY-MM-DD') AS f, to_char(valid_until,'YYYY-MM-DD') AS u FROM bkk_passes
      WHERE member_id=$1 AND source IS NULL`, [pj.id]);
    ok('a Rezerv pass and ฿0 line under the other name of a pack sold here: the same sale (twinPass, twinOfAybkk), one live pass, nothing to list',
       jPass.body.warnings.some(w => w.code === 'twinPass' && w.vals[0] === jSale.body.order.refno)
       && jPay.body.warnings.some(w => w.code === 'twinOfAybkk' && w.vals[0] === jSale.body.order.refno)
       && (await q1(`SELECT count(*)::int AS n FROM bkk_passes WHERE member_id=$1 AND status='active'`, [pj.id])).n === 1
       && jRz.status === 'void' && !!jRz.twin_of
       && (await q1(`SELECT status FROM bkk_orders WHERE source_ref='OS-J1'`)).status === 'twin'
       && jList.length === 0, JSON.stringify([jPass.body.warnings, jPay.body.warnings, jList.map(x => x.kind)]));
    ok('...and the pack sold here starts on the Rezerv day but keeps its own 2 months, not the 1 month of the Rezerv name',
       jKept.f === today && jKept.u === addDay(today, 60), JSON.stringify(jKept));
    // A Rezerv payment with money for the package: no copy, so two live passes, and the page is told.
    const pl = await person('OS-417', 'Lia Example', 'lia.os@example.test');
    const lSale = await sell({ productCode: 'unlim3', name: pl.name, email: pl.email, requestId: 'os-lia-1' });
    const lPay = await imp('payments', [{ rezervId: 'OS-L1', memberRezervId: 'OS-417', date: `${dmy(addDay(today, -2))} 07:10`, amount: 15600,
      item: '3 months Unlimited', method: 'TRANSFER' }]);
    const lPass = await imp('passes', [{ rezervId: 'OS-LM1', memberRezervId: 'OS-417', plan: '3 months Unlimited', status: 'Active',
      start: dmy(addDay(today, -2)), until: dmy(addDay(today, 87)) }]);
    const lList = ((await J('/api/bkk/admin/doubles', { headers: ADMIN })).body.items || []).filter(x => x.member.code === pl.code);
    ok('a Rezerv line with money for a package sold here: it asks (maybeTwin), and its pass is no copy: kept live, the line listed (e)',
       lPay.body.warnings.some(w => w.code === 'maybeTwin' && w.vals[0] === lSale.body.order.refno)
       && lPass.body.added === 1 && !lPass.body.skipped.length && !lPass.body.warnings.some(w => w.code === 'twinPass')
       && (await q1(`SELECT count(*)::int AS n FROM bkk_passes WHERE member_id=$1 AND status='active'`, [pl.id])).n === 2
       && lList.map(x => x.kind).sort().join() === 'e', JSON.stringify([lPay.body.warnings, lPass.body, lList.map(x => x.kind)]));
    const lRow = ((await J('/api/bkk/admin/orders?limit=2000', { headers: ADMIN })).body.orders || []).find(o => String(o.refno) === lSale.body.order.refno);
    ok('...and the payments list tells the page that sale has a live Rezerv pass next to it',
       lRow && lRow.rz_pass === true && lRow.product_code === 'unlim3', JSON.stringify(lRow && [lRow.rz_pass, lRow.product_code]));

    // A refund is not a payment: Reports say it on its own.
    const pk = await person('OS-416', 'Kit Example', 'kit.os@example.test');
    const kDay = '2025-03-04';
    await imp('payments', [{ rezervId: 'OS-K1', memberRezervId: 'OS-416', date: `${dmy(kDay)} 09:00`, amount: 1605, item: 'Drop-in',
      method: 'CARD', status: 'Refunded' }]);
    const kRep = await report(kDay);
    const kM = kRep.money.byMethod.find(x => x.total < 0) || {};
    ok('a refund on its own in Reports: no payment counted, 1 refund, the money back', kRep.money.count === 0 && kRep.money.refunds === 1
       && kM.n === 0 && kM.refunds === 1 && kRep.money.total === -1605, JSON.stringify(kRep.money));
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

  console.log('\n— two profiles of one student: merge and undo (15 Nov 2026) —');
  {
    const { outbox } = require('../mailer');
    const one = async (sql, args = []) => (await pool.query(sql, args)).rows[0] || {};
    const imp = (kind, rows) => post(`/api/bkk/admin/import/${kind}`, { rows, dryRun: false }, ADMIN);
    const merge = (keep, body, h = ADMIN) => post(`/api/bkk/admin/members/${keep}/merge`, body, h);
    const unmerge = (code, h = ADMIN) => post(`/api/bkk/admin/members/${code}/unmerge`, {}, h);
    const idOf = async code => (await one('SELECT id FROM bkk_members WHERE code=$1', [code])).id;
    const countOn = async (code) => one(`SELECT
        (SELECT count(*)::int FROM bkk_passes WHERE member_id=m.id) AS passes,
        (SELECT count(*)::int FROM bkk_bookings WHERE member_id=m.id) AS bookings,
        (SELECT count(*)::int FROM bkk_orders WHERE member_id=m.id) AS orders,
        (SELECT count(*)::int FROM bkk_notes WHERE member_id=m.id) AS notes,
        (SELECT count(*)::int FROM bkk_checks WHERE member_id=m.id) AS checks,
        (SELECT count(*)::int FROM bkk_photo_members WHERE member_id=m.id) AS photos,
        (SELECT count(*)::int FROM bkk_login_tokens WHERE member_id=m.id) AS links
      FROM bkk_members m WHERE m.code=$1`, [code]);
    const todayB = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const addD = (d, k) => new Date(Date.parse(d + 'T12:00:00Z') + k * 86400000).toISOString().slice(0, 10);

    // The keeper came in from Rezerv; the double was made on aybkk.net with the
    // student's email, face photo and journal, and a Rezerv id of its own.
    const K = 'BMRGKEEP00001', F = 'BMRGFOLD00001';
    await pool.query(`INSERT INTO bkk_members (code,name,phone,rezerv_id,joined_on,source)
      VALUES ($1,'Mira Merge','081-555-0101','RZ-M1','2026-11-13','rezerv')`, [K]);
    await pool.query(`INSERT INTO bkk_members (code,name,email,phone,rezerv_id,joined_on,lang,journal_id,photo_id,photo_at)
      VALUES ($1,'Mira Merge','mira.merge@example.com','+66 81 555 0101','RZ-M2','2025-01-05','th','bkk-jfold','faces/fold1',now())`, [F]);
    await post('/api/bkk/admin/passes', { memberCode: K, productCode: 'unlim1' }, ADMIN);
    await post('/api/bkk/admin/passes', { memberCode: F, productCode: 'pack8' }, ADMIN);
    const cls = (await J('/api/bkk/schedule?days=14', { headers: ADMIN })).body.classes
      .find(c => !c.isOnline && c.kind !== 'test' && c.seatsLeft > 2 && c.date > todayB);
    const bk = await post('/api/bkk/bookings', { memberCode: K, slotId: cls.slotId, date: cls.date });
    const bf = await post('/api/bkk/bookings', { memberCode: F, slotId: cls.slotId, date: cls.date });
    ok('setup: both profiles booked the same class', bk.status === 200 && bf.status === 200, JSON.stringify([bk.body, bf.body]));
    const fid = await idOf(F), kid = await idOf(K);
    await pool.query(`INSERT INTO bkk_notes (member_id, body) VALUES ($1, 'note on the double')`, [fid]);
    await pool.query(`INSERT INTO bkk_checks (member_id, taken_on, resting_hr) VALUES ($1, $3, 60), ($1, $4, 61), ($2, $3, 62)`,
      [fid, kid, todayB, addD(todayB, -42)]);
    const ph = await one(`INSERT INTO bkk_photos (public_id, class_date) VALUES ('merge/p1', $1) RETURNING id`, [todayB]);
    await pool.query(`INSERT INTO bkk_photo_members (photo_id, member_id) VALUES ($1, $2)`, [ph.id, fid]);
    await post(`/api/bkk/admin/members/${F}/signin-link`, {}, ADMIN);
    await pool.query(`INSERT INTO bkk_orders (refno, member_id, base_thb, amount_thb, status, item_name)
      VALUES (990000000001, $1, 100, 100, 'paid', 'merge test')`, [fid]);
    // A Rezerv visit with no booking id is keyed by a hash that carries the profile it landed on.
    const visit = [{ memberRezervId: 'RZ-M2', name: 'Mira Merge', date: addD(todayB, -3), time: '06:00', className: 'Old Rezerv class', status: 'Attended' }];
    const v1 = await imp('visits', visit);
    ok('setup: a Rezerv visit lands on the double', v1.body.added === 1, JSON.stringify(v1.body));
    const before = await countOn(F);

    ok('merging needs the staff key', (await merge(K, { from: F }, {})).status === 401);
    ok('an unknown profile is a 404', (await merge(K, { from: 'BNOBODY0000000' })).status === 404);
    ok('a profile cannot be merged into itself', (await merge(K, { from: K })).status === 400);
    const dry = await merge(K, { from: F.toLowerCase(), dryRun: true });
    ok('a dry run says what would move', dry.status === 200 && dry.body.dryRun === true && dry.body.moved.passes === 1
       && dry.body.moved.bookings === 2 && dry.body.moved.orders === 1 && dry.body.moved.notes === 1
       && dry.body.moved.photo_members === 1 && dry.body.moved.login_tokens === undefined && dry.body.moved.checks === 1
       && dry.body.seatsCancelled === 1 && dry.body.differs.length === 0, JSON.stringify(dry.body));
    ok('...and changes nothing', JSON.stringify(await countOn(F)) === JSON.stringify(before)
       && !(await one('SELECT merged_into FROM bkk_members WHERE code=$1', [F])).merged_into, JSON.stringify(await countOn(F)));

    const done = await merge(K, { from: F });
    ok('the merge moves passes, classes, payments, notes and photos; sign-in links stay with the code they were made for',
       done.status === 200 && done.body.dryRun === false
       && JSON.stringify(await countOn(F)) === JSON.stringify({ passes: 0, bookings: 0, orders: 0, notes: 0, checks: 1, photos: 0, links: 1 }),
       JSON.stringify([done.body, await countOn(F)]));
    const k1 = await one(`SELECT *, to_char(joined_on,'YYYY-MM-DD') AS joined FROM bkk_members WHERE code=$1`, [K]);
    const f1 = await one('SELECT * FROM bkk_members WHERE code=$1', [F]);
    ok('the kept profile keeps its code, phone and Rezerv id, and takes the email, face, journal, language and first day',
       k1.code === K && k1.phone === '081-555-0101' && k1.rezerv_id === 'RZ-M1' && k1.email === 'mira.merge@example.com'
       && k1.photo_id === 'faces/fold1' && k1.journal_id === 'bkk-jfold' && k1.lang === 'th' && k1.joined === '2025-01-05', JSON.stringify(k1));
    ok('the double stays, empty, pointing at the kept one, with its Rezerv id', f1.merged_into === kid && f1.email === null
       && f1.photo_id === null && f1.journal_id === null && f1.rezerv_id === 'RZ-M2' && f1.merge_log, JSON.stringify(f1));
    const seats = (await pool.query(`SELECT b.status, b.cancel_reason, b.member_id FROM bkk_bookings b
      WHERE b.slot_id=$1 AND b.class_date=$2 AND b.member_id=$3 ORDER BY b.id`, [cls.slotId, cls.date, kid])).rows;
    const pack = await one(`SELECT p.credits_used FROM bkk_passes p JOIN bkk_products pr ON pr.id=p.product_id
      WHERE p.member_id=$1 AND pr.code='pack8'`, [kid]);
    ok('a class booked on both keeps one seat; the other is cancelled and its class goes back on the pass',
       seats.length === 2 && seats.filter(s => s.status === 'booked').length === 1
       && /^merged: same class as booking \d+$/.test(seats.find(s => s.status === 'cancelled').cancel_reason) && pack.credits_used === 0,
       JSON.stringify([seats, pack]));
    ok('a check on a day the kept profile already has stays behind', done.body.left.checks === 1, JSON.stringify(done.body.left));

    const meOld = await J('/api/bkk/me/' + F);
    ok("the double's code opens the kept profile, and the phone keeps its own code (nothing to undo there)", meOld.status === 200
       && meOld.body.movedTo === undefined && meOld.body.member.code === K && meOld.body.passes.length === 2, JSON.stringify(meOld.body).slice(0, 300));
    const chk = await post(`/api/bkk/me/${F}/checks`, { restingHr: 58 });
    ok("...a proof check saved with the double's code lands on the kept profile, and reads back through either code", chk.status === 200
       && (await one(`SELECT member_id FROM bkk_checks WHERE resting_hr=58`)).member_id === kid
       && (await J(`/api/bkk/me/${F}/checks`)).body.checks.some(c => c.restingHr === 58)
       && (await J(`/api/bkk/me/${K}/checks`)).body.checks.some(c => c.restingHr === 58), JSON.stringify(chk.body));
    await pool.query('DELETE FROM bkk_checks WHERE resting_hr=58');
    const otherCls = (await J('/api/bkk/schedule?days=14', { headers: ADMIN })).body.classes
      .find(c => !c.isOnline && c.kind !== 'test' && c.seatsLeft > 2 && c.date > todayB && !(c.slotId === cls.slotId && c.date === cls.date));
    const viaOld = await post('/api/bkk/bookings', { memberCode: F, slotId: otherCls.slotId, date: otherCls.date });
    ok("a booking made with the double's code lands on the kept profile", viaOld.status === 200
       && (await one('SELECT member_id FROM bkk_bookings WHERE id=$1', [viaOld.body.booking.id])).member_id === kid, JSON.stringify(viaOld.body));
    const matOld = await post(`/api/bkk/bookings/${viaOld.body.booking.id}/mat`, { memberCode: F, needMat: true });
    ok("...and the double's code can tick the mat on it (a page left open across the merge)", matOld.status === 200, JSON.stringify(matOld.body));

    const found = (await J('/api/bkk/admin/members?q=mira merge', { headers: ADMIN })).body.members;
    ok('staff search shows one Mira, with the merged code and an undo', found.length === 1 && found[0].code === K
       && found[0].folded.length === 1 && found[0].folded[0].code === F && found[0].merge_log === undefined, JSON.stringify(found));
    ok("...and the double's code finds the kept one", ((await J('/api/bkk/admin/members?q=' + F, { headers: ADMIN })).body.members || [])
      .map(m => m.code).join() === K);
    ok('merging again is refused', (await merge(K, { from: F })).status === 409);

    // Rezerv again, after the merge: nothing comes back twice.
    const m0 = (await one('SELECT count(*)::int AS n FROM bkk_members')).n;
    const again = await imp('members', [{ rezervId: 'RZ-M2', name: 'Mira Merge' }, { rezervId: 'RZ-M1', name: 'Mira Merge' }]);
    ok("importing the double's Rezerv id finds the kept profile: no new student, no warning", again.body.added === 0
       && again.body.matched === 2 && !again.body.warnings.length && (await one('SELECT count(*)::int AS n FROM bkk_members')).n === m0,
       JSON.stringify(again.body));
    const v2 = await imp('visits', visit);
    ok('a Rezerv visit with no booking id that came over before the merge is not added again', v2.body.added === 0
       && v2.body.matched === 1, JSON.stringify(v2.body));
    const byName = await imp('visits', [{ name: 'Mira Merge', date: addD(todayB, -4), time: '06:00', className: 'Old Rezerv class', status: 'Attended' }]);
    ok('a visit found by name alone goes to the kept profile, not "two students with that name"', byName.body.added === 1
       && (await one(`SELECT member_id FROM bkk_bookings WHERE class_date=$1 AND class_title='Old Rezerv class'`, [addD(todayB, -4)])).member_id === kid,
       JSON.stringify(byName.body));

    // Two different emails: maybe two people with one name.
    const K2 = 'BMRGKEEP00002', F2 = 'BMRGFOLD00002';
    await pool.query(`INSERT INTO bkk_members (code,name,email,rezerv_id) VALUES ($1,'Lek Same','lek.one@example.com','RZ-M3'),
      ($2,'Lek Same','lek.two@example.com','RZ-M4')`, [K2, F2]);
    const unsure = await merge(K2, { from: F2 });
    ok('two different emails need sure:true', unsure.status === 409 && unsure.body.needSure === true
       && unsure.body.differs.join() === 'email' && !(await one('SELECT merged_into FROM bkk_members WHERE code=$1', [F2])).merged_into,
       JSON.stringify(unsure.body));
    ok('...a dry run still shows the plan', (await merge(K2, { from: F2, dryRun: true })).body.differs.join() === 'email');
    ok('...and sure:true merges them', (await merge(K2, { from: F2, sure: true })).status === 200);
    ok('the kept profile keeps its own email; the other stays on the double',
       (await one('SELECT email FROM bkk_members WHERE code=$1', [K2])).email === 'lek.one@example.com'
       && (await one('SELECT email FROM bkk_members WHERE code=$1', [F2])).email === 'lek.two@example.com');
    const lekRz = await imp('members', [{ rezervId: 'RZ-M4', name: 'Lek Same', email: 'lek.two@example.com' }]);
    ok("...and Rezerv's row for the double matches the kept profile with no note about a second email or id",
       lekRz.body.matched === 1 && !lekRz.body.warnings.length, JSON.stringify(lekRz.body));
    await pool.query(`UPDATE bkk_login_tokens SET created_at = created_at - interval '2 hours' WHERE created_at > now() - interval '1 hour'`);
    const sent0 = outbox.filter(m => m.tag === 'signin').length;
    await post('/api/bkk/login/request', { email: 'lek.two@example.com' });
    const tok = await one(`SELECT token, member_id FROM bkk_login_tokens WHERE email='lek.two@example.com' ORDER BY created_at DESC LIMIT 1`);
    const mail = outbox.filter(m => m.tag === 'signin').slice(sent0);
    const page = await (await fetch(`${B}/api/bkk/login/${tok.token}`, { method: 'POST' })).text();
    ok("signing in with the double's email: mail to that address, the phone gets the double's code, which opens the kept profile",
       tok.member_id === await idOf(F2) && mail.length === 1 && mail[0].to === 'lek.two@example.com' && page.includes(JSON.stringify(F2))
       && (await J('/api/bkk/me/' + F2)).body.member.code === K2, JSON.stringify([tok.member_id, mail.map(m => m.to)]));
    const byMail = (await J('/api/bkk/admin/members?q=lek.two', { headers: ADMIN })).body.members || [];
    ok("staff search finds the kept profile by the double's email, and the card shows that email", byMail.map(m => m.code).join() === K2
       && byMail[0].folded[0].email === 'lek.two@example.com', JSON.stringify(byMail));
    const K3 = 'BMRGKEEP00003';
    await pool.query(`INSERT INTO bkk_members (code,name) VALUES ($1,'Lek Same')`, [K3]);
    await merge(K3, { from: K2 });
    ok('a profile merged twice: the earlier double now points at the last one',
       (await one('SELECT merged_into FROM bkk_members WHERE code=$1', [F2])).merged_into === await idOf(K3)
       && (await J('/api/bkk/me/' + F2)).body.member.code === K3);
    ok('...undo of the first merge waits for the later one', (await unmerge(F2)).status === 409);
    ok('...undo the later one, then the first', (await unmerge(K2)).status === 200 && (await unmerge(F2)).status === 200
       && (await one('SELECT merged_into FROM bkk_members WHERE code=$1', [F2])).merged_into === null);

    // Undo puts every row and field back.
    ok('undo needs the staff key', (await unmerge(F, {})).status === 401);
    ok('a profile that was never merged has nothing to undo', (await unmerge(K)).status === 409);
    const viaPass = (await one('SELECT pass_id FROM bkk_bookings WHERE id=$1', [viaOld.body.booking.id])).pass_id;
    const viaOnPack = (await one('SELECT product_id FROM bkk_passes WHERE id=$1', [viaPass])).product_id
      === (await one(`SELECT id FROM bkk_products WHERE code='pack8'`)).id;
    const back = await unmerge(F);
    const k2 = await one(`SELECT *, to_char(joined_on,'YYYY-MM-DD') AS joined FROM bkk_members WHERE code=$1`, [K]);
    const f2 = await one('SELECT * FROM bkk_members WHERE code=$1', [F]);
    ok('undo puts back every row that moved', back.status === 200
       && JSON.stringify(await countOn(F)) === JSON.stringify({ ...before, bookings: before.bookings + (viaOnPack ? 1 : 0) }),
       JSON.stringify([back.body, await countOn(F), before, viaOnPack]));
    const via = await one(`SELECT b.member_id AS bm, p.member_id AS pm FROM bkk_bookings b JOIN bkk_passes p ON p.id=b.pass_id WHERE b.id=$1`,
      [viaOld.body.booking.id]);
    ok('...and a class booked since stays with the pass that paid for it', via.bm === via.pm, JSON.stringify(via));
    ok('...and every field', f2.merged_into === null && f2.merge_log === null && f2.email === 'mira.merge@example.com'
       && f2.photo_id === 'faces/fold1' && f2.journal_id === 'bkk-jfold' && f2.lang === 'th'
       && k2.email === null && k2.photo_id === null && k2.journal_id === null && k2.lang === null && k2.joined === '2026-11-13',
       JSON.stringify([f2, k2]));
    const seats2 = (await pool.query(`SELECT status FROM bkk_bookings WHERE slot_id=$1 AND class_date=$2 AND member_id = ANY($3::int[])`,
      [cls.slotId, cls.date, [kid, fid]])).rows;
    const pack2 = await one(`SELECT p.credits_used FROM bkk_passes p JOIN bkk_products pr ON pr.id=p.product_id
      WHERE p.member_id=$1 AND pr.code='pack8'`, [fid]);
    ok('...and the cancelled seat is booked again, its class used again', seats2.length === 2
       && seats2.every(s => s.status === 'booked') && pack2.credits_used === 1, JSON.stringify([seats2, pack2]));
    ok("...and the double's code opens its own profile again", (await J('/api/bkk/me/' + F)).body.member.code === F);

    // Sign out everywhere covers what was merged in: its code, its email, its links.
    const K5 = 'BMRGKEEP00005', F5 = 'BMRGFOLD00005';
    await pool.query(`INSERT INTO bkk_members (code,name,email) VALUES ($1,'Nok Out','nok.one@example.com'), ($2,'Nok Out','nok.two@example.com')`, [K5, F5]);
    await merge(K5, { from: F5, sure: true });
    const f5id = await idOf(F5);
    await pool.query(`INSERT INTO bkk_login_tokens (token,member_id,email,ip,expires_at) VALUES ('mrgtok5',$1,'nok.two@example.com','staff', now() + interval '7 days')`, [f5id]);
    const out1 = await post(`/api/bkk/admin/members/${K5}/signout`, { expectEmail: 'nok.one@example.com', clearEmail: true }, ADMIN);
    ok("signing out a profile asks about every email that opens it, the merged-in one too", out1.status === 409
       && out1.body.email === 'nok.one@example.com, nok.two@example.com', JSON.stringify(out1.body));
    const out2 = await post(`/api/bkk/admin/members/${K5}/signout`, { expectEmail: out1.body.email, clearEmail: true }, ADMIN);
    const f5 = await one('SELECT code, email FROM bkk_members WHERE id=$1', [f5id]);
    await pool.query(`UPDATE bkk_login_tokens SET created_at = created_at - interval '2 hours' WHERE created_at > now() - interval '1 hour'`);
    const n5 = (await one(`SELECT count(*)::int AS n FROM bkk_login_tokens WHERE email='nok.two@example.com'`)).n;
    await post('/api/bkk/login/request', { email: 'nok.two@example.com' });
    ok("...and then the merged-in code, email and links stop opening it as well", out2.status === 200
       && (await J('/api/bkk/me/' + F5)).status === 404 && f5.code !== F5 && f5.email === null
       && (await one(`SELECT expires_at <= now() AS dead FROM bkk_login_tokens WHERE token='mrgtok5'`)).dead === true
       && (await one(`SELECT count(*)::int AS n FROM bkk_login_tokens WHERE email='nok.two@example.com'`)).n === n5,
       JSON.stringify([out2.body, f5]));
    ok('...while undo still works on the new code shown on the card', (await unmerge(f5.code)).status === 200);

    // Undo: newest merge first; a class booked since goes with its pass; what was
    // bought since with the double's email goes back; a seat comes back only if free.
    const K6 = 'BMRGKEEP00006', F6 = 'BMRGFOLD00006', G6 = 'BMRGFOLD00016';
    await pool.query(`INSERT INTO bkk_members (code,name,rezerv_id) VALUES ($1,'Pim Undo','RZ-M6')`, [K6]);
    await pool.query(`INSERT INTO bkk_members (code,name,email) VALUES ($1,'Pim Undo','pim.undo@example.com'), ($2,'Pim Undo',NULL)`, [F6, G6]);
    await post('/api/bkk/admin/passes', { memberCode: F6, productCode: 'pack8' }, ADMIN);
    await merge(K6, { from: F6 });
    await merge(K6, { from: G6 });
    ok('two merges into one profile: the older one cannot be undone first', (await unmerge(F6)).status === 409);
    ok('...the newer one can', (await unmerge(G6)).status === 200);
    const k6id = await idOf(K6), f6id = await idOf(F6);
    const free = (await J('/api/bkk/schedule?days=14', { headers: ADMIN })).body.classes
      .filter(c => !c.isOnline && c.kind !== 'test' && c.seatsLeft > 2 && c.date > todayB);
    const b6 = await post('/api/bkk/bookings', { memberCode: K6, slotId: free[1].slotId, date: free[1].date });
    const buy6 = await post('/api/bkk/orders', { productCode: 'pack8', name: 'Pim Undo', email: 'pim.undo@example.com' });
    const r0 = outbox.filter(m => m.tag === 'receipt').length;
    await post(`/api/bkk/admin/orders/${buy6.body.order.id}/force-activate`, {}, ADMIN);
    await new Promise(r => setTimeout(r, 300));
    const rc = outbox.filter(m => m.tag === 'receipt').slice(r0);
    const o6 = await one('SELECT member_id, mail_to FROM bkk_orders WHERE id=$1', [buy6.body.order.id]);
    const rtok = await one(`SELECT member_id FROM bkk_login_tokens WHERE ip='receipt' ORDER BY created_at DESC LIMIT 1`);
    ok("checkout with an email the merge moved to the kept profile: the pass lands there; the receipt and its link are the double's, whose email it is",
       b6.status === 200 && o6.member_id === k6id && o6.mail_to === 'pim.undo@example.com' && rc.length === 1 && rc[0].to === 'pim.undo@example.com'
       && rtok.member_id === f6id, JSON.stringify([b6.body, o6, rc.map(m => m.to), rtok]));
    const undo6 = await unmerge(F6);
    const b6row = await one('SELECT b.member_id AS bm, p.member_id AS pm FROM bkk_bookings b JOIN bkk_passes p ON p.id=b.pass_id WHERE b.id=$1',
      [b6.body.booking.id]);
    ok('undo: the class booked since on the moved pack goes back with the pack', undo6.status === 200
       && b6row.bm === f6id && b6row.pm === f6id, JSON.stringify([undo6.body, b6row]));
    ok("...and so do the sale made with the double's email and its pass", undo6.body.since.orders === 1
       && (await one('SELECT member_id FROM bkk_orders WHERE id=$1', [buy6.body.order.id])).member_id === f6id
       && (await one('SELECT count(*)::int AS n FROM bkk_passes WHERE order_id=$1 AND member_id=$2', [buy6.body.order.id, f6id])).n === 1,
       JSON.stringify(undo6.body));

    // The same student, two emails: a purchase with the double's email after the merge.
    const K7 = 'BMRGKEEP00007', F7 = 'BMRGFOLD00007';
    await pool.query(`INSERT INTO bkk_members (code,name,email) VALUES ($1,'Joy Two','joy.one@example.com'), ($2,'Joy Two','joy.two@example.com')`, [K7, F7]);
    await merge(K7, { from: F7, sure: true });
    const k7id = await idOf(K7), f7id = await idOf(F7);
    const buy7 = await post('/api/bkk/orders', { productCode: 'pack8', name: 'Joy Two', email: 'joy.two@example.com' });
    const r7 = outbox.filter(m => m.tag === 'receipt').length;
    await post(`/api/bkk/admin/orders/${buy7.body.order.id}/force-activate`, {}, ADMIN);
    await new Promise(r => setTimeout(r, 300));
    const rc7 = outbox.filter(m => m.tag === 'receipt').slice(r7);
    const tok7 = await one(`SELECT member_id FROM bkk_login_tokens WHERE ip='receipt' AND email='joy.two@example.com' ORDER BY created_at DESC LIMIT 1`);
    ok("...the pass goes on the kept profile, the receipt to the address typed, its link signs in as the double",
       (await one('SELECT member_id, mail_to FROM bkk_orders WHERE id=$1', [buy7.body.order.id])).member_id === k7id
       && rc7.length === 1 && rc7[0].to === 'joy.two@example.com' && tok7.member_id === f7id, JSON.stringify([rc7.map(m => m.to), tok7]));
    const undo7 = await unmerge(F7);
    ok('...and an undo takes that sale and its pass back to the double', undo7.status === 200 && undo7.body.since.orders === 1
       && undo7.body.since.passes === 1 && (await one('SELECT member_id FROM bkk_orders WHERE id=$1', [buy7.body.order.id])).member_id === f7id,
       JSON.stringify(undo7.body));

    // A seat the merge cancelled does not come back when its student holds that class again.
    const K8 = 'BMRGKEEP00008', F8 = 'BMRGFOLD00008';
    await pool.query(`INSERT INTO bkk_members (code,name) VALUES ($1,'Ton Seat'), ($2,'Ton Seat')`, [K8, F8]);
    await post('/api/bkk/admin/passes', { memberCode: K8, productCode: 'unlim1' }, ADMIN);
    await post('/api/bkk/admin/passes', { memberCode: F8, productCode: 'unlim1' }, ADMIN);
    const c8 = free[2];
    const k8 = await post('/api/bkk/bookings', { memberCode: K8, slotId: c8.slotId, date: c8.date });
    const f8 = await post('/api/bkk/bookings', { memberCode: F8, slotId: c8.slotId, date: c8.date });
    await pool.query('UPDATE bkk_bookings SET checked_in_at=now() WHERE id=$1', [f8.body.booking.id]);
    const f8pass = (await one('SELECT pass_id FROM bkk_bookings WHERE id=$1', [f8.body.booking.id])).pass_id;
    await merge(K8, { from: F8 });
    const k8st = (await one('SELECT status FROM bkk_bookings WHERE id=$1', [k8.body.booking.id])).status;
    // The double's seat is cancelled and its pass voided since, so the class is booked again on the kept profile's own pass.
    await pool.query(`UPDATE bkk_bookings SET status='cancelled' WHERE id=$1`, [f8.body.booking.id]);
    await pool.query(`UPDATE bkk_passes SET status='void' WHERE id=$1`, [f8pass]);
    const again8 = await post('/api/bkk/bookings', { memberCode: K8, slotId: c8.slotId, date: c8.date });
    const undo8 = await unmerge(F8);
    ok("the checked-in seat is the one kept; after the student books that class again, undo still works and says the seat stayed cancelled",
       k8st === 'cancelled' && again8.status === 200 && undo8.status === 200 && undo8.body.seatsNotBack === 1
       && (await one('SELECT status FROM bkk_bookings WHERE id=$1', [k8.body.booking.id])).status === 'cancelled', JSON.stringify([k8st, again8.body, undo8.body]));
    const cancelOld = await post(`/api/bkk/bookings/${again8.body.booking.id}/cancel`, { memberCode: F8 });
    ok('...and once undone, the double cannot cancel the kept profile\'s class', cancelOld.status === 409, JSON.stringify(cancelOld.body));

    // Rezerv after a merge: the double's own spelling, phone and identical rows still find the student.
    const K9 = 'BMRGKEEP00009', F9 = 'BMRGFOLD00009';
    await pool.query(`INSERT INTO bkk_members (code,name,email,rezerv_id) VALUES ($1,'Fah Keeper','fah.keeper@example.com','RZ-M9')`, [K9]);
    await pool.query(`INSERT INTO bkk_members (code,name,phone,rezerv_id) VALUES ($1,'Fah K','089-555-0909','RZ-M10')`, [F9]);
    const k9id = await idOf(K9);
    const k9orders = async () => (await one(`SELECT count(*)::int AS n FROM bkk_orders WHERE member_id=$1 AND source='rezerv'`, [k9id])).n;
    const d9 = addD(todayB, -6);
    const pay9 = [{ name: 'Fah K', date: d9, amount: '1,605', item: 'Drop-in', status: 'Paid' }];
    const vis9 = [{ memberRezervId: 'RZ-M9', name: 'Fah Keeper', date: d9, time: '06:00', className: 'Twin Class', status: 'Attended' },
      { memberRezervId: 'RZ-M10', name: 'Fah K', date: d9, time: '06:00', className: 'Twin Class', status: 'Attended' }];
    const p9a = await imp('payments', pay9), v9a = await imp('visits', vis9);
    ok('setup: before the merge, the payment by name and the same class on both accounts land on each profile',
       p9a.body.added === 1 && v9a.body.added === 2, JSON.stringify([p9a.body, v9a.body]));
    await merge(K9, { from: F9 });
    const m9 = (await one('SELECT count(*)::int AS n FROM bkk_members')).n, o9 = await k9orders();
    const p9b = await imp('payments', pay9), v9b = await imp('visits', vis9);
    const byPhone = await imp('payments', [{ phone: '0895550909', date: addD(todayB, -5), amount: '1,605', item: 'Drop-in', status: 'Paid' }]);
    ok("after the merge, a payment named only with the double's spelling is found again, not added on a new profile",
       p9b.body.added === 0 && p9b.body.matched === 1 && (await one('SELECT count(*)::int AS n FROM bkk_members')).n === m9, JSON.stringify(p9b.body));
    ok('...the same class on both accounts in one file adds nothing twice', v9b.body.added === 0 && v9b.body.matched === 2, JSON.stringify(v9b.body));
    ok("...and a new payment found by the double's phone lands on the kept profile", byPhone.body.added === 1
       && (await k9orders()) === o9 + 1 && (await one('SELECT count(*)::int AS n FROM bkk_members')).n === m9, JSON.stringify(byPhone.body));
    const win9 = [{ memberRezervId: 'RZ-M10', name: 'Fah K', date: addD(todayB, -4), amount: '1,605', item: 'Drop-in', status: 'Paid' }];
    const w9a = await imp('payments', win9);
    const pass10 = [{ memberRezervId: 'RZ-M10', name: 'Fah K', plan: '1 month unlimited', start: addD(todayB, -4),
      until: addD(todayB, 25), rezervId: 'RZP-M10' }];
    const wp1 = await imp('passes', pass10);
    const u9 = await unmerge(F9);
    const f9id = await idOf(F9);
    const w9b = await imp('payments', win9);
    const wp2 = await imp('passes', pass10);
    ok("Rezerv rows for the double imported while merged go back to it on undo", w9a.body.added === 1 && wp1.body.added === 1
       && u9.body.since.orders >= 1 && u9.body.since.passes === 1
       && (await one(`SELECT member_id FROM bkk_passes WHERE source='rezerv' AND source_ref='RZP-M10'`)).member_id === f9id, JSON.stringify(u9.body));
    ok('...and the next import finds them there: nothing added twice, no id taken by another profile', w9b.body.added === 0
       && w9b.body.matched === 1 && wp2.body.matched === 1 && !wp2.body.skipped.length, JSON.stringify([w9b.body, wp2.body]));

    // A wrong merge where the email moved: what was done with it follows the double back.
    const KA = 'BMRGKEEP00010', FA = 'BMRGFOLD00010';
    await pool.query(`INSERT INTO bkk_members (code,name) VALUES ($1,'Twin Name')`, [KA]);
    await pool.query(`INSERT INTO bkk_members (code,name,email) VALUES ($1,'Twin Name','twin.b@example.com')`, [FA]);
    const faid = await idOf(FA);
    await pool.query(`INSERT INTO bkk_login_tokens (token,member_id,email,ip,expires_at) VALUES ('mrgtokA',$1,'twin.b@example.com','receipt', now() + interval '30 days')`, [faid]);
    await merge(KA, { from: FA });
    await pool.query(`UPDATE bkk_login_tokens SET created_at = created_at - interval '2 hours' WHERE created_at > now() - interval '1 hour'`);
    await post('/api/bkk/login/request', { email: 'twin.b@example.com' });
    const tokA = await one(`SELECT member_id FROM bkk_login_tokens WHERE email='twin.b@example.com' AND ip <> 'receipt' ORDER BY created_at DESC LIMIT 1`);
    const buyA = await post('/api/bkk/orders', { productCode: 'pack8', name: 'Twin Name', email: 'twin.b@example.com', memberCode: FA });
    ok("while merged, a sign-in and a sale with the email the merge moved are the double's; a phone holding the double's code keeps it",
       tokA.member_id === faid && buyA.status === 200 && buyA.body.member.code === FA, JSON.stringify([tokA, buyA.body.member]));
    await post(`/api/bkk/admin/orders/${buyA.body.order.id}/force-activate`, {}, ADMIN);
    const undoA = await unmerge(FA);
    ok("undo: that sale and its pass go back to the double, and the double's code opens its own profile with them", undoA.status === 200
       && undoA.body.since.orders === 1 && undoA.body.since.passes === 1 && (await J('/api/bkk/me/' + FA)).body.passes.length === 1
       && (await J('/api/bkk/me/' + KA)).body.passes.length === 0, JSON.stringify(undoA.body));
    // Changing the kept profile's email stops links made on the double for the old address.
    await merge(KA, { from: FA });
    const chg = await post(`/api/bkk/admin/members/${KA}/email`, { email: 'twin.new@example.com' }, ADMIN);
    ok("changing the kept profile's email also stops the double's links for the old address", chg.status === 200
       && (await one(`SELECT expires_at <= now() AS dead FROM bkk_login_tokens WHERE token='mrgtokA'`)).dead === true, JSON.stringify(chg.body));
    await post('/api/bkk/login/request', { email: 'twin.b@example.com' });
    ok("...and the old address signs in to no one", (await one(`SELECT count(*)::int AS n FROM bkk_login_tokens
      WHERE email='twin.b@example.com' AND expires_at > now()`)).n === 0);

    // A teacher page or staff screen opened before the merge.
    const tk = await post('/api/bkk/admin/teachers', { name: 'Merge Teacher' }, ADMIN);
    const TK = { 'x-teacher-key': tk.body.passcode };
    const note = await post('/api/bkk/teacher/notes', { memberCode: FA, body: 'note from a page opened before the merge' }, TK);
    ok("a teacher note saved with the double's code lands on the kept profile", note.status === 200
       && (await one(`SELECT member_id FROM bkk_notes WHERE body='note from a page opened before the merge'`)).member_id === await idOf(KA),
       JSON.stringify(note.body));
    const tv = await J('/api/bkk/teacher/student/' + FA, { headers: TK });
    const hist = await J(`/api/bkk/admin/members/${FA}/history`, { headers: ADMIN });
    ok("...and the teacher view and staff history opened with it show the kept profile", tv.status === 200 && hist.status === 200
       && JSON.stringify(tv.body).includes('note from a page opened before the merge'), JSON.stringify([tv.status, hist.status]));
    const ph2 = await one(`INSERT INTO bkk_photos (public_id, class_date) VALUES ('merge/p2', $1) RETURNING id`, [todayB]);
    const tagOld = await post(`/api/bkk/teacher/photos/${ph2.id}/tags`, { tags: [{ code: FA, role: 'main' }] }, TK);
    ok("a photo tag with the double's code asks for a reload instead of tagging the empty profile", tagOld.status === 409, JSON.stringify(tagOld.body));
    await unmerge(FA);

    // Two merges: undoing the later one takes the first double's sale with it.
    const KB = 'BMRGKEEP00011', FB = 'BMRGFOLD00011', GB = 'BMRGFOLD00021';
    await pool.query(`INSERT INTO bkk_members (code,name,email) VALUES ($1,'Bee Chain','bee.k@example.com'), ($2,'Bee Chain','bee.f@example.com'),
      ($3,'Bee Chain','bee.g@example.com')`, [KB, FB, GB]);
    await merge(FB, { from: GB, sure: true });
    await merge(KB, { from: FB, sure: true });
    const buyB = await post('/api/bkk/orders', { productCode: 'pack8', name: 'Bee Chain', email: 'bee.g@example.com' });
    const uF = await unmerge(FB), uG = await unmerge(GB);
    ok("a sale made with an earlier double's email follows it back through both undos", uF.status === 200 && uG.status === 200
       && (await one('SELECT member_id FROM bkk_orders WHERE id=$1', [buyB.body.order.id])).member_id === await idOf(GB), JSON.stringify([uF.body, uG.body]));

    // A merge-cancelled seat in a class the shala has cancelled since stays cancelled.
    const KC = 'BMRGKEEP00012', FC = 'BMRGFOLD00012';
    await pool.query(`INSERT INTO bkk_members (code,name) VALUES ($1,'Cee Seat'), ($2,'Cee Seat')`, [KC, FC]);
    await post('/api/bkk/admin/passes', { memberCode: KC, productCode: 'unlim1' }, ADMIN);
    await post('/api/bkk/admin/passes', { memberCode: FC, productCode: 'unlim1' }, ADMIN);
    const cC = free[3];
    await post('/api/bkk/bookings', { memberCode: KC, slotId: cC.slotId, date: cC.date });
    const fC = await post('/api/bkk/bookings', { memberCode: FC, slotId: cC.slotId, date: cC.date });
    await merge(KC, { from: FC });
    await post('/api/bkk/admin/classes/cancel', { slotId: cC.slotId, date: cC.date, reason: 'merge test' }, ADMIN);
    const uC = await unmerge(FC);
    ok('undo does not book a seat back into a class the shala cancelled since', uC.status === 200 && uC.body.seatsNotBack === 1
       && (await one('SELECT status FROM bkk_bookings WHERE id=$1', [fC.body.booking.id])).status === 'cancelled', JSON.stringify(uC.body));
    await post('/api/bkk/admin/classes/reopen', { slotId: cC.slotId, date: cC.date }, ADMIN);

    // Rezerv: a different student with the same name is not the merged one.
    const KD = 'BMRGKEEP00013', FD = 'BMRGFOLD00013';
    await pool.query(`INSERT INTO bkk_members (code,name,rezerv_id) VALUES ($1,'Ploy Dee','RZ-M13')`, [KD]);
    await pool.query(`INSERT INTO bkk_members (code,name,email,phone) VALUES ($1,'Ploy Dee','ploy.one@example.com','081-555-1313')`, [FD]);
    await merge(KD, { from: FD });
    const other13 = await imp('members', [{ rezervId: 'RZ-M14', name: 'Ploy Dee', email: 'ploy.two@example.com' }]);
    ok('a Rezerv student with the same name, another id and another email is somebody new, not the merged student',
       other13.body.added === 1 && (await one(`SELECT count(*)::int AS n FROM bkk_members WHERE rezerv_id='RZ-M14' AND email='ploy.two@example.com'`)).n === 1
       && (await one('SELECT email FROM bkk_members WHERE code=$1', [KD])).email === 'ploy.one@example.com', JSON.stringify(other13.body));

    // Rezerv rows found by a phone the merge moved, and by the double's own phone.
    const KE = 'BMRGKEEP00014', FE = 'BMRGFOLD00014';
    await pool.query(`INSERT INTO bkk_members (code,name,rezerv_id) VALUES ($1,'Eve Phone','RZ-M15')`, [KE]);
    await pool.query(`INSERT INTO bkk_members (code,name,phone) VALUES ($1,'Eve P','086-555-1414')`, [FE]);
    const phoneRow = [{ phone: '0865551414', date: addD(todayB, -7), amount: '1,605', item: 'Drop-in', status: 'Paid' }];
    const pe1 = await imp('payments', phoneRow);
    await merge(KE, { from: FE });
    const pe2 = await imp('payments', phoneRow);
    ok("a phone-only Rezerv payment from before the merge is found again after the phone moved to the kept profile",
       pe1.body.added === 1 && pe2.body.added === 0 && pe2.body.matched === 1, JSON.stringify([pe1.body, pe2.body]));
    const KF = 'BMRGKEEP00015', FF = 'BMRGFOLD00015';
    await pool.query(`INSERT INTO bkk_members (code,name,phone) VALUES ($1,'Fon Two','081-555-1501'), ($2,'Fon Two','089-555-1502')`, [KF, FF]);
    await merge(KF, { from: FF, sure: true });
    const mF = (await one('SELECT count(*)::int AS n FROM bkk_members')).n;
    const pf = await imp('payments', [{ phone: '0895551502', date: addD(todayB, -7), amount: '1,605', item: 'Drop-in', status: 'Paid' }]);
    ok("...and one found by the double's own phone lands on the kept profile, no new student", pf.body.added === 1
       && (await one('SELECT count(*)::int AS n FROM bkk_members')).n === mF
       && (await one(`SELECT member_id FROM bkk_orders WHERE source='rezerv' ORDER BY id DESC LIMIT 1`)).member_id === await idOf(KF),
       JSON.stringify(pf.body));

    // A Rezerv pass staff copied by hand from an aybkk.net sale.
    console.log('\n— a Rezerv copy of an aybkk.net sale is not a second pass —');
    const sale = await post('/api/bkk/admin/sales', { productCode: 'unlim1', name: 'Copy Sale', email: 'copy.sale@example.com', method: 'cash' }, ADMIN);
    ok('setup: a 1-month pass sold at the desk', sale.status === 200, JSON.stringify(sale.body));
    const copy = await imp('passes', [{ name: 'Copy Sale', email: 'copy.sale@example.com', plan: '1 month unlimited',
      start: addD(todayB, 2), until: addD(todayB, 31), rezervId: 'RZP-COPY1' }]);
    const passesOf = async email => (await one(`SELECT count(*)::int AS n FROM bkk_passes p JOIN bkk_members m ON m.id=p.member_id
      WHERE m.email=$1 AND p.status <> 'void'`, [email])).n;
    const twinOf = async ref => (await one(`SELECT p.status, p.twin_of IS NOT NULL AS paired FROM bkk_passes p
      WHERE p.source='rezerv' AND p.source_ref=$1`, [ref]));
    const copyRow = await twinOf('RZP-COPY1');
    ok('a Rezerv pass for the same package, starting within 5 days, with no Rezerv payment: the copy, kept void as the twin of the sale\'s pass',
       copy.body.added === 1 && !copy.body.skipped.length && copy.body.warnings.some(w => w.code === 'twinPass')
       && copyRow.status === 'void' && copyRow.paired && (await passesOf('copy.sale@example.com')) === 1, JSON.stringify([copy.body, copyRow]));
    const later = await imp('passes', [{ name: 'Copy Sale', email: 'copy.sale@example.com', plan: '1 month unlimited',
      start: addD(todayB, 40), until: addD(todayB, 69), rezervId: 'RZP-COPY2' }]);
    ok('...a month later it is a renewal, and comes over', later.body.added === 1, JSON.stringify(later.body));
    await imp('payments', [{ name: 'Copy Sale', email: 'copy.sale@example.com', date: addD(todayB, 1), amount: '10,272',
      item: '1 Month Unlimited', status: 'Paid', rezervId: 'RZPAY-COPY3' }]);
    const paid = await imp('passes', [{ name: 'Copy Sale', email: 'copy.sale@example.com', plan: '1 month unlimited',
      start: addD(todayB, 3), until: addD(todayB, 32), rezervId: 'RZP-COPY3' }]);
    ok('...and one Rezerv was paid for is a real second pass', paid.body.added === 1, JSON.stringify(paid.body));
    const six = await post('/api/bkk/admin/sales', { productCode: 'unlim6m', name: 'Six Copy', email: 'six.copy@example.com', method: 'cash' }, ADMIN);
    const sixCopy = await imp('passes', [{ name: 'Six Copy', email: 'six.copy@example.com', plan: '6 months unlimited',
      start: addD(todayB, 1), until: addD(todayB, 180), rezervId: 'RZP-SIX1' }]);
    ok("Rezerv's name for the same package is the same package: a 6-month copy is its twin too", six.status === 200
       && sixCopy.body.added === 1 && sixCopy.body.warnings.some(w => w.code === 'twinPass') && (await twinOf('RZP-SIX1')).paired
       && (await passesOf('six.copy@example.com')) === 1, JSON.stringify(sixCopy.body));
    await pool.query(`UPDATE bkk_passes p SET valid_from = $2::date FROM bkk_members m
      WHERE m.id=p.member_id AND m.email=$1 AND p.order_id IS NOT NULL`, ['six.copy@example.com', addD(todayB, 30)]);
    const sixLate = await imp('passes', [{ name: 'Six Copy', email: 'six.copy@example.com', plan: '6 months unlimited',
      start: addD(todayB, 3), until: addD(todayB, 182), rezervId: 'RZP-SIX2' }]);
    ok('...and a copy dated near the sale is still a copy when the pass here starts weeks later', sixLate.body.added === 0
       && sixLate.body.skipped.map(x => x.code).join() === 'copyOfSale', JSON.stringify(sixLate.body));
    const dropMember = await one(`INSERT INTO bkk_members (code,name,email) VALUES ('BMRGDROP00001','Drop Credit','drop.credit@example.com') RETURNING id`);
    const dropOrder = await one(`INSERT INTO bkk_orders (refno, product_id, member_id, base_thb, amount_thb, status, verified_at)
      VALUES (990000000077, (SELECT id FROM bkk_products WHERE code='dropin'), $1, 1500, 1500, 'paid', now()) RETURNING id`, [dropMember.id]);
    await pool.query(`INSERT INTO bkk_passes (member_id, product_id, order_id, kind, credits_total, credits_used, valid_days, valid_from, valid_until)
      SELECT $1, id, $2, kind, 1, 1, valid_days, $3::date, $3::date FROM bkk_products WHERE code='dropin'`, [dropMember.id, dropOrder.id, todayB]);
    const credit = await imp('passes', [{ name: 'Drop Credit', email: 'drop.credit@example.com', plan: 'Mysore 5.30am (1st batch) (Refunded credits)',
      start: addD(todayB, 1), until: addD(todayB, 60), classesLeft: '1', rezervId: 'RZP-CREDIT1' }]);
    ok('a class credit Rezerv gives back for a cancelled class is never taken for a copy of a drop-in sold here', credit.body.added === 1,
       JSON.stringify(credit.body));
  }

  console.log('\n:: one copy rule: a Rezerv pass or line next to an aybkk.net sale, and a merge undone ::');
  {
    const q1 = async (sql, args = []) => (await pool.query(sql, args)).rows[0] || {};
    const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
    const addDay = (d, k) => new Date(Date.parse(d + 'T12:00:00Z') + k * 86400000).toISOString().slice(0, 10);
    const dmy = d => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; };
    const imp = (kind, rows) => post(`/api/bkk/admin/import/${kind}`, { rows, dryRun: false }, ADMIN);
    const at = d => `${d}T09:00:00+07:00`;
    let n = 0;
    const who = async (rz, name, email = null) => {
      n++;
      return (await pool.query(`INSERT INTO bkk_members (code,name,email,rezerv_id) VALUES ($1,$2,$3,$4) RETURNING *`,
        [`BONECP${String(n).padStart(6, '0')}`, name, email, rz])).rows[0];
    };
    // A sale here as staff make one: a paid order and its pass. from: the day staff set it to start.
    const sale = async (m, code, paidOn, { from = null, status = 'active' } = {}) => {
      const o = (await pool.query(`INSERT INTO bkk_orders (refno,product_id,member_id,base_thb,amount_thb,status,verified_at,created_at,method)
        SELECT $1, id, $2, price_thb, price_thb, 'paid', $3, $3, 'cash' FROM bkk_products WHERE code=$4 RETURNING id, refno::text AS refno`,
        [700000000000 + Math.floor(Math.random() * 99999999), m.id, at(paidOn), code])).rows[0];
      const p = (await pool.query(`INSERT INTO bkk_passes (member_id,product_id,order_id,kind,credits_total,credits_used,daily_cap,valid_days,
          valid_from,valid_until,status)
        SELECT $1, id, $2, kind, credits, 0, daily_cap, valid_days, $3::date, $3::date + valid_days - 1, $4 FROM bkk_products WHERE code=$5
        RETURNING id`, [m.id, o.id, from, status, code])).rows[0];
      return { ...o, pass: p.id };
    };
    // A Rezerv line as the 13 Nov import stored it, before any copy rule.
    const line = async (m, code, item, amount, day) => (await pool.query(`INSERT INTO bkk_orders (refno,product_id,member_id,base_thb,amount_thb,
        status,gateway_note,verified_at,created_at,method,item_name,source,source_ref)
      VALUES ($1,(SELECT id FROM bkk_products WHERE code=$2),$3,$4,$4,'paid','moved from Rezerv',$5,$5,'other',$6,'rezerv',$7) RETURNING id`,
      [700000000000 + Math.floor(Math.random() * 99999999), code, m.id, amount, at(day), item, `OC-L${++n}`])).rows[0];
    const pass = (rz, plan, start, days, extra = {}) => ({ rezervId: `OC-P${++n}`, memberRezervId: rz, plan, status: 'Active',
      start: dmy(start), until: dmy(addDay(start, days - 1)), ...extra });
    const pay = (rz, item, amount, day, extra = {}) => ({ rezervId: `OC-Y${++n}`, memberRezervId: rz, date: `${dmy(day)} 08:00`, amount,
      item, method: amount ? 'CASH' : 'Free', ...extra });
    const rzPass = ref => q1(`SELECT id, status, twin_of, note FROM bkk_passes WHERE source='rezerv' AND source_ref=$1`, [ref]);
    const rzLine = ref => q1(`SELECT id, status, twin_of, amount_thb FROM bkk_orders WHERE source='rezerv' AND source_ref=$1`, [ref]);
    const live = async m => (await q1(`SELECT count(*)::int AS n FROM bkk_passes WHERE member_id=$1 AND status IN ('active','frozen')`, [m.id])).n;
    const has = (r, code) => (r.body.warnings || []).some(w => w.code === code);

    // Rules 1 and 2: the copy is found by the family and 5 days, kept void as the twin of a live pass here.
    const pA = await who('OC-A', 'Ana Example');
    const sA = await sale(pA, 'unlim3', addDay(today, -4));
    const aRow = pass('OC-A', '3 months Unlimited', today, 90);
    const a1 = await imp('passes', [aRow]);
    const aRz = await rzPass(aRow.rezervId);
    ok('the same package sold here 4 days before the Rezerv pass starts: its twin, void, one live pass, the start day carried',
       a1.body.added === 1 && has(a1, 'twinPass') && aRz.status === 'void' && aRz.twin_of === sA.pass && (await live(pA)) === 1
       && (await q1(`SELECT to_char(valid_from,'YYYY-MM-DD') AS f FROM bkk_passes WHERE id=$1`, [sA.pass])).f === today,
       JSON.stringify([a1.body, aRz]));
    const a2Row = pass('OC-A', '3 months Unlimited', addDay(today, 2), 90);
    const a2 = await imp('passes', [a2Row]);
    ok('...a second copy when that pass is paired already: skipped (copyOfSale), nothing added',
       a2.body.added === 0 && a2.body.skipped.map(x => x.code).join() === 'copyOfSale' && !(await rzPass(a2Row.rezervId)).id
       && (await live(pA)) === 1, JSON.stringify(a2.body));
    const pB = await who('OC-B', 'Ben Example');
    const sB = await sale(pB, 'pack8', addDay(today, -20), { from: addDay(today, 10) });
    const bRow = pass('OC-B', '8 classes / 1 month', addDay(today, 15), 30, { classesLeft: 8 });
    const b1 = await imp('passes', [bRow]);
    ok('the other name of the package (8 classes in 1 month), starting 5 days after the pass here starts, its sale 35 days back: its twin',
       b1.body.added === 1 && has(b1, 'twinPass') && (await rzPass(bRow.rezervId)).twin_of === sB.pass && (await live(pB)) === 1,
       JSON.stringify(b1.body));
    const pB2 = await who('OC-B2', 'Bea Example');
    await sale(pB2, 'pack8', addDay(today, -20), { from: addDay(today, 10) });
    const b2Row = pass('OC-B2', '8 classes / 1 month', addDay(today, 16), 30, { classesLeft: 8 });
    const b2 = await imp('passes', [b2Row]);
    ok('...6 days from the pass start and far from the sale: no copy, it comes over live',
       b2.body.added === 1 && !has(b2, 'twinPass') && !b2.body.skipped.length && (await rzPass(b2Row.rezervId)).status === 'active'
       && (await live(pB2)) === 2, JSON.stringify(b2.body));
    const pD = await who('OC-D', 'Dan Example');
    const sD8 = await sale(pD, 'pack8', today), sD1 = await sale(pD, 'pack8m1', today);
    const d1Row = pass('OC-D', '8 classes / 1 month', today, 30, { classesLeft: 8 });
    const d2Row = pass('OC-D', '8 classes / 2 months', today, 60, { classesLeft: 8 });
    await imp('passes', [d1Row]);
    await imp('passes', [d2Row]);
    ok('two passes of one family here: the same package is paired first, then the other one',
       (await rzPass(d1Row.rezervId)).twin_of === sD1.pass && (await rzPass(d2Row.rezervId)).twin_of === sD8.pass && (await live(pD)) === 2,
       JSON.stringify([await rzPass(d1Row.rezervId), await rzPass(d2Row.rezervId), sD1.pass, sD8.pass]));
    const pN = await who('OC-N', 'Nia Example');
    await sale(pN, 'unlim1', addDay(today, -5));
    const sNnear = await sale(pN, 'unlim1', addDay(today, -1));
    const nRow = pass('OC-N', '1 Month unlimited', today, 30);
    await imp('passes', [nRow]);
    ok('...and among the same package, the nearest sale', (await rzPass(nRow.rezervId)).twin_of === sNnear.pass);
    const pE = await who('OC-E', 'Eli Example');
    await sale(pE, 'unlim1', today, { status: 'void' });
    const eRow = pass('OC-E', '1 Month unlimited', today, 30);
    const e1 = await imp('passes', [eRow]);
    ok('the only pass of that sale is not live (void here): skipped as a copy (copyOfSale)',
       e1.body.added === 0 && e1.body.skipped.map(x => x.code).join() === 'copyOfSale', JSON.stringify(e1.body));
    const pR = await who('OC-R', 'Rio Example');
    const sR = await sale(pR, 'unlim1', today);
    const r1 = await imp('payments', [pay('OC-R', '1 Month unlimited', 9600, addDay(today, -1))]);
    const rRow = pass('OC-R', '1 Month unlimited', today, 30);
    const r2 = await imp('passes', [rRow]);
    ok('Rezerv has a line above ฿0 for the package: that line asks (maybeTwin), the pass is no copy and comes over live',
       has(r1, 'maybeTwin') && r2.body.added === 1 && !has(r2, 'twinPass') && (await rzPass(rRow.rezervId)).status === 'active'
       && (await live(pR)) === 2 && !!sR.pass, JSON.stringify([r1.body.warnings, r2.body]));
    const pC = await who('OC-C', 'Cai Example');
    const sC = await sale(pC, 'dropin', today, { from: today });
    const cRow = pass('OC-C', 'Mysore 5.30am (1st batch) (Refunded credits)', addDay(today, 1), 60, { classesLeft: 1 });
    const c1 = await imp('passes', [cRow]);
    const cLine = pay('OC-C', 'Mysore 5.30am (1st batch) (Refunded credits)', 0, today);
    const c2 = await imp('payments', [cLine]);
    ok('a class credit Rezerv gives back is never a copy: next to a drop-in sold here, its pass stays live and its ฿0 line stays a line',
       c1.body.added === 1 && !has(c1, 'twinPass') && (await rzPass(cRow.rezervId)).status === 'active' && (await live(pC)) === 2
       && (await rzLine(cLine.rezervId)).status === 'paid' && !has(c2, 'twinOfAybkk') && !has(c2, 'maybeTwin') && !!sC.pass,
       JSON.stringify([c1.body, c2.body]));

    // Rule 4: payments take the same family and 5 days.
    const pP = await who('OC-P', 'Pia Example');
    const sP = await sale(pP, 'pack8', today);
    const pZero = pay('OC-P', '8 classes / 1 month', 0, addDay(today, -5)), pMoney = pay('OC-P', '8 classes / 1 month', 7600, addDay(today, -5));
    const pBack = pay('OC-P', '8 classes / 1 month', 7600, today, { status: 'Refunded' });
    const p1 = await imp('payments', [pZero, pMoney, pBack]);
    const [z, mo, bk] = [await rzLine(pZero.rezervId), await rzLine(pMoney.rezervId), await rzLine(pBack.rezervId)];
    ok('a ฿0 Rezerv line of the family 5 days from a sale here: its twin; one with money asks (maybeTwin); a refund never twins',
       p1.body.added === 3 && z.status === 'twin' && z.twin_of === sP.id && mo.status === 'paid' && mo.twin_of === null
       && bk.status === 'refund' && bk.twin_of === null && (p1.body.warnings || []).filter(w => w.code === 'twinOfAybkk').length === 1
       && (p1.body.warnings || []).filter(w => w.code === 'maybeTwin' && w.row === 2).length === 1
       && !(p1.body.warnings || []).some(w => w.row === 3), JSON.stringify([p1.body.warnings, z, mo, bk]));
    const pQ = await who('OC-Q', 'Qin Example');
    await sale(pQ, 'pack8', today);
    const qZero = pay('OC-Q', '8 classes / 2 months', 0, addDay(today, -6));
    const q2 = await imp('payments', [qZero]);
    ok('...6 days away: a plain ฿0 line, no link, no warning', (await rzLine(qZero.rezervId)).status === 'paid'
       && !has(q2, 'twinOfAybkk') && !has(q2, 'maybeTwin'), JSON.stringify(q2.body));

    // Rule 5: the doubles list finds in old data what the import now calls a copy.
    const pDa = await who('OC-DA', 'Dia Example'), pDb = await who('OC-DB', 'Dee Example'), pDc = await who('OC-DC', 'Dot Example');
    const pDd = await who('OC-DD', 'Don Example'), pDe = await who('OC-DE', 'Dev Example'), pDf = await who('OC-DF', 'Doa Example');
    const sDa = await sale(pDa, 'pack8', today);
    const lDa = await line(pDa, 'pack8m1', '8 classes / 1 month', 0, addDay(today, -4));
    await sale(pDb, 'pack8', today);
    await line(pDb, 'pack8m1', '8 classes / 1 month', 0, addDay(today, -6));
    await line(pDb, 'pack8m1', '8 classes / 1 month', 7600, addDay(today, -6));
    const sDc = await sale(pDc, 'pack8', today);
    const lDc = await line(pDc, 'pack8m1', '8 classes / 1 month', 7600, addDay(today, -5));
    const sDd = await sale(pDd, 'pack8', addDay(today, -20), { from: addDay(today, 10) });
    const rDd = (await pool.query(`INSERT INTO bkk_passes (member_id,product_id,kind,credits_total,credits_used,valid_days,valid_from,valid_until,
        note,source,source_ref) SELECT $1, id, kind, credits, 0, valid_days, $2::date, $2::date + 29, 'moved from Rezerv', 'rezerv', 'OC-RDD'
      FROM bkk_products WHERE code='pack8m1' RETURNING id`, [pDd.id, addDay(today, 15)])).rows[0];
    await sale(pDe, 'pack8', addDay(today, -20), { from: addDay(today, 10) });
    await pool.query(`INSERT INTO bkk_passes (member_id,product_id,kind,credits_total,credits_used,valid_days,valid_from,valid_until,
        note,source,source_ref) SELECT $1, id, kind, credits, 0, valid_days, $2::date, $2::date + 29, 'moved from Rezerv', 'rezerv', 'OC-RDE'
      FROM bkk_products WHERE code='pack8m1'`, [pDe.id, addDay(today, 16)]);
    await sale(pDf, 'dropin', today, { from: today });
    await line(pDf, 'dropin', 'Mysore 5.30am (1st batch) (Refunded credits)', 0, today);
    const mineD = new Map([pDa, pDb, pDc, pDd, pDe, pDf].map(m => [m.code, m]));
    const dl = ((await J('/api/bkk/admin/doubles', { headers: ADMIN })).body.items || []).filter(x => mineD.has(x.member.code));
    const kindsOf = m => dl.filter(x => x.member.code === m.code).map(x => x.kind).sort().join();
    ok('the doubles list takes the import\'s family and 5 days: a ฿0 line 4 days off (a), a line with money 5 days off (e), '
       + 'a live pass starting 5 days after the pass here (c); 6 days off or a class credit: nothing',
       kindsOf(pDa) === 'a' && kindsOf(pDb) === '' && kindsOf(pDc) === 'e' && kindsOf(pDd) === 'c' && kindsOf(pDe) === '' && kindsOf(pDf) === ''
       && dl.find(x => x.kind === 'a').orders[0].id === lDa.id && dl.find(x => x.kind === 'a').orders[1].id === sDa.id
       && dl.find(x => x.kind === 'e').orders[0].id === lDc.id && dl.find(x => x.kind === 'e').orders[1].id === sDc.id
       && dl.find(x => x.kind === 'c').passes.map(p => p.id).join() === [rDd.id, sDd.pass].join(), JSON.stringify(dl.map(x => [x.kind, x.member.code])));

    // Merge, then undo, with a twin pair across the two profiles.
    const merge = (keep, body) => post(`/api/bkk/admin/members/${keep}/merge`, body, ADMIN);
    const unmerge = code => post(`/api/bkk/admin/members/${code}/unmerge`, {}, ADMIN);
    const report = async () => (await J(`/api/bkk/admin/report?from=${addDay(today, -30)}&to=${addDay(today, 30)}`, { headers: ADMIN })).body.money;
    const hist = async code => (await J(`/api/bkk/admin/members/${code}/history`, { headers: ADMIN })).body.summary;
    const pK = await who('OC-K', 'Kay Example');
    const pF = await who(null, 'Kay Example', 'kay.oc@example.test');
    const sF = await sale(pF, 'unlim3', today);
    const mg = await merge(pK.code, { from: pF.code });
    const kRow = pass('OC-K', '3 months Unlimited', today, 90), kLine = pay('OC-K', '3 months Unlimited', 0, today);
    const k1 = await imp('passes', [kRow]), k2 = await imp('payments', [kLine]);
    const m0 = await report();
    ok('merged: the Rezerv pass and ฿0 line of the kept profile pair with the sale the double brought (twinPass, twinOfAybkk)',
       mg.status === 200 && has(k1, 'twinPass') && has(k2, 'twinOfAybkk') && (await rzPass(kRow.rezervId)).twin_of === sF.pass
       && (await rzLine(kLine.rezervId)).twin_of === sF.id && (await live(pK)) === 1, JSON.stringify([mg.body, k1.body, k2.body]));
    const un = await unmerge(pF.code);
    const m1 = await report();
    const kPass = await rzPass(kRow.rezervId), kL = await rzLine(kLine.rezervId);
    ok('undo splits the pair: the sale and its pass go back, the Rezerv pass is live again on the kept profile, the ฿0 line is a plain line',
       un.status === 200 && un.body.twinsUndone.passes === 1 && un.body.twinsUndone.orders === 1
       && kPass.status === 'active' && kPass.twin_of === null && /live again/.test(kPass.note) && !/voided:/.test(kPass.note)
       && kL.status === 'paid' && kL.twin_of === null && kL.amount_thb === 0
       && (await live(pK)) === 1 && (await live(pF)) === 1
       && (await q1('SELECT member_id FROM bkk_orders WHERE id=$1', [sF.id])).member_id === pF.id, JSON.stringify([un.body, kPass, kL]));
    ok('...and no money moves or doubles: the totals and counts are the same, one payment on the double, none on the kept profile',
       m1.total === m0.total && m1.count === m0.count && (await hist(pF.code)).payments === 1 && (await hist(pK.code)).payments === 0,
       JSON.stringify([m0.total, m1.total, m0.count, m1.count]));
    const k3 = await imp('passes', [kRow]);
    ok('...importing that pass again leaves it live', k3.body.matched === 1 && (await rzPass(kRow.rezervId)).status === 'active', JSON.stringify(k3.body));
    const pK2 = await who('OC-K2', 'Lee Example'), pF2 = await who('OC-F2', 'Lee Example', 'lee.oc@example.test');
    const sF2 = await sale(pF2, 'unlim1', today);
    const f2Row = pass('OC-F2', '1 Month unlimited', today, 30);
    await imp('passes', [f2Row]);
    await merge(pK2.code, { from: pF2.code });
    const un2 = await unmerge(pF2.code);
    const f2 = await rzPass(f2Row.rezervId);
    ok('a pair made on one profile before the merge goes there and back together, still paired: nothing comes back to life',
       un2.status === 200 && un2.body.twinsUndone.passes === 0 && f2.status === 'void' && f2.twin_of === sF2.pass
       && (await live(pF2)) === 1 && (await live(pK2)) === 0, JSON.stringify([un2.body, f2]));

    // A desk sale typed with the email of a profile merged into another one: the repeat check looks where the sale lands.
    const pK3 = await who(null, 'Moe Example', 'moe.k.oc@example.test'), pF3 = await who(null, 'Moe Example', 'moe.f.oc@example.test');
    await merge(pK3.code, { from: pF3.code, sure: true });
    const desk = id => post('/api/bkk/admin/sales', { productCode: 'unlim1', name: 'Moe Example', email: 'moe.f.oc@example.test', method: 'cash',
      requestId: id }, ADMIN);
    const ds1 = await desk('oc-moe-1'), ds2 = await desk('oc-moe-2');
    ok('a desk sale with the folded email lands on the kept profile, and a second one within 15 minutes answers 409 repeatOf',
       ds1.status === 200 && ds1.body.member.code === pK3.code && ds2.status === 409 && ds2.body.repeatOf.refno === ds1.body.order.refno,
       JSON.stringify([ds1.body, ds2.body]));
    const mUn = await unmerge(pF3.code);
    const ds3 = await desk('oc-moe-3');
    const moeOrd = await q1(`SELECT member_id, mail_to FROM bkk_orders WHERE refno=$1`, [ds1.body.order.refno]);
    ok('...it keeps the email typed (mail_to), so the undo takes that sale and its pass back, and a sale with that email still answers 409 repeatOf',
       mUn.status === 200 && mUn.body.since.orders === 1 && moeOrd.member_id === pF3.id && moeOrd.mail_to === 'moe.f.oc@example.test'
       && (await live(pF3)) === 1 && (await live(pK3)) === 0 && ds3.status === 409 && ds3.body.repeatOf.refno === ds1.body.order.refno,
       JSON.stringify([mUn.body, moeOrd, ds3.body]));
    const pK6 = await who(null, 'Uli Example', 'uli.k.oc@example.test'), pF6 = await who(null, 'Uli Example', 'uli.f.oc@example.test');
    await merge(pK6.code, { from: pF6.code, sure: true });
    const isMoon = d => moonDaysBetween(d, d).size > 0;
    let uDay = addDay(today, 2);
    while (isMoon(uDay)) uDay = addDay(uDay, 1);
    const uSlot = (await q1(`INSERT INTO bkk_class_slots (code,title,kind,weekday,start_time,duration_min,capacity)
      VALUES ('test_oc_uli','Uli Class','test',$1,'10:10',60,5) RETURNING id`, [new Date(uDay + 'T12:00:00Z').getUTCDay()])).id;
    const uw = await post('/api/bkk/admin/walkin', { slotId: uSlot, date: uDay, cover: 'dropin', method: 'cash', checkIn: false,
      name: 'Uli Example', email: 'uli.f.oc@example.test' }, ADMIN);
    const uOrd = await q1(`SELECT member_id, mail_to FROM bkk_orders WHERE refno=$1`, [uw.body.refno]);
    const uUn = await unmerge(pF6.code);
    ok('...and so does a drop-in the door sells with that email',
       uw.status === 200 && uOrd.member_id === pK6.id && uOrd.mail_to === 'uli.f.oc@example.test' && uUn.body.since.orders === 1
       && (await q1(`SELECT member_id FROM bkk_orders WHERE refno=$1`, [uw.body.refno])).member_id === pF6.id, JSON.stringify([uw.body, uOrd, uUn.body]));

    // A copy of another package of the family keeps the length sold here; the same package ends as Rezerv says.
    const pDates = id => q1(`SELECT status, credits_used, to_char(valid_from,'YYYY-MM-DD') AS f, to_char(valid_until,'YYYY-MM-DD') AS u
      FROM bkk_passes WHERE id=$1`, [id]);
    const pY = await who('OC-Y', 'Yui Example');
    const sY = await sale(pY, 'unlim12m', addDay(today, -1));
    const yRow = pass('OC-Y', '1 Year (13 months)', today, 395);
    const y1 = await imp('passes', [yRow]);
    const yKept = await pDates(sY.pass);
    ok('a 13-month Rezerv year paired with 12 months sold here: the pass kept starts on the Rezerv day and runs its own 365 days, said in the warning',
       has(y1, 'twinPass') && (await rzPass(yRow.rezervId)).twin_of === sY.pass && yKept.f === today && yKept.u === addDay(today, 365)
       && y1.body.warnings.some(w => w.code === 'twinPass' && w.vals[3] === today && w.vals[4] === addDay(today, 365)),
       JSON.stringify([y1.body.warnings, yKept]));
    ok('...and a copy of the same package carries Rezerv\'s own end day', (await pDates(sA.pass)).u === addDay(today, 89),
       JSON.stringify(await pDates(sA.pass)));

    // An undo that takes a pair apart takes the carry back off the pass sold here.
    const pK4 = await who('OC-K4', 'Ola Example'), pF4 = await who(null, 'Ola Example', 'ola.oc@example.test');
    const sF4 = await sale(pF4, 'pack8', today);
    await merge(pK4.code, { from: pF4.code });
    const k4Row = pass('OC-K4', '8 classes / 2 months', addDay(today, -3), 60, { classesLeft: 3 });
    const k4 = await imp('passes', [k4Row]);
    const f4Mid = await pDates(sF4.pass);
    const un4 = await unmerge(pF4.code);
    const f4 = await pDates(sF4.pass), k4Rz = await rzPass(k4Row.rezervId);
    const f4Void = await post(`/api/bkk/admin/orders/${sF4.id}/void`, { reason: 'test' }, ADMIN);
    ok('an undo of a merge that paired a pack: the pack sold here gives back the 5 classes and the start day it took, and S9 can void it',
       has(k4, 'twinPass') && f4Mid.credits_used === 5 && f4Mid.f === addDay(today, -3)
       && un4.body.twinsUndone.passes === 1 && f4.credits_used === 0 && f4.f === null && f4.u === null
       && k4Rz.status === 'active' && f4Void.status === 200, JSON.stringify([f4Mid, f4, k4Rz, f4Void.body]));
    const pK5 = await who('OC-K5', 'Pat Example'), pF5 = await who(null, 'Pat Example', 'pat.oc@example.test');
    const sF5 = await sale(pF5, 'pack8', today);
    await merge(pK5.code, { from: pF5.code });
    await imp('passes', [pass('OC-K5', '8 classes / 2 months', addDay(today, -3), 60, { classesLeft: 3 })]);
    await pool.query(`INSERT INTO bkk_bookings (slot_id,class_date,start_at,member_id,pass_id,status)
      VALUES ($1,$2::date,$3::timestamptz,$4,$5,'booked')`, [uSlot, uDay, `${uDay}T10:10:00+07:00`, pK5.id, sF5.pass]);
    await pool.query('UPDATE bkk_passes SET credits_used = credits_used + 1 WHERE id=$1', [sF5.pass]);
    await unmerge(pF5.code);
    const f5 = await pDates(sF5.pass);
    ok('...a class booked on it since stays: 1 used, and the pass starts on that class and runs its own 60 days',
       f5.credits_used === 1 && f5.f === uDay && f5.u === addDay(uDay, 60), JSON.stringify(f5));

    // A ฿0 refund never twins, wherever it sits in the file.
    const pG = await who('OC-G', 'Gia Example');
    const sG = await sale(pG, 'unlim1', today);
    const gBack = pay('OC-G', '1 Month unlimited', 0, today, { status: 'Refunded' }), gZero = pay('OC-G', '1 Month unlimited', 0, addDay(today, -1));
    const g1 = await imp('payments', [gBack, gZero]);
    const gB = await rzLine(gBack.rezervId), gZ = await rzLine(gZero.rezervId);
    ok('a ฿0 line marked Refunded is a refund, never a twin: the paid ฿0 line after it in the file is the twin of the sale',
       gZ.status === 'twin' && gZ.twin_of === sG.id && gB.status === 'refund' && gB.twin_of === null
       && g1.body.warnings.filter(w => w.code === 'twinOfAybkk').map(w => w.row).join() === '2', JSON.stringify([g1.body.warnings, gB, gZ]));

    // The doubles list: one e for each Rezerv line, and no c for what the import keeps as two passes.
    const pV = await who('OC-V', 'Vic Example');
    const sV = await sale(pV, 'unlim1', today);
    const v1 = await imp('payments', [pay('OC-V', '1 Month unlimited', 9600, today), pay('OC-V', '1 Month unlimited', 9600, addDay(today, -2))]);
    const dl2 = (await J('/api/bkk/admin/doubles', { headers: ADMIN })).body.items || [];
    const kinds2 = m => dl2.filter(x => x.member.code === m.code).map(x => x.kind).sort().join();
    ok('two Rezerv lines with money next to one sale: the import asks on each (maybeTwin), and the list has an e for each',
       v1.body.warnings.filter(w => w.code === 'maybeTwin').length === 2 && kinds2(pV) === 'e,e'
       && dl2.filter(x => x.member.code === pV.code).every(x => x.orders[1].id === sV.id), JSON.stringify(dl2.filter(x => x.member.code === pV.code)));
    ok('...a pass Rezerv has a paid line for is no c (the import keeps both; e lists the line), nor is a class credit, marked in its note',
       kinds2(pR) === 'e' && kinds2(pC) === '' && (await rzPass(cRow.rezervId)).note.includes('a class Rezerv gave back'),
       JSON.stringify([kinds2(pR), kinds2(pC), (await rzPass(cRow.rezervId)).note]));

    // Rezerv lists a copy twice, the "Inactive" line first: the live line still makes it the twin.
    const pZ = await who('OC-Z', 'Zoe Example');
    const sZ = await sale(pZ, 'unlim1', today);
    const zRow = pass('OC-Z', '1 Month unlimited', today, 30);
    const z1 = await imp('passes', [{ ...zRow, status: 'Inactive' }, zRow]);
    const zRz = await rzPass(zRow.rezervId);
    const z2 = await imp('passes', [zRow]);
    ok('the "Inactive" copy first, then the live one: kept void as the twin of the sale (twinPass), one live pass, and again nothing changes',
       has(z1, 'twinPass') && z1.body.updated === 1 && zRz.status === 'void' && zRz.twin_of === sZ.pass && /^voided:/.test(zRz.note)
       && (await live(pZ)) === 1 && z2.body.matched === 1 && (await rzPass(zRow.rezervId)).status === 'void', JSON.stringify([z1.body, zRz, z2.body]));

    // One Rezerv payment voided as imported twice while merged is a payment again after the undo.
    const pH = await who('OC-H', 'Hal Example', 'hal.k.oc@example.test'), pH2 = await who(null, 'Hal Example', 'hal.f.oc@example.test');
    const hDay = addDay(today, -3);
    await imp('payments', [{ rezervId: 'OC-HID', memberRezervId: 'OC-H', date: `${dmy(hDay)} 10:15`, amount: 10272, item: '1 Month Unlimited', method: 'CASH' }]);
    await imp('payments', [{ email: 'hal.f.oc@example.test', name: 'Hal Example', date: `${dmy(hDay)} 10:15`, amount: 10272, item: '1 Month Unlimited', method: 'CASH' }]);
    const hm0 = await report();
    await merge(pH.code, { from: pH2.code, sure: true });
    const hb = ((await J('/api/bkk/admin/doubles', { headers: ADMIN })).body.items || []).filter(x => x.member.code === pH.code && x.kind === 'b');
    const hAp = await post('/api/bkk/admin/doubles/apply', { ids: hb.map(x => x.id) }, ADMIN);
    const hm1 = await report();
    const hUn = await unmerge(pH2.code);
    const hm2 = await report();
    ok('a payment voided as imported twice while two profiles were merged is a payment again after the undo: the totals as before',
       hb.length === 1 && hAp.body.applied.length === 1 && hm1.count === hm0.count - 1 && hUn.body.twinsUndone.payments === 1
       && hm2.count === hm0.count && hm2.total === hm0.total
       && (await q1(`SELECT count(*)::int AS n FROM bkk_orders WHERE member_id = ANY($1) AND status='paid'`, [[pH.id, pH2.id]])).n === 2,
       JSON.stringify([hb.length, hAp.body, hm0.count, hm1.count, hm2.count, hUn.body.twinsUndone]));

    // A twin comes back as Rezerv has it: stopped since, it stays void; paused, it comes back paused.
    const pJ = await who('OC-J', 'Jun Example');
    const sJ = await sale(pJ, 'unlim1', today);
    const jRow = pass('OC-J', '1 Month unlimited', today, 30);
    await imp('passes', [jRow]);
    const j2 = await imp('passes', [{ ...jRow, status: 'Cancelled', cancelled: 'Yes' }]);
    const j3 = await imp('passes', [{ ...jRow, status: 'Cancelled', cancelled: 'Yes' }]);
    const jV = await post(`/api/bkk/admin/orders/${sJ.id}/void`, { reason: 'test' }, ADMIN);
    const jRz = await rzPass(jRow.rezervId);
    ok('a twin Rezerv says is cancelled since: the re-import notes it once, and voiding the sale here leaves it void, no longer paired',
       j2.body.updated === 1 && j3.body.matched === 1 && jV.status === 200 && jV.body.rezervPassBack.length === 0
       && jRz.status === 'void' && jRz.twin_of === null && /cancelled in Rezerv/.test(jRz.note) && !/live again/.test(jRz.note)
       && (await live(pJ)) === 0, JSON.stringify([j2.body, jV.body, jRz]));
    const pW = await who('OC-W', 'Wen Example');
    const sW = await sale(pW, 'unlim3', addDay(today, -10), { from: addDay(today, -10) });
    const wRow = pass('OC-W', '3 months Unlimited', addDay(today, -9), 90, { status: 'Frozen',
      frozenFrom: dmy(addDay(today, -2)), frozenUntil: dmy(addDay(today, 12)) });
    const w1 = await imp('passes', [wRow]);
    const wV = await post(`/api/bkk/admin/orders/${sW.id}/void`, { reason: 'test' }, ADMIN);
    const wRz = await q1(`SELECT status, to_char(frozen_from,'YYYY-MM-DD') AS ff FROM bkk_passes WHERE source='rezerv' AND source_ref=$1`, [wRow.rezervId]);
    ok('a twin Rezerv has paused today: the warning says so, and voiding the sale brings it back paused, as Rezerv has it',
       w1.body.warnings.some(w => w.code === 'twinPass' && w.vals[5] === addDay(today, -2)) && wV.status === 200
       && wV.body.rezervPassBack.length === 1 && wRz.status === 'frozen' && wRz.ff === addDay(today, -2), JSON.stringify([w1.body.warnings, wV.body, wRz]));
  }

  console.log('\n-- PaySolutions says "Y Paid" (15 Nov 2026) --');
  {
    const http = require('http');
    const one = async (sql, args = []) => (await pool.query(sql, args)).rows[0] || {};
    let answer = null;
    const stub = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(answer == null ? '' : JSON.stringify(answer)); });
    });
    await new Promise(r => stub.listen(0, '127.0.0.1', r));
    const env = { PAYSO_MERCHANT_ID: '00012345', PAYSO_SECRET_KEY: 'test-only', PAYSO_API_KEY: 'test-only',
      PAYSO_INQUIRY_BASE: `http://127.0.0.1:${stub.address().port}` };
    Object.assign(process.env, env);
    const buy = async n => (await post('/api/bkk/orders', { productCode: 'pack8', name: `Status ${n} Example`, email: `status.${n}@example.com` })).body;
    const state = async refno => one(`SELECT o.status, o.gateway_note, (SELECT count(*)::int FROM bkk_passes p WHERE p.order_id=o.id) AS passes
      FROM bkk_orders o WHERE o.refno=$1`, [refno]);
    const check = async (o, a) => { answer = a; return (await J('/api/bkk/pay/check/' + o.order.refno)).body; };

    const y = await buy('y');
    const yChk = await check(y, [{ ReferenceNo: String(y.order.refno).padStart(12, '0'), Total: y.order.amount, Status: 'Y', StatusName: 'Paid' }]);
    const yRow = await state(y.order.refno);
    ok('"Y Paid" at the right amount is a payment: the order is paid and the pass is made', yChk.status === 'paid'
       && yRow.status === 'paid' && yRow.passes === 1, JSON.stringify([yChk, yRow]));
    const cp = await buy('cp');
    const cpChk = await check(cp, { Total: cp.order.amount, Status: 'CP', StatusName: 'COMPLETE' });
    ok('..."CP COMPLETE" as in the docs still is', cpChk.status === 'paid' && (await state(cp.order.refno)).passes === 1, JSON.stringify(cpChk));
    const wrong = await buy('wrong');
    const wChk = await check(wrong, [{ Total: wrong.order.amount - 1, Status: 'Y', StatusName: 'Paid' }]);
    const wRow = await state(wrong.order.refno);
    ok('...but "Y Paid" for another amount makes no pass: it waits as a mismatch', wChk.status === 'mismatch'
       && wRow.status === 'mismatch' && wRow.passes === 0, JSON.stringify([wChk, wRow]));
    const none = await buy('none');
    const nChk = await check(none, [{ Status: 'Y', StatusName: 'Paid' }]);
    ok('...and "Y Paid" with no amount makes no pass either', nChk.status === 'mismatch' && (await state(none.order.refno)).passes === 0,
       JSON.stringify(nChk));
    const unpaid = await buy('unpaid');
    const uChk = await check(unpaid, [{ Total: unpaid.order.amount, Status: 'N', StatusName: 'Unpaid' }]);
    const uRow = await state(unpaid.order.refno);
    ok('another status is not paid, and the note keeps what PaySolutions said, the amount included', uChk.status === 'pending'
       && uRow.status === 'pending' && uRow.passes === 0 && uRow.gateway_note === `http 200 status=N Unpaid total=${unpaid.order.amount}`,
       JSON.stringify(uRow));
    const empty = await check(unpaid, null);
    ok('...and no answer at all is still "no record"', empty.status === 'pending' && /^no record/.test(empty.note || ''), JSON.stringify(empty));
    const again = await check(y, [{ Total: y.order.amount, Status: 'Y', StatusName: 'Paid' }]);
    ok('asking again about a paid order makes no second pass', again.status === 'paid' && (await state(y.order.refno)).passes === 1,
       JSON.stringify(again));
    Object.keys(env).forEach(k => { delete process.env[k]; });
    stub.close();
  }

  console.log('\n-- payment watch: stuck payments turn on by themselves, pings only for problems, one money line (15 Nov 2026) --');
  {
    const http = require('http');
    const one = async (sql, args = []) => (await pool.query(sql, args)).rows[0] || {};
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const until = async (cond, ms = 3000) => { const end = Date.now() + ms; while (!(await cond()) && Date.now() < end) await wait(20); return cond(); };
    const HOUR = 3600000, MIN = 60000;
    // PaySolutions on 127.0.0.1: an answer per 12-digit ref, a status code, a delay, or no answer at all.
    const asked = [];
    const pay = { code: 200, answers: {}, delay: 0, delays: {}, hang: false };
    const stub = http.createServer((req, res) => {
      let body = ''; req.on('data', c => { body += c; });
      req.on('end', () => {
        let ref = null; try { ref = JSON.parse(body).refno; } catch (_) {}
        asked.push(ref);
        if (pay.hang) return;
        setTimeout(() => {
          const a = pay.answers[ref];
          res.statusCode = pay.code; res.setHeader('Content-Type', 'application/json');
          res.end(a == null ? '' : JSON.stringify(a));
        }, pay.delays[ref] ?? pay.delay);
      });
    });
    // Telegram on 127.0.0.1: every message kept.
    const tg = []; let tgCode = 200;
    const tgStub = http.createServer((req, res) => {
      let body = ''; req.on('data', c => { body += c; });
      req.on('end', () => {
        let j = {}; try { j = JSON.parse(body); } catch (_) {}
        tg.push({ url: req.url, chat: String(j.chat_id), text: String(j.text || ''), preview: j.link_preview_options });
        res.statusCode = tgCode; res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(tgCode === 200 ? { ok: true, result: {} } : { ok: false, error_code: tgCode, description: 'Internal Server Error' }));
      });
    });
    await new Promise(r => stub.listen(0, '127.0.0.1', r));
    await new Promise(r => tgStub.listen(0, '127.0.0.1', r));
    const settingsNow = async () => (await J('/api/bkk/admin/settings', { headers: ADMIN })).body;

    const noKey = await J('/api/bkk/admin/settings');
    const s0 = await settingsNow();
    ok('the settings read needs the staff key; the watch starts on, per-sale pings off, the money line on at 21:00, Telegram not set',
       noKey.status === 401 && JSON.stringify(s0.payWatch) === JSON.stringify({ paySweep: 'on', pingEachSale: 'off', dailyMoney: 'on', dailyMoneyAt: '21:00' })
       && s0.telegram.set === false && s0.telegram.last === null, JSON.stringify(s0));
    // A week on: every order the tests above left is past the 48 hours, so only these are asked.
    let NOW = Date.now() + 7 * 24 * HOUR;
    const sweep = (dt = 0) => watch.paySweep({ now: NOW + dt });
    const off = await sweep();
    const offRoute = await post('/api/bkk/admin/pay/sweep', {}, ADMIN);
    const offNoKey = await post('/api/bkk/admin/pay/sweep', {});
    ok('without the PaySolutions keys the sweep asks nothing (and its route needs the staff key)', off.ran === false
       && off.reason === 'gateway not configured' && offRoute.status === 200 && offRoute.body.ran === false && offNoKey.status === 401
       && asked.length === 0, JSON.stringify([off, offRoute.body]));

    const env = { PAYSO_MERCHANT_ID: '00012345', PAYSO_SECRET_KEY: 'test-only', PAYSO_API_KEY: 'test-only',
      PAYSO_INQUIRY_BASE: `http://127.0.0.1:${stub.address().port}`, TELEGRAM_BOT_TOKEN: 'tg-test-token', BOONCHU_CHAT_ID: '4242',
      TELEGRAM_API_BASE: `http://127.0.0.1:${tgStub.address().port}` };
    Object.assign(process.env, env);
    const prod = code => one('SELECT id, name_en FROM bkk_products WHERE code=$1', [code]);
    const pack8 = await prod('pack8'), drop = await prod('dropin');
    let seq = 0;
    const ago = n => new Date(NOW - n * MIN);
    // An order made up for the watch: age and checked are minutes before NOW.
    async function order({ age, checked = null, status = 'pending', source = null, method = 'online', amount = 2000,
                           name = null, member = null, product = pack8.id, slotId = null, date = null } = {}) {
      seq++;
      const m = member || await one(`INSERT INTO bkk_members (code,name,email) VALUES ($1,$2,$3) RETURNING id, code, name`,
        [`BPWATCH${String(seq).padStart(6, '0')}`, name || `Watch${'abcdefghij'[seq % 10]} Example`, `watch.${seq}@example.com`]);
      const refno = 990700000000 + seq;
      const o = await one(`INSERT INTO bkk_orders (refno,product_id,member_id,base_thb,amount_thb,status,source,method,created_at,checked_at,slot_id,class_date)
        VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [refno, product, m.id, amount, status, source, method, ago(age), checked == null ? null : ago(checked), slotId, date]);
      return { id: o.id, refno: String(refno), r12: String(refno).padStart(12, '0'), amount, member: m };
    }
    const paidAt = (o, amount = o.amount) => { pay.answers[o.r12] = [{ ReferenceNo: o.r12, Total: amount, Status: 'Y', StatusName: 'Paid' }]; };
    const askedOf = o => asked.filter(r => r === o.r12).length;
    const st = o => one(`SELECT o.status, o.gateway_note, o.checked_at,
      (SELECT count(*)::int FROM bkk_passes p WHERE p.order_id=o.id) AS passes FROM bkk_orders o WHERE o.id=$1`, [o.id]);
    const pingsOf = o => tg.filter(m => m.text.includes(`ref ${o.refno}`));

    console.log('  the sweep');
    const A = await order({ age: 6 }), B = await order({ age: 2 }), C = await order({ age: 30, checked: 5 });
    const D = await order({ age: 180, checked: 30 }), E = await order({ age: 49 * 60 });
    const K = await order({ age: 30, checked: 11 }), L = await order({ age: 180, checked: 61 });
    const never = [await order({ age: 30, status: 'mismatch' }), await order({ age: 30, status: 'refund', amount: -2000 }),
      await order({ age: 30, status: 'paid' }), await order({ age: 30, source: 'rezerv' }), await order({ age: 30, method: 'cash' }),
      await order({ age: 30, amount: 0 })];
    [A, B, C, D, E, ...never].forEach(o => paidAt(o));
    const r1 = await sweep();
    const aRow = await st(A);
    ok('a pending online order 6 minutes old that PaySolutions calls "Y Paid" at its amount is turned on by the sweep', r1.ran
       && aRow.status === 'paid' && aRow.passes === 1
       && r1.orders.some(x => x.refno === A.refno && x.before === 'pending' && x.after === 'paid' && x.note === 'turned on'), JSON.stringify([r1, aRow]));
    ok('...one 2 minutes old is not asked, nor one checked 5 minutes ago, nor one 3 hours old checked 30 minutes ago, nor one 49 hours old',
       [B, C, D, E].every(o => askedOf(o) === 0), JSON.stringify([B, C, D, E].map(askedOf)));
    const neverRows = await Promise.all(never.map(st));
    ok('...a wrong amount, a refund, a paid order, a Rezerv row, a desk order and a ฿0 order are never asked, and stay as they were',
       never.every(o => askedOf(o) === 0) && neverRows.map(r => r.status).join() === 'mismatch,refund,paid,pending,pending,pending'
       && neverRows.every(r => r.passes === 0), JSON.stringify(neverRows));
    const kRow = await st(K);
    ok('...under 2 hours old and checked 11 minutes ago, or over 2 hours old and checked 61 minutes ago: asked again, no record, still pending',
       askedOf(K) === 1 && askedOf(L) === 1 && r1.asked === 3 && kRow.status === 'pending' && Math.abs(kRow.checked_at.getTime() - NOW) < 2
       && (await st(L)).gateway_note === 'no record (http 200)', JSON.stringify(r1));
    const n2 = asked.length;
    const r2 = await sweep(MIN);
    ok('a sweep a minute later asks nobody again', r2.ran && r2.asked === 0 && asked.length === n2, JSON.stringify(r2));
    await sweep(11 * MIN);
    ok('11 minutes on, the young order is asked again (every 10 minutes); the one over 2 hours old waits for its hour',
       askedOf(K) === 2 && askedOf(L) === 1 && askedOf(C) === 1 && (await st(C)).status === 'paid', JSON.stringify([askedOf(K), askedOf(L), askedOf(C)]));
    const many = [];
    for (let i = 0; i < 35; i++) many.push(await order({ age: 10 }));
    const r4 = await sweep(12 * MIN), r5 = await sweep(13 * MIN);
    ok('at most 30 orders a run, never-checked first; the next run takes the other 5', r4.asked === 30 && r5.asked === 5
       && many.every(o => askedOf(o) === 1), JSON.stringify([r4.asked, r5.asked]));
    const trio = [await order({ age: 10 }), await order({ age: 10 }), await order({ age: 10 })];
    pay.delay = 150;
    const both = await Promise.all([sweep(14 * MIN), sweep(14 * MIN)]);
    pay.delay = 0;
    ok('two runs at once ask each order once: one runs, the other finds it busy', trio.every(o => askedOf(o) === 1)
       && both.filter(x => x.ran).length === 1 && both.some(x => x.reason === 'busy'), JSON.stringify(both.map(x => [x.ran, x.reason, x.asked])));
    const held = await one(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND granted`);
    const idle = await one(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND state LIKE 'idle in transaction%'`);
    const after = await sweep(14 * MIN);
    ok('...and the lock is given back: no lock left, no connection idle in a transaction, the next run runs', held.n === 0 && idle.n === 0
       && after.ran === true, JSON.stringify([held, idle, after.reason]));

    console.log('  problem pings');
    const M = await order({ age: 10, name: 'Ana ana.example@example.com Example' });
    paidAt(M, M.amount - 1);
    const tM = tg.length;
    await sweep(15 * MIN);
    await until(() => tg.length > tM);
    const mm = tg.slice(tM);
    ok('a wrong amount pings once, naming the student (name and member code), the package, both amounts and the ref',
       (await st(M)).status === 'mismatch' && mm.length === 1 && mm[0].chat === '4242' && /^⚠ Wrong amount: PaySolutions says ฿1,999, the order is ฿2,000/.test(mm[0].text)
       && mm[0].text.includes(`Ana Example (${M.member.code}) · ${pack8.name_en} · ฿2,000 · ref ${M.refno}`), JSON.stringify(mm));
    await sweep(40 * MIN);
    await J('/api/bkk/pay/check/' + M.refno);
    await wait(300);
    ok('...a later sweep sends nothing new, and neither does the student checking again', tg.length === tM + 1 && pingsOf(M).length === 1,
       JSON.stringify(tg.slice(tM)));

    NOW += 49 * HOUR;
    const U = await order({ age: 70 }), U2 = await order({ age: 30 }), N0 = await order({ age: 90 });
    for (const o of [U, U2]) pay.answers[o.r12] = [{ Total: o.amount, Status: 'N', StatusName: 'Unpaid' }];
    const tU = tg.length;
    await sweep();
    await until(() => tg.length > tU); await wait(200);
    const up = tg.slice(tU);
    ok('a record that is still not paid an hour on pings once, with the raw status and its name (the ping that would have caught "Y Paid")',
       up.length === 1 && up[0].text.startsWith('⚠ Not paid after 70 min. PaySolutions says: status N (Unpaid)')
       && up[0].text.includes(`(${U.member.code})`) && up[0].text.includes(`ref ${U.refno}`), JSON.stringify(up));
    ok('...the same answer 30 minutes in, or no record at all 90 minutes in, pings nothing', !pingsOf(U2).length && !pingsOf(N0).length
       && askedOf(U2) === 1 && askedOf(N0) === 1);
    await sweep(11 * MIN);
    await wait(300);
    ok('...asked again 11 minutes later, the same status sends nothing new', askedOf(U) === 2 && tg.length === tU + 1);

    NOW += 49 * HOUR;
    const F1 = await order({ age: 10 }), F2 = await order({ age: 10 });
    pay.code = 401;
    const tF = tg.length;
    const f1 = await sweep();
    await wait(300);
    const FAILING = '⚠ PaySolutions check is failing (http 401): online payments will not turn on by themselves.';
    ok('PaySolutions refusing the check once (http 401) is not news yet: no ping, and the run stops at the first refusal',
       f1.due === 2 && f1.asked === 1 && tg.length === tF, JSON.stringify([f1, tg.slice(tF)]));
    const f2 = await sweep(11 * MIN);
    await until(() => tg.length > tF); await wait(200);
    ok('...refused again 11 minutes later (twice in a row): one ping for the whole shala',
       f2.asked === 1 && tg.length === tF + 1 && tg[tF].text === FAILING, JSON.stringify([f2, tg.slice(tF)]));
    await sweep(22 * MIN);
    await wait(300);
    const f1Row = await st(F1);
    ok('...a third refusal: no second ping inside 3 hours, the order still pending, its note keeps the code',
       tg.length === tF + 1 && f1Row.status === 'pending' && f1Row.passes === 0 && /http 401/.test(f1Row.gateway_note), JSON.stringify(f1Row));
    await sweep(3 * HOUR + 15 * MIN);
    await until(() => tg.length > tF + 1);
    ok('...3 hours after the ping, a refusal pings again', tg.length === tF + 2 && tg[tF + 1].text === FAILING, JSON.stringify(tg.slice(tF)));
    pay.code = 200;
    process.env.PAYSO_INQUIRY_BASE = 'http://127.0.0.1:9';
    const NE = await order({ age: 10 });
    const ne = await sweep(3 * HOUR + 16 * MIN);
    process.env.PAYSO_INQUIRY_BASE = env.PAYSO_INQUIRY_BASE;
    await wait(300);
    const neRow = await st(NE);
    ok('a network error is a not-paid answer that says so: no crash, no status change, no new ping inside the 3 hours',
       ne.orders[0] && ne.orders[0].refno === NE.refno && ne.orders[0].after === 'pending' && /^inquiry failed: /.test(ne.orders[0].note)
       && neRow.status === 'pending' && /^inquiry failed: /.test(neRow.gateway_note) && tg.length === tF + 2, JSON.stringify([ne, neRow]));
    const app2 = express(); app2.use(express.json());
    const slow = await mountBkk(app2, { pgPool: pool, now, inquiryTimeoutMs: 300 });
    const TO = await order({ age: 10 });
    pay.hang = true;
    const t0 = Date.now();
    const to = await slow.paySweep({ now: NOW + 3 * HOUR + 17 * MIN });
    pay.hang = false;
    ok('a PaySolutions that never answers is given up after the timeout: not paid, said so, the status unchanged',
       Date.now() - t0 < 5000 && to.orders[0] && to.orders[0].refno === TO.refno && to.orders[0].note === 'inquiry failed: timeout after 0.3 s'
       && (await st(TO)).status === 'pending', JSON.stringify(to));
    const tW = tg.length;
    await order({ age: 10 });
    const back = await sweep(3 * HOUR + 30 * MIN);
    await until(() => tg.length > tW); await wait(200);
    const WORKS = tg.slice(tW).filter(m => m.text.startsWith('✓ PaySolutions check works again'));
    await order({ age: 10 });
    await sweep(3 * HOUR + 45 * MIN); await wait(200);
    ok('...PaySolutions answering again sends one "works again", naming when it started failing; the next answer sends nothing',
       back.asked >= 1 && WORKS.length === 1 && / \(failing since \w{3} \d+ \w{3} \d\d:\d\d, timeout after 0\.3 s\)\.$/.test(WORKS[0].text)
       && tg.length === tW + 1, JSON.stringify(tg.slice(tW)));
    const blip = await order({ age: -(3 * 60 + 40) });
    pay.code = 502;
    await sweep(3 * HOUR + 46 * MIN);
    pay.code = 200; paidAt(blip);
    await sweep(3 * HOUR + 57 * MIN); await wait(300);
    ok('one failed check alone (a blip) pings nothing, and the next answer turns the order on and says nothing', tg.length === tW + 1
       && (await st(blip)).status === 'paid', JSON.stringify(tg.slice(tW)));

    NOW += 49 * HOUR;
    const sch = (await J('/api/bkk/schedule?days=14', { headers: ADMIN })).body.classes.filter(c => !c.isOnline && !c.started);
    const c1 = sch[1], c2 = sch.find(c => c.slotId !== c1.slotId || c.date !== c1.date);
    const back28 = d => new Date(Date.parse(d + 'T12:00:00Z') - 28 * 86400000).toISOString().slice(0, 10);
    let direct = 990790000000;
    const paidBefore = async (m, f = {}) => pool.query(`INSERT INTO bkk_orders (refno,product_id,member_id,base_thb,amount_thb,status,source,method,slot_id,class_date,verified_at)
      VALUES ($1,$2,$3,$4,$4,'paid',$5,'online',$6,$7, now() - make_interval(hours => $8))`,
      [++direct, f.product || pack8.id, m.id, f.amount ?? 2000, f.source || null, f.slotId || null, f.date || null, f.hours || 24]);
    const P = await order({ age: 10 });
    await paidBefore(P.member);
    const P2 = await order({ age: 10 }); await paidBefore(P2.member, { hours: 96 });
    const P3 = await order({ age: 10 }); await paidBefore(P3.member, { amount: 0 });
    const P4 = await order({ age: 10 }); await paidBefore(P4.member, { source: 'rezerv' });
    const Q1 = await order({ age: 10, product: drop.id, slotId: c2.slotId, date: c2.date, amount: 1605 });
    await paidBefore(Q1.member, { product: drop.id, slotId: c1.slotId, date: c1.date, amount: 1605 });
    const Q2 = await order({ age: 10, member: Q1.member, product: drop.id, slotId: c1.slotId, date: c1.date, amount: 1605 });
    const NB = await order({ age: 10, product: drop.id, slotId: c1.slotId, date: back28(c1.date), amount: 1605 });
    [P, P2, P3, P4, Q1, Q2, NB].forEach(o => paidAt(o));
    const tD = tg.length;
    const rd = await sweep();
    await until(() => pingsOf(P).length && pingsOf(Q2).length && pingsOf(NB).length); await wait(300);
    const dp = pingsOf(P)[0] || { text: '' };
    ok('turned on while the same student paid for the same package yesterday: one "possible double payment" ping, naming them',
       rd.paid === 7 && pingsOf(P).length === 1 && dp.text.startsWith(`⚠ Possible double payment: ${pack8.name_en} was already paid`)
       && dp.text.includes(`(${P.member.code})`) && dp.text.endsWith('Check the bank or PaySolutions; refund one if it is a double.'),
       JSON.stringify([rd.paid, tg.slice(tD)]));
    ok('...not for a payment 4 days back, a ฿0 one, a Rezerv one, or a drop-in for another class; yes for a drop-in for the same class',
       !pingsOf(P2).length && !pingsOf(P3).length && !pingsOf(P4).length && !pingsOf(Q1).length
       && pingsOf(Q2).length === 1 && /Possible double payment: Drop-in/.test(pingsOf(Q2)[0].text), JSON.stringify(tg.slice(tD)));
    const nb = pingsOf(NB);
    ok('paid, but the class could not be booked: a ping naming the student, saying they keep a 1-class credit', nb.length === 1
       && nb[0].text.startsWith('⚠ Paid, but could not book') && nb[0].text.includes(`(${NB.member.code})`)
       && nb[0].text.endsWith('They keep a 1-class credit: book them by hand.')
       && (await st(NB)).status === 'paid', JSON.stringify(nb));
    ok('per-sale pings are off by default: none of those 7 online payments sent one', !tg.slice(tD).some(m => m.text.startsWith('💳')));

    const tS = tg.length;
    const sale1 = await post('/api/bkk/admin/sales', { productCode: 'pack8', name: 'Desk Example', email: 'desk.watch1@example.com', method: 'cash' }, ADMIN);
    await wait(400);
    ok('...nor does a desk sale', sale1.status === 200 && tg.length === tS, JSON.stringify(tg.slice(tS)));
    const onEach = await post('/api/bkk/admin/settings', { pingEachSale: true }, ADMIN);
    const sale2 = await post('/api/bkk/admin/sales', { productCode: 'unlim1', name: 'Desk Example', email: 'desk.watch2@example.com', method: 'transfer' }, ADMIN);
    await until(() => tg.length > tS); await wait(200);
    ok('switched on, a desk sale pings "💳 AYBKK payment (transfer)" with the package, amount and ref, and no name',
       onEach.body.payWatch.pingEachSale === 'on' && tg.length === tS + 1 && tg[tS].text.startsWith('💳 AYBKK payment (transfer)')
       && tg[tS].text.includes(`refno ${sale2.body.order.refno}`) && !/Desk/.test(tg[tS].text), JSON.stringify(tg.slice(tS)));
    const OS = await order({ age: 10 }); paidAt(OS);
    await sweep(MIN);
    await until(() => tg.length > tS + 1); await wait(200);
    ok('...and an online payment the sweep turns on pings "(online)"', tg.length === tS + 2 && tg[tS + 1].text.startsWith('💳 AYBKK payment (online)')
       && tg[tS + 1].text.includes(`refno ${OS.refno}`), JSON.stringify(tg.slice(tS)));
    const FA = await order({ age: 10 });
    const fa = await post(`/api/bkk/admin/orders/${FA.id}/force-activate`, {}, ADMIN);
    await wait(400);
    ok('...but an order staff turn on by hand sends no ping', fa.status === 200 && (await st(FA)).status === 'paid' && tg.length === tS + 2,
       JSON.stringify(tg.slice(tS)));
    await post('/api/bkk/admin/settings', { pingEachSale: false }, ADMIN);

    console.log('  Telegram health and settings');
    const s1 = await settingsNow();
    ok('Telegram status: set (never the token or the chat), the last send ok and when', s1.telegram.set === true && s1.telegram.last.ok === true
       && !!s1.telegram.last.okAt && !JSON.stringify(s1).includes('tg-test-token') && !JSON.stringify(s1).includes('4242'), JSON.stringify(s1.telegram));
    tgCode = 500;
    const M2 = await order({ age: 10 }); paidAt(M2, 1);
    await sweep(2 * MIN);
    await until(async () => (await settingsNow()).telegram.last.ok === false);
    const s2 = await settingsNow();
    tgCode = 200;
    ok('...a failed send is kept with its time and error, and the last good send stays', s2.telegram.last.ok === false
       && s2.telegram.last.error === 'http 500: Internal Server Error' && !!s2.telegram.last.at && s2.telegram.last.okAt === s1.telegram.last.okAt,
       JSON.stringify(s2.telegram));
    const bad1 = await post('/api/bkk/admin/settings', { pingEachSale: 'maybe' }, ADMIN);
    const bad2 = await post('/api/bkk/admin/settings', { dailyMoneyAt: '25:00' }, ADMIN);
    const bad3 = await post('/api/bkk/admin/settings', { pingEachSale: 'on', dailyMoneyAt: 'noon' }, ADMIN);
    const bad4 = await post('/api/bkk/admin/settings', { paySweep: 'yes' }, ADMIN);
    ok('settings: on/off and an HH:MM time only, and a refused change saves nothing', [bad1, bad2, bad3, bad4].every(r => r.status === 400)
       && (await settingsNow()).payWatch.pingEachSale === 'off', JSON.stringify([bad1.body, bad2.body, bad3.body, bad4.body]));
    const bad5 = await post('/api/bkk/admin/settings', { pingEachSale: 'on', links: { instagram: 'not a link' } }, ADMIN);
    const bad6 = await post('/api/bkk/admin/settings', { dailyMoneyAt: ['06:15'] }, ADMIN);
    const bad7 = await post('/api/bkk/admin/settings', { pingEachSale: ['on'] }, ADMIN);
    const sN = (await settingsNow()).payWatch;
    ok('...a bad link next to a good switch saves neither; a time or a switch inside a list is refused', [bad5, bad6, bad7].every(r => r.status === 400)
       && sN.pingEachSale === 'off' && sN.dailyMoneyAt === '21:00', JSON.stringify([bad5.body, bad6.body, bad7.body, sN]));
    const good = await post('/api/bkk/admin/settings', { paySweep: false, dailyMoney: 'on', dailyMoneyAt: '7:30' }, ADMIN);
    ok('...7:30 is kept as 07:30, and the switches answer back', good.status === 200 && good.body.payWatch.dailyMoneyAt === '07:30'
       && good.body.payWatch.paySweep === 'off', JSON.stringify(good.body));
    const RO = await order({ age: 10 }); paidAt(RO);
    const timerRun = await sweep(20 * MIN);
    const keepClock = clock;
    clock = NOW + 20 * MIN;
    const button = await post('/api/bkk/admin/pay/sweep', {}, ADMIN);
    clock = keepClock;
    ok('...with the watch off the timer asks nobody, while the button still checks and says what it did per order',
       timerRun.ran === false && timerRun.reason === 'off' && button.status === 200 && button.body.ran === true
       && JSON.stringify(button.body.orders.find(x => x.refno === RO.refno)) === JSON.stringify({ refno: RO.refno, before: 'pending', after: 'paid', note: 'turned on' }),
       JSON.stringify([timerRun, button.body]));
    await post('/api/bkk/admin/settings', { paySweep: 'on', dailyMoneyAt: '21:00' }, ADMIN);

    console.log('  races, doubles, safe text and retries (review fixes)');
    NOW += 49 * HOUR;
    const firstLines = o => pingsOf(o).map(m => m.text.split('\n')[0]);
    // Staff turn an order on by hand while the sweep still waits for PaySolutions.
    const byHandMidSweep = async (o, run) => {
      pay.delays[o.r12] = 400;
      const going = run();
      await wait(100);
      const fa = await post(`/api/bkk/admin/orders/${o.id}/force-activate`, {}, ADMIN);
      const r = await going; await wait(400);
      delete pay.delays[o.r12];
      return { fa, r, row: await st(o) };
    };
    const R2 = await order({ age: 10 }); paidAt(R2, R2.amount - 1);
    const x2 = await byHandMidSweep(R2, () => sweep());
    ok('turned on by hand while PaySolutions answers the sweep a wrong amount: still paid, one pass, the hand note kept, no "wrong amount" ping',
       x2.fa.status === 200 && x2.row.status === 'paid' && x2.row.passes === 1 && x2.row.gateway_note === 'MANUAL ACTIVATION by admin'
       && !pingsOf(R2).length && JSON.stringify(x2.r.orders) === JSON.stringify([{ refno: R2.refno, before: 'pending', after: 'paid', note: 'already on' }])
       && x2.r.paid === 0, JSON.stringify([x2, firstLines(R2)]));
    const R3 = await order({ age: 70 });
    pay.answers[R3.r12] = [{ Total: R3.amount, Status: 'N', StatusName: 'Unpaid' }];
    const x3 = await byHandMidSweep(R3, () => sweep(MIN));
    ok('...or answers "not paid" for an order over an hour old: the hand note stays, and no "not paid" ping for a paid order',
       x3.row.status === 'paid' && x3.row.gateway_note === 'MANUAL ACTIVATION by admin' && !pingsOf(R3).length, JSON.stringify([x3.row, firstLines(R3)]));
    const R4 = await order({ age: 10 });
    const x4 = await byHandMidSweep(R4, () => slow.paySweep({ now: NOW + 2 * MIN }));
    ok('...or does not answer in time: the hand note stays, and the sweep says it was already on',
       JSON.stringify(x4.r.orders) === JSON.stringify([{ refno: R4.refno, before: 'pending', after: 'paid', note: 'already on' }])
       && x4.row.status === 'paid' && x4.row.gateway_note === 'MANUAL ACTIVATION by admin', JSON.stringify([x4.r, x4.row]));

    const E1 = await order({ age: 70 }), E2 = await order({ age: 70 }), E3 = await order({ age: 70 });
    pay.answers[E1.r12] = {}; pay.answers[E2.r12] = { data: null }; pay.answers[E3.r12] = { status: 'error', message: 'Data not found' };
    await sweep(3 * MIN); await wait(300);
    const eRows = await Promise.all([E1, E2, E3].map(st));
    ok('an answer with no Status ({}, no data, an error message) is no record: no "not paid" ping', eRows.every(r => r.gateway_note === 'no record (http 200)')
       && ![E1, E2, E3].some(o => pingsOf(o).length), JSON.stringify(eRows.map(r => r.gateway_note)));
    const S1 = await order({ age: 80 });
    pay.answers[S1.r12] = [{ Total: S1.amount, Status: 'N', StatusName: 'Unpaid' }];
    const S2 = await order({ age: 75, status: 'paid', member: S1.member });
    await sweep(4 * MIN);
    await until(() => pingsOf(S1).length);
    const s1p = (pingsOf(S1)[0] || {}).text || '';
    ok('not paid an hour on while the student paid the same package on a later order: the ping names that ref and says to refund one if both paid',
       s1p.startsWith('⚠ Not paid after 84 min. PaySolutions says: status N (Unpaid)')
       && new RegExp(`They paid ref ${S2.refno} \\(\\d\\d \\w{3} \\d\\d:\\d\\d\\)\\. If PaySolutions shows money for this one too, refund one\\.$`).test(s1p), s1p);

    const NF = await order({ age: 10, name: 'Ana ๐๘๑๒๓๔๕๖๗๘ ０８１２３ ana＠example．com refund-help.example/form www.example example.com Example' });
    paidAt(NF, NF.amount - 1);
    await sweep(5 * MIN);
    await until(() => pingsOf(NF).length);
    const nf = pingsOf(NF)[0] || {};
    ok('a phone in Thai or wide digits, a wide @, a link or a domain in a name never reach the ping, and Telegram shows no link preview',
       (nf.text || '').includes(`\nAna Example (${NF.member.code}) ·`) && !!nf.preview && nf.preview.is_disabled === true, JSON.stringify(nf));

    process.env.PAYSO_SECRET_KEY = 'test-only\nsecond-line';
    const KE = await order({ age: 10 });
    const ke = await J('/api/bkk/pay/check/' + KE.refno);
    process.env.PAYSO_SECRET_KEY = env.PAYSO_SECRET_KEY;
    const keRow = await st(KE);
    await wait(200);
    ok('a key with a line break pasted in never shows: the public check and the note say only that the request could not be sent',
       ke.body.note === 'inquiry failed: request could not be sent' && keRow.gateway_note === 'inquiry failed: request could not be sent'
       && !tg.some(m => m.text.includes('second-line')), JSON.stringify([ke.body, keRow]));
    await J('/api/bkk/pay/check/' + KE.refno);

    const NBH = await order({ age: 90, product: drop.id, slotId: c1.slotId, date: back28(c1.date), amount: 1605 });
    const nbh = await post(`/api/bkk/admin/orders/${NBH.id}/force-activate`, {}, ADMIN);
    await wait(400);
    ok('turned on by hand for a class that has ended: the page tells staff, and no "could not book" ping', nbh.status === 200
       && !!nbh.body.bookingError && !pingsOf(NBH).length, JSON.stringify([nbh.body, firstLines(NBH)]));

    const tDD = tg.length;
    const deskWho = { productCode: 'dropin', name: 'Dropin Example', email: 'dropin.watch@example.com', method: 'cash' };
    const dd1 = await post('/api/bkk/admin/sales', deskWho, ADMIN);
    // A second desk sale in 15 minutes needs staff to confirm it (#120).
    const dd2 = await post('/api/bkk/admin/sales', { ...deskWho, method: 'transfer', confirmRepeat: true }, ADMIN);
    await wait(500);
    ok('two drop-ins sold at the desk with no class (a regular paying each visit): no "double payment" ping',
       dd1.status === 200 && dd2.status === 200 && !tg.slice(tDD).some(m => m.text.includes('double payment')), JSON.stringify(tg.slice(tDD)));
    const hm = await one(`INSERT INTO bkk_members (code,name,email) VALUES ('BPWATCHDESK8','Pack Example','pack.watch@example.com') RETURNING id`);
    await paidBefore(hm, { hours: 3 });
    const tH = tg.length;
    const hs = await post('/api/bkk/admin/sales', { productCode: 'pack8', name: 'Pack Example', email: 'pack.watch@example.com', method: 'cash',
      slotId: c1.slotId, date: c1.date }, ADMIN);
    await until(() => tg.length > tH); await wait(200);
    ok('8 classes sold at the desk with a class, 3 hours after an online 8 classes with none: a "double payment" ping (the class counts for a drop-in only)',
       hs.status === 200 && tg.slice(tH).filter(m => m.text.startsWith(`⚠ Possible double payment: ${pack8.name_en}`)).length === 1, JSON.stringify(tg.slice(tH)));
    for (let i = 0; i < 3; i++) {
      const T1 = await order({ age: 10 }), T2 = await order({ age: 10, member: T1.member });
      paidAt(T1); paidAt(T2);
      const tT = tg.length;
      await Promise.all([J('/api/bkk/pay/check/' + T1.refno), J('/api/bkk/pay/check/' + T2.refno)]);
      await wait(600);
      const tt = tg.slice(tT).filter(m => m.text.startsWith('⚠ Possible double payment'));
      ok(`two payments for one package turned on at the same moment: one "double payment" ping for the pair (try ${i + 1})`, tt.length === 1, JSON.stringify(tt));
    }

    // #120 asks staff before Activate makes a second pass for a package the
    // student already paid; once they confirm, the note says so and the watch
    // still flags the money: one double ping that says staff did it, no sale ping.
    const hc = await one(`INSERT INTO bkk_members (code,name,email) VALUES ('BPWATCHHAND1','Hand Example','hand.watch@example.com') RETURNING id`);
    await paidBefore(hc, { hours: 2 });
    const HC = await one(`INSERT INTO bkk_orders (refno,product_id,member_id,base_thb,amount_thb,status,method,created_at)
      VALUES (990799000001,$1,$2,2000,2000,'pending','online', now() - interval '10 minutes') RETURNING id, refno`, [pack8.id, hc.id]);
    await post('/api/bkk/admin/settings', { pingEachSale: true }, ADMIN);
    const hc1 = await post(`/api/bkk/admin/orders/${HC.id}/force-activate`, {}, ADMIN);
    const tHC = tg.length, hcFrom = Date.now();
    await wait(20);
    const hc2 = await post(`/api/bkk/admin/orders/${HC.id}/force-activate`, { confirm: true }, ADMIN);
    await until(() => tg.length > tHC); await wait(300);
    const hcRow = await one('SELECT status, gateway_note FROM bkk_orders WHERE id=$1', [HC.id]);
    const hcPings = tg.slice(tHC);
    ok('Activate on an order the student already paid: asked first; confirmed, the note names the paid ref, one double ping says staff did it, no sale ping',
       hc1.status === 409 && !!hc1.body.paidAlready && hc2.status === 200 && hcRow.status === 'paid'
       && /^MANUAL ACTIVATION by admin, paid already as ref \d+$/.test(hcRow.gateway_note)
       && hcPings.length === 1 && hcPings[0].text.startsWith(`⚠ Possible double payment: ${pack8.name_en}`)
       && hcPings[0].text.includes('Staff activated this one by hand.') && hcPings[0].text.includes('(BPWATCHHAND1)'),
       JSON.stringify([hc1.body, hc2.body, hcRow, hcPings]));
    await post('/api/bkk/admin/settings', { pingEachSale: false }, ADMIN);
    const hcLine = await watch.moneyLine({ from: hcFrom, until: Date.now() + 1000 });
    ok('...and the money line counts it as activated by hand, with that longer note', /\nOnline sales: 1, ฿2,000\n/.test(hcLine)
       && /\nActivated by hand: 1\n/.test(hcLine), hcLine);

    await watch.resendAlerts({ now: NOW });
    tgCode = 502;
    const RT = await order({ age: 10 }); paidAt(RT, 1);
    await sweep(6 * MIN);
    await until(async () => !!(await one(`SELECT retry_text FROM bkk_pay_alerts WHERE order_id=$1 AND kind='mismatch'`, [RT.id])).retry_text);
    const kept = await one(`SELECT retry_text, tries FROM bkk_pay_alerts WHERE order_id=$1 AND kind='mismatch'`, [RT.id]);
    const rs1 = await watch.resendAlerts({ now: NOW + 7 * MIN });
    tgCode = 200;
    const rs2 = await watch.resendAlerts({ now: NOW + 8 * MIN });
    const rs3 = await watch.resendAlerts({ now: NOW + 18 * MIN });
    const rs4 = await watch.resendAlerts({ now: NOW + 40 * MIN });
    const done = await one(`SELECT retry_text, tries FROM bkk_pay_alerts WHERE order_id=$1 AND kind='mismatch'`, [RT.id]);
    ok('a ping Telegram refused (502) is kept and tried again 10 minutes apart until it gets through, then never again',
       /^⚠ Wrong amount/.test(kept.retry_text || '') && kept.tries === 1 && rs1.due === 1 && rs1.sent === 0 && rs2.due === 0 && rs3.due === 1 && rs3.sent === 1
       && rs4.due === 0 && done.retry_text === null && done.tries === 3 && pingsOf(RT).length === 3, JSON.stringify([kept, rs1, rs2, rs3, rs4, done, pingsOf(RT).length]));
    tgCode = 502;
    const RX = await order({ age: 10 }); paidAt(RX, 1);
    await sweep(9 * MIN);
    await until(async () => !!(await one(`SELECT retry_text FROM bkk_pay_alerts WHERE order_id=$1 AND kind='mismatch'`, [RX.id])).retry_text);
    const rx = [await watch.resendAlerts({ now: NOW + 20 * MIN }), await watch.resendAlerts({ now: NOW + 31 * MIN }), await watch.resendAlerts({ now: NOW + 60 * MIN })];
    tgCode = 200;
    ok('...a ping Telegram keeps refusing is tried 3 times in all, then dropped (the Settings line shows the failure)', rx.map(r => r.due).join() === '1,1,0'
       && pingsOf(RX).length === 3 && (await one(`SELECT retry_text FROM bkk_pay_alerts WHERE order_id=$1 AND kind='mismatch'`, [RX.id])).retry_text === null
       && (await settingsNow()).telegram.last.ok === false, JSON.stringify([rx, pingsOf(RX).length]));

    NOW += 49 * HOUR;
    const LD = await order({ age: 10 }), LD2 = await order({ age: 10 });
    paidAt(LD); paidAt(LD2); pay.delays[LD.r12] = 600;
    const ldRun = sweep();
    await wait(250);
    const cut = await one(`SELECT count(pg_terminate_backend(l.pid))::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.locktype = 'advisory' AND l.granted AND a.datname = current_database()`);
    const ld = await ldRun;
    delete pay.delays[LD.r12];
    const ldNext = await sweep(MIN);
    const ldLocks = await one(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND granted`);
    ok('the database ends the sweep\'s lock connection mid-run: no crash, the order in hand is turned on, the run stops, the next run takes the rest',
       cut.n === 1 && ld.ran && ld.asked === 1 && (await st(LD)).status === 'paid' && ldNext.ran && ldNext.asked === 1
       && (await st(LD2)).status === 'paid' && ldLocks.n === 0, JSON.stringify([cut, ld, ldNext, ldLocks]));

    NOW += 49 * HOUR;
    const SL = [await order({ age: 10 }), await order({ age: 10 }), await order({ age: 10 })];
    SL.forEach(o => { pay.delays[o.r12] = 150; });
    const sl = await slow.paySweep({ now: NOW });
    SL.forEach(o => { delete pay.delays[o.r12]; });
    ok('a slow PaySolutions (an answer slower than a third of the timeout) ends the run after that answer: the rest wait, the button stays short',
       sl.ran && sl.due === 3 && sl.asked === 1 && sl.orders[0].note === 'no record (http 200)', JSON.stringify(sl));
    await pool.query(`DELETE FROM bkk_settings WHERE key='pay_check_failing'`);

    console.log('  the daily money line');
    const DAY = '2026-08-04', PREV = '2026-08-03';
    const at = (d, hm) => new Date(bkkAt(`${d}T${hm}:00`));
    const row = f => pool.query(`INSERT INTO bkk_orders (refno,product_id,base_thb,amount_thb,status,source,method,gateway_note,created_at,verified_at,checked_at)
      VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10)`, [++direct, pack8.id, f.amount, f.status || 'paid', f.source || null, f.method || 'online',
      f.note || null, f.created || f.paid, f.paid || null, f.checked || null]);
    const tick = (d, hm) => watch.moneyTick({ now: at(d, hm).getTime() });
    const marker = async d => (await one(`SELECT count(*)::int AS n FROM bkk_settings WHERE key=$1`, ['daily_money_sent_' + d])).n;
    const lineOf = d => tg.filter(m => m.text.startsWith('AYBKK money,') && m.text.includes(` to ${d}`));
    ok('a time with no sales says so in one short line, naming both ends',
       await watch.moneyLine({ from: at(PREV, '21:00').getTime(), until: at(DAY, '21:05').getTime() }) === 'AYBKK money, Mon 3 Aug 21:00 to Tue 4 Aug 21:05: No sales.');
    for (const f of [
      { amount: 1000, paid: at(DAY, '00:30') }, { amount: 2500, paid: at(DAY, '15:00') },
      { amount: 400, paid: at(DAY, '18:00'), note: 'MANUAL ACTIVATION by admin' },
      { amount: 700, paid: at(DAY, '07:10'), method: 'cash' }, { amount: 1200, paid: at(DAY, '08:40'), method: 'transfer' },
      { amount: -300, paid: at(DAY, '12:00'), status: 'refund' },
      { amount: 0, paid: at(DAY, '09:00'), source: 'rezerv' }, { amount: 5000, paid: at(DAY, '09:00'), source: 'rezerv', method: 'card' },
      { amount: -1000, paid: at(DAY, '09:30'), source: 'rezerv', status: 'refund' },
      { amount: 999, paid: at(PREV, '20:59') }, { amount: 350, paid: at(PREV, '21:30') },
      { amount: 900, created: at(DAY, '10:00'), checked: at(DAY, '10:05'), status: 'mismatch' },
      { amount: 800, created: at(DAY, '19:00'), status: 'pending' }, { amount: 600, created: at(DAY, '20:30'), status: 'pending' },
      { amount: 650, paid: at(DAY, '21:30') },
    ]) await row(f);
    const early = await tick(DAY, '20:59');
    const tL = tg.length;
    const sent = await tick(DAY, '21:05');
    const LINE = ['AYBKK money, Mon 3 Aug 21:00 to Tue 4 Aug 21:05', 'Online sales: 4, ฿4,250', 'Desk sales: 2, ฿1,900 (cash 1, ฿700; transfer 1, ฿1,200)',
      'Total: ฿6,150 (VAT included)', 'Refunds: 1, ฿300', 'Activated by hand: 1',
      'New problems: mismatch 1, online orders started but not paid over 1 hour 1'].join('\n');
    ok('not before its time; the first line covers from yesterday at the set time (a sale after yesterday\'s line is in it), with the right totals',
       early.skipped === 'not yet' && sent.sent === true && sent.text === LINE && tg.length === tL + 1 && tg[tL].text === LINE
       && tg[tL].chat === '4242', JSON.stringify([early, sent.text]));
    const again = await tick(DAY, '21:30');
    ok('...claimed once: a second call that day sends nothing', again.skipped === 'already' && tg.length === tL + 1 && await marker(DAY) === 1);
    const twice = await Promise.all([tick('2026-08-05', '21:01'), tick('2026-08-05', '21:01')]);
    ok('two at once the next day: one line, from the end of the last one, so the 21:30 sale after it is in this one; each problem counted once',
       twice.filter(x => x.sent).length === 1 && twice.some(x => x.skipped === 'already') && tg.length === tL + 2
       && tg[tL + 1].text === ['AYBKK money, Tue 4 Aug 21:05 to Wed 5 Aug 21:01', 'Online sales: 1, ฿650', 'Desk sales: 0, ฿0',
         'Total: ฿650 (VAT included)', 'Activated by hand: 0', 'New problems: mismatch 0, online orders started but not paid over 1 hour 1'].join('\n'),
       JSON.stringify([twice, tg.slice(tL)]));
    const late = await tick('2026-08-06', '23:50');
    const nextMorning = await tick('2026-08-07', '00:10');
    ok('a server down at 21:00 sends when it is back the same day, never on the next day; a time with no sales is one short line',
       late.sent === true && late.text === 'AYBKK money, Wed 5 Aug 21:01 to Thu 6 Aug 23:50: No sales.' && nextMorning.skipped === 'not yet'
       && await marker('2026-08-07') === 0 && tg.length === tL + 3, JSON.stringify([late, nextMorning]));
    await post('/api/bkk/admin/settings', { dailyMoney: 'off' }, ADMIN);
    const offDay = await tick('2026-08-08', '21:05');
    await post('/api/bkk/admin/settings', { dailyMoney: 'on', dailyMoneyAt: '07:30' }, ADMIN);
    delete process.env.TELEGRAM_BOT_TOKEN;
    const noTg = await tick('2026-08-09', '21:05');
    process.env.TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
    await row({ amount: 1100, paid: at('2026-08-08', '12:00') });
    const before730 = await tick('2026-08-10', '07:29'), at731 = await tick('2026-08-10', '07:31');
    ok('switched off it sends nothing and claims nothing; with no Telegram it claims nothing; another time is kept, and its line covers the days in between',
       offDay.skipped === 'off' && await marker('2026-08-08') === 0 && noTg.skipped === 'telegram not set' && await marker('2026-08-09') === 0
       && before730.skipped === 'not yet' && at731.sent === true && tg.length === tL + 4
       && at731.text.startsWith('AYBKK money, Thu 6 Aug 23:50 to Mon 10 Aug 07:31\nOnline sales: 1, ฿1,100\n'), JSON.stringify([offDay, noTg, before730, at731]));
    await post('/api/bkk/admin/settings', { dailyMoneyAt: '00:00' }, ADMIN);
    await row({ amount: 1300, paid: at('2026-08-10', '18:00') });
    const midnight = await tick('2026-08-11', '00:01');
    ok('a line set for 00:00 covers the day that just ended', midnight.sent === true
       && midnight.text.startsWith('AYBKK money, Mon 10 Aug 07:31 to Tue 11 Aug 00:01\nOnline sales: 1, ฿1,300\n'), JSON.stringify(midnight));
    await post('/api/bkk/admin/settings', { dailyMoneyAt: '21:00' }, ADMIN);
    const capped = await tick('2026-08-25', '21:05');
    ok('...and after two weeks without a line, the next covers one week at most', capped.sent === true
       && capped.text.startsWith('AYBKK money, Tue 18 Aug 21:05 to Tue 25 Aug 21:05'), JSON.stringify(capped));
    await pool.query(`INSERT INTO bkk_settings (key,value) VALUES ('pay_check_failing', $1::jsonb)`,
      [JSON.stringify({ since: at('2026-08-25', '20:10').toISOString(), why: 'http 401', fails: 3, pinged: true, pingedAt: at('2026-08-25', '20:30').toISOString() })]);
    const failingLine = await watch.moneyLine({ from: at('2026-08-25', '21:05').getTime(), until: at('2026-08-26', '00:00').getTime() });
    await pool.query(`DELETE FROM bkk_settings WHERE key='pay_check_failing'`);
    ok('while the check is failing (after its ping), the line says since when', failingLine
       === 'AYBKK money, Tue 25 Aug 21:05 to Wed 26 Aug 00:00: No sales.\nPaySolutions check: failing since Tue 25 Aug 20:10 (http 401)', failingLine);
    tgCode = 502;
    const fl = [await tick('2026-08-26', '21:01'), await tick('2026-08-26', '21:05'), await tick('2026-08-26', '21:12')];
    tgCode = 200;
    const fl2 = [await tick('2026-08-26', '21:23'), await tick('2026-08-26', '21:40')];
    ok('a line Telegram refused is sent again 10 minutes on (not sooner), until it gets through, then not again',
       fl[0].sent === false && fl[1].skipped === 'already' && fl[2].sent === false && fl2[0].sent === true && fl2[1].skipped === 'already'
       && lineOf('Wed 26 Aug').length === 3 && fl2[0].text.startsWith('AYBKK money, Tue 25 Aug 21:05 to Wed 26 Aug 21:23'), JSON.stringify([fl, fl2]));
    await row({ amount: 1700, paid: at('2026-08-27', '12:00') });
    tgCode = 502;
    const fx = [await tick('2026-08-27', '21:01'), await tick('2026-08-27', '21:12'), await tick('2026-08-27', '21:23'), await tick('2026-08-27', '21:34')];
    tgCode = 200;
    const nextDay = await tick('2026-08-28', '21:01');
    ok('...3 tries at most; then the next day\'s line covers that day too, so its sales still reach a line',
       fx.slice(0, 3).every(x => x.sent === false && x.error) && fx[3].skipped === 'already' && lineOf('Thu 27 Aug').length === 3
       && nextDay.sent === true && nextDay.text.startsWith('AYBKK money, Wed 26 Aug 21:23 to Fri 28 Aug 21:01\nOnline sales: 1, ฿1,700\n'), JSON.stringify([fx, nextDay]));

    ok('no ping or line holds an email, a phone or a note, and each went to the one private chat', tg.length >= 12
       && tg.every(m => !/@|example\.com|\d{3}-\d{3}-\d{4}/.test(m.text) && m.chat === '4242' && m.url === '/bottg-test-token/sendMessage'),
       JSON.stringify(tg.filter(m => /@|example\.com/.test(m.text))));
    Object.keys(env).forEach(k => { delete process.env[k]; });
    stub.closeAllConnections(); stub.close(); tgStub.close();
  }

  console.log('\n-- Money in today counts only lines with money (15 Nov 2026) --');
  {
    const money = async () => (await J('/api/bkk/admin/today', { headers: ADMIN })).body.money || [];
    const add = l => l.reduce((t, x) => [t[0] + x.n, t[1] + (x.total || 0)], [0, 0]);
    const before = add(await money());
    const m = (await pool.query(`INSERT INTO bkk_members (code,name,email) VALUES ('BZEROTODAY001','Zero Example','zero.today@example.com') RETURNING id`)).rows[0];
    await pool.query(`INSERT INTO bkk_orders (refno, member_id, base_thb, amount_thb, status, method, source, source_ref, verified_at, created_at)
      VALUES (990000000099, $1, 0, 0, 'paid', 'other', 'rezerv', 'RZ-ZERO-TODAY', now(), now())`, [m.id]);
    const after = add(await money());
    ok('a ฿0 line paid today is not a sale in Money in today, and the money is the same', after[0] === before[0] && after[1] === before[1],
       JSON.stringify([before, after]));
  }

  console.log('\n-- the PaySolutions postback comes as a GET (15 Nov 2026) --');
  {
    const http = require('http');
    const one = async (sql, args = []) => (await pool.query(sql, args)).rows[0] || {};
    let answer = null, asked = 0;
    const stub = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => { asked++; res.setHeader('Content-Type', 'application/json'); res.end(answer == null ? '' : JSON.stringify(answer)); });
    });
    await new Promise(r => stub.listen(0, '127.0.0.1', r));
    const env = { PAYSO_MERCHANT_ID: '00012345', PAYSO_SECRET_KEY: 'test-only', PAYSO_API_KEY: 'test-only',
      PAYSO_INQUIRY_BASE: `http://127.0.0.1:${stub.address().port}` };
    Object.assign(process.env, env);
    const buy = async n => (await post('/api/bkk/orders', { productCode: 'pack8', name: `Postback ${n} Example`, email: `postback.${n}@example.com` })).body;
    const state = async refno => one(`SELECT o.status, (SELECT count(*)::int FROM bkk_passes p WHERE p.order_id=o.id) AS passes
      FROM bkk_orders o WHERE o.refno=$1`, [refno]);
    const settle = () => new Promise(r => setTimeout(r, 400));
    const ref12 = o => String(o.order.refno).padStart(12, '0');
    const panel = o => `/api/bkk/pay/postback?refno=${ref12(o)}&merchantid=00012345&customeremail=postback%40example.com`
      + `&productdetail=AYBKK&total=${o.order.amount}.00&cardtype=PP`;

    const forged = await buy('forged');
    answer = null;
    const fRes = await J(panel(forged));
    await settle();
    ok('a GET postback is answered 200, and with no payment at PaySolutions it makes no pass', fRes.status === 200
       && (await state(forged.order.refno)).status === 'pending' && (await state(forged.order.refno)).passes === 0,
       JSON.stringify([fRes.status, await state(forged.order.refno)]));

    const paid = await buy('paid');
    answer = [{ Total: paid.order.amount, Status: 'Y', StatusName: 'Paid' }];
    const before = asked;
    const pRes = await J(panel(paid));
    await settle();
    const pRow = await state(paid.order.refno);
    ok('a GET postback the way the merchant panel sends it asks PaySolutions and turns a paid order on', pRes.status === 200
       && asked === before + 1 && pRow.status === 'paid' && pRow.passes === 1, JSON.stringify([pRes.status, asked - before, pRow]));

    const wrong = await buy('wrong');
    answer = [{ Total: wrong.order.amount + 100, Status: 'Y', StatusName: 'Paid' }];
    await J(panel(wrong));
    await settle();
    ok('...still with the amount checked: another amount makes no pass', (await state(wrong.order.refno)).passes === 0
       && (await state(wrong.order.refno)).status === 'mismatch', JSON.stringify(await state(wrong.order.refno)));

    const viaPost = await buy('post');
    answer = [{ Total: viaPost.order.amount, Status: 'Y', StatusName: 'Paid' }];
    await post('/api/bkk/pay/postback', { refno: ref12(viaPost) });
    await settle();
    ok('...and a POST postback still works', (await state(viaPost.order.refno)).passes === 1, JSON.stringify(await state(viaPost.order.refno)));

    answer = [{ Total: paid.order.amount, Status: 'Y', StatusName: 'Paid' }];
    await J(panel(paid));
    await settle();
    ok('the same postback twice makes no second pass', (await state(paid.order.refno)).passes === 1, JSON.stringify(await state(paid.order.refno)));

    const junkBefore = asked;
    const junk = await J('/api/bkk/pay/postback?refno=12ab%27%3B');
    const none = await J('/api/bkk/pay/postback');
    await settle();
    ok('a postback with no ref or a ref that is not a number is answered 200 and asks nothing', junk.status === 200 && none.status === 200
       && asked === junkBefore, JSON.stringify([junk.status, none.status, asked - junkBefore]));
    Object.keys(env).forEach(k => { delete process.env[k]; });
    stub.close();
  }

  console.log('\n-- Send test ping: which bot the server sends as, and what Telegram says (15 Nov 2026) --');
  {
    const http = require('http');
    const seen = []; let me = { code: 200, body: { ok: true, result: { id: 7000001, is_bot: true, username: 'aybkk_test_bot' } } };
    let send = { code: 200, body: { ok: true, result: {} } };
    const tgs = http.createServer((req, res) => {
      let body = ''; req.on('data', c => { body += c; });
      req.on('end', () => {
        seen.push({ url: req.url, body });
        const a = /\/getMe$/.test(req.url) ? me : send;
        res.statusCode = a.code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(a.body));
      });
    });
    await new Promise(r => tgs.listen(0, '127.0.0.1', r));
    const keep = { TELEGRAM_API_BASE: process.env.TELEGRAM_API_BASE, TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN, BOONCHU_CHAT_ID: process.env.BOONCHU_CHAT_ID };
    process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${tgs.address().port}`;
    delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.BOONCHU_CHAT_ID;
    const test = () => post('/api/bkk/admin/telegram/test', {}, ADMIN);

    const noKey = await post('/api/bkk/admin/telegram/test', {});
    const none = await test();
    ok('the test ping needs the staff key; with no token it says so and calls nobody', noKey.status === 401 && none.status === 200
       && none.body.tokenSet === false && none.body.sent === false && seen.length === 0, JSON.stringify(none.body));

    process.env.TELEGRAM_BOT_TOKEN = '7000001:tg-secret-test'; process.env.BOONCHU_CHAT_ID = '5151';
    const good = await test();
    const sent = seen.find(x => /\/sendMessage$/.test(x.url));
    ok('token and chat right: it names the bot and its id, sends one test ping to the chat, and the health line turns ok',
       good.status === 200 && good.body.bot && good.body.bot.username === 'aybkk_test_bot' && good.body.bot.id === 7000001
       && good.body.sent === true && !!sent && JSON.parse(sent.body).chat_id === '5151' && /AYBKK test ping/.test(JSON.parse(sent.body).text)
       && good.body.telegram.last.ok === true, JSON.stringify([good.body, seen]));
    ok('...and the answer never holds the token or the chat id', !/tg-secret-test|5151/.test(JSON.stringify(good.body)), JSON.stringify(good.body));

    seen.length = 0;
    me = { code: 401, body: { ok: false, error_code: 401, description: 'Unauthorized' } };
    const bad = await test();
    ok('a wrong or replaced token: Telegram\'s "Unauthorized" shows, and no ping is tried', bad.status === 200
       && bad.body.botError === 'http 401: Unauthorized' && bad.body.sent === false && !seen.some(x => /sendMessage/.test(x.url)),
       JSON.stringify([bad.body, seen]));

    me = { code: 200, body: { ok: true, result: { id: 7000001, is_bot: true, username: 'aybkk_test_bot' } } };
    send = { code: 400, body: { ok: false, error_code: 400, description: 'Bad Request: chat not found' } };
    const chat = await test();
    ok('a bot never started or a wrong chat: the bot is named, and Telegram\'s "chat not found" shows on the page and in the health line',
       chat.body.bot.username === 'aybkk_test_bot' && chat.body.sent === false && /chat not found/.test(chat.body.error || '')
       && chat.body.telegram.last.ok === false && /chat not found/.test(chat.body.telegram.last.error || ''), JSON.stringify(chat.body));

    delete process.env.BOONCHU_CHAT_ID;
    const noChat = await test();
    ok('no chat set: it says so and sends nothing', noChat.body.tokenSet === true && noChat.body.chatSet === false && noChat.body.sent === false
       && !noChat.body.error, JSON.stringify(noChat.body));
    for (const [k, v] of Object.entries(keep)) { if (v == null) delete process.env[k]; else process.env[k] = v; }
    tgs.close();
  }

  console.log('\n-- booking closes 30 min after a led class starts, 60 min after Mysore (16 Nov 2026) --');
  {
    const MIN = 60000;
    const bkkOf = ms => new Date(ms + 7 * 3600e3).toISOString();
    const todayB = bkkOf(Date.now()).slice(0, 10);
    const wd = new Date(todayB + 'T12:00:00Z').getUTCDay();
    // A start on today's date about m minutes ago: 'up' started at most m minutes ago (and more
    // than m - 1), 'down' at least m minutes ago, so a second or two of test time never crosses a line.
    const ago = (m, way) => (way === 'up' ? Math.ceil : Math.floor)((Date.now() - m * MIN) / MIN) * MIN;
    const isoOf = ms => bkkOf(ms).slice(0, 16) + ':00+07:00';
    if (moonDaysBetween(todayB, todayB).size || bkkOf(ago(62, 'down')).slice(0, 10) !== todayB)
      console.log('  - SKIPPED (moon day today, or less than 62 minutes into the Bangkok day): the booking window');
    else {
      const slots = {};
      const mk = async (code, kind, startMs, online = false) => {
        const id = (await pool.query(`INSERT INTO bkk_class_slots (code,title,kind,weekday,start_time,duration_min,capacity,is_online)
          VALUES ($1,$2,$3,$4,$5,90,10,$6) RETURNING id`, [code, 'Window Test ' + code, kind, wd, bkkOf(startMs).slice(11, 16), online])).rows[0].id;
        slots[code] = { id, startMs, closeMs: Math.min(startMs + (kind === 'mysore' ? 60 : 30) * MIN, Date.parse(`${todayB}T00:00:00+07:00`) + 1440 * MIN) };
        return id;
      };
      await mk('test_win_led29', 'led_primary', ago(29, 'up'));
      await mk('test_win_led31', 'led_primary', ago(31, 'down'));
      await mk('test_win_my59', 'mysore', ago(59, 'up'));
      await mk('test_win_my61', 'mysore', ago(61, 'down'));
      await mk('test_win_on29', 'led_primary', ago(29, 'up'), true);
      await mk('test_win_on31', 'led_primary', ago(31, 'down'), true);
      await mk('test_win_null29', null, ago(29, 'up'));
      await mk('test_win_null31', null, ago(31, 'down'));
      await mk('test_win_other31', 'workshop', ago(31, 'down'));
      await mk('test_win_led20', 'led_primary', ago(20, 'up'));
      const addDay = (d, k) => new Date(Date.parse(d + 'T12:00:00Z') + k * 86400000).toISOString().slice(0, 10);
      const ydaySlot = (await pool.query(`INSERT INTO bkk_class_slots (code,title,kind,weekday,start_time,duration_min,capacity)
        VALUES ('test_win_yday','Window Test yday','led_primary',$1,'00:05',30,10) RETURNING id`, [(wd + 6) % 7])).rows[0].id;
      let n = 0;
      const holder = async () => (await post('/api/bkk/admin/passes',
        { name: `Ana Window${++n}`, email: `ana.window${n}@example.com`, productCode: 'pack8' }, ADMIN)).body.member.code;
      const book = async (code, slot, h = {}) => post('/api/bkk/bookings', { memberCode: code, slotId: slots[slot].id, date: todayB }, h);
      const left = async code => (await J('/api/bkk/me/' + code)).body.passes[0].creditsLeft;
      const CLOSED = 'booking for this class has closed';
      const tries = {};
      for (const k of ['led29', 'led31', 'my59', 'my61', 'on29', 'on31', 'null29', 'null31', 'other31']) {
        const code = await holder();
        tries[k] = { code, r: await book(code, 'test_win_' + k) };
        tries[k].left = await left(code);
      }
      const yes = k => tries[k].r.status === 200 && tries[k].r.body.booking && tries[k].left === 7;
      const no = k => tries[k].r.status === 409 && tries[k].r.body.error === CLOSED && tries[k].left === 8;
      const show = (...ks) => JSON.stringify(ks.map(k => [k, tries[k].r.status, tries[k].r.body.error || 'ok', tries[k].left]));
      ok('a led class 29 minutes after its start still books; 31 minutes after, "booking for this class has closed", no credit used',
         yes('led29') && no('led31'), show('led29', 'led31'));
      ok('Mysore: 59 minutes after its start still books; 61 minutes after it is closed', yes('my59') && no('my61'), show('my59', 'my61'));
      ok('an online led class follows the led rule (30 minutes)', yes('on29') && no('on31'), show('on29', 'on31'));
      ok('a class with no kind, or another kind, follows the 30-minute rule', yes('null29') && no('null31') && no('other31'),
         show('null29', 'null31', 'other31'));

      const drop = (slot, who) => post('/api/bkk/orders', { productCode: 'dropin', name: `Ana Drop${who}`,
        email: `ana.drop${who}@example.com`, slotId: slots[slot].id, date: todayB });
      const d20 = await drop('test_win_led20', 'a'), d31 = await drop('test_win_led31', 'b');
      const ordersOf = async email => (await pool.query(`SELECT o.slot_id, to_char(o.class_date,'YYYY-MM-DD') AS d FROM bkk_orders o
        JOIN bkk_members m ON m.id=o.member_id WHERE m.email=$1`, [email])).rows;
      const o20 = await ordersOf('ana.dropa@example.com'), o31 = await ordersOf('ana.dropb@example.com');
      ok('a drop-in order for a led class 20 minutes after its start is created, for that class',
         d20.status === 200 && o20.length === 1 && o20[0].slot_id === slots.test_win_led20.id && o20[0].d === todayB, JSON.stringify([d20.body, o20]).slice(0, 300));
      ok('...31 minutes after, it is refused ("booking for this class has closed"), and no order is made',
         d31.status === 409 && d31.body.error === CLOSED && o31.length === 0, JSON.stringify([d31.body, o31]));

      // Staff are unchanged: they may book, or add someone at the door, for the whole length of the class.
      const staffCode = await holder();
      const sb = await book(staffCode, 'test_win_led31', ADMIN);
      const wk = await post('/api/bkk/admin/walkin', { slotId: slots.test_win_my61.id, date: todayB, name: 'Ana Walkin', cover: 'rezerv' }, ADMIN);
      ok('staff still book a led class 31 minutes in, and the door still adds a walk-in to Mysore 61 minutes in',
         sb.status === 200 && sb.body.booking && sb.body.booking.source === 'staff' && wk.status === 200 && wk.body.success,
         JSON.stringify([sb.body, wk.body]).slice(0, 300));
      const mat = await post(`/api/bkk/bookings/${tries.led29.r.body.booking.id}/mat`, { memberCode: tries.led29.code, needMat: true });
      ok('a student still cannot change the mat once the class has begun', mat.status === 409 && mat.body.error === 'that class has already started',
         JSON.stringify(mat.body));
      const me29 = (await J('/api/bkk/me/' + tries.led29.code)).body;
      ok("/me: a seat in today's class that has begun is in startedToday (for the timetable), not in the upcoming bookings",
         me29.bookings.length === 0 && me29.startedToday.length === 1 && me29.startedToday[0].slot_id === slots.test_win_led29.id
           && me29.startedToday[0].classDate === todayB && me29.startedToday[0].id === tries.led29.r.body.booking.id,
         JSON.stringify({ bookings: me29.bookings, startedToday: me29.startedToday }));

      // The timetable keeps today's classes after they start, with when booking closes.
      const pub = (await J('/api/bkk/schedule?days=7')).body.classes, staffList = (await J('/api/bkk/schedule?days=7', { headers: ADMIN })).body.classes;
      const at = (list, code) => list.find(c => c.slotId === slots[code].id && c.date === todayB);
      const right = list => Object.entries(slots).every(([code, x]) => {
        const c = at(list, code);
        return c && c.started === true && c.bookUntil === isoOf(x.closeMs) && (c.closed === true) === (Date.now() >= x.closeMs);
      });
      ok("today's started classes stay on the timetable, each with its bookUntil, and closed once it has passed",
         right(pub) && right(staffList) && at(pub, 'test_win_my59').bookUntil === isoOf(slots.test_win_my59.startMs + 60 * MIN)
           && !('closed' in at(pub, 'test_win_my59')) && at(pub, 'test_win_my61').closed === true
           && at(pub, 'test_win_on29').closed === undefined && at(pub, 'test_win_null31').closed === true,
         JSON.stringify(Object.keys(slots).map(k => at(pub, k))).slice(0, 600));
      const later = pub.filter(c => c.date > todayB || Date.parse(c.startAt) > Date.now());
      ok('...a class still to come is neither started nor closed, and says when its booking will close',
         later.length > 0 && later.every(c => !('started' in c) && !('closed' in c) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+07:00$/.test(c.bookUntil)
           && Date.parse(c.bookUntil) === Math.min(Date.parse(c.startAt) + (c.kind === 'mysore' ? 60 : 30) * MIN,
             Date.parse(`${c.date}T00:00:00+07:00`) + 1440 * MIN)), JSON.stringify(later.slice(0, 2)));
      ok("...no class from an earlier day: yesterday's weekday shows up only 6 days on, today's only today",
         pub.every(c => c.date >= todayB) && pub.filter(c => c.slotId === ydaySlot).map(c => c.date).join()
             === (moonDaysBetween(addDay(todayB, 6), addDay(todayB, 6)).size ? '' : addDay(todayB, 6))
           && pub.filter(c => c.slotId === slots.test_win_led29.id).map(c => c.date).join() === todayB,
         JSON.stringify(pub.filter(c => c.date < todayB || c.slotId === ydaySlot).slice(0, 2)));
      ok('...and the public answer still has no capacity or booked count, seatsLeft at most 4',
         pub.every(c => !('capacity' in c) && !('booked' in c) && c.seatsLeft <= 4)
           && 'capacity' in at(staffList, 'test_win_led29') && at(staffList, 'test_win_led29').booked === 1, JSON.stringify(at(pub, 'test_win_led29')));
      await pool.query(`UPDATE bkk_class_slots SET active=false WHERE code LIKE 'test_win_%'`);
    }
  }

  console.log('\n-- the booking window to the millisecond, on a class clock the test sets --');
  {
    // A second server on its own class clock (opts.clock), so this runs at any hour: the exact
    // edges, and a late class whose window would run past Bangkok midnight. A day a few days on.
    let cc = 0;
    const appC = express();
    appC.use(express.json());
    await mountBkk(appC, { pgPool: pool, now, clock: () => cc });
    const srvC = appC.listen(0);
    const BC = `http://127.0.0.1:${srvC.address().port}`;
    const JC = async (path, o) => { const r = await fetch(BC + path, o); return { status: r.status, body: await r.json().catch(() => ({})) }; };
    const postC = (p, body, headers = {}) => JC(p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const plus = (d, k) => new Date(Date.parse(d + 'T12:00:00Z') + k * 86400000).toISOString().slice(0, 10);
    let D = plus(new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), 3);
    while (moonDaysBetween(D, plus(D, 1)).size) D = plus(D, 1);
    const D1 = plus(D, 1), at = (d, hms) => Date.parse(`${d}T${hms}+07:00`);
    const ids = {};
    for (const [k, kind, hhmm] of [['led', 'led_primary', '12:00'], ['my', 'mysore', '12:00'], ['led2330', 'led_primary', '23:30'], ['my2330', 'mysore', '23:30']])
      ids[k] = (await pool.query(`INSERT INTO bkk_class_slots (code,title,kind,weekday,start_time,duration_min,capacity)
        VALUES ($1,$2,$3,$4,$5,90,20) RETURNING id`, ['test_edge_' + k, 'Edge Test ' + k, kind, new Date(D + 'T12:00:00Z').getUTCDay(), hhmm])).rows[0].id;
    let n = 0;
    const holder = async () => (await post('/api/bkk/admin/passes',
      { name: `Ana Edge${++n}`, email: `ana.edge${n}@example.com`, productCode: 'pack8' }, ADMIN)).body.member.code;
    const CLOSED = 'booking for this class has closed';
    const bookAt = async (ms, k, h = {}) => {
      const code = await holder();
      cc = ms;
      const r = await postC('/api/bkk/bookings', { memberCode: code, slotId: ids[k], date: D }, h);
      return r.status === 200 && r.body.booking ? 'ok' : r.body.error;
    };
    const schedAt = async ms => { cc = ms; return (await JC('/api/bkk/schedule?days=2')).body; };
    const row = (s, k) => (s.classes || []).find(c => c.slotId === ids[k] && c.date === D) || null;

    const led = [await bookAt(at(D, '12:29:59.999'), 'led'), await bookAt(at(D, '12:30:00.000'), 'led')];
    const my = [await bookAt(at(D, '12:59:59.999'), 'my'), await bookAt(at(D, '13:00:00.000'), 'my')];
    ok('a led class books until 29:59.999 after its start and is closed at 30:00.000; Mysore at 59:59.999 and 60:00.000',
       led.join() === `ok,${CLOSED}` && my.join() === `ok,${CLOSED}`, JSON.stringify({ led, my }));
    const dropAt = async (ms, who) => {
      cc = ms;
      const r = await postC('/api/bkk/orders', { productCode: 'dropin', name: 'Ana EdgeDrop', email: `ana.edgedrop${who}@example.com`, slotId: ids.led, date: D });
      const rows = (await pool.query(`SELECT o.id FROM bkk_orders o JOIN bkk_members m ON m.id=o.member_id WHERE m.email=$1`, [`ana.edgedrop${who}@example.com`])).rows;
      return [r.status, r.body.error || 'ok', rows.length];
    };
    const dOk = await dropAt(at(D, '12:29:59.999'), 1), dNo = await dropAt(at(D, '12:30:00.000'), 2);
    ok('...a drop-in order the same: made at 29:59.999, refused at 30:00.000 with no order row',
       dOk.join() === '200,ok,1' && dNo.join() === `409,${CLOSED},0`, JSON.stringify([dOk, dNo]));
    const staffLate = await bookAt(at(D, '13:29:00'), 'led', ADMIN);
    ok('...staff still book the led class 89 minutes in', staffLate === 'ok', staffLate);

    const s1 = await schedAt(at(D, '12:29:59.999')), s2 = await schedAt(at(D, '12:30:00.000'));
    ok('the timetable says closed from the same millisecond the server refuses, and sends its own clock as now',
       row(s1, 'led').started === true && !('closed' in row(s1, 'led')) && row(s2, 'led').closed === true && !('closed' in row(s2, 'my'))
         && row(s2, 'led').bookUntil === `${D}T12:30:00+07:00` && row(s2, 'my').bookUntil === `${D}T13:00:00+07:00`
         && s1.now === at(D, '12:29:59.999') && s2.now === at(D, '12:30:00.000'), JSON.stringify([row(s1, 'led'), row(s2, 'led'), s2.now]));

    // A late Mysore would close at 00:30, but the timetable stops listing it at 00:00: it closes then.
    const late = await schedAt(at(D, '23:59:59.999'));
    const night = [await bookAt(at(D, '23:59:59.999'), 'my2330'), await bookAt(at(D1, '00:00:00.000'), 'my2330'),
      await bookAt(at(D1, '00:10:00'), 'my2330'), await bookAt(at(D1, '00:00:00.000'), 'led2330')];
    const next = await schedAt(at(D1, '00:00:00.000'));
    ok('a 23:30 Mysore books until 23:59:59.999 and closes at Bangkok midnight, when it leaves the timetable (not at 00:30)',
       night.join() === `ok,${CLOSED},${CLOSED},${CLOSED}` && row(late, 'my2330').bookUntil === `${D1}T00:00:00+07:00`
         && !('closed' in row(late, 'my2330')) && row(late, 'led2330').bookUntil === `${D1}T00:00:00+07:00`
         && !row(next, 'my2330') && !row(next, 'led2330') && (next.classes || []).every(c => c.date >= D1),
       JSON.stringify({ night, late: row(late, 'my2330'), next: row(next, 'my2330') }));
    await pool.query(`UPDATE bkk_class_slots SET active=false WHERE code LIKE 'test_edge_%'`);

    // Drop-ins 2 weeks ahead (19 Nov 2026), on a fixed day: today + 13 is Wed 2 Dec, + 14 is Thu 3 Dec, both working days.
    cc = at('2026-11-19', '12:00:00');
    const dayClass = async d => ((await JC(`/api/bkk/schedule?days=1&from=${d}`, { headers: ADMIN })).body.classes || [])
      .filter(c => c.date === d && !c.isOnline && c.seatsLeft > 1);
    const [in1] = await dayClass('2026-12-02'), [out1] = await dayClass('2026-12-03');
    const far1 = (await dayClass('2026-12-29'))[0] || (await dayClass('2026-12-30'))[0];
    const buyFor = (c, who) => postC('/api/bkk/orders', { productCode: 'dropin', name: who, email: `${who.replace(/ /g, '.').toLowerCase()}@example.com`, slotId: c.slotId, date: c.date });
    const bIn = await buyFor(in1, 'Edge In'), bOut = await buyFor(out1, 'Edge Out');
    ok('a drop-in sells for a class on day 14 (Wed 2 Dec, today + 13) and not on day 15 (Thu 3 Dec), on 19 Nov', in1 && out1
       && bIn.status === 200 && bIn.body.order && bOut.status === 409 && bOut.body.dropinUntil === '2026-12-02', JSON.stringify([bIn.status, bOut.body]));
    // A drop-in credit with no class yet (staff gave it, or its class was cancelled before payment).
    const credit = async who => (await post('/api/bkk/admin/passes', { name: who, email: `${who.replace(/ /g, '.').toLowerCase()}@example.com`, productCode: 'dropin' }, ADMIN)).body.member.code;
    const cr1 = await credit('Credit One'), cr2 = await credit('Credit Two');
    const useOut = await postC('/api/bkk/bookings', { memberCode: cr1, slotId: out1.slotId, date: out1.date });
    const useIn = await postC('/api/bkk/bookings', { memberCode: cr1, slotId: in1.slotId, date: in1.date });
    const staffOut = await postC('/api/bkk/bookings', { memberCode: cr2, slotId: out1.slotId, date: out1.date }, ADMIN);
    ok('a drop-in credit with no date books a class up to 2 Dec, not 3 Dec, as the student; staff can still use it for 3 Dec',
       useOut.status === 409 && useOut.body.dropinUntil === '2026-12-02' && /2 weeks before/.test(useOut.body.error)
         && useIn.status === 200 && staffOut.status === 200, JSON.stringify([useOut.body, useIn.body, staffOut.body]));
    const month1 = await post('/api/bkk/admin/passes', { name: 'Month Far', email: 'month.far@example.com', productCode: 'unlim1' }, ADMIN);
    const farBook = await postC('/api/bkk/bookings', { memberCode: month1.body.member.code, slotId: far1.slotId, date: far1.date });
    ok('...a 1-month pass still books a class 40 days off', far1 && farBook.status === 200, JSON.stringify(farBook.body));

    // The teacher-names reminder on real days, with nothing confirmed yet.
    await pool.query(`DELETE FROM bkk_settings WHERE key='teachers_shown_through'`);
    const bookingOn = async d => { cc = at(d, '10:00:00'); return (await JC('/api/bkk/admin/settings', { headers: ADMIN })).body.booking || {}; };
    const r24 = await bookingOn('2026-12-24'), r25 = await bookingOn('2026-12-25'), j3 = await bookingOn('2027-01-03'), f10 = await bookingOn('2027-02-10');
    ok('teacher names default to December 2026; the reminder starts 7 days before January (25 Dec), not on 24 Dec',
       r24.teachersThrough === '2026-12' && r24.teachersDue === false && r24.showMonth === '2027-01'
         && r25.teachersDue === true && r25.teachersLate === false && r25.showMonth === '2027-01', JSON.stringify([r24, r25]));
    ok('...and keeps warning once a month has started with no names, naming that month (never one already over)',
       j3.teachersDue === true && j3.teachersLate === true && j3.showMonth === '2027-01'
         && f10.teachersDue === true && f10.teachersLate === true && f10.showMonth === '2027-02', JSON.stringify([j3, f10]));
    const conf10 = await postC('/api/bkk/admin/settings', { teachersThrough: f10.showMonth }, ADMIN);
    ok('...its Show button month saves, and the warning goes', conf10.status === 200 && conf10.body.booking.teachersThrough === '2027-02'
       && conf10.body.booking.teachersDue === false && conf10.body.booking.showMonth === '2027-03', JSON.stringify(conf10.body.booking));
    await pool.query(`DELETE FROM bkk_settings WHERE key='teachers_shown_through'`);
    srvC.close();
  }

  // ── a Rezerv class they came to, taken from their aybkk.net pass (16 Nov 2026) ──
  console.log('\n— a Rezerv class taken from the pass —');
  {
    const one = async (sql, args = []) => (await pool.query(sql, args)).rows[0] || {};
    const todayB = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const d = k => new Date(Date.parse(todayB + 'T12:00:00Z') + k * 86400000).toISOString().slice(0, 10);
    const at = (day, t = '06:30') => `${day}T${t}:00+07:00`;
    const slot = (await one(`INSERT INTO bkk_class_slots (code,title,kind,weekday,start_time,duration_min,capacity,is_online,active)
      VALUES ('test_onto','Onto Led Primary','test',1,'06:30',90,30,false,false) RETURNING id`)).id;
    const mk = async (key, name = 'Onto ' + key) => (await one(`INSERT INTO bkk_members (code,name,email) VALUES ($1,$2,$3) RETURNING id`,
      ['BTESTOP' + key, name, `onto.${key.toLowerCase()}@example.com`])).id;
    const pass = async (member, code, o = {}) => (await one(`INSERT INTO bkk_passes
        (member_id,product_id,kind,credits_total,credits_used,daily_cap,valid_days,valid_from,valid_until,status,frozen_from,frozen_until,source)
      SELECT $1::int, id, kind, credits, $3::int, daily_cap, valid_days, $4::date, $5::date, $6::text, $7::date, $8::date, $9::text
      FROM bkk_products WHERE code=$2 RETURNING id`,
      [member, code, o.used || 0, o.from || null, o.until || null, o.status || 'active', o.ffrom || null, o.funtil || null,
       o.source === undefined ? 'order' : o.source])).id;
    // A Rezerv visit: on the list from Rezerv (no booked_at, as the import makes it),
    // checked in at our door unless in: false.
    const rz = async (member, day, o = {}) => (await one(`INSERT INTO bkk_bookings
        (slot_id,class_date,start_at,member_id,pass_id,status,checked_in_at,cover,source,via_member,booked_at)
      VALUES ($1,$2,$3,$4,$5,'booked',$6,$7,$8,$9,NULL) RETURNING id`,
      [o.slot === null ? null : slot, day, at(day, o.t), member, o.pass || null, o.in === false ? null : at(day, o.t),
       o.cover || (o.pass ? 'pass' : 'rezerv'), o.source || 'rezerv', o.via || null])).id;
    const onto = (id, body = {}, h = ADMIN) => post(`/api/bkk/admin/bookings/${id}/onto-pass`, body, h);
    const pOf = async id => one(`SELECT credits_used, to_char(valid_from,'YYYY-MM-DD') AS f, to_char(valid_until,'YYYY-MM-DD') AS u, note
      FROM bkk_passes WHERE id=$1`, [id]);
    const bOf = async id => one('SELECT pass_id, cover, moved_at, status FROM bkk_bookings WHERE id=$1', [id]);
    const hist = async key => (await J(`/api/bkk/admin/members/BTESTOP${key}/history`, { headers: ADMIN })).body;

    // 8 classes from four days ago; one taken at the door; today's class came in from Rezerv.
    const dan = await mk('EIGHT');
    const p8 = await pass(dan, 'pack8', { used: 1, from: d(-4), until: d(55) });
    await rz(dan, d(-2), { pass: p8, source: 'door', t: '07:00' });
    const today = await rz(dan, d(0));
    const h0 = await hist('EIGHT');
    const v0 = h0.visits.find(v => v.id === today);
    ok('setup: the Rezerv class shows on the profile as came, on Rezerv, on no pass, not moved',
       v0 && v0.status === 'attended' && v0.cover === 'rezerv' && v0.passId === null && v0.moved === false, JSON.stringify(v0));

    ok('taking a class from a pass needs the staff key', (await onto(today, {}, {})).status === 401);
    ok('an unknown booking is a 404', (await onto(999999999)).status === 404 && (await onto('12x')).status === 404);
    ok('a pass id that is not a number is refused', (await onto(today, { passId: 'abc' })).status === 400);
    const before = JSON.stringify([await pOf(p8), await bOf(today)]);
    const dry = await onto(today, { dryRun: true });
    ok('a dry run names the pass and what would be left: 6 of 8', dry.status === 200 && dry.body.dryRun === true
       && dry.body.pass.id === p8 && dry.body.pass.creditsLeft === 6 && dry.body.pass.creditsTotal === 8, JSON.stringify(dry.body));
    ok('...and changes nothing', JSON.stringify([await pOf(p8), await bOf(today)]) === before, before);

    const done = await onto(today, { reason: 'booked in Rezerv after buying here' });
    const p8a = await pOf(p8), ba = await bOf(today);
    ok('moved: the pass has 6 classes left, the class is on it, and its note says so', done.status === 200 && done.body.dryRun === false
       && done.body.pass.creditsLeft === 6 && p8a.credits_used === 2 && ba.pass_id === p8 && ba.cover === 'pass' && !!ba.moved_at
       && p8a.note.includes(`class ${d(0)} 06:30 moved from Rezerv onto this pass: booked in Rezerv after buying here`)
       && p8a.f === d(-4) && p8a.u === d(55), JSON.stringify([done.body, p8a, ba]));
    const h1 = await hist('EIGHT');
    const v1 = h1.visits.find(v => v.id === today), m1 = (h1.membership || []).find(p => p.passId === p8) || {};
    ok('...the profile shows it taken from the pass, and the pass at 6 left', v1.moved === true && v1.passId === p8
       && v1.cover === 'pass' && m1.creditsLeft === 6, JSON.stringify([v1, m1]));
    ok('...the same class cannot be taken twice', (await onto(today)).status === 409 && (await pOf(p8)).credits_used === 2);

    const undoDry = await onto(today, { undo: true, dryRun: true });
    ok('undo, dry run: 7 left after, nothing changed', undoDry.status === 200 && undoDry.body.pass.creditsLeft === 7
       && (await pOf(p8)).credits_used === 2 && (await bOf(today)).pass_id === p8, JSON.stringify(undoDry.body));
    const undo = await onto(today, { undo: true });
    const bu = await bOf(today);
    ok('undo puts it back on Rezerv and gives the class back', undo.status === 200 && undo.body.pass.creditsLeft === 7
       && (await pOf(p8)).credits_used === 1 && bu.pass_id === null && bu.cover === 'rezerv' && !bu.moved_at
       && (await pOf(p8)).note.endsWith(`class ${d(0)} 06:30 put back on Rezerv`), JSON.stringify([undo.body, bu]));
    ok('...and a class not moved here cannot be undone', (await onto(today, { undo: true })).status === 409
       && (await onto(await rz(dan, d(-1), { pass: p8, source: 'door' }), { undo: true })).status === 409);
    ok('moved again: 6 left (as the desk will do)', (await onto(today)).body.pass.creditsLeft === 6 && (await pOf(p8)).credits_used === 2);

    // What cannot be moved.
    const future = await rz(dan, d(2), { in: false });
    const fr = await onto(future);
    ok('a class they have not come to stays as it is', fr.status === 409 && /came to/.test(fr.body.error) && (await bOf(future)).pass_id === null,
       JSON.stringify(fr.body));
    const early = await rz(dan, d(-6));
    const er = await onto(early);
    ok('a class before the pass began is refused', er.status === 409 && /had not begun/.test(er.body.error) && er.body.notBegun === d(-4),
       JSON.stringify(er.body));
    const doorPass = await rz(dan, d(-3), { cover: 'pass', source: 'door' });
    ok('only a class on Rezerv can be moved', (await onto(doorPass)).status === 409);

    const rzOnly = await mk('RZONLY');
    await pass(rzOnly, 'pack8', { from: d(-10), until: d(20), source: 'rezerv' });
    const ro = await rz(rzOnly, d(0));
    ok('a pass moved from Rezerv is never used: Rezerv counted its classes', (await onto(ro)).status === 409 && (await bOf(ro)).pass_id === null);

    const full = await mk('FULL');
    const pf = await pass(full, 'pack8', { used: 8, from: d(-10), until: d(20) });
    ok('a pass with no class left is refused', (await onto(await rz(full, d(0)))).status === 409 && (await pOf(pf)).credits_used === 8);

    const paused = await mk('PAUSED');
    await pass(paused, 'pack8', { status: 'frozen', from: d(-10), until: d(40), ffrom: d(-3), funtil: d(5) });
    ok('a pass paused on the class day is refused', (await onto(await rz(paused, d(0)))).status === 409);
    ok('another student\'s pass is refused', (await onto(await rz(paused, d(-1)), { passId: p8 })).status === 409
       && (await pOf(p8)).credits_used === 2);

    // A pass whose days have not begun is never used, and its days never change here.
    const fresh = await mk('FRESH');
    const pn = await pass(fresh, 'pack8');
    await pool.query(`UPDATE bkk_passes SET created_at = now() - interval '5 days' WHERE id=$1`, [pn]);
    const fv = await rz(fresh, d(-1));
    const fm = await onto(fv, { dryRun: true });
    ok('a pass not begun yet is refused, and says it begins on its first class', fm.status === 409 && fm.body.notBegun === true
       && /had not begun on .*it begins on its first class/.test(fm.body.error), JSON.stringify(fm.body));
    const later8 = await mk('LATER');
    const pl8 = await pass(later8, 'pack8', { from: d(-2), until: d(58) });
    const lm = await onto(await rz(later8, d(-4)));
    ok('a class before the pass began is refused, naming the day it begins; its days stay', lm.status === 409 && lm.body.notBegun === d(-2)
       && (await pOf(pl8)).f === d(-2) && (await pOf(pl8)).credits_used === 0, JSON.stringify(lm.body));

    // Unlimited: nothing to take, the class is just on it.
    const un = await mk('UNLIM');
    const pu = await pass(un, 'unlim1', { from: d(-5), until: d(25) });
    const um = await onto(await rz(un, d(0)));
    ok('an unlimited pass takes the class and uses no class', um.status === 200 && um.body.pass.creditsLeft === null
       && (await pOf(pu)).credits_used === 0, JSON.stringify(um.body));

    // Undoing a merge: a class taken from a pass that ends up on another profile goes back to Rezerv with its student.
    const K = 'BTESTOPKEEP01', F = 'BTESTOPFOLD01';
    const kid = (await one(`INSERT INTO bkk_members (code,name,email) VALUES ($1,'Onto Merge','onto.keep@example.com') RETURNING id`, [K])).id;
    const fid = (await one(`INSERT INTO bkk_members (code,name) VALUES ($1,'Onto Merge') RETURNING id`, [F])).id;
    const pk = await pass(kid, 'pack8', { used: 2, from: d(-5), until: d(25) });
    const pf2 = await pass(fid, 'pack8', { from: d(-5), until: d(25) });
    const rv1 = await rz(fid, d(-1), { via: fid }), rv2 = await rz(fid, d(-2), { via: fid }), rv3 = await rz(fid, d(-3), { via: fid });
    const kv = await rz(kid, d(0), { via: kid });
    const mg = await post(`/api/bkk/admin/members/${K}/merge`, { from: F }, ADMIN);
    ok('setup: merged, the double\'s Rezerv visits on the keeper', mg.status === 200
       && (await one('SELECT count(*)::int AS n FROM bkk_bookings WHERE member_id=$1', [kid])).n === 4, JSON.stringify(mg.body));
    const rv4 = await rz(kid, d(-4), { via: fid }), rv5 = await rz(kid, d(-5), { via: fid });
    ok('setup: the double\'s visits taken from the keeper\'s pass and from its own, the keeper\'s own from the double\'s',
       (await onto(rv1, { passId: pk })).status === 200 && (await onto(rv3, { passId: pf2 })).status === 200
       && (await onto(kv, { passId: pf2 })).status === 200 && (await onto(rv5, { passId: pk })).status === 200
       && (await onto(rv4, { passId: pk })).status === 200);
    await post(`/api/bkk/bookings/${rv4}/cancel`, {}, ADMIN);
    ok('setup: one cancelled by staff: the class is back and it is off the pass',
       (await pOf(pk)).credits_used === 4 && (await pOf(pf2)).credits_used === 2 && (await bOf(rv4)).pass_id === null);
    const owner = async id => (await one('SELECT member_id FROM bkk_bookings WHERE id=$1', [id])).member_id;
    const um2 = await post(`/api/bkk/admin/members/${F}/unmerge`, {}, ADMIN);
    ok('undoing the merge: each class taken from a pass now on the other profile is back on Rezerv with its student, and that pass has it back',
       um2.status === 200 && um2.body.moves.undone === 3 && um2.body.moves.keptUsed === 0
       && await owner(rv1) === fid && await owner(rv5) === fid && await owner(kv) === kid
       && (await bOf(rv1)).pass_id === null && (await bOf(kv)).pass_id === null && !(await bOf(rv5)).moved_at
       && (await pOf(pk)).credits_used === 2 && /another student's, as a merge was undone/.test((await pOf(pk)).note), JSON.stringify(um2.body));
    ok('...one on the double\'s own pass goes back with it, still taken; the cancelled one and the untouched one go back as they were',
       await owner(rv3) === fid && (await bOf(rv3)).pass_id === pf2 && (await pOf(pf2)).credits_used === 1
       && (await one('SELECT member_id FROM bkk_passes WHERE id=$1', [pf2])).member_id === fid
       && await owner(rv2) === fid && await owner(rv4) === fid);

    // The Rezerv copy that took the class in is the double's, and the same undo takes it apart: the class still comes back.
    const K2 = 'BTESTOPKEEP03', F2 = 'BTESTOPFOLD03';
    const k2 = (await one(`INSERT INTO bkk_members (code,name,email) VALUES ($1,'Onto Split','onto.split@example.com') RETURNING id`, [K2])).id;
    const f2 = (await one(`INSERT INTO bkk_members (code,name) VALUES ($1,'Onto Split') RETURNING id`, [F2])).id;
    const pk2 = await pass(k2, 'pack8', { used: 2, from: d(-5), until: d(25) });
    await post(`/api/bkk/admin/members/${K2}/merge`, { from: F2 }, ADMIN);
    const sv = await rz(k2, d(-1), { via: f2 });
    await onto(sv, { passId: pk2 });
    await pool.query(`UPDATE bkk_passes SET credits_used=5 WHERE id=$1`, [pk2]);
    await pool.query(`INSERT INTO bkk_passes (member_id,product_id,kind,credits_total,credits_used,valid_days,valid_from,valid_until,status,source,twin_of,twin_undo,via_member)
      SELECT $1, id, kind, credits, 5, valid_days, $2::date, $3::date, 'void', 'rezerv', $4,
        jsonb_build_object('used', 2, 'status', 'active', 'on', $5::text, 'at', now()), $6
      FROM bkk_products WHERE code='pack8'`, [k2, d(-5), d(25), pk2, d(0), f2]);
    ok('setup: the double\'s Rezerv copy paired after the move took the class in (undo asks for a check)',
       (await onto(sv, { undo: true, dryRun: true })).body.needSure === true);
    const um3 = await post(`/api/bkk/admin/members/${F2}/unmerge`, {}, ADMIN);
    ok('...undoing the merge takes that pair apart first, so the keeper\'s pass ends where it was before the move',
       um3.status === 200 && um3.body.moves.undone === 1 && um3.body.moves.keptUsed === 0 && await owner(sv) === f2
       && (await pOf(pk2)).credits_used === 2, JSON.stringify([um3.body, await pOf(pk2)]));

    // The split never dates the kept pass from the other student's moved class.
    const K4 = 'BTESTOPKEEP04', F4 = 'BTESTOPFOLD04';
    const k4 = (await one(`INSERT INTO bkk_members (code,name,email) VALUES ($1,'Onto Dates','onto.dates@example.com') RETURNING id`, [K4])).id;
    const f4 = (await one(`INSERT INTO bkk_members (code,name) VALUES ($1,'Onto Dates') RETURNING id`, [F4])).id;
    const pk4 = await pass(k4, 'pack8');
    await post(`/api/bkk/admin/members/${K4}/merge`, { from: F4 }, ADMIN);
    const vd4 = (await one('SELECT valid_days FROM bkk_passes WHERE id=$1', [pk4])).valid_days;
    await pool.query(`UPDATE bkk_passes SET valid_from=$2::date, valid_until=$2::date + valid_days, credits_used=1 WHERE id=$1`, [pk4, d(-3)]);
    await pool.query(`INSERT INTO bkk_passes (member_id,product_id,kind,credits_total,credits_used,valid_days,valid_from,valid_until,status,source,twin_of,twin_undo,via_member)
      SELECT $1, id, kind, credits, 1, valid_days, $2::date, $3::date, 'void', 'rezerv', $4,
        jsonb_build_object('used', 1, 'status', 'active', 'from', $2::text, 'until', $3::text, 'untilWas', null, 'on', $5::text, 'at', now() - interval '1 hour'), $6
      FROM bkk_products WHERE code='pack8'`, [k4, d(-3), d(-3 + vd4), pk4, d(0), f4]);
    const v4 = await rz(k4, d(-1), { via: f4 });
    ok('setup: the double\'s class taken from the keeper\'s pass the double\'s Rezerv copy dated', (await onto(v4, { sure: true })).status === 200
       && (await pOf(pk4)).credits_used === 2);
    const um4 = await post(`/api/bkk/admin/members/${F4}/unmerge`, {}, ADMIN);
    const p4 = await pOf(pk4);
    ok('undoing the merge: the keeper\'s pass is not begun again and has nothing used, not dated from the double\'s class',
       um4.status === 200 && p4.f === null && p4.u === null && p4.credits_used === 0 && um4.body.moves.undone === 1, JSON.stringify([um4.body, p4]));

    // A staff-cancelled moved class kept used for a Rezerv copy: once the undo takes that copy away, the class comes back.
    const K5 = 'BTESTOPKEEP05', F5 = 'BTESTOPFOLD05';
    const k5 = (await one(`INSERT INTO bkk_members (code,name,email) VALUES ($1,'Onto Kept','onto.kept@example.com') RETURNING id`, [K5])).id;
    const f5 = (await one(`INSERT INTO bkk_members (code,name) VALUES ($1,'Onto Kept') RETURNING id`, [F5])).id;
    const pk5 = await pass(k5, 'pack8', { from: d(-5), until: d(25) });
    await post(`/api/bkk/admin/members/${K5}/merge`, { from: F5 }, ADMIN);
    const v5 = await rz(k5, d(-1), { via: f5 });
    await onto(v5);
    await pool.query(`INSERT INTO bkk_passes (member_id,product_id,kind,credits_total,credits_used,valid_days,valid_from,valid_until,status,source,twin_of,twin_undo,via_member)
      SELECT $1, id, kind, credits, 1, valid_days, $2::date, $3::date, 'void', 'rezerv', $4,
        jsonb_build_object('used', 0, 'status', 'active', 'on', $5::text, 'at', now()), $6
      FROM bkk_products WHERE code='pack8'`, [k5, d(-5), d(25), pk5, d(0), f5]);
    const c5 = await post(`/api/bkk/bookings/${v5}/cancel`, {}, ADMIN);
    ok('setup: staff cancel keeps it used, for the Rezerv copy', c5.body.creditReturned === false && (await pOf(pk5)).credits_used === 1);
    const um5 = await post(`/api/bkk/admin/members/${F5}/unmerge`, {}, ADMIN);
    ok('undoing the merge takes that copy away, so the keeper\'s pass gets the class back', um5.status === 200
       && (await pOf(pk5)).credits_used === 0 && (await bOf(v5)).pass_id === null && um5.body.moves.undone === 1, JSON.stringify(um5.body));

    // A seat the merge cancelled comes back after the moved classes give their passes their classes back.
    const K6 = 'BTESTOPKEEP06', F6 = 'BTESTOPFOLD06';
    const k6 = (await one(`INSERT INTO bkk_members (code,name,email) VALUES ($1,'Onto Seat2','onto.seat2@example.com') RETURNING id`, [K6])).id;
    const f6 = (await one(`INSERT INTO bkk_members (code,name) VALUES ($1,'Onto Seat2') RETURNING id`, [F6])).id;
    const pf6 = await pass(f6, 'pack8', { used: 7, from: d(-10), until: d(50) });
    const fseat6 = (await one(`INSERT INTO bkk_bookings (slot_id,class_date,start_at,member_id,pass_id,status,cover,source)
      VALUES ($1,$2,$3,$4,$5,'booked','pass','student') RETURNING id`, [slot, d(-2), at(d(-2)), f6, pf6])).id;
    await rz(k6, d(-2), { source: 'door', via: k6 });
    const mg6 = await post(`/api/bkk/admin/members/${K6}/merge`, { from: F6 }, ADMIN);
    ok('setup: the merge cancels the double\'s seat in the class both had, and gives its class back', mg6.status === 200
       && (await bOf(fseat6)).status === 'cancelled' && (await pOf(pf6)).credits_used === 6, JSON.stringify(mg6.body));
    for (const day of [-1, 0]) await onto(await rz(k6, d(day), { via: k6 }), { passId: pf6 });
    ok('setup: two of the keeper\'s own Rezerv classes fill the double\'s pass', (await pOf(pf6)).credits_used === 8);
    const um6 = await post(`/api/bkk/admin/members/${F6}/unmerge`, {}, ADMIN);
    ok('undoing the merge: those two go back to Rezerv first, then the double\'s seat is booked again on its pass', um6.status === 200
       && um6.body.seatsNotBack === 0 && (await bOf(fseat6)).status === 'booked' && (await pOf(pf6)).credits_used === 7, JSON.stringify(um6.body));

    // The kept student's own class, cancelled and kept used for the double's Rezerv copy: once the undo takes that copy away, it comes back.
    const K7 = 'BTESTOPKEEP07', F7 = 'BTESTOPFOLD07';
    const k7 = (await one(`INSERT INTO bkk_members (code,name,email) VALUES ($1,'Onto Own','onto.own@example.com') RETURNING id`, [K7])).id;
    const f7 = (await one(`INSERT INTO bkk_members (code,name) VALUES ($1,'Onto Own') RETURNING id`, [F7])).id;
    const pk7 = await pass(k7, 'pack8', { from: d(-5), until: d(25) });
    await post(`/api/bkk/admin/members/${K7}/merge`, { from: F7 }, ADMIN);
    const v7 = await rz(k7, d(-1), { via: k7 });
    await onto(v7);
    await pool.query(`UPDATE bkk_passes SET credits_used=2 WHERE id=$1`, [pk7]);
    await pool.query(`INSERT INTO bkk_passes (member_id,product_id,kind,credits_total,credits_used,valid_days,valid_from,valid_until,status,source,twin_of,twin_undo,via_member)
      SELECT $1, id, kind, credits, 2, valid_days, $2::date, $3::date, 'void', 'rezerv', $4,
        jsonb_build_object('used', 1, 'status', 'active', 'on', $5::text, 'at', now()), $6
      FROM bkk_products WHERE code='pack8'`, [k7, d(-5), d(25), pk7, d(0), f7]);
    const c7 = await post(`/api/bkk/bookings/${v7}/cancel`, {}, ADMIN);
    const um7 = await post(`/api/bkk/admin/members/${F7}/unmerge`, {}, ADMIN);
    ok('the kept student\'s cancelled class kept used for the double\'s copy: the undo takes the copy away and gives the class back',
       c7.body.creditReturned === false && um7.status === 200 && (await pOf(pk7)).credits_used === 0 && (await bOf(v7)).pass_id === null
       && await owner(v7) === k7 && um7.body.moves.givenBack === 1 && um7.body.moves.undone === 0, JSON.stringify([um7.body, await pOf(pk7)]));
    // The same, but staff gave it back by hand (Undo, as the page says) before the merge was undone: never given twice.
    const K9 = 'BTESTOPKEEP09', F9 = 'BTESTOPFOLD09';
    const k9 = (await one(`INSERT INTO bkk_members (code,name,email) VALUES ($1,'Onto Twice','onto.twice@example.com') RETURNING id`, [K9])).id;
    const f9 = (await one(`INSERT INTO bkk_members (code,name) VALUES ($1,'Onto Twice') RETURNING id`, [F9])).id;
    const pk9 = await pass(k9, 'pack8', { from: d(-5), until: d(25) });
    await post(`/api/bkk/admin/members/${K9}/merge`, { from: F9 }, ADMIN);
    const v9 = await rz(k9, d(-1), { via: k9 });
    await onto(v9);
    await pool.query(`UPDATE bkk_passes SET credits_used=2 WHERE id=$1`, [pk9]);
    await pool.query(`INSERT INTO bkk_passes (member_id,product_id,kind,credits_total,credits_used,valid_days,valid_from,valid_until,status,source,twin_of,twin_undo,via_member)
      SELECT $1, id, kind, credits, 2, valid_days, $2::date, $3::date, 'void', 'rezerv', $4,
        jsonb_build_object('used', 1, 'status', 'active', 'on', $5::text, 'at', now()), $6
      FROM bkk_products WHERE code='pack8'`, [k9, d(-5), d(25), pk9, d(0), f9]);
    await post(`/api/bkk/bookings/${v9}/cancel`, {}, ADMIN);
    await onto(v9, { undo: true, sure: true });
    const um9 = await post(`/api/bkk/admin/members/${F9}/unmerge`, {}, ADMIN);
    ok('given back by hand with Undo before the merge was undone: the undo does not give it a second time', um9.status === 200
       && (await pOf(pk9)).credits_used === 0 && um9.body.moves.givenBack === 0, JSON.stringify([um9.body, await pOf(pk9)]));

    // The kept student's own door visit covered by Rezerv, taken from the double's pass, stays with them.
    const K8 = 'BTESTOPKEEP08', F8 = 'BTESTOPFOLD08';
    const k8 = (await one(`INSERT INTO bkk_members (code,name,email) VALUES ($1,'Onto Door','onto.door@example.com') RETURNING id`, [K8])).id;
    const f8 = (await one(`INSERT INTO bkk_members (code,name) VALUES ($1,'Onto Door') RETURNING id`, [F8])).id;
    const pf8 = await pass(f8, 'pack8', { from: d(-5), until: d(25) });
    const door8 = await rz(k8, d(-1), { source: 'door' });
    await post(`/api/bkk/admin/members/${K8}/merge`, { from: F8 }, ADMIN);
    await onto(door8, { passId: pf8 });
    const um8 = await post(`/api/bkk/admin/members/${F8}/unmerge`, {}, ADMIN);
    ok('the kept student\'s own door visit (covered by Rezerv) taken from the double\'s pass stays with them, and that pass gets the class back',
       um8.status === 200 && await owner(door8) === k8 && (await bOf(door8)).pass_id === null && (await pOf(pf8)).credits_used === 0
       && um8.body.moves.undone === 1, JSON.stringify(um8.body));

    // Kept used through an undone merge (the keeper's own Rezerv copy may have counted it): off the pass, so only Extend gives it back.
    const K10 = 'BTESTOPKEEP10', F10 = 'BTESTOPFOLD10';
    const k10 = (await one(`INSERT INTO bkk_members (code,name,email) VALUES ($1,'Onto Stays','onto.stays@example.com') RETURNING id`, [K10])).id;
    const f10 = (await one(`INSERT INTO bkk_members (code,name) VALUES ($1,'Onto Stays') RETURNING id`, [F10])).id;
    const pk10 = await pass(k10, 'pack8', { used: 3, from: d(-5), until: d(25) });
    await post(`/api/bkk/admin/members/${K10}/merge`, { from: F10 }, ADMIN);
    const v10 = await rz(k10, d(-1), { via: f10 });
    await onto(v10, { passId: pk10 });
    await pool.query(`INSERT INTO bkk_passes (member_id,product_id,kind,credits_total,credits_used,valid_days,valid_from,valid_until,status,source,twin_of,twin_undo,via_member)
      SELECT $1, id, kind, credits, 4, valid_days, $2::date, $3::date, 'void', 'rezerv', $4,
        jsonb_build_object('used', 0, 'status', 'active', 'on', $5::text, 'at', now()), $1
      FROM bkk_products WHERE code='pack8'`, [k10, d(-5), d(25), pk10, d(0)]);
    const um10 = await post(`/api/bkk/admin/members/${F10}/unmerge`, {}, ADMIN);
    ok('undoing the merge: the double\'s class the keeper\'s own Rezerv copy may have counted goes back to the double, stays used, and is off the pass',
       um10.status === 200 && um10.body.moves.keptUsed === 1 && await owner(v10) === f10 && (await bOf(v10)).pass_id === null
       && (await pOf(pk10)).credits_used === 4 && /still used/.test((await pOf(pk10)).note)
       && (await onto(v10, { undo: true, dryRun: true })).status === 409, JSON.stringify(um10.body));

    // Rezerv may have paid already: a person checks first.
    const tw = await mk('TWIN');
    const pt = await pass(tw, 'pack8', { used: 3, from: d(-5), until: d(55) });
    await pool.query(`INSERT INTO bkk_passes (member_id,product_id,kind,credits_total,credits_used,valid_days,valid_from,valid_until,status,source,twin_of,twin_undo)
      SELECT $1, id, kind, credits, 3, valid_days, $2::date, $3::date, 'void', 'rezerv', $4, '{"used":3,"status":"active"}'::jsonb
      FROM bkk_products WHERE code='pack8'`, [tw, d(-5), d(55), pt]);
    const tv = await rz(tw, d(-1));
    const tdry = await onto(tv, { dryRun: true });
    ok('a pass whose Rezerv copy brought 3 used classes over: the dry run asks for a check', tdry.status === 200
       && tdry.body.needSure === true && tdry.body.check.why === 'copy' && tdry.body.check.classes === 3
       && /already took 3 classes used on its Rezerv copy/.test(tdry.body.warning), JSON.stringify(tdry.body));
    const tno = await onto(tv);
    ok('...without sure:true nothing is taken', tno.status === 409 && tno.body.needSure === true && /sure:true/.test(tno.body.error)
       && (await pOf(pt)).credits_used === 3 && (await bOf(tv)).pass_id === null, JSON.stringify(tno.body));
    const tyes = await onto(tv, { sure: true, passId: pt });
    ok('...with sure:true it is taken, and the note says it was checked', tyes.status === 200 && (await pOf(pt)).credits_used === 4
       && (await pOf(pt)).note.includes('after a check: this pass already took 3 classes'), JSON.stringify(tyes.body));
    await pool.query(`UPDATE bkk_passes SET created_at = now() - interval '3 days' WHERE twin_of=$1`, [pt]);
    const tlater = await onto(await rz(tw, d(0)), { dryRun: true });
    ok('a Rezerv class after the copy came over is not one it counted: no check', tlater.status === 200 && !tlater.body.needSure,
       JSON.stringify(tlater.body));
    const tw0 = await mk('TWINZERO');
    const pt0 = await pass(tw0, 'pack8', { used: 1, from: d(-5), until: d(55) });
    await pool.query(`INSERT INTO bkk_passes (member_id,product_id,kind,credits_total,credits_used,valid_days,valid_from,valid_until,status,source,twin_of,twin_undo)
      SELECT $1, id, kind, credits, 1, valid_days, $2::date, $3::date, 'void', 'rezerv', $4, '{"used":0,"status":"active"}'::jsonb
      FROM bkk_products WHERE code='pack8'`, [tw0, d(-5), d(55), pt0]);
    const t0 = await onto(await rz(tw0, d(-1)));
    ok('a copy that brought nothing over (its classes were counted here already): taken with no check', t0.status === 200
       && !t0.body.needSure && (await pOf(pt0)).credits_used === 2, JSON.stringify(t0.body));

    // A Rezerv copy of their OTHER pass counted the class: still a check, naming that pass.
    const two = await mk('TWOPASS');
    const pfull = await pass(two, 'pack8', { used: 8, from: d(-30), until: d(30) });
    await pool.query(`INSERT INTO bkk_passes (member_id,product_id,kind,credits_total,credits_used,valid_days,valid_from,valid_until,status,source,twin_of,twin_undo)
      SELECT $1, id, kind, credits, 5, valid_days, $2::date, $3::date, 'void', 'rezerv', $4, '{"used":5,"status":"active"}'::jsonb
      FROM bkk_products WHERE code='pack8'`, [two, d(-30), d(30), pfull]);
    const pnew = await pass(two, 'pack8', { from: d(-10), until: d(50) });
    const odry = await onto(await rz(two, d(-5)), { dryRun: true });
    ok('a Rezerv copy of their other pass brought classes over: the dry run asks for a check and names that pass', odry.status === 200
       && odry.body.pass.id === pnew && odry.body.needSure === true && odry.body.check.why === 'copy' && odry.body.check.passId === pfull
       && odry.body.check.same === false && /their other pass \(8 classes/.test(odry.body.warning), JSON.stringify(odry.body));
    // The day the classes came over is the pairing day (twin_undo.on), not the day the copy was first imported.
    const late2 = await mk('LATEPAIR');
    const plp = await pass(late2, 'pack8', { used: 3, from: d(-20), until: d(40) });
    await pool.query(`INSERT INTO bkk_passes (member_id,product_id,kind,credits_total,credits_used,valid_days,valid_from,valid_until,status,source,twin_of,twin_undo,created_at)
      SELECT $1, id, kind, credits, 3, valid_days, $2::date, $3::date, 'void', 'rezerv', $4, jsonb_build_object('used', 3, 'status', 'active', 'on', $5::text),
        now() - interval '15 days' FROM bkk_products WHERE code='pack8'`, [late2, d(-20), d(40), plp, d(-1)]);
    const lpd = await onto(await rz(late2, d(-6)), { dryRun: true });
    ok('a copy first imported 15 days ago but paired yesterday: a class 6 days ago still gets the check, dated the pairing day',
       lpd.status === 200 && lpd.body.needSure === true && lpd.body.check.on === d(-1), JSON.stringify(lpd.body));

    const both = await mk('BOTHPKG');
    const pb = await pass(both, 'pack8', { from: d(-5), until: d(55) });
    await pass(both, 'pack8', { from: d(-30), until: d(1), source: 'rezerv', status: 'void' });
    const bdry = await onto(await rz(both, d(-1)), { dryRun: true });
    ok('a Rezerv package of theirs ran that day (even one used up in Rezerv): the dry run asks for a check',
       bdry.status === 200 && bdry.body.needSure === true && bdry.body.check.why === 'rezerv' && bdry.body.check.until === d(1)
       && (await pOf(pb)).credits_used === 0, JSON.stringify(bdry.body));

    // Staff cancel a moved class: the class goes back, and it no longer reads as taken from the pass.
    const cx = await mk('CANCEL');
    const pc = await pass(cx, 'pack8', { from: d(-5), until: d(55) });
    const cv = await rz(cx, d(-1));
    await onto(cv);
    const cc = await post(`/api/bkk/bookings/${cv}/cancel`, {}, ADMIN);
    const ch = (await hist('CANCEL')).visits.find(v => v.id === cv);
    ok('staff cancelling a class they took from the pass gives the class back, and it is a plain Rezerv class again',
       cc.status === 200 && cc.body.creditReturned === true && (await pOf(pc)).credits_used === 0 && ch.moved === false
       && ch.status === 'cancelled' && (await bOf(cv)).pass_id === null && (await bOf(cv)).cover === 'rezerv', JSON.stringify([cc.body, ch]));
    ok('...and a cancelled one cannot be undone', (await onto(cv, { undo: true })).status === 409 && (await pOf(pc)).credits_used === 0);

    // A student cannot cancel a class staff took from their pass; closing the class gives it back as a staff cancel does.
    const st2 = await mk('STUCANCEL');
    const pst = await pass(st2, 'pack8', { from: d(-10), until: d(50) });
    const sv2 = await rz(st2, d(-8));
    await onto(sv2);
    const scn = await post(`/api/bkk/bookings/${sv2}/cancel`, { memberCode: 'BTESTOPSTUCANCEL' });
    ok('a student cancelling a class staff took from their pass is told to ask the shala', scn.status === 409
       && /ask the shala/.test(scn.body.error) && (await pOf(pst)).credits_used === 1, JSON.stringify(scn.body));
    const close = await post('/api/bkk/admin/classes/cancel', { slotId: slot, date: d(-8), reason: 'test' }, ADMIN);
    ok('closing that class gives the class back and takes it off the pass', close.status === 200 && (await pOf(pst)).credits_used === 0
       && (await bOf(sv2)).status === 'cancelled' && (await bOf(sv2)).pass_id === null, JSON.stringify(close.body));

    // Closing a class with a moved class a Rezerv copy may have counted: it stays used and the reply says so.
    const ck = await mk('CLOSEKEPT');
    const pck = await pass(ck, 'pack8', { from: d(-12), until: d(50) });
    const ckv = await rz(ck, d(-9));
    await onto(ckv);
    await pool.query(`INSERT INTO bkk_passes (member_id,product_id,kind,credits_total,credits_used,valid_days,valid_from,valid_until,status,source,twin_of,twin_undo)
      SELECT $1, id, kind, credits, 1, valid_days, $2::date, $3::date, 'void', 'rezerv', $4,
        jsonb_build_object('used', 0, 'status', 'active', 'on', $5::text, 'at', now())
      FROM bkk_products WHERE code='pack8'`, [ck, d(-12), d(50), pck, d(0)]);
    const ckc = await post('/api/bkk/admin/classes/cancel', { slotId: slot, date: d(-9), reason: 'test' }, ADMIN);
    ok('closing a class: a moved class a Rezerv copy may have counted stays used, the reply counts it, and its student gets no mail',
       ckc.status === 200 && ckc.body.keptUsed === 1 && ckc.body.notified === 0 && (await pOf(pck)).credits_used === 1
       && (await bOf(ckv)).pass_id === pck && /closed, still used/.test((await pOf(pck)).note), JSON.stringify(ckc.body));

    // The check-in taken off after the move: Undo is still offered, and works.
    const ux = await mk('UNCHECK');
    const pux = await pass(ux, 'pack8', { from: d(-5), until: d(55) });
    const uv = await rz(ux, d(-1));
    await onto(uv);
    await pool.query('UPDATE bkk_bookings SET checked_in_at=NULL WHERE id=$1', [uv]);
    const uh = (await hist('UNCHECK')).visits.find(v => v.id === uv);
    ok('a moved class with its check-in taken off still shows as moved (the page offers Undo)', uh.moved === true, JSON.stringify(uh));
    ok('...and undo gives the class back', (await onto(uv, { undo: true })).status === 200 && (await pOf(pux)).credits_used === 0);

    // Merging two profiles with the same class: the one taken from a pass stays.
    const MK = 'BTESTOPKEEP02', MF = 'BTESTOPFOLD02';
    const mkid = (await one(`INSERT INTO bkk_members (code,name,email) VALUES ($1,'Onto Seat','onto.seat@example.com') RETURNING id`, [MK])).id;
    const mfid = (await one(`INSERT INTO bkk_members (code,name) VALUES ($1,'Onto Seat') RETURNING id`, [MF])).id;
    const pmf = await pass(mfid, 'pack8', { from: d(-5), until: d(55) });
    const kseat = await rz(mkid, d(-1), { source: 'door' });
    const fseat = await rz(mfid, d(-1));
    ok('setup: the double\'s Rezerv class is taken from its pass', (await onto(fseat)).status === 200 && (await pOf(pmf)).credits_used === 1);
    const mg2 = await post(`/api/bkk/admin/members/${MK}/merge`, { from: MF }, ADMIN);
    const st = async id => (await one('SELECT status, pass_id FROM bkk_bookings WHERE id=$1', [id]));
    ok('merging keeps the seat taken from the pass and cancels the unpaid one; the class stays used', mg2.status === 200
       && (await st(fseat)).status === 'booked' && (await st(kseat)).status === 'cancelled' && (await pOf(pmf)).credits_used === 1,
       JSON.stringify([mg2.body, await st(fseat), await st(kseat)]));

    // A class already on a pass that day, and a Rezerv row with no time: maybe the same class.
    const sd = await mk('SAMEDAY');
    const psd = await pass(sd, 'pack8', { used: 1, from: d(-5), until: d(55) });
    await rz(sd, d(-1), { pass: psd, source: 'student', t: '07:00' });
    const notime = await rz(sd, d(-1), { slot: null, t: '00:00' });
    const sdd = await onto(notime, { dryRun: true });
    ok('a Rezerv row with no time on a day they already have a class on the pass: the dry run asks for a check', sdd.status === 200
       && sdd.body.needSure === true && sdd.body.checks.some(k => k.why === 'sameDay' && k.time === '07:00'), JSON.stringify(sdd.body));
    ok('...and without sure:true nothing is taken', (await onto(notime)).status === 409 && (await pOf(psd)).credits_used === 1);
    const other = await rz(sd, d(-2), { slot: null, t: '18:00' });
    await rz(sd, d(-2), { pass: psd, source: 'student', t: '07:00' });
    const odd = await onto(other, { dryRun: true });
    ok('...but a class at another time that day is no check', odd.status === 200 && !odd.body.needSure, JSON.stringify(odd.body));

    // A Rezerv copy of the pass paired after the move may have counted the class: undo and a staff cancel keep it used.
    const ab = await mk('ABSORB');
    const pab = await pass(ab, 'pack8', { from: d(-5), until: d(55) });
    const abv = await rz(ab, d(-1)), abw = await rz(ab, d(-2));
    await onto(abv); await onto(abw);
    await pool.query(`UPDATE bkk_passes SET credits_used=3 WHERE id=$1`, [pab]);
    await pool.query(`INSERT INTO bkk_passes (member_id,product_id,kind,credits_total,credits_used,valid_days,valid_from,valid_until,status,source,twin_of,twin_undo)
      SELECT $1, id, kind, credits, 3, valid_days, $2::date, $3::date, 'void', 'rezerv', $4,
        jsonb_build_object('used', 1, 'status', 'active', 'on', $5::text, 'at', now())
      FROM bkk_products WHERE code='pack8'`, [ab, d(-5), d(55), pab, d(0)]);
    const abu = await onto(abv, { undo: true, dryRun: true });
    ok('undo after the Rezerv copy came over: the dry run asks for a check first, and keeps the class used', abu.status === 200
       && abu.body.needSure === true && abu.body.check.why === 'carried' && abu.body.check.classes === 3 && abu.body.check.on === d(0)
       && (await pOf(pab)).credits_used === 3, JSON.stringify(abu.body));
    const abn = await onto(abv, { undo: true });
    ok('...without sure:true nothing is given back', abn.status === 409 && abn.body.needSure === true && abn.body.carried.classes === 3
       && (await pOf(pab)).credits_used === 3 && (await bOf(abv)).pass_id === pab, JSON.stringify(abn.body));
    const abc = await post(`/api/bkk/bookings/${abw}/cancel`, {}, ADMIN);
    ok('...and a staff cancel gives no class back either, and says why', abc.status === 200 && abc.body.creditReturned === false
       && abc.body.carried && abc.body.carried.on === d(0) && (await pOf(pab)).credits_used === 3, JSON.stringify(abc.body));
    const abl = await rz(ab, d(-3));
    await onto(abl, { sure: true });
    await pool.query(`UPDATE bkk_bookings SET booked_at = now() WHERE id=$1`, [abl]);
    await pool.query(`UPDATE bkk_passes SET twin_undo = twin_undo || jsonb_build_object('at', now()) WHERE twin_of=$1`, [pab]);
    const before3 = (await pOf(pab)).credits_used;
    const abx = await post(`/api/bkk/bookings/${abl}/cancel`, {}, ADMIN);
    ok('...even one staff added after the class was over: no class back once a Rezerv copy may have counted it',
       abx.status === 200 && abx.body.creditReturned === false && abx.body.carried && (await pOf(pab)).credits_used === before3, JSON.stringify(abx.body));
    const abh = (await hist('ABSORB')).visits.find(v => v.id === abw);
    ok('a cancelled class kept used still shows as taken from the pass, so the profile offers Undo on it', abh.moved === true
       && abh.status === 'cancelled', JSON.stringify(abh));
    const aby = await onto(abw, { undo: true, sure: true });
    ok('...and Undo with sure:true, after a check, gives it back once and takes it off the pass (the booking records it)', aby.status === 200
       && (await pOf(pab)).credits_used === before3 - 1 && (await bOf(abw)).pass_id === null && (await bOf(abw)).status === 'cancelled'
       && (await hist('ABSORB')).visits.find(v => v.id === abw).moved === false, JSON.stringify(aby.body));
    const aby2 = await onto(abv, { undo: true, sure: true });
    ok('...the same for one still on the list', aby2.status === 200 && (await pOf(pab)).credits_used === before3 - 2
       && (await bOf(abv)).pass_id === null && /after a check: the Rezerv import counted/.test((await pOf(pab)).note), JSON.stringify(aby2.body));
    const ab2 = await mk('ABSORB2');
    const pab2 = await pass(ab2, 'pack8', { used: 3, from: d(-5), until: d(55) });
    await pool.query(`INSERT INTO bkk_passes (member_id,product_id,kind,credits_total,credits_used,valid_days,valid_from,valid_until,status,source,twin_of,twin_undo)
      SELECT $1, id, kind, credits, 3, valid_days, $2::date, $3::date, 'void', 'rezerv', $4,
        jsonb_build_object('used', 0, 'status', 'active', 'on', $5::text, 'at', now() - interval '1 hour')
      FROM bkk_products WHERE code='pack8'`, [ab2, d(-5), d(55), pab2, d(0)]);
    const ab2v = await rz(ab2, d(-1));
    await onto(ab2v);
    ok('a copy paired earlier the same day, before the move, cannot have counted it: undo gives the class back',
       (await onto(ab2v, { undo: true })).status === 200 && (await pOf(pab2)).credits_used === 3);

    // A later Rezerv visits file never cancels a class staff took from the pass.
    const imp = (kind, rows) => post(`/api/bkk/admin/import/${kind}`, { rows, dryRun: false }, ADMIN);
    const iv = (await one(`INSERT INTO bkk_members (code,name,rezerv_id,source) VALUES ('BTESTOPIMP01','Onto Import','RZ-ONTO1','rezerv') RETURNING id`)).id;
    const piv = await pass(iv, 'pack8', { from: d(-5), until: d(55) });
    const row = { rezervId: 'V-ONTO-1', memberRezervId: 'RZ-ONTO1', name: 'Onto Import', date: d(-1), time: '06:00', className: 'Onto Rezerv class' };
    const i1 = await imp('visits', [{ ...row, status: 'Attended' }]);
    const ivb = (await one(`SELECT id FROM bkk_bookings WHERE member_id=$1 AND source='rezerv'`, [iv])).id;
    ok('setup: the Rezerv visit came in as came, and is taken from the pass', i1.body.added === 1 && (await onto(ivb)).status === 200
       && (await pOf(piv)).credits_used === 1, JSON.stringify(i1.body));
    await pool.query('UPDATE bkk_bookings SET checked_in_at=NULL WHERE id=$1', [ivb]);
    const i2 = await imp('visits', [{ ...row, status: 'Cancelled' }]);
    const ivr = await bOf(ivb);
    ok('a later file saying cancelled leaves it on the pass as staff left it', i2.body.matched === 1 && ivr.status === 'booked'
       && ivr.pass_id === piv && (await pOf(piv)).credits_used === 1, JSON.stringify([i2.body, ivr]));

    await pool.query(`DELETE FROM bkk_bookings WHERE member_id IN (SELECT id FROM bkk_members WHERE code LIKE 'BTESTOP%')`);
    await pool.query(`DELETE FROM bkk_passes WHERE member_id IN (SELECT id FROM bkk_members WHERE code LIKE 'BTESTOP%')`);
    await pool.query(`DELETE FROM bkk_class_overrides WHERE slot_id=$1`, [slot]);
    await pool.query(`DELETE FROM bkk_class_slots WHERE id=$1`, [slot]);
  }

  console.log('\n- Show QR: a one-time sign-in the student scans at the desk (17 Nov 2026) -');
  {
    const QRCode = require('qrcode');
    const SHORTC = /^[23456789abcdefghjkmnpqrstuvwxyz]{10}$/;
    const ana = 'BTESTQRANA0001', ben = 'BTESTQRBEN0001';
    await pool.query(`INSERT INTO bkk_members (code,name) VALUES ($1,'Ana Qrexample'), ($2,'Ben Qrexample')`, [ana, ben]);
    const qr = (code, body = {}, h = ADMIN) => post(`/api/bkk/admin/members/${code}/signin-qr`, body, h);
    const status = (short, h = ADMIN) => J(`/api/bkk/admin/signin-qr/${short}/status`, { headers: h });
    let ipN = 0;
    const open = code => fetch(`${B}/in/${code}`, { redirect: 'manual', headers: { 'x-forwarded-for': `10.90.0.${++ipN}` } });
    const row = async short => (await pool.query('SELECT * FROM bkk_login_tokens WHERE short_code=$1', [short])).rows[0];
    const links = async () => (await J('/api/bkk/admin/progress', { headers: ADMIN })).body.links;
    // Reads the qrcode SVG path back into modules: "M x y.5" moves, "m dx 0" skips, "h n" paints n dark ones.
    const modules = svg => {
      const size = Number((/viewBox="0 0 (\d+) \1"/.exec(svg) || [])[1]);
      const dark = new Set();
      const d = (/<path stroke="#000000" d="([^"]+)"/.exec(svg) || [])[1] || '';
      let x = 0, y = 0;
      for (const [, op, a, b] of d.matchAll(/([Mmh])(-?[\d.]+)(?: (-?[\d.]+))?/g)) {
        if (op === 'M') { x = Number(a); y = Math.floor(Number(b)); }
        else if (op === 'm') { x += Number(a); y += Math.floor(Number(b)); }
        else { for (let i = 0; i < Number(a); i++) dark.add(`${x + i},${y}`); x += Number(a); }
      }
      return { size, dark };
    };

    ok('signin-qr needs the staff key', (await qr(ana, {}, {})).status === 401);
    ok('...and an unknown member is a 404', (await qr('BNOSUCHPERSON0')).status === 404);

    const a1 = await qr(ana, { origin: 'https://aybkk.net' });
    const t0 = Date.now();
    ok('a QR answer: name, short code, a short link on the site the desk page is on',
       a1.status === 200 && a1.body.name === 'Ana Qrexample' && SHORTC.test(a1.body.short_code || '')
         && a1.body.short_link === `https://aybkk.net/in/${a1.body.short_code}`, JSON.stringify(a1.body).slice(0, 200));
    ok('...works for 10 minutes', a1.body.expiresIn === 600
       && Math.abs(Date.parse(a1.body.expiresAt) - t0 - 600000) < 30000, `${a1.body.expiresAt} ${a1.body.expiresIn}`);
    const r1 = await row(a1.body.short_code);
    ok("...stored as its own kind ('qr') with no email, never the staff kind", r1 && r1.ip === 'qr' && r1.email === null && r1.used_at === null,
       JSON.stringify(r1));
    ok('...and the svg is an SVG: a white background, black modules, nothing else',
       /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/.test(a1.body.svg) && a1.body.svg.includes('<path fill="#ffffff" d="M0 0h')
         && a1.body.svg.includes('stroke="#000000"') && !/<script|\son\w+=|href/i.test(a1.body.svg), a1.body.svg.slice(0, 160));
    {
      const want = QRCode.create(a1.body.short_link, { errorCorrectionLevel: 'M' });
      const got = modules(a1.body.svg);
      const n = want.modules.size;
      let same = got.size === n + 8 && got.dark.size > 0;
      for (let y = 0; same && y < got.size; y++) for (let x = 0; x < got.size; x++) {
        const inside = x >= 4 && y >= 4 && x < n + 4 && y < n + 4;
        if (got.dark.has(`${x},${y}`) !== (inside && !!want.modules.get(y - 4, x - 4))) { same = false; break; }
      }
      ok('...module for module the QR of short_link at error correction M, with a 4-module quiet zone', same,
         `size ${got.size} vs ${n + 8}, ${got.dark.size} dark`);
    }

    for (const [origin, why] of [['https://www.aybkk.net', 'www'], ['https://cn.aybkk.net/book?x=1', 'a path is dropped']]) {
      const r = await qr(ana, { origin });
      ok(`an allowed origin (${why}) is used`, r.status === 200 && r.body.short_link === `${new URL(origin).origin}/in/${r.body.short_code}`, r.body.short_link);
    }
    for (const origin of ['https://evil.example.com', 'http://aybkk.net', 'https://aybkk.net.evil.example.com', 'https://aybkk.net@evil.example.com',
      'javascript:alert(1)', '', 42, null]) {
      const r = await qr(ana, { origin });
      ok(`an origin not on the list (${JSON.stringify(origin)}) falls back to the base URL`, r.status === 200
         && r.body.short_link === `https://cn.aybkk.net/in/${r.body.short_code}`, r.body.short_link);
    }
    const hosty = await qr(ana, {}, { ...ADMIN, 'x-forwarded-host': 'evil.example.com', origin: 'https://evil.example.com' });
    ok('no origin in the body: the base URL, whatever the request headers say', hosty.status === 200
       && hosty.body.short_link.startsWith('https://cn.aybkk.net/in/'), hosty.body.short_link);
    process.env.BKK_SIGNIN_ORIGINS = ' https://desk.example.com , not a url';
    const extra = await qr(ana, { origin: 'https://desk.example.com' });
    delete process.env.BKK_SIGNIN_ORIGINS;
    const extraOff = await qr(ana, { origin: 'https://desk.example.com' });
    ok('BKK_SIGNIN_ORIGINS adds a site to the list, and only while it is set', extra.body.short_link.startsWith('https://desk.example.com/in/')
       && extraOff.body.short_link.startsWith('https://cn.aybkk.net/in/'), `${extra.body.short_link} ${extraOff.body.short_link}`);

    // A staff link and an email link for Ana, and a QR for Ben: a new QR for Ana leaves them all alone.
    const staff = (await post(`/api/bkk/admin/members/${ana}/signin-link`, {}, ADMIN)).body;
    await post(`/api/bkk/admin/members/${ana}/email`, { email: 'ana.qrexample@example.com' }, ADMIN);
    await post('/api/bkk/login/request', { email: 'ana.qrexample@example.com' }, { 'x-forwarded-for': '10.90.1.1' });
    const mailTok = (await pool.query(`SELECT token FROM bkk_login_tokens WHERE email='ana.qrexample@example.com'
      ORDER BY created_at DESC LIMIT 1`)).rows[0];
    const benQr = (await qr(ben)).body;
    const older = (await qr(ana)).body;
    const st0 = await status(older.short_code);
    ok('status of a fresh QR: not used, not expired', st0.status === 200 && st0.body.used === false && st0.body.expired === false
       && st0.body.usedAt === null, JSON.stringify(st0.body));
    const newer = (await qr(ana)).body;
    const stOld = await status(older.short_code);
    ok("a new QR ends the member's older unused one", stOld.body.expired === true && stOld.body.used === false
       && (await open(older.short_code)).status === 400, JSON.stringify(stOld.body));
    ok('...but not their staff link', (await open(staff.short_link.split('/in/')[1])).status === 302);
    ok('...nor their email link', !!mailTok && (await fetch(`${B}/api/bkk/login/${mailTok.token}`)).status === 200);
    ok("...nor another member's QR", (await status(benQr.short_code)).body.expired === false);

    const before = await links();
    const hop = await open(newer.short_code);
    const tok = (hop.headers.get('location') || '').split('/').pop();
    ok('the first /in/<code> sends the phone on to the long link, as a staff link does',
       hop.status === 302 && hop.headers.get('location') === `/api/bkk/login/${tok}` && (await row(newer.short_code)).token === tok,
       `${hop.status} ${hop.headers.get('location')}`);
    const page = await fetch(`${B}/api/bkk/login/${tok}`).then(r => r.text());
    ok('...its page posts back to itself, and opening it uses nothing up', page.includes(`action="/api/bkk/login/${tok}"`)
       && (await status(newer.short_code)).body.used === false);
    const land = await fetch(`${B}/api/bkk/login/${tok}`, { method: 'POST' }).then(r => r.text());
    ok('...and the POST signs the phone in as the member and opens My account',
       land.includes(`localStorage.setItem('aybkk_member',${JSON.stringify(ana)})`) && land.includes('/book?me=1'));
    const st1 = await status(newer.short_code);
    ok('status says used, with the time', st1.body.used === true && st1.body.expired === false
       && Math.abs(Date.parse(st1.body.usedAt) - Date.now()) < 30000, JSON.stringify(st1.body));
    const again = await open(newer.short_code);
    ok('a second scan of the same QR is a dead link (a photo of the screen is no use)', again.status === 400
       && (await again.text()).includes('already been used, or it has expired'));
    ok('...and the long link behind it is dead too', (await fetch(`${B}/api/bkk/login/${tok}`)).status === 400
       && (await fetch(`${B}/api/bkk/login/${tok}`, { method: 'POST' })).status === 400);

    const after = await links();
    ok('progress: a scanned QR counts as signed in by QR (all time and today) and as opened, never as a staff link sent',
       after.qr === before.qr + 1 && after.qr_today === before.qr_today + 1 && after.opened === before.opened + 1
         && after.sent === before.sent && after.sent_today === before.sent_today, JSON.stringify([before, after]));
    ok('a newer QR leaves a used one as used', (await qr(ana)).status === 200 && (await status(newer.short_code)).body.used === true);
    const shown = await links();
    await qr(ben);
    ok('...and a QR shown but never scanned counts nowhere', JSON.stringify(await links()) === JSON.stringify(shown));

    const late = (await qr(ben)).body;
    await pool.query(`UPDATE bkk_login_tokens SET expires_at = now() - interval '1 second' WHERE short_code=$1`, [late.short_code]);
    const lateSt = await status(late.short_code);
    ok('an expired QR: status says expired, not used', lateSt.body.expired === true && lateSt.body.used === false, JSON.stringify(lateSt.body));
    ok('...its short link is dead', (await open(late.short_code)).status === 400);
    ok('...and its long link too', (await fetch(`${B}/api/bkk/login/${(await row(late.short_code)).token}`, { method: 'POST' })).status === 400);

    ok('status needs the staff key', (await status(newer.short_code, {})).status === 401);
    ok("status of a staff link's code is a 404: it only answers for a QR", (await status(staff.short_link.split('/in/')[1])).status === 404);
    ok('...and of a code nobody was given', (await status('23456789ab')).status === 404 && (await status('nope')).status === 404);
    const seen0 = JSON.stringify(await row(newer.short_code));
    await status(newer.short_code);
    ok('status only reads', JSON.stringify(await row(newer.short_code)) === seen0);

    const benLive = (await qr(ben)).body;
    ok('signing a member out everywhere ends their live QR too',
       (await post(`/api/bkk/admin/members/${ben}/signout`, {}, ADMIN)).status === 200
         && (await status(benLive.short_code)).body.expired === true && (await open(benLive.short_code)).status === 400);

    const staffTok = staff.link.split('/').pop();
    ok('the staff link is still a 7-day link that opens again after use', staff.days === 7 && (await row(staff.short_link.split('/in/')[1])).ip === 'staff'
       && (await fetch(`${B}/api/bkk/login/${staffTok}`, { method: 'POST' })).status === 200
       && (await fetch(`${B}/api/bkk/login/${staffTok}`, { method: 'POST' })).status === 200);
    ok('...and the email link is still one-time', (await fetch(`${B}/api/bkk/login/${mailTok.token}`, { method: 'POST' })).status === 200
       && (await fetch(`${B}/api/bkk/login/${mailTok.token}`, { method: 'POST' })).status === 400);
  }

  console.log('\n- Show QR, review fixes: forged markers, Close ends it, my.aybkk.com (17 Nov 2026) -');
  {
    const net = require('net');
    const cara = 'BTESTQRCARA001', dee = 'BTESTQRDEE0001';
    await pool.query(`INSERT INTO bkk_members (code,name,email) VALUES ($1,'Cara Qrexample','cara.qrexample@example.com'), ($2,'Dee Qrexample',NULL)`, [cara, dee]);
    const qr = (code, body = {}) => post(`/api/bkk/admin/members/${code}/signin-qr`, body, ADMIN);
    const status = short => J(`/api/bkk/admin/signin-qr/${short}/status`, { headers: ADMIN });
    const end = (short, h = ADMIN) => post(`/api/bkk/admin/signin-qr/${short}/end`, {}, h);
    let ipN = 0;
    const open = code => fetch(`${B}/in/${code}`, { redirect: 'manual', headers: { 'x-forwarded-for': `10.91.0.${++ipN}` } });
    const row = async short => (await pool.query('SELECT * FROM bkk_login_tokens WHERE short_code=$1', [short])).rows[0];
    const links = async () => (await J('/api/bkk/admin/progress', { headers: ADMIN })).body.links;
    const mailOf = async () => (await pool.query(`SELECT token, ip FROM bkk_login_tokens WHERE email='cara.qrexample@example.com'
      ORDER BY created_at DESC LIMIT 1`)).rows[0];
    const signIn = tok => fetch(`${B}/api/bkk/login/${tok}`, { method: 'POST' }).then(r => r.status);
    // A forged marker falls back to this machine's address, which earlier tests' requests share: age
    // those, so the per-address hourly limit has room.
    await pool.query(`UPDATE bkk_login_tokens SET created_at = created_at - interval '2 hours'
      WHERE ip IN ('127.0.0.1', '::ffff:127.0.0.1', '::1') AND created_at > now() - interval '1 hour'`);

    await post('/api/bkk/login/request', { email: 'cara.qrexample@example.com' }, { 'x-forwarded-for': 'qr' });
    const fq = await mailOf();
    ok("an email link asked for with x-forwarded-for 'qr' is stored with an address, not as a desk QR",
       !!fq && fq.ip !== 'qr' && net.isIP(fq.ip) > 0, JSON.stringify(fq));
    const l0 = await links();
    const caraQr = (await qr(cara)).body;
    ok('...so Show QR for that member leaves the emailed link alone', (await fetch(`${B}/api/bkk/login/${fq.token}`)).status === 200);
    ok('...and signing in from it is not counted as signed in by QR', (await signIn(fq.token)) === 200
       && (await links()).qr === l0.qr && (await status(caraQr.short_code)).body.used === false);
    await post('/api/bkk/login/request', { email: 'cara.qrexample@example.com' }, { 'x-forwarded-for': 'staff, 10.91.1.1' });
    const fst = await mailOf();
    ok("an email link asked for with x-forwarded-for 'staff' is not a staff link, and stays one-time",
       !!fst && fst.token !== fq.token && fst.ip !== 'staff' && (await signIn(fst.token)) === 200 && (await signIn(fst.token)) === 400,
       JSON.stringify(fst));
    await post('/api/bkk/login/request', { email: 'cara.qrexample@example.com' }, { 'x-forwarded-for': '10.91.1.2, 10.91.1.3' });
    ok('a real address in x-forwarded-for is still the one stored', (await mailOf()).ip === '10.91.1.2');

    const my = await qr(cara, { origin: 'https://my.aybkk.com' });
    ok('my.aybkk.com, which also serves the booking page, is on the list', my.status === 200
       && my.body.short_link === `https://my.aybkk.com/in/${my.body.short_code}`, my.body.short_link);

    const caraStaff = (await post(`/api/bkk/admin/members/${cara}/signin-link`, {}, ADMIN)).body;
    const deeQr = (await qr(dee)).body;
    const shown = (await qr(cara)).body;
    ok('ending a QR needs the staff key', (await end(shown.short_code, {})).status === 401
       && (await status(shown.short_code)).body.expired === false);
    ok("...a code nobody was given, or a staff link's code, is a 404", (await end('23456789ab')).status === 404
       && (await end(caraStaff.short_link.split('/in/')[1])).status === 404);
    const e1 = await end(shown.short_code);
    ok('Close ends a QR nobody scanned: status says expired and a photo of it is a dead link',
       e1.status === 200 && e1.body.ended === true && (await status(shown.short_code)).body.expired === true
         && (await open(shown.short_code)).status === 400, JSON.stringify(e1.body));
    ok('...ending it again changes nothing', (await end(shown.short_code)).body.ended === false);
    ok("...and the member's staff link and another member's QR stay live", (await open(caraStaff.short_link.split('/in/')[1])).status === 302
       && (await status(deeQr.short_code)).body.expired === false);
    const scanned = (await qr(dee)).body;
    const hop = await open(scanned.short_code);
    await signIn((hop.headers.get('location') || '').split('/').pop());
    const usedAt = String((await row(scanned.short_code)).used_at);
    const e2 = await end(scanned.short_code);
    ok('ending a QR that was already scanned keeps it as used', e2.status === 200 && e2.body.ended === false
       && (await status(scanned.short_code)).body.used === true && String((await row(scanned.short_code)).used_at) === usedAt,
       JSON.stringify(e2.body));
  }

  console.log('\n- Show QR: the desk panel, run from the page itself (17 Nov 2026) -');
  {
    const fs = require('fs'), vm = require('vm'), path = require('path');
    const page = fs.readFileSync(path.join(__dirname, '../public/bkk-admin.html'), 'utf8');
    const seg = page.slice(page.indexOf('  // Show QR: the student scans this screen'), page.indexOf('  window.passAct = '));
    ok('tab() closes the panel even while a QR is still on its way', /window\.tab = t => \{\s*current = t; SUB = null;\s*closeQr\(false\);/.test(page));
    ok("progress: 'Opened their profile' is its own count, not over the staff links sent",
       page.includes("${row(T('progOpened'), `${p.links.opened}`)}") && !page.includes('${p.links.opened} / ${p.links.sent}'));
    // A small stand-in for the browser: elements by id, timers run by hand, a clock set by hand.
    const panel = () => {
      let now = Date.parse('2026-11-17T03:00:00Z');
      const focused = [], calls = [], listeners = {}, alerts = [];
      let timers = [], tid = 0, pending = null, statusAnswer = null;
      const el = sel => ({ sel, hidden: true, innerHTML: '', textContent: '', inert: false, focus(o) { focused.push([sel, o]); } });
      const els = { '#qrPanel': el('#qrPanel'), '#app': el('#app'), '#qrLive': el('#qrLive') };
      const $ = sel => els[sel] || (els['#qrPanel'].innerHTML.includes(`id="${sel.slice(1)}"`) ? (els[sel + '@'] = els[sel + '@'] || el(sel)) : null);
      const res = (st, body) => ({ ok: st === 200, status: st, json: async () => body });
      const api = (url, opts = {}) => {
        calls.push([url, opts]);
        if (/\/signin-qr$/.test(url)) return new Promise(r => { pending = r; });
        if (/\/status$/.test(url)) return statusAnswer ? Promise.resolve(statusAnswer()) : new Promise(() => {});
        return Promise.resolve(res(200, { success: true, ended: true }));
      };
      class FakeDate extends Date { static now() { return now; } }
      const ctx = {
        $, api, T: (k, ...a) => `${k}${a.length ? `(${a.join(',')})` : ''}`, alert: m => alerts.push(m), Date: FakeDate,
        esc: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
        location: { origin: 'https://aybkk.net' },
        document: { hidden: false, contains: () => true, addEventListener: (k, f) => { listeners[k] = f; } },
        setTimeout: f => { timers.push({ id: ++tid, f, every: false }); return tid; },
        setInterval: f => { timers.push({ id: ++tid, f, every: true }); return tid; },
        clearTimeout: id => { timers = timers.filter(t => t.id !== id); },
      };
      ctx.clearInterval = ctx.clearTimeout;
      ctx.window = ctx;
      ctx.addEventListener = (k, f) => { listeners[k] = f; };
      vm.createContext(ctx);
      vm.runInContext(seg, ctx);
      const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
      return {
        ctx, els, focused, calls, listeners, alerts, flush,
        answer: async (short = 'qrshort001') => { pending(res(200, { name: 'Ana Example', short_code: short, expiresIn: 600,
          svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 37 37"></svg>' })); await flush(); },
        status: f => { statusAnswer = f; },
        later: ms => { now += ms; },
        runPolls: async () => { const due = timers.filter(t => !t.every); timers = timers.filter(t => t.every); due.forEach(t => t.f()); await flush(); },
        runTicks: async () => { timers.filter(t => t.every).forEach(t => t.f()); await flush(); },
        timers: () => timers.length,
        posts: () => calls.filter(([u]) => /\/signin-qr$/.test(u)).length,
        ends: () => calls.filter(([u]) => /\/end$/.test(u)).map(([u, o]) => [u.split('/').slice(-2)[0], o.keepalive === true]),
        res,
      };
    };

    {
      const P = panel();
      const btn = { focus() {} };
      P.ctx.showQr('BANAEXAMPLE01', btn);
      P.ctx.showQr('BANAEXAMPLE01', btn);
      ok('a double tap on Show QR sends one request, not two', P.posts() === 1);
      P.ctx.closeQr(false);
      await P.answer('lateshort01');
      ok('staff left the screen while the QR was on its way: no panel, no polling, and that QR is ended on the server',
         P.els['#qrPanel'].hidden === true && P.timers() === 0 && JSON.stringify(P.ends()) === JSON.stringify([['lateshort01', true]]),
         JSON.stringify([P.els['#qrPanel'].hidden, P.timers(), P.ends()]));
      P.ctx.showQr('BANAEXAMPLE01', btn);
      ok('...and Show QR works again after that', P.posts() === 2);
    }
    {
      const P = panel();
      P.ctx.showQr('BANAEXAMPLE01');
      await P.answer();
      const html = P.els['#qrPanel'].innerHTML;
      ok('an open panel makes the page behind it inert, so Tab cannot reach Lock', P.els['#app'].inert === true && P.els['#qrPanel'].hidden === false);
      ok('...focus goes to Close without scrolling the QR away', JSON.stringify(P.focused.at(-1)) === JSON.stringify(['#qrClose', { preventScroll: true }]));
      ok('...the QR has a name for a screen reader, and the dialog is described by the countdown',
         html.includes('class="qrbox" role="img" aria-label="qrImg"') && html.includes('<svg aria-hidden="true" focusable="false" ')
           && html.includes('aria-describedby="qrLeft"'));
      P.ctx.closeQr();
      ok('Close ends the live QR on the server (keepalive, so it also goes out as the page closes)',
         JSON.stringify(P.ends()) === JSON.stringify([['qrshort001', true]]) && P.els['#app'].inert === false && P.timers() === 0);
    }
    {
      const P = panel();
      P.ctx.showQr('BANAEXAMPLE01');
      await P.answer();
      P.status(() => P.res(401, { error: 'bad key' }));
      await P.runPolls();
      ok('a failed status check before 0:00 keeps the QR up and asks again', P.els['#qrPanel'].innerHTML.includes('class="qrbox"') && P.timers() === 2);
      P.later(600 * 1000);
      await P.runPolls();
      const html = P.els['#qrPanel'].innerHTML;
      ok('...past 0:00 it takes the QR away, says expired and stops asking', !html.includes('class="qrbox"') && html.includes('qrGone')
         && P.timers() === 0, html.slice(0, 120));
      ok('...with focus on its own Show QR button, and the message in the page\'s live region',
         JSON.stringify(P.focused.at(-1)) === JSON.stringify(['#qrAgain', { preventScroll: true }]) && P.els['#qrLive'].textContent === 'qrGone');
      ok('...an expired QR is not ended again on Close', (P.ctx.closeQr(), P.ends().length === 0));
    }
    {
      const P = panel();
      P.ctx.showQr('BANAEXAMPLE01');
      await P.answer();
      P.later(605 * 1000);
      await P.runTicks();
      ok('with no answer at all (no network), the QR goes a few seconds after 0:00 and polling stops',
         P.els['#qrPanel'].innerHTML.includes('qrGone') && !P.els['#qrPanel'].innerHTML.includes('class="qrbox"') && P.timers() === 0);
    }
    {
      const P = panel();
      P.ctx.showQr('BANAEXAMPLE01');
      await P.answer();
      P.status(() => P.res(200, { used: true, expired: false, usedAt: '2026-11-17T03:01:00Z' }));
      await P.runPolls();
      const html = P.els['#qrPanel'].innerHTML;
      ok('used: the panel says so and asks staff to check the phone shows the name', html.includes('qrUsed') && html.includes('qrCheck(Ana Example)')
         && !html.includes('class="qrbox"') && P.timers() === 0, html.slice(0, 200));
      ok('...the live region outside the card says it too, so a screen reader hears it',
         P.els['#qrLive'].textContent === 'qrUsed qrCheck(Ana Example)' && !html.includes('role="status"'));
      P.ctx.closeQr();
      ok('...and closing a used panel ends nothing and empties the live region', P.ends().length === 0 && P.els['#qrLive'].textContent === '');
    }
    {
      const P = panel();
      P.ctx.showQr('BANAEXAMPLE01');
      await P.answer('leaving0001');
      P.listeners.pagehide();
      ok('leaving the page with a live QR ends it', JSON.stringify(P.ends()) === JSON.stringify([['leaving0001', true]]) && P.timers() === 0);
    }
  }


  // ── the door tablet (17 Nov 2026) ───────────────────────────────────────────
  // A second server on its own class clock, so the windows run at any hour.
  console.log('\n-- the door tablet --');
  {
    let cc = Date.now();
    const appD = express();
    appD.use(express.json());
    await mountBkk(appD, { pgPool: pool, now, clock: () => cc });
    const srvD = appD.listen(0);
    const BD = `http://127.0.0.1:${srvD.address().port}`;
    const JD = async (path, o = {}) => {
      const r = await fetch(BD + path, o);
      const raw = await r.text();
      let body = {};
      try { body = JSON.parse(raw); } catch (_) {}
      return { status: r.status, body, raw, headers: r.headers };
    };
    const getD = (p, h = {}) => JD(p, { headers: h });
    const postD = (p, body, h = {}) => JD(p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(body) });
    const one = async (sql, args = []) => (await pool.query(sql, args)).rows[0] || {};
    let ipN = 10;
    const ipH = () => ({ 'cf-connecting-ip': `198.51.100.${ipN++}` });
    const AT = (d, t) => Date.parse(`${d}T${t}+07:00`);
    const plus = (d, k) => new Date(Date.parse(d + 'T12:00:00Z') + k * 86400000).toISOString().slice(0, 10);
    // A Tuesday three weeks or more ahead, not a moon day: Mysore 05:30 and 07:30 from the seed.
    let D = plus(new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), 21);
    while (new Date(D + 'T12:00:00Z').getUTCDay() !== 2 || moonDaysBetween(D, D).size) D = plus(D, 1);
    const slotOf = async code => (await one('SELECT id FROM bkk_class_slots WHERE code=$1', [code])).id;
    const my530 = await slotOf('my530_2'), my730 = await slotOf('my730_2');
    // Only the two Mysore classes are on this Tuesday (other tests leave slots behind).
    const parked = (await pool.query(`UPDATE bkk_class_slots SET active=false WHERE active AND weekday=2 AND code NOT IN ('my530_2','my730_2')
      RETURNING id`)).rows.map(r => r.id);
    await pool.query(`UPDATE bkk_class_slots SET active=true WHERE id = ANY($1::int[])`, [[my530, my730]]);
    const onl = (await one(`INSERT INTO bkk_class_slots (code,title,kind,weekday,start_time,duration_min,capacity,is_online)
      VALUES ('test_door_onl','[Online] Door Test','led_primary',2,'06:00',60,20,true) RETURNING id`)).id;
    const cxl = (await one(`INSERT INTO bkk_class_slots (code,title,kind,weekday,start_time,duration_min,capacity,is_online)
      VALUES ('test_door_cxl','Door Cancelled Test','led_primary',2,'06:10',90,20,false) RETURNING id`)).id;
    await pool.query(`INSERT INTO bkk_class_overrides (slot_id,class_date,cancelled,note) VALUES ($1,$2,true,'test')`, [cxl, D]);

    const people = {};
    const mk = async (key, name, pass = { code: 'unlim1', from: plus(D, -5), until: plus(D, 25) }) => {
      const id = (await one(`INSERT INTO bkk_members (code,name,email,phone) VALUES ($1,$2,$3,$4) RETURNING id`,
        [`BDOORT${key}${String(ipN).padStart(4, '0')}`, name, `door.${key.toLowerCase()}@example.com`, `0899${String(1000 + ipN++).slice(-4)}111`])).id;
      const p = pass ? (await one(`INSERT INTO bkk_passes (member_id,product_id,kind,credits_total,credits_used,daily_cap,valid_days,valid_from,valid_until,status,source)
        SELECT $1, id, kind, credits, $3, daily_cap, valid_days, $4::date, $5::date, $6, 'order' FROM bkk_products WHERE code=$2 RETURNING id`,
        [id, pass.code, pass.used || 0, pass.from || null, pass.until || null, pass.status || 'active'])).id : null;
      people[key] = { id, pass: p, code: (await one('SELECT code FROM bkk_members WHERE id=$1', [id])).code };
      return people[key];
    };
    const seat = async (who, slot, day = D, o = {}) => (await one(`INSERT INTO bkk_bookings (slot_id,class_date,start_at,member_id,pass_id,status,cover,source)
      SELECT $1, $2::date, ($2::date + s.start_time::time) AT TIME ZONE 'Asia/Bangkok', $3, $4, $5, $6, 'student' FROM bkk_class_slots s WHERE s.id=$1 RETURNING id`,
      [slot, day, who.id, o.pass === undefined ? who.pass : o.pass, o.status || 'booked', o.cover || 'pass'])).id;
    await mk('ANA', 'Ana Example', { code: 'pack8', used: 2, from: plus(D, -5), until: plus(D, 50) });
    await mk('ANX', 'Ana Exton');
    await mk('BEN', 'Ben Sample');
    await mk('DAN', 'Mr Dan Sample');
    await mk('SOM', 'Somchai');
    await mk('CAR', 'Cara (Nok) Ocean');
    await mk('THA', 'สมใจ ใจดี');
    await mk('GON', 'Gone Cancelledseat');
    await mk('ONL', 'Olga Onlineonly');
    const s = {};
    for (const k of ['ANA', 'ANX', 'BEN', 'DAN', 'SOM', 'CAR', 'THA']) s[k] = await seat(people[k], my530);
    s.BEN730 = await seat(people.BEN, my730);
    s.GON = await seat(people.GON, my530, D, { status: 'cancelled' });
    s.ONL = await seat(people.ONL, onl);
    s.CXL = await seat(people.GON, cxl);
    const passSnap = async () => JSON.stringify((await pool.query(`SELECT id, credits_used, valid_from, valid_until, status FROM bkk_passes
      WHERE member_id = ANY($1::int[]) ORDER BY id`, [Object.values(people).map(p => p.id)])).rows);
    const orderCount = async () => (await one('SELECT count(*)::int AS n FROM bkk_orders')).n;

    // ── pairing, tablet first ──
    const ipA = ipH();
    const st = await postD('/api/bkk/door/pair/start', {}, ipA);
    ok('a tablet asks to pair with no key: an 8-letter code with no look-alike letters, a long secret, 10 minutes, no-store',
       st.status === 200 && /^[ACDEFHJKMNPRTVWXY34679]{4} [ACDEFHJKMNPRTVWXY34679]{4}$/.test(st.body.code)
         && /^[A-Za-z0-9_-]{43}$/.test(st.body.secret) && st.body.expiresIn === 600 && st.headers.get('cache-control') === 'no-store', JSON.stringify(st.body));
    const row = await one('SELECT code_hash, secret_hash FROM bkk_door_pairings ORDER BY id DESC LIMIT 1');
    ok('...stored hashed: neither the code nor the secret is in the table',
       row.code_hash && !row.code_hash.includes(st.body.code.replace(' ', '')) && row.secret_hash !== st.body.secret && row.secret_hash.length === 64);
    const early = await postD('/api/bkk/door/pair/claim', { secret: st.body.secret }, ipA);
    ok('claiming before staff approve gives no key', early.status === 200 && early.body.waiting === true && !early.body.key, JSON.stringify(early.body));
    ok('approving needs the admin key', (await postD('/api/bkk/admin/door/pair', { code: st.body.code }, ipA)).status === 401);
    const ipAdm = ipH();
    const wrong = [];
    for (let i = 0; i < 10; i++) wrong.push((await postD('/api/bkk/admin/door/pair', { code: 'AAAA AAAA' }, { ...ADMIN, ...ipAdm })).status);
    const locked = await postD('/api/bkk/admin/door/pair', { code: st.body.code }, { ...ADMIN, ...ipAdm });
    ok('a wrong code is a miss: after 10 from one address even the right code is refused (429) there',
       wrong.every(x => x === 404) && locked.status === 429 && (await postD('/api/bkk/door/pair/claim', { secret: st.body.secret }, ipA)).body.waiting === true,
       JSON.stringify([wrong, locked.status]));
    const ap = await postD('/api/bkk/admin/door/pair', { code: st.body.code.toLowerCase().replace(' ', '-'), name: 'Front door' }, { ...ADMIN, ...ipH() });
    ok('...from another address the code staff type (any case, any spacing) approves it', ap.status === 200 && ap.body.success && ap.body.name === 'Front door', JSON.stringify(ap.body));
    const cl = await postD('/api/bkk/door/pair/claim', { secret: st.body.secret }, ipA);
    const KEY1 = cl.body.key;
    ok('the tablet that holds the secret gets the door key, once', cl.status === 200 && cl.body.ok && /^dk_[A-Za-z0-9_-]{43}$/.test(KEY1)
       && cl.headers.get('cache-control') === 'no-store', JSON.stringify(cl.body).slice(0, 80));
    const again = await postD('/api/bkk/door/pair/claim', { secret: st.body.secret }, ipA);
    ok('...a second claim gives nothing', again.status === 404 && !again.body.key && again.body.gone === true);
    ok('...and only its hash is kept', (await one('SELECT count(*)::int AS n FROM bkk_door_devices WHERE key_hash=$1',
      [crypto.createHash('sha256').update(KEY1).digest('hex')])).n === 1
       && (await one(`SELECT count(*)::int AS n FROM bkk_door_devices WHERE key_hash=$1`, [KEY1])).n === 0);
    const stOld = await postD('/api/bkk/door/pair/start', {}, ipH());
    await pool.query(`UPDATE bkk_door_pairings SET expires_at = now() - interval '1 second' WHERE secret_hash=$1`,
      [crypto.createHash('sha256').update(stOld.body.secret).digest('hex')]);
    const lateAp = await postD('/api/bkk/admin/door/pair', { code: stOld.body.code }, { ...ADMIN, ...ipH() });
    ok('an expired request cannot be approved or claimed', lateAp.status === 404
       && (await postD('/api/bkk/door/pair/claim', { secret: stOld.body.secret }, ipH())).status === 404);
    ok('a made-up secret claims nothing', (await postD('/api/bkk/door/pair/claim', { secret: 'x'.repeat(43) }, ipH())).status === 404);
    const ipFlood = ipH(), flood = [];
    for (let i = 0; i < 13; i++) flood.push((await postD('/api/bkk/door/pair/start', {}, ipFlood)).status);
    ok('one address can ask for 12 pairing codes an hour, then 429', flood.slice(0, 12).every(x => x === 200) && flood[12] === 429, flood.join());
    await pool.query(`DELETE FROM bkk_door_pairings WHERE ip=$1`, [ipFlood['cf-connecting-ip']]);
    const H1 = { 'x-door-key': KEY1, ...ipA };

    // ── which key opens what ──
    const TK = (await post('/api/bkk/admin/teachers', { name: 'Door Teacher' }, ADMIN)).body.passcode;
    const TEACH = { 'x-teacher-key': TK };
    const adminRoutes = ['/api/bkk/admin/today', '/api/bkk/admin/orders', '/api/bkk/admin/door/devices', '/api/bkk/admin/teachers',
      `/api/bkk/admin/class?slotId=${my530}&date=${D}`];
    const doorOnAdmin = await Promise.all(adminRoutes.map(p => getD(p, { 'x-door-key': KEY1 })));
    const doorOnTeacher = await Promise.all(['/api/bkk/teacher/me', '/api/bkk/teacher/today'].map(p => getD(p, { 'x-door-key': KEY1 })));
    ok('the door key opens no admin route and no teacher route', doorOnAdmin.every(r => r.status === 401) && doorOnTeacher.every(r => r.status === 401)
       && (await postD('/api/bkk/checkin', { memberCode: people.ANA.code }, { 'x-door-key': KEY1 })).status === 401
       && (await postD('/api/bkk/admin/door/devices/1/revoke', {}, { 'x-door-key': KEY1 })).status === 401,
       JSON.stringify([...doorOnAdmin, ...doorOnTeacher].map(r => r.status)));
    const doorRoutes = [() => getD('/api/bkk/door/now', ADMIN), () => getD('/api/bkk/door/now', TEACH), () => getD('/api/bkk/door/now'),
      () => postD('/api/bkk/door/checkin', { t: 'x' }, ADMIN), () => postD('/api/bkk/door/checkin', { t: 'x' }, TEACH), () => getD('/api/bkk/door/qr', ADMIN),
      () => getD('/api/bkk/door/now', { 'x-door-key': 'dk_' + 'A'.repeat(43) })];
    const refused = await Promise.all(doorRoutes.map(f => f()));
    ok('the admin key, a teacher passcode, a made-up door key or no key: 401 on every door route, asking for X-Door-Key',
       refused.every(r => r.status === 401 && r.headers.get('www-authenticate') === 'X-Door-Key'), refused.map(r => r.status).join());

    // ── /door/now: only open windows ──
    const now_ = async (ms, h = H1) => { cc = ms; return getD('/api/bkk/door/now', h); };
    const before = await now_(AT(D, '04:29:59'));
    ok('04:29: no window open yet, so no seats at all: only next, moon and now', before.status === 200
       && Object.keys(before.body).sort().join() === 'moon,next,now' && before.body.moon === false && before.body.now === AT(D, '04:29:59')
       && JSON.stringify(before.body.next) === JSON.stringify({ title: 'Mysore (1st batch)', date: D, start: '05:30', opens: '04:30' })
       && before.headers.get('cache-control') === 'no-store', before.raw);
    const opens = await now_(AT(D, '04:30:00'));
    ok('04:30: the 05:30 list is up (an hour before), the 07:30 one is next', opens.body.classes && opens.body.classes.length === 1
       && opens.body.classes[0].start === '05:30' && opens.body.next.start === '07:30' && opens.body.next.opens === '06:30', opens.raw.slice(0, 200));
    const at520 = await now_(AT(D, '05:20:00'));
    const names = (at520.body.seats || []).map(x => x.n);
    const want = ['Ana Exa.', 'Ana Ext.', 'Ben S.', 'Cara O.', 'Dan S.', 'Somchai', 'สมใจ จ.'].sort((a, b) => a.localeCompare(b, 'en'));
    ok('05:20: one class, its booked seats as "Name L." sorted A to Z: two Anas get letters until they differ, a title and a bracket are skipped, one word stays one word, a Thai vowel is not the letter',
       JSON.stringify(at520.body.classes) === JSON.stringify([{ title: 'Mysore (1st batch)', start: '05:30', end: '07:30' }])
         && JSON.stringify(names) === JSON.stringify(want), JSON.stringify(names));
    ok('...no cancelled seat, no online class, no cancelled class', !names.some(n => /Gone|Olga/.test(n)) && at520.body.seats.length === 7);
    ok('...each seat is exactly a handle, the name, in, at and its class time',
       at520.body.seats.every(x => Object.keys(x).sort().join() === 'at,c,in,n,t' && /^[A-Za-z0-9_-]{43}$/.test(x.t) && x.in === false && x.at === null && x.c === '05:30'));
    const rawAll = [before.raw, opens.raw, at520.raw].join('\n').replace(/"t":"[A-Za-z0-9_-]+"/g, '"t":""');
    const codes = Object.values(people).map(p => p.code);
    ok('the raw answer has no member code, email, phone, full surname, id, pass word or anything like a price',
       !codes.some(c => rawAll.includes(c)) && !/@|0899\d|"id"|member|email|phone|note|unlimited|credit|drop-?in|\bpack|valid|pass|price|baht|฿|THB|month/i.test(rawAll)
         && !/Example|Exton|Sample|Ocean|ใจดี|Nok/.test(rawAll) && !/\b\d{1,3},\d{3}\b|\b(1500|1653|7600|9600|19500|25800|34200|63600|78000)\b/.test(rawAll), rawAll.slice(0, 300));
    const at520b = await now_(AT(D, '05:21:00'));
    ok('the same seat keeps the same handle and place on the next refresh', JSON.stringify(at520b.body.seats) === JSON.stringify(at520.body.seats));
    const at645 = await now_(AT(D, '06:45:00'));
    const bens = at645.body.seats.filter(x => x.n === 'Ben S.');
    ok('06:45: both Mysore classes are live in one list, each tile with its class time, Ben S. twice in booking order',
       at645.body.classes.map(c => c.start).join() === '05:30,07:30' && at645.body.seats.length === 8
         && bens.length === 2 && bens[0].c === '05:30' && bens[1].c === '07:30', JSON.stringify(at645.body.classes));
    const at735 = await now_(AT(D, '07:35:00'));
    ok('07:35: the 05:30 class is over (it ran to 07:30), the 07:30 one is still up', at735.body.classes.map(c => c.start).join() === '07:30'
       && at735.body.seats.length === 1 && at735.body.seats[0].n === 'Ben S.', at735.raw.slice(0, 200));
    const after = await now_(AT(D, '09:30:00'));
    ok('09:30: every class is over: no seats, and next is a later day', !('seats' in after.body) && !('classes' in after.body)
       && after.body.next && after.body.next.date > D, JSON.stringify(after.body));
    // A moon day: the shala is closed, a seat on it is never shown.
    let M = plus(D, 1);
    while (!moonDaysBetween(M, M).size) M = plus(M, 1);
    const mSlot = await one(`SELECT id, start_time FROM bkk_class_slots WHERE active AND is_online IS NOT TRUE AND weekday=$1 ORDER BY start_time LIMIT 1`,
      [new Date(M + 'T12:00:00Z').getUTCDay()]);
    const mSeat = await seat(people.ANA, mSlot.id, M);
    const moon = await now_(AT(M, mSlot.start_time + ':00') - 10 * 60000);
    ok('a moon day: moon is true, no seats, and next is not today', moon.body.moon === true && !('seats' in moon.body)
       && (!moon.body.next || moon.body.next.date > M), moon.raw);
    await pool.query('DELETE FROM bkk_bookings WHERE id=$1', [mSeat]);

    // ── check-in ──
    const at = await now_(AT(D, '05:20:00'));
    const tOf = n => at.body.seats.find(x => x.n === n).t;
    const snap0 = await passSnap(), orders0 = await orderCount();
    const tap = (t, h = H1) => postD('/api/bkk/door/checkin', { t }, h);
    const flip = x => x.slice(0, 10) + (x[10] === 'A' ? 'B' : 'A') + x.slice(11);
    const forged = [await tap('A'.repeat(43)), await tap('nope'), await tap(flip(tOf('Ana Exa.')))];
    ok('a forged or broken handle is 400', forged.every(r => r.status === 400), forged.map(r => r.status).join());
    const t1 = await tap(tOf('Ana Exa.'));
    ok('a tap checks the seat in: ok, the name, not already, the time', t1.status === 200 && t1.body.ok === true && t1.body.n === 'Ana Exa.'
       && t1.body.already === false && t1.body.at === '05:20' && Object.keys(t1.body).sort().join() === 'already,at,n,ok', t1.raw);
    cc = AT(D, '05:25:00');
    const t2 = await tap(tOf('Ana Exa.'));
    ok('...a second tap says already, with the first time', t2.status === 200 && t2.body.already === true && t2.body.at === '05:20', t2.raw);
    const bAna = await one(`SELECT checked_in_at, checkin_via, checkin_by FROM bkk_bookings WHERE id=$1`, [s.ANA]);
    ok('...and the seat says who: the tablet, by its name', bAna.checkin_via === 'tablet' && bAna.checkin_by === 'Front door'
       && new Date(bAna.checked_in_at).getTime() === AT(D, '05:20:00'), JSON.stringify(bAna));
    ok('...the list shows it in, in place', (await now_(AT(D, '05:26:00'))).body.seats.find(x => x.n === 'Ana Exa.').in === true
       && (await now_(AT(D, '05:26:00'))).body.seats.find(x => x.n === 'Ana Exa.').at === '05:20');
    const many = await Promise.all(Array.from({ length: 30 }, () => tap(tOf('Ben S.'))));
    ok('taps are never limited: 30 at once all answer ok', many.every(r => r.status === 200 && r.body.ok), many.map(r => r.status).join());
    const tSom = tOf('Somchai');
    await pool.query(`UPDATE bkk_bookings SET status='cancelled', cancelled_at=now() WHERE id=$1`, [s.SOM]);
    const somNo = await tap(tSom);
    ok('a handle for a seat cancelled since: a neutral refusal, nothing about why', somNo.status === 409 && somNo.body.refused === true
       && Object.keys(somNo.body).sort().join() === 'ok,refused', somNo.raw);
    const tCar = tOf('Cara O.');
    await pool.query(`INSERT INTO bkk_class_overrides (slot_id,class_date,cancelled,note) VALUES ($1,$2,true,'test')
      ON CONFLICT (slot_id, class_date) DO UPDATE SET cancelled=true`, [my530, D]);
    const carNo = await tap(tCar);
    await pool.query(`DELETE FROM bkk_class_overrides WHERE slot_id=$1 AND class_date=$2`, [my530, D]);
    ok('the class is closed meanwhile (cancelled): the same neutral refusal', carNo.status === 409 && carNo.body.refused === true, carNo.raw);
    cc = AT(D, '07:30:00');
    const late = await tap(tCar);
    ok('once its class is over the handle is spent: 400', late.status === 400, late.raw);
    cc = AT(D, '05:27:00');
    ok('pass classes and dates are the same as before every tap, and no order was made', (await passSnap()) === snap0 && (await orderCount()) === orders0);
    // A new pairing ends the old one.
    const st2 = await postD('/api/bkk/door/pair/start', {}, ipA);
    await postD('/api/bkk/admin/door/pair', { code: st2.body.code, name: 'Spare iPad' }, { ...ADMIN, ...ipH() });
    const KEY2 = (await postD('/api/bkk/door/pair/claim', { secret: st2.body.secret }, ipA)).body.key;
    const H2 = { 'x-door-key': KEY2, ...ipA };
    ok('pairing a new tablet revokes the old one: its key is 401 at once', (await getD('/api/bkk/door/now', H1)).status === 401
       && (await getD('/api/bkk/door/now', H2)).status === 200);
    ok('...a handle the old tablet was given is 401 from it, and 400 from the new one', (await tap(tOf('Dan S.'), H1)).status === 401
       && (await tap(tOf('Dan S.'), H2)).status === 400 && !(await one('SELECT checked_in_at FROM bkk_bookings WHERE id=$1', [s.DAN])).checked_in_at);
    const devs = await getD('/api/bkk/admin/door/devices', ADMIN);
    const active = devs.body.devices.filter(d => d.active);
    ok('Admin lists the tablets: one in use, named, paired, last seen, never a key or a hash', devs.status === 200 && active.length === 1
       && active[0].name === 'Spare iPad' && active[0].pairedAt && active[0].lastSeenAt && active[0].otherInternet === false
       && devs.body.devices.some(d => d.name === 'Front door' && !d.active && d.revokedAt)
       && !devs.raw.includes(KEY1) && !devs.raw.includes(KEY2) && !/hash|dk_|"ip"|198\.51/.test(devs.raw), devs.raw.slice(0, 300));
    await getD('/api/bkk/door/now', { 'x-door-key': KEY2, 'cf-connecting-ip': '203.0.113.77' });
    const moved = (await getD('/api/bkk/admin/door/devices', ADMIN)).body.devices.find(d => d.active);
    ok('the key used from another address: marked "seen from another internet" for Admin', moved.otherInternet === true && !!moved.otherSeenAt);
    // The shala's own address changed (a router restart): every later poll from there must not make it new again.
    await pool.query(`UPDATE bkk_door_devices SET other_ip_at = now() - interval '1 day' WHERE id=$1`, [moved.id]);
    await getD('/api/bkk/door/now', { 'x-door-key': KEY2, 'cf-connecting-ip': '203.0.113.77' });
    const otherAt = async () => (await one('SELECT other_ip_at, paired_ip FROM bkk_door_devices WHERE id=$1', [moved.id]));
    const stay = await otherAt();
    ok('...more polls from that same address keep the first time, so the 20:00 summary warns once, not every day',
       Date.now() - new Date(stay.other_ip_at).getTime() > 23 * 3600e3, JSON.stringify(stay));
    await getD('/api/bkk/door/now', { 'x-door-key': KEY2, 'cf-connecting-ip': '203.0.113.78' });
    ok('...a move to yet another address is new again', Date.now() - new Date((await otherAt()).other_ip_at).getTime() < 60e3);
    ok('"This is the shala\'s internet" needs the admin key', (await postD(`/api/bkk/admin/door/devices/${moved.id}/home`, {}, { 'x-door-key': KEY2 })).status === 401);
    const home = await postD(`/api/bkk/admin/door/devices/${moved.id}/home`, {}, ADMIN);
    await getD('/api/bkk/door/now', { 'x-door-key': KEY2, 'cf-connecting-ip': '203.0.113.78' });
    const afterHome = (await getD('/api/bkk/admin/door/devices', ADMIN)).body.devices.find(d => d.active);
    ok('..."This is the shala\'s internet" makes the last address the shala\'s and clears the warning', home.status === 200
       && afterHome.otherInternet === false && (await otherAt()).paired_ip === '203.0.113.78', JSON.stringify(afterHome));
    const rv = await postD(`/api/bkk/admin/door/devices/${active[0].id}/revoke`, {}, ADMIN);
    ok('Unpair in Admin: the tablet is 401 at once', rv.status === 200 && rv.body.revoked === true && (await getD('/api/bkk/door/now', H2)).status === 401
       && (await postD('/api/bkk/admin/door/devices/999999/revoke', {}, ADMIN)).status === 404);
    // 50 waiting codes from 5 addresses: the real tablet still gets one, the oldest unapproved goes, an approved one stays.
    const stKeep = await postD('/api/bkk/door/pair/start', {}, ipH());
    await postD('/api/bkk/admin/door/pair', { code: stKeep.body.code, name: 'Kept' }, { ...ADMIN, ...ipH() });
    const floodIps = [];
    for (let a = 0; a < 5; a++) { const h = ipH(); floodIps.push(h['cf-connecting-ip']); for (let i = 0; i < 10; i++) await postD('/api/bkk/door/pair/start', {}, h); }
    const real = await postD('/api/bkk/door/pair/start', {}, ipH());
    const waitingNow = (await one(`SELECT count(*)::int AS n FROM bkk_door_pairings WHERE expires_at > now() AND used_at IS NULL AND approved_at IS NULL`)).n;
    ok('a flood of pairing codes from many addresses never refuses the real tablet: the oldest waiting code goes, an approved one stays',
       real.status === 200 && real.body.code && waitingNow <= 50
         && (await postD('/api/bkk/door/pair/claim', { secret: stKeep.body.secret }, ipH())).body.ok === true, JSON.stringify([real.status, real.body.error, waitingNow]));
    await pool.query(`UPDATE bkk_door_devices SET revoked_at=now() WHERE name='Kept' AND revoked_at IS NULL`);
    await pool.query(`DELETE FROM bkk_door_pairings WHERE ip = ANY($1::text[]) OR secret_hash=$2`,
      [floodIps, crypto.createHash('sha256').update(String(real.body.secret || '')).digest('hex')]);
    // Typed in the last second of its 10 minutes: the tablet can still claim it.
    const stLast = await postD('/api/bkk/door/pair/start', {}, ipH());
    await pool.query(`UPDATE bkk_door_pairings SET expires_at = now() + interval '1 second' WHERE secret_hash=$1`,
      [crypto.createHash('sha256').update(stLast.body.secret).digest('hex')]);
    await postD('/api/bkk/admin/door/pair', { code: stLast.body.code, name: 'Last second' }, { ...ADMIN, ...ipH() });
    await new Promise(r => setTimeout(r, 1300));
    const lastCl = await postD('/api/bkk/door/pair/claim', { secret: stLast.body.secret }, ipH());
    ok('a code approved in its last second can still be claimed (2 more minutes)', lastCl.status === 200 && lastCl.body.ok === true, lastCl.raw);
    await pool.query(`UPDATE bkk_door_devices SET revoked_at=now() WHERE name='Last second' AND revoked_at IS NULL`);
    // A made-up secret never waits on the pairing lock.
    const holder = await pool.connect();
    await holder.query(`SELECT pg_advisory_lock(hashtext('bkk_door_devices'))`);
    const quick = await Promise.race([postD('/api/bkk/door/pair/claim', { secret: crypto.randomBytes(32).toString('base64url') }, ipH()),
      new Promise(r => setTimeout(() => r({ status: 'waited' }), 1500))]);
    await holder.query(`SELECT pg_advisory_unlock(hashtext('bkk_door_devices'))`);
    holder.release();
    ok('a claim with a made-up secret answers 404 without taking the pairing lock', quick.status === 404, String(quick.status));
    const qr = await (async () => { const st3 = await postD('/api/bkk/door/pair/start', {}, ipA);
      await postD('/api/bkk/admin/door/pair', { code: st3.body.code }, { ...ADMIN, ...ipH() });
      const k = (await postD('/api/bkk/door/pair/claim', { secret: st3.body.secret }, ipA)).body.key;
      return getD('/api/bkk/door/qr?origin=' + encodeURIComponent('https://aybkk.net'), { 'x-door-key': k, ...ipA }); })();
    ok('the "book on your phone" QR is made on the server, to /book on an allowed site only', qr.status === 200 && qr.body.link === 'https://aybkk.net/book'
       && /^<svg/.test(qr.body.svg.trim()), JSON.stringify(qr.body).slice(0, 120));

    // ── the name rule on hard names, another Tuesday ──
    {
      let D2 = plus(D, 7);
      while (moonDaysBetween(D2, D2).size) D2 = plus(D2, 7);
      const stN = await postD('/api/bkk/door/pair/start', {}, ipA);
      await postD('/api/bkk/admin/door/pair', { code: stN.body.code, name: 'Names' }, { ...ADMIN, ...ipH() });
      const HN = { 'x-door-key': (await postD('/api/bkk/door/pair/claim', { secret: stN.body.secret }, ipA)).body.key, ...ipA };
      const hard = { TW1: 'Tara Twinname', TW2: 'Tara Twinname', NE1: 'Kim Nearlya', NE2: 'Kim Nearlyb', HAN: '王小明', HA2: '李伟',
        MAIL: 'nam.mailname@example.com', TH1: 'สมชาย ใจดี', TH2: 'สมชาย ใจงาม', RU1: 'Александра Константинова', RU2: 'Александра Константиновская' };
      const hs = {};
      for (const [k, n] of Object.entries(hard)) { await mk(k, n); hs[k] = await seat(people[k], my530, D2); }
      cc = AT(D2, '05:20:00');
      const nn = await getD('/api/bkk/door/now', HN);
      const byN = n => nn.body.seats.filter(x => x.n === n);
      ok('hard names: a Chinese name is masked (王*明, 李*), an email shows one letter, Thai near-twins keep their vowel (ใจด., ใจง.), never a whole last word',
         byN('王*明').length === 1 && byN('李*').length === 1 && byN('n.').length === 1 && byN('สมชาย ใจด.').length === 1 && byN('สมชาย ใจง.').length === 1
           && byN('Александра Константинов.').length === 1 && byN('Александра Константиновс.').length === 1,
         JSON.stringify(nn.body.seats.map(x => x.n)));
      const rawN = nn.raw.replace(/"t":"[A-Za-z0-9_-]+"/g, '"t":""');
      ok('...so no full name reaches the tablet', !/王小明|李伟|@|mailname|ใจดี|ใจงาม|Twinname|Nearlya|Nearlyb|Константинова"|Константиновская/.test(rawN), rawN.slice(0, 400));
      const twins = byN('Tara T.'), near = byN('Kim Nearly.');
      ok('two people whose labels cannot differ (the same name, or names that differ only in the last letter) are marked same, the others are not',
         twins.length === 2 && twins.every(x => x.same === true) && near.length === 2 && near.every(x => x.same === true)
           && nn.body.seats.filter(x => x.same).length === 4, JSON.stringify([twins, near].map(g => g.map(x => [x.n, x.same]))));
      const twinTap = await postD('/api/bkk/door/checkin', { t: (twins[0] || {}).t }, HN);
      ok('...a tap on one of them is the neutral refusal (see the teacher) and checks nobody in', twinTap.status === 409 && twinTap.body.refused === true
         && !(await one('SELECT checked_in_at FROM bkk_bookings WHERE id=$1', [hs.TW1])).checked_in_at
         && !(await one('SELECT checked_in_at FROM bkk_bookings WHERE id=$1', [hs.TW2])).checked_in_at, twinTap.raw);
      const hanTap = await postD('/api/bkk/door/checkin', { t: (byN('王*明')[0] || {}).t }, HN);
      ok('...a masked name checks in as usual', hanTap.status === 200 && hanTap.body.n === '王*明', hanTap.raw);
      const liT = (byN('李*')[0] || nn.body.seats.find(x => /李/.test(x.n)) || { t: 'x' }).t;
      ok('a handle in another spelling of the same bytes is not taken', (await postD('/api/bkk/door/checkin',
        { t: liT.slice(0, -1) + String.fromCharCode(liT.slice(-1).charCodeAt(0) + 1) }, HN)).status === 400
        && !(await one('SELECT checked_in_at FROM bkk_bookings WHERE id=$1', [hs.HA2])).checked_in_at);
      await pool.query('DELETE FROM bkk_bookings WHERE id = ANY($1::int[])', [Object.values(hs)]);
      await pool.query(`UPDATE bkk_door_devices SET revoked_at=now() WHERE name='Names' AND revoked_at IS NULL`);
    }

    // ── faces on the tablet and on /teach (Boonchu, 20 Nov 2026) ──
    // A second door server with photo storage; each face it fetches answers with
    // its own Cloudinary link inside a JPEG, so a test can see whose face it is.
    {
      const appF = express();
      appF.use(express.json());
      const faceFetch = async url => String(url).startsWith('signed://')
        ? new Response(Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.from(String(url))]), { status: 200 }) : fakeFetch(url);
      await mountBkk(appF, { pgPool: pool, now, clock: () => cc, cloudinary: fakeCloud, fetch: faceFetch });
      const srvF = appF.listen(0);
      const BF = `http://127.0.0.1:${srvF.address().port}`;
      const JF = async (path, o = {}) => {
        const r = await fetch(BF + path, o);
        const buf = Buffer.from(await r.arrayBuffer()), raw = buf.toString('latin1');
        let body = {};
        try { body = JSON.parse(buf.toString('utf8')); } catch (_) {}
        return { status: r.status, body, raw: buf.toString('utf8'), bytes: raw, type: r.headers.get('content-type') };
      };
      const getF = (p, h = {}) => JF(p, { headers: h });
      const LINK = /^\/api\/bkk\/face\/([0-9a-f]{24})\.([sl])\.(\d+)\.([\w-]{22})$/;
      const DLINK = /^\/api\/bkk\/face\/([0-9a-f]{24})\.d(\d+)\.(\d+)\.([\w-]{22})$/;
      let D3 = plus(D, 14);
      while (moonDaysBetween(D3, D3).size) D3 = plus(D3, 7);
      const stF = await postD('/api/bkk/door/pair/start', {}, ipA);
      await postD('/api/bkk/admin/door/pair', { code: stF.body.code, name: 'Faces' }, { ...ADMIN, ...ipH() });
      const HF = { 'x-door-key': (await postD('/api/bkk/door/pair/claim', { secret: stF.body.secret }, ipA)).body.key, ...ipA };
      const devF = (await one(`SELECT id FROM bkk_door_devices WHERE name='Faces' AND revoked_at IS NULL`)).id;
      const faceOf = {};
      const fs_ = {};
      for (const [k, n, photo] of [['FA1', 'Faye Photoone', true], ['FA2', 'Finn Phototwo', true], ['FNO', 'Fran Nophoto', false],
        ['FT1', 'Tess Twinface', true], ['FT2', 'Tess Twinface', true]]) {
        await mk(k, n);
        if (photo) {
          faceOf[k] = crypto.randomBytes(12).toString('hex');
          await pool.query('UPDATE bkk_members SET photo_id=$2 WHERE id=$1', [people[k].id, 'aybkk-profile/' + faceOf[k]]);
        }
        fs_[k] = await seat(people[k], my530, D3);
      }
      fs_.FA1b = await seat(people.FA1, my730, D3);
      cc = AT(D3, '06:45:00');
      const fn = await getF('/api/bkk/door/now', HF);
      const endOf = {};
      for (const c of fn.body.classes || []) endOf[c.start] = String(AT(D3, c.end + ':00') / 1000);
      const by = n => (fn.body.seats || []).filter(x => x.n === n);
      const fa1 = by('Faye P.'), fa2 = by('Finn P.')[0] || {}, fno = by('Fran N.')[0] || {}, twinsF = by('Tess T.');
      const dl = x => DLINK.exec((x && x.f) || '') || [];
      ok("the tablet: a seat whose student has a photo gets one face link (f) of this tablet's own, ending when that seat's class ends; one with none gets no f",
         fn.status === 200 && fa1.length === 2 && fa1.every(x => dl(x)[1] === faceOf.FA1 && dl(x)[2] === String(devF) && dl(x)[3] === endOf[x.c])
           && dl(fa2)[1] === faceOf.FA2 && dl(fa2)[3] === endOf['05:30'] && fno.n === 'Fran N.' && !('f' in fno),
         JSON.stringify([fn.body.classes, fn.body.seats]));
      ok('...so the two seats of one student on two classes carry two links, and nothing else is new: the answer is classes, moon, next, now, seats, each seat t, n, in, at, c, f when there is a photo, same for twins',
         fa1[0].f !== fa1[1].f && Object.keys(fn.body).sort().join() === 'classes,moon,next,now,seats'
           && fn.body.seats.every(x => Object.keys(x).sort().join() === ['at', 'c', 'in', 'n', 't', ...('f' in x ? ['f'] : []), ...(x.same ? ['same'] : [])].sort().join())
           && Object.keys(fno).sort().join() === 'at,c,in,n,t', JSON.stringify([Object.keys(fn.body), fn.body.seats.map(x => Object.keys(x))]));
      ok('...same-name twins show their own faces, and a tap on one is still "see the teacher"', twinsF.length === 2 && twinsF.every(x => x.same === true)
         && dl(twinsF[0])[1] && dl(twinsF[1])[1] && twinsF[0].f !== twinsF[1].f
         && [faceOf.FT1, faceOf.FT2].sort().join() === twinsF.map(x => dl(x)[1]).sort().join()
         && (await postD('/api/bkk/door/checkin', { t: twinsF[0].t }, HF)).status === 409
         && !(await one('SELECT checked_in_at FROM bkk_bookings WHERE id=$1', [fs_.FT1])).checked_in_at);
      const fCodes = ['FA1', 'FA2', 'FNO', 'FT1', 'FT2'].map(k => people[k].code);
      ok('...the door answer, links and all, has no member code, email, phone or storage folder',
         !fCodes.some(c => fn.raw.includes(c)) && !/@|example\.com|0899\d|aybkk-profile|photo_id|"code"|"email"|"phone"/.test(fn.raw), fn.raw.slice(0, 300));
      const fa1a = fa1.find(x => x.c === '05:30') || {}, fa1b = fa1.find(x => x.c === '07:30') || {};
      const imgs = await Promise.all([fa1a, fa1b].map(x => getF(x.f || '/api/bkk/face/none')));
      ok("the link opens that student's face, 320 px (sharp in the 2x tablet's 150 px circle), with no key at all, both seats' links",
         imgs.every(img => img.status === 200 && img.type === 'image/jpeg' && img.bytes.includes(`signed://authenticated/aybkk-profile/${faceOf.FA1}/320`)
           && !img.bytes.includes(faceOf.FA2)), imgs.map(i => i.status + ' ' + i.bytes.slice(0, 80)).join(' | '));
      const [, , , exp1, sig1] = dl(fa1a), [, , , exp2] = dl(fa2);
      const swapped = [`/api/bkk/face/${faceOf.FA2}.d${devF}.${exp1}.${sig1}`, `/api/bkk/face/${faceOf.FT1}.d${devF}.${exp1}.${sig1}`,
        String(fa1a.f).replace(`.d${devF}.`, '.s.'), String(fa1a.f).replace(`.d${devF}.`, '.l.'), String(fa1a.f).replace(`.d${devF}.`, `.d${devF + 1}.`),
        `/api/bkk/face/${faceOf.FA1}.d${devF}.${Number(exp1) + 3600}.${sig1}`];
      const tries = await Promise.all(swapped.map(p => getF(p)));
      ok("...and cannot be edited into another student's face, another size, another tablet or a later end (403)", exp1 === exp2
         && tries.every(r => r.status === 403 && !r.bytes.includes('signed://')), tries.map(r => r.status).join());
      ok('...the door server with no photo storage gives no f, even for a student with a photo',
         (await getD('/api/bkk/door/now', HF)).body.seats.every(x => !('f' in x)));
      const TF = { ...TEACH, 'cf-connecting-ip': '192.0.2.61' };
      const tdF = await getF('/api/bkk/teacher/today', TF);
      const rowsF = (tdF.body.students || []).filter(x => /^(Faye Photoone|Finn Phototwo|Fran Nophoto|Tess Twinface)$/.test(x.name));
      const tFaye = rowsF.filter(x => x.name === 'Faye Photoone'), tFran = rowsF.find(x => x.name === 'Fran Nophoto') || {};
      const tFinn = rowsF.find(x => x.name === 'Finn Phototwo') || {};
      ok("/teach today: each seat carries the student's small face link (not the tablet's), null with no photo", tdF.status === 200 && rowsF.length === 6
         && tFaye.length === 2 && tFaye.every(x => (LINK.exec(x.photo || '') || [])[1] === faceOf.FA1 && LINK.exec(x.photo)[2] === 's') && tFaye[0].photo === tFaye[1].photo
         && (LINK.exec(tFinn.photo || '') || [])[1] === faceOf.FA2 && tFran.photo === null && 'photo' in tFran, JSON.stringify(rowsF.map(x => [x.name, x.photo])));
      const TEACH_ROW = 'added,alsoAt,bookingId,checkPass,checked_in_at,checkinBy,checkinVia,cover,isOnline,last_main,last_main_days,name,notes,photo,ref,rezerv,slotId,start_at,title';
      ok('...each row is exactly the keys it had plus photo, with no member code, email, phone or photo id, and no-store',
         tdF.body.students.every(x => Object.keys(x).sort().join() === TEACH_ROW) && !fCodes.some(c => tdF.raw.includes(c))
           && !/@|example\.com|0899\d|aybkk-profile|photo_id|"code"|"email"|"phone"/.test(tdF.raw)
           && (await fetch(BF + '/api/bkk/teacher/today', { headers: TF })).headers.get('cache-control') === 'private, no-store',
         JSON.stringify([...new Set(tdF.body.students.map(x => Object.keys(x).sort().join()))]));
      ok("...its link opens the face too, 160 px", (await getF((tFaye[0] || {}).photo || '/api/bkk/face/none')).bytes.includes(`/aybkk-profile/${faceOf.FA1}/160`));
      const vF = await getF('/api/bkk/teacher/student/' + encodeURIComponent((tFaye[0] || {}).ref || 'none'), TF);
      const vN = await getF('/api/bkk/teacher/student/' + encodeURIComponent(tFran.ref), TF);
      const vC = await getF('/api/bkk/teacher/student/' + encodeURIComponent(people.FA2.code), TF);
      ok('the student view on /teach carries the small face link, by ref (no code) or by a typed code, null with no photo',
         vF.status === 200 && vF.body.member.photo === tFaye[0].photo && !('code' in vF.body.member) && !vF.raw.includes(people.FA1.code)
           && (vN.body.member || {}).photo === null && (vC.body.member || {}).photo === tFinn.photo && (vC.body.member || {}).code === people.FA2.code,
         JSON.stringify([vF.body.member, vN.body.member && vN.body.member.photo, vC.body.member && vC.body.member.photo]));
      ok('...and the teacher routes still take no door key, and answer no-store', (await getF('/api/bkk/teacher/today', HF)).status === 401
         && (await getF('/api/bkk/teacher/student/' + encodeURIComponent((tFaye[0] || {}).ref || 'none'), HF)).status === 401
         && (await fetch(BF + '/api/bkk/teacher/student/' + encodeURIComponent((tFaye[0] || {}).ref || 'none'), { headers: TF })).headers.get('cache-control') === 'private, no-store'
         && (await fetch(BF + '/api/bkk/teacher/members?q=fa', { headers: TF })).headers.get('cache-control') === 'private, no-store');
      cc = AT(D3, '07:31:00');
      const over = await getF(fa1a.f || '/api/bkk/face/none'), still = await getF(fa1b.f || '/api/bkk/face/none');
      ok("a tablet's face link stops when its class ends (410), while the next class's link still opens",
         over.status === 410 && !over.bytes.includes('signed://') && still.status === 200 && still.bytes.includes(faceOf.FA1), `${over.status} ${still.status}`);
      cc = AT(D3, '06:45:00');
      await pool.query('UPDATE bkk_members SET photo_id=NULL WHERE id=$1', [people.FA2.id]);
      const gone = await getF(fa2.f || '/api/bkk/face/none');
      ok('a photo removed: its link stops at once and the next list has no f for that seat', gone.status === 404
         && !('f' in ((await getF('/api/bkk/door/now', HF)).body.seats.find(x => x.n === 'Finn P.') || { f: 1 })), String(gone.status));
      await postD(`/api/bkk/admin/door/devices/${devF}/revoke`, {}, ADMIN);
      const unp = await getF(fa1b.f || '/api/bkk/face/none'), tStill = await getF((tFaye[0] || {}).photo || '/api/bkk/face/none');
      ok("Unpair: that tablet's face links stop at once (410), /teach's link still opens",
         (await getF('/api/bkk/door/now', HF)).status === 401 && unp.status === 410 && !unp.bytes.includes('signed://') && tStill.status === 200,
         `${unp.status} ${tStill.status}`);
      await pool.query('DELETE FROM bkk_bookings WHERE id = ANY($1::int[])', [Object.values(fs_)]);
      await pool.query('UPDATE bkk_members SET photo_id=NULL WHERE id = ANY($1::int[])', [['FA1', 'FT1', 'FT2'].map(k => people[k].id)]);
      srvF.close();
      const page = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'bkk.html'), 'utf8');
      const who = [...page.matchAll(/faceWho: '([^']*)'/g)].map(m => m[1]);
      ok('the upload card says in all 4 languages that the photo is shown at check-in, never "only you and your teachers"', who.length === 4
         && /check-in screen/.test(who[0]) && /เช็กอิน/.test(who[1]) && /签到/.test(who[2]) && /отметки/.test(who[3])
         && !/only you and your teachers|เฉพาะคุณและครู|只有你和老师|только вы и ваши учителя/i.test(page) && who.every(s => !s.includes('\u2014')), JSON.stringify(who));
    }

    // ── /teach: the lock-out first ──
    const ipT = { 'cf-connecting-ip': '192.0.2.44' };
    const markRes = await getD('/api/bkk/teacher/me', { ...TEACH, ...ipT });
    const MARK = markRes.headers.get('x-teacher-known');
    ok('a right passcode gives this browser a signed "known browser" mark', markRes.status === 200 && /^\d+\.\d+\.[A-Za-z0-9_-]{22}$/.test(MARK || ''), MARK);
    const misses = [];
    for (let i = 0; i < 8; i++) misses.push((await getD('/api/bkk/teacher/me', { 'x-teacher-key': 'wrong-' + i, ...ipT })).status);
    const lockedOut = await getD('/api/bkk/teacher/me', { ...TEACH, ...ipT });
    ok('8 wrong passcodes from one address: 401 each, then 429 there for the right one too',
       misses.every(x => x === 401) && lockedOut.status === 429 && lockedOut.body.locked === true
         && (await getD('/api/bkk/teacher/today', { ...TEACH, ...ipT })).status === 429, JSON.stringify([misses, lockedOut.status]));
    ok('...another address is not locked out', (await getD('/api/bkk/teacher/me', { ...TEACH, 'cf-connecting-ip': '192.0.2.45' })).status === 200);
    ok('...the 429 says how to get in now: mobile data', /mobile data/.test(lockedOut.body.error || ''), lockedOut.body.error);
    const forgedMark = MARK && MARK.replace(/.$/, c => c === 'A' ? 'B' : 'A');
    ok('a browser that signed in before is counted on its own: the right passcode still works on the locked shala wifi, a made-up mark does not',
       (await getD('/api/bkk/teacher/today', { ...TEACH, ...ipT, 'x-teacher-known': MARK })).status === 200
         && (await getD('/api/bkk/teacher/me', { ...TEACH, ...ipT, 'x-teacher-known': forgedMark })).status === 429
         && (await getD('/api/bkk/teacher/me', { ...TEACH, ...ipT, 'x-teacher-known': '1.1.' + 'A'.repeat(22) })).status === 429);
    const markMiss = [];
    for (let i = 0; i < 9; i++) markMiss.push((await getD('/api/bkk/teacher/me', { 'x-teacher-key': 'wrong-mark-' + i, 'x-teacher-known': MARK, 'cf-connecting-ip': '192.0.2.47' })).status);
    ok('...and wrong passcodes with that mark lock that mark out after 8, wherever they come from', markMiss.slice(0, 8).every(x => x === 401) && markMiss[8] === 429,
       markMiss.join());

    // ── /teach: today's list and its fixes ──
    cc = AT(D, '06:45:00');
    const TH = { ...TEACH, 'cf-connecting-ip': '192.0.2.46' };
    // The check-pass flag: a pause that has ended is fine; a seat on a void pass with a live twin is fine;
    // no live pass at all is flagged; a Rezerv seat says Rezerv.
    const pz = await mk('PAU', 'Paula Pausedbefore', { code: 'unlim1', from: plus(D, -20), until: plus(D, 20), status: 'frozen' });
    await pool.query(`UPDATE bkk_passes SET frozen_from=$2, frozen_until=$3 WHERE id=$1`, [pz.pass, plus(D, -10), plus(D, -2)]);
    await seat(pz, my730);
    const tw = await mk('TWN', 'Tia Twinback', { code: 'unlim1', from: plus(D, -5), until: plus(D, 25), status: 'void' });
    await one(`INSERT INTO bkk_passes (member_id,product_id,kind,daily_cap,valid_days,valid_from,valid_until,status,source)
      SELECT $1, id, kind, daily_cap, valid_days, $2::date, $3::date, 'active', 'rezerv' FROM bkk_products WHERE code='unlim1' RETURNING id`, [tw.id, plus(D, -5), plus(D, 25)]);
    await seat(tw, my730);
    const np = await mk('NOP', 'Nils Nopass', { code: 'unlim1', from: plus(D, -40), until: plus(D, -10) });
    await seat(np, my730);
    const rz = await mk('RZV', 'Rita Rezervseat', null);
    await seat(rz, my730, D, { pass: null, cover: 'rezerv' });
    const td = await getD('/api/bkk/teacher/today', TH);
    const st_ = n => td.body.students.find(x => x.name === n) || {};
    ok("/teach today: no member code anywhere in the answer, a ref and the booking id instead", td.status === 200
       && !Object.values(people).some(p => td.raw.includes(p.code)) && td.body.students.every(x => !('code' in x) && /^m\.[A-Za-z0-9_-]{43}$/.test(x.ref) && Number.isInteger(x.bookingId)),
       td.raw.slice(0, 200));
    const benRows = td.body.students.filter(x => x.name === 'Ben Sample');
    ok('a student with two seats today has the other time on each row (a wrong class booked by mistake shows)', benRows.length === 2
       && String(benRows.find(x => x.bookingId === s.BEN730).alsoAt) === '05:30' && String(benRows.find(x => x.bookingId === s.BEN).alsoAt) === '07:30'
       && String(st_('Paula Pausedbefore').alsoAt) === '', JSON.stringify(benRows.map(x => x.alsoAt)));
    ok('the ref shows no member id and stays the same', td.body.students.every(x => !x.ref.split('.').includes(String(people.BEN.id)))
       && benRows[0].ref === benRows[1].ref && benRows[0].ref === (await getD('/api/bkk/teacher/today', TH)).body.students.find(x => x.name === 'Ben Sample').ref);
    ok('...the check-pass flag: none for a pause that has ended or a pass whose twin came back, yes with no live pass, Rezerv for a Rezerv seat',
       st_('Paula Pausedbefore').checkPass === false && st_('Tia Twinback').checkPass === false && st_('Nils Nopass').checkPass === true
         && st_('Rita Rezervseat').rezerv === true && st_('Rita Rezervseat').checkPass === false && st_('Ben Sample').checkPass === false,
       JSON.stringify(['Paula Pausedbefore', 'Tia Twinback', 'Nils Nopass', 'Rita Rezervseat'].map(n => [st_(n).checkPass, st_(n).rezerv])));
    ok('...and today\'s classes to add someone to, the online one marked', td.body.classes.some(c => c.slotId === my730 && !c.isOnline)
       && td.body.classes.some(c => c.slotId === onl && c.isOnline) && !td.body.classes.some(c => c.slotId === cxl));
    const snap1 = await passSnap();
    const ci = await postD(`/api/bkk/teacher/bookings/${s.BEN730}/checkin`, {}, TH);
    const bBen = await one(`SELECT checked_in_at, checkin_via, checkin_by FROM bkk_bookings WHERE id=$1`, [s.BEN730]);
    ok('a teacher checks a booked seat in by its booking id, and the seat says who', ci.status === 200 && ci.body.success
       && bBen.checkin_via === 'teacher' && bBen.checkin_by === 'Door Teacher' && !!bBen.checked_in_at, JSON.stringify([ci.body, bBen]));
    const un = await postD(`/api/bkk/teacher/bookings/${s.BEN730}/checkin`, { undo: true }, TH);
    const bBen2 = await one(`SELECT checked_in_at, checkin_via, checkin_by FROM bkk_bookings WHERE id=$1`, [s.BEN730]);
    ok('...and undoes it: no time, recorded as the teacher, classes untouched', un.status === 200 && !bBen2.checked_in_at
       && bBen2.checkin_via === 'teacher' && bBen2.checkin_by === 'Door Teacher' && (await passSnap()) === snap1, JSON.stringify(bBen2));
    ok('a teacher route takes no door key and no admin key for these', (await postD(`/api/bkk/teacher/bookings/${s.BEN730}/checkin`, {}, { 'x-door-key': KEY2 })).status === 401
       && (await postD(`/api/bkk/teacher/bookings/${s.BEN730}/checkin`, {}, ADMIN)).status === 401);
    const nextWeek = await seat(people.BEN, my730, plus(D, 7));
    ok('not for another day, and not for an online class', (await postD(`/api/bkk/teacher/bookings/${nextWeek}/checkin`, {}, TH)).status === 409
       && (await postD(`/api/bkk/teacher/bookings/${s.ONL}/checkin`, {}, TH)).status === 409);
    // Add: over the class limit is fine; a pass not started, or starting later, is refused untouched.
    await pool.query(`INSERT INTO bkk_class_overrides (slot_id,class_date,capacity) VALUES ($1,$2,1)`, [my730, D]);
    const wal = await mk('WAL', 'Walt Walkin', { code: 'pack8', used: 3, from: plus(D, -3), until: plus(D, 57) });
    const refOf = async name => ((await getD('/api/bkk/teacher/members?q=' + encodeURIComponent(name), TH)).body.members || [])[0];
    const wRef = await refOf('Walt Walkin');
    ok('the teacher search gives a ref and says who has a pass today', wRef && /^m\./.test(wRef.ref) && wRef.passToday === true);
    const add = await postD('/api/bkk/teacher/add', { slotId: my730, ref: wRef.ref }, TH);
    const wSeat = await one(`SELECT id, source, checked_in_at, checkin_via, checkin_by, pass_id FROM bkk_bookings
      WHERE member_id=$1 AND class_date=$2 AND status='booked'`, [wal.id, D]);
    ok('Add: over the class limit, booked and checked in, as the teacher, one class from the pack',
       add.status === 200 && add.body.success && add.body.overCapacity === true && wSeat.source === 'teacher' && !!wSeat.checked_in_at
         && wSeat.checkin_via === 'teacher' && wSeat.checkin_by === 'Door Teacher' && wSeat.pass_id === wal.pass
         && (await one('SELECT credits_used FROM bkk_passes WHERE id=$1', [wal.pass])).credits_used === 4, JSON.stringify([add.body, wSeat]));
    const again2 = await postD('/api/bkk/teacher/add', { slotId: my730, ref: wRef.ref }, TH);
    ok('...adding them again only says they are on the list, no second class', again2.status === 200 && again2.body.already === true
       && (await one('SELECT credits_used FROM bkk_passes WHERE id=$1', [wal.pass])).credits_used === 4);
    const ns = await mk('NST', 'Nora Notstarted', { code: 'pack8' });
    const lt = await mk('LTR', 'Leo Laterstart', { code: 'unlim1', from: plus(D, 3), until: plus(D, 33) });
    const nsSnap = async () => JSON.stringify((await pool.query(`SELECT credits_used, valid_from, valid_until FROM bkk_passes WHERE id = ANY($1::int[]) ORDER BY id`,
      [[ns.pass, lt.pass]])).rows);
    const nsBefore = await nsSnap();
    const nsAdd = await postD('/api/bkk/teacher/add', { slotId: my730, ref: (await refOf('Nora Notstarted')).ref }, TH);
    const ltAdd = await postD('/api/bkk/teacher/add', { slotId: my730, ref: (await refOf('Leo Laterstart')).ref }, TH);
    ok('Add refuses a pass not started, or starting later, with a plain line, and never starts it',
       nsAdd.status === 409 && nsAdd.body.error === 'Pass not started. Ask Boonchu or M.' && ltAdd.status === 409 && ltAdd.body.error === 'Pass not started. Ask Boonchu or M.'
         && (await nsSnap()) === nsBefore && !(await one(`SELECT id FROM bkk_bookings WHERE member_id = ANY($1::int[]) AND class_date=$2`, [[ns.id, lt.id], D])).id,
       JSON.stringify([nsAdd.body, ltAdd.body]));
    const carAdd = await postD('/api/bkk/teacher/add', { slotId: my730, ref: (await refOf('Cara (Nok) Ocean')).ref }, TH);
    ok('Add says when the student is also booked at another time today', carAdd.status === 200 && carAdd.body.already === false
       && JSON.stringify(carAdd.body.alsoAt) === '["05:30"]', JSON.stringify(carAdd.body));
    const npAdd = await postD('/api/bkk/teacher/add', { slotId: my530, ref: (await refOf('Nils Nopass')).ref }, TH);
    ok('...and someone with no pass for today', npAdd.status === 409 && npAdd.body.error === 'No pass for today. Ask Boonchu or M.', JSON.stringify(npAdd.body));
    ok('...and an online class, a member code instead of a ref', (await postD('/api/bkk/teacher/add', { slotId: onl, ref: wRef.ref }, TH)).status === 409
       && (await postD('/api/bkk/teacher/add', { slotId: my730, ref: wal.code }, TH)).status === 400);
    const td2 = await getD('/api/bkk/teacher/today', TH);
    ok("today's list marks the seat added here, so it can be taken off", td2.body.students.find(x => x.bookingId === wSeat.id).added === true
       && td2.body.students.find(x => x.bookingId === s.BEN730).added === false);
    ok('Remove takes off only a name added here today', (await postD(`/api/bkk/teacher/bookings/${s.BEN730}/remove`, {}, TH)).status === 409);
    const rm = await postD(`/api/bkk/teacher/bookings/${wSeat.id}/remove`, {}, TH);
    const wGone = await one(`SELECT status, cancel_reason, checkin_via, checkin_by FROM bkk_bookings WHERE id=$1`, [wSeat.id]);
    const wPass = await one(`SELECT credits_used, note FROM bkk_passes WHERE id=$1`, [wal.pass]);
    ok('Remove: cancelled, the class back on the pack, and both say who and why', rm.status === 200 && rm.body.creditReturned === true
       && wGone.status === 'cancelled' && /taken off by Door Teacher/.test(wGone.cancel_reason) && wGone.checkin_by === 'Door Teacher'
       && wPass.credits_used === 3 && /added on \/teach and taken off by Door Teacher: given back/.test(wPass.note), JSON.stringify([rm.body, wGone, wPass]));
    ok('...once', (await postD(`/api/bkk/teacher/bookings/${wSeat.id}/remove`, {}, TH)).status === 409
       && (await one(`SELECT credits_used FROM bkk_passes WHERE id=$1`, [wal.pass])).credits_used === 3);
    // The student view and a note from today's list, by ref: no code comes back.
    const view = await getD('/api/bkk/teacher/student/' + st_('Ben Sample').ref, TH);
    const note = await postD('/api/bkk/teacher/notes', { ref: st_('Ben Sample').ref, toWorkOn: 'Breathe first' }, TH);
    ok('opening a student from today by ref shows them with no member code, and a note saves by ref', view.status === 200
       && view.body.member.name === 'Ben Sample' && !('code' in view.body.member) && !view.raw.includes(people.BEN.code)
       && note.status === 200 && (await one('SELECT count(*)::int AS n FROM bkk_notes WHERE member_id=$1', [people.BEN.id])).n === 1);
    const bRef = st_('Ben Sample').ref;
    ok('a ref with a wrong signature opens nothing', (await getD('/api/bkk/teacher/student/' + bRef.slice(0, -1) + (bRef.endsWith('x') ? 'y' : 'x'), TH)).status === 404);

    // The student agreement (20 Nov 2026), switched on to 'require': the door key sees nothing new
    // and still checks anyone in, /teach gets two true/false and still adds and checks in, and
    // Today and the class roster say signed or not. Off again, every one of those is as before.
    {
      const Hs = ipH();
      const stA = await postD('/api/bkk/door/pair/start', {}, Hs);
      await postD('/api/bkk/admin/door/pair', { code: stA.body.code, name: 'Agreement door' }, { ...ADMIN, ...ipH() });
      const KA = { 'x-door-key': (await postD('/api/bkk/door/pair/claim', { secret: stA.body.secret }, Hs)).body.key, ...Hs };
      cc = AT(D, '05:20:00');
      const offNow = await getD('/api/bkk/door/now', KA);
      cc = AT(D, '06:45:00');
      const offTeach = await getD('/api/bkk/teacher/today', TH);
      const offToday = await getD('/api/bkk/admin/today', ADMIN);
      const on = await postD('/api/bkk/admin/settings', { privacyName: 'Example Yoga Co., Ltd.', privacyAddress: '1 Example Road, Bangkok',
        privacyEmail: 'privacy@example.com', consentMode: 'require' }, ADMIN);
      const sb = await postD(`/api/bkk/me/${people.BEN.code}/consent`, { agree: true, version: 'v1', lang: 'en', name: 'Ben Sample', under20: true });
      const sc = await postD(`/api/bkk/me/${people.CAR.code}/consent`, { agree: true, version: 'v1', lang: 'th', name: 'Cara Ocean' });
      ok('agreement on in require, two students sign on their own phones', on.status === 200 && on.body.consent.mode === 'require'
         && sb.status === 200 && sc.status === 200 && sb.body.consent.under20 === true, JSON.stringify([on.body.consent, sb.body, sc.body]));
      cc = AT(D, '05:20:00');
      const onNow = await getD('/api/bkk/door/now', KA);
      ok('the door tablet list is what it was with the agreement off: the same keys, each seat a handle, the name, in, at and its class time, no word about the agreement',
         onNow.status === 200 && offNow.status === 200 && onNow.body.seats.length === offNow.body.seats.length && onNow.body.seats.length > 0
           && Object.keys(onNow.body).sort().join() === Object.keys(offNow.body).sort().join()
           && onNow.body.seats.every(x => Object.keys(x).sort().join() === 'at,c,in,n,t')
           && !/consent|signed|under20|guardian|agree/i.test(onNow.raw), onNow.raw.slice(0, 200));
      const anaT = onNow.body.seats.find(x => x.n === 'Ana Exa.');
      const dci = await postD('/api/bkk/door/checkin', { t: anaT && anaT.t }, KA);
      ok('...and a tap checks an unsigned student in, with no word about it either', dci.status === 200 && dci.body.ok === true
         && !/consent|signed|under20|agree/i.test(dci.raw), dci.raw);
      cc = AT(D, '06:45:00');
      const tt = await getD('/api/bkk/teacher/today', TH);
      const tOf = n => tt.body.students.find(x => x.name === n) || {};
      ok('/teach today: each student has signed and under20 as true or false, and nothing else of the agreement',
         tt.status === 200 && tt.body.students.every(x => typeof x.signed === 'boolean' && typeof x.under20 === 'boolean')
           && tOf('Ben Sample').signed === true && tOf('Ben Sample').under20 === true && tOf('Cara (Nok) Ocean').signed === true
           && tOf('Cara (Nok) Ocean').under20 === false && tOf('Ana Example').signed === false
           && !/signedName|signedAt|signed_name|guardianName|"via"|"version"|Cara Ocean|consent/.test(tt.raw), tt.raw.slice(0, 200));
      ok('...and with the agreement off, neither field is there', offTeach.status === 200
         && offTeach.body.students.every(x => !('signed' in x) && !('under20' in x)));
      const tv = await getD('/api/bkk/teacher/student/' + tOf('Ben Sample').ref, TH);
      ok('/teach student: the agreement is two true/false only', tv.status === 200
         && JSON.stringify(tv.body.consent) === JSON.stringify({ signed: true, under20: true }) && !/Ben Sample.*v1|signedAt|"via"/.test(tv.raw), JSON.stringify(tv.body.consent));
      const dAdd = await postD('/api/bkk/teacher/add', { slotId: my730, ref: (await refOf('Mr Dan Sample')).ref }, TH);
      const open_ = await one(`SELECT b.id FROM bkk_bookings b WHERE b.class_date=$1 AND b.slot_id=$2 AND b.status='booked'
        AND b.checked_in_at IS NULL AND NOT EXISTS (SELECT 1 FROM bkk_consents c WHERE c.member_id=b.member_id) ORDER BY b.id LIMIT 1`, [D, my730]);
      const tci = await postD(`/api/bkk/teacher/bookings/${open_.id}/checkin`, {}, TH);
      ok('/teach adds and checks in students who have not signed, in require', dAdd.status === 200 && dAdd.body.success === true
         && tci.status === 200 && tci.body.success === true, JSON.stringify([dAdd.body, tci.body]));
      const at_ = await getD('/api/bkk/admin/today', ADMIN);
      const cr = await getD(`/api/bkk/admin/class?slotId=${my530}&date=${D}`, ADMIN);
      ok('Admin Today and the class roster say signed or not for each name', at_.status === 200 && at_.body.bookings.length > 0
         && at_.body.bookings.every(b => typeof b.consent === 'boolean') && at_.body.bookings.find(b => b.code === people.CAR.code).consent === true
         && at_.body.bookings.find(b => b.code === people.ANA.code).consent === false
         && cr.body.roster.every(b => typeof b.consent === 'boolean') && cr.body.roster.find(b => b.code === people.BEN.code).consent === true,
         JSON.stringify(cr.body.roster && cr.body.roster.map(b => [b.name, b.consent])));
      ok('...and with it off, Today has no such field', offToday.body.bookings.every(b => !('consent' in b)));
      await postD('/api/bkk/admin/settings', { consentMode: 'off' }, ADMIN);
      ok('switched off again: Today, the roster and /teach are as before', (await getD('/api/bkk/admin/today', ADMIN)).body.bookings.every(b => !('consent' in b))
         && (await getD(`/api/bkk/admin/class?slotId=${my530}&date=${D}`, ADMIN)).body.roster.every(b => !('consent' in b))
         && (await getD('/api/bkk/teacher/today', TH)).body.students.every(x => !('signed' in x)));
    }

    await pool.query(`DELETE FROM bkk_class_overrides WHERE slot_id = ANY($1::int[]) AND class_date=$2`, [[my730, cxl], D]);
    await pool.query(`UPDATE bkk_class_slots SET active=false WHERE id = ANY($1::int[])`, [[onl, cxl]]);
    await pool.query(`UPDATE bkk_class_slots SET active=true WHERE id = ANY($1::int[])`, [parked]);
    srvD.close();
  }

  // Photos tagged from today's list carry a ref, not the code: one student named both ways is one tag.
  {
    const PK = { 'x-teacher-key': (await post('/api/bkk/admin/teachers', { name: 'Ref Tagger' }, ADMIN)).body.passcode };
    const m = await quickAdd({ name: 'Rhea Reftag', email: 'rhea.reftag@example.com' }, PK);
    const up = await post('/api/bkk/teacher/photos', { date: '2026-10-05', image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      tags: [{ code: m.ref, role: 'other' }, { code: m.code, role: 'main' }] }, PK);
    ok('a photo tagged by ref and by code for the same student has one tag, main', up.status === 200 && up.body.photo.members.length === 1
       && up.body.photo.members[0].role === 'main' && up.body.photo.members[0].ref === m.ref, JSON.stringify(up.body.photo && up.body.photo.members));
    const pf = await J(`/api/bkk/teacher/members/${encodeURIComponent(m.ref)}/photos`, { headers: PK });
    ok('...and the photo profile opens by ref, with no code in it', pf.status === 200 && pf.body.member.ref === m.ref && !('code' in pf.body.member)
       && pf.body.totals.photos === 1, JSON.stringify(pf.body.member));
  }
  // /door (the staff key) and the admin class view say who checked a seat in too.
  {
    const slot = (await pool.query(`SELECT id FROM bkk_class_slots WHERE is_online IS NOT TRUE ORDER BY id LIMIT 1`)).rows[0].id;
    const m = (await pool.query(`INSERT INTO bkk_members (code,name,email) VALUES ('BVIATEST000001','Vic Viatest','vic.viatest@example.com') RETURNING id`)).rows[0].id;
    const bid = (await pool.query(`INSERT INTO bkk_bookings (slot_id,class_date,start_at,member_id,status,cover,source)
      VALUES ($1, (now() AT TIME ZONE 'Asia/Bangkok')::date, now(), $2, 'booked', 'rezerv', 'staff') RETURNING id`, [slot, m])).rows[0].id;
    const via = async () => (await pool.query('SELECT checked_in_at, checkin_via, checkin_by FROM bkk_bookings WHERE id=$1', [bid])).rows[0];
    const d = await post('/api/bkk/checkin', { memberCode: 'BVIATEST000001' }, ADMIN);
    const v1 = await via();
    ok("/door's tap records 'door'", d.body.ok === true && v1.checkin_via === 'door' && v1.checkin_by === null && !!v1.checked_in_at, JSON.stringify(v1));
    await post(`/api/bkk/admin/bookings/${bid}/checkin`, { undo: true }, ADMIN);
    const v2 = await via();
    await post(`/api/bkk/admin/bookings/${bid}/checkin`, {}, ADMIN);
    const v3 = await via();
    ok("...and the admin class view 'admin', for an undo and a check-in", !v2.checked_in_at && v2.checkin_via === 'admin'
       && !!v3.checked_in_at && v3.checkin_via === 'admin', JSON.stringify([v2, v3]));
    await pool.query('DELETE FROM bkk_bookings WHERE id=$1', [bid]);
  }
  // ── the student agreement (20 Nov 2026) ──────────────────────────────────────
  // Off by default and nothing changes (every test above ran with it off). Its text is pinned
  // by hash. In 'ask' checkout asks; in 'require' a student's own booking asks too. Payments,
  // staff, /teach, imports and check-ins are never refused.
  console.log('\n— the student agreement —');
  {
    const { CONSENT_TEXT, CONSENT_VERSION, checkConsentText } = require('../bkk-api.js');
    const one = async (sql, args = []) => (await pool.query(sql, args)).rows[0] || {};
    const sha = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
    const SET = body => post('/api/bkk/admin/settings', body, ADMIN);
    const rowsOf = async code => (await pool.query(`SELECT c.* FROM bkk_consents c JOIN bkk_members m ON m.id=c.member_id
      WHERE m.code=$1 ORDER BY c.id`, [code])).rows;
    const tick = (o = {}) => ({ agree: true, version: 'v1', lang: 'en', under20: false, ...o });
    const grant = async (name, email, productCode = 'pack8') =>
      (await post('/api/bkk/admin/passes', { name, email, productCode }, ADMIN)).body.member.code;
    // The door block above switched it on and off: start from a shala that never had it.
    await pool.query(`DELETE FROM bkk_settings WHERE key IN ('consent_mode','consent_since','privacy_legal_name','privacy_address','privacy_email')`);
    const passOf = code => one(`SELECT p.valid_from, p.valid_until, p.credits_used FROM bkk_passes p JOIN bkk_members m ON m.id=p.member_id
      WHERE m.code=$1 ORDER BY p.id DESC LIMIT 1`, [code]);

    // The wording: pinned, and what a page is served is what is pinned.
    const PINNED = {
      en: ['f5e5e04d53f70d5ca11548b68fe95389b57fb43e3ef3147b488009968f9919cb', '2ecd21d65cf15328969e5d36340ab649a9022bece07df4a344c5344069f30016'],
      th: ['fa6ee2d1b3144e0229ef6410d6539d745473c86d6498150859efc3968fb7a6d2', 'cb1621b669d7e7e7178019a0585cc40c3e38c131762c233a22f4851c24b825c0'],
      zh: ['4634fa6fe518961986cbf6a9caf1459e8bb0f2b3ed98dce6ec9ff40048b97b6b', '2f6e8618cd17bf35b8bacfa44d3408e07d7d51d8833e7b3a30e9b5dedcb4e0a5'],
      ru: ['32ba4875bcecd36c8db1cd81b36b2fcc0835ed09406d2a458660a04b2f2ac7de', '2e7a8bce0b0259e32b290eb66054e8ed3ff082574d7bf54d8eff5fe563d8ce34'],
    };
    ok('v1 is the current version, in exactly these 4 languages', CONSENT_VERSION === 'v1' && Object.keys(CONSENT_TEXT.v1).join() === 'en,th,zh,ru');
    for (const [l, [a, pv]] of Object.entries(PINNED)) {
      const c = await J(`/api/bkk/consent?lang=${l}`);
      ok(`v1 ${l.toUpperCase()}: the agreement and the privacy notice are the pinned text, and the page is served that text`,
         sha(CONSENT_TEXT.v1[l].agreement) === a && sha(CONSENT_TEXT.v1[l].privacy) === pv && c.status === 200 && c.body.lang === l
           && c.body.sha === a && sha(c.body.text.agreement) === a && sha(c.body.text.privacy) === pv, `${sha(CONSENT_TEXT.v1[l].agreement)} ${sha(CONSENT_TEXT.v1[l].privacy)}`);
    }
    ok('v1 has 18 lines in each language', ['en', 'th', 'zh', 'ru'].every(l => CONSENT_TEXT.v1[l].agreement.groups.flatMap(g => g[1]).length === 18));
    // Lines 14 to 16 are the booking page's own Member notes, in every language (the Chinese one once
    // said "a new student who just came" for "someone new to AYBKK").
    {
      const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'bkk.html'), 'utf8');
      const notes = [...html.matchAll(/pol([1-4][ab]): '([^']*)'/g)];
      const pol = Object.fromEntries(['en', 'th', 'zh', 'ru'].map((l, i) => [l, Object.fromEntries(notes.slice(i * 8, i * 8 + 8).map(m => [m[1], m[2]]))]));
      ok("lines 14 to 16 say what the page's Member notes say, in all 4 languages", notes.length === 32 && ['en', 'th', 'zh', 'ru'].every(l => {
        const ls = CONSENT_TEXT.v1[l].agreement.groups[2][1], p = pol[l];
        return ls[1] === p['2a'] + p['2b'] && ls[2] === p['4a'] + p['4b'] && ls[3] === p['3a'] + p['3b'];
      }), JSON.stringify(pol.zh));
      // Line 11's towels (draft 3, 20 Nov 2026) open the page's "Your first class" line too, and no longer say bring one.
      const f3 = [...html.matchAll(/\bf3: '([^']*)'/g)].map(m => m[1]);
      const fallback = (/<li[^>]*id="fst3"[^>]*>([^<]*)<\/li>/.exec(html) || [])[1];
      const towels = { en: /^[^.]*\. /, th: /^\S+ /, zh: /^[^。]*。/, ru: /^[^.]*\. / };
      ok("line 11's towel sentence opens the first-class line (f3), in all 4 languages and the page's own English",
        f3.length === 4 && ['en', 'th', 'zh', 'ru'].every((l, i) => {
          const first = (towels[l].exec(CONSENT_TEXT.v1[l].agreement.groups[1][1][4]) || [''])[0];
          return first.length > 8 && f3[i].startsWith(first) && !/a towel|และผ้าเช็ดตัวมาเอง|和毛巾|и полотенце или/.test(f3[i]);
        }) && fallback === f3[0], JSON.stringify(f3.map(x => x.slice(0, 50))));
    }
    // The privacy notice names every service the code hands personal data to (inbox.js, team-brief.js,
    // server.js included: Neo4j keeps orientation forms and journals, OpenRouter writes the staff AI summary
    // of a journal), and the messages, orientation answers and practice journal kept.
    ok('the privacy notice names every service that handles the data, and the practice journal, in every language', ['en', 'th', 'zh', 'ru'].every(l => {
      const txt = CONSENT_TEXT.v1[l].privacy.sections.map(x => x[1]).join(' ');
      return ['PaySolutions', 'Resend', 'Cloudinary', 'Google', 'Railway', 'Telegram', 'LINE', 'Meta', 'Instagram', 'Facebook', 'Anthropic', 'Neo4j',
        'OpenRouter', 'DeepSeek', 'IP', '90', { en: 'practice journal', th: 'บันทึกการฝึก', zh: '练习日记', ru: 'дневник практики' }[l]]
        .every(w => txt.includes(w));
    }));
    const throwsWith = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
    const noTh = { v1: { en: CONSENT_TEXT.v1.en } }, noEn = { v1: { th: CONSENT_TEXT.v1.th } };
    ok('the server refuses to start when the current version has no English or no Thai', throwsWith(() => checkConsentText(noTh, 'v1'), /no TH text/)
       && throwsWith(() => checkConsentText(noEn, 'v1'), /no EN text/) && throwsWith(() => checkConsentText(CONSENT_TEXT, 'v2'), /v2 has no text/)
       && !throwsWith(() => checkConsentText(), /./));
    const c0 = await J('/api/bkk/consent?lang=xx');
    ok('the public text needs no key, says the switch is off, falls back to English and holds no personal data', c0.status === 200
       && c0.body.mode === 'off' && c0.body.lang === 'en' && c0.body.langs.join() === 'en,th,zh,ru' && c0.body.since === null
       && Object.keys(c0.body).sort().join() === 'current,lang,langs,mode,sha,since,text,version'
       && !/"member|"code"|email_at|signed_name/.test(JSON.stringify(c0.body)), Object.keys(c0.body).join());

    // The switch.
    const s0 = (await J('/api/bkk/admin/settings', { headers: ADMIN })).body.consent;
    ok('Settings show the switch off, v1, its 4 languages, and that the privacy notice is not filled in', s0 && s0.mode === 'off' && s0.version === 'v1'
       && s0.langs.join() === 'en,th,zh,ru' && s0.privacyFilled === false && s0.canTurnOn === false
       && s0.missing.join() === 'privacy name,privacy address,privacy email', JSON.stringify(s0));
    ok('only the staff key changes it', (await post('/api/bkk/admin/settings', { consentMode: 'ask' })).status === 401
       && (await post('/api/bkk/admin/settings', { consentMode: 'ask' }, { 'x-bkk-key': 'nope' })).status === 401);
    const noPriv = await SET({ consentMode: 'ask' });
    ok('it cannot leave off while the privacy notice lacks its name, address and email: 400, still off', noPriv.status === 400
       && noPriv.body.missing.join() === 'privacy name,privacy address,privacy email'
       && (await J('/api/bkk/consent')).body.mode === 'off', JSON.stringify(noPriv.body));
    ok('a mode that is not off, ask or require, or a privacy email that is not one, is refused', (await SET({ consentMode: 'on' })).status === 400
       && (await SET({ privacyEmail: 'not an email' })).status === 400 && (await SET({ privacyName: '<b>x</b>' })).status === 400);
    const PRIV = { privacyName: 'Example Yoga Co., Ltd.', privacyAddress: '1 Example Road, Bangkok 10110', privacyEmail: 'privacy@example.com' };
    const zh = CONSENT_TEXT.v1.zh;
    delete CONSENT_TEXT.v1.zh;
    const noZh = await SET({ ...PRIV, consentMode: 'require' });
    CONSENT_TEXT.v1.zh = zh;
    ok('...nor while a language is missing, even with the privacy notice filled: 400 and nothing saved', noZh.status === 400
       && noZh.body.missing.join() === 'ZH text' && (await J('/api/bkk/admin/settings', { headers: ADMIN })).body.consent.privacyFilled === false,
       JSON.stringify(noZh.body));
    const offPolicy = await fetch(`${B}/policy`, { redirect: 'manual' });
    const offMe = await post('/api/bkk/me/' + (await grant('Off Tester', 'off.tester@example.com')) + '/consent', tick({ name: 'Off Tester' }));
    const offEv = await post('/api/bkk/start-event', { page: 'book', kind: 'consent-shown', src: 'buy', lang: 'en' });
    ok('while off, /policy is not there, nobody can sign (409 off, which the page reads as "go on") and the screen is not counted',
       offPolicy.status === 404 && offMe.status === 409 && offMe.body.off === true && offEv.status === 400, `${offPolicy.status} ${offMe.status} ${offEv.status}`);
    const toAsk = await SET({ ...PRIV, consentMode: 'ask' });
    const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
    ok('with all 4 languages and the 3 facts, it goes to ask, and the agreement starts today', toAsk.status === 200 && toAsk.body.consent.mode === 'ask'
       && toAsk.body.consent.canTurnOn === true && toAsk.body.consent.since === today, JSON.stringify(toAsk.body.consent));
    ok('...and the privacy notice then names the business', (await J('/api/bkk/consent?lang=en')).body.text.privacy.sections[0][1]
       === 'Example Yoga Co., Ltd. runs AYBKK (Ashtanga Yoga Center of Bangkok), 1 Example Road, Bangkok 10110. Contact us at privacy@example.com or on LINE @aybkk.');
    ok('a privacy fact cannot be emptied while it is on', (await SET({ privacyEmail: '' })).status === 400);
    const pol = await fetch(`${B}/policy`, { redirect: 'manual' }), prv = await fetch(`${B}/privacy`, { redirect: 'manual' });
    ok('/policy and /privacy open those sections of the booking page', pol.status === 302 && pol.headers.get('location') === '/book#policy'
       && prv.status === 302 && prv.headers.get('location') === '/book#privacy');

    // Checkout asks, before anything is made.
    const n0 = (await one('SELECT count(*)::int AS m, (SELECT count(*)::int FROM bkk_orders) AS o FROM bkk_members'));
    const o1 = await post('/api/bkk/orders', { productCode: 'unlim1', name: 'Ada Agreement', email: 'ada.agree@example.com' });
    const o1s = await post('/api/bkk/orders', { productCode: 'unlim1', name: 'Ada Agreement', email: 'ada.agree@example.com', consent: tick({ version: 'v0' }) });
    const o1n = await post('/api/bkk/orders', { productCode: 'unlim1', name: 'Ada Agreement', email: 'ada.agree@example.com', consent: tick({ agree: false }) });
    const o1x = await post('/api/bkk/orders', { productCode: 'unlim1', name: 'A', email: 'ada.agree@example.com', consent: tick() });
    const n1 = (await one('SELECT count(*)::int AS m, (SELECT count(*)::int FROM bkk_orders) AS o FROM bkk_members'));
    ok('checkout without the tick: 409 consent with the version, and no profile or order is made', o1.status === 409
       && JSON.stringify(o1.body) === JSON.stringify({ error: 'consent', version: 'v1' }) && n1.m === n0.m && n1.o === n0.o, JSON.stringify(o1.body));
    ok('...a stale version is 409 (the page reloads the text), no tick 409, a one-letter name 400, and still nothing made',
       o1s.status === 409 && o1s.body.stale === true && o1n.status === 409 && o1x.status === 400 && n1.m === n0.m, JSON.stringify([o1s.body, o1x.body]));
    const o2 = await post('/api/bkk/orders', { productCode: 'unlim1', name: 'Ada Agreement', email: 'ada.agree@example.com',
      consent: tick({ name: 'Ada Agreement', lang: 'th' }) });
    const adaRows = await rowsOf(o2.body.member && o2.body.member.code);
    const o2row = await one('SELECT consent FROM bkk_orders WHERE id=$1', [o2.body.order && o2.body.order.id]);
    ok('a new email with the tick: the order, and at once a checkout row with the version, language and the pinned text hash',
       o2.status === 200 && !!o2.body.member.code && adaRows.length === 1 && adaRows[0].via === 'checkout' && adaRows[0].kind === 'agreement'
         && adaRows[0].version === 'v1' && adaRows[0].lang === 'th' && adaRows[0].signed_name === 'Ada Agreement' && adaRows[0].given === true
         && adaRows[0].under20 === false && adaRows[0].order_id === o2.body.order.id && adaRows[0].email_at === 'ada.agree@example.com'
         && adaRows[0].text_sha === PINNED.th[0] && o2row.consent && Object.keys(o2row.consent).sort().join() === 'agree,lang,name,under20,version'
         && o2row.consent.agree === true && o2row.consent.version === 'v1' && o2row.consent.lang === 'th' && o2row.consent.name === 'Ada Agreement'
         && o2row.consent.under20 === false, JSON.stringify([o2.body, adaRows, o2row])); 
    ok('...and the row holds no address, browser or health field', !Object.keys(adaRows[0]).some(k => /ip|agent|browser|health|note/.test(k)),
       Object.keys(adaRows[0]).join());
    const ADA = o2.body.member.code;
    const o3 = await post('/api/bkk/orders', { productCode: 'pack8', name: 'Ada Agreement', email: 'ada.agree@example.com', memberCode: ADA });
    ok('a browser holding that signed profile buys again with no tick, and nothing more is written', o3.status === 200
       && o3.body.member.code === ADA && (await rowsOf(ADA)).length === 1, JSON.stringify(o3.body));
    const o3b = await post('/api/bkk/orders', { productCode: 'pack8', name: 'Ada Agreement', email: 'someone.else@example.com', memberCode: ADA });
    ok('...but the same browser typing another email must tick', o3b.status === 409 && o3b.body.error === 'consent');
    // A failure writing the checkout row takes the new profile and the order with it.
    await pool.query(`ALTER TABLE bkk_consents ADD CONSTRAINT t_no_checkout CHECK (via <> 'checkout') NOT VALID`);
    let oFail;
    try {
      oFail = await post('/api/bkk/orders', { productCode: 'unlim1', name: 'Ola Orphan', email: 'ola.orphan@example.com', consent: tick({ name: 'Ola Orphan' }) });
    } finally { await pool.query(`ALTER TABLE bkk_consents DROP CONSTRAINT t_no_checkout`); }
    ok('a failure writing the checkout row leaves no profile and no order behind', oFail.status === 500
       && (await one(`SELECT count(*)::int AS n FROM bkk_members WHERE email='ola.orphan@example.com'`)).n === 0, JSON.stringify(oFail.body));
    const copiesTo = to => require('../mailer.js').outbox.filter(m => m.to === to && m.tag === 'agreement');
    ok('a checkout tick on an unpaid order emails nobody yet', copiesTo('ada.agree@example.com').length === 0);

    // Someone else's email: the tick waits for the payment. Fake PaySolutions answers paid.
    const stubApp = express(); stubApp.use(express.json());
    let stubAns = null;
    stubApp.post('/order/orderdetailpost', (req, res) => stubAns ? res.json([stubAns]) : res.send(''));
    const stubSrv = stubApp.listen(0, '127.0.0.1');
    await new Promise(r => stubSrv.once('listening', r));
    const gwEnv = { PAYSO_MERCHANT_ID: '000000012345', PAYSO_SECRET_KEY: 'test-only', PAYSO_API_KEY: 'test-only',
      PAYSO_INQUIRY_BASE: `http://127.0.0.1:${stubSrv.address().port}` };
    Object.assign(process.env, gwEnv);
    try {
      const BEA = await grant('Bea Owner', 'bea.owner@example.com', 'unlim1');
      const b1 = await post('/api/bkk/orders', { productCode: 'pack8', name: 'Bob Buyer', email: 'bea.owner@example.com',
        consent: tick({ name: 'Bob Buyer' }) });
      ok("an existing profile's email typed by someone else: the order is made, the profile is not marked yet", b1.status === 200
         && b1.body.member.existing === true && (await rowsOf(BEA)).length === 0 && !!b1.body.pay, JSON.stringify(b1.body));
      stubAns = { Status: 'CP', Total: b1.body.order.amount };
      const paid = (await J('/api/bkk/pay/check/' + b1.body.order.refno)).body;
      const beaRows = await rowsOf(BEA);
      ok("...once paid, a 'checkout-email' row with the buyer's name, on that order", paid.status === 'paid' && beaRows.length === 1
         && beaRows[0].via === 'checkout-email' && beaRows[0].signed_name === 'Bob Buyer' && beaRows[0].order_id === b1.body.order.id
         && beaRows[0].email_at === 'bea.owner@example.com', JSON.stringify([paid, beaRows]));
      const beaH = (await J(`/api/bkk/admin/members/${BEA}/history`, { headers: ADMIN })).body.consent;
      ok('...and Admin shows it signed by another name, at an online checkout', beaH && beaH.signed === true && beaH.via === 'checkout-email'
         && beaH.nameDiffers === true && beaH.signedName === 'Bob Buyer', JSON.stringify(beaH));
      let rec = null;
      for (let i = 0; i < 40 && !rec; i++) {
        rec = require('../mailer.js').outbox.filter(m => m.to === 'bea.owner@example.com' && m.tag === 'receipt').pop();
        if (!rec) await new Promise(r => setTimeout(r, 50));
      }
      ok('the receipt links the agreement and asks the owner to read it', rec && /You agreed to the AYBKK student agreement \(v1\): \S+\/book\?agreement=v1#agreement/.test(rec.text)
         && rec.text.includes('If someone else bought this for you, please read it before class.'), rec && rec.text);
      // "We email you a copy": once paid, the copy goes to the email at signing, in the language signed.
      const waitCopy = async to => { for (let i = 0; i < 40 && !copiesTo(to).length; i++) await new Promise(r => setTimeout(r, 50)); return copiesTo(to); };
      const beaCopy = await waitCopy('bea.owner@example.com');
      ok("...and a copy of the agreement: to the owner, saying someone bought with this email, signed as the buyer, in its groups",
         beaCopy.length === 1 && beaCopy[0].text.startsWith('Hello Bea Owner,') && beaCopy[0].text.includes('Someone bought an AYBKK pass with this email')
           && beaCopy[0].text.includes('Signed as: Bob Buyer · ') && !beaCopy[0].text.includes('We email you a copy')
           && beaCopy[0].text.includes('\nIn the shala\n7. Book every class'), beaCopy[0] && beaCopy[0].text.slice(0, 400));
      const adaO = await one('SELECT refno, amount_thb FROM bkk_orders WHERE id=$1', [o2.body.order.id]);
      stubAns = { Status: 'CP', Total: adaO.amount_thb };
      const adaPaid = (await J('/api/bkk/pay/check/' + adaO.refno)).body;
      const adaCopy = await waitCopy('ada.agree@example.com');
      ok("a new student's checkout tick: the copy comes with the payment, in Thai, to the email typed", adaPaid.status === 'paid'
         && adaCopy.length === 1 && adaCopy[0].subject === 'สำเนาข้อตกลงนักเรียน AYBKK (v1)' && adaCopy[0].text.startsWith('สวัสดี Ada Agreement')
         && adaCopy[0].text.includes(CONSENT_TEXT.v1.th.agreement.groups[0][1][0]), JSON.stringify([adaPaid, adaCopy.length]));

      // A drop-in for a class: the seat and the consent row come with the one payment.
      const cls = (await J('/api/bkk/schedule?days=10', { headers: ADMIN })).body.classes
        .find(c => !c.isOnline && !c.started && c.seatsLeft > 3 && c.date > today);
      const CAM = await grant('Cam Dropin', 'cam.dropin@example.com', 'unlim1');
      const d1 = await post('/api/bkk/orders', { productCode: 'dropin', name: 'Cam Dropin', email: 'cam.dropin@example.com',
        slotId: cls.slotId, date: cls.date, consent: tick({ name: 'Cam Dropin' }) });
      await SET({ consentMode: 'require' });
      stubAns = { Status: 'CP', Total: d1.body.order.amount };
      await post('/api/bkk/pay/postback', { refno: String(d1.body.order.refno) });
      let dRow = {};
      for (let i = 0; i < 40 && !dRow.status; i++) {
        await new Promise(r => setTimeout(r, 50));
        dRow = await one(`SELECT o.status, o.verified_at, c.created_at AS c_at, c.via, b.booked_at, b.source FROM bkk_orders o
          LEFT JOIN bkk_consents c ON c.order_id=o.id LEFT JOIN bkk_bookings b ON b.member_id=o.member_id AND b.slot_id=o.slot_id
            AND b.class_date=o.class_date AND b.status='booked'
          WHERE o.id=$1 AND o.status='paid'`, [d1.body.order.id]);
      }
      ok("the postback in require mode: a paid drop-in's seat and its consent row are written in one transaction",
         dRow.status === 'paid' && dRow.via === 'checkout-email' && dRow.source === 'order' && !!dRow.booked_at
           && +new Date(dRow.booked_at) === +new Date(dRow.c_at) && +new Date(dRow.c_at) === +new Date(dRow.verified_at), JSON.stringify(dRow));
      // An order made while off (no tick) and paid in require: never refused.
      await SET({ consentMode: 'off' });
      const DEE = await grant('Dee Offorder', 'dee.offorder@example.com', 'unlim1');
      const e1 = await post('/api/bkk/orders', { productCode: 'pack8', name: 'Dee Offorder', email: 'dee.offorder@example.com' });
      const e3 = await post('/api/bkk/orders', { productCode: 'dropin', name: 'Dee Offorder', email: 'dee.offorder@example.com',
        slotId: cls.slotId, date: cls.date });
      await SET({ consentMode: 'require' });
      stubAns = { Status: 'CP', Total: e1.body.order.amount };
      const e1p = (await J('/api/bkk/pay/check/' + e1.body.order.refno)).body;
      ok('an order made while off is paid in require: activated, a pass, and nobody marked', e1.status === 200 && e1p.status === 'paid'
         && (await one(`SELECT count(*)::int AS n FROM bkk_passes WHERE order_id=$1`, [e1.body.order.id])).n === 1 && (await rowsOf(DEE)).length === 0);
      const e2 = await post('/api/bkk/orders', { productCode: 'pack8', name: 'Dee Offorder', email: 'dee.offorder@example.com' });
      const fa = await post(`/api/bkk/admin/orders/${e3.body.order.id}/force-activate`, { confirm: true }, ADMIN);
      ok('...staff Activate on an unsigned drop-in books the seat in require, while a new checkout still asks (409)', e2.status === 409
         && fa.status === 200 && fa.body.success === true && !!fa.body.booking, JSON.stringify([e2.body, fa.body]));

      // An order typed with a profile's email, pending when that profile is merged in and paid after:
      // the undo takes its tick back with the order, so the kept profile is not left signed.
      const KIT = await grant('Kit Kept', 'kit.kept@example.com', 'unlim1'), FEN = await grant('Fen Folded', 'fen.folded@example.com', 'unlim1');
      const g1 = await post('/api/bkk/orders', { productCode: 'pack8', name: 'Gus Giver', email: 'fen.folded@example.com', consent: tick({ name: 'Gus Giver' }) });
      const mgF = await post(`/api/bkk/admin/members/${KIT}/merge`, { from: FEN, sure: true }, ADMIN);
      stubAns = { Status: 'CP', Total: g1.body.order.amount };
      const g1p = (await J('/api/bkk/pay/check/' + g1.body.order.refno)).body;
      const whoHas = async () => one(`SELECT (SELECT code FROM bkk_members WHERE id=o.member_id) AS o,
        (SELECT m.code FROM bkk_passes p JOIN bkk_members m ON m.id=p.member_id WHERE p.order_id=o.id) AS p,
        (SELECT m.code FROM bkk_consents c JOIN bkk_members m ON m.id=c.member_id WHERE c.order_id=o.id) AS c FROM bkk_orders o WHERE o.id=$1`, [g1.body.order.id]);
      const during = await whoHas();
      const umF = await post(`/api/bkk/admin/members/${FEN}/unmerge`, {}, ADMIN);
      const after = await whoHas();
      const kitBook = await post('/api/bkk/bookings', { memberCode: KIT, slotId: cls.slotId, date: cls.date });
      ok("a tick paid after a merge goes back with its order on the undo, and the kept profile is unsigned again",
         g1.status === 200 && mgF.status === 200 && g1p.status === 'paid' && during.o === KIT && during.c === KIT && umF.status === 200
           && after.o === FEN && after.p === FEN && after.c === FEN && kitBook.status === 409 && kitBook.body.error === 'consent',
         JSON.stringify([during, after, umF.body.since || umF.body, kitBook.body]));
    } finally {
      for (const k of Object.keys(gwEnv)) delete process.env[k];
      stubSrv.close();
    }

    // Booking in require.
    const sched = (await J('/api/bkk/schedule?days=12', { headers: ADMIN })).body.classes
      .filter(c => !c.isOnline && !c.started && c.seatsLeft > 5 && c.date > today);
    const X = sched[0], Y = sched.find(c => c.date !== X.date) || sched[1];
    const EVE = await grant('Eve Unsigned', 'eve.unsigned@example.com', 'pack8');
    const p0 = await passOf(EVE);
    const bk = await post('/api/bkk/bookings', { memberCode: EVE, slotId: X.slotId, date: X.date });
    const p1 = await passOf(EVE);
    const seatsEve = async () => (await one(`SELECT count(*)::int AS n FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id
      WHERE m.code=$1 AND b.status='booked'`, [EVE])).n;
    ok('require: an unsigned student booking gets 409 consent, and no seat, no pass clock started, no class used',
       bk.status === 409 && JSON.stringify(bk.body) === JSON.stringify({ error: 'consent', version: 'v1' }) && await seatsEve() === 0
         && p0.valid_from === null && p1.valid_from === null && p1.valid_until === null && p1.credits_used === 0 && p0.credits_used === 0, JSON.stringify([bk.body, p1]));
    const fullD = X.date;
    await pool.query(`INSERT INTO bkk_class_overrides (slot_id,class_date,capacity) VALUES ($1,$2,0)
      ON CONFLICT (slot_id,class_date) DO UPDATE SET capacity=0`, [X.slotId, fullD]);
    const bFull = await post('/api/bkk/bookings', { memberCode: EVE, slotId: X.slotId, date: fullD });
    await pool.query(`DELETE FROM bkk_class_overrides WHERE slot_id=$1 AND class_date=$2 AND capacity=0`, [X.slotId, fullD]);
    let moon = today;
    for (let i = 0; i < 40 && !moonDaysBetween(moon, moon).size; i++) moon = new Date(Date.parse(moon + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
    const moonSlot = (await one(`SELECT id FROM bkk_class_slots WHERE active AND NOT is_online AND weekday=$1 LIMIT 1`,
      [new Date(moon + 'T12:00:00Z').getUTCDay()])).id;
    const bMoon = await post('/api/bkk/bookings', { memberCode: EVE, slotId: moonSlot, date: moon });
    ok('...a full class and a moon day get their own answer, not the agreement', bFull.status === 409 && bFull.body.error === 'class is full'
       && bMoon.status === 409 && /moon day/.test(bMoon.body.error), JSON.stringify([bFull.body, bMoon.body]));
    const bStaff = await post('/api/bkk/bookings', { memberCode: EVE, slotId: Y.slotId, date: Y.date }, ADMIN);
    ok('a staff booking for the unsigned student goes through (x-bkk-key)', bStaff.status === 200 && bStaff.body.success === true, JSON.stringify(bStaff.body));
    const mc = p => post(`/api/bkk/me/${EVE}/consent`, p);
    const r404 = await post('/api/bkk/me/BNOBODY000000/consent', tick({ name: 'Nobody Here' }));
    const rStale = await mc(tick({ name: 'Eve Unsigned', version: 'v0' })), rNoTick = await mc(tick({ name: 'Eve Unsigned', agree: false }));
    const rShort = await mc(tick({ name: ' E ' })), rLang = await mc(tick({ name: 'Eve Unsigned', lang: 'fr' })), rKind = await mc(tick({ kind: 'photos_public', name: 'Eve Unsigned' }));
    ok('/me/:code/consent: unknown code 404, stale version 409, no tick 400, a one-letter name 400, an unknown language 400, another kind 400, and nothing saved',
       r404.status === 404 && rStale.status === 409 && rStale.body.error === 'consent' && rStale.body.version === 'v1' && rNoTick.status === 400
         && rShort.status === 400 && rLang.status === 400 && rKind.status === 400 && (await rowsOf(EVE)).length === 0,
       JSON.stringify([rStale.body, rNoTick.body, rShort.body]));
    const out0 = require('../mailer.js').outbox.length;
    const rOk = await mc(tick({ name: 'Eve Unsigned', lang: 'ru' })), rAgain = await mc(tick({ name: 'Eve Unsigned', lang: 'ru' }));
    const eveRows = await rowsOf(EVE);
    const copy = require('../mailer.js').outbox.slice(out0).filter(m => m.to === 'eve.unsigned@example.com' && m.tag === 'agreement');
    ok("signing on the student's own phone: 'self', once, however often it is sent, and one copy by email in the language signed",
       rOk.status === 200 && rOk.body.consent.signed === true && rOk.body.already === false && rAgain.status === 200 && rAgain.body.already === true
         && eveRows.length === 1 && eveRows[0].via === 'self' && eveRows[0].lang === 'ru' && eveRows[0].text_sha === PINNED.ru[0]
         && copy.length === 1 && /соглашение ученика AYBKK \(v1\)/.test(copy[0].subject)
         && copy[0].text.includes(CONSENT_TEXT.v1.ru.agreement.groups[0][1][0]) && copy[0].text.includes('Eve Unsigned'), JSON.stringify([rOk.body, eveRows.length, copy.length]));
    const bk2 = await post('/api/bkk/bookings', { memberCode: EVE, slotId: X.slotId, date: X.date });
    ok('...then the same booking goes through', bk2.status === 200 && bk2.body.success === true, JSON.stringify(bk2.body));
    const meEve = (await J('/api/bkk/me/' + EVE)).body;
    ok('/me says where the student stands, and nothing more', JSON.stringify(Object.keys(meEve.consent).sort()) === JSON.stringify(['guardianSigned', 'mode', 'signed', 'signedAt', 'under20', 'version'])
       && meEve.consent.mode === 'require' && meEve.consent.signed === true && meEve.consent.under20 === false && !!meEve.consent.signedAt, JSON.stringify(meEve.consent));

    // ask: checkout asks, booking does not.
    await SET({ consentMode: 'ask' });
    const FAY = await grant('Fay Askmode', 'fay.askmode@example.com', 'unlim1');
    const fb = await post('/api/bkk/bookings', { memberCode: FAY, slotId: Y.slotId, date: Y.date });
    ok('ask: an unsigned student still books, and /me says not signed', fb.status === 200
       && (await J('/api/bkk/me/' + FAY)).body.consent.signed === false, JSON.stringify(fb.body));

    // Under 20: a guardian's paper, recorded at the desk.
    const GIA = await grant('Gia Young', 'gia.young@example.com', 'unlim1');
    await post(`/api/bkk/me/${GIA}/consent`, tick({ name: 'Gia Young', under20: true, lang: 'th' }));
    const gH0 = (await J(`/api/bkk/admin/members/${GIA}/history`, { headers: ADMIN })).body.consent;
    const gS0 = ((await J('/api/bkk/admin/members?q=gia.young', { headers: ADMIN })).body.members || [])[0];
    const gNo = await post(`/api/bkk/admin/members/${GIA}/guardian`, { name: 'Pat Young', date: today });
    const gBad = await post(`/api/bkk/admin/members/${GIA}/guardian`, { name: 'Pat Young', date: '2099-01-01' }, ADMIN);
    const gShort = await post(`/api/bkk/admin/members/${GIA}/guardian`, { name: 'P', date: today }, ADMIN);
    const gOk = await post(`/api/bkk/admin/members/${GIA}/guardian`, { name: 'Pat Young', date: today }, ADMIN);
    const gRows = await rowsOf(GIA);
    ok('under 20: signed, guardian not yet, on the profile and the search card', gH0.signed === true && gH0.under20 === true && gH0.guardianSigned === false
       && gS0 && gS0.consent.signed === true && gS0.consent.guardianDue === true, JSON.stringify([gH0, gS0 && gS0.consent]));
    ok("Record guardian needs the staff key, a name and a real day not in the future; then a 'desk' row with the paper's day",
       gNo.status === 401 && gBad.status === 400 && gShort.status === 400 && gOk.status === 200 && gOk.body.consent.guardianSigned === true
         && gOk.body.consent.guardianName === 'Pat Young' && gOk.body.consent.guardianOn === today
         && gRows.length === 2 && gRows[1].kind === 'guardian' && gRows[1].via === 'desk' && gRows[1].guardian_name === 'Pat Young'
         && ((await J('/api/bkk/admin/members?q=gia.young', { headers: ADMIN })).body.members[0].consent.guardianDue === false), JSON.stringify(gOk.body));

    // The "Not signed" list: a live pass and no signature of this version.
    const nsl = await J('/api/bkk/admin/members?consent=missing', { headers: ADMIN });
    const codes = (nsl.body.members || []).map(m => m.code);
    ok('Not signed: people with a live pass who have not signed, with no search term; never the signed ones', nsl.status === 200
       && codes.length > 0 && !codes.includes(EVE) && !codes.includes(GIA) && !codes.includes(ADA)
       && (nsl.body.members || []).every(m => m.consent && m.consent.signed === false), JSON.stringify(codes.length));
    ok('...it needs the staff key', (await J('/api/bkk/admin/members?consent=missing')).status === 401);
    ok('...and a search term narrows it', ((await J('/api/bkk/admin/members?consent=missing&q=fay.askmode', { headers: ADMIN })).body.members || [])
      .map(m => m.code).join() === FAY);

    // Never refused in require: a desk sale, a /teach add (in the door block), a Rezerv import with a seat to come.
    await SET({ consentMode: 'require' });
    const sale = await post('/api/bkk/admin/sales', { productCode: 'pack8', name: 'Hal Desksale', email: 'hal.desksale@example.com', method: 'cash' }, ADMIN);
    ok('a desk sale for someone unsigned is never refused', sale.status === 200 && !!sale.body.order, JSON.stringify(sale.body).slice(0, 200));
    const rzm = await post('/api/bkk/admin/import/members', { rows: [{ rezervId: 'AG-RZ-1', name: 'Ira Rezervimport', email: 'ira.rz@example.com' }], dryRun: false }, ADMIN);
    const rzv = await post('/api/bkk/admin/import/visits', { rows: [{ rezervId: 'AG-V-1', memberRezervId: 'AG-RZ-1', date: X.date,
      time: X.startAt.slice(11, 16), className: X.title, status: 'Booked' }], dryRun: false }, ADMIN);
    const iraSeat = await one(`SELECT b.status, b.source FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id
      WHERE m.rezerv_id='AG-RZ-1' AND b.class_date=$1`, [X.date]);
    ok('a Rezerv import with a booked class to come is never refused', rzm.status === 200 && rzv.status === 200 && rzv.body.added === 1
       && iraSeat.status === 'booked' && iraSeat.source === 'rezerv', JSON.stringify([rzm.body, rzv.body, iraSeat]));

    // A merge of two signed profiles, and its undo.
    const KIM = await grant('Kim Twice', 'kim.one@example.com', 'unlim1'), KIM2 = await grant('Kim Twice', 'kim.two@example.com', 'unlim1');
    await post(`/api/bkk/me/${KIM}/consent`, tick({ name: 'Kim Twice' }));
    await post(`/api/bkk/me/${KIM2}/consent`, tick({ name: 'Kim Twice', lang: 'zh' }));
    const kimId = (await one('SELECT id FROM bkk_members WHERE code=$1', [KIM])).id, kim2Id = (await one('SELECT id FROM bkk_members WHERE code=$1', [KIM2])).id;
    const mg = await post(`/api/bkk/admin/members/${KIM}/merge`, { from: KIM2, sure: true }, ADMIN);
    const onKeep = (await pool.query('SELECT member_id FROM bkk_consents WHERE member_id = ANY($1::int[])', [[kimId, kim2Id]])).rows;
    ok('a merge of two signed profiles works, both signatures move to the kept one', mg.status === 200 && mg.body.moved.consents === 1
       && onKeep.length === 2 && onKeep.every(r => r.member_id === kimId), JSON.stringify(mg.body.moved));
    const um = await post(`/api/bkk/admin/members/${KIM2}/unmerge`, {}, ADMIN);
    const back = (await pool.query('SELECT member_id, lang FROM bkk_consents WHERE member_id = ANY($1::int[]) ORDER BY id', [[kimId, kim2Id]])).rows;
    ok('...and its undo puts each back where it was signed', um.status === 200 && back.length === 2 && back[0].member_id === kimId
       && back[1].member_id === kim2Id && back[1].lang === 'zh', JSON.stringify(back));

    // Counts only: the agreement screen shown and agreed.
    const ev = await post('/api/bkk/start-event', { page: 'book', kind: 'consent-shown', src: 'buy', lang: 'en' });
    const ev2 = await post('/api/bkk/start-event', { page: 'book', kind: 'consent-agreed', src: 'buy', lang: 'en' });
    const evBad = await post('/api/bkk/start-event', { page: 'book', kind: 'view' });
    const lw = (await J('/api/bkk/admin/landing-weeks', { headers: ADMIN })).body;
    const bookW = (lw.pages || []).find(p => p.page === 'book');
    ok('the agreement screen is counted, shown and agreed, in the weekly box for staff', ev.status === 200 && ev2.status === 200 && evBad.status === 400
       && bookW && bookW.cols.join() === 'consent-shown,consent-agreed' && bookW.weeks[0].n['consent-shown'] >= 1 && bookW.weeks[0].n['consent-agreed'] >= 1,
       JSON.stringify(bookW && bookW.weeks[0]));

    // Off again: the routes are as before.
    await SET({ consentMode: 'off' });
    const offMe2 = (await J('/api/bkk/me/' + EVE)).body;
    const offH = (await J(`/api/bkk/admin/members/${EVE}/history`, { headers: ADMIN })).body;
    const offS = ((await J('/api/bkk/admin/members?q=eve.unsigned', { headers: ADMIN })).body.members || [])[0];
    const offB = await post('/api/bkk/bookings', { memberCode: FAY, slotId: X.slotId, date: X.date });
    ok('off again: no consent field on /me, the profile or the search card, ?consent=missing lists nobody, and booking is open',
       !('consent' in offMe2) && !('consent' in offH) && offS && !('consent' in offS) && offB.status === 200
         && ((await J('/api/bkk/admin/members?consent=missing', { headers: ADMIN })).body.members || []).length === 0, JSON.stringify(offB.body));
  }

  console.log(`\n${PASS} passed, ${FAIL} failed`);
  srv.close(); await pool.end();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
