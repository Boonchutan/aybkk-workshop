const http = require('http');

function fetch(path) {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3000' + path, { headers: { 'X-Bkk-Key': (process.env.BKK_ADMIN_KEY || process.env.SHOP_ADMIN_KEY || '') } }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Testing /api/students/10/progress...');
  const result = await fetch('/api/students/10/progress');
  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);