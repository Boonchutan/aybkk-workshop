const crypto = require('crypto');
const password = 'AyBkk2026'; // 8+ chars
const salt = crypto.randomBytes(32);
const hash1 = crypto.createHash('sha256').update(salt).update(password).digest('hex');
const hash2 = crypto.createHash('sha256').update(salt).update(hash1).digest('hex');
console.log('salt:', salt.toString('hex'));
console.log('HASH1:', hash1);
console.log('HASH2:', hash2);
console.log('auth line:', 'neo4j:SHA-256,' + hash1 + ',' + hash2 + ',0:');
console.log('');
console.log('Full auth.ini content:');
console.log('neo4j:SHA-256,' + hash1 + ',' + hash2 + ',0:');