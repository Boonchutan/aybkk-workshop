const neo4j = require('neo4j-driver');

async function main() {
  const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
  const session = driver.session();
  
  const agoraId = 'aybkk-agora';
  const ts = new Date().toISOString();
  const actionId = 'status-' + Date.now();
  
  const content = `DEPARTURE STATUS - BOONCHU LEAVING FOR AIRPORT
================================================
Time: March 27, 2026 ~06:00

MISSION CONTROL STATUS:
- Live at http://localhost:3000
- 6 tabs: Upload, Students, Files, Progress, Timeline + Task Board, Brainstorm, Heat Map
- Progress tab built (Chart.js) - needs live data validation

STUDENT DATA GAP:
- Neo4j: 1 test student only (Pinn Kant with sample progress data)
- Notion: 58 students in "Aybkk students directory" - NOT synced to Mission Control
- CSV: 652 students (49 active, 603 inactive) - imported March 26, NOT yet in Neo4j

TASK-003 DEADLINE: TODAY March 27
- Need Boonchu decision: sync Notion students to Mission Control?
- Student engagement API built but no real data flowing

BLOCKERS:
- LINE account credentials (waiting on Nicco)
- Student data sync direction needed

INCOMING:
- Aristotle (another agent) joining soon - multi-user compatibility needed

WHILE YOU'RE GONE:
- I'll keep building Mission Control
- Will sync student data when you confirm direction
- Will prepare Aristotle onboarding

CONTACT: Telegram DM @boonchu_tanti or team group https://t.me/+GbZBLUavRFE3OWRl`;

  try {
    await session.run(
      `MATCH (a:Agora {id: $agoraId}) CREATE (a)-[:CONTAINS]->(x:Action {id: $actionId, agentId: 'neo', type: 'status', subject: 'Boonchu Departure - Mission Control Status', content: $content, timestamp: datetime($ts), priority: 'high'})`,
      { agoraId, actionId, content, ts }
    );
    console.log('✅ Logged to Agora: Boonchu departure status');
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);