#!/usr/bin/env node
/**
 * Discover all class IDs available on the AYBKK Rezerv account.
 *
 * Many of Rezerv's "list" endpoints return a `data` array with class
 * objects that include `id`, `name`, `startTime`. We try a couple of
 * likely paths since the exact one isn't yet captured.
 *
 *   REZERV_COOKIE='...' node scripts/rezerv-discover-classes.js
 *
 * If none of the guessed endpoints work, the error tells you the URL
 * to capture next from DevTools (the request that loads the schedule).
 */
require('dotenv').config();
const rz = require('../lib/rezerv-client');

const guesses = [
  '/v1/classes',
  '/v1/classes?CountPerPage=200&CurrentPage=1',
  '/v1/services',
  '/v1/services?CountPerPage=200',
  '/v1/bookings/classes',
  '/v1/bookings/schedule?Date=' + new Date().toISOString().slice(0,10),
  '/v1/schedules',
  '/v1/schedule?Date=' + new Date().toISOString().slice(0,10)
];

async function tryGet(path) {
  // Rezerv client doesn't expose raw GET, so we rebuild a thin call here
  const cookie = process.env.REZERV_COOKIE;
  if (!cookie) throw new Error('REZERV_COOKIE not set');
  const r = await fetch(`https://business-api.rezerv.co${path}`, {
    headers: {
      Accept: 'application/json',
      Referer: 'https://business.rezerv.co/',
      Origin: 'https://business.rezerv.co',
      Cookie: cookie
    }
  });
  return { status: r.status, body: r.status < 400 ? await r.json() : await r.text() };
}

(async () => {
  for (const p of guesses) {
    try {
      const { status, body } = await tryGet(p);
      console.log(`${status}  ${p}`);
      if (status < 400) {
        console.log('  → looks promising. First 800 chars of body:');
        console.log('  ' + JSON.stringify(body, null, 2).slice(0, 800).replace(/\n/g, '\n  '));
        console.log('');
      }
    } catch (e) {
      console.log(`ERR ${p} → ${e.message}`);
    }
  }
  console.log('\nIf none returned a usable list, capture another cURL from the Rezerv Schedule/Calendar page in DevTools and paste it.');
})().catch(e => { console.error(e.message); process.exit(1); });
