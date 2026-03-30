const neo4j = require('neo4j-driver');
const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD || 'aybkk-dev')
);
const session = driver.session();

session.run(`
  MATCH (a:Agora {id: 'aybkk-agora'})-[:CONTAINS]->(x)
  WHERE (x.agent = 'boonchu' OR x.agent = 'nicco') AND x.timestamp > datetime() - duration('P1D')
  RETURN x.id, x.type, x.subject, x.content, x.agent, x.timestamp ORDER BY x.timestamp DESC
`).then(r => {
  console.log('BOONCHU/NICCO POSTS LAST 24H:');
  if(r.records.length === 0) {
    console.log('No posts found');
  } else {
    r.records.forEach(rec => {
      console.log('\n---');
      console.log('Agent:', rec.get('x.agent'));
      console.log('Type:', rec.get('x.type'));
      console.log('Subject:', rec.get('x.subject'));
      console.log('Content:', rec.get('x.content') ? rec.get('x.content').substring(0, 300) : 'none');
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