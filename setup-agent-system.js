// Setup comprehensive agent tracking and Boonchu's personal node
const neo4j = require('neo4j-driver');

async function main() {
  const driver = neo4j.driver(
    'bolt://localhost:7687',
    neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026')
  );
  const session = driver.session();

  try {
    // === BOONCHU'S PERSONAL NODE ===
    await session.run(`
      MERGE (b:Boonchu:Person {id: 'boonchu-tanti'})
      SET b.name = 'Boonchu Tanti',
          b.role = 'Founder',
          b.telegram = '@boonchu_tanti',
          b.email = 'aybkks31@gmail.com',
          b.createdAt = datetime(),
          b.updatedAt = datetime(),
          b.requests = [],
          b.questions = [],
          b.decisions = [],
          b.results = [],
          b.emotions = [],
          b.subjects = []
    `);
    console.log('✅ Boonchu personal node created with full tracking fields');

    // === NEO AGENT NODE - use separate MERGE for label ===
    await session.run(`
      MERGE (n:Agent {id: 'neo'})
      ON CREATE SET n.name = 'Neo', n.role = 'Technical Coder', n.createdAt = datetime()
      SET n.reportsTo = 'nicco',
          n.homeDir = '~/mission-control/',
          n.skills = ['javascript', 'node.js', 'neo4j', 'web-development', 'automation'],
          n.currentProject = 'Mission Control',
          n.status = 'active',
          n.updatedAt = datetime()
    `);

    // Add Neo label separately
    await session.run(`
      MATCH (n:Agent {id: 'neo'})
      SET n:Neo
    `);
    console.log('✅ Neo agent node created');

    // === NICCO AGENT NODE ===
    await session.run(`
      MERGE (n:Agent {id: 'nicco'})
      ON CREATE SET n.name = 'Nicco', n.createdAt = datetime()
      SET n.role = 'Chief of Staff',
          n.telegram = '@machiav_bot',
          n.reportsTo = 'boonchu-tanti',
          n.status = 'active',
          n.updatedAt = datetime()
    `);
    await session.run(`MATCH (n:Agent {id: 'nicco'}) SET n:Nicco`);
    console.log('✅ Nicco agent node created');

    // === CREATE TOPICS ===
    const topics = [
      { id: 'mission-control', name: 'Mission Control Dashboard', status: 'active' },
      { id: 'practice-journal', name: 'Practice Journal / Student Check-in', status: 'active' },
      { id: 'telegram-bot', name: 'Telegram Assessment Bot', status: 'active' },
      { id: 'line-integration', name: 'LINE Integration', status: 'pending' },
      { id: 'weekly-reports', name: 'Weekly Student Reports', status: 'pending' },
      { id: 'dns-setup', name: 'DNS Setup - studentprogress.aybkk.com', status: 'in-progress' }
    ];

    for (const topic of topics) {
      await session.run(`
        MERGE (t:Topic {id: $id})
        SET t.name = $name, t.status = $status, t.updatedAt = datetime()
      `, topic);
    }
    console.log('✅ Topic nodes created');

    // === RELATIONSHIPS ===
    await session.run(`
      MATCH (b:Boonchu {id: 'boonchu-tanti'})
      MATCH (t:Topic)
      MERGE (b)-[:INTERESTED_IN]->(t)
    `);

    await session.run(`
      MATCH (n:Neo {id: 'neo'})
      MATCH (t:Topic {status: 'active'})
      MERGE (n)-[:WORKING_ON]->(t)
    `);
    console.log('✅ Relationships created');

    // === TODAY'S SESSION ===
    const today = new Date().toISOString().split('T')[0];
    await session.run(`
      MERGE (s:Session {id: $sessionId})
      SET s.date = $date, s.type = 'planning',
          s.participants = ['boonchu', 'neo'],
          s.summary = 'Practice journal updates, LINE weekly reports, DNS setup'
    `, { sessionId: `session-${today}`, date: today });
    console.log('✅ Today\'s session recorded');

    console.log('\n========================================');
    console.log('✅ FULL AGENT SYSTEM INITIALIZED');
    console.log('========================================');

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);