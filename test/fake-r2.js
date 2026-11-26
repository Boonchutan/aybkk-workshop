// A fake Cloudflare R2 for the tests: the S3 API on this machine, objects in memory.
// It checks each request's SigV4 signature with its own code (not the library's),
// answers byte ranges as R2 does (206, 416), and can be told to refuse or lie.
const http = require('http');
const crypto = require('crypto');

const R2ENV = { R2_ACCOUNT_ID: 'acct0000test', R2_ACCESS_KEY_ID: 'akid-test-r2', R2_SECRET_ACCESS_KEY: 'secret-test-r2-not-real', R2_BUCKET: 'aybkk-test' };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
const md5 = b => crypto.createHash('md5').update(b).digest('hex');

async function fakeR2() {
  const store = new Map(), log = [];
  const ctl = { fail: null, badEtag: false };          // fail: (method, key) => status to answer instead
  const xmlErr = (res, status, code) => { res.writeHead(status, { 'Content-Type': 'application/xml' }); res.end(`<?xml version="1.0"?><Error><Code>${code}</Code><Message>no</Message></Error>`); };
  const signedOk = (req, body) => {
    const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/auto\/s3\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})$/.exec(req.headers.authorization || '');
    if (!m || m[1] !== R2ENV.R2_ACCESS_KEY_ID) return false;
    const amz = req.headers['x-amz-date'] || '', hash = req.headers['x-amz-content-sha256'] || '';
    if (amz.slice(0, 8) !== m[2] || (hash !== 'UNSIGNED-PAYLOAD' && hash !== sha(body))) return false;
    const signed = m[3].split(';');
    if (!signed.includes('host') || !signed.includes('x-amz-date')) return false;
    const [path, query = ''] = req.url.split('?');
    const canon = [req.method, path, query, signed.map(h => `${h}:${String(req.headers[h] || '').trim()}`).join('\n') + '\n', m[3], hash].join('\n');
    let k = hmac('AWS4' + R2ENV.R2_SECRET_ACCESS_KEY, m[2]);
    for (const part of ['auto', 's3', 'aws4_request']) k = hmac(k, part);
    return crypto.createHmac('sha256', k).update(['AWS4-HMAC-SHA256', amz, `${m[2]}/auto/s3/aws4_request`, sha(canon)].join('\n')).digest('hex') === m[4];
  };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const pre = `/${R2ENV.R2_BUCKET}/`;
      const key = req.url.startsWith(pre) ? decodeURIComponent(req.url.slice(pre.length)) : null;
      log.push({ method: req.method, key, range: req.headers.range || null });
      if (!signedOk(req, body)) return xmlErr(res, 403, 'SignatureDoesNotMatch');
      if (!key) return xmlErr(res, 404, 'NoSuchBucket');
      const failWith = ctl.fail && ctl.fail(req.method, key);
      if (failWith) return xmlErr(res, failWith, failWith === 403 ? 'AccessDenied' : 'InternalError');
      if (req.method === 'PUT') { store.set(key, { body, type: req.headers['content-type'] }); res.writeHead(200, { ETag: `"${md5(body)}"` }); return res.end(); }
      if (req.method === 'DELETE') { store.delete(key); res.writeHead(204); return res.end(); }
      const o = store.get(key);
      if (!o) return xmlErr(res, 404, 'NoSuchKey');
      const etag = `"${ctl.badEtag ? 'f'.repeat(32) : md5(o.body)}"`, size = o.body.length;
      const m = req.method === 'GET' && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (m && (m[1] || m[2])) {
        let a = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
        let b = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
        if (a < 0) a = 0;
        if (a >= size || a > b) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
        res.writeHead(206, { 'Content-Type': o.type, 'Content-Length': b - a + 1, 'Content-Range': `bytes ${a}-${b}/${size}`, ETag: etag });
        return res.end(o.body.subarray(a, b + 1));
      }
      res.writeHead(200, { 'Content-Type': o.type, 'Content-Length': size, ETag: etag });
      res.end(req.method === 'HEAD' ? undefined : o.body);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, store, log, ctl, close: () => new Promise(r => server.close(r)) };
}

const r2On = () => Object.assign(process.env, R2ENV);
const r2Off = () => { for (const k of Object.keys(R2ENV)) delete process.env[k]; };

module.exports = { fakeR2, R2ENV, r2On, r2Off, md5 };
