const http = require('http');

async function apiRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };
    
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { resolve(body); }
      });
    });
    
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function seed() {
  console.log('🔍 Finding Pinn Kant...');
  
  // Get students list
  const data = await apiRequest('GET', '/api/students');
  const students = data.students;
  
  // Find Pinn Kant - use studentId (UUID), not internal id
  const pinnKant = students.find(s => s.name === 'Pinn Kant');
  if (!pinnKant) {
    console.log('Pinn Kant not found');
    return;
  }
  
  console.log('Pinn Kant - internal id:', pinnKant.id, ', studentId:', pinnKant.studentId);
  
  // Create sample progress checks over 4 weeks using studentId (UUID)
  const checkDates = [
    new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 3 weeks ago
    new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 2 weeks ago
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],   // 1 week ago
    new Date().toISOString().split('T')[0]                                          // today
  ];
  
  // Use studentId (UUID) for the API call
  const studentIdForApi = pinnKant.studentId || pinnKant.id;
  console.log('Using studentId for API:', studentIdForApi);
  
  let created = 0;
  for (let i = 0; i < checkDates.length; i++) {
    const week = i + 1;
    const progressData = {
      studentId: studentIdForApi,  // Use UUID, not internal id
      checkDate: checkDates[i],
      posture: 5 + i + Math.floor(Math.random() * 2),
      breathing: 5 + i + Math.floor(Math.random() * 2),
      flexibility: 4 + i + Math.floor(Math.random() * 2),
      strength: 5 + i + Math.floor(Math.random() * 2),
      balance: 6 + i + Math.floor(Math.random() * 2),
      focus: 6 + i + Math.floor(Math.random() * 2),
      notes: 'Sample data - TEST ONLY - delete after testing',
      teacher: 'Test Teacher'
    };
    
    try {
      const result = await apiRequest('POST', '/api/progress-check', progressData);
      if (result.success) {
        created++;
        console.log(`  ✅ Week ${week}: ${checkDates[i]} - posture: ${progressData.posture}`);
      } else {
        console.log(`  ❌ Week ${week} failed:`, result.error);
      }
    } catch (err) {
      console.log(`  ❌ Week ${week} error:`, err.message);
    }
  }
  
  console.log(`\n✅ Seeded ${created} progress checks for Pinn Kant`);
  console.log('📝 Go to http://localhost:3000 → Progress tab → Select Pinn Kant to see chart');
  console.log('\n⚠️  Remember to delete sample data after testing!');
}

seed().catch(console.error);