/**
 * Fix Advance A missing TEACHES relationships
 * Purna Matsyendrasana, Viranchayasana A, Viranchyasana B → "Real Twisting, Joint Folding"
 */
const neo4j = require('neo4j-driver');

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026')
);

async function fix() {
  const session = driver.session();
  try {
    // Find the TeachingStage for "Real Twisting, Joint Folding" in Advance A
    const stageResult = await session.run(`
      MATCH (ts:TeachingStructure {series: 'advance-a'})-[:HAS_STAGE]->(stage:TeachingStage)
      WHERE stage.name CONTAINS 'Twisting' OR stage.name CONTAINS 'Joint'
      RETURN stage.name as stageName, stage.id as stageId
    `);
    
    if (stageResult.records.length === 0) {
      console.log('ERROR: Could not find "Real Twisting, Joint Folding" stage');
      process.exit(1);
    }
    
    const stageName = stageResult.records[0].get('stageName');
    console.log(`Found stage: "${stageName}"`);
    
    // The asanas to link — note Viranchyasana B vs Viranchayasana B (typo in source)
    const asanasToLink = [
      'Purna Matsyendrasana',
      'Viranchayasana A',
      'Viranchyasana B'
    ];
    
    for (const asanaName of asanasToLink) {
      // First check if the asana exists
      const checkResult = await session.run(`
        MATCH (a:Asana {name: $asanaName})
        RETURN a.name as name
      `, { asanaName });
      
      if (checkResult.records.length === 0) {
        console.log(`  SKIP: "${asanaName}" not found in Neo4j`);
        continue;
      }
      
      // Check if TEACHES relationship already exists
      const relCheck = await session.run(`
        MATCH (stage:TeachingStage)-[:TEACHES]->(a:Asana {name: $asanaName})
        RETURN a.name as name
      `, { asanaName });
      
      if (relCheck.records.length > 0) {
        console.log(`  OK: "${asanaName}" already linked`);
        continue;
      }
      
      // Create the TEACHES relationship
      await session.run(`
        MATCH (ts:TeachingStructure {series: 'advance-a'})-[:HAS_STAGE]->(stage:TeachingStage)
        MATCH (a:Asana {name: $asanaName})
        WHERE stage.name CONTAINS 'Twisting' OR stage.name CONTAINS 'Joint'
        MERGE (stage)-[:TEACHES]->(a)
        RETURN stage.name as stage, a.name as asana
      `, { asanaName });
      
      console.log(`  LINKED: "${asanaName}" → "${stageName}"`);
    }
    
    console.log('\nDone!');
    
  } finally {
    await session.close();
    await driver.close();
  }
}

fix().catch(err => { console.error(err); process.exit(1); });
