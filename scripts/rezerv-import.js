#!/usr/bin/env node
'use strict';
/**
 * The move from Rezerv, from the command line: the same import as the box
 * "Move everything from Rezerv (CSV files)" on public/bkk-admin.html.
 *
 * No parsing is written here. At start-up this reads the admin page, takes its
 * import code out by name and runs that, so a file is read exactly as the page
 * reads it. If one of those names is gone from the page, nothing runs.
 *
 * It prints counts and reason codes only. What the server says about a row can
 * name a student, so that text goes to the --details file (mode 0600) and
 * nowhere else. Rows go to aybkk.net, my.aybkk.com or a test server on this
 * machine, and to no other address.
 *
 *   node scripts/rezerv-import.js check <kind> <file.csv> [--base URL] [--past-attended] [--details FILE]
 *   node scripts/rezerv-import.js write <kind> <file.csv> --expect "<the --expect a check printed>"
 *                                       [--base URL] [--past-attended] [--details FILE]
 *   node scripts/rezerv-import.js plan <dir>
 *   node scripts/rezerv-import.js run-all <dir> [--save] [--past-attended] [--base URL] [--details-dir DIR] [--from-step N:FILE]
 *
 * Exit: 0 done · 1 stopped, or a look that found a file a person must see ·
 *       2 wrong use, or a file that cannot be read ·
 *       3 the admin page's import code has changed · 4 not authorised
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const https = require('https');
const tls = require('tls');
const net = require('net');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const KINDS = ['members', 'passes', 'payments', 'visits'];
const DEFAULT_BASE = 'https://aybkk.net';
// The only servers rows are sent to. Anything else must be on this machine.
const SERVERS = ['aybkk.net', 'my.aybkk.com'];
const SELF = 'node scripts/rezerv-import.js';
const EXIT = { ok: 0, stopped: 1, usage: 2, page: 3, auth: 4 };
// For tests: another copy of the admin page, and a shorter wait for a batch.
// REZERV_IMPORT_TEST_ANY_HOST=1, also for tests only, lets a made-up https host stand in for ours.
const PAGE_FILE = process.env.REZERV_IMPORT_PAGE || path.join(__dirname, '..', 'public', 'bkk-admin.html');
const DEFAULT_TIMEOUT_MS = 120000;
const TIMEOUT_MS = Number(process.env.REZERV_IMPORT_TIMEOUT_MS) > 0 ? Number(process.env.REZERV_IMPORT_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
// A cell longer than this, or with a line break in it, is what a quote that never closes looks like.
const LONG_CELL = 300;

const USAGE = `Usage:
  ${SELF} check <kind> <file.csv> [--base URL] [--past-attended] [--details FILE]
  ${SELF} write <kind> <file.csv> --expect "<the --expect a check printed>"
                                      [--base URL] [--past-attended] [--details FILE]
  ${SELF} plan <dir>
  ${SELF} run-all <dir> [--save] [--past-attended] [--base URL] [--details-dir DIR] [--from-step N:FILE]

  kind: ${KINDS.join(' | ')}        --base: ${DEFAULT_BASE} unless given
  check saves nothing. write runs the same check first and saves only if it gives the --expect of the check a person read.
  run-all without --save looks at every file of the folder and saves nothing. With --save it saves each file in order,
  and stops at the first one a person must look at.
  --past-attended: past classes Rezerv still shows as booked are saved as attended. That cannot be undone: ask the owner first.
  Only counts and reason codes are printed. Names stay in the details file. Exports stay outside the repository.`;

const out = s => process.stdout.write(s + '\n');
class Halt extends Error {
  constructor(code, lines) { super(lines[0]); this.code = code; this.lines = lines; }
}
const usage = msg => new Halt(EXIT.usage, [msg, '', USAGE]);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const shq = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
const files = n => `${n} ${n === 1 ? 'file' : 'files'}`;
// Ctrl-C: the batch on its way is let through, then the run stops and says where it stands.
let interrupted = false;

// ── the admin page's own import code ───────────────────────────────────────
// Each piece by the name the page declares it under, in the page's order.
const PIECES = [
  ['AL', 'const'], ['WHO', 'const'], ['CI_KINDS', 'const'], ['nh', 'const'], ['CI_ALL', 'const'], ['CI_BATCH', 'const'],
  ['decodeFile', 'function'], ['parseCsv', 'function'], ['autoMap', 'function'], ['CI_DATES', 'const'], ['SLASHED', 'const'],
  ['monthFirst', 'function'], ['ciAutoMap', 'const'], ['rowFor', 'function'], ['NOT_SALES', 'const'], ['ciRead', 'function'],
  ['CI_SAME', 'const'], ['ciBatches', 'function'],
];
// What the page's ciRun posts for a batch. sendBatch below sends the same.
const CI_RUN_SENDS = `api('/api/bkk/admin/import/' + k, { method: 'POST', body: JSON.stringify({ rows: b.rows, dryRun: dry,
  firstRow: b.first, ...(k === 'visits' && CI.pastBooked ? { pastBookedAttended: true } : {}) }) })`;

const pageError = (name, what) => new Halt(EXIT.page, [
  `The admin page's import code has changed: "${name}" ${what}.`,
  `Nothing was read or sent. Bring scripts/rezerv-import.js in line with ${path.basename(PAGE_FILE)} first.`]);

function declStart(src, name, type) {
  const re = type === 'function' ? new RegExp(`^[ \\t]*function\\s+${name}\\s*\\(`, 'gm')
    : type === 'window' ? new RegExp(`^[ \\t]*window\\.${name}\\s*=`, 'gm')
    : new RegExp(`^[ \\t]*const\\s+${name}\\s*=`, 'gm');
  const hits = [...src.matchAll(re)];
  if (hits.length !== 1) throw pageError(name, hits.length ? 'is declared more than once' : 'was not found');
  return hits[0].index;
}
// The whole declaration: the shortest text from its start that is complete
// JavaScript, as the engine itself parses it, and that ends its line.
function cut(src, start, type, name) {
  const end = type === 'function' ? '}' : ';';
  for (let i = src.indexOf(end, start); i >= 0 && i - start < 60000; i = src.indexOf(end, i + 1)) {
    const text = src.slice(start, i + 1);
    try { new vm.Script(text); } catch (e) { if (e && e.name === 'SyntaxError') continue; throw e; }
    const eol = src.indexOf('\n', i + 1);
    if (!/^\s*(\/\/.*)?$/.test(src.slice(i + 1, eol < 0 ? src.length : eol))) break;
    return text;
  }
  throw pageError(name, 'could not be read to its end');
}

function loadPage() {
  let html;
  try { html = fs.readFileSync(PAGE_FILE, 'utf8'); } catch { throw new Halt(EXIT.page, [`Cannot read the admin page: ${PAGE_FILE}`]); }
  const pieces = PIECES.map(([name, type]) => ({ name, text: cut(html, declStart(html, name, type), type, name) }));
  // The two checks the page makes before it enables its Check button.
  const inner = cut(html, declStart(html, 'importInner', 'function'), 'function', 'importInner');
  const stmt = name => cut(inner, declStart(inner, name, 'const'), 'const', name);
  pieces.push({ name: 'miss / noWho', text: `function ciNeeds() { const K = CI_KINDS[CI.kind];
${stmt('miss')}\n${stmt('noWho')}\nreturn { miss: [...miss], noWho: !!noWho }; }` });
  const run = cut(html, declStart(html, 'ciRun', 'window'), 'const', 'ciRun');
  if (!run.replace(/\s+/g, '').includes(CI_RUN_SENDS.replace(/\s+/g, ''))) throw pageError('ciRun', 'no longer sends the request this tool sends');
  const page = { pieces };
  selfCheck(page);
  return page;
}

// The page runs in a browser. Eight bytes have no letter in the Thai Windows
// code page: Chromium reads them as U+FFFD, Node as private-use characters.
class PageTextDecoder extends TextDecoder {
  decode(...a) {
    const s = super.decode(...a);
    return this.encoding === 'windows-874' ? s.replace(/[\uF8C1-\uF8C8]/g, '\uFFFD') : s;
  }
}

// A fresh copy of the page's code and its CI state, one per file.
function newReader(page) {
  const ctx = vm.createContext({ TextDecoder: PageTextDecoder });
  vm.runInContext(`var CI = { kind: 'members', file: '', rows: [], heads: [], headRow: 0, map: {}, mdy: new Set(), pastBooked: false };`, ctx);
  for (const p of page.pieces) {
    try { vm.runInContext(p.text, ctx); } catch (e) { throw pageError(p.name, `did not run (${e.name}: ${e.message})`); }
  }
  try {
    return vm.runInContext(`({ CI, CI_KINDS, CI_BATCH, CI_DATES, SLASHED, nh, decodeFile, parseCsv, autoMap, monthFirst, rowFor, ciRead, ciBatches,
      ciNeeds })`, ctx);
  } catch (e) { throw pageError('the import code', `did not run (${e.name}: ${e.message})`); }
}

const exactBytes = buf => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

// Made-up lines through every piece, so a piece that is there but no longer
// fits this tool stops it here, not in the middle of a real file.
function selfCheck(page) {
  // A Node without the Thai table would refuse every file Excel saved on a Thai Windows.
  let thai = '';
  try { thai = new PageTextDecoder('windows-874').decode(new Uint8Array([0xA1, 0x80, 0xDB])); } catch { /* no such table */ }
  if (thai !== '\u0E01\u20AC\uFFFD') {
    throw new Halt(EXIT.page, ['This Node does not read the Thai Windows code page (windows-874) as the browser does.',
      'Nothing was read or sent. Run this with a Node that has full ICU.']);
  }
  const R = newReader(page);
  for (const f of ['nh', 'decodeFile', 'parseCsv', 'autoMap', 'monthFirst', 'rowFor', 'ciRead', 'ciBatches']) {
    if (typeof R[f] !== 'function') throw pageError(f, 'is no longer a function');
  }
  for (const k of KINDS) {
    const K = R.CI_KINDS[k];
    if (!K || !Array.isArray(K.need) || !K.fields || typeof K.fields !== 'object') throw pageError('CI_KINDS', `has no "${k}" with need and fields`);
    if (!R.CI_DATES || !Array.isArray(R.CI_DATES[k])) throw pageError('CI_DATES', `has no list of date fields for "${k}"`);
  }
  if (!R.SLASHED || typeof R.SLASHED.exec !== 'function') throw pageError('SLASHED', 'is no longer a pattern');
  if (!Number.isInteger(R.CI_BATCH) || R.CI_BATCH < 1) throw pageError('CI_BATCH', 'is not a whole number of rows');
  // What this tool relies on: true from ciRead, rows numbered by the file's
  // lines, batches of { first, rows }, the two checks, and CI.mdy. How a cell
  // is read is the page's business and is not checked here.
  let same = true;
  try {
    for (const [kind, lines] of Object.entries(SELF_CHECK)) {
      const T = newReader(page);
      T.CI.kind = kind;
      const text = T.decodeFile(exactBytes(Buffer.from('\uFEFF' + lines.join('\r\n') + '\r\n')));
      const read = T.ciRead(text), b = T.ciBatches(), need = T.ciNeeds(), n = lines.length - 1;
      same = same && read === true && T.CI.headRow === 1 && T.CI.rows.length === n && T.CI.rows[0].n === 2
        && Array.isArray(T.CI.heads) && typeof T.CI.mdy.has === 'function' && Array.isArray(need.miss) && !need.miss.length && need.noWho === false
        && b.length === 1 && b[0].first === 2 && Array.isArray(b[0].rows) && b[0].rows.length === n
        && b[0].rows.every(o => o && typeof o === 'object' && typeof o.name === 'string') && typeof T.rowFor(T.CI.rows[0]) === 'object';
    }
    same = same && R.nh('Issued On') === 'issuedon';
  } catch (e) { throw pageError('the import code', `did not run on a test line (${e.name}: ${e.message})`); }
  if (!same) throw pageError('the import code', 'works another way than this tool expects');
}
// One made-up file per kind, under Rezerv's headings, so every piece runs once at start-up.
const SELF_CHECK = {
  members: ['CustomerName,MobileCode,Mobile,Email,RezervPass ID,JoinedDate', '"Check, Self",66,0800000000,self.check@example.com,1,15/03/24 07:12'],
  passes: ['First_Name,Last_Name,Email,Membership,Status,Start_Date,Expiration_Date', 'Self,Check,self.check@example.com,1 month,Active,01/03/24,31/03/24'],
  payments: ['Paid On,Issued On,CustomerName,MobileCode,Mobile,Paid Amount', '03/15/2024 05:42:10,03/15/2024,Self Check,66,0800000000,100',
    '03/15/2024 05:42:10,03/15/2024,Self Check,66,0800000000,100'],
  visits: ['Date of service,Start time,Customer,Email address,Status', '15/03/2024,05:30 AM,Self Check,self.check@example.com,Completed'],
};

