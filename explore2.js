const neo4j = require('neo4j-driver');
const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD || 'aybkk-dev')
);
const session = driver.session();

async function main() {
  // Check Asana properties
  const asana = await session.run(`MATCH (a:Asana) RETURN a.name, a.sanskrit, a.english LIMIT 3`);
  console.log('SAMPLE ASANA:');
  asana.records.forEach(r => console.log('-', JSON.stringify(r.get('a'))));

  // Check how BodyPart connects to Asana
  const bp = await session.run(`MATCH (b:BodyPart {name: 'Shoulders'})-->(a) RETURN b, a LIMIT 5`);
  console.log('\nBODY PART CONNECTIONS:');
  bp.records.forEach(r => console.log('-', JSON.stringify(r.get('b').properties), '->', JSON.stringify(r.get('a').properties)));

  // Check INVOLVES between Asana and MovementType
  const inv = await session.run(`MATCH (a:Asana)-[r:INVOLVES]->(m) RETURN a.name, m.name LIMIT 5`);
  console.log('\nINVOLVES SAMPLE:');
  inv.records.forEach(r => console.log('-', r.get('a.name'), '->', r.get('m.name')));

  // Get asanas that involve shoulders or arm strength
  const arm = await session.run(`
    MATCH (a:Asana)-[:INVOLVES]->(m:MovementType)
    WHERE m.name CONTAINS 'Arm' OR m.name CONTAINS 'Shoulder'
    RETURN a.name, collect(m.name) as movements LIMIT 10
  `);
  console.log('\nASANAS WITH ARM/SHOULDER:');
  arm.records.forEach(r => console.log('-', r.get('a.name'), ':', r.get('movements').join(', ')));

  session.close();
  driver.close();
}

main().catch(e => {
  console.error(e.message);
  session.close();
  driver.close();
});