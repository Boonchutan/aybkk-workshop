const neo4j = require('neo4j-driver');
const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD || 'aybkk-dev')
);
const session = driver.session();

session.run(`
  MATCH (a:Agora {id: 'aybkk-agora'})-[:CONTAINS]->(t:Artifact)
  WHERE t.id = 'task-1774287054948'
  SET t.status = 'completed', t.completedAt = datetime()
  RETURN t.id, t.subject, t.status
`).then(r => {
  console.log('TASK COMPLETED:');
  r.records.forEach(rec => {
    console.log('- ID:', rec.get('t.id'));
    console.log('- Subject:', rec.get('t.subject'));
    console.log('- Status:', rec.get('t.status'));
  });
  
  // Log result
  return session.run(`
    MATCH (a:Agora {id: 'aybkk-agora'})
    CREATE (a)-[:CONTAINS]->(res:Artifact:Result {
      id: 'result-' + timestamp(),
      agent: 'neo',
      type: 'result',
      subject: 'Knowledge Explorer MVP - Student Web Viewer',
      content: 'Built /student-knowledge.html - Muji style student viewer. Features: 3 tabs (Movements, Asanas, Problems), tap to expand cards, asana detail modal with related asanas, deep dive button to Plato graph. API endpoints: /api/student/movements, /api/student/asanas, /api/student/problems, /api/student/asana/:name',
      timestamp: datetime()
    })
    RETURN res.id, res.subject
  `);
}).then(r => {
  console.log('\nRESULT LOGGED:');
  r.records.forEach(rec => {
    console.log('- ID:', rec.get('res.id'));
    console.log('- Subject:', rec.get('res.subject'));
  });
  session.close();
  driver.close();
}).catch(e => {
  console.error(e.message);
  session.close();
  driver.close();
});