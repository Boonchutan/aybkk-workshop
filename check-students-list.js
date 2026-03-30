const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
const session = driver.session();

async function check() {
  const r = await session.run(`
    MATCH (s:Student)-[:HAS_MEMBERSHIP]->(m:Membership)
    WHERE m.status = 'active' AND m.expiresAt >= date()
    RETURN s.name AS name, s.studentId AS id, m.expiresAt AS expires
    ORDER BY s.name ASC
    LIMIT 10
  `);
  console.log('First 10 active students:');
  r.records.forEach(rec => {
    console.log(`  ${rec.get('name')} (id: ${rec.get('id')}, expires: ${rec.get('expires')})`);
  });
  session.close();
  driver.close();
}

check().catch(console.error);
