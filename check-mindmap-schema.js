const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));

async function check() {
  const session = driver.session();
  
  // Check TeachingStructure
  let result = await session.run('MATCH (ts:TeachingStructure) RETURN ts.name, ts.series, ts.description LIMIT 5');
  console.log('=== TeachingStructures ===');
  result.records.forEach(r => console.log(JSON.stringify(r.toObject())));
  
  // Check TeachingStage
  result = await session.run('MATCH (ts:TeachingStage) RETURN ts.name, ts.description LIMIT 10');
  console.log('\n=== TeachingStages ===');
  result.records.forEach(r => console.log(JSON.stringify(r.toObject())));
  
  // Check Asana sample with all properties
  result = await session.run('MATCH (a:Asana) RETURN a LIMIT 3');
  console.log('\n=== Asana samples ===');
  result.records.forEach(r => {
    const a = r.get(0);
    console.log('name:', a.properties.name, '| keys:', Object.keys(a.properties).join(','));
  });
  
  // Check Tag
  result = await session.run('MATCH (t:Tag) RETURN t.name LIMIT 20');
  console.log('\n=== Tags ===');
  result.records.forEach(r => console.log(r.get(0)));
  
  // Check relationships from Asana
  result = await session.run('MATCH (a:Asana)-[r]->() WHERE a.name IS NOT NULL RETURN type(r), count(*) as cnt ORDER BY cnt DESC LIMIT 10');
  console.log('\n=== Asana relationship types ===');
  result.records.forEach(r => console.log(r.get('type(r)'), r.get('cnt')));
  
  await session.close();
  await driver.close();
}

check().catch(console.error);