const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));

async function test() {
  const session = driver.session();
  try {
    // Check what ID fields exist
    const result = await session.run(`
      MATCH (s:Student {email: 'preepaworn@gmail.com'})
      RETURN s.studentId AS studentId, s.id AS id, s.name AS name
    `);
    console.log('preepaworn@gmail.com:');
    result.records.forEach(r => console.log(' ', r.get('name'), '| studentId:', r.get('studentId'), '| id:', r.get('id')));

    // Try matching by studentId instead
    const result2 = await session.run(`
      MATCH (s:Student)
      WHERE s.email = 'preepaworn@gmail.com'
      RETURN s.studentId AS sid, s.name AS name
    `);
    console.log('\nBy email match:');
    result2.records.forEach(r => console.log(' ', r.get('name'), '| studentId:', r.get('sid')));

    // Test matching with exact email
    const result3 = await session.run(`
      MATCH (s:Student)
      RETURN s.studentId AS sid, s.name AS name, s.email AS email
      LIMIT 10
    `);
    console.log('\nFirst 10 students by studentId:');
    result3.records.forEach(r => console.log('  studentId:', r.get('sid'), '|', r.get('name'), '|', r.get('email')));

  } finally {
    session.close();
    driver.close();
  }
}
test().catch(e => console.log('ERR: ' + e.message));