const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
const session = driver.session();

async function checkPlatoWork() {
  // Get Plato's recent actions
  const actions = await session.run(
    `MATCH (p:Plato)-[:PERFORMED]->(a:Action) 
     RETURN a.action as action, a.type as type, a.details as details, a.timestamp as ts
     ORDER BY a.timestamp DESC LIMIT 20`
  );
  console.log('Plato recent actions:');
  actions.records.forEach(r => {
    const ts = r.get('ts');
    const time = ts ? new Date(ts.year.low, ts.month.low-1, ts.day.low, ts.hour.low, ts.minute.low).toLocaleString() : 'unknown';
    console.log(`  [${time}] ${r.get('action') || r.get('type')}: ${r.get('details')?.toString().slice(0,150)}`);
  });

  // Get Plato's tasks
  const tasks = await session.run(
    `MATCH (p:Plato)-[:HAS_TASK]->(t:Task) 
     RETURN t.id as id, t.title as title, t.status as status, t.assigned_to as assigned
     ORDER BY t.timestamp DESC LIMIT 10`
  );
  console.log('\nPlato tasks:');
  tasks.records.forEach(r => console.log(`  [${r.get('status')}] ${r.get('id')}: ${r.get('title')} (${r.get('assigned')})`));

  // Get topic details
  const topic = await session.run(
    `MATCH (t:Topic {id: 'teaching-materials'}) RETURN properties(t) as props`
  );
  console.log('\nTeaching-materials topic:', JSON.stringify(topic.records[0]?.get('props'), null, 2));

  session.close();
  driver.close();
}
checkPlatoWork().catch(e => { console.error(e.message); process.exit(1); });
