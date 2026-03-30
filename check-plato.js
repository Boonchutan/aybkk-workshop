const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
const session = driver.session();

async function checkPlato() {
  // Get Plato details
  const plato = await session.run(
    `MATCH (n:Plato) RETURN n.id as id, n.name as name, properties(n) as props LIMIT 10`
  );
  console.log('Plato node:', JSON.stringify(plato.records.map(r => r.toObject()), null, 2));

  // Check relationships
  const rels = await session.run(
    `MATCH (p:Plato)-[r]->(n) RETURN labels(p) as from, type(r) as rel, labels(n) as to, n.id as id LIMIT 30`
  );
  console.log('\nPlato relationships:');
  rels.records.forEach(r => console.log(`  ${r.get('from')} -> [${r.get('rel')}] -> ${r.get('to')}: ${r.get('id')}`));

  // Get Plato's memory/messages
  const memory = await session.run(
    `MATCH (p:Plato)-[:HAS_MEMORY|HAS_TASK|HAS_CONTEXT]->(m) 
     RETURN labels(m)[0] as type, m.id as id, m.content as content, m.timestamp as ts
     ORDER BY m.timestamp DESC LIMIT 20`
  );
  console.log('\nPlato memory:');
  memory.records.forEach(r => console.log(`  [${r.get('type')}] ${r.get('id')}: ${r.get('content')?.toString().slice(0,100)}`));

  session.close();
  driver.close();
}
checkPlato().catch(e => { console.error(e.message); process.exit(1); });
