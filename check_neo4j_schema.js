const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'), { encrypted: 'ENCRYPTION_OFF' });
const session = driver.session();

async function main() {
  // Existing labels
  const labels = await session.run('CALL db.labels()');
  console.log('Labels:', labels.records.map(r => r.get(0)));

  // Relationship types
  const rels = await session.run('CALL db.relationshipTypes()');
  console.log('Rel types:', rels.records.map(r => r.get(0)));

  // Sample Student
  const s = await session.run('MATCH (s:Student) RETURN s LIMIT 3');
  if (s.records.length > 0) {
    const props = s.records[0].get('s').properties;
    console.log('\nSample Student props:', Object.keys(props));
  }

  // Count
  const cnt = await session.run('MATCH (s:Student) RETURN count(s) as c');
  console.log('Student count:', cnt.records[0].get('c'));

  await session.close();
  await driver.close();
}
main().catch(e => console.error(e.message));