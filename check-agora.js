const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
const session = driver.session();

async function checkAgora() {
  // Check recent actions/tasks in Agora
  const recent = await session.run(
    `MATCH (a:Agora {id: 'aybkk-agora'})-[:CONTAINS]->(x)
     WHERE x:Action OR x:Task OR x:Decision
     RETURN x.action as action, x.type as type, x.agent as agent, x.timestamp as time, x.status as status, x.details as details
     ORDER BY x.timestamp DESC LIMIT 30`
  );
  console.log('Recent Agora activity:');
  recent.records.forEach(r => {
    console.log(`[${r.get('time')?.toString().slice(0,16)}] ${r.get('agent')}: ${r.get('action') || r.get('type')} - ${r.get('status') || ''} ${r.get('details') || ''}`);
  });

  session.close();
  driver.close();
}
checkAgora().catch(console.error);
