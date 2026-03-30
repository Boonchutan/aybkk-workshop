const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
const session = driver.session();

async function main() {
  // Get team memory
  const r1 = await session.run("MATCH (m:TeamMemory {id: 'aybkk-shared'}) RETURN m.content AS content, m.updatedAt AS updatedAt");
  if (r1.records.length > 0) {
    console.log("=== TEAM MEMORY ===");
    console.log("Updated:", r1.records[0].get('updatedAt'));
    console.log(r1.records[0].get('content'));
  }
  
  // Get recent Agora posts
  const r2 = await session.run("MATCH (p:AgoraPost) RETURN p.agentId AS agent, p.type AS type, p.subject AS subject, p.content AS content, p.timestamp AS ts ORDER BY p.timestamp DESC LIMIT 10");
  console.log("\n=== RECENT AGORA POSTS ===");
  r2.records.forEach(r => {
    console.log("[" + r.get('ts') + "] " + r.get('agent') + " (" + r.get('type') + "): " + r.get('subject'));
    const content = r.get('content') || '';
    console.log("  " + content.substring(0, 150));
  });
  
  await session.close();
  await driver.close();
}
main().catch(e => console.error(e));
