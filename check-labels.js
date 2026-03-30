const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
// Check for Session, CheckIn, Attendance labels
driver.session().run('CALL db.labels() YIELD label WHERE label CONTAINS "Session" OR label CONTAINS "Check" OR label CONTAINS "Attendance" RETURN label')
  .then(r => { console.log('Labels found:', r.records.map(x=>x.get('label'))); driver.close(); })
  .catch(e => console.log('ERR: ' + e.message));