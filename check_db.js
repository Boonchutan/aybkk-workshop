const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
async function main() {
  const session = driver.session();
  const tags = await session.run('MATCH (t:Tag) RETURN t.name as name, t.type as type ORDER BY t.name');
  console.log('=== ALL TAGS ===');
  tags.records.forEach(r => console.log(r.get('type') + ': ' + r.get('name')));
  const students = await session.run('MATCH (s:Student) RETURN s.name as name LIMIT 30');
  console.log('\n=== SAMPLE STUDENTS ===');
  students.records.forEach(r => console.log(r.get('name')));
  await session.close();
  driver.close();
}
main().catch(console.error);