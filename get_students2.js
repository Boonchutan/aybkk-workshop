const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres:aybkk_neo4j_2026@monorail.proxy.rlwy.net:38567/railway',
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
