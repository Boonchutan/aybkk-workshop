// The staff key for student lists and counts: the same X-Bkk-Key and BKK_ADMIN_KEY
// as the Bangkok admin. No key set means closed, never open: the repo is public.
const crypto = require('crypto');
const path = require('path');

const staffKey = () => process.env.BKK_ADMIN_KEY || process.env.SHOP_ADMIN_KEY || '';

function isStaff(req) {
  const key = Buffer.from(staffKey());
  const got = Buffer.from(String(req.headers['x-bkk-key'] || ''));
  return key.length > 0 && got.length === key.length && crypto.timingSafeEqual(got, key);
}

// no-store on both answers, so no cache in between hands a keyed reply to someone without the key.
// public/staff-key.js asks for the key only on a 401 that names it in WWW-Authenticate.
const deny = res => res.set('WWW-Authenticate', 'X-Bkk-Key').status(401);
function staffOnly(req, res, next) {
  res.set('Cache-Control', 'private, no-store');
  if (isStaff(req)) return next();
  deny(res).json({ error: 'staff key required' });
}

// Workshop rosters and the printed QR cards in public/ carry student names. express.static
// decodes and normalises the path (/%72osters/…, //rosters/…), so the check reads it the same way.
const STAFF_FILES = /^\/(rosters|qr-cards|downloads)(\/|$)/i;
function staffFiles(req, res, next) {
  let p;
  try { p = path.posix.normalize(decodeURIComponent(req.path)); } catch { return next(); }
  return STAFF_FILES.test(p) ? staffOnly(req, res, next) : next();
}

module.exports = { isStaff, staffOnly, staffFiles, deny };
