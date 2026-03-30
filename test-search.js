const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
const session = driver.session();

async function main() {
  // Check students with null names
  const r1 = await session.run(`
    MATCH (s:Student)-[:HAS_MEMBERSHIP]->(m:Membership)
    WHERE m.status = 'active' AND m.expiresAt >= date()
    RETURN s.studentId AS id, s.name AS name
    LIMIT 20
  `);
  console.log('First 20 active students - name check:');
  r1.records.forEach(rec => {
    const name = rec.get('name');
    const id = rec.get('id');
    console.log(`  id=${id} name="${name}" type=${typeof name} isNull=${name === null}`);
  });

  // Check all students with null names
  const r2 = await session.run(`
    MATCH (s:Student) WHERE s.name IS NULL RETURN count(s) AS count
  `);
  console.log('\nTotal students with NULL name:', r2.records[0].get('count').toNumber());

  // Check students without name property
  const r3 = await session.run(`
    MATCH (s:Student) WHERE NOT exists(s.name) RETURN count(s) AS count
  `);
  console.log('Total students without name property:', r3.records[0].get('count').toNumber());

  session.close();
  driver.close();
}

main().catch(console.error);
