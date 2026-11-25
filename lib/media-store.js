// Course files and the old workshop photos in Cloudflare R2 (25 Nov 2026), next to
// the class photos of lib/r2.js: Cloudinary's free plan was over its limit and was to
// stop on 29 Nov. The same four R2_* variables switch it on; with any one missing
// makeStore() is null and every caller keeps Cloudinary as before.
// Errors name the method and R2's status only: never a key or a signed URL.
const crypto = require('crypto');
const fs = require('fs');
const { Readable, pipeline } = require('stream');
const { AwsClient } = require('aws4fetch');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const r2lib = require('./r2');

// endpoint: a test's fake R2 on this machine.
function makeStore({ endpoint } = {}) {
  if (!r2lib.r2Configured()) return null;
  const env = process.env;
  const base = `${(endpoint || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(/\/$/, '')}/${encodeURIComponent(env.R2_BUCKET)}`;
  const aws = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3', region: 'auto', retries: 0 });
  const fail = msg => Object.assign(new Error(msg), { status: 502, r2: true });
  async function call(method, key, { body, type, ms = 20000, range } = {}) {
    const headers = body ? { 'Content-Type': type, 'X-Amz-Content-Sha256': crypto.createHash('sha256').update(body).digest('hex') } : {};
    if (range) headers.Range = range;
    let req;
    try {
      req = await aws.sign(`${base}/${key.split('/').map(encodeURIComponent).join('/')}`, { method, headers, body });
    } catch (e) {
      throw fail(`R2 ${method}: the request could not be made (${e.code || e.name})`);
    }
    // The time limit is for R2's answer, not for the body after it (a video plays at the phone's pace).
    let res;
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), ms);
    try {
      res = await fetch(req, { signal: ac.signal });
    } catch (e) {
      throw fail(`R2 ${method}: ${ac.signal.aborted ? 'no answer in time' : 'could not connect'}`);
    } finally { clearTimeout(timer); }
    if (res.ok || (res.status === 404 && method !== 'PUT') || (res.status === 416 && method === 'GET')) {
      if (method !== 'GET' || !res.ok) await res.arrayBuffer().catch(() => {});
      return res;
    }
    const text = method === 'HEAD' ? '' : await res.text().catch(() => '');
    const code = (/<Code>([\w.-]{1,60})<\/Code>/.exec(text) || [])[1];
    throw fail(`R2 ${method} refused (${res.status}${code ? ' ' + code : ''})`);
  }
  return {
    // a 100 MB video from a slow line: 2 s more for every MB
    put: async (key, body, type) => { await call('PUT', key, { body, type, ms: 20000 + Math.ceil(body.length / 1e6) * 2000 }); },
    // null when there is no such object; a 206 or 416 when a range was asked for
    get: async (key, range) => { const r = await call('GET', key, { ms: 30000, range }); return r.status === 404 ? null : r; },
    head: async key => {
      const r = await call('HEAD', key);
      return r.status === 404 ? null : { size: Number(r.headers.get('content-length')), etag: String(r.headers.get('etag') || '').replace(/"/g, '') };
    },
  };
}

// ── links ─────────────────────────────────────────────────────────────────
// A course file's link is a path on this site, so it opens on aybkk.net and through
// cn.aybkk.net alike. It is signed over the file's random key like a /ph link, with
// the same secret. exp 0 never ends, as the Cloudinary links did; a payment
// screenshot's link ends after a day or two (each page load brings a fresh one).
// The database keeps "r2:<key>", never a link, so a link is made when it is sent.
const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4',
  mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v', '3gp': 'video/3gpp' };
const typeOf = key => TYPES[String(key).split('.').pop()] || 'application/octet-stream';
const MD_KEY = /^idcn\/[a-z0-9]{1,20}\/(?:hub|sub|note|proof)\/[0-9a-f]{32}\.(?:jpg|png|webp|gif|mp4|mov|webm|m4v|3gp)$/;
const DAY = 86400;
const mdSig = (key, exp) => r2lib.phSig('md' + exp, key, 'm');
function mdPath(key, { days = 0, now = Date.now() } = {}) {
  const exp = days ? (Math.floor(now / 1000 / DAY) + 1 + days) * DAY : 0;
  return `/md/${exp}.${mdSig(key, exp)}/${key}`;
}
const REF = 'r2:';
const isRef = v => typeof v === 'string' && v.startsWith(REF);
const linkFor = (v, opts) => isRef(v) ? mdPath(v.slice(REF.length), opts) : v;
// 'ok', 'expired' or 'bad'
function mdCheck(exp, sig, key, now = Date.now()) {
  if (!MD_KEY.test(key) || !/^\d{1,12}$/.test(exp)) return 'bad';
  const want = Buffer.from(mdSig(key, Number(exp))), got = Buffer.from(String(sig));
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return 'bad';
  return Number(exp) === 0 || Number(exp) * 1000 > now ? 'ok' : 'expired';
}

// One object to the browser: the whole file, or the one byte range a video player
// asks for (Safari plays nothing without a 206). The type comes from our own name.
const RANGE = /^bytes=(\d{0,15})-(\d{0,15})$/;
async function sendObject(req, res, store, key, cache) {
  const no = (status, error) => res.status(status).set('Cache-Control', 'no-store').json({ error });
  const head = { 'Content-Type': typeOf(key), 'Cache-Control': cache, 'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" };
  if (req.method === 'HEAD') {
    const h = await store.head(key);
    if (!h) return no(404, 'not found');
    return res.set({ ...head, 'Content-Length': String(h.size), ...(h.etag ? { ETag: `"${h.etag}"` } : {}) }).end();
  }
  const m = RANGE.exec(String(req.headers.range || ''));
  const r = await store.get(key, m && (m[1] || m[2]) ? m[0] : undefined);
  if (!r) return no(404, 'not found');
  if (r.status === 416) return res.status(416).set({ ...head, 'Content-Range': r.headers.get('content-range') || 'bytes */*' }).end();
  res.status(r.status).set(head);
  for (const h of ['content-length', 'content-range', 'etag', 'last-modified']) {
    const v = r.headers.get(h);
    if (v) res.set(h, v);
  }
  pipeline(Readable.fromWeb(r.body), res, () => {});
}

// ── putting files in ──────────────────────────────────────────────────────
const hex = () => crypto.randomBytes(16).toString('hex');
const refuse = msg => Object.assign(new Error(msg), { status: 400 });
// A video is read whole to be signed: one big file in memory at a time.
let bigQueue = Promise.resolve();
const oneBig = fn => { const p = bigQueue.then(fn, fn); bigQueue = p.catch(() => {}); return p; };
const BIG = 16e6;
const VIDEO_EXT = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-m4v': 'm4v', 'video/3gpp': '3gp' };

// A photo is made again (at most 2560 px, JPEG): nothing of the camera's EXIF or GPS goes with it.
async function putImage(store, prefix, buf) {
  const v = await r2lib.photoVariants(buf);
  const key = `${prefix}/${hex()}.jpg`;
  await store.put(key, v.v, 'image/jpeg');
  return { ref: REF + key, width: v.width, height: v.height };
}
// a multer file: a video as it came, anything else as a photo
async function putFile(store, prefix, file) {
  if (/^video\//.test(file.mimetype || '')) {
    const ext = VIDEO_EXT[file.mimetype] || 'mp4', key = `${prefix}/${hex()}.${ext}`;
    await oneBig(async () => store.put(key, await fs.promises.readFile(file.path), TYPES[ext]));
    return { url: REF + key, type: 'video' };
  }
  return { url: (await putImage(store, prefix, await fs.promises.readFile(file.path))).ref, type: 'image' };
}
const dataUrlBytes = s => {
  const m = /^data:image\/[\w.+-]+;base64,/.exec(String(s || ''));
  return m ? Buffer.from(String(s).slice(m[0].length), 'base64') : null;
};

// ── copies from Cloudinary ────────────────────────────────────────────────
// The original as Cloudinary keeps it, byte for byte, then a HEAD of the copy: the
// size and MD5 must match before anyone points at it. Cloudinary's copy stays.
const CLOUD = /^https:\/\/res\.cloudinary\.com\//;
function extOf(url, fallback) {
  let e = '';
  try { e = ((/\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname) || [])[1] || '').toLowerCase(); } catch (_) {}
  if (e === 'jpeg') e = 'jpg';
  return TYPES[e] && TYPES[e].split('/')[0] === TYPES[fallback].split('/')[0] ? e : fallback;
}
async function copyIn(store, url, key, { fetch: httpFetch = fetch, ms = 60000 } = {}) {
  if (!CLOUD.test(String(url))) throw new Error('not a Cloudinary address');
  let buf;
  try {
    const r = await httpFetch(url, { signal: AbortSignal.timeout(ms) });
    if (!r.ok) { await r.arrayBuffer().catch(() => {}); throw new Error(`Cloudinary answered ${r.status}`); }
    buf = Buffer.from(await r.arrayBuffer());
  } catch (e) {
    throw new Error(/^Cloudinary answered/.test(e.message) ? e.message : 'Cloudinary did not send the file');
  }
  if (!buf.length) throw new Error('Cloudinary sent an empty file');
  await (buf.length > BIG ? oneBig : f => f())(() => store.put(key, buf, typeOf(key)));
  const h = await store.head(key);
  const md5 = crypto.createHash('md5').update(buf).digest('hex');
  if (!h || h.size !== buf.length || h.etag !== md5) throw Object.assign(new Error('the copy in R2 does not match the original'), { r2: true });
  return { bytes: buf.length, md5 };
}

// ── the old workshop system (server.js, Neo4j) ────────────────────────────
// Faces and journal photos from the orientation forms, journals and the check-in
// station. Cloudinary made them 400 px squares cropped on the face; here the square
// is taken from the middle, a little above it for a portrait (faces sit high).
const FACE = 400;
let faceQueue = Promise.resolve();
async function faceSquare(buf) {
  const d = r2lib.dims(buf);
  if (!d || !d.w || !d.h) throw refuse('The photo could not be read (JPEG, PNG or WebP only).');
  if (d.w * d.h > r2lib.MAX_PIXELS) throw refuse('The photo is too large.');
  const run = async () => {
    let img;
    try { img = await loadImage(buf); } catch (_) { throw refuse('The photo could not be read (JPEG, PNG or WebP only).'); }
    const c = createCanvas(FACE, FACE);
    try {
      const side = Math.min(img.width, img.height), x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, FACE, FACE);
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.drawImage(img, (img.width - side) / 2, (img.height - side) * 0.3, side, side, 0, 0, FACE, FACE);
      return await c.encode('jpeg', 85);
    } finally { c.width = 0; c.height = 0; img.src = Buffer.alloc(0); }
  };
  const p = faceQueue.then(run, run);
  faceQueue = p.catch(() => {});
  return p;
}

