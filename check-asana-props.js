// Check Asana node structure
const neo4j = require('neo4j-driver');

async function main() {
  const driver = neo4j.driver(
    'bolt://localhost:7687',
    neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026')
  );
  const session = driver.session();

  try {
    // Get sample Asana with all properties
    console.log('=== SAMPLE ASANA PROPERTIES ===');
    const asana = await session.run(`
      MATCH (a:Asana)
      RETURN properties(a) as props
      LIMIT 3
    `);
    asana.records.forEach((r, i) => {
      console.log(`\nAsana ${i+1}:`);
      const props = r.get('props');
      Object.keys(props).forEach(k => {
        if (k !== 'name') console.log('  ', k, ':', JSON.stringify(props[k]));
      });
    });

    // Check if there's a bodyPart property
    console.log('\n=== ASANAS WITH BODYPART PROPERTY ===');
    const bpProps = await session.run(`
      MATCH (a:Asana)
      WHERE a.bodyPart IS NOT NULL OR a.bodyParts IS NOT NULL OR a.location IS NOT NULL
      RETURN a.name, a.bodyPart, a.bodyParts, a.location
      LIMIT 10
    `);
    bpProps.records.forEach(r => {
      console.log(r.get('a.name'), ':', r.get('a.bodyPart'), '/', r.get('a.bodyParts'), '/', r.get('a.location'));
    });

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);