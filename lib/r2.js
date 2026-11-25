// Class photos in Cloudflare R2 (Nov 2026): Cloudinary's free plan was over its
// limit, and its 2048 px re-encode of Drive's 2048 px thumbnail looked soft.
// On only when all four R2_* variables are set; with any one missing nothing
// here is used and every photo goes to Cloudinary as before. Faces stay there.
// R2 speaks the S3 API, signed (SigV4, region "auto", service "s3") by aws4fetch.
// Errors name the method and R2's status and code only: never a key or a signed URL.
const crypto = require('crypto');
const { AwsClient } = require('aws4fetch');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

// aws4fetch signs with the global WebCrypto, which Node 18 has only behind a flag
// (Railway's Node is nixpacks' default, not pinned here).
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = crypto.webcrypto;

const R2_VARS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
const r2Configured = () => R2_VARS.every(k => !!process.env[k]);

// endpoint: a test's fake R2 on this machine. fetch: the same.
function makeR2({ endpoint, fetch: httpFetch = fetch } = {}) {
  if (!r2Configured()) return null;
  const env = process.env;
  const base = `${(endpoint || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(/\/$/, '')}/${encodeURIComponent(env.R2_BUCKET)}`;
  const aws = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3', region: 'auto', retries: 0 });
  // r2: true marks an error from R2 itself (or the way to it), not from the photo.
  const fail = msg => Object.assign(new Error(msg), { status: 502, r2: true });
  async function call(method, key, { body, type, ms = 20000 } = {}) {
    const headers = body ? { 'Content-Type': type, 'X-Amz-Content-Sha256': crypto.createHash('sha256').update(body).digest('hex') } : {};
    let req;
    try {
      req = await aws.sign(`${base}/${key.split('/').map(encodeURIComponent).join('/')}`, { method, headers, body });
    } catch (e) {
      // A bad R2_ACCOUNT_ID (a stray space) or no WebCrypto: the name only, the message may hold the address.
      throw fail(`R2 ${method}: the request could not be made (${e.code || e.name})`);
    }
    // The time limit is for R2's answer, not for the body after it: /ph streams a
    // photo to a phone on a slow line at that phone's pace.
    let res;
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), ms);
    try {
      res = await httpFetch(req, { signal: ac.signal });
    } catch (e) {
      throw fail(`R2 ${method}: ${ac.signal.aborted ? 'no answer in time' : 'could not connect'}`);
    } finally { clearTimeout(timer); }
    if (res.ok || (res.status === 404 && method !== 'PUT')) {
      if (method !== 'GET' || !res.ok) await res.arrayBuffer().catch(() => {});
      return res;
    }
    const text = method === 'HEAD' ? '' : await res.text().catch(() => '');
    const code = (/<Code>([\w.-]{1,60})<\/Code>/.exec(text) || [])[1];
    throw fail(`R2 ${method} refused (${res.status}${code ? ' ' + code : ''})`);
  }
  return {
    // 20 s for a photo of a few MB: a Drive import must end well inside Cloudflare's 100 s.
    put: async (key, body, type) => { await call('PUT', key, { body, type }); },
    // null when there is no such object
    get: async key => { const r = await call('GET', key, { ms: 30000 }); return r.status === 404 ? null : r; },
    head: async key => {
      const r = await call('HEAD', key);
      return r.status === 404 ? null : { size: Number(r.headers.get('content-length')), etag: String(r.headers.get('etag') || '').replace(/"/g, '') };
    },
    del: async key => { await call('DELETE', key); },
  };
}

// The link to a photo in R2 is a path on this site, so it works on aybkk.net and
// through cn.aybkk.net alike, and Cloudflare's edge can keep it. Like the
// download link it never ends, and it is signed over the photo's random r2_key:
// a row id handed out again never opens someone else's photo.
// p: the JPEG made from the tile, for LINE's preview (LINE takes no WebP).
const PH_FILES = { t: 't.webp', v: 'v.jpg', p: 'p.jpg' };
let spare;
const phKey = () => crypto.createHash('sha256').update('aybkk-photo-r2:' + (process.env.CLOUDINARY_API_SECRET
  || process.env.BKK_ADMIN_KEY || process.env.SHOP_ADMIN_KEY || (spare = spare || crypto.randomBytes(32).toString('hex')))).digest();
const phSig = (id, r2Key, kind) => crypto.createHmac('sha256', phKey()).update(`${id}.${r2Key}.${kind}`).digest('base64url').slice(0, 22);
const phPath = (id, r2Key, kind) => `/ph/${id}.${phSig(id, r2Key, kind)}/${PH_FILES[kind]}`;
const objectKey = (day, r2Key, kind) => `cls/${day}/${r2Key}/${kind === 'v' ? 'v.jpg' : 't.webp'}`;

// ── the two copies kept of each photo ─────────────────────────────────────
// v.jpg: what students open and save, long side at most 2560 px. t.webp: the
// tile, in the same 600 px box as Cloudinary's, so tiles look as before.
// Skia turns a photo upright by its EXIF orientation as it decodes it, and a
// fresh encode carries no EXIF, GPS or XMP; the sRGB profile it adds goes too.
const VIEW_MAX = 2560, TILE_MAX = 600, VIEW_Q = 86, TILE_Q = 80, PREVIEW_Q = 80;
// A 50 MP photo is about 200 MB once decoded; anything bigger is refused before decoding.
const MAX_PIXELS = 50e6;

// Width and height from the file header, without decoding it.
function dims(b) {
  if (!Buffer.isBuffer(b) || b.length < 30) return null;
  if (b[0] === 0xFF && b[1] === 0xD8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xFF) return null;
      const m = b[i + 1];
      if (m === 0xFF) { i++; continue; }
      if (m >= 0xC0 && m <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(m)) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + b.readUInt16BE(i + 2);
    }
    return null;
  }
  if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const c = b.toString('latin1', 12, 16);
    if (c === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3FFF, h: b.readUInt16LE(28) & 0x3FFF };
    if (c === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3FFF) + 1, h: ((v >>> 14) & 0x3FFF) + 1 }; }
    if (c === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  }
  return null;
}
// Every APPn segment but JFIF, and comments.
function bareJpeg(b) {
  const out = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xFF && b[i + 1] !== 0xDA) {
    const m = b[i + 1], end = i + 2 + b.readUInt16BE(i + 2);
    if (!((m >= 0xE1 && m <= 0xEF) || m === 0xFE)) out.push(b.subarray(i, end));
    i = end;
  }
  out.push(b.subarray(i));
  return Buffer.concat(out);
}
// The plain lossy form (RIFF, WEBP, VP8) when there is no alpha or animation.
function bareWebp(b) {
  let vp8 = null;
  for (let i = 12; i + 8 <= b.length;) {
    const id = b.toString('latin1', i, i + 4), size = b.readUInt32LE(i + 4);
    if (id === 'ALPH' || id === 'ANIM') return b;
    if (id === 'VP8 ') vp8 = b.subarray(i, i + 8 + size + (size & 1));
    i += 8 + size + (size & 1);
  }
  if (!vp8) return b;
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(4 + vp8.length, 4); head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, vp8]);
}
const fit = (w, h, max) => { const s = Math.min(1, max / Math.max(w, h)); return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))]; };
// Halving first, then one last step: one cubic step from 6000 px to 2560 px
// shows moire on fine stripes (measured against a Lanczos reference, Nov 2026).
// A smoothed draw at the same size is a blur (a 2048 px phone photo lost its fine
// lines, Nov 2026): at 1:1 the pixels are copied as they are, and a halving that
// lands on the size wanted is the last step.
// Skia's pixels live outside V8's heap, so the GC is slow to free them: each
// canvas done with is emptied at once (a camera original is a few hundred MB).
const free = c => { if (c) { c.width = 0; c.height = 0; } };
function shrink(src, w, h) {
  const draw = (from, cw, ch) => {
    const c = createCanvas(cw, ch), x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, cw, ch);
    x.imageSmoothingEnabled = cw !== from.width || ch !== from.height; x.imageSmoothingQuality = 'high';
    x.drawImage(from, 0, 0, cw, ch);
    if (from !== src) free(from);
    return c;
  };
  let cur = src, cw = src.width, ch = src.height;
  while (cw / 2 >= w && ch / 2 >= h) { cw = Math.round(cw / 2); ch = Math.round(ch / 2); cur = draw(cur, cw, ch); }
  return cur !== src && cur.width === w && cur.height === h ? cur : draw(cur, w, h);
}
// One photo at a time on the whole server: a camera original takes a few hundred MB while it is open.
let queue = Promise.resolve();
const oneAtATime = fn => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };
const refuse = msg => Object.assign(new Error(msg), { status: 400 });

