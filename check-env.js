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
// Optional: the main AYBKK LINE OA (its webhook, messages to students, and the team briefs, team-brief.js).
line('LINE_CHANNEL_SECRET', '(optional)');
line('LINE_CHANNEL_ACCESS_TOKEN', '(optional)');
// Optional: class photos in Cloudflare R2 (lib/r2.js), on only with all four. Without them new photos go to Cloudinary.
for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) line(k, '(optional)');
// Optional: the key the save, face and /ph photo links are signed with. Unset, they use CLOUDINARY_API_SECRET:
// set it to that same value before that variable ever goes, or every photo and face link handed out stops working.
line('PHOTO_LINK_SECRET', '(optional)');
