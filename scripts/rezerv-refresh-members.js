#!/usr/bin/env node
/**
 * Pull live customers list from Rezerv API and upsert into AuraDB as
 * Student + Membership nodes. Replaces the stale CSV import.
 *
 *   REZERV_COOKIE='...' railway run node scripts/rezerv-refresh-members.js
 *   REZERV_COOKIE='...' railway run node scripts/rezerv-refresh-members.js --dry-run
 */
require('dotenv').config();
const crypto = require('crypto');
const neo4j = require('neo4j-driver');
const rz = require('../lib/rezerv-client');

const dryRun = process.argv.includes('--dry-run');

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);

function makeStudentId(email, name) {
  const seed = (email || name || '').toLowerCase();
  return 'rz_' + crypto.createHash('md5').update(seed).digest('hex').slice(0, 12);
}

(async () => {
  console.log('Fetching customers from Rezerv API…');
  const customers = await rz.listCustomers({ status: '' });
  console.log(`Got ${customers.length} customers from Rezerv.`);

  if (!customers.length) {
    console.log('Nothing to do. Sample of expected fields would help — first row received:');
    return;
  }
  console.log('First customer (for field-shape sanity):');
  console.log(JSON.stringify(customers[0], null, 2).slice(0, 800));
  console.log('—'.repeat(40));

  if (dryRun) { console.log('DRY RUN — not writing to DB.'); return; }

  const session = driver.session();
  let upserted = 0;
  let active = 0;
  try {
    for (const c of customers) {
      // Real Rezerv customer shape: { cId, name, email, telephone, status, membership, joinedDate }
      const email = (c.email || '').toLowerCase().trim();
      const phone = (c.telephone || c.mobile || '').trim();
      const fullName = (c.name || '').trim();
      const status = (c.status || '').toLowerCase();
      const cId = c.cId || null;

      if (!email && !phone) continue;

      const studentId = cId ? `rz_${cId}` : makeStudentId(email, fullName);

      await session.run(
        `MERGE (s:Student {studentId: $studentId})
         ON CREATE SET s.createdAt = datetime(), s.source = 'rezerv', s.country = 'TH'
         SET s.name = COALESCE($name, s.name),
             s.email = COALESCE($email, s.email),
             s.phone = COALESCE($phone, s.phone),
             s.rezervCId = $cId,
             s.lastSyncedFromRezerv = datetime(),
             s.rezervStatus = $status`,
        { studentId, name: fullName || null, email: email || null,
          phone: phone || null, cId, status }
      );

      if (status === 'active') {
        active++;
        const membershipId = cId ? `mem_${cId}` : `mem_${studentId}`;
        await session.run(
          `MATCH (s:Student {studentId: $studentId})
           MERGE (m:Membership {membershipNumber: $membershipId})
           SET m.status = 'active',
               m.type = $type,
               m.source = 'rezerv',
               m.syncedAt = datetime()
           MERGE (s)-[:HAS_MEMBERSHIP]->(m)`,
          { studentId, membershipId, type: c.membership || 'Member' }
        );
      }
      upserted++;
    }

    // Mark memberships not present in this sync as not-active
    // (we keep the node but flip status — never delete history)
    await session.run(
      `MATCH (m:Membership {source: 'rezerv'})
       WHERE m.syncedAt < datetime() - duration('PT1H') AND m.status = 'active'
       SET m.status = 'inactive'`
    );

    console.log(`\nUpserted ${upserted} students.  Active memberships flagged: ${active}.`);
  } finally {
    await session.close();
    await driver.close();
  }
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
