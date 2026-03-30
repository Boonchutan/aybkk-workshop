const neo4j = require('neo4j-driver');
const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD || 'aybkk-dev')
);
const session = driver.session();

session.run(`
  MATCH (a:Agora {id: 'aybkk-agora'})-[:CONTAINS]->(t:Task)
  WHERE t.status = 'pending' AND (t.assigned_to = 'neo' OR t.assigned_to CONTAINS 'Neo' OR t.assigned_to IS NULL)
  RETURN t ORDER BY t.priority DESC
`).then(r => {
  console.log('PENDING TASKS:');
  r.records.forEach(rec => {
    const t = rec.get('t').properties;
    console.log('-', t.id, '|', t.subject, '| assigned:', t.assigned_to, '| priority:', t.priority);
  });
  if(r.records.length === 0) console.log('No pending tasks found');
  session.close();
  driver.close();
}).catch(e => {
  console.error(e.message);
  session.close();
  driver.close();
});