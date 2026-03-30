const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
driver.session().run('MATCH (n) RETURN labels(n)[0] AS label, count(n) AS cnt ORDER BY cnt DESC LIMIT 20')
  .then(r => { r.records.forEach(row => console.log(row.get('label') + ': ' + row.get('cnt'))); driver.close(); })
  .catch(e => console.log('ERR: ' + e.message));