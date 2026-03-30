const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
const session = driver.session();

async function check() {
  const r = await session.run('MATCH (s:Student) RETURN count(s) AS count');
  console.log('Students in Neo4j:', r.records[0].get('count').toNumber());
  const r2 = await session.run("MATCH (s:Student)-[:HAS_MEMBERSHIP]->(m:Membership) WHERE m.status = 'active' AND m.expiresAt >= date() RETURN count(s) AS count");
  console.log('Active students (with active membership):', r2.records[0].get('count').toNumber());
  session.close();
  driver.close();
}

check().catch(console.error);
