const neo4j = require('neo4j-driver');
const passwords = ['neo4j', 'password', '...2026', 'aybkk123', 'test123'];
(async () => {
  for (const pwd of passwords) {
    const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', pwd));
    try {
      await driver.verifyConnectivity();
      console.log('WORKING PASSWORD:', pwd);
      await driver.close();
      break;
    } catch (e) {
      console.log('FAIL:', pwd, '-', e.message);
    }
  }
})();