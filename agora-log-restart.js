const neo4j = require('neo4j-driver');
const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD || 'aybkk-dev')
);
const session = driver.session();

const now = new Date();

session.run(`
  MATCH (a:Agora {id: 'aybkk-agora'})
  CREATE (a)-[:CONTAINS]->(e:Event {
    id: 'event-' + toString(timestamp()),
    type: 'gateway-restart',
    description: 'All agent gateways restarted by Hermes (Nicco). Found all 4 gateways DEAD. Restarted Plato, Somsri, Neo.',
    agents: ['plato', 'somsri', 'neo'],
    pids: ['58795', '58804', '58812'],
    triggered_by: 'Boonchu',
    timestamp: datetime()
  })
  RETURN e.id
`).then(r => {
  console.log('Logged to Agora:', r.records[0]?.get('e.id'));
  session.close();
  driver.close();
}).catch(e => {
  console.error('Error:', e.message);
  session.close();
  driver.close();
});