// ── one file, read as the page reads it ────────────────────────────────────
// The page's own refusals (ciPick, ciRead, and the lines above its Check button).
const REFUSED = {
  ciVoidFile: ['void-file', "this is Rezerv's list of voided or refunded payments. They are not money, so there is nothing to import."],
  ciExcel: ['excel-file', 'this is an Excel file. Save it as CSV first.'],
  ciBadFile: ['bad-file', 'this file could not be read.'],
  ciEmpty: ['empty-file', 'no rows found in this file.'],
  ciNeedWho: ['missing-who', 'no column says who the student is (customer id, email, phone or name).'],
};

// Headings with nothing under them, as in a year with no payments: by the
// page's own reading, the last filled line carries the columns this kind needs.
function headOnly(R, text) {
  const filled = R.parseCsv(text).filter(r => r.cells.some(c => c.trim()));
  if (!filled.length || filled.length > 10) return false;
  R.CI.heads = filled[filled.length - 1].cells.map(c => c.trim());
  R.CI.map = R.autoMap(R.CI.kind, R.CI.heads);
  const need = R.ciNeeds();
  return !need.miss.length && !need.noWho;
}
// A payments or visits date column in which no number is over 12: day and
// month cannot be told apart, and the page reads it day first. On the page a
// person sees the first rows before Import; in run-all nobody does.
function bothWays(R) {
  const CI = R.CI, found = [];
  if (CI.kind !== 'payments' && CI.kind !== 'visits') return found;
  for (const f of R.CI_DATES[CI.kind]) {
    if (CI.map[f] == null || CI.mdy.has(f)) continue;
    let seen = 0, over = 0;
    for (const r of CI.rows) {
      const m = String(r.cells[CI.map[f]] ?? '').trim().match(R.SLASHED);
      if (!m) continue;
      seen++;
      if (+m[1] > 12 || +m[3] > 12) over++;
    }
    if (seen && !over) found.push(f);
  }
  return found;
}

