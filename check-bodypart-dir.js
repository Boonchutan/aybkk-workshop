// Check USES_BODYPART direction
const neo4j = require('neo4j-driver');

async function main() {
  const driver = neo4j.driver(
    'bolt://localhost:7687',
    neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026')
  );
  const session = driver.session();

  try {
    // Check direction: Asana -> BodyPart
    console.log('=== Asana -> BodyPart ===');
    const r1 = await session.run(`
      MATCH (a:Asana)-[r:USES_BODYPART]->(bp:BodyPart)
      RETURN a.name as asana, bp.name as bodyPart
      LIMIT 5
    `);
    r1.records.forEach(rec => console.log(rec.get('asana'), '->', rec.get('bodyPart')));

    // Check reverse direction: BodyPart -> Asana
    console.log('\n=== BodyPart -> Asana ===');
    const r2 = await session.run(`
      MATCH (bp:BodyPart)<-[r:USES_BODYPART]-(a:Asana)
      RETURN bp.name as bodyPart, a.name as asana
      LIMIT 5
    `);
    r2.records.forEach(rec => console.log(rec.get('bodyPart'), '<-', rec.get('asana')));

    // Count total
    console.log('\n=== Total ===');
    const r3 = await session.run(`
      MATCH (a:Asana)-[:USES_BODYPART]->(bp:BodyPart)
      RETURN count(*) as total
    `);
    console.log('Total relationships:', r3.records[0].get('total').low);

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);