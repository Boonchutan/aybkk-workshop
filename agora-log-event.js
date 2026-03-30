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
        type: 'system-action',
        summary: 'Nicco attempting to wake Neo gateway - Telegram bot token conflict detected',
        details: 'Started Neo gateway process from ~/aybkk-agents/tech-coder/. Gateway running but using main Hermes bot token instead of Neo bot token. Sent ping to Hermes command 2026 group.',
        actor: 'nicco',
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
