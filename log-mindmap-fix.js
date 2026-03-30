/**
 * Log mindmap fix to Agora
 */
const neo4j = require('neo4j-driver');

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026')
);

async function log() {
  const session = driver.session();
  try {
    const timestamp = new Date().toISOString();
    const logContent = `Mindmap DB fix (${timestamp}):

FIXED: 2 missing Advance A asanas had no TEACHES relationship to their stage.

Asanas fixed:
- Purna Matsyendrasana → linked to "Real Twisting, Joint Folding"
- Viranchayasana → linked to "Real Twisting, Joint Folding"

Advance A now: 24/24 asanas linked (was 22/24).

API endpoints (all operational):
- /api/mindmap/tree — 3 structures × 13 stages × asanas
- /api/mindmap/asanas — 113 asanas with tags
- /api/mindmap/tags — 32 action tags
- /api/mindmap/search?q=
- /api/mindmap/tag/:name
- /api/mindmap/asana/:name

Frontend: http://localhost:3000/mindmap.html
Colors: Primary (green) / Intermediate (red) / Advance A (purple) / Advance B (brown)
Tags: clickable bidirectional links between asanas and actions
View modes: Teacher (all) / Student (primary only)
`;

    await session.run(`
      CREATE (log:Log {
        source: 'neo',
        content: $content,
        timestamp: datetime($timestamp),
        type: 'mindmap-fix'
      })
    `, { content: logContent, timestamp });

    console.log('Logged to Agora: mindmap-fix');
    console.log(logContent);
  } finally {
    await session.close();
    await driver.close();
  }
}

log().catch(err => { console.error(err); process.exit(1); });
