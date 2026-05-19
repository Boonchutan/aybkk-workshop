require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const client = await pool.connect();
  
  // This week's start (Sunday)
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  
  console.log('=== AYBKK WEEKLY REPORT ===');
  console.log(`Period: ${weekStart.toISOString().split('T')[0]} to ${weekEnd.toISOString().split('T')[0]}`);
  console.log('');
  
  // Get all classes this week
  const classes = await client.query(`
    SELECT id, title, type, instructor, location, starts_at 
    FROM classes 
    WHERE starts_at >= $1 AND starts_at < $2
    ORDER BY starts_at
  `, [weekStart.toISOString(), weekEnd.toISOString()]);
  
  console.log(`CLASSES THIS WEEK: ${classes.rows.length}`);
  classes.rows.forEach(c => {
    const day = new Date(c.starts_at).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    const time = new Date(c.starts_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    console.log(`  ${day} ${time} | ${c.title} | ${c.instructor} | ${c.type} | ${c.location || 'studio'}`);
  });
  
  console.log('');
  
  // Get bookings with check-in status
  const bookings = await client.query(`
    SELECT b.id, b.student_id, b.class_id, b.status, b.checked_in_at, b.booked_at,
           s.name as student_name,
           c.title as class_name, c.starts_at, c.instructor, c.type
    FROM bookings b
    JOIN students s ON b.student_id = s.id
    JOIN classes c ON b.class_id = c.id
    WHERE c.starts_at >= $1 AND c.starts_at < $2
    ORDER BY c.starts_at, s.name
  `, [weekStart.toISOString(), weekEnd.toISOString()]);
  
  console.log(`TOTAL BOOKINGS: ${bookings.rows.length}`);
  
  // Count by status
  const byStatus = {};
  bookings.rows.forEach(b => {
    byStatus[b.status] = (byStatus[b.status] || 0) + 1;
  });
  console.log('By status:', Object.entries(byStatus).map(([k,v]) => `${k}: ${v}`).join(', '));
  
  console.log('');
  console.log('ATTENDANCE DETAIL:');
  
  // Group by class
  const byClass = {};
  bookings.rows.forEach(b => {
    if (!byClass[b.class_id]) {
      byClass[b.class_id] = { name: b.class_name, time: b.starts_at, instructor: b.instructor, students: [] };
    }
    byClass[b.class_id].students.push({
      name: b.student_name,
      status: b.status,
      checked_in: b.checked_in_at ? '✓' : '✗'
    });
  });
  
  Object.values(byClass).forEach(cls => {
    const day = new Date(cls.time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const time = new Date(cls.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const checkedIn = cls.students.filter(s => s.status === 'checked_in').length;
    console.log(`\n${day} ${time} - ${cls.name} (${cls.instructor}) [${checkedIn}/${cls.students.length}]`);
    cls.students.forEach(s => {
      console.log(`  ${s.checked_in} ${s.name} (${s.status})`);
    });
  });
  
  // Student summary - who attended most
  console.log('');
  console.log('TOP ATTENDING STUDENTS:');
  const studentCount = {};
  bookings.rows.filter(b => b.status === 'checked_in').forEach(b => {
    studentCount[b.student_name] = (studentCount[b.student_name] || 0) + 1;
  });
  Object.entries(studentCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, count]) => {
      console.log(`  ${count}x ${name}`);
    });
  
  client.release();
  await pool.end();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });