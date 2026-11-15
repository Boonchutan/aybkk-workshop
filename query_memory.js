require('dotenv').config();
const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD));
const session = driver.session();
session.run('MATCH (m:TeamMemory {id: "aybkk-shared"}) RETURN m.content AS content, m.updatedAt AS updatedAt')
  .then(r => { 
    console.log('Updated:', r.records[0]?.get('updatedAt')); 
    console.log('Content:', r.records[0]?.get('content')); 
  })
  .catch(e => console.log('Error:', e.message))
  .finally(() => { session.close(); driver.close(); });