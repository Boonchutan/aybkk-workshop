// Quick check: are any of the 23 students already in Neo4j?
const fs = require('fs');
const neo4j = require('neo4j-driver');

const statePath = '/Users/alfredoagent/mission-control/data/ru-bot-state.json';
const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const byChat = raw.byChat || {};
const chatIds = Object.keys(byChat).filter(k => !['byChat','knownGroups'].includes(k));

function parseStudent(rawStr) {
  try { return eval('(' + rawStr + ')'); } catch(e) { return null; }
}

// Get all studentIds
const studentIds = [];
for (const cid of chatIds) {
  const s = parseStudent(byChat[cid]);
  if (s && s.studentId) studentIds.push(s.studentId);
}
console.log('StudentIds to check:', studentIds.slice(0, 5));

const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'), { encrypted: 'ENCRYPTION_OFF' });
const session = driver.session();

async function main() {
  let existing = 0;
  for (const sid of studentIds) {
    const r = await session.run('MATCH (s:Student {studentId: $sid}) RETURN count(s) as c', { sid });
    if (r.records[0].get('c').toInt() > 0) existing++;
  }
  console.log(`Already in Neo4j: ${existing}/${studentIds.length}`);
  console.log('Safe to sync: ' + (studentIds.length - existing) + ' new students');
  await session.close();
  await driver.close();
}
main().catch(e => console.error(e.message));