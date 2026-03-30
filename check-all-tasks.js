const neo4j = require('neo4j-driver');
const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD || 'aybkk-dev')
);
const session = driver.session();

session.run(`
  MATCH (t:Task) RETURN t.id, t.subject, t.status, t.assigned_to ORDER BY t.status
`).then(r => {
  console.log('ALL TASKS:');
  if(r.records.length === 0) {
    console.log('No Task nodes found');
  } else {
    r.records.forEach(rec => {
      console.log('- id:', rec.get('t.id'), '| status:', rec.get('t.status'), '| assigned:', rec.get('t.assigned_to'), '| subject:', rec.get('t.subject'));
    });
  }
  session.close();
  driver.close();
}).catch(e => {
  console.error(e.message);
  session.close();
  driver.close();
});