function photoVariants(buf) {
  return oneAtATime(async () => {
    const d = dims(buf);
    if (!d || !d.w || !d.h) throw refuse('The photo could not be read (JPEG, PNG or WebP only).');
    if (d.w * d.h > MAX_PIXELS) throw refuse(`The photo is too large to resize here (${Math.round(d.w * d.h / 1e6)} megapixels, at most ${MAX_PIXELS / 1e6}).`);
    let img, view, tile;
    try { img = await loadImage(buf); } catch (_) { throw refuse('The photo could not be read (JPEG, PNG or WebP only).'); }
    try {
      const [w, h] = fit(img.width, img.height, VIEW_MAX);
      view = shrink(img, w, h);
      const [tw, th] = fit(w, h, TILE_MAX);
      tile = shrink(view, tw, th);
      return { v: bareJpeg(await view.encode('jpeg', VIEW_Q)), t: bareWebp(await tile.encode('webp', TILE_Q)), width: w, height: h };
    } finally { free(tile); free(view); img.src = EMPTY; }
  });
}
const EMPTY = Buffer.alloc(0);
// The tile as JPEG, for LINE's preview (at most 1 MB; this is about 100 KB).
function tileJpeg(webp) {
  return oneAtATime(async () => {
    const img = await loadImage(webp);
    const c = shrink(img, img.width, img.height);
    try { return bareJpeg(await c.encode('jpeg', PREVIEW_Q)); } finally { free(c); img.src = EMPTY; }
  });
}

module.exports = { R2_VARS, r2Configured, makeR2, phSig, phPath, objectKey, photoVariants, tileJpeg, dims, MAX_PIXELS };
