const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));

async function main() {
  const session = driver.session();
  
  // Get actual internal node id vs properties for Pinn
  const r = await session.run('MATCH (s:Student) WHERE s.name CONTAINS "Pinn" RETURN id(s) as internalId, s.id as storedId, s.studentId as studentId, s.name as name LIMIT 5');
  console.log('=== Student node ids ===');
  r.records.forEach(x => {
    const internalId = x.get('internalId');
    console.log('internal id(s):', internalId, 'stored id:', x.get('storedId'), 'studentId:', x.get('studentId'), 'name:', x.get('name'));
  });
  
  // Check ProgressCheck nodes
  const p = await session.run('MATCH (p:ProgressCheck) RETURN p.studentId as studentId, p.id as pcid LIMIT 10');
  console.log('\n=== ProgressCheck sample ===');
  p.records.forEach(x => {
    console.log('ProgressCheck studentId:', JSON.stringify(x.get('studentId')), 'pcid:', x.get('pcid'));
  });
  
  await session.close();
  await driver.close();
}

main().catch(e => { console.error(e.message); process.exit(1); });