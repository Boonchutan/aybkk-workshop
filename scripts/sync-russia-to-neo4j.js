/**
 * Sync Russia WS students from ru-bot-state.json → Neo4j
 * Run: node scripts/sync-russia-to-neo4j.js
 */
const fs = require('fs');
const path = require('path');
const neo4j = require('neo4j-driver');

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'),
  { encrypted: 'ENCRYPTION_OFF' }
);
const session = driver.session();

const DIFFICULTIES = [
  'Backbends', 'Hip openers', 'Arm balances', 'Inversions',
  'Hamstrings', 'Core strength', 'Shoulders', 'Neck/cervical', 'Wrist/hands'
];
const EXPERIENCE = ['<1 year', '1-2 years', '2-5 years', '5-10 years', '>10 years'];

// Load parsed JSON (values are already JS objects, not strings)
const statePath = path.join(__dirname, '..', 'data', 'ru-bot-state.json');
const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const byChat = data.byChat || {};
const chatKeys = Object.keys(byChat).filter(k => !['byChat', 'knownGroups'].includes(k));

async function upsertStudent(student, chatId) {
  const profile = student.profile || {};
  const city = (profile.city || '').toLowerCase() || 'spb';
  const studentId = student.studentId || `ru-${chatId}`;
  const name = profile.name || 'Unknown';
  const email = profile.email || '';
  const difficulties = (profile.difficulties || [])
    .map(i => DIFFICULTIES[i])
    .filter(Boolean);
  const experience = EXPERIENCE[profile.experienceIdx] || null;
  const injuries = profile.injuries || null;
  const goals = profile.goals || null;
  const tshirt = profile.size || null;
  const lastAsana = profile.lastAsana || null;
  const step = student.step || 'unknown';

  // Calculate quiz score: compare answers to correct answers
  let quizScore = null;
  if (student.quiz && student.quiz.picks && student.quiz.answers) {
    const CORRECT = [1, 0, 2, 3, 2, 1, 2, 3];
    const correct = student.quiz.picks.filter((p, i) => p === CORRECT[i]).length;
    quizScore = `${correct}/2`;
  }

  const location = city === 'moscow' ? 'Moscow, Russia' : 'St. Petersburg, Russia';

  const cypher = `
    MERGE (s:Student {studentId: $studentId})
    SET s.name = $name,
        s.email = $email,
        s.source = 'russia-ws-2026',
        s.city = $city,
        s.location = $location,
        s.experience = $experience,
        s.lastAsana = $lastAsana,
        s.injuries = $injuries,
        s.goals = $goals,
        s.tshirt = $tshirt,
        s.quizScore = $quizScore,
        s.photoFileId = $photoFileId,
        s.journalLink = $journalLink,
        s.registrationStep = $step,
        s.chatId = $chatId,
        s.updatedAt = datetime()
    RETURN s.studentId AS id
  `;

  try {
    const result = await session.run(cypher, {
      studentId, name, email, city, location, experience,
      lastAsana, injuries, goals, tshirt, quizScore,
      photoFileId: student.photoFileId || null,
      journalLink: student.journalLink || null,
      step, chatId: String(chatId)
    });
    return result.records[0].get('id');
  } catch(e) {
    console.error('  Upsert error for ' + name + ': ' + e.message);
    return null;
  }
}

async function addTag(studentId, tagLabel, relType) {
  try {
    await session.run(`
      MATCH (s:Student {studentId: $sid})
      MERGE (t:Tag {label: $label})
      MERGE (s)-[r:${relType}]->(t)
      SET r.updatedAt = datetime()
    `, { sid: studentId, label: tagLabel });
  } catch(e) {
    // Ignore tag errors
  }
}

async function main() {
  console.log(`Entries found: ${chatKeys.length}\n`);

  const stats = { done: 0, skipped: 0, failed: 0, cities: {} };

  for (const chatId of chatKeys) {
    const student = byChat[chatId];
    if (!student || typeof student !== 'object') { stats.failed++; continue; }

    const profile = student.profile || {};
    const city = ((profile.city || '').toLowerCase() || 'spb');
    stats.cities[city] = (stats.cities[city] || 0) + 1;

    if (student.step !== 'done') {
      stats.skipped++;
      console.log(`  Skipping ${profile.name || chatId}: step=${student.step}`);
      continue;
    }

    const insertedId = await upsertStudent(student, chatId);
    if (!insertedId) { stats.failed++; continue; }

    // Tags
    await addTag(insertedId, city.toUpperCase(), 'FROM_CITY');
    await addTag(insertedId, 'Russia WS 2026', 'ATTENDED');
    for (const d of (profile.difficulties || [])) {
      const label = DIFFICULTIES[d];
      if (label) await addTag(insertedId, label, 'HAS_DIFFICULTY');
    }
    if (EXPERIENCE[profile.experienceIdx]) {
      await addTag(insertedId, EXPERIENCE[profile.experienceIdx], 'HAS_EXPERIENCE');
    }

    stats.done++;
    console.log(`  ✓ ${profile.name} (${city})`);
  }

  console.log(`\nSync complete:`);
  console.log(`  Done: ${stats.done}, Skipped: ${stats.skipped}, Failed: ${stats.failed}`);
  console.log(`  By city:`, stats.cities);

  // Verify
  const countR = await session.run("MATCH (s:Student {source:'russia-ws-2026'}) RETURN count(s) as c");
  console.log(`\nRussia WS 2026 students now in Neo4j: ${countR.records[0].get('c').toInt()}`);

  await session.close();
  await driver.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });