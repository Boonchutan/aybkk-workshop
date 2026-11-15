require('dotenv').config();
const { Client } = require('pg');
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();
  const result = await client.query('SELECT id, name, email, phone, nationality, source, created_at from students ORDER BY id LIMIT 50');
  console.log('Total students:', result.rows.length);
  console.log(JSON.stringify(result.rows, null, 2));
  await client.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
