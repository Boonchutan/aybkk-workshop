const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
const session = driver.session();
session.run('MATCH (ts:TeachingStructure) RETURN ts.name, ts.series')
  .then(r => { console.log('DB OK:', r.records.length, 'structures'); session.close(); driver.close(); })
  .catch(e => { console.log('DB FAIL:', e.message); process.exit(1); });