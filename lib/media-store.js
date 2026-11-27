// Course files and the old workshop photos in Cloudflare R2 (25 Nov 2026), next to
// the class photos of lib/r2.js: Cloudinary's free plan was over its limit and was to
// stop on 29 Nov. The same four R2_* variables switch it on; with any one missing
// makeStore() is null and every caller keeps Cloudinary as before.
// Errors name the method and R2's status only: never a key or a signed URL.
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const { Readable, pipeline } = require('stream');
const { AwsClient } = require('aws4fetch');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const r2lib = require('./r2');
const oneAtATime = require('./photo-queue');

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
    del: async key => { await call('DELETE', key); },
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
// asks for (Safari plays nothing without a 206). The type comes from our own name
// (only photos and videos), so a link opened on its own shows or plays the file and
// nothing else: no sandbox, which stops a browser's own video controls.
const RANGE = /^bytes=(\d{0,15})-(\d{0,15})$/;
const FILE_CSP = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'";
async function sendObject(req, res, store, key, cache) {
  const no = (status, error) => res.status(status).set('Cache-Control', 'no-store').json({ error });
  const head = { 'Content-Type': typeOf(key), 'Cache-Control': cache, 'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': FILE_CSP };
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
// kind: photoType (a photo this server cannot use) or photoBig; the pages say it in their own words
const refuse = (msg, kind) => Object.assign(new Error(msg), { status: 400, ...(kind ? { kind } : {}) });
const NOT_USABLE = 'This photo type cannot be used here: send a JPEG, or a screenshot of the photo.';
const NOT_READ = 'This photo could not be read: send a JPEG, or a screenshot of the photo.';
const tooBig = (d, max) => refuse(`This photo is too large (${Math.round(d.w * d.h / 1e6)} megapixels, at most ${max / 1e6}).`, 'photoBig');
// A video is read whole to be signed: one big file in memory at a time.
let bigQueue = Promise.resolve();
const oneBig = fn => { const p = bigQueue.then(fn, fn); bigQueue = p.catch(() => {}); return p; };
const BIG = 16e6;
const VIDEO_EXT = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-m4v': 'm4v', 'video/3gpp': '3gp' };

// What a file is, from its first bytes: JPEG, PNG, WebP or GIF, else null (HEIC and the rest).
function imageKind(b) {
  if (!Buffer.isBuffer(b) || b.length < 12) return null;
  if (b[0] === 0xFF && b[1] === 0xD8) return 'jpg';
  if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (/^GIF8[79]a$/.test(b.toString('latin1', 0, 6))) return 'gif';
  return null;
}
// A video sent with no video type (some phones say application/octet-stream): its
// extension from the first bytes. HEIF and AVIF photos share the MP4 box, not their brands.
function videoExt(b) {
  if (b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp') {
    const brand = b.toString('latin1', 8, 12);
    if (/^(hei[cxms]|hev[cxms]|mif1|msf1|avi[fs])$/.test(brand)) return null;
    return brand === 'qt  ' ? 'mov' : /^3g/.test(brand) ? '3gp' : brand === 'M4V ' ? 'm4v' : 'mp4';
  }
  return b.length >= 4 && b.readUInt32BE(0) === 0x1A45DFA3 ? 'webm' : null;
}
async function sniffVideo(path) {
  let h;
  try {
    h = await fs.promises.open(path, 'r');
    const b = Buffer.alloc(16), { bytesRead } = await h.read(b, 0, 16, 0);
    return videoExt(b.subarray(0, bytesRead));
  } catch (_) { return null; } finally { if (h) await h.close().catch(() => {}); }
}
// A payment screenshot keeps its own size (a long scrolling one too, up to 25 MP): it
// is drawn again only so the camera's EXIF goes, a PNG as a PNG so its text stays sharp.
const WHOLE_MAX = 25e6;
function wholeImage(buf, kind) {
  return oneAtATime(async () => {
    let img, c;
    try { img = await loadImage(buf); } catch (_) { throw refuse(NOT_READ, 'photoType'); }
    try {
      const s = Math.min(1, Math.sqrt(WHOLE_MAX / (img.width * img.height)));
      const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
      c = createCanvas(w, h);
      const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
      x.imageSmoothingEnabled = s < 1; x.imageSmoothingQuality = 'high';
      x.drawImage(img, 0, 0, w, h);
      const png = kind === 'png';
      return { body: png ? await c.encode('png') : await c.encode('jpeg', 92), ext: png ? 'png' : 'jpg', width: w, height: h };
    } finally { if (c) { c.width = 0; c.height = 0; } img.src = Buffer.alloc(0); }
  });
}
// A photo is made again (at most 2560 px, JPEG; whole: at its own size): nothing of the
// camera's EXIF or GPS goes with it. A GIF carries no camera data and is kept as it came.
async function putImage(store, prefix, buf, { whole = false } = {}) {
  const kind = imageKind(buf);
  if (!kind) throw refuse(NOT_USABLE, 'photoType');
  let out;
  if (kind === 'gif') out = { body: buf, ext: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  else {
    const d = r2lib.dims(buf);
    if (!d || !d.w || !d.h) throw refuse(NOT_READ, 'photoType');
    if (d.w * d.h > r2lib.MAX_PIXELS) throw tooBig(d, r2lib.MAX_PIXELS);
    if (whole) out = await wholeImage(buf, kind);
    else {
      let v;
      try { v = await r2lib.photoVariants(buf); } catch (e) { throw e.status === 400 ? refuse(NOT_READ, 'photoType') : e; }
      out = { body: v.v, ext: 'jpg', width: v.width, height: v.height };
    }
  }
  const key = `${prefix}/${hex()}.${out.ext}`;
  await store.put(key, out.body, TYPES[out.ext]);
  return { ref: REF + key, width: out.width, height: out.height };
}
// a multer file: a video as it came, anything else as a photo
async function putFile(store, prefix, file) {
  const ext = /^video\//.test(file.mimetype || '') ? VIDEO_EXT[file.mimetype] || 'mp4' : await sniffVideo(file.path);
  if (ext) {
    const key = `${prefix}/${hex()}.${ext}`;
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
// bytes: the size Cloudinary's list gives, when known. A download of another size is
// fetched once more and used only when both are the same bytes (Cloudinary always
// sends it so), never a file cut short on the way. again: the waits before R2 failing
// (the PUT, the HEAD, a copy that does not match) is tried again in place (r2lib.again).
async function copyIn(store, url, key, { fetch: httpFetch = fetch, ms = 60000, bytes = null, again = [] } = {}) {
  if (!CLOUD.test(String(url))) throw new Error('not a Cloudinary address');
  const grab = async () => {
    try {
      const r = await httpFetch(url, { signal: AbortSignal.timeout(ms) });
      if (!r.ok) { await r.arrayBuffer().catch(() => {}); throw new Error(`Cloudinary answered ${r.status}`); }
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      throw new Error(/^Cloudinary answered/.test(e.message) ? e.message : 'Cloudinary did not send the file');
    }
  };
  const buf = await grab();
  if (!buf.length) throw new Error('Cloudinary sent an empty file');
  if (Number(bytes) > 0 && buf.length !== Number(bytes) && !(await grab()).equals(buf))
    throw new Error(`Cloudinary sent ${buf.length} bytes, its list says ${Number(bytes)}`);
  const md5 = crypto.createHash('md5').update(buf).digest('hex');
  await r2lib.again(async () => {
    await (buf.length > BIG ? oneBig : f => f())(() => store.put(key, buf, typeOf(key)));
    const h = await store.head(key);
    if (!h || h.size !== buf.length || h.etag !== md5) throw Object.assign(new Error('the copy in R2 does not match the original'), { r2: true });
  }, { waits: again });
  return { bytes: buf.length, md5 };
}

const within = (p, ms) => { let t; return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(new Error('no answer in time')), ms); })]).finally(() => clearTimeout(t)); };

