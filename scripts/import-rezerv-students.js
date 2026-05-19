#!/usr/bin/env node
/**
 * Sync the Rezerv membership CSV into Neo4j as :Student nodes.
 *
 * - MERGE on email (creates new Student if not in DB; updates name/phone otherwise)
 * - Adds source='rezerv', country='TH'
 * - Creates :Membership node for active rows and links via [:HAS_MEMBERSHIP]
 *
 * Run via:  railway run node scripts/import-rezerv-students.js
 */
require('dotenv').config();
const neo4j = require('neo4j-driver');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CSV_PATH = process.env.REZERV_CSV || path.join(__dirname, '..', 'data', 'rezerv', 'memberships.csv');
console.log(`CSV:    ${CSV_PATH}`);
console.log(`Neo4j:  ${process.env.NEO4J_URI}`);

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);

function parseCSV(filepath) {
  const content = fs.readFileSync(filepath, 'utf8').trim();
  const lines = content.split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split(',');
    const row = {};
    headers.forEach((h, i) => row[h] = (values[i] || '').trim());
    return row;
  });
}

function parseDate(str) {
  if (!str || str === '--') return null;
  const [d, m, y] = str.split('/');
  if (!d || !m || !y) return null;
  return new Date(2000 + +y, +m - 1, +d).toISOString().split('T')[0];
}

function makeStudentId(email, name) {
  // Stable ID: hash of email if present, else hash of name+phone fallback
  const seed = (email || name || '').toLowerCase();
  return 'rz_' + crypto.createHash('md5').update(seed).digest('hex').slice(0, 12);
}

(async () => {
  const rows = parseCSV(CSV_PATH);
  const active = rows.filter(r => r.Status === 'Active');
  console.log(`Total rows: ${rows.length}  Active: ${active.length}\n`);

  const session = driver.session();
  let upserted = 0, linked = 0, skipped = 0;

  try {
    for (const r of active) {
      const email = (r.Email || '').toLowerCase().trim();
      const phone = (r.Mobile || '').trim();
      const firstName = r.First_Name || '';
      const lastName = r.Last_Name || '';
      const name = `${firstName} ${lastName}`.trim();

      if (!email && !phone) { skipped++; continue; }

      const studentId = makeStudentId(email, name);
      const membershipNumber = r['Membership Number'] || studentId;

      await session.run(
        `MERGE (s:Student {studentId: $studentId})
         ON CREATE SET s.createdAt = datetime(), s.source = 'rezerv', s.country = 'TH'
         SET s.name = COALESCE($name, s.name),
             s.email = COALESCE($email, s.email),
             s.phone = COALESCE($phone, s.phone),
             s.firstName = $firstName,
             s.lastName = $lastName,
             s.lastSyncedFromRezerv = datetime()
         WITH s
         MERGE (m:Membership {membershipNumber: $membershipNumber})
         SET m.type = $type,
             m.status = 'active',
             m.startDate = CASE WHEN $start IS NULL THEN m.startDate ELSE date($start) END,
             m.expiresAt = CASE WHEN $expires IS NULL THEN m.expiresAt ELSE date($expires) END,
             m.source = 'rezerv',
             m.lastBookingDate = $lastBooking,
             m.nextBookingDate = $nextBooking
         MERGE (s)-[:HAS_MEMBERSHIP]->(m)`,
        {
          studentId,
          name: name || null,
          email: email || null,
          phone: phone || null,
          firstName,
          lastName,
          membershipNumber,
          type: r.Membership || 'Unknown',
          start: parseDate(r.Start_Date),
          expires: parseDate(r.Expiration_Date),
          lastBooking: r.Last_Booking_Completed_Date || null,
          nextBooking: r.Next_Booked_Date || null
        }
      );
      upserted++;
      linked++;
      console.log(`  ✓ ${name}  <${email || phone}>`);
    }

    console.log(`\nDone. Upserted: ${upserted}  Linked memberships: ${linked}  Skipped: ${skipped}`);

    const total = await session.run(`MATCH (s:Student)-[:HAS_MEMBERSHIP]->(m:Membership {status: 'active'}) RETURN count(DISTINCT s) AS n`);
    console.log(`Active membership students in DB: ${total.records[0].get('n').toNumber()}`);
  } finally {
    await session.close();
    await driver.close();
  }
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
