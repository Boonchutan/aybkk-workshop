require('dotenv').config();
const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD));
driver.verifyConnectivity()
  .then(() => { console.log('OK - NEO4J_PASSWORD works'); driver.close(); })
  .catch(e => console.log('FAIL:', e.message));