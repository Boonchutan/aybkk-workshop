const { Pool } = require('pg');
const pool = new Pool({ 
  connectionString: 'postgresql://postgres:***@monorail.proxy.rlwy.net:38567/railway',
  ssl: { rejectUnauthorized: false }
});

pool.query('SELECT id, name, email, phone, nationality, source, created_at from students ORDER BY id')
  .then(r => {
    console.log('Total students:', r.rows.length);
    console.log(JSON.stringify(r.rows, null, 2));
    pool.end();
  })
  .catch(e => console.error(e.message));
