const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
const session = driver.session();
session.run(`
  MATCH (m:TeamMemory {id: 'aybkk-shared'})
  RETURN m.content AS content, m.updatedAt AS updatedAt
`).then(r => {
  if (r.records.length) {
    const mem = r.records[0].get('content');
    const ts = r.records[0].get('updatedAt');
    console.log('Updated:', ts, '\n');
    console.log(mem);
  } else {
    console.log('No TeamMemory found');
  }
  session.close();
  driver.close();
}).catch(e => console.error(e));
