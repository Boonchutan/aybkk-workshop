const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
async function main() {
  const session = driver.session();
  // Check Student node properties
  const studentProps = await session.run('MATCH (s:Student) RETURN keys(s) as props LIMIT 3');
  console.log('Student properties sample:');
  studentProps.records.forEach(r => console.log(JSON.stringify(r.get('props'))));

  // Check specific student
  const s = await session.run('MATCH (s:Student) RETURN s.id as id, s.studentId as studentId, s.name as name LIMIT 5');
  console.log('\nStudent id/studentId sample:');
  s.records.forEach(r => console.log('id:', r.get('id'), '| studentId:', r.get('studentId'), '| name:', r.get('name')));

  await session.close();
  driver.close();
}
main().catch(console.error);