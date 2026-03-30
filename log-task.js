const neo4j = require('neo4j-driver');
const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD || 'aybkk-dev')
);
const session = driver.session();

session.run(`
  MATCH (a:Agora {id: 'aybkk-agora'})
  CREATE (a)-[:CONTAINS]->(t:Artifact:Task {
    id: 'task-' + timestamp(),
    agent: 'neo',
    type: 'task',
    subject: 'Knowledge Explorer MVP - Student Web Viewer',
    content: 'Build simple web viewer where students can: 1) Browse categories (Body Areas, Asanas, Problems), 2) Tap to see related items, 3) Deep dive into Plato graph. Example: Shoulders → Weak in Chaturanga/Bakasana → Strengthen with Pincha prep → Related videos.',
    status: 'in_progress',
    assigned_to: 'neo',
    priority: 'high',
    estimated_hours: 3,
    cost: '$0 (existing server, Neo4j)',
    timestamp: datetime()
  })
  RETURN t.id, t.subject
`).then(r => {
  console.log('TASK LOGGED:');
  r.records.forEach(rec => {
    console.log('- ID:', rec.get('t.id'));
    console.log('- Subject:', rec.get('t.subject'));
  });
  session.close();
  driver.close();
}).catch(e => {
  console.error(e.message);
  session.close();
  driver.close();
});