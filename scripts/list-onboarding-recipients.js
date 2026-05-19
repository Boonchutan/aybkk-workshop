#!/usr/bin/env node
/**
 * List active Rezerv students who have an email but have NOT linked LINE yet.
 * Used to generate the onboarding email recipient list.
 *
 * Run via:  railway run node scripts/list-onboarding-recipients.js
 */
require('dotenv').config();
const neo4j = require('neo4j-driver');

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);

(async () => {
  const session = driver.session();
  try {
    const r = await session.run(`
      MATCH (s:Student)-[:HAS_MEMBERSHIP]->(m:Membership {status: 'active'})
      WHERE s.email IS NOT NULL AND s.email <> ''
      OPTIONAL MATCH (s)-[:HAS_LINE]->(la:LineAccount)
      WITH s, la
      WHERE la IS NULL
      RETURN s.email AS email, s.name AS name
      ORDER BY name
    `);
    const list = r.records.map(row => ({ email: row.get('email'), name: row.get('name') }));
    console.log(`Active members without LINE: ${list.length}`);
    list.forEach(r => console.log(`  ${r.name}\t${r.email}`));
    console.log('\n--- BCC line ---');
    console.log(list.map(r => r.email).join(', '));
  } finally {
    await session.close();
    await driver.close();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
