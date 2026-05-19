// Export all workshop (Russia) students from Railway
const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres:bzKcqKFQmBRyohbHcEEUROvFQRBmZbgQ@monorail.proxy.rlwy.net:38567/railway',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();

  const result = await client.query(`
    SELECT id, name, email, phone, nationality, notes, source,
           rezerv_id, created_at, updated_at, journal_link, last_asana,
           journal_id
    FROM students WHERE source = 'workshop'
    ORDER BY created_at
  `);

  const students = result.rows;
  console.log(`Total workshop students: ${students.length}`);

  // Group by city/location from notes or name patterns
  const byCity = { spb: [], moscow: [], unknown: [] };
  for (const s of students) {
    const notes = (s.notes || '').toLowerCase();
    const name = (s.name || '').toLowerCase();
    if (notes.includes('spb') || notes.includes('petersburg') || notes.includes('спб')) {
      byCity.spb.push(s);
    } else if (notes.includes('moscow') || notes.includes('москва')) {
      byCity.moscow.push(s);
    } else {
      byCity.unknown.push(s);
    }
  }

  console.log(`SPb: ${byCity.spb.length}, Moscow: ${byCity.moscow.length}, Unknown: ${byCity.unknown.length}`);

  // Print unknown ones
  if (byCity.unknown.length > 0 && byCity.unknown.length <= 10) {
    console.log('\nUnknown city students:');
    for (const s of byCity.unknown) {
      console.log('  ' + s.name + ' | ' + s.email + ' | notes: ' + (s.notes||'').substring(0,100));
    }
  } else if (byCity.unknown.length > 10) {
    console.log(`\nFirst 5 unknown:`);
    for (const s of byCity.unknown.slice(0, 5)) {
      console.log('  ' + s.name + ' | notes: ' + (s.notes||'').substring(0,100));
    }
  }

  // Sample student
  console.log('\nSample SPb student:', JSON.stringify(byCity.spb[0], null, 2));
  console.log('\nSample Moscow student:', JSON.stringify(byCity.moscow[0], null, 2));

  await client.end();

  // Save to file for sync
  const fs = require('fs');
  fs.writeFileSync('/tmp/workshop_students.json', JSON.stringify(students, null, 2));
  console.log('\nSaved to /tmp/workshop_students.json');
}
main().catch(e => { console.error(e.message); process.exit(1); });