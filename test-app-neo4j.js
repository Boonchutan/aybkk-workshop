require('dotenv').config();
const neo4j = require('neo4j-driver');
const pwd = process.env.NEO4J_PASSWORD;
console.log('PWD from dotenv:', JSON.stringify(pwd));
console.log('PWD length:', pwd ? pwd.length : 0);

const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', pwd));
driver.verifyConnectivity()
  .then(() => {
    console.log('APP CONNECT OK');
    return driver.session().run('MATCH (n) RETURN count(n) as cnt');
  })
  .then(r => {
    console.log('Nodes in DB:', r.records[0].get('cnt'));
    driver.close();
  })
  .catch(e => console.log('FAIL:', e.message));