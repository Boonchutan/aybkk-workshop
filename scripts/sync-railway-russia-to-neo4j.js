/**
 * Sync all Russia WS students from Railway API → Neo4j
 * Run: node scripts/sync-railway-russia-to-neo4j.js
 */
const fs = require('fs');
const https = require('https');

const API_URL = 'https://aybkk-ashtanga.up.railway.app/api/orientations/ru';

function fetchApi(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

// Neo4j setup
const neo4j = require('neo4j-driver');
const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'),
  { encrypted: 'ENCRYPTION_OFF' }
);
const session = driver.session();

const EXPERIENCE_MAP = {
  'менее 1 года': '<1 year', '<1 year': '<1 year',
  '1–2 года': '1-2 years', '1-2 года': '1-2 years', '1-2 years': '1-2 years',
  '2–5 лет': '2-5 years', '2-5 лет': '2-5 years', '2-5 years': '2-5 years',
  '3–5 лет': '2-5 years',
  '5–10 лет': '5-10 years', '5-10 лет': '5-10 years', '5-10 years': '5-10 years',
  'более 10 лет': '>10 years', '>10 years': '>10 years'
};

async function upsertStudent(s) {
  const city = (s.city || 'unknown').toLowerCase();
  const studentId = s.id || `ru-${Date.now()}`;
  const name = s.name || 'Unknown';
  const email = s.email || '';
  const location = city === 'moscow' ? 'Moscow, Russia' : city === 'spb' ? 'St. Petersburg, Russia' : 'Russia';
  const experience = EXPERIENCE_MAP[s.experience] || s.experience || null;
  const injuries = s.injuries || null;
  const goals = s.goals || null;
  const tshirt = s.size || null;
  const lastAsana = s.lastAsana || null;
  const journalLink = s.journalLink || null;
  const photoUrl = s.photoUrl || null;
  const telegramChatId = s.telegramChatId ? String(s.telegramChatId) : null;

  const cypher = `
    MERGE (st:Student {studentId: $studentId})
    SET st.name = $name,
        st.email = $email,
        st.source = 'russia-ws-2026',
        st.city = $city,
        st.location = $location,
        st.experience = $experience,
        st.lastAsana = $lastAsana,
        st.injuries = $injuries,
        st.goals = $goals,
        st.tshirt = $tshirt,
        st.journalLink = $journalLink,
        st.photoUrl = $photoUrl,
        st.telegramChatId = $telegramChatId,
        st.updatedAt = datetime()
    RETURN st.studentId AS id
  `;

  try {
    const result = await session.run(cypher, {
      studentId, name, email, city, location, experience,
      lastAsana, injuries, goals, tshirt, journalLink, photoUrl, telegramChatId
    });
    return result.records[0].get('id');
  } catch(e) {
    console.error('  Error: ' + name + ': ' + e.message);
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
  } catch(e) {}
}

async function main() {
  console.log('Fetching from Railway API...');
  let apiData;
  try {
    apiData = await fetchApi(API_URL);
  } catch(e) {
    console.error('API fetch failed:', e.message);
    process.exit(1);
  }

  const students = apiData.students || [];
  console.log(`Students from API: ${students.length}\n`);

  const stats = { done: 0, failed: 0, cities: {} };

  for (const s of students) {
    const city = (s.city || 'unknown').toLowerCase();
    stats.cities[city] = (stats.cities[city] || 0) + 1;

    const insertedId = await upsertStudent(s);
    if (!insertedId) { stats.failed++; continue; }

    // Tags
    await addTag(insertedId, city.toUpperCase(), 'FROM_CITY');
    await addTag(insertedId, 'Russia WS 2026', 'ATTENDED');
    if (s.experience && EXPERIENCE_MAP[s.experience]) {
      await addTag(insertedId, EXPERIENCE_MAP[s.experience], 'HAS_EXPERIENCE');
    }

    stats.done++;
    console.log('  ✓ ' + (s.name || '?') + ' (' + city + ')');
  }

  console.log('\nSync complete:');
  console.log('  Done: ' + stats.done + ', Failed: ' + stats.failed);
  console.log('  Cities:', stats.cities);

  // Verify
  const countR = await session.run("MATCH (s:Student {source:'russia-ws-2026'}) RETURN count(s) as c");
  console.log('\nRussia WS 2026 in Neo4j: ' + countR.records[0].get('c').toInt());

  await session.close();
  await driver.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });