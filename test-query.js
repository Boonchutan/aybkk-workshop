const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
const session = driver.session();

// Test the asanas query
session.run(`
  MATCH (a:Asana)-[:BELONGS_TO]->(stage:TeachingStage)-[:HAS_STAGE]->(ts:TeachingStructure)
  OPTIONAL MATCH (a)-[:INVOLVES]->(tag:Tag)
  OPTIONAL MATCH (a)-[:IN_SECTION]->(sec:Section)
  RETURN a.name as name, stage.name as stage, ts.series as series, count(tag) as tagCount
  LIMIT 5
`).then(r => {
  console.log('Asanas query result:', r.records.length, 'records');
  r.records.forEach(rec => console.log(' ', JSON.stringify(rec.toObject())));
  session.close();
  driver.close();
}).catch(e => { console.log('Error:', e.message); process.exit(1); });