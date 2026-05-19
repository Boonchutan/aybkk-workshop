require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const client = await pool.connect();
  
  // Check bookings table schema
  const schema = await client.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'bookings'
  `);
  console.log('Bookings columns:', schema.rows.map(r => r.column_name).join(', '));
  
  // Check classes table schema  
  const clsSchema = await client.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'classes'
  `);
  console.log('Classes columns:', clsSchema.rows.map(r => r.column_name).join(', '));
  
  // Check journal_entries schema
  const jeSchema = await client.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'journal_entries'
  `);
  console.log('Journal entries columns:', jeSchema.rows.map(r => r.column_name).join(', '));
  
  client.release();
  await pool.end();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });