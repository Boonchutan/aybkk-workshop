// attendance-api.js — offline-first workshop check-in sync + short links
//
// Mount into any Express app with:  mountAttendance(app, { pgPool })
// Everything here is ADDITIVE and best-effort. The check-in station works
// fully offline without this; these routes just let the iPad sync its data
// back and let printed short links (/s/HEFEI-001) open a student journal.

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

function mountAttendance(app, opts = {}) {
  const pgPool = opts.pgPool || null;
  const rosterFile = opts.rosterFile || path.join(__dirname, 'public', 'rosters', 'hefei.json');
  const dataDir = opts.dataDir || (fs.existsSync('/data') ? '/data' : path.join(__dirname, 'data'));
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}
  const storeFile = path.join(dataDir, 'attendance.json');

  let pgReady = false;
  if (pgPool) {
    pgPool.query(`
      CREATE TABLE IF NOT EXISTS attendance (
        id SERIAL PRIMARY KEY,
        workshop      TEXT,
        journal_id    TEXT,
        student_code  TEXT,
        name          TEXT,
        session       TEXT,
        session_date  DATE,
        checked_in_at TIMESTAMPTZ,
        eligible      BOOLEAN,
        source        TEXT,
        photo_file    TEXT,
        UNIQUE (workshop, journal_id, session)
      )
    `).then(() => pgPool.query('ALTER TABLE attendance ADD COLUMN IF NOT EXISTS photo_file TEXT'))
      .then(() => { pgReady = true; console.log('✓ attendance table ready'); })
      .catch(e => console.error('attendance table init failed:', e.message));
  }

  const readStore = () => { try { return JSON.parse(fs.readFileSync(storeFile, 'utf8')); } catch { return []; } };
  const writeStore = (rows) => { try { fs.writeFileSync(storeFile, JSON.stringify(rows, null, 2)); } catch (e) { console.error('attendance write failed:', e.message); } };
  const readRoster = () => { try { return JSON.parse(fs.readFileSync(rosterFile, 'utf8')); } catch { return null; } };
  const keyOf = (r) => (r.workshop || 'hefei') + '|' + (r.journalId || r.studentCode || r.id || '') + '|' + (r.session || '');

  // POST /api/attendance/checkin  — body: { rows:[...] }  or a single record
  app.post('/api/attendance/checkin', async (req, res) => {
    try {
      const body = req.body || {};
      const rows = Array.isArray(body.rows) ? body.rows : ((body.journalId || body.session || body.id) ? [body] : []);
      if (!rows.length) return res.status(400).json({ error: 'no rows' });

      if (pgReady) {
        for (const r of rows) {
          try {
            await pgPool.query(
              `INSERT INTO attendance (workshop,journal_id,student_code,name,session,session_date,checked_in_at,eligible,source,photo_file)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
               ON CONFLICT (workshop,journal_id,session) DO UPDATE
                 SET checked_in_at=EXCLUDED.checked_in_at, eligible=EXCLUDED.eligible, source=EXCLUDED.source,
                     photo_file=COALESCE(EXCLUDED.photo_file, attendance.photo_file)`,
              [r.workshop || 'hefei', r.journalId || r.id || null, r.studentCode || r.id || null, r.name || null,
               r.session || null, r.sessionDate || null, r.checkedInAt || new Date().toISOString(),
               r.eligible === false ? false : true, r.source || 'station', r.photoFile || null]
            );
          } catch (e) { /* keep going; JSON mirror below is the guarantee */ }
        }
      }

      // JSON mirror (always, dedup by workshop|student|session)
      const store = readStore();
      for (const r of rows) {
        const rec = { ...r, workshop: r.workshop || 'hefei', savedAt: new Date().toISOString() };
        const i = store.findIndex(x => keyOf(x) === keyOf(rec));
        if (i >= 0) store[i] = rec; else store.push(rec);
      }
      writeStore(store);

      res.json({ success: true, saved: rows.length, pg: pgReady });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/attendance?workshop=hefei — JSON dump (teacher view / backup)
  app.get('/api/attendance', (req, res) => {
    let rows = readStore();
    if (req.query.workshop) rows = rows.filter(r => (r.workshop || 'hefei') === req.query.workshop);
    res.json({ count: rows.length, rows });
  });

  // GET /api/attendance.csv?workshop=hefei — spreadsheet backup
  app.get('/api/attendance.csv', (req, res) => {
    let rows = readStore();
    if (req.query.workshop) rows = rows.filter(r => (r.workshop || 'hefei') === req.query.workshop);
    const cols = ['workshop', 'studentCode', 'name', 'package', 'session', 'sessionDate', 'checkedInAt', 'eligible', 'source', 'photoFile'];
    const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => esc(r[c])).join(','))).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="attendance-' + (req.query.workshop || 'all') + '.csv"');
    res.send('﻿' + csv); // BOM so Excel reads Chinese names correctly
  });

  // GET /s/:code — printed short link. Maps HEFEI-001 -> student journal via roster.
  app.get('/s/:code', (req, res) => {
    const code = req.params.code;
    const roster = readRoster();
    let entry = null;
    if (roster && Array.isArray(roster.students)) {
      entry = roster.students.find(s => s.id === code || s.journalId === code
        || (s.slug && s.slug === String(code).toLowerCase()));
    }
    const uuid = entry ? entry.journalId : code;
    const name = entry ? entry.name : '';
    const lang = (roster && roster.lang) || 'zh';
    const url = '/student.html?id=' + encodeURIComponent(uuid) +
                (name ? '&name=' + encodeURIComponent(name) : '') +
                '&lang=' + encodeURIComponent(lang) +
                '&location=' + encodeURIComponent((roster && roster.location) || 'hefei');
    res.redirect(302, url);
  });

  // GET /api/attendance/pass/:id — digital door pass for the journal front page.
  // id = journalId | HEFEI-### | slug. QR encodes the short slug link on the
  // China-reachable roster.baseUrl (never the request host), which the door
  // station already knows how to scan.
  app.get('/api/attendance/pass/:id', async (req, res) => {
    try {
      const roster = readRoster();
      if (!roster || !Array.isArray(roster.students)) return res.status(404).json({ error: 'no roster' });
      const id = String(req.params.id || '');
      const s = roster.students.find(x =>
        x.journalId === id || x.id === id || (x.slug && x.slug === id.toLowerCase()));
      if (!s) return res.status(404).json({ error: 'not on roster' });
      const base = (roster.baseUrl || 'https://cn.aybkk.net').replace(/\/$/, '');
      const shortUrl = base + '/s/' + (s.slug || s.id);
      const qrDataUrl = await QRCode.toDataURL(shortUrl,
        { errorCorrectionLevel: 'H', width: 320, margin: 2 });
      res.set('Cache-Control', 'public, max-age=3600');
      res.json({ slug: s.slug || s.id, shortUrl, qrDataUrl, name: s.name, code: s.id, package: s.package });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  console.log('✓ attendance-api mounted (POST /api/attendance/checkin, GET /api/attendance[.csv], GET /s/:code, GET /api/attendance/pass/:id)');
}

module.exports = { mountAttendance };
