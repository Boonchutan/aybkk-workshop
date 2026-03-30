const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
const session = driver.session();

async function findPinn() {
  // Find Pinn's LINE UID
  const result = await session.run(
    `MATCH (s:Student)-[r:HAS_LINE]->(la:LineAccount) 
     WHERE s.name CONTAINS 'Pinn'
     RETURN s.name as student, la.uid as lineUid`
  );
  console.log('Pinn with LINE:', JSON.stringify(result.records, null, 2));

  // Find all LineAccounts
  const allLines = await session.run(
    `MATCH (la:LineAccount) 
     RETURN la.uid as uid, keys(la) as props
     ORDER BY la.createdAt DESC LIMIT 10`
  );
  console.log('\nAll LineAccounts:', JSON.stringify(allLines.records, null, 2));

  // Find who just followed (with recent pending code)
  const recent = await session.run(
    `MATCH (la:LineAccount) 
     WHERE la.pendingCode IS NOT NULL
     RETURN la.uid as uid, la.pendingCode as code, la.createdAt as created`
  );
  console.log('\nRecent followers with codes:', JSON.stringify(recent.records, null, 2));

  session.close();
  driver.close();
}
findPinn().catch(console.error);