function readCsv(page, kind, file, pastAttended) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { throw new Halt(EXIT.usage, [`Cannot read the file ${file} (${e.code || 'error'}).`]); }
  const R = newReader(page), CI = R.CI;
  CI.kind = kind; CI.file = path.basename(file); CI.pastBooked = kind === 'visits' && !!pastAttended;
  const job = { file, name: CI.file, kind, R, refused: null, sha: crypto.createHash('sha256').update(buf).digest('hex') };
  const refuse = (rule, text) => { job.refused = { rule, text }; return job; };
  let text;
  try { text = R.decodeFile(exactBytes(buf)); } catch { return refuse(...REFUSED.ciBadFile); }
  if (text == null) return refuse(...REFUSED.ciExcel);
  const read = R.ciRead(text);
  if (read === 'ciEmpty') job.headOnly = headOnly(R, text);
  if (read !== true) return refuse(...(has(REFUSED, read) ? REFUSED[read] : ['refused-by-the-page', 'the admin page would not take this file.']));
  const need = R.ciNeeds();
  // Our own field names, never the file's headings.
  if (need.miss.length) return refuse('missing-columns', `no column found for: ${need.miss.join(', ')}.`);
  if (need.noWho) return refuse(...REFUSED.ciNeedWho);
  job.rows = CI.rows.length;
  job.headRow = CI.headRow;
  job.batches = R.ciBatches();
  job.monthFirst = [...CI.mdy];
  job.rezervPay = CI.heads.some(h => R.nh(h) === 'issuedon');
  // What a person would see in the page's five-row preview, and nobody sees here.
  job.garbled = text.includes('\uFFFD');
  job.oddCells = [];
  for (const r of CI.rows) {
    r.cells.forEach((c, i) => { if (c.length > LONG_CELL || /[\r\n]/.test(c)) job.oddCells.push({ row: r.n, column: i + 1 }); });
  }
  job.bothWays = bothWays(R);
  return job;
}

// ── a public repository ────────────────────────────────────────────────────
// A file that names students may sit inside a git folder only where git
// ignores it. Where that cannot be told, it may not.
function gitWouldTakeIt(file) {
  const abs = path.resolve(file);
  let dir = path.dirname(abs);
  try { dir = fs.realpathSync(dir); } catch { /* not made yet */ }
  let top = dir;
  while (!fs.existsSync(path.join(top, '.git'))) {
    if (path.dirname(top) === top) return false;
    top = path.dirname(top);
  }
  return spawnSync('git', ['-C', top, 'check-ignore', '-q', '--', path.join(dir, path.basename(abs))], { stdio: 'ignore' }).status !== 0;
}
function keepOutOfGit(file) {
  if (!gitWouldTakeIt(file)) return;
  throw new Halt(EXIT.usage, [`${file}: this is inside a git repository, and git does not ignore it.`,
    'Exports and details files name students, and this repository is public. Keep them outside the repository,',
    'or in a folder git ignores (rezerv-export/). Nothing was read or sent.']);
}

// ── sending ────────────────────────────────────────────────────────────────
const bareHost = h => h.replace(/^\[|\]$/g, '').toLowerCase();
const isLoopback = h => { h = bareHost(h); return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h); };
function inCidr(host, cidr) {
  const [range, bits] = cidr.split('/');
  if (net.isIP(host) !== 4 || net.isIP(range) !== 4 || !/^\d+$/.test(bits) || +bits > 32) return false;
  const n = ip => ip.split('.').reduce((a, x) => (a * 256 + +x) >>> 0, 0);
  const mask = +bits === 0 ? 0 : (0xFFFFFFFF << (32 - +bits)) >>> 0;
  return ((n(host) & mask) >>> 0) === ((n(range) & mask) >>> 0);
}
// The operator's network adds the admin key at its HTTPS proxy, so an https
// address goes through HTTPS_PROXY. Node's own fetch would go round it.
function proxyFor(u) {
  if (u.protocol !== 'https:' || isLoopback(u.hostname)) return null;
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy || '';
  if (!raw) return null;
  const host = bareHost(u.hostname);
  const skip = (process.env.NO_PROXY || process.env.no_proxy || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const off = skip.some(e => {
    if (e === '*') return true;
    if (e.includes('/')) return inCidr(host, e);
    const d = e.replace(/^\*?\./, '');
    return host === d || host.endsWith('.' + d);
  });
  if (off) return null;
  try { return new URL(raw); } catch { return null; }
}

function post(u, payload, headers) {
  return new Promise((resolve, reject) => {
    let done = false, req = null, tunnel = null;
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); if (err) reject(err); else resolve(val); };
    const timer = setTimeout(() => {
      const e = Object.assign(new Error('timeout'), { kind: 'timeout' });
      finish(e);
      for (const r of [tunnel, req]) if (r) r.destroy();
    }, TIMEOUT_MS);
    const secure = u.protocol === 'https:', host = bareHost(u.hostname), port = Number(u.port) || (secure ? 443 : 80);
    const go = socket => {
      // Called from the tunnel's event too, where a throw would reach nobody.
      try {
        // Host as a browser sends it: without the port when it is the usual one.
        const o = { method: 'POST', host, port, path: u.pathname + u.search, headers: { Host: u.host, ...headers } };
        // A request with its own connection takes no agent. The certificate is
        // held to the host asked for, a number included, never to the proxy's.
        if (socket) o.createConnection = () => tls.connect({ socket, host, servername: net.isIP(host) ? undefined : host });
        else o.agent = false;
        req = (secure ? https : http).request(o, res => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('error', finish);
          res.on('end', () => finish(null, { status: res.statusCode, location: res.headers.location, text: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', finish);
        req.end(payload);
      } catch (e) {
        if (socket) socket.destroy();
        finish(e);
      }
    };
    const proxy = proxyFor(u);
    if (!proxy) return go(null);
    const viaTls = proxy.protocol === 'https:', target = `${host}:${port}`, ph = { Host: target };
    if (proxy.username) {
      ph['Proxy-Authorization'] = 'Basic '
        + Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64');
    }
    tunnel = (viaTls ? https : http).request({ host: bareHost(proxy.hostname), port: Number(proxy.port) || (viaTls ? 443 : 80),
      method: 'CONNECT', path: target, headers: ph, agent: false });
    tunnel.on('error', finish);
    tunnel.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); return finish(Object.assign(new Error('proxy'), { kind: 'proxy', status: res.statusCode })); }
      if (done) return socket.destroy();
      go(socket);
    });
    tunnel.end();
  });
}
// Why a batch got no answer, in our own words: never the server's.
const netWhy = e => e.kind === 'timeout' ? `no answer in ${TIMEOUT_MS >= 1000 ? `${Math.round(TIMEOUT_MS / 1000)} seconds` : `${TIMEOUT_MS} ms`}`
  : e.kind === 'proxy' ? `the network proxy answered ${Number(e.status) || '?'}`
  : `network error${/^[A-Z][A-Z0-9_]*$/.test(e.code || '') ? ' ' + e.code : ''}`;
// A redirect is never followed: the network adds the admin key for one host,
// and the rows would go wherever the answer points.
function moved(status, location, base) {
  let to = null;
  try { to = new URL(location, base).origin.toLowerCase(); } catch { /* no address in the answer */ }
  if (!to || to === base || !/^https?:\/\/[a-z0-9.-]+(:\d+)?$/.test(to)) {
    return { why: `HTTP ${status}: the server moved this address`, hint: 'This tool does not follow a redirect. The import must answer at the address in --base.' };
  }
  return { why: `HTTP ${status}: the server moved this address to ${to}`,
    hint: `This tool does not follow a redirect. If ${to} is the right server, give it with --base.` };
}

