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

async function check() {
  // Get all students and find Pinn Kant with studentId
  const data = await apiRequest('GET', '/api/students');
  const students = data.students;
  
  const pinnKant = students.find(s => s.name === 'Pinn Kant');
  console.log('Pinn Kant from API:', pinnKant);
  
  if (pinnKant) {
    // Try the studentId first
    const studentId = pinnKant.studentId || pinnKant.id;
    console.log('\nTrying studentId:', studentId);
    
    const progress = await apiRequest('GET', `/api/students/${studentId}/progress`);
    console.log('Progress:', JSON.stringify(progress, null, 2));
  }
}

check().catch(console.error);