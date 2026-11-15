require('dotenv').config();
const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD));
driver.session().run('MATCH (n) RETURN labels(n)[0] AS label, count(n) AS cnt ORDER BY cnt DESC LIMIT 20')
  .then(r => { r.records.forEach(row => console.log(row.get('label') + ': ' + row.get('cnt'))); driver.close(); })
  .catch(e => console.log('ERR: ' + e.message));