// One batch, as the page's ciRun posts it. The key goes along only when it is
// in the environment (local tests); otherwise the network adds it.
function sendBatch(cfg, job, b, dry) {
  const body = JSON.stringify({ rows: b.rows, dryRun: dry, firstRow: b.first,
    ...(job.kind === 'visits' && job.R.CI.pastBooked ? { pastBookedAttended: true } : {}) });
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
  if (process.env.BKK_ADMIN_KEY) headers['x-bkk-key'] = process.env.BKK_ADMIN_KEY;
  return post(new URL('/api/bkk/admin/import/' + job.kind, cfg.base), body, headers);
}

// Check (dry) or save, every batch in turn, summed as the page sums them. A
// batch that fails stops the run: what came before it is saved, and running
// again adds nothing twice.
async function runBatches(cfg, job, dry) {
  const sum = { dry, total: 0, added: 0, matched: 0, updated: 0, newMembers: 0, skipped: [], warnings: [], pastBooked: 0,
    batches: job.batches.length, done: 0, stopped: null };
  for (const b of job.batches) {
    if (interrupted) { sum.stopped = { row: b.first, why: 'interrupted', interrupted: true }; break; }
    let r;
    // No answer to a save says nothing about whether the server finished it.
    try { r = await sendBatch(cfg, job, b, dry); } catch (e) {
      sum.stopped = { row: b.first, why: netWhy(e), unsure: !dry && e.kind !== 'proxy' };
      break;
    }
    let j = {};
    try { j = JSON.parse(r.text) || {}; } catch { /* not JSON: an error page */ }
    if (r.status >= 300 && r.status <= 399) { sum.stopped = { row: b.first, status: r.status, ...moved(r.status, r.location, cfg.base) }; break; }
    if (r.status < 200 || r.status > 299) {
      sum.stopped = { row: b.first, status: r.status, why: `HTTP ${r.status}`, error: typeof j.error === 'string' ? j.error : null };
      break;
    }
    // An answer that is not this batch's result (a login page, another site),
    // or whose counts do not add up to its rows, is no result.
    const whole = x => Number.isInteger(x) && x >= 0;
    if (j.dryRun !== dry || j.total !== b.rows.length || !Array.isArray(j.skipped) || !Array.isArray(j.warnings)
      || ![j.added, j.matched, j.updated].every(whole) || j.added + j.matched + j.updated + j.skipped.length !== j.total) {
      sum.stopped = { row: b.first, why: 'the answer was not an import result', unsure: !dry };
      break;
    }
    const row = x => x && typeof x === 'object' ? x : { text: String(x) };
    for (const x of ['total', 'added', 'matched', 'updated', 'newMembers']) sum[x] += Number(j[x]) || 0;
    sum.skipped.push(...j.skipped.map(row));
    for (const w of j.warnings.map(row)) {
      if (w.row == null && w.code === 'pastBooked') sum.pastBooked += Number((w.vals || [])[0]) || 0; else sum.warnings.push(w);
    }
    sum.done++;
  }
  return sum;
}

// ── which rows are fine, and which need a person ───────────────────────────
// Every reason the server can give for skipping a row (IMPORT_EN and the four
// importers in bkk-api.js), for each kind that can give it. 'ok': the row holds
// nothing to keep, as designed. 'ask': run-all saves nothing of that file
// until a person has looked. A code that is not here always stops.
const WHO_CODES = { excelId: 'ask', noWho: 'ask', notFound: 'ask', sharePhone: 'ask', sameName: 'ask',
  clashEmail: 'ask', clashPhone: 'ask', clashOtherEmail: 'ask' };
const SKIP_CODES = {
  members: { excelId: 'ask', noName: 'ask', sharePhone: 'ask', sameName: 'ask', duplicate: 'ask' },
  passes: { ...WHO_CODES, neverStarted: 'ok',
    // "A workshop, or not understood": only a person can tell which.
    badPlan: 'ask', badUntil: 'ask', badStart: 'ask', startsAfterEnd: 'ask', noPackage: 'ask', badLeft: 'ask',
    idReused: 'ask', duplicate: 'ask' },
  payments: { ...WHO_CODES, notMoney: 'ok', badDate: 'ask', badAmount: 'ask', payStatus: 'ask', idReused: 'ask', duplicate: 'ask' },
  visits: { ...WHO_CODES, waitlist: 'ok', badDate: 'ask', badTime: 'ask', badStatus: 'ask',
    // A booking still to come that found no seat here: the student must hear of it.
    noSlot: 'ask', moonDay: 'ask', classOff: 'ask', idReused: 'ask', duplicate: 'ask' },
};
// What the server can say next to a row it kept. 'note': counted, and the text
// is in the details file. 'ask': a value was guessed or dropped and importing
// again will not put it right, so run-all saves nothing of that file until a
// person has looked. A code that is not here always stops.
const WARN_CODES = {
  newStudent: 'note', pastBooked: 'note', payVoided: 'note', passOff: 'note', freezeLater: 'note', notEmail: 'note', badJoined: 'note',
  badCheckIn: 'note', overCap: 'note', emailTaken: 'note', keepsEmail: 'note', keepsRezervId: 'note', keptHere: 'note', cameDoor: 'note',
  // A student made next to one who holds that email, phone or name: the server's rule, never a merge.
  clashEmail: 'note', clashPhone: 'note', clashOtherEmail: 'note',
  passStatus: 'ask', badVat: 'ask', badFreeze: 'ask', leftOver: 'ask',
};
const NO_CODE = '(no code)', UNKNOWN_CODE = '(unknown code)';
const OWN_CODES = new Set([...KINDS.flatMap(k => Object.keys(SKIP_CODES[k])), ...Object.keys(WARN_CODES)]);
// Only a code from the tables above is printed. Any other word from the server is not.
const codeOf = x => !x || typeof x.code !== 'string' || !x.code ? NO_CODE : OWN_CODES.has(x.code) ? x.code : UNKNOWN_CODE;
// A pack paid for and not started yet has no dates in Rezerv ("--"). The
// server answers badUntil with that value and does not bring the pack over.
const notStarted = (kind, x) => kind === 'passes' && !!x && x.code === 'badUntil'
  && /^-*$/.test(String((Array.isArray(x.vals) ? x.vals[0] : '') ?? '').trim());
const skipClass = (kind, x) => notStarted(kind, x) ? 'later' : has(SKIP_CODES[kind], codeOf(x)) ? SKIP_CODES[kind][codeOf(x)] : 'unknown';
const warnClass = w => has(WARN_CODES, codeOf(w)) ? WARN_CODES[codeOf(w)] : 'unknown';
function tally(list, classOf) {
  const m = new Map();
  for (const x of list) {
    const code = codeOf(x), cls = classOf(x), k = `${code} ${cls}`;
    m.set(k, { code, cls, n: (m.has(k) ? m.get(k).n : 0) + 1 });
  }
  return [...m.values()].sort((a, b) => a.code.localeCompare(b.code) || a.cls.localeCompare(b.cls));
}
const SAYS = { ok: 'expected: nothing to keep', later: 'a pack bought and not started yet: not brought over', ask: 'a person must look',
  unknown: 'not known to this tool: a person must look' };