// One copy at a time across every server on this database (a deploy overlaps the old
// one for a while): false when another one holds it. A session lock, so a server that
// dies lets go of it.
async function withLock(pool, name, fn) {
  const c = await pool.connect();
  try {
    if (!(await c.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [name])).rows[0].ok) return false;
    try { await fn(); } finally { await c.query('SELECT pg_advisory_unlock(hashtext($1))', [name]).catch(() => {}); }
    return true;
  } finally { c.release(); }
}
// Cloudinary stops on 29 Nov 2026 and deletes the files about 30 days later: the copies
// start by themselves (R2 on) a few minutes after each start and every few hours,
// until nothing is left or this date.
const AUTO_UNTIL = Date.parse('2027-01-01T00:00:00+07:00');

// ── the old workshop system (server.js, Neo4j) ────────────────────────────
// Faces and journal photos from the orientation forms, journals and the check-in
// station. Cloudinary made them 400 px squares cropped on the face; here the square
// is taken from the middle, a little above it for a portrait (faces sit high).
// The pages send at most 700 px, and the square is 400: 16 MP is plenty, and keeps a
// small upload from opening hundreds of MB. Decoded in the server's one photo queue.
const FACE = 400, FACE_MAX = 16e6;
async function faceSquare(buf) {
  const d = r2lib.dims(buf);
  if (!d || !d.w || !d.h) throw refuse(NOT_READ, 'photoType');
  if (d.w * d.h > FACE_MAX) throw tooBig(d, FACE_MAX);
  return oneAtATime(async () => {
    let img;
    try { img = await loadImage(buf); } catch (_) { throw refuse(NOT_READ, 'photoType'); }
    const c = createCanvas(FACE, FACE);
    try {
      const side = Math.min(img.width, img.height), x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, FACE, FACE);
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.drawImage(img, (img.width - side) / 2, (img.height - side) * 0.3, side, side, 0, 0, FACE, FACE);
      return await c.encode('jpeg', 85);
    } finally { c.width = 0; c.height = 0; img.src = Buffer.alloc(0); }
  });
}

