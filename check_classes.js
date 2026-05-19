require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const client = await pool.connect();
  
  // Check upcoming classes (next 2 weeks)
  const now = new Date();
  const twoWeeks = new Date(now);
  twoWeeks.setDate(now.getDate() + 14);
  
  console.log('Today:', now.toISOString());
  console.log('');
  
  // Classes in range
  const classes = await client.query(`
    SELECT id, title, type, instructor, location, starts_at 
    FROM classes 
    WHERE starts_at >= $1 AND starts_at <= $2
    ORDER BY starts_at
    LIMIT 50
  `, [now.toISOString(), twoWeeks.toISOString()]);
  
  console.log(`UPCOMING CLASSES (next 14 days): ${classes.rows.length}`);
  classes.rows.forEach(c => {
    const day = new Date(c.starts_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const time = new Date(c.starts_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    console.log(`  ${day} ${time} | ${c.title} | ${c.instructor} | ${c.type}`);
  });
  
  // Recent classes (past 7 days)
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 7);
  
  const recent = await client.query(`
    SELECT id, title, type, instructor, starts_at 
    FROM classes 
    WHERE starts_at >= $1 AND starts_at <= $2
    ORDER BY starts_at DESC
    LIMIT 30
  `, [weekAgo.toISOString(), now.toISOString()]);
  
  console.log('');
  console.log(`RECENT CLASSES (past 7 days): ${recent.rows.length}`);
  recent.rows.forEach(c => {
    const day = new Date(c.starts_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const time = new Date(c.starts_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    console.log(`  ${day} ${time} | ${c.title} | ${c.instructor}`);
  });
  
  // Check bookings for recent classes
  console.log('');
  const recentBookings = await client.query(`
    SELECT COUNT(*) as total, 
           SUM(CASE WHEN status = 'checked_in' THEN 1 ELSE 0 END) as checked_in,
           SUM(CASE WHEN status = 'booked' THEN 1 ELSE 0 END) as booked,
           SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
    FROM bookings b
    JOIN classes c ON b.class_id = c.id
    WHERE c.starts_at >= $1 AND c.starts_at <= $2
  `, [weekAgo.toISOString(), now.toISOString()]);
  
  console.log('RECENT BOOKINGS:');
  const r = recentBookings.rows[0];
  console.log(`  Total: ${r.total}, Checked in: ${r.checked_in}, Booked: ${r.booked}, Cancelled: ${r.cancelled}`);
  
  client.release();
  await pool.end();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });