/**
 * Setup shared Team Memory in Neo4j
 * All agents query this for shared context
 */

const neo4j = require('neo4j-driver');

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026')
);

const TEAM_MEMORY = `AYBKK COMPREHENSIVE (Mar 22, 2026):

NEO4J: User=neo4j, PW=aybkk_neo4j_2026, URI=bolt://localhost:7687. 48 students from Notion. Schema: Student, Membership, Tag, Assessment, TagHistory. Student.id = studentId integer. Relationships: HAS_MEMBERSHIP, HAS_STRENGTH, HAS_WEAKNESS, HAS_CURRENT, HAS_ASSESSMENT. Neo4j int IDs: pass plain integer to session.run(), NOT {low: x, high: y}.

TELEGRAM BOT: @AYBKKstudentProgress_bot, token=8368539519:AAF12ytC_rr26xBoDxmKVceCFeANRTK69dA. File=~/mission-control/assessment-bot.js (935 lines). Schema setup=~/mission-control/setup-assessment-schema.js. Flow: /start → language → student (active memberships only, sorted by most assessed) → strengths → weaknesses → energy → behavior → asana → toFix → confirm → save to Neo4j. Teachers: Boonchu, Jamsai, M. Multi-lang: EN/TH/中文.

MISSION CONTROL: http://localhost:3000, dir=~/mission-control/, backend=server.js. Notion connected (21 dbs, 48 students). Student data NOT fully synced to Neo4j — 1 test student only. Shopify store 7bdc65-2.

REZERW DATA (saved Mar 22): ~/mission-control/data/rezwerw_memberships_2026-03-22.csv (12.8KB, current members). ~/mission-control/data/legacy_customer_report_2018-02-11.csv (88KB, 2018). Rezerw login: Aybkks31@gmail.com, business.rezerv.co (reCAPTCHA blocks automation). Fields: First_Name, Last_Name, Mobile, Email, Membership, Membership Number, Category, Status, Start_Date, Expiration_Date, Last/Next_Booking_Class.

TEAM: Boonchu Tanti=Founder(@boonchu_tanti), Nicco=Chief of Staff(@machiav_bot), Neo=tech coder. Team TG: https://t.me/+GbZBLUavRFE3OWRl. Cannot join TG groups (DM only).

TASKS: TASK-003 deadline Mar 27 (team ops center). Progress tab + form processing script pending. Student engagement system (QR check-in → Q&A → Neo4j) approved by Boonchu. Rezerw booking + check-in integration planned but blocked by reCAPTCHA — Boonchu says plan first, then Neo executes.`;

async function setup() {
  const session = driver.session();

  try {
    console.log('Setting up shared Team Memory in Neo4j...\n');

    // Create TeamMemory node with full context
    await session.run(`
      MERGE (m:TeamMemory {id: 'aybkk-shared'})
      SET m.content = $content,
          m.updatedAt = datetime(),
          m.updatedBy = 'Neo'
    `, { content: TEAM_MEMORY });

    console.log('✅ TeamMemory node created/updated');
    console.log('\nVerifying...');

    const result = await session.run(`
      MATCH (m:TeamMemory {id: 'aybkk-shared'})
      RETURN m.content AS content, m.updatedAt AS updatedAt, m.updatedBy AS updatedBy
    `);

    const record = result.records[0];
    console.log(`\nUpdated: ${record.get('updatedAt')}`);
    console.log(`By: ${record.get('updatedBy')}`);
    console.log(`Content length: ${record.get('content').length} chars`);

    console.log('\n✅ Shared Team Memory is live in Neo4j!');
    console.log('\nTo query from any agent, run:');
    console.log(`
MATCH (m:TeamMemory {id: 'aybkk-shared'})
RETURN m.content AS content
`);

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    session.close();
    driver.close();
  }
}

setup();
