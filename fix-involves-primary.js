const neo4j = require('neo4j-driver');
const fs = require('fs');

const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));

// Primary series asana → tags mapping from Ashtanga Primary.md
const primaryAsanas = {
  // Suryanamaskara A/B handled separately
  // Seated Primary
  'Padangusthasana': ['Forward Bend', 'Legs Internal Rotation'],
  'Pascimattanasana': ['Forward Bend'],
  'Purvattanasana': ['Shoulder Extension', 'Core Strength', 'Bandha'],
  'Ardha Buddha Padma Pascimattanasana': ['Forward Bend', 'Padmasana'],
  'Triang Mukha Ekapada Pascimattanasana': ['Legs Internal Rotation', 'Forward Bend', 'Knee Folding'],
  'Janu Sirsasana A': ['Forward Bend', 'Legs External Rotation', 'Knee Folding'],
  'Janu Sirsasana B': ['Forward Bend', 'Legs External Rotation', 'Knee Folding'],
  'Janu Sirsasana C': ['Forward Bend', 'Legs External Rotation', 'Knee Twisting'],
  'Maricasana A': ['Knee Folding', 'Forward Bend', 'Shoulder Extension'],
  'Maricasana B': ['Forward Bend', 'Padmasana', 'Shoulder Extension'],
  'Maricasana C': ['Twisting', 'Knee Folding', 'Shoulder Rotation'],
  'Maricasana D': ['Twisting', 'Knee Folding', 'Padmasana', 'Shoulder Rotation'],
  'Navasana': ['Core Strength'],
  'Bhuja Pidasana': ['Arm Balance', 'Legs External Rotation', 'Core Strength', 'Bandha'],
  'Kurmasana': ['Forward Bend', 'Core Strength'],
  'Supta Kurmasana': ['Forward Bend', 'Legs Behind Head', 'Core Strength', 'Legs External Rotation', 'Bandha'],
  'Garbha Pindasana': ['Padmasana', 'Core Strength', 'Bandha'],
  'Kukutasana': ['Padmasana', 'Arm Balance', 'Core Strength', 'Bandha'],
  'Buddha Konasana': ['Legs External Rotation', 'Forward Bend', 'Knee Folding'],
  'Upavishtha Konasana': ['Leg Split', 'Forward Bend', 'Core Strength'],
  'Supta Konasana': ['Forward Bend', 'Shoulderstand', 'Core Strength'],
  'Supta Padangushthasana': ['Leg Split', 'Legs External Rotation'],
  'Upbhaya Padangushthasana': ['Forward Bend', 'Shoulderstand', 'Core Strength'],
  'Urdhva Mukha Pascimattanasana': ['Forward Bend', 'Shoulderstand'],
  'Setu Bandasana': ['Backbend', 'Leg Strength', 'Legs External Rotation'],
  // Finishing
  'Urdhva Dhanurasana': ['Backbend', 'Shoulder Rotation', 'Breathing', 'Core Strength', 'Bandha'],
  'Salawangasana': ['Shoulderstand', 'Core Strength', 'Bandha'],
  'Halasana': ['Forward Bend', 'Core Strength', 'Shoulder Extension'],
  'Karna Pidasana': ['Forward Bend', 'Breathing', 'Shoulder Extension', 'Bandha'],
  'Urdhva Padmasana': ['Padmasana', 'Shoulderstand', 'Core Strength', 'Balance'],
  'Pindasana': ['Balance', 'Padmasana', 'Shoulderstand'],
  'Matsyasana': ['Padmasana', 'Backbend', 'Bandha', 'Breathing'],
  'Utthana Padasana': ['Backbend', 'Core Strength', 'Bandha'],
  'Sirsasana': ['Headstand', 'Shoulders', 'Balance', 'Bandha'],
  'Buddha Padmasana': ['Padmasana'],
  'Yoga Mudra': ['Padmasana', 'Breathing', 'Forward Bend'],
  'Padmasana': ['Padmasana', 'Breathing'],
  'Utplutih': ['Breathing', 'Bandha', 'Padmasana', 'Arm Balance', 'Shoulders'],
};

async function ensureTagExists(session, tagName) {
  await session.run(`
    MERGE (t:Tag {name: $name})
  `, { name: tagName });
}

async function linkAsanaToTag(session, asanaName, tagName) {
  await session.run(`
    MATCH (a:Asana {name: $asanaName})
    MERGE (t:Tag {name: $tagName})
    MERGE (a)-[r:INVOLVES]->(t)
  `, { asanaName, tagName });
}

async function main() {
  const session = driver.session();
  
  console.log('=== Fixing missing INVOLVES for Primary asanas ===\n');
  
  let fixed = 0;
  let missing = 0;
  
  for (const [asanaName, tags] of Object.entries(primaryAsanas)) {
    // Check if asana exists
    const check = await session.run(`
      MATCH (a:Asana {name: $name}) RETURN a.name
    `, { name: asanaName });
    
    if (check.records.length === 0) {
      console.log(`  SKIP: "${asanaName}" not found in DB`);
      missing++;
      continue;
    }
    
    // Check current tags
    const current = await session.run(`
      MATCH (a:Asana {name: $name})-[r:INVOLVES]->(t:Tag) RETURN collect(t.name) as tags
    `, { name: asanaName });
    
    const existingTags = current.records[0]?.get('tags') || [];
    
    if (existingTags.length > 0) {
      console.log(`  SKIP: "${asanaName}" already has tags: ${existingTags.join(', ')}`);
      continue;
    }
    
    // Link missing tags
    for (const tagName of tags) {
      await ensureTagExists(session, tagName);
      await linkAsanaToTag(session, asanaName, tagName);
    }
    
    console.log(`  FIXED: "${asanaName}" → ${tags.join(', ')}`);
    fixed++;
  }
  
  console.log(`\nDone. Fixed: ${fixed}, Missing from DB: ${missing}`);
  
  await session.close();
  await driver.close();
}

main().catch(e => { console.log('Error:', e.message); process.exit(1); });