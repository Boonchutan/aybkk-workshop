const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));

async function main() {
  const session = driver.session();
  
  // Check direction from TeachingStage to Asana
  let r = await session.run(`
    MATCH (s:TeachingStage)-[rel]->(a:Asana) 
    RETURN type(rel) as relType, s.name as stageName, a.name as asanaName LIMIT 5
  `);
  console.log('=== TeachingStage -> Asana ===');
  r.records.forEach(rec => console.log(' ', rec.get('relType'), '|', rec.get('stageName'), '->', rec.get('asanaName')));
  
  // Check direction from Asana to TeachingStage
  r = await session.run(`
    MATCH (a:Asana)-[rel]->(s:TeachingStage) 
    RETURN type(rel) as relType, a.name as asanaName, s.name as stageName LIMIT 5
  `);
  console.log('\n=== Asana -> TeachingStage ===');
  r.records.forEach(rec => console.log(' ', rec.get('relType'), '|', rec.get('asanaName'), '->', rec.get('stageName')));

  // Check both directions
  r = await session.run(`
    MATCH (a:Asana)-[rel]-(s:TeachingStage) 
    RETURN DISTINCT type(rel) as relType LIMIT 5
  `);
  console.log('\n=== Asana <-> TeachingStage relationship types ===');
  r.records.forEach(rec => console.log(' ', rec.get('relType')));
  
  await session.close();
  await driver.close();
}

main().catch(e => { console.log('Error:', e.message); process.exit(1); });