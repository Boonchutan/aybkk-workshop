const neo4j = require('neo4j-driver');
require('dotenv').config();

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);

async function checkStudents() {
  const session = driver.session();
  try {
    // Count total students
    const countResult = await session.run('MATCH (s:Student) RETURN count(s) as total');
    console.log('Total students in Neo4j:', countResult.records[0].get('total').toNumber());
    
    // Check if Notion data exists
    const notionResult = await session.run('MATCH (s:Student) WHERE s.notionId IS NOT NULL RETURN count(s) as notionCount');
    console.log('Students with Notion ID:', notionResult.records[0].get('notionCount').toNumber());
    
    // Show sample student with attributes
    const sampleResult = await session.run('MATCH (s:Student) RETURN s LIMIT 1');
    const student = sampleResult.records[0].get('s').properties;
    console.log('\nSample student attributes:', Object.keys(student));
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await session.close();
    await driver.close();
  }
}

checkStudents();
