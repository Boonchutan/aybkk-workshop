const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = (() => { try { return require('uuid'); } catch { return { v4: () => Math.random().toString(36).slice(2) + Date.now().toString(36) }; } })();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// File paths
const DATA_DIR = '/data';
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
const JOURNAL_FILE = path.join(DATA_DIR, 'journal-checkins.json');
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
app.post('/api/journal/profile', (req, res) => {
  try {
    const { name, language } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });

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
app.post('/api/journal/checkin', (req, res) => {
  try {
    const { studentId, studentName, vinyasa, bandha, stableToday, difficultToday, lastAsanaNote, practiceNotes, sessionDate, platform } = req.body;
    if (!studentId || !vinyasa || !bandha) return res.status(400).json({ error: 'Missing fields' });

    const checkins = readJson(JOURNAL_FILE);
    const entry = {
      id: uuidv4(),
      studentId,
      studentName: studentName || '',
      vinyasa,
      bandha,
      stableToday: stableToday || [],
      difficultToday: difficultToday || [],
      lastAsanaNote: lastAsanaNote || '',
      practiceNotes: practiceNotes || '',
      sessionDate: sessionDate || new Date().toISOString().split('T')[0],
      platform: platform || 'web',
      checkedInAt: new Date().toISOString()
    };
    checkins.push(entry);
    writeJson(JOURNAL_FILE, checkins);
    res.json({ success: true, checkinId: entry.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/journal/students — list all students with last assessment
app.get('/api/journal/students', (req, res) => {
  try {
    const students = readJson(STUDENTS_FILE);
    const checkins = readJson(JOURNAL_FILE);

    const result = students.map(s => {
      const myCheckins = checkins.filter(c => c.studentId === s.id).sort((a, b) => b.checkedInAt.localeCompare(a.checkedInAt));
      return {
        id: s.id,
        name: s.name,
        classType: s.language === 'zh' ? 'chinese' : 'international',
        createdAt: s.createdAt,
        lastAssessment: myCheckins[0] || null,
        assessmentCount: myCheckins.length
      };
    });

    res.json({ students: result, count: result.length });
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

// GET /api/journal/student/:id — student with history
app.get('/api/journal/student/:id', (req, res) => {
  try {
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

// POST /api/journal/comments — save teacher comment
app.post('/api/journal/comments', (req, res) => {
  try {
    const { studentId, comment, teacherName } = req.body;
    if (!studentId || !comment) return res.status(400).json({ error: 'studentId and comment required' });
    const comments = readJson(COMMENTS_FILE);
    const existing = comments.findIndex(c => c.studentId === studentId);
    const entry = { studentId, comment, teacherName: teacherName || 'Boonchu', updatedAt: new Date().toISOString() };
    if (existing >= 0) comments[existing] = entry;
    else comments.push(entry);
    writeJson(COMMENTS_FILE, comments);
    res.json({ success: true, comment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/journal/comments/:studentId — get teacher comment
app.get('/api/journal/comments/:studentId', (req, res) => {
  try {
    const comments = readJson(COMMENTS_FILE);
    const found = comments.find(c => c.studentId === req.params.studentId);
    res.json({ comment: found ? found.comment : null, teacherName: found ? found.teacherName : null, updatedAt: found ? found.updatedAt : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✓ AYBKK Workshop running on port ${PORT}`);
});
