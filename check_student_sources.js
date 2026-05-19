const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'), { encrypted: 'ENCRYPTION_OFF' });
const session = driver.session();

async function main() {
  // Check sources
  try {
    const src = await session.run('MATCH (s:Student) WHERE s.source IS NOT NULL RETURN s.source AS src, count(*) AS c ORDER BY c DESC');
    console.log('Sources:', src.records.map(r => ({ src: r.get('src'), c: r.get('c').toInt() })));
  } catch(e) { console.log('Source query error:', e.message); }

  // Check if russia-ws-2026 already exists
  try {
    const ru = await session.run('MATCH (s:Student {source: "russia-ws-2026"}) RETURN count(s) AS c');
    console.log('\nRussia WS 2026 students already in Neo4j:', ru.records[0].get('c').toInt());
  } catch(e) { console.log('Russia query error:', e.message); }

  // Sample student with photo/journals
  try {
    const s = await session.run('MATCH (s:Student) WHERE s.journalLink IS NOT NULL RETURN s.name, s.source, s.journalLink LIMIT 3');
    console.log('\nStudents with journalLink:');
    s.records.forEach(r => console.log(' ', r.get('s.name') || r.get('name'), '|', r.get('s.source') || '', '|', r.get('s.journalLink') || r.get('journalLink')));
  } catch(e) { console.log('journalLink error:', e.message); }

  await session.close();
  await driver.close();
}
main().catch(e => console.error(e.message));