// Deep check Railway for Russia student data
const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres:bzKcqKFQmBRyohbHcEEUROvFQRBmZbgQ@monorail.proxy.rlwy.net:38567/railway',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();

  // Check journal_entries for Russia data
  const je = await client.query('SELECT * FROM journal_entries LIMIT 2');
  console.log('journal_entries columns:', je.fields.map(f => f.name));
  if (je.rows.length) console.log('Sample:', JSON.stringify(je.rows[0], null, 2));

  // Count by source
  const src = await client.query('SELECT source, COUNT(*) FROM students GROUP BY source');
  console.log('\nStudents by source:', src.rows);

  // Check all columns in students
  const desc = await client.query('SELECT column_name FROM information_schema.columns WHERE table_name = \'students\'');
  console.log('\nAll students columns:', desc.rows.map(r => r.column_name));

  // Check classes table
  const cls = await client.query('SELECT * FROM classes LIMIT 3');
  console.log('\nClasses columns:', cls.fields.map(f => f.name));
  if (cls.rows.length) console.log('Sample class:', JSON.stringify(cls.rows[0], null, 2));

  await client.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });