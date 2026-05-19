/**
 * TickTick OAuth Setup
 * Step 1: Run this to get your authorization URL
 * Step 2: Visit the URL, authorize, copy the code from the redirect
 * Step 3: Run ticktick-get-token.js with the code
 */

const CLIENT_ID = 'j5N080Ukh5xW70Zh0A';
const REDIRECT_URI = 'http://localhost';
const SCOPE = 'tasks:write tasks:read';
const STATE = 'aybkk_lessons_2026';

const authUrl = `https://ticktick.com/oauth/authorize?` +
  `scope=${encodeURIComponent(SCOPE)}` +
  `&client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&state=${encodeURIComponent(STATE)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code`;

console.log('\n=== TICKTICK AUTHORIZATION ===\n');
console.log('Open this URL in your browser:\n');
console.log(authUrl);
console.log('\nAfter you authorize, your browser will redirect to localhost.');
console.log('The URL in your browser bar will look like:');
console.log('  http://localhost/?code=XXXXXXXX&state=aybkk_lessons_2026');
console.log('\nCopy the CODE value and send it to Claude.\n');
