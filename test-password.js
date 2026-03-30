require('dotenv').config();
const neo4j = require('neo4j-driver');

// The password from docker env NEO4J_AUTH=neo4j/...2026
const password = '...2026';

console.log('=== Testing Neo4j Password ===');
console.log('Using password from NEO4J_AUTH env');

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', password)
);

async function test() {
  const session = driver.session();
  try {
    const result = await session.run('RETURN 1 as num');
    console.log('SUCCESS! Neo4j connected!');
    console.log('Result:', result.records[0].get('num'));
    
    // Check existing nodes
    const count = await session.run('MATCH (n) RETURN count(n) as cnt');
    console.log('Total nodes:', count.records[0].get('cnt'));
    
    // Check Tag nodes
    const tags = await session.run('MATCH (t:Tag) RETURN count(t) as cnt');
    console.log('Tag nodes:', tags.records[0].get('cnt'));
    
    // Check Student nodes
    const students = await session.run('MATCH (s:Student) RETURN count(s) as cnt');
    console.log('Student nodes:', students.records[0].get('cnt'));
    
    return true;
  } catch (err) {
    console.log('Error:', err.message);
    return false;
  } finally {
    await session.close();
    await driver.close();
  }
}

test().then(success => process.exit(success ? 0 : 1));