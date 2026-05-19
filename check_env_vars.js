require('dotenv').config();
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'SET (' + process.env.DATABASE_URL.split('@')[1] + ')' : 'NOT SET');
console.log('All env vars:', Object.keys(process.env).sort().join(', '));