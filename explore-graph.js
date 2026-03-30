const neo4j = require('neo4j-driver');
const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD || 'aybkk-dev')
);
const session = driver.session();

async function main() {
  // Get BodyParts
  const bodyparts = await session.run(`MATCH (b:BodyPart) RETURN b.name ORDER BY b.name`);
  console.log('BODY PARTS:');
  bodyparts.records.forEach(r => console.log('-', r.get('b.name')));

  // Get MovementTypes
  const movements = await session.run(`MATCH (m:MovementType) RETURN m.name ORDER BY m.name`);
  console.log('\nMOVEMENT TYPES:');
  movements.records.forEach(r => console.log('-', r.get('m.name')));

  // Sample: Shoulders → Asanas
  const shoulders = await session.run(`
    MATCH (b:BodyPart {name: 'Shoulders'})-[:USES_BODYPART]-(a:Asana)
    RETURN a.name LIMIT 10
  `);
  console.log('\nSHOULDERS ASANAS:');
  shoulders.records.forEach(r => console.log('-', r.get('a.name')));

  // Sample: Forward fold movements
  const forward = await session.run(`
    MATCH (a:Asana)-[:INVOLVES]-(m:MovementType {name: 'Forward fold'})
    RETURN a.name LIMIT 10
  `);
  console.log('\nFORWARD FOLD ASANAS:');
  forward.records.forEach(r => console.log('-', r.get('a.name')));

  session.close();
  driver.close();
}

main().catch(e => {
  console.error(e.message);
  session.close();
  driver.close();
});