const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));

async function logToAgora(source, content) {
  const session = driver.session();
  try {
    await session.run(`
      CREATE (l:Log {
        source: $source,
        content: $content,
        timestamp: datetime()
      })
    `, { source, content });
    console.log(`[LOGGED] ${source}: ${content.slice(0, 80)}...`);
  } finally {
    await session.close();
  }
}

async function main() {
  const session = driver.session();
  
  try {
    // Log the workshop setup completion
    await logToAgora('Neo', 'WORKSHOP SETUP COMPLETE — Student Journal System ready for Chinese Workshop (March 28, 2026)');
    
    await logToAgora('Neo', 'Workshop URLs — Public tunnel: https://1fbb4d3ec59313a1-171-6-16-246.serveousercontent.com');
    await logToAgora('Neo', 'register.html = Host dashboard (dark Claude-style UI, 23 students pre-loaded, walk-in support)');
    await logToAgora('Neo', 'student.html = Student self-assessment form (EN/TH/ZH, QR-based check-in)');
    
    await logToAgora('Neo', 'Workshop students (23 total): 16 x 3-week, 3 x deep-course, 2 x 1-week, 1 x 9-day, 1 x 4-day Mysore');
    
    await logToAgora('Neo', 'Tunnel: serveo.net SSH reverse tunnel. May need restart if dropped. Command: ssh -o StrictHostKeyChecking=no -R 80:localhost:3000 serveo.net');
    
    await logToAgora('Neo', 'QR URLs now use TUNNEL_URL env var (falls back to serveo URL). API updated: /api/journal/profile, /api/journal/qr/:id, /api/journal/checkin');
    
    await logToAgora('Neo', 'register.html features: Student list with search, tap-to-show-QR, walk-in registration, next-student button, 3-language support');
    
    // Update TeamMemory with workshop-specific info
    await session.run(`
      MATCH (tm:TeamMemory {id: 'aybkk-shared'})
      SET tm.workshopSystem = 'Student Journal QR system built March 22, deployed for Chinese Workshop March 28',
          tm.workshopRegisterUrl = 'https://1fbb4d3ec59313a1-171-6-16-246.serveousercontent.com/register.html',
          tm.workshopStudentUrl = 'https://1fbb4d3ec59313a1-171-6-16-246.serveousercontent.com/student.html',
          tm.workshopTunnelCommand = 'ssh -o StrictHostKeyChecking=no -R 80:localhost:3000 serveo.net',
          tm.workshopStudentCount = 23,
          tm.workshopDate = 'March 28, 2026',
          tm.updatedAt = datetime()
    `);
    console.log('\n[TEAM MEMORY UPDATED]');
    
    // Count total logs
    const count = await session.run('MATCH (l:Log) RETURN count(l) as cnt');
    console.log(`\nTotal Log nodes in Agora: ${count.records[0].get('cnt')}`);
    
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);