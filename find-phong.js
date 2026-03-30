const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
const session = driver.session();

async function findPhong() {
  // Find all students
  const students = await session.run(
    `MATCH (s:Student) RETURN s.studentId as id, s.name as name ORDER BY s.name`
  );
  console.log('All students:', JSON.stringify(students.records.map(r => ({id: r.get('id'), name: r.get('name')})), null, 2));

  // LineAccount with code 7488 - who is this?
  const code7488 = await session.run(
    `MATCH (la:LineAccount {pendingCode: '7488'}) RETURN la.uid as uid`
  );
  console.log('\nUID for code 7488:', JSON.stringify(code7488.records));

  // All LineAccounts with pending codes
  const pending = await session.run(
    `MATCH (la:LineAccount) WHERE la.pendingCode IS NOT NULL RETURN la.uid, la.pendingCode`
  );
  console.log('\nAll pending codes:', JSON.stringify(pending.records));

  session.close();
  driver.close();
}
findPhong().catch(console.error);
