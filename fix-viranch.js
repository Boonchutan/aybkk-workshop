/**
 * Link Viranchayasana to Real Twisting, Joint Folding stage
 */
const neo4j = require('neo4j-driver');

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026')
);

async function fix() {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (stage:TeachingStage)<-[:HAS_STAGE]-(ts:TeachingStructure {series: 'advance-a'})
      MATCH (a:Asana {name: 'Viranchayasana'})
      WHERE stage.name CONTAINS 'Twisting'
      MERGE (stage)-[:TEACHES]->(a)
      RETURN stage.name as stage, a.name as asana
    `);
    console.log('Result:', JSON.stringify(result.records, null, 2));
    if (result.records.length === 0) {
      console.log('WARNING: No match found');
    } else {
      console.log('SUCCESS: Linked', result.records[0].get('asana'), 'to', result.records[0].get('stage'));
    }
  } finally {
    await session.close();
    await driver.close();
  }
}

fix().catch(err => { console.error(err); process.exit(1); });
