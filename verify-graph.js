require('dotenv').config();
const neo4j = require('neo4j-driver');
const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);
const session = driver.session();

async function verify() {
  // Sample Asana node with full details
  const asana = await session.run(`
    MATCH (a:Asana {name: 'Pascimattanasana'})
    MATCH (a)-[r:REQUIRES]->(t:Tag)
    RETURN a.name as name, a.subject as subject, a.goal as goal, 
           a.series as series, collect(t.name) as tags
  `);
  console.log('=== Sample Asana: Pascimattanasana ===');
  if (asana.records.length > 0) {
    const r = asana.records[0];
    console.log(`Name: ${r.get('name')}`);
    console.log(`Series: ${r.get('series')}`);
    console.log(`Subject: ${r.get('subject')}`);
    console.log(`Goal: ${r.get('goal')}`);
    console.log(`Tags (Actions): ${r.get('tags').join(', ')}`);
  }

  // List all unique tags
  const tags = await session.run(`MATCH (t:Tag) RETURN t.name as name, t.category as category ORDER BY t.category, t.name`);
  console.log('\n=== All Tags (39 total) ===');
  tags.records.forEach(r => console.log(`  ${r.get('category')}: ${r.get('name')}`));

  // Count asanas per series
  const seriesCount = await session.run(`
    MATCH (s:Series)-[:CONTAINS]->(a:Asana)
    RETURN s.name as series, count(a) as count
    ORDER BY s.name
  `);
  console.log('\n=== Asanas per Series ===');
  seriesCount.records.forEach(r => console.log(`  ${r.get('series')}: ${r.get('count')} asanas`));

  // Show tag supports network (sample)
  const supports = await session.run(`
    MATCH (t1:Tag)-[:SUPPORTS]->(t2:Tag)
    RETURN t1.name as tag, collect(t2.name) as supports
    LIMIT 10
  `);
  console.log('\n=== Tag Support Network (sample) ===');
  supports.records.forEach(r => console.log(`  ${r.get('tag')} → ${r.get('supports').join(', ')}`));

  await session.close();
  await driver.close();
}

verify().catch(console.error);