const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
driver.verifyConnectivity()
  .then(() => { console.log('OK - aybkk_neo4j_2026 works'); driver.close(); })
  .catch(e => console.log('FAIL:', e.message));