const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));

async function log() {
  const session = driver.session();
  try {
    const result = await session.run(`
      CREATE (e:Event {
        id: 'event-' + toString(timestamp()),
        type: 'build-mindmap',
        summary: 'Neo built interactive mindmap web app for AYBKK Teaching System',
        details: 'Built: (1) api/mindmap-api.js - Express router with 6 endpoints: /tree, /asanas, /tags, /search, /tag/:name, /asana/:name. (2) public/mindmap.html - Single-file interactive mindmap with vintage cream palette (#FAF3E3), 3-column layout (green/red/purple for Primary/Intermediate/Advanced), click asana for details+tags, click action tag to see all related asanas, search bar, zoom/pan, teacher/student view toggle. DB schema: TeachingStructure-[:HAS_STAGE]->TeachingStage-[:TEACHES]->Asana (NOT BELONGS_TO). Asana-[:INVOLVES]->Tag for actions. File: ~/mission-control/public/mindmap.html. Live at: http://localhost:3000/mindmap.html',
        actor: 'neo',
        timestamp: datetime(),
        createdAt: datetime()
      })
      RETURN e.id as id
    `);
    console.log('Logged:', result.records[0].get('id'));
  } finally {
    await session.close();
    await driver.close();
  }
}

log().catch(console.error);