const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));

async function test() {
  const session = driver.session();
  try {
    // Check Membership nodes
    const memb = await session.run(`MATCH (m:Membership) RETURN keys(m) AS keys LIMIT 3`);
    console.log('Membership properties:');
    memb.records.forEach((r, i) => console.log(` ${i+1}.`, r.get('keys')));

    const membCount = await session.run(`MATCH (m:Membership) RETURN count(m) AS cnt`);
    console.log('\nTotal Membership nodes:', membCount.records[0].get('cnt').toNumber());

    // Check StudentPass nodes
    const sp = await session.run(`MATCH (sp:StudentPass) RETURN keys(sp) AS keys LIMIT 3`);
    console.log('\nStudentPass properties:');
    sp.records.forEach((r, i) => console.log(` ${i+1}.`, r.get('keys')));

    const spCount = await session.run(`MATCH (sp:StudentPass) RETURN count(sp) AS cnt`);
    console.log('Total StudentPass nodes:', spCount.records[0].get('cnt').toNumber());

    // Check Student->Membership relationship
    const studentMemb = await session.run(`
      MATCH (s:Student)-[r:HAS_MEMBERSHIP]->(m:Membership)
      RETURN s.name AS student, m.status AS status, m.expiresAt AS expires
      LIMIT 10
    `);
    console.log('\nStudent → Membership samples:');
    studentMemb.records.forEach(r => console.log(' ', r.get('student'), '|', r.get('status'), '|', r.get('expires')));

    // Check for active memberships (not expired)
    const active = await session.run(`
      MATCH (s:Student)-[:HAS_MEMBERSHIP]->(m:Membership)
      WHERE m.status = 'active' AND m.expiresAt > datetime()
      RETURN count(s) AS cnt
    `);
    console.log('\nActive (non-expired) memberships:', active.records[0].get('cnt').toNumber());

    // Check StudentPass (class packs)
    const spActive = await session.run(`
      MATCH (s:Student)-[:HAS_PASS]->(p:StudentPass)
      RETURN s.name AS student, p.validUntil AS valid, p.classesRemaining AS remaining
      LIMIT 10
    `);
    console.log('\nStudentPass samples:');
    spActive.records.forEach(r => console.log(' ', r.get('student'), '| valid:', r.get('valid'), '| classes:', r.get('remaining')));

  } finally {
    session.close();
    driver.close();
  }
}
test().catch(e => console.log('ERR: ' + e.message));