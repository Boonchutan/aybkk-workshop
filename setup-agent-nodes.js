// Check current Neo4j labels and setup agent/person schema
const neo4j = require('neo4j-driver');

async function main() {
  const driver = neo4j.driver(
    'bolt://localhost:7687',
    neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026')
  );
  const session = driver.session();

  try {
    // Get all labels
    const labels = await session.run('CALL db.labels()');
    console.log('Current Labels:', labels.records.map(r => r.get(0)));

    // Create Agent label for all agents
    await session.run(`
      CREATE CONSTRAINT agent_id IF NOT EXISTS
      FOR (a:Agent) REQUIRE a.id IS UNIQUE
    `);
    console.log('✅ Agent constraint created');

    // Create Boonchu node with full profile
    await session.run(`
      MERGE (b:Person:Boonchu {id: 'boonchu-tanti'})
      SET b.name = 'Boonchu Tanti',
          b.role = 'Founder',
          b.telegram = '@boonchu_tanti',
          b.createdAt = datetime()
      RETURN b
    `);
    console.log('✅ Boonchu node created/updated');

    // Create Neo agent node
    await session.run(`
      MERGE (n:Agent:Person {id: 'neo'})
      SET n.name = 'Neo',
          n.role = 'Technical Coder / Systems Architect',
          n.reportsTo = 'Nicco (Technical), Boonchu (Strategic)',
          n.location = '~/mission-control/',
          n.createdAt = datetime()
      RETURN n
    `);
    console.log('✅ Neo agent node created/updated');

    // Create Nicco agent node
    await session.run(`
      MERGE (n:Agent:Person {id: 'nicco'})
      SET n.name = 'Nicco',
          n.role = 'Chief of Staff',
          n.telegram = '@machiav_bot',
          n.reportsTo = 'Boonchu',
          n.createdAt = datetime()
      RETURN n
    `);
    console.log('✅ Nicco agent node created/updated');

    // Create Boonchu-Neo relationship (requests, questions, decisions, results, emotions)
    await session.run(`
      MATCH (b:Person:Boonchu {id: 'boonchu-tanti'})
      MATCH (n:Agent {id: 'neo'})
      MERGE (b)-[r:REQUESTS_TO]->(n)
      SET r.lastUpdated = datetime()
    `);
    console.log('✅ Boonchu-Neo relationship created');

    console.log('\n✅ All agent nodes created!');
    console.log('\nTo view: MATCH (n) RETURN n LIMIT 25');

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);