const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
const session = driver.session();

async function check() {
  const result = await session.run("MATCH (s:Student {name: 'Pinn Kant'}) RETURN s");
  if (result.records.length > 0) {
    const s = result.records[0].get('s');
    const props = s.properties;
    console.log('Properties:', props);
    console.log('ID type:', typeof props.id);
    console.log('ID value:', props.id);
    console.log('ID .toNumber():', props.id.toNumber ? props.id.toNumber() : 'N/A');
  } else {
    console.log('Pinn Kant not found');
  }
  
  // Check a few students to understand ID structure
  const all = await session.run("MATCH (s:Student) RETURN s.id as id, s.name as name LIMIT 5");
  console.log('\nSample students:');
  all.records.forEach(r => {
    console.log('  ', r.get('name'), '- id:', r.get('id'), '- type:', typeof r.get('id'));
  });
  
  await session.close();
  await driver.close();
}

check().catch(console.error);