// Why run-all may not save this file after its check: every reason, or none when it is clean.
function gate(job, sum) {
  if (sum.stopped) return [{ rule: 'failed-batch', text: `a batch failed at row ${sum.stopped.row} (${sum.stopped.why})` }];
  const g = [], add = (rule, text) => g.push({ rule, text });
  if (job.garbled) add('unreadable-characters', 'the file is not UTF-8, UTF-16 or Thai Windows text, so some of its letters could not be read');
  if (job.oddCells.length) {
    add('cells-to-look-at', `${job.oddCells.length} ${job.oddCells.length === 1 ? 'cell holds' : 'cells hold'} a line break or more than `
      + `${LONG_CELL} characters, as a quote that never closes would`);
  }
  if (job.kind === 'payments' && job.rezervPay && !job.monthFirst.includes('date')) {
    add('paid-on-not-month-first', 'the file has an "Issued On" column, but its payment dates were not read month first');
  }
  if (job.bothWays.length) {
    add('dates-read-both-ways', `no date in ${job.bothWays.join(', ')} has a number over 12, so day and month cannot be told apart: they were read day first`);
  }
  const list = (by, cls) => by.filter(x => x.cls === cls).map(x => `${x.code} ${x.n}`).join(', ');
  const skips = tally(sum.skipped, x => skipClass(job.kind, x)), notes = tally(sum.warnings, warnClass);
  if (list(skips, 'unknown')) add('unknown-skip-code', `rows were skipped for a reason this tool does not know: ${list(skips, 'unknown')}`);
  if (list(skips, 'ask')) add('skip-code-needs-a-person', `rows were skipped for a reason a person must look at: ${list(skips, 'ask')}`);
  if (list(notes, 'unknown')) add('unknown-warning-code', `rows were kept with a note this tool does not know: ${list(notes, 'unknown')}`);
  if (list(notes, 'ask')) {
    add('warning-needs-a-person', `rows were kept with a value guessed or left out, which importing again does not put right: ${list(notes, 'ask')}`);
  }
  return g;
}

// ── what is printed: counts and codes, nothing else ────────────────────────
const countsLine = sum => `rows ${sum.total}, added ${sum.added}, already there ${sum.matched}, updated ${sum.updated}, `
  + `new students ${sum.newMembers}, skipped ${sum.skipped.length}`;
const five = sum => [sum.total, sum.added, sum.matched, sum.updated, sum.skipped.length].join(':');
// What a check stood on, in one word a person hands to write: the counts, then
// a mark of the server, the kind, the past-attended choice, the file's bytes
// and every skip and note code. Any of it changed, and write saves nothing.
function expectOf(cfg, job, sum) {
  const codes = list => {
    const m = {};
    for (const x of list) { const c = x && typeof x.code === 'string' ? x.code : ''; m[c] = (m[c] || 0) + 1; }
    return Object.entries(m).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  };
  const mark = crypto.createHash('sha256').update(JSON.stringify([cfg.base, job.kind, !!job.R.CI.pastBooked, job.sha,
    codes(sum.skipped), codes(sum.warnings), sum.pastBooked])).digest('hex').slice(0, 12);
  return `${five(sum)}:${sum.newMembers}:${mark}`;
}
const EXPECT = /^\d+(:\d+){5}:[0-9a-f]{12}$/;
const stoppedLine = sum => `Stopped at row ${sum.stopped.row} (${sum.stopped.why}). ` + (sum.dry ? 'Nothing was saved.'
  : sum.stopped.unsure ? 'The batch at that row may or may not be saved; the rows before it are saved. Run check to see: nothing is added twice.'
  : sum.stopped.interrupted ? 'Rows before it are saved. Run it again to finish: nothing is added twice.'
  : 'Rows before it are saved. Fix it and run again: nothing is added twice.');
const UNAUTHORISED = 'Not authorised. Run this where the admin key is added by the network.';
const is401 = sum => !!sum.stopped && sum.stopped.status === 401;
const laterCount = (job, sum) => sum.skipped.filter(x => notStarted(job.kind, x)).length;

function printHead(job) {
  out(`File: ${job.name}`);
  out(`Kind: ${job.kind}`);
}
function printRead(job) {
  out(`  Rows in the file: ${job.rows} (headings on row ${job.headRow}), in ${job.batches.length} ${job.batches.length === 1 ? 'batch' : 'batches'}`);
  if (job.kind === 'payments' || job.monthFirst.length) out(`  Dates read month first: ${job.monthFirst.join(', ') || 'none'}`);
  if (job.kind === 'visits') out(`  Past bookings counted as attended: ${job.R.CI.pastBooked ? 'yes' : 'no'}`);
}
function printResult(job, sum) {
  out(sum.dry ? 'Check (nothing saved):' : 'Saved:');
  out(`  Rows: ${sum.total}${sum.stopped ? ` of ${job.rows}` : ''}`);
  out(`  Added: ${sum.added}`);
  out(`  Already there: ${sum.matched}`);
  out(`  Updated: ${sum.updated}`);
  out(`  New students: ${sum.newMembers}`);
  out(`  Skipped: ${sum.skipped.length}`);
  for (const t of tally(sum.skipped, x => skipClass(job.kind, x))) out(`    ${t.code}: ${t.n} (${SAYS[t.cls]})`);
  out(`  Warnings: ${sum.warnings.length}`);
  for (const t of tally(sum.warnings, warnClass)) out(`    ${t.code}: ${t.n}${t.cls === 'note' ? '' : ` (${SAYS[t.cls]})`}`);
  const later = laterCount(job, sum);
  if (later) out(`  Packs bought and not started yet, not brought over: ${later}. Names are in the details file. Add them by hand.`);
  if (sum.pastBooked) out(`  Past visits still marked booked, not attended: ${sum.pastBooked}. They stay booked and do not count as classes practised.`);
  if (sum.dry && sum.batches > 1 && sum.newMembers) {
    out('  Note: a check looks at each batch on its own, so a student made in an earlier batch shows as new again. Saving does not do this.');
  }
  if (sum.stopped && !is401(sum)) {
    out(`  Batches ${sum.dry ? 'checked' : 'saved'}: ${sum.done} of ${sum.batches}`);
    out(`  ${stoppedLine(sum)}`);
    if (sum.stopped.hint) out(`  ${sum.stopped.hint}`);
  }
}

// The full skipped rows and notes, with each row's name and email as the page
// sends them: for a person, in a file only its owner can read.
function writeDetails(file, job, runs) {
  const rows = new Map(job.R ? job.R.CI.rows.map(r => [r.n, r]) : []);
  const person = n => {
    const r = rows.get(n);
    if (!r) return { name: null, email: null };
    const o = job.R.rowFor(r);
    return { name: o.name ?? null, email: o.email ?? null };
  };
  const part = sum => sum && {
    rows: sum.total, added: sum.added, alreadyThere: sum.matched, updated: sum.updated, newStudents: sum.newMembers,
    pastBooked: sum.pastBooked, batchesDone: sum.done, batches: sum.batches, stopped: sum.stopped,
    skipped: sum.skipped.map(x => ({ ...x, ...person(x.row) })),
    warnings: sum.warnings.map(w => ({ ...w, ...person(w.row) })),
  };
  const data = { file: job.name, kind: job.kind, writtenAt: new Date().toISOString(), refused: job.refused,
    lookAt: job.refused ? null : { unreadableCharacters: job.garbled, datesReadBothWays: job.bothWays, cells: job.oddCells.slice(0, 200) },
    check: part(runs.check) || null, saved: part(runs.saved) || null };
  try { writePrivate(file, JSON.stringify(data, null, 2) + '\n'); } catch (e) {
    process.stderr.write(`The details file could not be written (${e.code || 'error'}): ${file}\n`);
    return;
  }
  out(`Details: ${file}`);
}
// Made new each time, so the mode is ours whatever stood there before.
function writePrivate(file, text) {
  fs.rmSync(file, { force: true });
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.fchmodSync(fd, 0o600); fs.writeSync(fd, text); } finally { fs.closeSync(fd); }
}
// A details file that cannot be written is found out before anything is sent.
function reserveDetails(file) {
  try { writePrivate(file, ''); } catch (e) { throw new Halt(EXIT.usage, [`Cannot write the details file ${file} (${e.code || 'error'}).`]); }
}

