// Check Plato's relationship types
const neo4j = require('neo4j-driver');

async function main() {
  const driver = neo4j.driver(
    'bolt://localhost:7687',
    neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026')
  );
  const session = driver.session();

  try {
    // Get all relationship types
    console.log('=== RELATIONSHIP TYPES ===');
    const rels = await session.run(`CALL db.relationshipTypes()`);
    rels.records.forEach(r => console.log(r.get(0)));

    // Check how asanas relate to body parts
    console.log('\n=== SAMPLE ASANA ===');
    const asana = await session.run(`
      MATCH (a:Asana) RETURN a.name, a.sanskrit LIMIT 3
    `);
    asana.records.forEach(r => console.log(r.get(0), '-', r.get(1)));

    // Check what connects asana to body part
    console.log('\n=== BODY PART CONNECTIONS ===');
    const bpConn = await session.run(`
      MATCH (bp:BodyPart)<-[r]-(a:Asana)
      RETURN type(r) as relType, bp.name as bodyPart, a.name as asana
      LIMIT 10
    `);
    bpConn.records.forEach(r => console.log(r.get(1), '<-[', r.get(0), ']-', r.get(2)));

    // Check what connects asana to series
    console.log('\n=== SERIES CONNECTIONS ===');
    const serConn = await session.run(`
      MATCH (s:Series)<-[r]-(a:Asana)
      RETURN type(r) as relType, s.name as series, a.name as asana
      LIMIT 10
    `);
    serConn.records.forEach(r => console.log(r.get(1), '<-[', r.get(0), ']-', r.get(2)));

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);