require('dotenv').config();
const neo4j = require('neo4j-driver');

const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    'aybkk_neo4j_2026'
  )
);

async function test() {
  const session = driver.session();
  try {
    const result = await session.run('RETURN 1 as num');
    console.log('Neo4j connected! Result:', result.records[0].get('num'));
  } catch (err) {
    console.log('Neo4j error:', err.message);
  }
  await session.close();
  await driver.close();
}

test();