// ── check, write ───────────────────────────────────────────────────────────
function openFile(page, kind, file, opt) {
  const job = readCsv(page, kind, file, opt.pastAttended);
  printHead(job);
  if (job.refused) throw new Halt(EXIT.stopped, [`Refused (${job.refused.rule}): ${job.refused.text}`, 'Nothing was sent.']);
  if (opt.details) reserveDetails(opt.details);
  printRead(job);
  return job;
}
const baseFlag = cfg => cfg.base === DEFAULT_BASE ? '' : ` --base ${cfg.base}`;
const pastFlag = job => job.R.CI.pastBooked ? ' --past-attended' : '';
const checkCmd = (cfg, job) => `  ${SELF} check ${job.kind} ${shq(job.file)}${baseFlag(cfg)}${pastFlag(job)}`;
const writeCmd = (cfg, job, sum) => `  ${SELF} write ${job.kind} ${shq(job.file)} --expect "${expectOf(cfg, job, sum)}"${baseFlag(cfg)}${pastFlag(job)}`;

async function cmdCheck(page, cfg, kind, file, opt) {
  const job = openFile(page, kind, file, opt);
  const check = await runBatches(cfg, job, true);
  printResult(job, check);
  if (opt.details) writeDetails(opt.details, job, { check });
  if (is401(check)) throw new Halt(EXIT.auth, [UNAUTHORISED]);
  if (check.stopped) return EXIT.stopped;
  const g = gate(job, check);
  if (!g.length) out('For run-all: clean.');
  for (const x of g) out(`For run-all: it would stop here (${x.rule}): ${x.text}.`);
  out('To save these rows:');
  out(writeCmd(cfg, job, check));
  return EXIT.ok;
}

async function cmdWrite(page, cfg, kind, file, opt) {
  const job = openFile(page, kind, file, opt);
  const check = await runBatches(cfg, job, true);
  printResult(job, check);
  const runs = { check };
  const leave = (code, lines) => { if (opt.details) writeDetails(opt.details, job, runs); throw new Halt(code, lines); };
  if (is401(check)) leave(EXIT.auth, [UNAUTHORISED]);
  if (check.stopped) leave(EXIT.stopped, ['The check did not finish, so nothing was saved.']);
  const now = expectOf(cfg, job, check);
  if (now !== opt.expect) {
    leave(EXIT.stopped, [`The check gives "${now}", not the "${opt.expect}" in --expect.`,
      'The file, a flag, the server, or what the server holds is not what that check saw. Nothing was saved.']);
  }
  if (interrupted) leave(EXIT.stopped, ['Interrupted before saving. Nothing was saved.']);
  out('The check matches --expect. Saving.');
  runs.saved = await runBatches(cfg, job, false);
  printResult(job, runs.saved);
  if (is401(runs.saved)) leave(EXIT.auth, [UNAUTHORISED]);
  if (runs.saved.stopped) {
    const st = runs.saved.stopped;
    leave(EXIT.stopped, [st.unsure ? 'It is not known whether every row was saved.' : st.interrupted ? 'Interrupted: not every row was saved.'
      : 'Not every row was saved.', 'To see where it stands and to finish, check again and use the write it prints (nothing is added twice):',
    checkCmd(cfg, job)]);
  }
  if (five(runs.saved) !== five(check)) out('Note: the saved counts are not the check\'s counts.');
  if (opt.details) writeDetails(opt.details, job, runs);
  return EXIT.ok;
}

// ── plan, run-all ──────────────────────────────────────────────────────────
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// Where in its year a part file starts: "-jan-jun", "-07-12", "-q3", "-h2",
// "-part2". 0 for a whole year, which goes first.
function partOrder(rest) {
  const m = rest.match(/(?:^|[^a-z])(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
  if (m) return MONTHS.indexOf(m[1]) + 1;
  const p = rest.match(/(?:^|[^a-z0-9])(?:q([1-4])|h([12])|(?:part|p)[-_ ]?(\d{1,2}))(?![a-z0-9])/);
  if (p) return p[1] ? (p[1] - 1) * 3 + 1 : p[2] ? (p[2] - 1) * 6 + 1 : +p[3];
  const d = rest.match(/(?:^|[^0-9])(\d{1,2})(?![0-9])/);
  return d && +d[1] >= 1 && +d[1] <= 12 ? +d[1] : 0;
}
const NAMED = [
  [/^rezerv-students(-.*)?\.csv$/, 'members', 1],
  [/^rezerv-passes-memberships(-.*)?\.csv$/, 'passes', 2],
  [/^rezerv-passes-packages(-.*)?\.csv$/, 'passes', 3],
  [/^rezerv-payments-(\d{4})(.*)\.csv$/, 'payments', 4],
  [/^rezerv-visits-upcoming(-.*)?\.csv$/, 'visits', 6],
  [/^rezerv-visits-(\d{4})(.*)\.csv$/, 'visits', 5],
];
const EXPECTED = ['rezerv-students-*.csv', 'rezerv-passes-memberships-*.csv', 'rezerv-passes-packages-*.csv', 'rezerv-payments-<year>*.csv',
  'rezerv-visits-<year>*.csv', 'rezerv-visits-upcoming-*.csv'];
const NEVER = ['voided', 'refunded', 'class-attendance'];
// A file name can carry a student's name or email. Only a name made of these is ever printed, or read as an export.
const PLAIN_NAME = /^[A-Za-z0-9._\- ()[\]]+$/;
const namedStep = name => {
  const low = name.toLowerCase();
  if (!low.startsWith('rezerv-') || !PLAIN_NAME.test(name) || NEVER.some(w => low.includes(w))) return null;
  return NAMED.map(([re, kind, group]) => ({ m: low.match(re), kind, group })).find(x => x.m) || null;
};
function planDir(dir) {
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isFile()).map(d => d.name); }
  catch (e) { throw new Halt(EXIT.usage, [`Cannot read the folder ${dir} (${e.code || 'error'}).`]); }
  const steps = [], ignored = [];
  let others = 0, unnamed = 0;
  for (const name of names.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) {
    const low = name.toLowerCase();
    if (!low.startsWith('rezerv-')) { others++; continue; }
    if (!PLAIN_NAME.test(name)) { unnamed++; continue; }
    const never = NEVER.find(w => low.includes(w));
    if (never) { ignored.push([name, `its name says ${never}`]); continue; }
    const hit = namedStep(name);
    if (!hit) { ignored.push([name, 'its name is not one this tool knows']); continue; }
    const yearly = hit.group === 4 || hit.group === 5;
    steps.push({ name, kind: hit.kind, group: hit.group, year: yearly ? +hit.m[1] : 0, part: yearly ? partOrder(hit.m[2]) : 0 });
  }
  steps.sort((a, b) => a.group - b.group || a.year - b.year || a.part - b.part || a.name.localeCompare(b.name, 'en', { numeric: true }));
  return { dir, steps, ignored, others, unnamed, missing: EXPECTED.filter((_, i) => !steps.some(x => x.group === i + 1)) };
}
function printPlan(plan) {
  out(`Folder: ${plan.dir}`);
  out(`Import order (${files(plan.steps.length)}):`);
  plan.steps.forEach((s, i) => out(`  ${String(i + 1).padStart(2)}. ${s.kind.padEnd(8)} ${s.name}`));
  if (!plan.steps.length) out('  (none)');
  out(`Ignored (${plan.ignored.length + plan.unnamed + plan.others}):`);
  for (const [name, why] of plan.ignored) out(`  - ${name}: ${why}`);
  if (plan.unnamed) {
    out(`  - ${files(plan.unnamed)} starting with rezerv-, not named here: the name holds more than letters, digits, dots, dashes, `
      + 'underscores, spaces and brackets. Rename it if it is an export.');
  }
  if (plan.others) out(`  - ${plan.others} other ${plan.others === 1 ? 'file' : 'files'}: the name does not start with rezerv-`);
  if (!plan.ignored.length && !plan.unnamed && !plan.others) out('  (none)');
  if (plan.missing.length) out(`Not in this folder: ${plan.missing.join(', ')}`);
}
const guardPlan = (plan, detFile) => {
  for (const s of plan.steps) {
    keepOutOfGit(path.join(plan.dir, s.name));
    if (detFile) keepOutOfGit(detFile(s));
  }
};

