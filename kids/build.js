#!/usr/bin/env node
/**
 * Build the kids' learning pages: inline the fonts, check the JS parses, and
 * emit both an Artifact fragment and a standalone document per app.
 *
 * Why the fonts are inlined: the published Artifact runs under a CSP that
 * blocks every external host, so a font URL would fail silently and drop the
 * page to a system fallback. Fonts have to travel inside the file.
 *
 * Why two outputs: the Artifact publisher supplies its own
 * <!doctype>/<head>/<body> wrapper, so that copy stays a fragment. The
 * standalone copy carries its own wrapper so it plays when opened straight
 * off a device — saved into Files on an iPad, say — with no account and no
 * network.
 *
 * Run: node kids/build.js
 */
const fs = require('fs');
const path = require('path');

const here = __dirname;
const fontDir = path.join(here, '..', 'public', 'fonts');

const APPS = [
  {
    src: 'school-skills.src.html',
    fragment: 'school-skills.html',
    standalone: 'foundation-playground.html',
    appTitle: 'Playground',
    theme: '#DCEBF0',
  },
  {
    src: 'petal.src.html',
    fragment: 'petal.html',
    standalone: 'petal-playground.html',
    appTitle: 'Petal',
    theme: '#FBEEF3',
  },
];

function inlineFonts(src, used) {
  const out = src.replace(/@@FONT:([a-z0-9-]+)@@/g, (_, name) => {
    const p = path.join(fontDir, name + '.woff2');
    if (!fs.existsSync(p)) {
      console.error(`✗ missing font: ${p}`);
      process.exit(1);
    }
    const b64 = fs.readFileSync(p).toString('base64');
    used.push(`${name} (${Math.round(b64.length / 1024)} KB)`);
    return 'data:font/woff2;base64,' + b64;
  });
  if (/@@FONT:/.test(out)) {
    console.error('✗ unresolved @@FONT:…@@ token remains');
    process.exit(1);
  }
  return out;
}

// Same gate as scripts/check-inline-js.js — a syntax error here renders a page
// that looks fine and does nothing at all.
function checkScripts(out, label) {
  const SCRIPT_RE = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;
  let m, i = 0, bad = 0;
  while ((m = SCRIPT_RE.exec(out)) !== null) {
    i++;
    const tag = m[0].slice(0, m[0].indexOf('>') + 1);
    if (/\bsrc=/.test(tag)) continue;
    if (/\btype=["']module["']/i.test(tag)) continue;
    try {
      new Function(m[1]);
    } catch (e) {
      bad++;
      console.error(`✗ ${label}: inline <script> #${i} — ${e.message}`);
    }
  }
  if (bad) process.exit(1);
  return i;
}

function wrap(out, app) {
  const split = out.indexOf('<canvas');
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="${app.appTitle}">
<meta name="theme-color" content="${app.theme}">
<meta name="color-scheme" content="light dark">
<style>*{margin:0}</style>
${out.slice(0, split)}</head>
<body>
${out.slice(split)}</body>
</html>
`;
}

let built = 0;
for (const app of APPS) {
  const srcPath = path.join(here, app.src);
  if (!fs.existsSync(srcPath)) continue;   // app not written yet
  const used = [];
  const out = inlineFonts(fs.readFileSync(srcPath, 'utf8'), used);
  const blocks = checkScripts(out, app.src);
  fs.writeFileSync(path.join(here, app.fragment), out);
  const standalone = wrap(out, app);
  fs.writeFileSync(path.join(here, app.standalone), standalone);
  built++;
  console.log(`\n${app.src}`);
  console.log('  fonts: ' + used.join(', '));
  console.log(`  ✓ kids/${app.fragment} — ${Math.round(out.length / 1024)} KB, ${blocks} script block(s) parse cleanly`);
  console.log(`  ✓ kids/${app.standalone} — ${Math.round(standalone.length / 1024)} KB standalone`);
}
if (!built) {
  console.error('✗ no app sources found');
  process.exit(1);
}
