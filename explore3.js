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
  asana.records.forEach(r => console.log('- name:', r.get('a.name'), '| sanskrit:', r.get('a.sanskrit'), '| english:', r.get('a.english')));

  // Check INVOLVES between Asana and MovementType
  const inv = await session.run(`MATCH (a:Asana)-[r:INVOLVES]->(m:MovementType) RETURN a.name, m.name LIMIT 5`);
  console.log('\nINVOLVES SAMPLE:');
  inv.records.forEach(r => console.log('-', r.get('a.name'), '->', r.get('m.name')));

  // Get asanas that involve arms/shoulders
  const arm = await session.run(`
    MATCH (a:Asana)-[:INVOLVES]->(m:MovementType)
    WHERE m.name CONTAINS 'Arm' OR m.name CONTAINS 'Shoulder'
    RETURN a.name, collect(m.name) as movements LIMIT 15
  `);
  console.log('\nASANAS WITH ARM/SHOULDER MOVEMENTS:');
  arm.records.forEach(r => console.log('-', r.get('a.name'), ':', r.get('movements').join(', ')));

  // Get all unique movement types used
  const movements = await session.run(`MATCH (a:Asana)-[:INVOLVES]->(m:MovementType) RETURN m.name ORDER BY m.name`);
  console.log('\nALL MOVEMENT TYPES:');
  movements.records.forEach(r => console.log('-', r.get('m.name')));

  session.close();
  driver.close();
}

main().catch(e => {
  console.error(e.message);
  session.close();
  driver.close();
});