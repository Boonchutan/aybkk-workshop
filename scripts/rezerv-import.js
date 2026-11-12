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
 * nowhere else.
 *
 *   node scripts/rezerv-import.js check <kind> <file.csv> [--base URL] [--past-attended] [--details FILE]
 *   node scripts/rezerv-import.js write <kind> <file.csv> --expect "<rows>:<added>:<already there>:<updated>:<skipped>"
 *                                       [--base URL] [--past-attended] [--details FILE]
 *   node scripts/rezerv-import.js plan <dir>
 *   node scripts/rezerv-import.js run-all <dir> [--base URL] [--details-dir DIR] [--from-step N]
 *
 * Exit: 0 done · 1 stopped · 2 wrong use, or a file that cannot be read ·
 *       3 the admin page's import code has changed · 4 not authorised
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const https = require('https');
const tls = require('tls');
const net = require('net');

const KINDS = ['members', 'passes', 'payments', 'visits'];
const DEFAULT_BASE = 'https://aybkk.net';
const SELF = 'node scripts/rezerv-import.js';
const EXIT = { ok: 0, stopped: 1, usage: 2, page: 3, auth: 4 };
// For tests: another copy of the admin page, and a shorter wait for a batch.
const PAGE_FILE = process.env.REZERV_IMPORT_PAGE || path.join(__dirname, '..', 'public', 'bkk-admin.html');
const TIMEOUT_MS = Number(process.env.REZERV_IMPORT_TIMEOUT_MS) > 0 ? Number(process.env.REZERV_IMPORT_TIMEOUT_MS) : 120000;

const USAGE = `Usage:
  ${SELF} check <kind> <file.csv> [--base URL] [--past-attended] [--details FILE]
  ${SELF} write <kind> <file.csv> --expect "<rows>:<added>:<already there>:<updated>:<skipped>"
                                      [--base URL] [--past-attended] [--details FILE]
  ${SELF} plan <dir>
  ${SELF} run-all <dir> [--base URL] [--details-dir DIR] [--from-step N]

  kind: ${KINDS.join(' | ')}        --base: ${DEFAULT_BASE} unless given
  check saves nothing. write runs the same check first and saves only if its counts are the ones in --expect.
  run-all saves each file of the folder in order, and stops at the first one a person must look at.
  Only counts and reason codes are printed. Names stay in the --details file.`;

const out = s => process.stdout.write(s + '\n');
class Halt extends Error {
  constructor(code, lines) { super(lines[0]); this.code = code; this.lines = lines; }
}
const usage = msg => new Halt(EXIT.usage, [msg, '', USAGE]);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const shq = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

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

// A fresh copy of the page's code and its CI state, one per file.
function newReader(page) {
  const ctx = vm.createContext({ TextDecoder });
  vm.runInContext(`var CI = { kind: 'members', file: '', rows: [], heads: [], headRow: 0, map: {}, mdy: new Set(), pastBooked: false };`, ctx);
  for (const p of page.pieces) {
    try { vm.runInContext(p.text, ctx); } catch (e) { throw pageError(p.name, `did not run (${e.name}: ${e.message})`); }
  }
  try {
    return vm.runInContext('({ CI, CI_KINDS, CI_BATCH, nh, decodeFile, parseCsv, autoMap, monthFirst, rowFor, ciRead, ciBatches, ciNeeds })', ctx);
  } catch (e) { throw pageError('the import code', `did not run (${e.name}: ${e.message})`); }
}

const exactBytes = buf => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

