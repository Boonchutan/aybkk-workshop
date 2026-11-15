// Files that name students stay out of git (the repo is public): on the Railway volume in
// /data/private, on a computer in the git-ignored private-data/. Readable by the server only.
const fs = require('fs');
const path = require('path');

const PRIVATE_DIR = process.env.PRIVATE_DATA_DIR ||
  (fs.existsSync('/data') ? '/data/private' : path.join(__dirname, '..', 'private-data'));

const privatePath = (...parts) => path.join(PRIVATE_DIR, ...parts);

function readPrivateJson(...parts) {
  try { return JSON.parse(fs.readFileSync(privatePath(...parts), 'utf8')); } catch { return null; }
}

function writePrivateJson(value, ...parts) {
  const f = privatePath(...parts);
  fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
  fs.writeFileSync(f, JSON.stringify(value), { mode: 0o600 });
  return f;
}

// For one release while a file still ships in git: put a copy on the volume, then the repo copy goes.
function seedPrivateJson(value, ...parts) {
  if (value == null || fs.existsSync(privatePath(...parts))) return false;
  try { writePrivateJson(value, ...parts); return true; } catch (e) { console.error('private copy failed:', parts.join('/'), e.message); return false; }
}

module.exports = { PRIVATE_DIR, privatePath, readPrivateJson, writePrivateJson, seedPrivateJson };
