const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
const session = driver.session();

async function check() {
  // Check for Pinn
  const pinn = await session.run(
    "MATCH (s:Student) WHERE s.name CONTAINS 'Pinn' RETURN s.studentId as id, s.name as name"
  );
  console.log('Students with Pinn:', JSON.stringify(pinn.records, null, 2));
  
  // Check LineAccounts
  const lines = await session.run(
    'MATCH (la:LineAccount) RETURN la.uid as uid, la.pendingCode as code, la.linked as linked LIMIT 10'
  );
  console.log('\nLineAccounts:', JSON.stringify(lines.records, null, 2));
  
  // Check linked students
  const linked = await session.run(
    'MATCH (s:Student)-[:HAS_LINE]->(la:LineAccount) RETURN s.name as name, la.uid as uid'
  );
  console.log('\nLinked students:', JSON.stringify(linked.records, null, 2));
  
  session.close();
  driver.close();
}
check().catch(console.error);
