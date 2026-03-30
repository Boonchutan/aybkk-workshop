const {Client} = require('@notionhq/client');
const n = new Client({auth:'test'});
const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(n));
console.log('Available methods containing "database", "query", or "search":');
methods.filter(m => m.includes('database') || m.includes('query') || m.includes('search')).forEach(m => console.log(' -', m));

console.log('\nAll public methods:');
methods.forEach(m => console.log(' -', m));