const detFileOf = opt => opt.detailsDir ? step => path.join(opt.detailsDir, `${step.name}.details.json`) : null;

async function cmdRunAll(page, cfg, plan, opt) {
  const dir = plan.dir, detFile = detFileOf(opt);
  printPlan(plan);
  const n = plan.steps.length, save = !!opt.save;
  if (!n) throw new Halt(EXIT.stopped, ['No file to import in this folder.']);
  let from = 1;
  if (opt.fromStep) {
    from = opt.fromStep.n;
    if (from > n) throw usage(`--from-step ${from}: this folder has ${n} steps.`);
    if (plan.steps[from - 1].name !== opt.fromStep.name) {
      throw usage(`--from-step: step ${from} of this folder is ${plan.steps[from - 1].name}, not the file named. The folder has changed: read the plan above.`);
    }
  }
  if (opt.detailsDir) {
    try { fs.mkdirSync(opt.detailsDir, { recursive: true, mode: 0o700 }); fs.accessSync(opt.detailsDir, fs.constants.W_OK); }
    catch (e) { throw new Halt(EXIT.usage, [`Cannot write in the details folder ${opt.detailsDir} (${e.code || 'error'}).`]); }
  }
  const flags = `${opt.pastAttended ? ' --past-attended' : ''}${baseFlag(cfg)}${opt.detailsDir ? ` --details-dir ${shq(opt.detailsDir)}` : ''}`;
  // A step is named with its file, so the command means nothing else once the folder changes.
  const again = (k, saving) => `  ${SELF} run-all ${shq(dir)}${saving ? ' --save' : ''}`
    + `${k > 1 ? ` --from-step ${shq(`${k}:${plan.steps[k - 1].name}`)}` : ''}${flags}`;
  out('');
  out(save ? 'Saving: each file is checked, then saved.' : 'Looking only: every file is checked and nothing is saved. To save, add --save.');
  if (from > 1) out(`Starting at step ${from}: steps 1 to ${from - 1} are left alone.`);
  const wouldStop = [], byHand = [];
  // Without the students list, every payment and visit makes a student of the name on its row.
  if (from === 1 && !plan.steps.some(s => s.group === 1)) {
    const text = 'no students file (rezerv-students-*.csv) in this folder, so payments and visits would make a new student of every name they carry';
    if (save) {
      throw new Halt(EXIT.stopped, ['', 'STOPPED before step 1.', `Rule: no-students-file: ${text}.`, 'Nothing was sent.',
        'Add the students export and run again, or import the files one at a time with check and write.']);
    }
    out(`Would stop before step 1 (no-students-file): ${text}.`);
    wouldStop.push('before step 1 (no-students-file)');
  }
  let saved = 0, past = 0;
  for (let i = from - 1; i < n; i++) {
    const step = plan.steps[i], file = path.join(dir, step.name);
    out('');
    out(`Step ${i + 1} of ${n}`);
    const job = readCsv(page, step.kind, file, opt.pastAttended);
    printHead(job);
    const runs = {};
    const details = () => { if (detFile) writeDetails(detFile(step), job, runs); };
    // Which file, which rule, the counts, and what a person does next.
    const stop = (rules, sum, saving) => {
      details();
      const lines = ['', `STOPPED at step ${i + 1} of ${n}: ${step.name} (${step.kind})`, ...rules.map(g => `Rule: ${g.rule}: ${g.text}.`)];
      if (sum) lines.push(`Counts: ${countsLine(sum)}.`);
      const st = sum && sum.stopped, broke = !sum || !!st;
      if (st && st.hint) lines.push(st.hint);
      lines.push(!saving ? 'Nothing from this file was saved, and no later file was touched.'
        : st && st.unsure ? 'The batch at that row may or may not be saved; the rows before it are saved. No later file was touched.'
        : broke ? 'The rows before that row are saved. No later file was touched.'
        : 'This file is saved, apart from its skipped rows. No later file was touched.');
      if (broke) {
        lines.push(st && st.unsure ? 'Run this step again to see what was saved and to finish (nothing is added twice):'
          : interrupted ? 'To go on, run this step again (nothing is added twice):'
          : 'When it is fixed, run this step again (nothing is added twice):', again(i + 1, save));
      } else if (!saving) {
        lines.push('When a person has looked at it, either fix the export and run this step again, or save the file as it is:', writeCmd(cfg, job, sum));
        if (i + 1 < n) lines.push('and carry on:', again(i + 2, save));
      } else if (i + 1 < n) lines.push('When a person has looked at it, carry on:', again(i + 2, save));
      throw new Halt(EXIT.stopped, lines);
    };
    const byHandOf = sum => {
      const later = laterCount(job, sum);
      if (later) byHand.push(`Packs bought and not started yet, not brought over: ${later} in ${step.name}. Names are in its details file. Add them by hand.`);
      if (sum.pastBooked) {
        past += sum.pastBooked;
        if (save) {
          byHand.push(`Past classes still marked booked, saved as booked: ${sum.pastBooked} in ${step.name}. To count them as attended later:`,
            `${checkCmd(cfg, job)} --past-attended`, '  and then the write it prints.');
        }
      }
    };
    const halted = [{ rule: 'interrupted', text: 'stopped by hand' }];
    if (interrupted) stop(halted, null, false);
    if (job.refused) {
      // A year with no payments, or no booking still to come, is a whole export. A students list with nobody is not.
      if (job.refused.rule === 'empty-file' && job.headOnly && step.kind !== 'members') {
        out('  No rows in this file: nothing to do.');
        continue;
      }
      const g = [{ rule: `refused (${job.refused.rule})`, text: job.refused.text.replace(/\.$/, '') }];
      if (save) stop(g, null, false);
      details();
      out(`  Would stop here (${g[0].rule}): ${g[0].text}.`);
      wouldStop.push(`step ${i + 1}: ${step.name} (${g[0].rule})`);
      continue;
    }
    printRead(job);
    runs.check = await runBatches(cfg, job, true);
    printResult(job, runs.check);
    if (is401(runs.check)) { details(); throw new Halt(EXIT.auth, [UNAUTHORISED]); }
    const g = gate(job, runs.check);
    // A batch that fails says something about the server or the network, not about this file: a look stops there too.
    if (g.length && (save || runs.check.stopped)) stop(runs.check.stopped && runs.check.stopped.interrupted ? halted : g, runs.check, false);
    if (!save) {
      details();
      for (const x of g) out(`  Would stop here (${x.rule}): ${x.text}.`);
      if (g.length) wouldStop.push(`step ${i + 1}: ${step.name} (${g.map(x => x.rule).join(', ')})`);
      else out('  Clean: with --save this file would be saved.');
      byHandOf(runs.check);
      continue;
    }
    if (interrupted) stop(halted, null, false);
    runs.saved = await runBatches(cfg, job, false);
    printResult(job, runs.saved);
    if (is401(runs.saved)) { details(); throw new Halt(EXIT.auth, [UNAUTHORISED]); }
    const after = gate(job, runs.saved);
    if (after.length) {
      stop(runs.saved.stopped && runs.saved.stopped.interrupted ? halted : after.map(x => ({ rule: `${x.rule} (while saving)`, text: x.text })),
        runs.saved, true);
    }
    details();
    byHandOf(runs.saved);
    saved++;
  }
  out('');
  if (save) out(`Done: ${files(saved)} saved, steps ${from} to ${n} of ${n}.`);
  else {
    out(`Looked at steps ${from} to ${n} of ${n}. Nothing was saved.`);
    out('A look checks each file against what the server holds now. Students, passes and payments in files not saved yet');
    out('are not there, so the later files can show more new students than a real run makes.');
    if (wouldStop.length) {
      out('With --save the run would stop at:');
      for (const w of wouldStop) out(`  ${w}`);
    }
  }
  for (const line of byHand) out(line);
  if (!save) {
    if (past && !opt.pastAttended) {
      out(`Past classes Rezerv still shows as booked: ${past}. Ask the owner once, before saving, whether they count as attended.`);
      out('  Yes: add --past-attended to the save. It cannot be undone. No: they stay booked, and can still be counted later.');
    }
    out('To save:');
    out(again(from, true));
  }
  return !save && wouldStop.length ? EXIT.stopped : EXIT.ok;
}

