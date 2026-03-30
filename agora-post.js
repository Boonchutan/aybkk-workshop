// agora-post.js - Post to shared workspace
// Usage: node agora-post.js <agentId> <type> <subject> <content>
// Types: task, content, decision, handoff, question, context
const neo4j = require('neo4j-driver');

const args = process.argv.slice(2);
if (args.length < 4) {
  console.log('Usage: node agora-post.js <agentId> <type> <subject> <content>');
  console.log('Types: task, content, decision, handoff, question, context');
  console.log('\nExamples:');
  console.log('  node agora-post.js plato content "Ashtanga History" "Chapter 1 intro..."');
  console.log('  node agora-post.js neo handoff "Practice Journal" "Built form, needs content"');
  console.log('  node agora-post.js boonchu decision "Weekly Reports" "Approved LINE for Thai students"');
  process.exit(1);
}

const [agentId, type, subject, content] = args;
const id = `${type}-${Date.now()}`;

async function main() {
  const driver = neo4j.driver(
    'bolt://localhost:7687',
    neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026')
  );
  const session = driver.session();

  try {
    // Create artifact
    await session.run(`
      MATCH (a:Agora {id: 'aybkk-agora'})
      CREATE (art:Artifact {
        id: $id,
        type: $type,
        subject: $subject,
        content: $content,
        agent: $agentId,
        timestamp: datetime()
      })
      MERGE (a)-[:CONTAINS]->(art)
    `, { id, type, subject, content, agentId });

    // Also log as action
    await session.run(`
      MATCH (ag:Agent {id: $agentId})
      CREATE (act:Action {
        id: 'action-' + $id,
        subject: $subject,
        action: $type + ': ' + $subject,
        result: $content,
        timestamp: datetime()
      })
      MERGE (ag)-[:PERFORMED]->(act)
    `, { id, agentId, subject, content, type });

    console.log(`✅ Posted to Agora:`);
    console.log(`   [${agentId}] ${type}: ${subject}`);
    console.log(`   ${content.slice(0, 100)}${content.length > 100 ? '...' : ''}`);

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);