// Neo4j keeps the res.cloudinary.com links it was given (aybkk-students/<id>) and is
// not changed: once a copy is in R2 (ws_photo_map, filled by the copy below), every
// answer this site sends that holds such a link says /sp/<file> instead. Every upload
// is a new file, so an old one stays in R2; the route takes no key, as before, so
// anyone can still set a student's face to a new one (at most UPLOADS_PER_HOUR from
// one address while R2 is on).
const WS_URL = /https?:\/\/res\.cloudinary\.com\/dw1uubecu\/image\/upload\/(?:[^\s"'<>/?#\\]+\/)*?(aybkk-students\/[^\s"'<>/?#\\]+?)(?:\.[a-z0-9]{2,5})?(?:\?[^\s"'<>#\\]*)?(?=[#"'\s<>,)\\]|$)/gi;
const SP_FILE = /^[0-9a-f]{32}\.(?:jpg|png|webp|gif)$/;
// A link says a public_id with a space or a Chinese name percent-encoded.
const idOf = s => { try { return decodeURIComponent(s); } catch (_) { return s; } };
const UPLOADS_PER_HOUR = 300;
// cn.aybkk.net comes in through cloudflared on this machine, with the client in
// cf-connecting-ip; Railway's edge writes x-forwarded-for itself.
const addressOf = req => {
  const via = /^(::ffff:)?127\.|^::1$/.test(req.socket?.remoteAddress || '') && req.headers['cf-connecting-ip'];
  const first = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return Buffer.from(String(via || (net.isIP(first) ? first : req.socket?.remoteAddress) || 'unknown').slice(0, 45)).toString();
};

// r2Endpoint: a test's fake R2. fetch: how Cloudinary's originals are fetched (a test's fake).
// auto: false, or when the copy starts by itself ({ firstMs, everyMs, againMs: after a run R2
// stopped }). retryMs: the table after a failed start; reloadMs: the copies another server
// made; listMs: each page of Cloudinary's list; r2AgainMs: each copy's tries again in place.
function wsPhotos({ r2Endpoint, fetch: httpFetch = fetch, auto = { firstMs: 3 * 60e3, everyMs: 3 * 3600e3 },
  retryMs = 30e3, reloadMs = 5 * 60e3, listMs = 30e3, perHour = UPLOADS_PER_HOUR, r2AgainMs = [2000, 8000] } = {}) {
  const store = makeStore({ endpoint: r2Endpoint });
  const map = new Map();             // old public_id -> file under /sp/
  let getPool = () => null, cloud = null;

  const rewriteText = (s, base = '') => s.replace(WS_URL, (all, id) => {
    const f = map.get(idOf(id));
    return f ? `${base}/sp/${f}` : all;
  });
  // Every string answer (JSON, CSV, HTML) on its way out. A CSV is read outside the
  // site, so its links are whole, a new /sp one too. Right after a start, an answer with
  // an old link waits for the table of copies (3 s at most, then it goes as it is).
  let mapLoaded = false, waitOver = false, onLoad, waiting = null;
  const firstLoad = new Promise(r => { onLoad = r; });
  const mapWait = () => waiting || (waiting = Promise.race([firstLoad, new Promise(r => later(r, 3000))]).then(() => { waitOver = true; }));
  function rewrite(req, res, next) {
    if (!store) return next();
    const send = res.send;
    res.send = function (body) {
      if (typeof body !== 'string') return send.call(this, body);
      const csv = /text\/csv/i.test(String(this.get('Content-Type') || ''));
      const old = body.includes('aybkk-students/');
      if (!old && !(csv && body.includes('/sp/'))) return send.call(this, body);
      const go = () => {
        const base = csv ? `https://${req.get('x-forwarded-host') || req.get('host')}` : '';
        if (old && map.size) body = rewriteText(body, base);
        if (csv) body = body.replace(/(^|[,"\n])\/sp\/([0-9a-f]{32}\.(?:jpg|png|webp|gif))/g, `$1${base}/sp/$2`);
        return send.call(this, body);
      };
      if (!old || mapLoaded || waitOver) return go();
      mapWait().then(go).catch(e => console.warn('[old workshop photos] answer not sent:', e.message));
      return this;
    };
    next();
  }
  const fileOf = url => {
    if (typeof url !== 'string') return null;
    const own = /^\/sp\/([^/?#]+)$/.exec(url);
    if (own) return SP_FILE.test(own[1]) ? own[1] : null;
    const m = new RegExp(WS_URL.source, 'i').exec(url);
    return m ? map.get(idOf(m[1])) || null : null;
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
  // in memory: one counter per address per hour
  const tries = new Map();
  const mayUpload = ip => {
    const now = Date.now();
    if (tries.size > 5000) tries.clear();
    let t = tries.get(ip);
    if (!t || now - t.start >= 3600e3) tries.set(ip, t = { start: now, n: 0 });
    return ++t.n <= perHour;
  };

  // Rows are only ever added, so a reload adds what another server copied.
  const loadMap = async () => {
    for (const r of (await getPool().query('SELECT public_id, file FROM ws_photo_map')).rows) map.set(r.public_id, r.file);
  };
  // 'done' once a whole pass left nothing on Cloudinary: then the copy no longer runs by
  // itself (Cloudinary closed would only show as a failure); staff can still run one.
  let doneAt = null;
  const readDone = async () => {
    const r = (await getPool().query(`SELECT at FROM ws_photo_copy WHERE k='done'`)).rows[0];
    if (r) { doneAt = r.at; autoState.done = true; }
  };
  async function initSchema() {
    await getPool().query(`CREATE TABLE IF NOT EXISTS ws_photo_map (
      public_id TEXT PRIMARY KEY, file TEXT NOT NULL UNIQUE, bytes INTEGER, md5 TEXT,
      copied_at TIMESTAMPTZ DEFAULT now())`);
    await getPool().query(`CREATE TABLE IF NOT EXISTS ws_photo_copy (k TEXT PRIMARY KEY, at TIMESTAMPTZ DEFAULT now())`);
    await loadMap();
    mapLoaded = true; onLoad();
    await readDone();
  }
  // After mount (it needs the database). A start that fails (Postgres restarting with
  // the deploy) is tried again until it works: until then every answer keeps the
  // Cloudinary links. Then the map is read again now and then, and the copy is due.
  let ready = null, retry = null, reload = null;
  const later = (fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; };
  const start = () => !store || !getPool() ? Promise.resolve()
    : ready || (ready = initSchema().then(() => {
      if (!reload) { reload = setInterval(() => loadMap().catch(e => console.warn('[old workshop photos] map not read again:', e.message)), reloadMs); if (reload.unref) reload.unref(); }
      if (auto) autoSoon(auto.firstMs);
    }, e => {
      ready = null; console.error('✗ old workshop photos: R2 table not ready:', e.message);
      clearTimeout(retry); retry = later(start, retryMs);
    }));

  // Staff (or the timer below) start it; it runs in the background (small
  // photos), one server at a time, and copies each photo once. Counts of files, never a name.
  const job = { running: false, startedAt: null, finishedAt: null, listed: 0, copied: 0, already: 0, failed: 0, left: null, error: null };
  // true when R2 itself stopped it
  async function runCopy(cloudinary) {
    Object.assign(job, { running: true, startedAt: new Date().toISOString(), finishedAt: null,
      listed: 0, copied: 0, already: 0, failed: 0, left: null, error: null });
    let r2Stop = false;
    try {
      await start();
      const db = getPool();
      if (!db) throw new Error('no database');
      let whole = false;
      const got = await withLock(db, 'aybkk-copy:aybkk-students', async () => {
        const all = [];
        let cursor;
        do {
          // the SDK's own timeout never ends a request that was taken and not answered
          const r = await within(cloudinary.api.resources({ type: 'upload', resource_type: 'image', prefix: 'aybkk-students/',
            max_results: 500, ...(cursor ? { next_cursor: cursor } : {}) }), listMs);
          all.push(...(r.resources || []));
          cursor = r.next_cursor;
        } while (cursor && all.length < 50000);
        whole = !cursor;
        job.listed = all.length;
        await loadMap();
        const todo = all.filter(a => a && a.public_id && !map.has(a.public_id));
        job.already = all.length - todo.length;
        job.left = todo.length;
        let i = 0, halt = false;
        const worker = async () => {
          while (!halt && i < todo.length) {
            const a = todo[i++];
            try {
              const file = `${hex()}.${extOf(a.secure_url, 'jpg')}`;
              const c = await copyIn(store, a.secure_url, `ws/${file}`, { fetch: httpFetch, ms: 30000, bytes: a.bytes, again: r2AgainMs });
              const ins = await db.query(`INSERT INTO ws_photo_map (public_id, file, bytes, md5) VALUES ($1,$2,$3,$4)
                ON CONFLICT (public_id) DO NOTHING RETURNING file`, [a.public_id, file, c.bytes, c.md5]);
              job.left--;
              if (ins.rows[0]) { map.set(a.public_id, file); job.copied++; continue; }
              // copied meanwhile by other means: that copy stays the one, this one goes
              job.already++;
              store.del(`ws/${file}`).catch(() => {});
              map.set(a.public_id, (await db.query('SELECT file FROM ws_photo_map WHERE public_id=$1', [a.public_id])).rows[0].file);
            } catch (e) {
              job.failed++;
              // R2 itself refused: the next ones would fail the same way
              if (e.r2) { halt = r2Stop = true; job.error = e.message; }
            }
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
      });
      if (!got) job.error = 'Another server is copying these photos now.';
      else if (whole && job.left === 0 && !job.failed && !job.error) {
        autoState.done = true; doneAt = new Date();
        await db.query(`INSERT INTO ws_photo_copy (k) VALUES ('done') ON CONFLICT (k) DO UPDATE SET at=now()`)
          .catch(e => console.warn('[old workshop photos] the done mark was not saved:', e.message));
      }
    } catch (e) {
      // the SDK rejects with { error: { message } }, not an Error
      if (e.r2) r2Stop = true;
      job.error = e.r2 ? e.message : `Cloudinary list: ${e.message || (e.error && e.error.message) || 'no answer'}`;
    } finally {
      job.running = false; job.finishedAt = new Date().toISOString();
    }
    return r2Stop;
  }
  // by itself until a run leaves nothing behind (here or on another server), or Cloudinary has deleted the files;
  // 10 minutes after a run R2 stopped, not 3 hours (Cloudinary closes on 29 Nov 2026)
  const autoState = { next: null, done: false };
  let autoTimer = null;
  function autoSoon(ms) {
    clearTimeout(autoTimer);
    if (!auto || !cloud || autoState.done || Date.now() + ms > AUTO_UNTIL) { autoState.next = null; return; }
    autoState.next = new Date(Date.now() + ms).toISOString();
    autoTimer = later(async () => {
      autoState.next = null;
      await readDone().catch(() => {});
      const r2Stop = !autoState.done && !job.running && await runCopy(cloud);
      autoSoon(r2Stop ? auto.againMs || 10 * 60e3 : auto.everyMs);
    }, ms);
  }
  const jobOut = () => ({ r2: !!store, ...job, inR2: map.size, done: !!doneAt, doneAt,
    auto: { on: !!(store && auto && cloud), ...autoState } });

  function mount(app, { cloudinary, driver, staffOnly, pool }) {
    getPool = pool; cloud = cloudinary;
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
      if (store && !mayUpload(addressOf(req))) return res.status(429).json({ error: 'Too many photos from this address: try again in an hour.' });
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

  return { on: !!store, rewrite, rewriteText, mount, start, cardImage, fileOf, status: jobOut,
    waitCopy: async () => { while (job.running) await new Promise(r => setTimeout(r, 20)); } };
}

module.exports = { makeStore, mdPath, mdCheck, linkFor, isRef, REF, sendObject, putImage, putFile, dataUrlBytes,
  copyIn, extOf, typeOf, faceSquare, wsPhotos, withLock, AUTO_UNTIL, CLOUD };
