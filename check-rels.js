const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));

async function check() {
  const session = driver.session();
  
  // What does INVOLVES connect to?
  let result = await session.run('MATCH (a:Asana)-[r:INVOLVES]->(t) RETURN type(r), labels(t), count(*) as cnt LIMIT 5');
  console.log('=== INVOLVES relationships ===');
  result.records.forEach(r => console.log('type:', r.get('type(r)'), '| target labels:', JSON.stringify(r.get('labels(t)')), '| count:', r.get('cnt')));
  
  // Check a sample asana with its INVOLVES
  result = await session.run('MATCH (a:Asana {name: " Padangusthasana"})-[:INVOLVES]->(t) RETURN t.name');
  console.log('\n=== Padangusthasana INVOLVES ===');
  result.records.forEach(r => console.log(r.get('t.name')));
  
  // Check Section
  result = await session.run('MATCH (s:Section) RETURN s.name LIMIT 10');
  console.log('\n=== Sections ===');
  result.records.forEach(r => console.log(r.get('s.name')));
  
  // Check TeachingStage-TeachingStructure relationship
  result = await session.run('MATCH (ts:TeachingStructure)-[r]->(s:TeachingStage) RETURN type(r), count(*) as cnt');
  console.log('\n=== TeachingStructure -> TeachingStage relationship ===');
  result.records.forEach(r => console.log('type:', r.get('type(r)'), '| count:', r.get('cnt')));
  
  // Check if TeachingStage has HAS_STAGE or similar
  result = await session.run('MATCH (ts:TeachingStructure)-[r]->() RETURN type(r), count(*) as cnt');
  console.log('\n=== TeachingStructure outgoing ===');
  result.records.forEach(r => console.log('type:', r.get('type(r)'), '| count:', r.get('cnt')));
  
  await session.close();
  await driver.close();
}

check().catch(console.error);
