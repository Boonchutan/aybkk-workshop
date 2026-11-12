const fs = require('fs');
const dotenv = require('dotenv');
const raw = fs.readFileSync('.env', 'utf8');
console.log('RAW .env:', JSON.stringify(raw));
dotenv.config();
console.log('AFTER dotenv:', JSON.stringify({ uri: process.env.NEO4J_URI, user: process.env.NEO4J_USER, pwd: process.env.NEO4J_PASSWORD }));
// The Bangkok admin (bkk-api.js) and every student list (lib/staff-key.js) are closed without it: there is no default key.
console.log('BKK_ADMIN_KEY set:', !!(process.env.BKK_ADMIN_KEY || process.env.SHOP_ADMIN_KEY));
// Optional: the AYBKK help desk LINE OA (team briefs to the teacher group, team-brief.js).
console.log('HELPDESK_LINE_CHANNEL_SECRET set (optional):', !!process.env.HELPDESK_LINE_CHANNEL_SECRET);
console.log('HELPDESK_LINE_ACCESS_TOKEN set (optional):', !!process.env.HELPDESK_LINE_ACCESS_TOKEN);
