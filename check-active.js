const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));

async function test() {
  const session = driver.session();
  try {
    // Check active field values
    const result = await session.run(`
      MATCH (s:Student)
      RETURN s.active AS active, count(s) AS cnt
    `);
    console.log('active field distribution:');
    result.records.forEach(r => {
      console.log('  ', r.get('active'), ':', r.get('cnt').toNumber());
    });

    // What properties might indicate recent activity?
    const sample = await session.run(`
      MATCH (s:Student)
      RETURN s.name AS name, s.active AS active, s.createdAt AS created, s.updatedAt AS updated
      LIMIT 10
    `);
    console.log('\nSample student dates:');
    sample.records.forEach(r => console.log(' ', r.get('name'), '| created:', r.get('created'), '| updated:', r.get('updated'), '| active:', r.get('active')));
  } finally {
    session.close();
    driver.close();
  }
}
test().catch(e => console.log('ERR: ' + e.message));