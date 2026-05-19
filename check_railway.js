// Check Railway PostgreSQL for Russia students
const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:bzKcqKFQmBRyohbHcEEUROvFQRBmZbgQ@monorail.proxy.rlwy.net:38567/railway',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();

  // List tables
  const tables = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  console.log('Tables:', tables.rows.map(r => r.table_name));

  // Check students table
  try {
    const students = await client.query('SELECT * FROM students LIMIT 3');
    console.log('\nStudents columns:', students.fields.map(f => f.name));
    console.log('Sample:', JSON.stringify(students.rows[0], null, 2));
  } catch(e) {
    console.log('students table error:', e.message);
  }

  // Check for russia/location data
  try {
    const count = await client.query("SELECT COUNT(*) FROM students WHERE location ILIKE '%russia%' OR city ILIKE '%spb%' OR city ILIKE '%moscow%'");
    console.log('\nRussia/SPb/Moscow students:', count.rows[0].count);
  } catch(e) {
    console.log('Count error:', e.message);
  }

  await client.end();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });