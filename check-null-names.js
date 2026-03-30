const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
const session = driver.session();

async function main() {
  const studentId = '79f2bba9-72a3-4136-bfa5-16426472a9c6'; // JunePinyupa

  // Test student lookup (was broken)
  const r = await session.run(`
    MATCH (s:Student {studentId: $id})
    RETURN s.name AS name
  `, { id: studentId });
  console.log('Student lookup by studentId:', r.records.length > 0 ? r.records[0].get('name') : 'NOT FOUND');

  // Test tag lookup (was broken)
  const r2 = await session.run(`
    MATCH (s:Student {studentId: $id})-[r:HAS_CURRENT]->(t:Tag)
    RETURN t.name AS name, t.type AS type
  `, { id: studentId });
  console.log('Tags for student:', r2.records.length);
  r2.records.forEach(rec => console.log(`  ${rec.get('type')}: ${rec.get('name')}`));

  session.close();
  driver.close();
}

main().catch(e => { console.error(e.message); process.exit(1); });
