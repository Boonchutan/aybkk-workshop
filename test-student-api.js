const http = require('http');

function fetch(path) {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3000' + path, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve(data); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Testing Student Knowledge API...\n');
  
  console.log('1. /api/student/movements');
  const movements = await fetch('/api/student/movements');
  console.log(JSON.stringify(movements.slice(0, 5), null, 2));
  
  console.log('\n2. /api/student/asanas');
  const asanas = await fetch('/api/student/asanas');
  console.log(JSON.stringify(asanas.slice(0, 3), null, 2));
  
  console.log('\n3. /api/student/problems');
  const problems = await fetch('/api/student/problems');
  console.log(JSON.stringify(problems.slice(0, 2), null, 2));
}

main().catch(console.error);