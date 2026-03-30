const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));

async function main() {
  const session = driver.session();
  
  // Check existing INVOLVES count
  let r = await session.run('MATCH (a:Asana)-[:INVOLVES]->(t:Tag) RETURN count(DISTINCT a) as asanaWithTags, count(t) as tagCount');
  console.log('Existing INVOLVES:', r.records[0].get('asanaWithTags'), 'asanas with', r.records[0].get('tagCount'), 'total links');
  
  // Check if key Primary asanas have INVOLVES
  r = await session.run(`
    MATCH (a:Asana {name: 'Padangusthasana'})-[r:INVOLVES]->(t:Tag) 
    RETURN a.name, collect(t.name) as tags
  `);
  console.log('\nPadangusthasana INVOLVES:', JSON.stringify(r.records[0]?.toObject() || 'not found'));
  
  // Check if key Intermediate asanas have INVOLVES  
  r = await session.run(`
    MATCH (a:Asana {name: 'Kapotasana'})-[r:INVOLVES]->(t:Tag) 
    RETURN a.name, collect(t.name) as tags
  `);
  console.log('Kapotasana INVOLVES:', JSON.stringify(r.records[0]?.toObject() || 'not found'));
  
  // Check if key Advance A asanas have INVOLVES
  r = await session.run(`
    MATCH (a:Asana {name: 'Hanumanasana'})-[r:INVOLVES]->(t:Tag) 
    RETURN a.name, collect(t.name) as tags
  `);
  console.log('Hanumanasana INVOLVES:', JSON.stringify(r.records[0]?.toObject() || 'not found'));
  
  // Count total asanas in DB
  r = await session.run('MATCH (a:Asana) RETURN count(a) as total');
  console.log('\nTotal asanas in DB:', r.records[0].get('total'));
  
  // Count tags in DB
  r = await session.run('MATCH (t:Tag) RETURN count(t) as total');
  console.log('Total tags in DB:', r.records[0].get('total'));
  
  await session.close();
  await driver.close();
}

main().catch(e => { console.log('Error:', e.message); process.exit(1); });