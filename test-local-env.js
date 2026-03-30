require('dotenv').config({ path: '.env.local' });
console.log('PWD:', process.env.NEO4J_PASSWORD, 'LEN:', process.env.NEO4J_PASSWORD ? process.env.NEO4J_PASSWORD.length : 0);
const neo4j = require('neo4j-driver');
const driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD));
driver.verifyConnectivity()
  .then(() => { console.log('APP CONNECT OK'); driver.close(); })
  .catch(e => console.log('FAIL:', e.message));