const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
const session = driver.session();

async function debug() {
  // Test exact searchStudents query from the bot
  const query = 'Pin';
  const result = await session.run(`
    MATCH (s:Student)-[:HAS_MEMBERSHIP]->(m:Membership)
    WHERE toLower(s.name) CONTAINS toLower($query)
      AND m.status = 'active' AND m.expiresAt >= date()
    OPTIONAL MATCH (a:Assessment)-[:FOR_STUDENT]->(s)
    RETURN s.name AS name, s.studentId AS id,
           count(DISTINCT a) AS assessmentCount
    ORDER BY assessmentCount DESC, s.name ASC
    LIMIT 20
  `, { query });

  console.log(`Search for "${query}":`);
  console.log(`  Found: ${result.records.length}`);
  result.records.forEach(r => {
    console.log(`  - ${r.get('name')} (${r.get('id')})`);
  });

  // Also check if "Pin" exists in any student name
  const allResult = await session.run(`
    MATCH (s:Student)-[:HAS_MEMBERSHIP]->(m:Membership)
    WHERE toLower(s.name) CONTAINS 'pin'
      AND m.status = 'active' AND m.expiresAt >= date()
    RETURN s.name AS name
  `);
  console.log(`\nAll names containing "pin": ${allResult.records.length}`);
  allResult.records.forEach(r => console.log(`  ${r.get('name')}`));

  // Check what names exist
  const sample = await session.run(`
    MATCH (s:Student)-[:HAS_MEMBERSHIP]->(m:Membership)
    WHERE m.status = 'active' AND m.expiresAt >= date()
    RETURN s.name AS name LIMIT 10
  `);
  console.log(`\nFirst 10 active students:`);
  sample.records.forEach(r => console.log(`  ${r.get('name')}`));

  session.close();
  driver.close();
}

debug().catch(console.error);
