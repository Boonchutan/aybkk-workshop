require('dotenv').config();
const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
console.log('Token length:', token ? token.length : 0);
console.log('Token starts with:', token ? token.substring(0, 10) : 'NONE');
