const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
const session = driver.session();

const cypher = `MATCH (a:Agora {id: 'aybkk-agora'})-[:CONTAINS]->(x:Action)
WHERE x.action = 'LINE Student Bot deployed'
SET x.status = 'webhook_verified', x.webhook_verified_at = datetime()
RETURN x.id, x.status`;

session.run(cypher, {}).then(r => {
  console.log('Updated:', JSON.stringify(r.records));
  session.close();
  driver.close();
}).catch(e => console.error(e));