// ── the command line ───────────────────────────────────────────────────────
const VALUE = { '--base': 'base', '--details': 'details', '--details-dir': 'detailsDir', '--expect': 'expect', '--from-step': 'fromStep' };
const SWITCH = { '--past-attended': 'pastAttended', '--save': 'save' };
const ALLOWED = { check: ['--base', '--past-attended', '--details'], write: ['--base', '--past-attended', '--details', '--expect'],
  plan: [], 'run-all': ['--base', '--save', '--past-attended', '--details-dir', '--from-step'] };
const BASE_HELP = `--base must be ${SERVERS.map(h => 'https://' + h).join(' or ')}, or a test server on this machine`;

function parseArgs(argv) {
  const cmd = argv[0], rest = [], opt = {};
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') return { help: true };
  if (!has(ALLOWED, cmd)) throw usage(`Unknown command: ${cmd}`);
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { rest.push(a); continue; }
    const eq = a.indexOf('='), flag = eq < 0 ? a : a.slice(0, eq);
    if (!ALLOWED[cmd].includes(flag)) throw usage(`${cmd} does not take ${flag}`);
    if (has(SWITCH, flag)) {
      if (eq >= 0) throw usage(`${flag} takes no value`);
      opt[SWITCH[flag]] = true;
      continue;
    }
    const v = eq < 0 ? argv[++i] : a.slice(eq + 1);
    if (v == null || v === '') throw usage(`${flag} needs a value`);
    opt[VALUE[flag]] = v;
  }
  let base;
  try { base = new URL(opt.base || DEFAULT_BASE); } catch { throw usage(BASE_HELP); }
  if (!/^https?:$/.test(base.protocol) || base.username || base.password) throw usage(BASE_HELP);
  // The admin key must never travel in the clear.
  if (base.protocol === 'http:' && !isLoopback(base.hostname)) throw usage('--base with http:// is only for a test server on this machine');
  // Every row, and the key the network adds, goes to --base: one of ours, or this machine.
  const ours = base.protocol === 'https:' && base.port === '' && SERVERS.includes(bareHost(base.hostname));
  const testHost = !ours && !isLoopback(base.hostname);
  if (testHost && process.env.REZERV_IMPORT_TEST_ANY_HOST !== '1') throw usage(BASE_HELP);
  const cfg = { base: base.origin, testHost };
  if (cmd === 'plan' || cmd === 'run-all') {
    if (rest.length !== 1) throw usage(`${cmd} takes one folder`);
    if (opt.fromStep != null) {
      const m = opt.fromStep.match(/^([1-9]\d*):(.+)$/);
      if (!m) throw usage('--from-step takes a step and its file, as run-all prints them: 3:rezerv-visits-2025.csv');
      opt.fromStep = { n: Number(m[1]), name: m[2] };
    }
    return { cmd, cfg, dir: rest[0], opt };
  }
  if (rest.length !== 2) throw usage(`${cmd} takes a kind and one file`);
  if (!KINDS.includes(rest[0])) throw usage(`kind must be one of: ${KINDS.join(', ')}`);
  if (cmd === 'write' && !EXPECT.test(opt.expect || '')) {
    throw usage('write needs --expect "<rows>:<added>:<already there>:<updated>:<skipped>:<new students>:<mark>", as a check of this file printed it');
  }
  if (opt.details) {
    if (path.resolve(opt.details) === path.resolve(rest[1])) throw usage('--details must be another file than the CSV');
    // The details file is made new each time: never over an export, or over a file that is not one of ours.
    if (namedStep(path.basename(opt.details))) throw usage('--details: that name is an export this tool would import. Give another name.');
    if (fs.existsSync(opt.details) && !path.basename(opt.details).endsWith('.details.json')) {
      throw usage('--details: a file is there already and its name does not end in .details.json, so it is not replaced. Give another name.');
    }
  }
  return { cmd, cfg, kind: rest[0], file: rest[1], opt };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) { out(USAGE); return EXIT.ok; }
  if (a.cmd === 'plan') {
    const plan = planDir(a.dir);
    guardPlan(plan, null);
    printPlan(plan);
    return EXIT.ok;
  }
  // Before anything is read: no export and no details file where git would take it.
  let plan = null;
  if (a.cmd === 'run-all') {
    plan = planDir(a.dir);
    guardPlan(plan, detFileOf(a.opt));
  } else {
    keepOutOfGit(a.file);
    if (a.opt.details) keepOutOfGit(a.opt.details);
  }
  const page = loadPage();
  out(`Server: ${a.cfg.base}`);
  if (a.cfg.testHost) out('REZERV_IMPORT_TEST_ANY_HOST is set: this server is not one of ours. For tests only.');
  if (a.cmd === 'check') return cmdCheck(page, a.cfg, a.kind, a.file, a.opt);
  if (a.cmd === 'write') return cmdWrite(page, a.cfg, a.kind, a.file, a.opt);
  return cmdRunAll(page, a.cfg, plan, a.opt);
}

if (require.main === module) {
  const onSignal = () => {
    if (interrupted) {
      process.stderr.write('Stopped at once. A batch that was on its way may or may not be saved: run check to see.\n');
      process.exit(EXIT.stopped);
    }
    interrupted = true;
    process.stderr.write('Interrupted: stopping after the batch that is on its way. Press again to stop at once.\n');
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  // One fixed line: what an error says could quote a row, or a header.
  const lost = () => {
    process.stderr.write('Stopped: unexpected error. A batch that was on its way may or may not be saved: run check to see.\n');
    process.exit(EXIT.stopped);
  };
  process.on('uncaughtException', lost);
  process.on('unhandledRejection', lost);
  const OWN_ERRORS = ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'EvalError', 'URIError', 'AggregateError'];
  main().catch(e => {
    if (e instanceof Halt) { process.stderr.write(e.lines.join('\n') + '\n'); return e.code; }
    // An error of our own making: its class only, as its text could quote a row. A name that is not the engine's own could too.
    const name = e && OWN_ERRORS.includes(e.name) ? e.name : 'error';
    process.stderr.write(`Stopped: unexpected ${name}${e && /^[A-Z][A-Z0-9_]*$/.test(e.code || '') ? ' ' + e.code : ''}.\n`);
    return EXIT.stopped;
  }).then(code => {
    process.exitCode = code;
    process.stdout.write('', () => process.stderr.write('', () => process.exit(code)));
  });
} else module.exports = { SKIP_CODES, WARN_CODES, KINDS, SERVERS, DEFAULT_TIMEOUT_MS };
