#!/usr/bin/env node
// Seed data to Railway volume via direct file write
// Run this ONCE after volume is created
const fs = require('fs');
const path = require('path');

const DATA_DIR = '/data';
const srcDir = __dirname;

const files = ['journal-students.json', 'journal-checkins.json', 'orientations.json'];

for (const f of files) {
  const src = path.join(srcDir, f);
  const dst = path.join(DATA_DIR, f);
  if (fs.existsSync(src)) {
    const data = fs.readFileSync(src);
    fs.writeFileSync(dst, data);
    const count = JSON.parse(data).length;
    console.log(`✓ ${f}: ${count} entries copied`);
  } else {
    console.log(`⊘ ${f}: not found locally`);
  }
}
console.log('Done.');
