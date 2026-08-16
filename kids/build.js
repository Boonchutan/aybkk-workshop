#!/usr/bin/env node
/**
 * Inline the woff2 fonts into school-skills.src.html -> school-skills.html.
 *
 * Why: the published Artifact runs under a CSP that blocks every external
 * host, so a font URL would fail silently and drop the page to a system
 * fallback. Fonts have to travel inside the file as data URIs.
 *
 * Run: node kids/build.js
 */
const fs = require('fs');
const path = require('path');

const here = __dirname;
const fontDir = path.join(here, '..', 'public', 'fonts');
const srcPath = path.join(here, 'school-skills.src.html');
const outPath = path.join(here, 'school-skills.html');

const src = fs.readFileSync(srcPath, 'utf8');
const used = [];

const out = src.replace(/@@FONT:([a-z0-9-]+)@@/g, (_, name) => {
  const p = path.join(fontDir, name + '.woff2');
  if (!fs.existsSync(p)) {
    console.error(`✗ missing font: ${p}`);
    process.exit(1);
  }
  const b64 = fs.readFileSync(p).toString('base64');
  used.push(`${name} (${Math.round(b64.length / 1024)} KB base64)`);
  return 'data:font/woff2;base64,' + b64;
});

if (/@@FONT:/.test(out)) {
  console.error('✗ unresolved @@FONT:…@@ token remains');
  process.exit(1);
}

// Same gate as scripts/check-inline-js.js — a syntax error here renders a
// page that looks fine and does nothing.
let bad = 0;
const SCRIPT_RE = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;
let m, i = 0;
while ((m = SCRIPT_RE.exec(out)) !== null) {
  i++;
  const tag = m[0].slice(0, m[0].indexOf('>') + 1);
  if (/\bsrc=/.test(tag)) continue;
  if (/\btype=["']module["']/i.test(tag)) continue;
  try {
    new Function(m[1]);
  } catch (e) {
    bad++;
    console.error(`✗ inline <script> #${i} — ${e.message}`);
  }
}
if (bad) process.exit(1);

fs.writeFileSync(outPath, out);

// Second target: a complete document that plays when opened straight off a
// device — saved to Files on an iPad, say — with no account and no network.
// The Artifact publisher supplies its own wrapper, so that copy stays a
// fragment and this one gets the head/body it needs to stand alone.
const split = out.indexOf('<canvas');
const standalone = `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Playground">
<meta name="theme-color" content="#DCEBF0">
<meta name="color-scheme" content="light dark">
<style>*{margin:0}</style>
${out.slice(0, split)}</head>
<body>
${out.slice(split)}</body>
</html>
`;
fs.writeFileSync(path.join(here, 'foundation-playground.html'), standalone);

console.log('fonts inlined:');
used.forEach(u => console.log('  ' + u));
console.log(`\n✓ ${path.relative(process.cwd(), outPath)} — ${Math.round(out.length / 1024)} KB, ${i} script block(s) parse cleanly`);
console.log(`✓ kids/foundation-playground.html — ${Math.round(standalone.length / 1024)} KB standalone`);
