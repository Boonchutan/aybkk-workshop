const neo4j = require('neo4j-driver');
const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD || 'aybkk-dev')
);
const session = driver.session();

session.run(`
  MATCH (a:Agora {id: 'aybkk-agora'})-[:CONTAINS]->(x)
  WHERE x.agent = 'neo' AND (x.type = 'result' OR x.type = 'handoff')
  RETURN x.id, x.subject, x.content, x.timestamp ORDER BY x.timestamp DESC LIMIT 20
`).then(r => {
  console.log('NEO RESULTS & HANDOFFS:');
  if(r.records.length === 0) {
    console.log('No results/handoffs found for Neo');
  } else {
    r.records.forEach(rec => {
      console.log('\n---');
      console.log('ID:', rec.get('x.id'));
      console.log('Subject:', rec.get('x.subject'));
      console.log('Content:', rec.get('x.content') ? rec.get('x.content').substring(0, 200) + '...' : 'none');
      console.log('Time:', rec.get('x.timestamp'));
    });
  }
  session.close();
  driver.close();
}).catch(e => {
  console.error(e.message);
  session.close();
  driver.close();
});