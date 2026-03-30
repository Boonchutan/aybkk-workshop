const neo4j = require('neo4j-driver');

async function main() {
  const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
  const session = driver.session();
  
  try {
    // Read recent Agora posts
    const result = await session.run(`
      MATCH (a:Agora {id: 'aybkk-agora'})-[:CONTAINS]->(x)
      WHERE x:Artifact OR x:Action OR x:Task OR x:Decision
      RETURN x ORDER BY x.timestamp DESC LIMIT 20
    `);
    
    console.log('AGORA RECENT POSTS:');
    if (result.records.length === 0) {
      console.log('(empty)');
    }
    result.records.forEach(r => {
      const n = r.get('x').properties;
      console.log('---');
      console.log('Type:', r.get('x').labels[0]);
      console.log('Subject:', n.subject || n.title || 'N/A');
      console.log('Content:', (n.content || '').substring(0, 200));
      console.log('By:', n.agentId, '| Time:', n.timestamp);
    });
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);