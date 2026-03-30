// Add Plato agent node
const neo4j = require('neo4j-driver');

async function main() {
  const driver = neo4j.driver(
    'bolt://localhost:7687',
    neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026')
  );
  const session = driver.session();

  try {
    await session.run(`
      MERGE (p:Agent:Person {id: 'plato'})
      SET p.name = 'Plato',
          p.role = 'Writer / Knowledge Organizer',
          p.model = 'minimax m2.7',
          p.reportsTo = 'boonchu-tanti',
          p.focus = 'Books, knowledge organization, teaching materials',
          p.status = 'active',
          p.createdAt = datetime(),
          p.updatedAt = datetime()
      SET p:Plato
    `);
    console.log('✅ Plato node created');

    // Link Plato to Boonchu
    await session.run(`
      MATCH (b:Boonchu {id: 'boonchu-tanti'})
      MATCH (p:Plato {id: 'plato'})
      MERGE (b)-[:WORKS_WITH]->(p)
    `);
    console.log('✅ Boonchu-Plato relationship created');

    // Link Plato to teaching materials topic
    await session.run(`
      MATCH (p:Plato {id: 'plato'})
      MERGE (t:Topic {id: 'teaching-materials'})
      SET t.name = 'Teaching Materials Development', t.status = 'active'
      MERGE (p)-[:WORKING_ON]->(t)
    `);
    console.log('✅ Plato-TeachingMaterials link created');

    // Add Plato to today's session
    await session.run(`
      MATCH (s:Session {id: 'session-${new Date().toISOString().split('T')[0]}'})
      SET s.participants = ['boonchu', 'neo', 'plato']
    `);
    console.log('✅ Plato added to today\'s session');

    console.log('\n✅ Plato is now in the system!');
    console.log('Agents: Neo (tech) + Plato (content) working for Boonchu');

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);