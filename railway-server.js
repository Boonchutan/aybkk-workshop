const express = require('express');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { v4: uuidv4 } = (() => { try { return require('uuid'); } catch { return { v4: () => Math.random().toString(36).slice(2) + Date.now().toString(36) }; } })();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── PostgreSQL (shared with booking system) ───────────────────────────────────
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('railway.internal') ? false : { rejectUnauthorized: false } })
  : null;

async function pgQuery(sql, params = []) {
  if (!pool) throw new Error('No DATABASE_URL configured');
  const client = await pool.connect();
  try { return await client.query(sql, params); }
  finally { client.release(); }
}

const dbReady = !!pool;
if (dbReady) console.log('✓ PostgreSQL connected (shared booking system DB)');
else console.log('⚠ No DATABASE_URL — falling back to JSON files');

// ── JSON file fallback (legacy / local dev) ───────────────────────────────────
const DATA_DIR = '/data';
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
const JOURNAL_FILE  = path.join(DATA_DIR, 'journal-checkins.json');
const STUDENTS_FILE = path.join(DATA_DIR, 'journal-students.json');
const COMMENTS_FILE = path.join(DATA_DIR, 'teacher-comments.json');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Seed volume from local files if empty (first deploy)
function seedIfEmpty() {
  try {
    const students = readJson(STUDENTS_FILE);
    if (students.length < 100) {
      const localStudents = path.join(__dirname, 'journal-students.json');
      if (fs.existsSync(localStudents)) {
        fs.copyFileSync(localStudents, STUDENTS_FILE);
        console.log('✓ Seeded students:', readJson(STUDENTS_FILE).length);
      }
    }
    const checkins = readJson(JOURNAL_FILE);
    if (checkins.length < 5) {
      const localCheckins = path.join(__dirname, 'journal-checkins.json');
      if (fs.existsSync(localCheckins)) {
        fs.copyFileSync(localCheckins, JOURNAL_FILE);
        console.log('✓ Seeded checkins:', readJson(JOURNAL_FILE).length);
      }
    }
  } catch (e) {
    console.log('Seed error:', e.message);
  }
}
seedIfEmpty();

// ============================================
// JOURNAL API (file-based, no Neo4j needed)
// ============================================

