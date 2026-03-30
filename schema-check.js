const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));

async function main() {
  const session = driver.session();
  
  try {
    // Check Log nodes
    console.log('=== LOG NODES ===');
    const logs = await session.run('MATCH (l:Log) RETURN properties(l) as p, id(l) as neo4jId LIMIT 5');
    logs.records.forEach(r => console.log(JSON.stringify(r.get('p'), null, 2)));

    // Check TeamMemory nodes
    console.log('\n=== TEAM MEMORY NODES ===');
    const team = await session.run('MATCH (t:TeamMemory) RETURN properties(t) as p, id(t) as neo4jId LIMIT 5');
    team.records.forEach(r => console.log(JSON.stringify(r.get('p'), null, 2)));

    // Check Agora nodes
    console.log('\n=== AGORA NODES ===');
    const agora = await session.run('MATCH (a:Agora) RETURN properties(a) as p, id(a) as neo4jId LIMIT 5');
    agora.records.forEach(r => console.log(JSON.stringify(r.get('p'), null, 2)));

    // Check Agent nodes
    console.log('\n=== AGENT NODES ===');
    const agents = await session.run('MATCH (a:Agent) RETURN properties(a) as p, id(a) as neo4jId');
    agents.records.forEach(r => console.log(JSON.stringify(r.get('p'), null, 2)));

    // Check Memory nodes
    console.log('\n=== MEMORY NODES (last 3) ===');
    const mems = await session.run('MATCH (m:Memory) RETURN properties(m) as p, id(m) as neo4jId ORDER BY id(m) DESC LIMIT 3');
    mems.records.forEach(r => console.log(JSON.stringify(r.get('p'), null, 2)));

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);