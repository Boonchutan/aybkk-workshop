#!/usr/bin/env node
/**
 * AYBKK Daily Broadcast — single command that runs the full pipeline.
 *
 *   node aybkk-daily-broadcast.js \
 *     --photo "/abs/path/to/today-photo.jpg" \
 *     --attendees-csv "/abs/path/to/today-attendance.csv" \
 *     --caption "Mysore — May 15"
 *
 * Steps it performs in order:
 *   1. Upload the photo to Cloudinary, tag with today's date
 *   2. Parse the attendance CSV → unique attendee emails (excludes cancelled)
 *   3. Match emails → Student → LINE UID in Neo4j
 *   4. Push the photo + caption to each linked-and-following LINE user
 *   5. Print a summary (sent / failed / unlinked attendees / unknown emails)
 *
 * Run via:  railway run node aybkk-daily-broadcast.js ...
 *  (so prod Neo4j + prod Cloudinary creds are loaded)
 *
 * Or use --photo-url <https://...> instead of --photo to skip step 1.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const neo4j = require('neo4j-driver');
const { spawnSync } = require('child_process');

const args = parseArgs(process.argv.slice(2));
const photoPath = args.photo;
const photoUrlArg = args['photo-url'];
const csvPath = args['attendees-csv'];
const emailsArg = args.emails;
const caption = args.caption || '';

if (!photoPath && !photoUrlArg) die('Need --photo <path> or --photo-url <https://...>');
if (!csvPath && !emailsArg) die('Need --attendees-csv <path> or --emails "a@b,c@d"');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dw1uubecu',
  api_key: process.env.CLOUDINARY_API_KEY || '191765218532954',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'kBwusl-gHqqNiZYykFgChJjt3MQ'
});

(async () => {
  // 1. Photo URL
  let photoUrl = photoUrlArg;
  if (!photoUrl) {
    if (!fs.existsSync(photoPath)) die(`Photo not found: ${photoPath}`);
    const today = new Date().toISOString().slice(0, 10);
    const publicId = `aybkk/daily/${today}/${path.basename(photoPath, path.extname(photoPath))}-${Date.now()}`;
    console.log(`↑ uploading ${path.basename(photoPath)} to Cloudinary…`);
    const upload = await cloudinary.uploader.upload(photoPath, {
      public_id: publicId,
      tags: [`aybkk-daily-${today}`, 'aybkk-daily']
    });
    photoUrl = upload.secure_url;
    console.log(`✓ ${photoUrl}`);
  }

  // 2. Attendee emails
  let emails = [];
  if (emailsArg) {
    emails = emailsArg.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  } else {
    const r = spawnSync('node', [path.join(__dirname, 'scripts/extract-attendees.js'), csvPath, '--emails-only']);
    if (r.status !== 0) die(`extract-attendees failed: ${r.stderr.toString()}`);
    emails = r.stdout.toString().trim().split(',').map(s => s.trim()).filter(Boolean);
  }
  console.log(`\n✓ ${emails.length} unique attendee emails parsed.`);

  // 3 + 4. Use the existing broadcast script as a child process so behavior is identical.
  const broadcast = spawnSync('node', [
    path.join(__dirname, 'aybkk-line-broadcast.js'),
    '--photo-url', photoUrl,
    '--emails', emails.join(','),
    ...(caption ? ['--caption', caption] : [])
  ], { stdio: 'inherit' });
  process.exit(broadcast.status || 0);
})().catch(e => die(e.message));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[a.slice(2)] = true;
    else { out[a.slice(2)] = next; i++; }
  }
  return out;
}
function die(m) { console.error('ERR:', m); process.exit(1); }
