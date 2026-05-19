#!/usr/bin/env node
/**
 * Fetch today's roster for one Rezerv class and print attendee emails.
 *
 *   REZERV_COOKIE='...' node scripts/rezerv-fetch-roster.js \
 *      --class-id 26a0927e-88c2-462d-9894-eb3285f35b38 \
 *      [--date 2026-05-15] [--all-statuses] [--emails-only]
 *
 * Pipe the emails-only output into the broadcaster:
 *   ATTENDEES=$(REZERV_COOKIE=... node scripts/rezerv-fetch-roster.js --class-id ... --emails-only)
 *   railway run node aybkk-line-broadcast.js --photo-url ... --emails "$ATTENDEES"
 */
require('dotenv').config();
const rz = require('../lib/rezerv-client');

const args = parse(process.argv.slice(2));
const classId = args['class-id'];
const date = args.date || new Date().toISOString().slice(0, 10);
const emailsOnly = !!args['emails-only'];

if (!classId) { console.error('Need --class-id <uuid>'); process.exit(1); }

(async () => {
  const rows = await rz.getClassRoster(classId, date, {
    bookingStatus: args['all-statuses'] ? '' : 'Booked'
  });
  const enriched = rows.map(r => ({
    name: rz.attendeeName(r),
    email: rz.attendeeEmail(r),
    raw: r
  }));
  const withEmail = enriched.filter(r => r.email);

  if (emailsOnly) {
    console.log([...new Set(withEmail.map(r => r.email))].join(','));
    return;
  }

  console.log(`Class: ${classId}`);
  console.log(`Date:  ${date}`);
  console.log(`Booked attendees: ${rows.length}  (with email: ${withEmail.length})\n`);
  enriched.forEach(r => console.log(`  ${r.name || '(no name)'}\t${r.email || '(no email)'}`));
  if (rows.length && !withEmail.length) {
    console.log('\nFirst raw row (for debugging field names):');
    console.log(JSON.stringify(rows[0], null, 2).slice(0, 1500));
  }
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });

function parse(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) o[a.slice(2)] = true;
    else { o[a.slice(2)] = next; i++; }
  }
  return o;
}
