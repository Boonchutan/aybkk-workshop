#!/usr/bin/env node
/**
 * Daily multi-class broadcast.
 *
 * Reads a JSON config that maps class IDs → photo file path, e.g.:
 *   {
 *     "date": "2026-05-15",
 *     "classes": [
 *       { "classId": "26a0927e-...", "name": "Mysore 5:30am", "photo": "/path/to/m530.jpg" },
 *       { "classId": "uuid2",         "name": "Mysore 7:00am", "photo": "/path/to/m700.jpg" },
 *       { "classId": "uuid3",         "name": "Led",            "photo": "/path/to/led.jpg" }
 *     ]
 *   }
 *
 *   REZERV_COOKIE='...' railway run node scripts/aybkk-daily-multi.js path/to/today.json
 *
 * For each class:
 *   1. Pull attendee emails from Rezerv API
 *   2. Upload the photo to Cloudinary (once per class)
 *   3. Broadcast to all linked-and-following attendees via LINE
 *   4. Print summary
 *
 * No Rezerv cookie? Falls back to per-class --emails on CLI.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const configPath = process.argv[2];
if (!configPath || !fs.existsSync(configPath)) {
  console.error('Usage: node scripts/aybkk-daily-multi.js <today.json>');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const date = cfg.date || new Date().toISOString().slice(0, 10);

(async () => {
  const summary = [];
  for (const cls of cfg.classes) {
    console.log(`\n=== ${cls.name}  (${cls.classId})  ${date} ===`);

    // Get attendees (from Rezerv API or fallback)
    let emailsCsv = '';
    if (cls.classId) {
      const r = spawnSync('node', [
        path.join(__dirname, 'rezerv-fetch-roster.js'),
        '--class-id', cls.classId, '--date', date, '--emails-only'
      ], { env: process.env });
      if (r.status !== 0) {
        console.error(`  ✗ roster fetch failed: ${r.stderr.toString()}`);
        summary.push({ class: cls.name, status: 'roster-failed' });
        continue;
      }
      emailsCsv = r.stdout.toString().trim();
    } else if (cls.emails) {
      emailsCsv = cls.emails;
    }

    if (!emailsCsv) {
      console.log('  no attendees with email');
      summary.push({ class: cls.name, status: 'no-attendees' });
      continue;
    }

    if (!cls.photo) {
      console.log('  no photo configured — skip');
      summary.push({ class: cls.name, status: 'no-photo' });
      continue;
    }
    if (!fs.existsSync(cls.photo)) {
      console.log(`  photo missing: ${cls.photo}`);
      summary.push({ class: cls.name, status: 'photo-missing' });
      continue;
    }

    // Run the daily broadcast (which uploads + broadcasts in one call)
    const b = spawnSync('node', [
      path.join(__dirname, '..', 'aybkk-daily-broadcast.js'),
      '--photo', cls.photo,
      '--emails', emailsCsv,
      '--caption', `${cls.name} — ${date}`
    ], { stdio: 'inherit' });
    summary.push({ class: cls.name, status: b.status === 0 ? 'sent' : 'failed' });
  }

  console.log('\n=== Summary ===');
  for (const s of summary) console.log(`  ${s.status.padEnd(15)} ${s.class}`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
