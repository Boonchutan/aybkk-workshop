// Quick script to check Plato's tasks from Neo4j
const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
const session = driver.session();

async function queryTasks() {
  const result = await session.run(
    `MATCH (t:Task {assignee: 'plato'}) RETURN t.id as id, t.title as title, t.status as status, t.subject as subject, t.createdAt as createdAt ORDER BY t.createdAt DESC LIMIT 5`
  );
  console.log('Tasks assigned to Plato:');
  if (result.records.length === 0) {
    console.log('No tasks found.');
  } else {
    result.records.forEach(rec => {
      console.log(`- ID: ${rec.get('id')}`);
      console.log(`  Title: ${rec.get('title')}`);
      console.log(`  Status: ${rec.get('status')}`);
      console.log(`  Subject: ${rec.get('subject')}`);
      console.log(`  Created: ${rec.get('createdAt')}`);
    });
  }
  session.close();
  driver.close();
}

queryTasks().catch(e => console.error(e));