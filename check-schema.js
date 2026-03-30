const neo4j = require('neo4j-driver');
const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD || 'aybkk-dev')
);
const session = driver.session();

session.run(`
  MATCH (n) RETURN labels(n), count(*) as cnt ORDER BY cnt DESC
`).then(r => {
  console.log('NODE LABELS:');
  r.records.forEach(rec => {
    console.log('-', rec.get('labels(n)'), ':', rec.get('cnt'));
  });
  session.close();
  driver.close();
}).catch(e => {
  console.error(e.message);
  session.close();
  driver.close();
});