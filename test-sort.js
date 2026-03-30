const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));

async function test() {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (s:Student)
      WHERE s.updatedAt >= datetime('2026-01-01')
      OPTIONAL MATCH (s)-[:HAS_STRENGTH|HAS_WEAKNESS|HAS_CURRENT]->(t:Tag)
      OPTIONAL MATCH (a:Assessment)-[:FOR_STUDENT]->(s)
      RETURN s.id AS id, s.name AS name,
             count(DISTINCT t) AS tagCount,
             count(DISTINCT a) AS assessmentCount,
             max(a.created_at) AS lastAssessment
      ORDER BY assessmentCount DESC, tagCount DESC, s.name ASC
      LIMIT 10
    `);
    console.log('Top 10 most complete students:');
    result.records.forEach((r, i) => {
      const tags = r.get('tagCount').toNumber();
      const assessments = r.get('assessmentCount').toNumber();
      console.log(`${i+1}. ${r.get('name')} - tags:${tags} assessments:${assessments}`);
    });
  } finally {
    session.close();
    driver.close();
  }
}
test().catch(e => console.log('ERR: ' + e.message));