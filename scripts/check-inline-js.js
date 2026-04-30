#!/usr/bin/env node
/**
 * Validate every inline <script> in public/*.html parses cleanly.
 *
 * Why this exists: browsers fail silently on JS syntax errors — the static
 * HTML still renders so the page LOOKS like it loaded, but no JS executes.
 * Users see the welcome screen and can't progress past it. We hit this on
 * 2026-04-30 (commit 9beedde left orphan code that broke the journal app
 * for ~12 hours of student traffic). One `new Function()` check would have
 * caught it locally before push.
 *
 * Skips: type="module" (uses import/export which new Function() rejects),
 * external src=… scripts (no inline body), JSON/data scripts.
 *
 * Run:   node scripts/check-inline-js.js
 * Exit:  0 = all clean, 1 = at least one syntax error
 */
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SCRIPT_RE = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;

let errorCount = 0;
let fileCount = 0;
let scriptCount = 0;

for (const f of fs.readdirSync(PUBLIC_DIR).filter(n => n.endsWith('.html'))) {
  const filePath = path.join(PUBLIC_DIR, f);
  const html = fs.readFileSync(filePath, 'utf8');
  fileCount++;
  let m, idx = 0;
  SCRIPT_RE.lastIndex = 0;
  while ((m = SCRIPT_RE.exec(html)) !== null) {
    idx++;
    const tag = m[0].slice(0, m[0].indexOf('>') + 1);
    // Skip module scripts (import/export not valid in new Function), external src, non-JS types
    if (/\bsrc=/.test(tag)) continue;
    if (/\btype=["']module["']/i.test(tag)) continue;
    if (/\btype=["'](?!text\/javascript|application\/javascript)/i.test(tag)) continue;
    scriptCount++;
    try {
      new Function(m[1]);
    } catch (e) {
      errorCount++;
      const startLine = html.substring(0, m.index).split('\n').length;
      console.error(`✗ ${f}: inline <script> #${idx} (HTML line ~${startLine}) — ${e.message}`);
    }
  }
}

console.log(`\nChecked ${scriptCount} inline JS blocks in ${fileCount} HTML files.`);
if (errorCount > 0) {
  console.error(`\n${errorCount} syntax error(s). Do not deploy.`);
  process.exit(1);
}
console.log('✓ all inline JS parses cleanly');