// Made-up lines through every piece, so a piece that is there but no longer
// fits this tool stops it here, not in the middle of a real file.
function selfCheck(page) {
  const R = newReader(page);
  for (const f of ['nh', 'decodeFile', 'parseCsv', 'autoMap', 'monthFirst', 'rowFor', 'ciRead', 'ciBatches']) {
    if (typeof R[f] !== 'function') throw pageError(f, 'is no longer a function');
  }
  for (const k of KINDS) {
    const K = R.CI_KINDS[k];
    if (!K || !Array.isArray(K.need) || !K.fields || typeof K.fields !== 'object') throw pageError('CI_KINDS', `has no "${k}" with need and fields`);
  }
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

function readCsv(page, kind, file, pastAttended) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { throw new Halt(EXIT.usage, [`Cannot read the file ${file} (${e.code || 'error'}).`]); }
  const R = newReader(page), CI = R.CI;
  CI.kind = kind; CI.file = path.basename(file); CI.pastBooked = kind === 'visits' && !!pastAttended;
  const job = { file, name: CI.file, kind, R, refused: null };
  const refuse = (rule, text) => { job.refused = { rule, text }; return job; };
  let text;
  try { text = R.decodeFile(exactBytes(buf)); } catch { return refuse(...REFUSED.ciBadFile); }
  if (text == null) return refuse(...REFUSED.ciExcel);
  const read = R.ciRead(text);
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
  return job;
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
      // Host as a browser sends it: without the port when it is the usual one.
      const o = { method: 'POST', host, port, path: u.pathname + u.search, headers: { Host: u.host, ...headers } };
      // A request with its own connection takes no agent.
      if (socket) o.createConnection = () => tls.connect({ socket, servername: net.isIP(host) ? undefined : host });
      else o.agent = false;
      req = (secure ? https : http).request(o, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('error', finish);
        res.on('end', () => finish(null, { status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', finish);
      req.end(payload);
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
    batches: job.batches.length, stopped: null };
  for (const b of job.batches) {
    let r;
    try { r = await sendBatch(cfg, job, b, dry); } catch (e) { sum.stopped = { row: b.first, why: netWhy(e) }; break; }
    let j = {};
    try { j = JSON.parse(r.text) || {}; } catch { /* not JSON: an error page */ }
    if (r.status < 200 || r.status > 299) {
      sum.stopped = { row: b.first, status: r.status, why: `HTTP ${r.status}`, error: typeof j.error === 'string' ? j.error : null };
      break;
    }
    // An answer that is not this batch's result (a login page, another site),
    // or whose counts do not add up to its rows, is no result.
    const whole = x => Number.isInteger(x) && x >= 0;
    if (j.dryRun !== dry || j.total !== b.rows.length || !Array.isArray(j.skipped) || !Array.isArray(j.warnings)
      || ![j.added, j.matched, j.updated].every(whole) || j.added + j.matched + j.updated + j.skipped.length !== j.total) {
      sum.stopped = { row: b.first, why: 'the answer was not an import result' };
      break;
    }
    const row = x => x && typeof x === 'object' ? x : { text: String(x) };
    for (const x of ['total', 'added', 'matched', 'updated', 'newMembers']) sum[x] += Number(j[x]) || 0;
    sum.skipped.push(...j.skipped.map(row));
    for (const w of j.warnings.map(row)) {
      if (w.row == null && w.code === 'pastBooked') sum.pastBooked += Number((w.vals || [])[0]) || 0; else sum.warnings.push(w);
    }
  }
  return sum;
}

// ── which skipped rows are fine, and which need a person ───────────────────
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
const NO_CODE = '(no code)';
// A code is a short word. Anything else from the server is not printed.
const codeOf = x => x && typeof x.code === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(x.code) ? x.code : NO_CODE;
function tally(list) {
  const m = new Map();
  for (const x of list) m.set(codeOf(x), (m.get(codeOf(x)) || 0) + 1);
  return [...m].sort((a, b) => a[0].localeCompare(b[0]));
}
const skipClass = (kind, code) => has(SKIP_CODES[kind], code) ? SKIP_CODES[kind][code] : 'unknown';
const SKIP_SAYS = { ok: 'expected: nothing to keep', ask: 'a person must look', unknown: 'not known to this tool: a person must look' };

// Why run-all may not save this file after its check, or null when it is clean.
function gate(job, sum) {
  if (sum.stopped) return { rule: 'failed-batch', text: `a batch failed at row ${sum.stopped.row} (${sum.stopped.why})` };
  if (job.kind === 'payments' && job.rezervPay && !job.monthFirst.includes('date')) {
    return { rule: 'paid-on-not-month-first', text: 'the file has an "Issued On" column, but its payment dates were not read month first' };
  }
  const by = tally(sum.skipped).map(([code, n]) => ({ code, n, cls: skipClass(job.kind, code) }));
  const list = cls => by.filter(x => x.cls === cls).map(x => `${x.code} ${x.n}`).join(', ');
  if (list('unknown')) return { rule: 'unknown-skip-code', text: `rows were skipped for a reason this tool does not know: ${list('unknown')}` };
  if (list('ask')) return { rule: 'skip-code-needs-a-person', text: `rows were skipped for a reason a person must look at: ${list('ask')}` };
  return null;
}

// ── what is printed: counts and codes, nothing else ────────────────────────
const countsLine = sum => `rows ${sum.total}, added ${sum.added}, already there ${sum.matched}, updated ${sum.updated}, `
  + `new students ${sum.newMembers}, skipped ${sum.skipped.length}`;
const expectOf = sum => [sum.total, sum.added, sum.matched, sum.updated, sum.skipped.length].join(':');
const stoppedLine = sum => `Stopped at row ${sum.stopped.row} (${sum.stopped.why}). ` + (sum.dry ? 'Nothing was saved.'
  : 'Rows before it are saved. Fix it and run again: nothing is added twice.');
const UNAUTHORISED = 'Not authorised. Run this where the admin key is added by the network.';
const is401 = sum => !!sum.stopped && sum.stopped.status === 401;

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
  for (const [code, n] of tally(sum.skipped)) out(`    ${code}: ${n} (${SKIP_SAYS[skipClass(job.kind, code)]})`);
  out(`  Warnings: ${sum.warnings.length}`);
  for (const [code, n] of tally(sum.warnings)) out(`    ${code}: ${n}`);
  if (sum.pastBooked) out(`  Past visits still marked booked, not attended: ${sum.pastBooked}. They stay booked and do not count as classes practised.`);
  if (sum.dry && sum.batches > 1 && sum.newMembers) {
    out('  Note: a check looks at each batch on its own, so a student made in an earlier batch shows as new again. Saving does not do this.');
  }
  if (sum.stopped && !is401(sum)) out(`  ${stoppedLine(sum)}`);
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
    pastBooked: sum.pastBooked, stopped: sum.stopped,
    skipped: sum.skipped.map(x => ({ ...x, ...person(x.row) })),
    warnings: sum.warnings.map(w => ({ ...w, ...person(w.row) })),
  };
  const data = { file: job.name, kind: job.kind, writtenAt: new Date().toISOString(), refused: job.refused,
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

async function cmdCheck(page, cfg, kind, file, opt) {
  const job = openFile(page, kind, file, opt);
  const check = await runBatches(cfg, job, true);
  printResult(job, check);
  if (opt.details) writeDetails(opt.details, job, { check });
  if (is401(check)) throw new Halt(EXIT.auth, [UNAUTHORISED]);
  if (check.stopped) return EXIT.stopped;
  const g = gate(job, check);
  out(g ? `For run-all: it would stop here (${g.rule}): ${g.text}.` : 'For run-all: clean.');
  out('To save these rows:');
  out(`  ${SELF} write ${kind} ${shq(file)} --expect "${expectOf(check)}"${baseFlag(cfg)}${job.R.CI.pastBooked ? ' --past-attended' : ''}`);
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
  if (expectOf(check) !== opt.expect) {
    leave(EXIT.stopped, [`The check gives "${expectOf(check)}", not the "${opt.expect}" in --expect.`, 'Nothing was saved.']);
  }
  out('The check matches --expect. Saving.');
  runs.saved = await runBatches(cfg, job, false);
  printResult(job, runs.saved);
  if (is401(runs.saved)) leave(EXIT.auth, [UNAUTHORISED]);
  if (runs.saved.stopped) leave(EXIT.stopped, ['Not every row was saved.']);
  if (expectOf(runs.saved) !== expectOf(check)) out('Note: the saved counts are not the check\'s counts.');
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
function planDir(dir) {
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isFile()).map(d => d.name); }
  catch (e) { throw new Halt(EXIT.usage, [`Cannot read the folder ${dir} (${e.code || 'error'}).`]); }
  const steps = [], ignored = [];
  for (const name of names.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) {
    const low = name.toLowerCase();
    const never = ['voided', 'refunded', 'class-attendance'].find(w => low.includes(w));
    if (!low.startsWith('rezerv-')) { ignored.push([name, 'its name does not start with rezerv-']); continue; }
    if (never) { ignored.push([name, `its name says ${never}`]); continue; }
    const hit = NAMED.map(([re, kind, group]) => ({ m: low.match(re), kind, group })).find(x => x.m);
    if (!hit) { ignored.push([name, 'its name is not one this tool knows']); continue; }
    const yearly = hit.group === 4 || hit.group === 5;
    steps.push({ name, kind: hit.kind, group: hit.group, year: yearly ? +hit.m[1] : 0, part: yearly ? partOrder(hit.m[2]) : 0 });
  }
  steps.sort((a, b) => a.group - b.group || a.year - b.year || a.part - b.part || a.name.localeCompare(b.name, 'en', { numeric: true }));
  return { dir, steps, ignored, missing: EXPECTED.filter((_, i) => !steps.some(x => x.group === i + 1)) };
}
function printPlan(plan) {
  out(`Folder: ${plan.dir}`);
  out(`Import order (${plan.steps.length} ${plan.steps.length === 1 ? 'file' : 'files'}):`);
  plan.steps.forEach((s, i) => out(`  ${String(i + 1).padStart(2)}. ${s.kind.padEnd(8)} ${s.name}`));
  if (!plan.steps.length) out('  (none)');
  out(`Ignored (${plan.ignored.length}):`);
  for (const [name, why] of plan.ignored) out(`  - ${name}: ${why}`);
  if (!plan.ignored.length) out('  (none)');
  if (plan.missing.length) out(`Not in this folder: ${plan.missing.join(', ')}`);
}

async function cmdRunAll(page, cfg, dir, opt) {
  const plan = planDir(dir);
  printPlan(plan);
  const n = plan.steps.length, from = opt.fromStep || 1;
  if (!n) throw new Halt(EXIT.stopped, ['No file to import in this folder.']);
  if (from > n) throw usage(`--from-step ${from}: this folder has ${n} steps.`);
  if (opt.detailsDir) {
    try { fs.mkdirSync(opt.detailsDir, { recursive: true, mode: 0o700 }); fs.accessSync(opt.detailsDir, fs.constants.W_OK); }
    catch (e) { throw new Halt(EXIT.usage, [`Cannot write in the details folder ${opt.detailsDir} (${e.code || 'error'}).`]); }
  }
  if (from > 1) out(`Starting at step ${from}: steps 1 to ${from - 1} are left alone.`);
  let saved = 0;
  for (let i = from - 1; i < n; i++) {
    const step = plan.steps[i], file = path.join(dir, step.name);
    out('');
    out(`Step ${i + 1} of ${n}`);
    const job = readCsv(page, step.kind, file, false);
    printHead(job);
    const runs = {};
    const details = () => { if (opt.detailsDir) writeDetails(path.join(opt.detailsDir, `${step.name}.details.json`), job, runs); };
    // Which file, which rule, the counts, and what a person does next.
    const stop = (rule, text, sum, saving) => {
      details();
      const resume = k => `  ${SELF} run-all ${shq(dir)} --from-step ${k}${baseFlag(cfg)}${opt.detailsDir ? ` --details-dir ${shq(opt.detailsDir)}` : ''}`;
      const lines = ['', `STOPPED at step ${i + 1} of ${n}: ${step.name} (${step.kind})`, `Rule: ${rule}: ${text}.`];
      if (sum) lines.push(`Counts: ${countsLine(sum)}.`);
      const broke = !sum || !!sum.stopped;
      lines.push(!saving ? 'Nothing from this file was saved, and no later file was touched.'
        : broke ? 'The rows before that row are saved. No later file was touched.'
        : 'This file is saved, apart from its skipped rows. No later file was touched.');
      if (broke) lines.push('When it is fixed, run this step again (nothing is added twice):', resume(i + 1));
      else if (!saving) {
        lines.push('When a person has looked at it, either fix the export and run this step again, or save the file as it is:',
          `  ${SELF} write ${step.kind} ${shq(file)} --expect "${expectOf(sum)}"${baseFlag(cfg)}`);
        if (i + 1 < n) lines.push('and carry on:', resume(i + 2));
      } else if (i + 1 < n) lines.push('When a person has looked at it, carry on:', resume(i + 2));
      throw new Halt(EXIT.stopped, lines);
    };
    if (job.refused) stop(`refused (${job.refused.rule})`, job.refused.text.replace(/\.$/, ''), null, false);
    printRead(job);
    runs.check = await runBatches(cfg, job, true);
    printResult(job, runs.check);
    if (is401(runs.check)) { details(); throw new Halt(EXIT.auth, [UNAUTHORISED]); }
    const g = gate(job, runs.check);
    if (g) stop(g.rule, g.text, runs.check, false);
    runs.saved = await runBatches(cfg, job, false);
    printResult(job, runs.saved);
    if (is401(runs.saved)) { details(); throw new Halt(EXIT.auth, [UNAUTHORISED]); }
    const after = gate(job, runs.saved);
    if (after) stop(`${after.rule} (while saving)`, after.text, runs.saved, true);
    details();
    saved++;
  }
  out('');
  out(`Done: ${saved} ${saved === 1 ? 'file' : 'files'} saved, steps ${from} to ${n} of ${n}.`);
  return EXIT.ok;
}

// ── the command line ───────────────────────────────────────────────────────
const FLAGS = { '--base': 'base', '--details': 'details', '--details-dir': 'detailsDir', '--expect': 'expect', '--from-step': 'fromStep',
  '--past-attended': null };
const ALLOWED = { check: ['--base', '--past-attended', '--details'], write: ['--base', '--past-attended', '--details', '--expect'],
  plan: [], 'run-all': ['--base', '--details-dir', '--from-step'] };

function parseArgs(argv) {
  const cmd = argv[0], rest = [], opt = {};
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') return { help: true };
  if (!has(ALLOWED, cmd)) throw usage(`Unknown command: ${cmd}`);
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { rest.push(a); continue; }
    const eq = a.indexOf('='), flag = eq < 0 ? a : a.slice(0, eq);
    if (!ALLOWED[cmd].includes(flag)) throw usage(`${cmd} does not take ${flag}`);
    if (FLAGS[flag] === null) { opt.pastAttended = true; continue; }
    const v = eq < 0 ? argv[++i] : a.slice(eq + 1);
    if (v == null || v === '') throw usage(`${flag} needs a value`);
    opt[FLAGS[flag]] = v;
  }
  let base;
  try { base = new URL(opt.base || DEFAULT_BASE); } catch { throw usage('--base must be an address like https://aybkk.net'); }
  if (!/^https?:$/.test(base.protocol) || base.username || base.password) throw usage('--base must be an address like https://aybkk.net');
  // The admin key must never travel in the clear.
  if (base.protocol === 'http:' && !isLoopback(base.hostname)) throw usage('--base with http:// is only for a test server on this machine');
  const cfg = { base: base.origin };
  if (cmd === 'plan' || cmd === 'run-all') {
    if (rest.length !== 1) throw usage(`${cmd} takes one folder`);
    if (opt.fromStep != null) {
      if (!/^[1-9]\d*$/.test(opt.fromStep)) throw usage('--from-step must be a step number, from 1');
      opt.fromStep = Number(opt.fromStep);
    }
    return { cmd, cfg, dir: rest[0], opt };
  }
  if (rest.length !== 2) throw usage(`${cmd} takes a kind and one file`);
  if (!KINDS.includes(rest[0])) throw usage(`kind must be one of: ${KINDS.join(', ')}`);
  if (cmd === 'write' && !/^\d+:\d+:\d+:\d+:\d+$/.test(opt.expect || '')) {
    throw usage('write needs --expect "<rows>:<added>:<already there>:<updated>:<skipped>", the counts a check printed');
  }
  if (opt.details && path.resolve(opt.details) === path.resolve(rest[1])) throw usage('--details must be another file than the CSV');
  return { cmd, cfg, kind: rest[0], file: rest[1], opt };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) { out(USAGE); return EXIT.ok; }
  if (a.cmd === 'plan') { printPlan(planDir(a.dir)); return EXIT.ok; }
  const page = loadPage();
  out(`Server: ${a.cfg.base}`);
  if (a.cmd === 'check') return cmdCheck(page, a.cfg, a.kind, a.file, a.opt);
  if (a.cmd === 'write') return cmdWrite(page, a.cfg, a.kind, a.file, a.opt);
  return cmdRunAll(page, a.cfg, a.dir, a.opt);
}

if (require.main === module) {
  main().catch(e => {
    if (e instanceof Halt) { process.stderr.write(e.lines.join('\n') + '\n'); return e.code; }
    // An error of our own making: its class only, as its text could quote a row.
    process.stderr.write(`Stopped: unexpected ${e && e.name ? e.name : 'error'}${e && /^[A-Z][A-Z0-9_]*$/.test(e.code || '') ? ' ' + e.code : ''}.\n`);
    return EXIT.stopped;
  }).then(code => {
    process.exitCode = code;
    process.stdout.write('', () => process.stderr.write('', () => process.exit(code)));
  });
} else module.exports = { SKIP_CODES, KINDS };
