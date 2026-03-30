const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
const session = driver.session();

async function checkMemory() {
  // Just check Agora node
  const agora = await session.run(
    `MATCH (a:Agora) RETURN a.id as id, a.name as name, a.codename as codename LIMIT 10`
  );
  console.log('Agora nodes:', JSON.stringify(agora.records.map(r => r.toObject()), null, 2));

  // Check for Plato in any property
  const plato = await session.run(
    `MATCH (n) 
     WHERE n.name = 'Plato' OR n.codename = 'plato' OR n.id = 'plato'
     RETURN labels(n) as type, n.id as id, n.name as name LIMIT 20`
  );
  console.log('\nPlato:', JSON.stringify(plato.records.map(r => r.toObject()), null, 2));

  // Check all node types with count
  const counts = await session.run(
    `MATCH (n) RETURN labels(n)[0] as type, count(*) as count ORDER BY count DESC LIMIT 20`
  );
  console.log('\nNode counts:', JSON.stringify(counts.records.map(r => r.toObject()), null, 2));

  session.close();
  driver.close();
}
checkMemory().catch(e => { console.error(e); process.exit(1); });
