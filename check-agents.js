// Check agents in Neo4j
const neo4j = require('neo4j-driver');

async function main() {
  const driver = neo4j.driver(
    'bolt://localhost:7687',
    neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026')
  );
  const session = driver.session();

  try {
    const result = await session.run(`
      MATCH (n:Agent)
      RETURN n.id, n.name, labels(n)
      LIMIT 10
    `);

    console.log('=== Agents in Neo4j ===');
    result.records.forEach(rec => {
      console.log('ID:', rec.get(0));
      console.log('Name:', rec.get(1));
      console.log('Labels:', rec.get(2));
      console.log('---');
    });

    // Also check Agora
    console.log('\n=== Agora ===');
    const agora = await session.run(`MATCH (a:Agora) RETURN a`);
    agora.records.forEach(rec => console.log('Agora:', rec.get(0)));

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);