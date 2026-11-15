// The repo is public: no password, key or token in a tracked file, and no file that names
// students (rosters, QR cards, journals). Reads `git ls-files`, so it checks what GitHub shows.
// A failure prints the file, the line and the kind of leak, never the value.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const files = execFileSync('git', ['-c', 'core.quotepath=off', 'ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter(f => f && !f.startsWith('node_modules/'));

let PASS = 0, FAIL = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name} ${extra}`); }
};

// Files that name students live in private-data/ (git-ignored) or on the Railway volume.
const STUDENT_FILES = [
  /^public\/(rosters|qr-cards|downloads|photos)\//i,
  /^private-data\//,
  /(^|\/)[^/]*-students\.(json|csv)$/i,
  /(^|\/)journal-(students|checkins)\.json$/i,
  /(^|\/)teacher-comments\.json$/i,
  /(^|\/)[^/]*-cards-print(\/|\.zip$)/i,
];
// One release only: server.js copies this roster onto the volume, then a follow-up PR deletes it.
const UNTIL_COPIED = new Set(['public/rosters/hefei.json']);
const studentHits = files.filter(f => !UNTIL_COPIED.has(f) && STUDENT_FILES.some(rx => rx.test(f)));
ok('no tracked file that names students', studentHits.length === 0, studentHits.slice(0, 10).join(', '));

// Fixtures under test/ use made-up values on purpose; the values below look like secrets but are not.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/;
const RULES = [
  ['password typed into neo4j.auth.basic', /auth\.basic\(\s*[^,]+,\s*(['"`])[^'"`]+\1\s*\)/],
  ['password typed into a Python auth tuple', /auth\s*=\s*\(\s*(['"])[^'"]+\1\s*,\s*(['"])[^'"]+\2\s*\)/],
  ['secret as an env fallback', /\b[A-Z0-9_]*(PASSWORD|SECRET|TOKEN|API_KEY|ADMIN_KEY|PASS)\b\s*\|\|\s*(['"`])[^'"`]{6,}\2/],
  ['secret as a shell default', /\$\{[A-Z0-9_]*(PASSWORD|SECRET|TOKEN|KEY|PASS)[A-Z0-9_]*:-[^}]{4,}\}/],
  ['login inside a database URL', /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|neo4j(?:\+s)?|bolt):\/\/[^:\s'"/@]+:([^@\s'"]+)@([^/\s'"]+)/, m => !LOCAL_HOST.test(m[3]) && !/^(\$\{|\*+$)/.test(m[2])],
  ['Anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI or OpenRouter key', /\bsk-(proj-|or-v1-)[A-Za-z0-9_-]{20,}/],
  ['Telegram bot token', /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}/],
  ['GitHub token', /\b(ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/],
  ['AWS key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[abpr]-[A-Za-z0-9-]{10,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
const BINARY = /\.(png|jpe?g|gif|webp|heic|ico|pdf|zip|mp3|mp4|mov|wav|ttf|otf|woff2?|eot)$/i;
const secretHits = [];
for (const f of files) {
  if (BINARY.test(f) || f.startsWith('test/')) continue;
  let text;
  try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
  if (text.includes('\0')) continue;
  text.split('\n').forEach((line, i) => {
    for (const [kind, rx, keep] of RULES) {
      const m = rx.exec(line.slice(0, 4000));
      if (m && (!keep || keep(m))) secretHits.push(`${f}:${i + 1} ${kind}`);
    }
  });
}
ok('no password, key or token in a tracked file', secretHits.length === 0, '\n    ' + secretHits.slice(0, 20).join('\n    '));

console.log(`\n${PASS} passed, ${FAIL} failed`);
process.exit(FAIL ? 1 : 0);
