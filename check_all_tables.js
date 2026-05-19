require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const client = await pool.connect();
  
  // List all tables
  const tables = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  
  console.log('ALL TABLES:');
  tables.rows.forEach(t => console.log(' -', t.table_name));
  
  // Check total row counts
  console.log('');
  console.log('ROW COUNTS:');
  for (const table of ['students', 'bookings', 'classes', 'passes', 'journal_entries']) {
    try {
      const count = await client.query(`SELECT COUNT(*) FROM ${table}`);
      console.log(` ${table}: ${count.rows[0].count}`);
    } catch(e) {
      console.log(` ${table}: ERROR - ${e.message}`);
    }
  }
  
  client.release();
  await pool.end();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });