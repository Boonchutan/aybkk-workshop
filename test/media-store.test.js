// The old workshop system's student photos off Cloudinary (lib/media-store.js), against a
// real Postgres, a fake R2 and a fake Cloudinary on this machine, and a fake Neo4j. Proves:
//   1. R2 off: POST /api/upload/student-photo asks Cloudinary exactly as before, and
//      nothing is rewritten or served under /sp
//   2. R2 on: every upload is a new random file (a 400 px square, a little above the
//      middle for a portrait), so nobody can replace a photo that is there
//   3. /sp serves those files, with byte ranges
//   4. the staff copy takes every aybkk-students photo once, checked by a HEAD of the copy,
//      and every answer then says /sp instead of the old Cloudinary link (Neo4j unchanged)
//   5. the share card reads the copy from R2, and gives up on a host that hangs (10 s)
// Made-up people and photos only.
const http = require('http');
const express = require('express');
const { Pool } = require('pg');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { fakeR2, r2On, r2Off, md5 } = require('./fake-r2');

process.env.BKK_ADMIN_KEY = 'test-admin';
const { staffOnly } = require('../lib/staff-key');
const media = require('../lib/media-store');
const { renderShareCard } = require('../share-card-renderer');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL || 'postgres://test:test@127.0.0.1:5432/bkktest' });
let PASS = 0, FAIL = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name} ${extra}`); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const A = { 'x-bkk-key': 'test-admin' };

// A portrait in three bands: green on top (rows 0-89), blue in the middle, red at the bottom
// (rows 690-899). The middle of a 600 x 900 photo is rows 150-749; a crop a little above it
// (rows 90-689) is all blue.
async function bands() {
  const c = createCanvas(600, 900), x = c.getContext('2d');
  x.fillStyle = '#00c000'; x.fillRect(0, 0, 600, 90);
  x.fillStyle = '#0000ff'; x.fillRect(0, 90, 600, 600);
  x.fillStyle = '#ff0000'; x.fillRect(0, 690, 600, 210);
  return c.encode('jpeg', 92);
}
const jpeg = async (w, h, color = '#808080') => { const c = createCanvas(w, h), x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h); return c.encode('jpeg', 90); };
const dataUrl = b => 'data:image/jpeg;base64,' + b.toString('base64');
const pixel = async (buf, px, py) => {
  const img = await loadImage(buf), c = createCanvas(img.width, img.height), x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  return { w: img.width, h: img.height, rgb: Array.from(x.getImageData(px, py, 1, 1).data.slice(0, 3)) };
};
const near = (rgb, want) => rgb.every((v, i) => Math.abs(v - want[i]) < 60);

// a fake Neo4j driver: every query kept
const runs = [];
const driver = { session: () => ({ run: async (q, p) => { runs.push({ q, p }); return { records: [] }; }, close: async () => {} }) };
// a fake Cloudinary: uploads asked for, the aybkk-students listing in pages, and the originals it delivers
const cl = { uploads: [], pages: [], listed: 0, originals: new Map() };
const fakeCloud = {
  uploader: { upload: async (src, o) => {
    cl.uploads.push(o);
    return { secure_url: `https://res.cloudinary.com/dw1uubecu/image/upload/v1700000000/aybkk-students/${o.public_id}.jpg` };
  } },
  api: { resources: async o => {
    cl.listed++;
    const i = o.next_cursor ? Number(o.next_cursor) : 0;
    return { resources: cl.pages[i] || [], ...(i + 1 < cl.pages.length ? { next_cursor: String(i + 1) } : {}) };
  } },
};
const fakeFetch = async url => cl.originals.has(url) ? new Response(cl.originals.get(url), { status: 200 }) : new Response('gone', { status: 404 });

// The routes as server.js has them: the rewrite first, then old routes that send Neo4j's links.
const OLD = id => `https://res.cloudinary.com/dw1uubecu/image/upload/v1700000000/aybkk-students/${id}.jpg`;
function makeApp(ws) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(ws.rewrite);
  ws.mount(app, { cloudinary: fakeCloud, driver, staffOnly, pool: () => pool });
  app.get('/t/json', (req, res) => res.json({
    photoUrl: OLD('student_test-a'),
    photoUrls: [OLD('student_test-b_test-entry_slot1').replace('/upload/', '/upload/w_200,h_200,c_fill/'), OLD('student_test-unknown')],
    q: OLD('student_test-a') + '?x=1',
  }));
  app.get('/t/csv', (req, res) => { res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.send(`id,photoUrl\ntest-a,${OLD('student_test-a')}\n`); });
  app.get('/t/html', (req, res) => res.send(`<img src="${OLD('student_test-a')}">`));
  return app;
}
const listen = app => new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const J = base => async (p, opts = {}, headers = {}) => {
  const r = await fetch(base + p, { ...opts, headers: { 'Content-Type': 'application/json', ...headers } });
  const text = await r.text();
  let body = {}; try { body = JSON.parse(text); } catch (_) {}
  return { status: r.status, headers: r.headers, text, body };
};

