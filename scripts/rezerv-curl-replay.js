#!/usr/bin/env node
/**
 * Rezerv API replay: takes a curl command string copied from Chrome DevTools
 * (Right-click request → Copy → Copy as cURL) and runs it from Node, then
 * pretty-prints the JSON response.
 *
 * The Rezerv admin UI talks to its backend with cookies + bearer tokens.
 * Once we capture one working request, we can call the same endpoint daily
 * from a script — no headless browser, no OTP loop. When cookies expire
 * (typically days), repeat the cURL grab.
 *
 * Usage:
 *   # Save the cURL into a file and run:
 *   node scripts/rezerv-curl-replay.js path/to/curl.txt
 *
 *   # Or pipe it in:
 *   pbpaste | node scripts/rezerv-curl-replay.js -
 */
const fs = require('fs');

function parseCurl(curl) {
  // Strip line-continuations + collapse whitespace
  curl = curl.replace(/\\\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (curl.startsWith('curl ')) curl = curl.slice(5);

  const out = { method: 'GET', url: null, headers: {}, body: null };

  // Tokenize respecting quotes
  const tokens = [];
  let cur = '', quote = null;
  for (let i = 0; i < curl.length; i++) {
    const ch = curl[i];
    if (quote) {
      if (ch === quote) { tokens.push(cur); cur = ''; quote = null; }
      else cur += ch;
    } else if (ch === "'" || ch === '"') {
      if (cur) { tokens.push(cur); cur = ''; }
      quote = ch;
    } else if (ch === ' ') {
      if (cur) { tokens.push(cur); cur = ''; }
    } else cur += ch;
  }
  if (cur) tokens.push(cur);

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '-X' || t === '--request') { out.method = tokens[++i].toUpperCase(); }
    else if (t === '-H' || t === '--header') {
      const h = tokens[++i];
      const idx = h.indexOf(':');
      if (idx > -1) out.headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
    }
    else if (t === '-b' || t === '--cookie') { out.headers['cookie'] = tokens[++i]; }
    else if (t === '--data-raw' || t === '-d' || t === '--data' || t === '--data-binary') {
      out.body = tokens[++i];
      if (out.method === 'GET') out.method = 'POST';
    }
    else if (t === '--compressed' || t.startsWith('-')) { /* skip flag */ }
    else if (!out.url && /^https?:\/\//.test(t)) out.url = t;
  }
  return out;
}

(async () => {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/rezerv-curl-replay.js <file.txt | -> ');
    process.exit(1);
  }
  const raw = arg === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(arg, 'utf8');
  const req = parseCurl(raw);

  console.log(`→ ${req.method} ${req.url}`);
  console.log(`  ${Object.keys(req.headers).length} headers`);
  if (req.body) console.log(`  body bytes: ${req.body.length}`);

  const resp = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  console.log(`\n← ${resp.status} ${resp.statusText}`);
  const ct = resp.headers.get('content-type') || '';
  const text = await resp.text();
  if (ct.includes('json')) {
    try {
      const j = JSON.parse(text);
      console.log(JSON.stringify(j, null, 2).slice(0, 4000));
      if (Array.isArray(j)) console.log(`\n(array length: ${j.length})`);
    } catch {
      console.log(text.slice(0, 2000));
    }
  } else {
    console.log(`(content-type: ${ct})`);
    console.log(text.slice(0, 2000));
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
