// Check what Plato's graph has
const neo4j = require('neo4j-driver');

async function main() {
  const driver = neo4j.driver(
    'bolt://localhost:7687',
    neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026')
  );
  const session = driver.session();

  try {
    // Count all Plato's nodes
    const counts = await session.run(`
      MATCH (n)
      WHERE n:Asana OR n:Series OR n:MovementType OR n:TeachingStage 
            OR n:BodyPart OR n:SanskritRoot OR n:Concept 
            OR n:Section OR n:Person
      RETURN labels(n)[0] as type, count(*) as count
      ORDER BY count DESC
    `);
    
    console.log('=== PLATO\'S KNOWLEDGE GRAPH ===');
    counts.records.forEach(r => {
      console.log(`${r.get('type')}: ${r.get('count').low}`);
    });

    // Check MovementTypes
    console.log('\n=== MOVEMENT TYPES ===');
    const mvmt = await session.run(`
      MATCH (m:MovementType) RETURN m.name as name LIMIT 15
    `);
    mvmt.records.forEach(r => console.log('-', r.get('name')));

    // Check TeachingStages
    console.log('\n=== TEACHING STAGES ===');
    const stages = await session.run(`
      MATCH (t:TeachingStage) RETURN t.name as name, t.description as desc LIMIT 10
    `);
    stages.records.forEach(r => console.log('-', r.get('name'), ':', r.get('desc')));

    // Check Sections
    console.log('\n=== SECTIONS ===');
    const sections = await session.run(`
      MATCH (s:Section) RETURN s.name as name, s.type as type LIMIT 10
    `);
    sections.records.forEach(r => console.log('-', r.get('name'), '(', r.get('type'), ')'));

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);