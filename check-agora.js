const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
const session = driver.session();
session.run('MATCH (a:Agora {id: "aybkk-agora"})-[:CONTAINS]->(x) WHERE x:Artifact OR x:Action OR x:Task OR x:Decision RETURN x ORDER BY x.timestamp DESC LIMIT 20')
  .then(r => {
    r.records.forEach(rec => {
      const n = rec.get(0);
      console.log(JSON.stringify({type: n.labels[0], content: n.properties.content, source: n.properties.source, timestamp: n.properties.timestamp}, null, 2));
    });
    driver.close();
  })
  .catch(e => { console.error(e.message); driver.close(); });