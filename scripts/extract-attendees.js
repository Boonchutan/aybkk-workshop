#!/usr/bin/env node
/**
 * Extract attendee emails from a Rezerv attendance CSV export.
 *
 * Today: you manually export today's attendance from Rezerv admin
 *        ("Reports → Attendance → CSV") and pass the path here.
 * Later: a scraper will produce this CSV automatically.
 *
 *   node scripts/extract-attendees.js path/to/attendance.csv
 *   node scripts/extract-attendees.js path/to/attendance.csv --class "Mysore"
 *   node scripts/extract-attendees.js path/to/attendance.csv --emails-only
 *
 * Output: prints class summary + comma-joined emails ready to paste into
 * aybkk-line-broadcast.js --emails "..."
 */
const fs = require('fs');
const path = require('path');

function parseCSV(filepath) {
  const content = fs.readFileSync(filepath, 'utf8').replace(/\r/g, '').trim();
  const lines = content.split('\n');
  const headers = splitCsvLine(lines[0]).map(h => h.trim());
  return lines.slice(1).filter(Boolean).map(line => {
    const values = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => row[h] = (values[i] || '').trim());
    return row;
  });
}

// Minimal CSV split that handles quoted commas
function splitCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function findEmailColumn(row) {
  const keys = Object.keys(row);
  return keys.find(k => /email/i.test(k)) || null;
}
function findClassColumn(row) {
  const keys = Object.keys(row);
  return keys.find(k => /class|booking|service/i.test(k)) || null;
}
function findStatusColumn(row) {
  const keys = Object.keys(row);
  return keys.find(k => /status|attended|check/i.test(k)) || null;
}

const args = process.argv.slice(2);
const csvPath = args.find(a => !a.startsWith('--'));
const classFilter = args[args.indexOf('--class') + 1] && !args[args.indexOf('--class') + 1].startsWith('--')
  ? args[args.indexOf('--class') + 1] : null;
const emailsOnly = args.includes('--emails-only');

if (!csvPath) {
  console.error('Usage: node scripts/extract-attendees.js <path-to-csv> [--class "Mysore"] [--emails-only]');
  process.exit(1);
}

const rows = parseCSV(csvPath);
if (!rows.length) { console.error('CSV is empty.'); process.exit(1); }

const emailCol = findEmailColumn(rows[0]);
const classCol = findClassColumn(rows[0]);
const statusCol = findStatusColumn(rows[0]);

if (!emailCol) {
  console.error('No email column found. Headers were:');
  console.error(Object.keys(rows[0]).join(', '));
  process.exit(1);
}

let filtered = rows.filter(r => r[emailCol]);

// Drop "no-show" or "cancelled" if a status column is present
if (statusCol) {
  filtered = filtered.filter(r => {
    const s = (r[statusCol] || '').toLowerCase();
    return !s.includes('cancel') && !s.includes('no-show') && !s.includes('no show');
  });
}

if (classFilter) {
  if (!classCol) {
    console.error(`--class "${classFilter}" given but no class column found.`);
    process.exit(1);
  }
  filtered = filtered.filter(r => (r[classCol] || '').toLowerCase().includes(classFilter.toLowerCase()));
}

const emails = [...new Set(filtered.map(r => r[emailCol].toLowerCase().trim()))];

if (emailsOnly) {
  console.log(emails.join(','));
} else {
  console.log(`File:     ${path.basename(csvPath)}`);
  console.log(`Rows:     ${rows.length}`);
  console.log(`Email col: ${emailCol}`);
  if (classCol) console.log(`Class col: ${classCol}`);
  if (statusCol) console.log(`Status col: ${statusCol}`);
  if (classFilter) console.log(`Filter:   class contains "${classFilter}"`);
  console.log(`Unique attendee emails: ${emails.length}\n`);
  emails.forEach(e => console.log('  ' + e));
  console.log('\n--- pipeable ---');
  console.log(emails.join(','));
}
