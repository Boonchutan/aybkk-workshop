const https = require('https');
const http = require('http');

const urls = [
  'https://aybkk.rezerv.io/admin',
  'https://aybkk.reserv.io/admin',
  'https://rezerv.io/business/aybkk',
  'https://app.rezerv.io/login',
  'https://dashboard.rezerv.io/aybkk'
];

function tryUrl(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ url, status: res.statusCode, length: data.length, preview: data.substring(0, 200) });
      });
    });
    req.on('error', (e) => resolve({ url, error: e.message }));
    req.setTimeout(5000, () => { req.destroy(); resolve({ url, error: 'timeout' }); });
  });
}

Promise.all(urls.map(tryUrl)).then(results => {
  results.forEach(r => {
    if (r.error) console.log(`ERROR ${r.url}: ${r.error}`);
    else console.log(`${r.status} [${r.length}b] ${r.url} -> ${r.preview.replace(/\n/g,' ').substring(0,100)}`);
  });
});