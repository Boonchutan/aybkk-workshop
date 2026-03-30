// Setup Agora - Shared Workspace for all agents
const neo4j = require('neo4j-driver');

async function main() {
  const driver = neo4j.driver(
    'bolt://localhost:7687',
    neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026')
  );
  const session = driver.session();

  try {
    // Create Agora workspace node
    await session.run(`
      MERGE (a:Agora {id: 'aybkk-agora'})
      SET a.name = 'AYBKK Agora',
          a.description = 'Shared workspace for all agents - Neo (tech), Plato (content), Nicco (ops)',
          a.createdAt = datetime(),
          a.updatedAt = datetime()
    `);
    console.log('✅ Agora workspace created');

    // Create message/artifact types for the workspace
    const artifactTypes = [
      { id: 'task', name: 'Task', description: 'Work requests and tasks' },
      { id: 'content', name: 'Content', description: 'Written content, materials, knowledge' },
      { id: 'decision', name: 'Decision', description: 'Boonchu decisions and approvals' },
      { id: 'handoff', name: 'Handoff', description: 'Work handed off between agents' },
      { id: 'question', name: 'Question', description: 'Questions for other agents' },
      { id: 'context', name: 'Context', description: 'Shared knowledge and background' }
    ];

    for (const type of artifactTypes) {
      await session.run(`
        MERGE (t:ArtifactType {id: $id})
        SET t.name = $name, t.description = $description
      `, type);
    }
    console.log('✅ Artifact types created');

    // Create initial shared context from today
    const today = new Date().toISOString().split('T')[0];
    await session.run(`
      MATCH (a:Agora {id: 'aybkk-agora'})
      CREATE (c:Context:Artifact {
        id: 'context-' + $date,
        date: $date,
        summary: 'Mission Control v2 - Student tracking dashboard',
        currentProjects: ['practice-journal', 'telegram-bot', 'line-integration', 'dns-setup'],
        teamStructure: 'Neo (tech) → Nicco (ops) → Boonchu (decisions)',
        keyDecisions: ['Practice journal updated with precise Stable/Difficult checkboxes', 'Weekly LINE reports planned'],
        pendingItems: ['DNS setup for studentprogress.aybkk.com', 'LINE Message API token needed', 'Student LINE ID collection']
      })
      SET c.createdAt = datetime()
      MERGE (a)-[:CONTAINS]->(c)
    `, { date: today });
    console.log('✅ Initial context created');

    // Create Boonchu decision hub
    await session.run(`
      MATCH (a:Agora {id: 'aybkk-agora'})
      CREATE (d:Decision:Artifact {
        id: 'decision-hub',
        name: 'Boonchu Decisions',
        description: 'All decisions by Boonchu - authoritative approvals and directions'
      })
      SET d.createdAt = datetime()
      MERGE (a)-[:CONTAINS]->(d)
    `);
    console.log('✅ Boonchu decision hub created');

    // Create Plato content zone
    await session.run(`
      MATCH (a:Agora {id: 'aybkk-agora'})
      CREATE (z:Content:Artifact {
        id: 'plato-content-zone',
        name: 'Plato Content Zone',
        description: 'Writing, teaching materials, organized knowledge from Plato'
      })
      SET z.createdAt = datetime()
      MERGE (a)-[:CONTAINS]->(z)
    `);
    console.log('✅ Plato content zone created');

    // Create Neo tech zone
    await session.run(`
      MATCH (a:Agora {id: 'aybkk-agora'})
      CREATE (z:Artifact {
        id: 'neo-tech-zone',
        name: 'Neo Tech Zone',
        description: 'Technical implementations, builds, APIs, features'
      })
      SET z.createdAt = datetime()
      MERGE (a)-[:CONTAINS]->(z)
    `);
    console.log('✅ Neo tech zone created');

    // Link all agents to Agora
    await session.run(`
      MATCH (n:Neo {id: 'neo'})
      MATCH (p:Plato {id: 'plato'})
      MATCH (n2:Nicco {id: 'nicco'})
      MATCH (a:Agora {id: 'aybkk-agora'})
      MERGE (n)-[:USES]->(a)
      MERGE (p)-[:USES]->(a)
      MERGE (n2)-[:USES]->(a)
    `);
    console.log('✅ All agents linked to Agora');

    // Log this setup as first Agora action
    await session.run(`
      MATCH (a:Agora {id: 'aybkk-agora'})
      CREATE (act:Action:Artifact {
        id: 'agora-created',
        agent: 'neo',
        action: 'Created AYBKK Agora shared workspace',
        result: 'Team now has central hub for collaboration',
        timestamp: datetime()
      })
      MERGE (a)-[:CONTAINS]->(act)
    `);
    console.log('✅ Setup action logged');

    console.log('\n========================================');
    console.log('✅ AGORA - SHARED WORKSPACE CREATED');
    console.log('========================================');
    console.log('\n📍 Location: Neo4j (aybkk-agora node)');
    console.log('\n👥 Team Access:');
    console.log('   - Neo (tech)');
    console.log('   - Plato (content)');
    console.log('   - Nicco (ops)');
    console.log('\n📦 Contains:');
    console.log('   - Tasks / Content / Decisions / Handoffs');
    console.log('   - Boonchu Decision Hub');
    console.log('   - Plato Content Zone');
    console.log('   - Neo Tech Zone');
    console.log('\n🔗 All agents USES the Agora');
    console.log('\nTo view: MATCH (a:Agora) RETURN a');

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);