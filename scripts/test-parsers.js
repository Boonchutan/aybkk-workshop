#!/usr/bin/env node
/**
 * Self-contained sanity tests for the fragile parsing code that will run
 * the moment the Rezerv cookie arrives. No network, no DB — pure functions.
 *
 *   node scripts/test-parsers.js
 */
const assert = require('assert');
const rz = require('../lib/rezerv-client');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); fail++; }
}

console.log('Rezerv attendee field extraction:');

t('flat email + fullName', () => {
  const row = { email: 'A@B.com', fullName: 'Jane Doe' };
  assert.strictEqual(rz.attendeeEmail(row), 'a@b.com');
  assert.strictEqual(rz.attendeeName(row), 'Jane Doe');
});

t('PascalCase keys', () => {
  const row = { Email: 'X@Y.com', CustomerName: 'Bob' };
  assert.strictEqual(rz.attendeeEmail(row), 'x@y.com');
  assert.strictEqual(rz.attendeeName(row), 'Bob');
});

t('nested customer object', () => {
  const row = { customer: { email: 'Nested@Mail.com', firstName: 'Ann', lastName: 'Lee' } };
  assert.strictEqual(rz.attendeeEmail(row), 'nested@mail.com');
  assert.strictEqual(rz.attendeeName(row), 'Ann Lee');
});

t('missing email returns null (not crash)', () => {
  const row = { fullName: 'No Email' };
  assert.strictEqual(rz.attendeeEmail(row), null);
  assert.strictEqual(rz.attendeeName(row), 'No Email');
});

t('empty row returns nulls', () => {
  assert.strictEqual(rz.attendeeEmail({}), null);
  assert.strictEqual(rz.attendeeName({}), null);
});

console.log('\ncURL parser (scripts/rezerv-curl-replay.js parseCurl):');
// Re-implement-free: require the file's parseCurl by re-loading via a tiny shim
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'rezerv-curl-replay.js'), 'utf8');
const m = src.match(/function parseCurl[\s\S]*?\n}\n/);
// eslint-disable-next-line no-eval
const parseCurl = eval('(' + m[0].replace('function parseCurl', 'function') + ')');

t('parses URL + cookie + headers', () => {
  const curl = `curl 'https://business-api.rezerv.co/v1/customers?CurrentPage=1' \\
  -H 'Accept: application/json' \\
  -H 'Cookie: sid=abc123; auth=xyz'`;
  const r = parseCurl(curl);
  assert.strictEqual(r.url, 'https://business-api.rezerv.co/v1/customers?CurrentPage=1');
  assert.strictEqual(r.headers['Cookie'] || r.headers['cookie'], 'sid=abc123; auth=xyz');
  assert.strictEqual(r.method, 'GET');
});

t('POST with --data-raw flips method', () => {
  const curl = `curl 'https://x.co/api' -X POST --data-raw '{"a":1}'`;
  const r = parseCurl(curl);
  assert.strictEqual(r.method, 'POST');
  assert.strictEqual(r.body, '{"a":1}');
});

t('-b cookie flag captured', () => {
  const curl = `curl 'https://x.co/y' -b 'k=v'`;
  const r = parseCurl(curl);
  assert.strictEqual(r.headers['cookie'], 'k=v');
});

console.log('\nattendee CSV column auto-detect:');
const exSrc = fs.readFileSync(path.join(__dirname, 'extract-attendees.js'), 'utf8');
const fnMatch = exSrc.match(/function splitCsvLine[\s\S]*?\n}\n/);
// eslint-disable-next-line no-eval
const splitCsvLine = eval('(' + fnMatch[0].replace('function splitCsvLine', 'function') + ')');

t('splits quoted comma correctly', () => {
  const cols = splitCsvLine('Jane,"Doe, Jr.",jane@x.com');
  assert.deepStrictEqual(cols, ['Jane', 'Doe, Jr.', 'jane@x.com']);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
