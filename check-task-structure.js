
const neo4j = require('neo4j-driver');

async function checkTasks() {
  const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
  const session = driver.session();
  
  try {
    // Check all tasks
    const result = await session.run('MATCH (t) WHERE t.id STARTS WITH "task-" RETURN t LIMIT 10');
    console.log('TASK-LIKE NODES:');
    
    for (const record of result.records) {
      const node = record.get('t');
      console.log('---');
      console.log('Labels:', node.labels);
      console.log('Properties:', JSON.stringify(node.properties, null, 2));
    }
    
    // Also check what the check-agora-tasks.js script is actually querying
    console.log('\n--- CHECKING WHAT check-agora-tasks.js QUERIES ---');
    const result2 = await session.run('MATCH (x) WHERE x.subject IS NOT NULL RETURN x LIMIT 10');
    console.log('NODES WITH SUBJECT:');
    
    for (const record of result2.records) {
      const node = record.get('x');
      console.log('---');
      console.log('Labels:', node.labels);
      console.log('ID:', node.properties.id);
      console.log('Subject:', node.properties.subject);
    }
    
  } finally {
    await session.close();
    await driver.close();
  }
}

checkTasks().catch(console.error);