(async () => {
  await pool.query('DROP TABLE IF EXISTS ws_photo_map');
  const fr2 = await fakeR2();

  console.log('\n[R2 off: Cloudinary exactly as before]');
  r2Off();
  const off = media.wsPhotos({ fetch: fakeFetch });
  const appOff = makeApp(off);
  await off.start();
  const sOff = await listen(appOff), JO = J(`http://127.0.0.1:${sOff.address().port}`);
  const face = dataUrl(await bands());
  const u0 = await JO('/api/upload/student-photo', { method: 'POST', body: JSON.stringify({ studentId: 'test-a', imageBase64: face }) });
  ok('a face goes to Cloudinary with the same public_id, overwrite and 400 px face crop as before',
     u0.status === 200 && JSON.stringify(cl.uploads[0]) === JSON.stringify({ folder: 'aybkk-students', public_id: 'student_test-a', overwrite: true,
       backup: false, transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face', quality: 'auto' }] })
       && JSON.stringify(u0.body) === JSON.stringify({ success: true, photoUrl: OLD('student_test-a') }), u0.text);
  const u0b = await JO('/api/upload/student-photo', { method: 'POST', body: JSON.stringify({ studentId: 'test-a', imageBase64: face, assessmentId: 'test-entry', slotIndex: 2 }) });
  ok('...a journal slot too (student_<id>_<entry>_slot<n>), and Neo4j gets the link on the student and the entry',
     u0b.status === 200 && cl.uploads[1].public_id === 'student_test-a_test-entry_slot2'
       && runs.length === 3 && runs[0].p.url === OLD('student_test-a') && runs[2].p.aid === 'test-entry' && /photoUrls/.test(runs[2].q));
  ok('...a missing photo is the same 400', (await JO('/api/upload/student-photo', { method: 'POST', body: JSON.stringify({ studentId: 'x' }) })).status === 400);
  ok('no table is made for the copies', (await pool.query(`SELECT to_regclass('ws_photo_map') AS t`)).rows[0].t === null);
  const j0 = await JO('/t/json');
  ok('the old Cloudinary links go out untouched', j0.body.photoUrl === OLD('student_test-a'));
  const sp0 = await JO('/sp/' + 'a'.repeat(32) + '.jpg');
  ok('/sp is no route of this module (404 from express)', sp0.status === 404 && !/json/.test(sp0.headers.get('content-type') || ''));
  ok('the copy says R2 is not set up, and needs the staff key',
     (await JO('/api/ws-photos/copy', { method: 'POST', body: '{}' }, A)).status === 409 && (await JO('/api/ws-photos/copy', { method: 'POST', body: '{}' })).status === 401);
  ok('the share card gets the stored link as it was', (await off.cardImage(OLD('student_test-a'))) === OLD('student_test-a'));
  sOff.close();

  console.log('\n[R2 on: a new random file for every upload]');
  r2On();
  const on = media.wsPhotos({ r2Endpoint: fr2.url, fetch: fakeFetch });
  r2Off();
  const appOn = makeApp(on);
  await on.start();
  const sOn = await listen(appOn), BON = `http://127.0.0.1:${sOn.address().port}`, JN = J(BON);
  const nUp = cl.uploads.length, nRuns = runs.length;
  const u1 = await JN('/api/upload/student-photo', { method: 'POST', body: JSON.stringify({ studentId: 'test-a', imageBase64: face }) });
  const f1 = u1.body.photoUrl || '';
  ok('R2 on: the photo goes to R2 under a random name, a path on this site; Cloudinary is not asked',
     u1.status === 200 && /^\/sp\/[0-9a-f]{32}\.jpg$/.test(f1) && cl.uploads.length === nUp, u1.text);
  const obj1 = fr2.store.get('ws/' + f1.slice(4));
  const top = obj1 && await pixel(obj1.body, 200, 3), bottom = obj1 && await pixel(obj1.body, 200, 396);
  ok('...a 400 px square, cut a little above the middle of a portrait (no green top, no red bottom)',
     !!obj1 && top.w === 400 && top.h === 400 && near(top.rgb, [0, 0, 255]) && near(bottom.rgb, [0, 0, 255]), JSON.stringify([top, bottom]));
  ok('...Neo4j gets the new link as before', runs.length === nRuns + 1 && runs[nRuns].p.url === f1 && runs[nRuns].p.sid === 'test-a');
  const u2 = await JN('/api/upload/student-photo', { method: 'POST', body: JSON.stringify({ studentId: 'test-a', imageBase64: dataUrl(await jpeg(300, 300, '#ffff00')) }) });
  ok('the same student id again is another file: the first one is still there, unchanged',
     u2.status === 200 && u2.body.photoUrl !== f1 && fr2.store.has('ws/' + f1.slice(4)) && md5(fr2.store.get('ws/' + f1.slice(4)).body) === md5(obj1.body));
  const bad = await JN('/api/upload/student-photo', { method: 'POST', body: JSON.stringify({ studentId: 'test-a', imageBase64: 'data:image/png;base64,AAAA' }) });
  ok('...a file that is not a photo → 400, nothing stored', bad.status === 400 && fr2.store.size === 2);
  const g = await fetch(BON + f1), gb = Buffer.from(await g.arrayBuffer());
  ok('/sp serves it: JPEG, public for a day like the old links', g.status === 200 && g.headers.get('content-type') === 'image/jpeg'
     && g.headers.get('cache-control') === 'public, max-age=86400, s-maxage=86400' && gb.equals(obj1.body));
  const gr = await fetch(BON + f1, { headers: { Range: 'bytes=0-9' } });
  ok('...with byte ranges', gr.status === 206 && gr.headers.get('content-range') === `bytes 0-9/${obj1.body.length}` && (await gr.arrayBuffer()).byteLength === 10);
  ok('...a name that is not one of ours → 404', (await fetch(BON + '/sp/student_test-a.jpg')).status === 404
     && (await fetch(BON + '/sp/' + 'b'.repeat(32) + '.jpg')).status === 404);

  console.log('\n[the copy of the old aybkk-students photos]');
  const ids = ['student_test-a', 'student_test-b_test-entry_slot1', 'student_test-c', 'student_test-d', 'student_test-e'];
  const asset = id => ({ public_id: 'aybkk-students/' + id, format: 'jpg', secure_url: OLD(id) });
  cl.pages = [ids.slice(0, 3).map(asset), ids.slice(3).map(asset)];
  for (const id of ids) if (id !== 'student_test-e') cl.originals.set(OLD(id), await jpeg(400, 400, '#' + md5(id).slice(0, 6)));
  const run = async () => {
    const s = await JN('/api/ws-photos/copy', { method: 'POST', body: '{}' }, A);
    let st = s.body;
    for (let i = 0; i < 400 && st.running; i++) { await sleep(25); st = (await JN('/api/ws-photos/copy', {}, A)).body; }
    return { status: s.status, st };
  };
  ok('the copy needs the staff key', (await JN('/api/ws-photos/copy', { method: 'POST', body: '{}' })).status === 401);
  const r1 = await run();
  ok('it lists every page of aybkk-students and copies what Cloudinary sends (one is gone: failed, listed)',
     r1.status === 202 && r1.st.listed === 5 && r1.st.copied === 4 && r1.st.failed === 1 && r1.st.inR2 === 4, JSON.stringify(r1.st));
  const map = (await pool.query('SELECT public_id, file, bytes, md5 FROM ws_photo_map ORDER BY public_id')).rows;
  ok('...each copy in R2 is the original byte for byte, and noted with its size and MD5',
     map.length === 4 && map.every(m => fr2.store.has('ws/' + m.file) && md5(fr2.store.get('ws/' + m.file).body) === m.md5
       && m.md5 === md5(cl.originals.get(OLD(m.public_id.split('/')[1]))) && m.bytes === fr2.store.get('ws/' + m.file).body.length));
  const fileOf = id => map.find(m => m.public_id === 'aybkk-students/' + id).file;
  const j1 = await JN('/t/json');
  ok('every answer now says /sp for a photo that has a copy (a link with a size in it, or a query, too)',
     j1.body.photoUrl === '/sp/' + fileOf('student_test-a') && j1.body.photoUrls[0] === '/sp/' + fileOf('student_test-b_test-entry_slot1')
       && j1.body.q === '/sp/' + fileOf('student_test-a'), j1.text);
  ok('...and keeps the old link for one with no copy', j1.body.photoUrls[1] === OLD('student_test-unknown'));
  const csv = await JN('/t/csv');
  ok('...a CSV gets a whole link', csv.text.includes(`,https://127.0.0.1:${sOn.address().port}/sp/${fileOf('student_test-a')}\n`), csv.text);
  ok('...and a page too', (await JN('/t/html')).text === `<img src="/sp/${fileOf('student_test-a')}">`);
  ok('Neo4j is never written by the copy', runs.length === nRuns + 2);
  cl.originals.set(OLD('student_test-e'), await jpeg(400, 400, '#123456'));
  fr2.ctl.badEtag = true;
  const r2 = await run();
  fr2.ctl.badEtag = false;
  ok('a copy that R2 does not give back the same is never used, and the run stops there',
     r2.st.copied === 0 && r2.st.failed === 1 && r2.st.already === 4 && /does not match/.test(r2.st.error || '')
       && (await pool.query(`SELECT 1 FROM ws_photo_map WHERE public_id='aybkk-students/student_test-e'`)).rowCount === 0, JSON.stringify(r2.st));
  const r3 = await run();
  ok('pressed again: only the one left is copied', r3.st.copied === 1 && r3.st.already === 4 && r3.st.failed === 0 && r3.st.inR2 === 5, JSON.stringify(r3.st));
  cl.pages = null;
  const r4 = await run();
  ok('Cloudinary cannot list: the run says so and nothing changes', /Cloudinary list/.test(r4.st.error || '') && r4.st.inR2 === 5, JSON.stringify(r4.st));

  console.log('\n[after a restart, and the share card]');
  r2On();
  const again = media.wsPhotos({ r2Endpoint: fr2.url, fetch: fakeFetch });
  r2Off();
  makeApp(again);                 // mounted first, as in server.js: start needs the database
  await again.start();
  ok('a new server reads the copies back from the table', again.rewriteText(`"${OLD('student_test-c')}"`) === `"/sp/${fileOf('student_test-c')}"`);
  const card = await again.cardImage(OLD('student_test-a'));
  ok('the share card gets the copy from R2 (bytes), not the Cloudinary link',
     Buffer.isBuffer(card) && md5(card) === md5(cl.originals.get(OLD('student_test-a'))));
  const own = await again.cardImage(f1);
  ok('...a new /sp photo too', Buffer.isBuffer(own) && own.equals(obj1.body));
  ok('...a photo with no copy keeps its link', (await again.cardImage(OLD('student_test-unknown'))) === OLD('student_test-unknown'));
  fr2.ctl.fail = m => (m === 'GET' ? 500 : null);
  ok('...R2 not answering: the Cloudinary link as before, or no photo for a /sp one',
     (await again.cardImage(OLD('student_test-a'))) === OLD('student_test-a') && (await again.cardImage(f1)) === '');
  fr2.ctl.fail = null;
  const png1 = await renderShareCard({ name: 'Test Student', photoUrl: card });
  ok('the card is drawn with the bytes', Buffer.isBuffer(png1) && png1.length > 1000);
  const hang = http.createServer(() => {});           // answers nothing, ever
  await new Promise(r => hang.listen(0, '127.0.0.1', r));
  const t0 = Date.now();
  const png2 = await renderShareCard({ name: 'Test Student', photoUrl: `http://127.0.0.1:${hang.address().port}/photo.jpg` });
  const took = Date.now() - t0;
  ok('a photo host that hangs: the card comes without the photo after about 10 s, not minutes',
     Buffer.isBuffer(png2) && took >= 9500 && took < 15000, `${took} ms`);
  hang.closeAllConnections(); hang.close();

  console.log('\n[links of course files]');
  const key = 'idcn/idcn3/sub/' + 'c'.repeat(32) + '.mp4';
  const p0 = media.mdPath(key), [, , t0s] = p0.split('/'), [e0, s0] = t0s.split('.');
  ok('a link that never ends opens', e0 === '0' && media.mdCheck(e0, s0, key) === 'ok');
  ok('...not for another file', media.mdCheck(e0, s0, key.replace('ccc', 'ccd')) === 'bad');
  const p1 = media.mdPath(key, { days: 1 }), [e1, s1] = p1.split('/')[2].split('.');
  ok('a link that ends: open now, ended after two days, and its end cannot be moved',
     media.mdCheck(e1, s1, key) === 'ok' && media.mdCheck(e1, s1, key, Date.now() + 3 * 86400e3) === 'expired'
       && media.mdCheck(String(Number(e1) + 86400), s1, key) === 'bad');
  ok('the same link all day long (a browser keeps it)', media.mdPath(key, { days: 1 }) === p1);
  ok('the database value: "r2:<key>" is a link, a Cloudinary link stays as it is',
     media.linkFor('r2:' + key) === p0 && media.linkFor(OLD('x')) === OLD('x') && media.linkFor(null) === null);

  sOn.close();
  await fr2.close();
  await pool.query('DROP TABLE IF EXISTS ws_photo_map');
  console.log(`\n${PASS} passed, ${FAIL} failed`);
  await pool.end();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
