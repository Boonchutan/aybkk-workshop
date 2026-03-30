const neo4j = require('neo4j-driver');
const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD || 'aybkk-dev')
);
const session = driver.session();

session.run(`
  MATCH (a:Agora {id: 'aybkk-agora'})-[:CONTAINS]->(x)
  WHERE x.type = 'task' OR x:Task
  RETURN x.id, x.subject, x.status, x.assigned_to, x.timestamp ORDER BY x.timestamp DESC
`).then(r => {
  console.log('ALL TASKS IN AGORA:');
  if(r.records.length === 0) {
    console.log('No tasks found');
  } else {
    r.records.forEach(rec => {
      console.log('- id:', rec.get('x.id'), '| status:', rec.get('x.status'), '| assigned:', rec.get('x.assigned_to'), '| subject:', rec.get('x.subject'));
    });
  }
  session.close();
  driver.close();
}).catch(e => {
  console.error(e.message);
  session.close();
  driver.close();
});