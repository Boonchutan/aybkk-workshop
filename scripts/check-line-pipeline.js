#!/usr/bin/env node
/**
 * One-shot diagnostic: read prod Neo4j and report the state of the LINE pipeline.
 * Run via:  railway run node scripts/check-line-pipeline.js
 */
const neo4j = require('neo4j-driver');

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);

async function q(cypher, params = {}) {
  const s = driver.session();
  try { return (await s.run(cypher, params)).records; }
  finally { await s.close(); }
}

(async () => {
  console.log(`Connected to ${process.env.NEO4J_URI}\n`);

  const totalStudents = (await q(`MATCH (s:Student) RETURN count(s) AS n`))[0].get('n').toNumber();
  console.log(`Total Students: ${totalStudents}`);

  const activeMembers = (await q(`
    MATCH (s:Student)-[:HAS_MEMBERSHIP]->(m:Membership {status: 'active'})
    RETURN count(DISTINCT s) AS n
  `))[0].get('n').toNumber();
  console.log(`Active membership students: ${activeMembers}`);

  const withEmail = (await q(`
    MATCH (s:Student)-[:HAS_MEMBERSHIP]->(m:Membership {status: 'active'})
    WHERE s.email IS NOT NULL AND s.email <> ''
    RETURN count(DISTINCT s) AS n
  `))[0].get('n').toNumber();
  console.log(`Active + has email (for onboarding): ${withEmail}`);

  const lineAccounts = (await q(`MATCH (la:LineAccount) RETURN count(la) AS n`))[0].get('n').toNumber();
  console.log(`\nLineAccount nodes (any status): ${lineAccounts}`);

  const followers = (await q(`MATCH (la:LineAccount) WHERE la.followedBot = true RETURN count(la) AS n`))[0].get('n').toNumber();
  console.log(`LINE followers (followedBot=true): ${followers}`);

  const linkedToStudent = (await q(`MATCH (:Student)-[:HAS_LINE]->(la:LineAccount) RETURN count(la) AS n`))[0].get('n').toNumber();
  console.log(`LineAccounts linked to a Student: ${linkedToStudent}`);

  const reachableNow = (await q(`
    MATCH (s:Student)-[:HAS_MEMBERSHIP]->(m:Membership {status: 'active'})
    MATCH (s)-[:HAS_LINE]->(la:LineAccount)
    WHERE la.followedBot = true AND la.unfollowedAt IS NULL
    RETURN count(DISTINCT s) AS n
  `))[0].get('n').toNumber();
  console.log(`\n>>> Reachable today by LINE push (active + linked + following): ${reachableNow}`);

  // Recent followers (last 24h)
  const recent = await q(`
    MATCH (la:LineAccount)
    WHERE la.createdAt > datetime() - duration('PT24H')
    RETURN la.uid AS uid, la.createdAt AS at
    ORDER BY at DESC
    LIMIT 10
  `);
  if (recent.length) {
    console.log(`\nRecent LineAccount entries (last 24h):`);
    for (const r of recent) console.log(`  ${r.get('uid')}  ${r.get('at')}`);
  } else {
    console.log(`\nNo LineAccount entries in last 24h.`);
  }

  await driver.close();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
