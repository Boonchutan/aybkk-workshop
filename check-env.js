// Says which settings are present, never their values: this output can end up in a log or a chat.
require('dotenv').config();

const has = k => !!process.env[k];
const line = (k, note = '') => console.log(`${has(k) ? '✓' : '✗'} ${k}${note ? '  ' + note : ''}`);

line('DATABASE_URL', '(Postgres: bookings, members, orders)');
line('NEO4J_URI', '(Neo4j: journals, orientations, China workshops)');
line('NEO4J_USER');
line('NEO4J_PASSWORD');
// The Bangkok admin (bkk-api.js) and every student list (lib/staff-key.js) are closed without it: there is no default key.
console.log(`${has('BKK_ADMIN_KEY') || has('SHOP_ADMIN_KEY') ? '✓' : '✗'} BKK_ADMIN_KEY (or SHOP_ADMIN_KEY)`);
// The main LINE OA webhook (/line/webhook) refuses everything without the channel secret: no follow, no claim code.
line('LINE_CHANNEL_SECRET', '(main LINE OA webhook signature)');
line('LINE_CHANNEL_ACCESS_TOKEN', '(main LINE OA pushes)');
// Optional: the AYBKK help desk LINE OA (team briefs to the teacher group, team-brief.js).
line('HELPDESK_LINE_CHANNEL_SECRET', '(optional)');
line('HELPDESK_LINE_ACCESS_TOKEN', '(optional)');
