// Get Plato's full content from Agora
const neo4j = require('neo4j-driver');

async function main() {
  const driver = neo4j.driver(
    'bolt://localhost:7687',
    neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026')
  );
  const session = driver.session();

  try {
    const plato = await session.run(`
      MATCH (a:Agora {id: 'aybkk-agora'})-[:CONTAINS]->(x:Artifact)
      WHERE x.agent = 'plato'
      RETURN x.subject as subject, x.content as content, x.type as type
      ORDER BY x.timestamp DESC
      LIMIT 5
    `);

    console.log('=== PLATO\'S AGORA POSTS ===\n');
    plato.records.forEach(rec => {
      console.log(`Subject: ${rec.get('subject')}`);
      console.log(`Type: ${rec.get('type')}`);
      console.log(`Content:`);
      console.log(rec.get('content'));
      console.log('\n---\n');
    });

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);