// Neo4j keeps the res.cloudinary.com links it was given (aybkk-students/<id>) and is
// not changed: once a copy is in R2 (ws_photo_map, filled by the copy below), every
// answer this site sends that holds such a link says /sp/<file> instead. New uploads
// get a random file name, so nobody can replace a photo that is there.
const WS_URL = /https?:\/\/res\.cloudinary\.com\/dw1uubecu\/image\/upload\/(?:[^\s"'<>/?#\\]+\/)*?(aybkk-students\/[^\s"'<>/?#\\]+?)(?:\.[a-z0-9]{2,5})?(?:\?[^\s"'<>#\\]*)?(?=[#"'\s<>,)\\]|$)/gi;
const SP_FILE = /^[0-9a-f]{32}\.(?:jpg|png|webp|gif)$/;

// r2Endpoint: a test's fake R2. fetch: how Cloudinary's originals are fetched (a test's fake).
function wsPhotos({ r2Endpoint, fetch: httpFetch = fetch } = {}) {
  const store = makeStore({ endpoint: r2Endpoint });
  const map = new Map();             // old public_id -> file under /sp/
  let getPool = () => null;

  const rewriteText = (s, base = '') => s.replace(WS_URL, (all, id) => {
    const f = map.get(id);
    return f ? `${base}/sp/${f}` : all;
  });
  // Every string answer (JSON, CSV, HTML) on its way out. A CSV is read outside the
  // site, so its links are whole.
  function rewrite(req, res, next) {
    if (!store) return next();
    const send = res.send;
    res.send = function (body) {
      if (typeof body === 'string' && map.size && body.includes('aybkk-students/')) {
        const csv = /text\/csv/i.test(String(this.get('Content-Type') || ''));
        body = rewriteText(body, csv ? `https://${req.get('x-forwarded-host') || req.get('host')}` : '');
      }
      return send.call(this, body);
    };
    next();
  }
  const fileOf = url => {
    if (typeof url !== 'string') return null;
    const own = /^\/sp\/([^/?#]+)$/.exec(url);
    if (own) return SP_FILE.test(own[1]) ? own[1] : null;
    const m = new RegExp(WS_URL.source, 'i').exec(url);
    return m ? map.get(m[1]) || null : null;
  };
  // The share card draws the photo itself: the bytes from R2 when there is a copy, else the link as before.
  async function cardImage(url) {
    const file = store && fileOf(url);
    if (!file) return url;
    try {
      const r = await store.get(`ws/${file}`);
      if (r) return Buffer.from(await r.arrayBuffer());
    } catch (_) {}
    return url.startsWith('/') ? '' : url;
  }
  async function newFace(imageBase64) {
    const buf = dataUrlBytes(imageBase64);
    if (!buf) throw refuse('imageBase64 must be a data:image/... photo');
    const jpg = await faceSquare(buf);
    const file = `${hex()}.jpg`;
    await store.put(`ws/${file}`, jpg, 'image/jpeg');
    return `/sp/${file}`;
  }

  async function initSchema() {
    const db = getPool();
    await db.query(`CREATE TABLE IF NOT EXISTS ws_photo_map (
      public_id TEXT PRIMARY KEY, file TEXT NOT NULL UNIQUE, bytes INTEGER, md5 TEXT,
      copied_at TIMESTAMPTZ DEFAULT now())`);
    for (const r of (await db.query('SELECT public_id, file FROM ws_photo_map')).rows) map.set(r.public_id, r.file);
  }
  // after mount (it needs the database); once, and again after a failure
  let ready = null;
  const start = () => !store || !getPool() ? Promise.resolve()
    : ready || (ready = initSchema().catch(e => { ready = null; console.error('✗ old workshop photos: R2 table not ready:', e.message); }));

  // Staff only, started by a press and run in the background (about 800 small photos):
  // any number of presses copy each photo once. Counts of files, never a name.
  const job = { running: false, startedAt: null, finishedAt: null, listed: 0, copied: 0, already: 0, failed: 0, error: null };
  async function runCopy(cloudinary) {
    Object.assign(job, { running: true, startedAt: new Date().toISOString(), finishedAt: null,
      listed: 0, copied: 0, already: 0, failed: 0, error: null });
    try {
      await start();
      const db = getPool();
      if (!db) throw new Error('no database');
      const all = [];
      let cursor;
      do {
        const r = await cloudinary.api.resources({ type: 'upload', resource_type: 'image', prefix: 'aybkk-students/',
          max_results: 500, ...(cursor ? { next_cursor: cursor } : {}) });
        all.push(...(r.resources || []));
        cursor = r.next_cursor;
      } while (cursor && all.length < 50000);
      job.listed = all.length;
      const todo = all.filter(a => a && a.public_id && !map.has(a.public_id));
      job.already = all.length - todo.length;
      let i = 0, halt = false;
      const worker = async () => {
        while (!halt && i < todo.length) {
          const a = todo[i++];
          try {
            const file = `${hex()}.${extOf(a.secure_url, 'jpg')}`;
            const c = await copyIn(store, a.secure_url, `ws/${file}`, { fetch: httpFetch, ms: 30000 });
            const ins = await db.query(`INSERT INTO ws_photo_map (public_id, file, bytes, md5) VALUES ($1,$2,$3,$4)
              ON CONFLICT (public_id) DO NOTHING RETURNING file`, [a.public_id, file, c.bytes, c.md5]);
            map.set(a.public_id, ins.rows[0] ? file
              : (await db.query('SELECT file FROM ws_photo_map WHERE public_id=$1', [a.public_id])).rows[0].file);
            job.copied++;
          } catch (e) {
            job.failed++;
            // R2 itself refused: the next ones would fail the same way
            if (e.r2) { halt = true; job.error = e.message; }
          }
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
    } catch (e) {
      job.error = e.r2 ? e.message : `Cloudinary list: ${e.message || 'no answer'}`;
    } finally {
      job.running = false; job.finishedAt = new Date().toISOString();
    }
  }
  const jobOut = () => ({ r2: !!store, ...job, inR2: map.size });

  function mount(app, { cloudinary, driver, staffOnly, pool }) {
    getPool = pool;
    // With R2 off, as when there was no such route.
    app.get('/sp/:file', async (req, res, next) => {
      if (!store) return next();
      if (!SP_FILE.test(req.params.file)) return res.status(404).set('Cache-Control', 'no-store').json({ error: 'not found' });
      try {
        await sendObject(req, res, store, `ws/${req.params.file}`, 'public, max-age=86400, s-maxage=86400');
      } catch (e) {
        if (!res.headersSent) res.status(502).set('Cache-Control', 'no-store').json({ error: 'photo not available' });
      }
    });

    // POST /api/upload/student-photo
    // Body: { studentId, imageBase64, assessmentId?, slotIndex?, name?, location? }
    // With R2 off, Cloudinary as before: one public_id per student, entry and slot
    // (student_<studentId>[_<assessmentId>][_slot<n>]), a re-upload refreshes it.
    // With R2 on, every upload is a new file; the photoUrls array on the assessment
    // node accumulates the slots as before.
    app.post('/api/upload/student-photo', async (req, res) => {
      const { studentId, imageBase64, assessmentId, slotIndex, name, location } = req.body;
      if (!studentId || !imageBase64) return res.status(400).json({ error: 'Missing studentId or imageBase64' });
      try {
        let photoUrl;
        if (store) photoUrl = await newFace(imageBase64);
        else {
          const isPerEntry = !!assessmentId;
          // Slot-aware public_id: each slot index gets its own asset
          const slotSuffix = (slotIndex !== undefined && slotIndex !== null) ? `_slot${slotIndex}` : '';
          const publicId = isPerEntry
            ? `student_${studentId}_${assessmentId}${slotSuffix}`
            : `student_${studentId}${slotSuffix}`;
          const result = await cloudinary.uploader.upload(imageBase64, {
            folder: 'aybkk-students',
            public_id: publicId,
            overwrite: true, // re-upload same slot = refresh; different slot = separate asset
            backup: false,   // no backup version needed per slot
            transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face', quality: 'auto' }]
          });
          photoUrl = result.secure_url;
        }

        const session = driver.session();
        try {
          // Always update Student.photoUrl (latest-known face for dashboard).
          // Optional name/location let the door station create a proper node for
          // roster students who never touched Neo4j; never overwrites an existing name.
          await session.run(
            `MERGE (s:Student {id: $sid})
             ON CREATE SET s.createdAt = datetime(),
                           s.location = coalesce($location, 'hefei'),
                           s.isChineseStudent = true
             SET s.photoUrl = $url,
                 s.name = coalesce(s.name, $name)`,
            { sid: studentId, url: photoUrl, name: name || null, location: location || null }
          );
          // Pin to the specific assessment using photoUrls array
          if (assessmentId) {
            await session.run(
              `MATCH (sa) WHERE (sa:SelfAssessment OR sa:PracticeLog) AND sa.id = $aid
               SET sa.photoUrls = coalesce(sa.photoUrls, []) + $url,
                   sa.photoUrl = $url
               RETURN sa.id AS id`,
              { aid: assessmentId, url: photoUrl }
            );
          }
        } finally { await session.close(); }
        res.json({ success: true, photoUrl });
      } catch (err) {
        console.error(store ? '[student photo] not stored:' : '[Cloudinary upload error]', err.message);
        res.status(store && err.status === 400 ? 400 : 500).json({ error: err.message });
      }
    });

    app.get('/api/ws-photos/copy', staffOnly, (req, res) => res.json(jobOut()));
    app.post('/api/ws-photos/copy', staffOnly, (req, res) => {
      if (!store) return res.status(409).json({ error: 'R2 is not set up: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET are needed in Railway.' });
      if (!job.running) runCopy(cloudinary);
      res.status(202).json(jobOut());
    });
  }

  return { on: !!store, rewrite, rewriteText, mount, start, cardImage, fileOf, waitCopy: async () => { while (job.running) await new Promise(r => setTimeout(r, 20)); } };
}

module.exports = { makeStore, mdPath, mdCheck, linkFor, isRef, REF, sendObject, putImage, putFile, dataUrlBytes,
  copyIn, extOf, typeOf, faceSquare, wsPhotos, CLOUD };
