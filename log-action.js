// log-action.js - Log agent actions with subject/action/result tags
// Usage: node log-action.js <agentId> <subject> <action> <result> [notes]
const neo4j = require('neo4j-driver');

const args = process.argv.slice(2);
if (args.length < 4) {
  console.log('Usage: node log-action.js <agentId> <subject> <action> <result> [notes]');
  console.log('Example: node log-action.js neo practice-journal "Updated checkbox lists" "Fixed Stable/Difficult confusion"');
  process.exit(1);
}

const [agentId, subject, action, result, notes] = args;
const timestamp = new Date().toISOString();

async function main() {
  const driver = neo4j.driver(
    'bolt://localhost:7687',
    neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026')
  );
  const session = driver.session();

  try {
    // Create action node
    const actionId = `action-${Date.now()}`;
    await session.run(`
      CREATE (a:Action {
        id: $actionId,
        agent: $agentId,
        subject: $subject,
        action: $action,
        result: $result,
        notes: $notes,
        timestamp: datetime()
      })
    `, { actionId, agentId, subject, action, result, notes: notes || '' });

    // Link to agent
    await session.run(`
      MATCH (ag:Agent {id: $agentId})
      MATCH (a:Action {id: $actionId})
      MERGE (ag)-[:PERFORMED]->(a)
    `, { agentId, actionId });

    // Link to topic if exists
    await session.run(`
      MATCH (t:Topic {id: $subject})
      MATCH (a:Action {id: $actionId})
      MERGE (a)-[:ABOUT]->(t)
    `, { subject, actionId });

    // Link to Boonchu if he initiated (check if notes mention him)
    if (notes && notes.toLowerCase().includes('boonchu')) {
      await session.run(`
        MATCH (b:Boonchu {id: 'boonchu-tanti'})
        MATCH (a:Action {id: $actionId})
        MERGE (b)-[:REQUESTED]->(a)
      `, { actionId });
    }

    console.log(`✅ Action logged: [${agentId}] ${subject}: ${action} → ${result}`);

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);