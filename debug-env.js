require('dotenv').config();
console.log('URI:', process.env.NEO4J_URI);
console.log('USER:', process.env.NEO4J_USER);
console.log('PWD_LEN:', process.env.NEO4J_PASSWORD ? process.env.NEO4J_PASSWORD.length : 'EMPTY');