const neo4j = require('neo4j-driver');

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026')
);

async function logEvent() {
  const session = driver.session();
  try {
    const result = await session.run(
      `CREATE (e:Event {
        id: 'event-' + toString(timestamp()),
        type: 'design-work',
        summary: 'Neo redesigned teacher-assessment.html to match student.html Muji-style design',
        details: 'Redesigned teacher-assessment.html with same warm tan accent (#D4A574), cream background (#FAF9F7), Inter font, consistent card shadows and border radius. Applied to: teacher buttons, option buttons, tag buttons, stats bar, success overlay, logo. File: ~/mission-control/public/teacher-assessment.html. Live at: http://localhost:3000/teacher-assessment.html',
        actor: 'neo',
        timestamp: datetime(),
        createdAt: datetime()
      })
      RETURN e.id as id`
    );
    console.log('Event logged:', result.records[0].get('id'));
  } finally {
    await session.close();
    await driver.close();
  }
}

logEvent().catch(console.error);
