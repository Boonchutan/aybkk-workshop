const fs = require('fs');
const dotenv = require('dotenv');
const raw = fs.readFileSync('.env', 'utf8');
console.log('RAW .env:', JSON.stringify(raw));
dotenv.config();
console.log('AFTER dotenv:', JSON.stringify({ uri: process.env.NEO4J_URI, user: process.env.NEO4J_USER, pwd: process.env.NEO4J_PASSWORD }));