// POST /api/journal/profile — register student
app.post('/api/journal/profile', async (req, res) => {
  try {
    const { name, language } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });

    if (dbReady) {
      // Check existing by name
      const existing = await pgQuery(
        `SELECT id, journal_id FROM students WHERE LOWER(TRIM(name)) = LOWER($1) LIMIT 1`,
        [name.trim()]
      );
      if (existing.rows.length > 0) {
        const s = existing.rows[0];
        // Ensure journal_id exists
        if (!s.journal_id) {
          const newId = uuidv4();
          await pgQuery(`UPDATE students SET journal_id = $1 WHERE id = $2`, [newId, s.id]);
          return res.json({ studentId: newId, name: name.trim() });
        }
        return res.json({ studentId: s.journal_id, name: name.trim() });
      }
      // Insert new student
      const journalId = uuidv4();
      await pgQuery(
        `INSERT INTO students (name, source, journal_id) VALUES ($1, 'workshop', $2)`,
        [name.trim(), journalId]
      );
      return res.json({ studentId: journalId, name: name.trim() });
    }

    // JSON fallback
    const students = readJson(STUDENTS_FILE);
    const existing = students.find(s => s.name === name);
    if (existing) return res.json({ studentId: existing.id, name: existing.name });
    const id = uuidv4();
    students.push({ id, name, language: language || 'zh', createdAt: new Date().toISOString() });
    writeJson(STUDENTS_FILE, students);
    res.json({ studentId: id, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/journal/checkin — student submits assessment
app.post('/api/journal/checkin', async (req, res) => {
  try {
    const { studentId, studentName, vinyasa, bandha, stableToday, difficultToday, lastAsanaNote, practiceNotes, sessionDate, platform } = req.body;
    if (!studentId || !vinyasa || !bandha) return res.status(400).json({ error: 'Missing fields' });

    if (dbReady) {
      // Resolve journal UUID → integer student id
      const s = await pgQuery(`SELECT id FROM students WHERE journal_id = $1 LIMIT 1`, [studentId]);
      if (!s.rows.length) return res.status(404).json({ error: 'Student not found. Register first.' });
      const sid = s.rows[0].id;

      await pgQuery(
        `INSERT INTO journal_entries
           (student_id, session_date, vinyasa, bandha, stable_today,
            difficult_today, last_asana_note, practice_notes, platform)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          sid,
          sessionDate || new Date().toISOString().split('T')[0],
          vinyasa, bandha,
          Array.isArray(stableToday)    ? stableToday    : (stableToday    ? [stableToday]    : []),
          Array.isArray(difficultToday) ? difficultToday : (difficultToday ? [difficultToday] : []),
          lastAsanaNote  || null,
          practiceNotes  || null,
          platform       || 'web',
        ]
      );
      return res.json({ success: true });
    }

    // JSON fallback
    const checkins = readJson(JOURNAL_FILE);
    const entry = {
      id: uuidv4(), studentId, studentName: studentName || '',
      vinyasa, bandha,
      stableToday: stableToday || [], difficultToday: difficultToday || [],
      lastAsanaNote: lastAsanaNote || '', practiceNotes: practiceNotes || '',
      sessionDate: sessionDate || new Date().toISOString().split('T')[0],
      platform: platform || 'web', checkedInAt: new Date().toISOString()
    };
    checkins.push(entry);
    writeJson(JOURNAL_FILE, checkins);
    res.json({ success: true, checkinId: entry.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/journal/students — list all students with last assessment
app.get('/api/journal/students', async (req, res) => {
  try {
    if (dbReady) {
      const result = await pgQuery(`
        SELECT s.id, s.name, s.journal_id,
               COUNT(j.id)::int AS assessment_count,
               MAX(j.session_date) AS last_session
        FROM students s
        LEFT JOIN journal_entries j ON j.student_id = s.id
        WHERE s.journal_id IS NOT NULL
        GROUP BY s.id
        ORDER BY s.name
      `);
      return res.json({
        students: result.rows.map(s => ({
          id: s.journal_id,
          name: s.name,
          classType: 'chinese',
          assessmentCount: s.assessment_count,
          lastSession: s.last_session,
        })),
        count: result.rows.length
      });
    }

    // JSON fallback
    const students = readJson(STUDENTS_FILE);
    const checkins = readJson(JOURNAL_FILE);
    const mapped = students.map(s => {
      const myCheckins = checkins.filter(c => c.studentId === s.id).sort((a, b) => b.checkedInAt.localeCompare(a.checkedInAt));
      return { id: s.id, name: s.name, classType: 'chinese', createdAt: s.createdAt, lastAssessment: myCheckins[0] || null, assessmentCount: myCheckins.length };
    });
    res.json({ students: mapped, count: mapped.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/journal/history/:days — all assessments in last N days
app.get('/api/journal/history/:days', (req, res) => {
  try {
    const days = parseInt(req.params.days) || 7;
    const checkins = readJson(JOURNAL_FILE);
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();

    const history = checkins
      .filter(c => c.checkedInAt >= cutoff)
      .sort((a, b) => b.checkedInAt.localeCompare(a.checkedInAt));

    res.json({ history, count: history.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/journal/profiles — all orientation profiles (for teacher summary cards)
app.get('/api/journal/profiles', (req, res) => {
  try {
    const file = path.join(DATA_DIR, 'orientations.json');
    let orientations = [];
    try { orientations = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}

    const checkins = readJson(JOURNAL_FILE);

    const profiles = orientations.map(o => {
      const name = o.englishName || o.chineseName || o.name || '';
      const myCheckins = checkins.filter(c => 
        c.studentName === name || c.studentName === o.englishName || c.studentName === o.chineseName
      ).sort((a, b) => b.checkedInAt.localeCompare(a.checkedInAt));
      return {
        id: o.id || name,
        name: name,
        englishName: o.englishName || null,
        chineseName: o.chineseName || null,
        city: o.city || null,
        yearsPractice: o.yearsPractice || null,
        lastAsana: o.lastAsana || null,
        difficulties: o.difficulties || [],
        injury: o.injury || null,
        classType: o.classType || null,
        totalCheckins: myCheckins.length,
        recentAssessments: myCheckins.slice(0, 3)
      };
    });

    res.json({ profiles, count: profiles.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Simple file-based orientation storage (works without Neo4j)
function saveOrientation(req, res) {
  try {
    const { name, language, wechat } = req.body;
    const studentId = 'gz-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
    const data = {
      ...req.body,
      id: studentId,
      submittedAt: new Date().toISOString()
    };

    const file = path.join(DATA_DIR, 'orientations.json');
    let orientations = [];
    try {
      orientations = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}

    orientations.push(data);
    fs.writeFileSync(file, JSON.stringify(orientations, null, 2));

    const baseUrl = 'https://aybkk-ashtanga.up.railway.app';
    const journalLink = baseUrl + '/student.html?id=' + studentId + '&name=' + encodeURIComponent(name || '') + '&lang=' + (language || 'zh') + '&location=guangzhou';

    res.json({ success: true, studentId, journalLink, name: name || '' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

app.post('/api/orientation', saveOrientation);
app.post('/api/orientations', saveOrientation);

// Get all orientations (for later import to Neo4j)
app.get('/api/orientations', (req, res) => {
  try {
    const file = path.join(DATA_DIR, 'orientations.json');
    let orientations = [];
    try {
      orientations = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    res.json({ orientations, count: orientations.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/journal/student/:id — student with full history (id = journal UUID)
app.get('/api/journal/student/:id', async (req, res) => {
  try {
    if (dbReady) {
      const s = await pgQuery(
        `SELECT id, name, journal_id FROM students WHERE journal_id = $1 LIMIT 1`,
        [req.params.id]
      );
      if (!s.rows.length) return res.status(404).json({ error: 'Student not found' });
      const student = s.rows[0];

      const entries = await pgQuery(
        `SELECT session_date, vinyasa, bandha, stable_today, difficult_today,
                last_asana_note, practice_notes, platform, created_at
         FROM journal_entries
         WHERE student_id = $1
         ORDER BY session_date DESC, created_at DESC`,
        [student.id]
      );

      const assessments = entries.rows.map(e => ({
        sessionDate:    e.session_date?.toISOString?.()?.split('T')[0] || e.session_date,
        vinyasa:        e.vinyasa,
        bandha:         e.bandha,
        stableToday:    e.stable_today    || [],
        difficultToday: e.difficult_today || [],
        lastAsanaNote:  e.last_asana_note,
        practiceNotes:  e.practice_notes,
        checkedInAt:    e.created_at,
        platform:       e.platform,
      }));

      return res.json({ id: student.journal_id, name: student.name, assessments, assessmentCount: assessments.length });
    }

    // JSON fallback
    const students = readJson(STUDENTS_FILE);
    const checkins = readJson(JOURNAL_FILE);
    const student = students.find(s => s && s.id === req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const myCheckins = checkins.filter(c => c && c.studentId === student.id).sort((a, b) => b.checkedInAt.localeCompare(a.checkedInAt));
    res.json({ id: student.id, name: student.name, assessments: myCheckins, assessmentCount: myCheckins.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Teacher comments — handled above via COMMENTS_FILE

// POST /api/journal/comments — save teacher comment + focus
app.post('/api/journal/comments', async (req, res) => {
  try {
    const { studentId, comment, focus } = req.body;
    if (!studentId) return res.status(400).json({ error: 'studentId required' });

    if (dbReady) {
      const s = await pgQuery(`SELECT id FROM students WHERE journal_id = $1 LIMIT 1`, [studentId]);
      if (!s.rows.length) return res.status(404).json({ error: 'Student not found' });
      await pgQuery(
        `INSERT INTO teacher_notes (student_id, comment, focus, updated_at)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT (student_id) DO UPDATE
           SET comment = EXCLUDED.comment, focus = EXCLUDED.focus, updated_at = NOW()`,
        [s.rows[0].id, comment || '', focus || '']
      );
      return res.json({ success: true });
    }

    // JSON fallback
    const comments = readJson(COMMENTS_FILE);
    const existing = comments.findIndex(c => c.studentId === studentId);
    const entry = { studentId, comment: comment || '', focus: focus || '', updatedAt: new Date().toISOString() };
    if (existing >= 0) comments[existing] = entry; else comments.push(entry);
    writeJson(COMMENTS_FILE, comments);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/journal/comments/:studentId — get teacher comment + focus
app.get('/api/journal/comments/:studentId', async (req, res) => {
  try {
    if (dbReady) {
      const s = await pgQuery(`SELECT id FROM students WHERE journal_id = $1 LIMIT 1`, [req.params.studentId]);
      if (!s.rows.length) return res.json({ comment: null, focus: null });
      const n = await pgQuery(`SELECT comment, focus, updated_at FROM teacher_notes WHERE student_id = $1`, [s.rows[0].id]);
      const found = n.rows[0];
      return res.json({ comment: found?.comment || null, focus: found?.focus || null, updatedAt: found?.updated_at || null });
    }

    // JSON fallback
    const comments = readJson(COMMENTS_FILE);
    const found = comments.find(c => c.studentId === req.params.studentId);
    res.json({ comment: found?.comment || null, focus: found?.focus || null, updatedAt: found?.updatedAt || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/journal/ai-summary/:studentId — generate AI progress summary via DeepSeek
app.post('/api/journal/ai-summary/:studentId', async (req, res) => {
  try {
    let student, myCheckins;

    if (dbReady) {
      const sr = await pgQuery(`SELECT id, name FROM students WHERE journal_id = $1 LIMIT 1`, [req.params.studentId]);
      if (!sr.rows.length) return res.status(404).json({ error: 'Student not found' });
      student = sr.rows[0];
      const er = await pgQuery(
        `SELECT session_date, vinyasa, bandha, stable_today, difficult_today,
                last_asana_note, practice_notes
         FROM journal_entries WHERE student_id = $1
         ORDER BY session_date DESC, created_at DESC`,
        [student.id]
      );
      myCheckins = er.rows.map(e => ({
        sessionDate: e.session_date?.toISOString?.()?.split('T')[0] || e.session_date,
        vinyasa: e.vinyasa, bandha: e.bandha,
        stableToday: e.stable_today || [], difficultToday: e.difficult_today || [],
        lastAsanaNote: e.last_asana_note, practiceNotes: e.practice_notes,
      }));
    } else {
      const students = readJson(STUDENTS_FILE);
      const checkins = readJson(JOURNAL_FILE);
      student = students.find(s => s && s.id === req.params.studentId);
      if (!student) return res.status(404).json({ error: 'Student not found' });
      myCheckins = checkins.filter(c => c && c.studentId === student.id)
        .sort((a, b) => b.checkedInAt.localeCompare(a.checkedInAt));
    }

    if (myCheckins.length === 0) return res.status(400).json({ error: 'No journal entries yet' });

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });

    const vinyasaLabel = { kept_moving: 'Kept moving (good vinyasa flow)', stop_breathe: 'Stopped to breathe', tired_paused: 'Tired, had to pause' };
    const bandhaLabel = { body_light: 'Body feels light and lifted', finding_light: 'Finding lightness', heavy_body: 'Body feels heavy' };

    const entrySummaries = myCheckins.slice(0, 20).map((c, i) => {
      const parts = [`Session ${i + 1} (${c.sessionDate}):`];
      parts.push(`  Vinyasa: ${vinyasaLabel[c.vinyasa] || c.vinyasa}`);
      parts.push(`  Body/Bandha: ${bandhaLabel[c.bandha] || c.bandha}`);
      if (c.stableToday?.length) parts.push(`  Strong today: ${[].concat(c.stableToday).join(', ')}`);
      if (c.difficultToday?.length) parts.push(`  Challenging: ${[].concat(c.difficultToday).join(', ')}`);
      if (c.lastAsanaNote) parts.push(`  Note: ${c.lastAsanaNote}`);
      if (c.practiceNotes) parts.push(`  Reflection: ${c.practiceNotes}`);
      return parts.join('\n');
    }).join('\n\n');

    const prompt = `You are Boonchu, an Ashtanga yoga teacher at AYBKK (Ashtanga Yoga Bangkok / Ashtanga Yoga Center of Bangkok). Write a warm, personal, honest progress summary for your student ${student.name} based on their actual practice journal entries.

Be specific to what they actually wrote — reference real patterns you see (e.g. if they consistently have good vinyasa, say so; if they struggle with specific asanas they mentioned, acknowledge that journey). This is not a generic message — it should feel like it could only be written for this student.

Write TWO paragraphs:
1. English (3-4 sentences): Warm, teacher-to-student tone. Specific, observational, encouraging without being hollow.
2. 中文 (3-4句): Same spirit — natural Mandarin as if speaking directly to them. Not a translation, but a natural version.

Student: ${student.name}
Total entries: ${myCheckins.length}

${entrySummaries}

Respond with only valid JSON, no extra text:
{"en": "...", "zh": "..."}`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://aybkk-ashtanga.up.railway.app',
        'X-Title': 'AYBKK Student Progress'
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-v3-0324',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 700
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data.error?.message || 'OpenRouter error' });

    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Could not parse AI response', raw: content });

    const summary = JSON.parse(jsonMatch[0]);
    res.json({ success: true, summary });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✓ AYBKK Workshop running on port ${PORT}`);
});
