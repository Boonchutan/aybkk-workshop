require('dotenv').config();
const neo4j = require('neo4j-driver');

// Override password from docker env
const password = '...2026';

console.log('=== Testing Neo4j ===');
console.log('Env user:', process.env.NEO4J_USER);
console.log('Testing password: ...2026');

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', password)
);

async function test() {
  const session = driver.session();
  try {
    const result = await session.run('RETURN 1 as num');
    console.log('SUCCESS!');
    return true;
  } catch (err) {
    console.log('Failed:', err.message);
    return false;
  } finally {
    await session.close();
    await driver.close();
  }
}

test().then(process.exit);