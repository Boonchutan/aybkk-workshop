/**
 * AYBKK Mission Control Dashboard
 * Agent monitoring + Student tracking + Upload system
 * Day 1 Build - March 20, 2026
 */

const express = require('express');
const multer = require('multer');
const neo4j = require('neo4j-driver');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

// Notion client (optional - only load if configured)
let notion = null;
try {
  if (process.env.NOTION_API_KEY) {
    const { Client } = require('@notionhq/client');
    notion = new Client({ auth: process.env.NOTION_API_KEY });
  }
} catch (e) {
  console.log('Notion client not available');
}

// Task API for agent coordination
const taskApi = require('./task-api');

require('dotenv').config();

const app = express();
const PORT = process.env.MISSION_CONTROL_PORT || 3000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/Users/alfredoagent/mission-control/uploads';

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Neo4j Connection
// Local dev: bolt://localhost:7687
// Production: neo4j+s://xxxxxxxx.databases.neo4j.io (AuraDB)
const _neo4jUri = process.env.NEO4J_URI || 'bolt://localhost:7687';
const _neo4jConfig = _neo4jUri.startsWith('neo4j+s') ? {} : { encrypted: 'ENCRYPTION_OFF' };
const driver = neo4j.driver(
  _neo4jUri,
  neo4j.auth.basic(
    process.env.NEO4J_USER || '69645294',
    process.env.NEO4J_PASSWORD || 'aybkk_neo4j_2026'
  ),
  _neo4jConfig
);

// Test Neo4j connection
async function testNeo4j() {
  const session = driver.session();
  try {
    await session.run('RETURN 1');
    console.log('✓ Neo4j connected');
  } catch (err) {
    console.error('✗ Neo4j connection failed:', err.message);
  } finally {
    await session.close();
  }
}

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(UPLOAD_DIR, req.params.type || 'general');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const uniqueName = `${timestamp}_${uuidv4().slice(0, 8)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit for videos
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi|webm/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only images and videos allowed'));
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// ─── Cloudinary Setup ────────────────────────────────────────────────────────
const cloudinary = require('cloudinary').v2;
cloudinary.config({
  cloud_name: 'dw1uubecu',
  api_key: process.env.CLOUDINARY_API_KEY || '191765218532954',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'kBwusl-gHqqNiZYykFgChJjt3MQ'
});

// GET /api/student/photo/:studentId
app.get('/api/student/photo/:studentId', async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (s:Student) WHERE s.id = $sid OR s.pgId = $sid RETURN s.photoUrl AS photoUrl LIMIT 1`,
      { sid: req.params.studentId }
    );
    const photoUrl = result.records[0]?.get('photoUrl') || null;
    res.json({ photoUrl });
  } catch(err) {
    res.json({ photoUrl: null });
  } finally { await session.close(); }
});

// POST /api/upload/student-photo
// Body: { studentId, imageBase64, assessmentId? }  — base64 data URL from browser.
// Cloudinary returns a versioned URL each time; saving that exact URL on the
// SelfAssessment preserves a historical snapshot per entry, even after newer
// uploads. Older entries that don't have a photoUrl fall back to Student.photoUrl
// in the renderer.
app.post('/api/upload/student-photo', async (req, res) => {
  const { studentId, imageBase64, assessmentId } = req.body;
  if (!studentId || !imageBase64) return res.status(400).json({ error: 'Missing studentId or imageBase64' });
  try {
    const result = await cloudinary.uploader.upload(imageBase64, {
      folder: 'aybkk-students',
      public_id: 'student_' + studentId,
      overwrite: true,
      transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face', quality: 'auto' }]
    });
    const photoUrl = result.secure_url;
    // Save URL to Neo4j Student node (current photo) + optionally pin to the entry
    const session = driver.session();
    try {
      await session.run(
        `MERGE (s:Student {id: $sid})
         ON CREATE SET s.createdAt = datetime()
         SET s.photoUrl = $url`,
        { sid: studentId, url: photoUrl }
      );
      if (assessmentId) {
        await session.run(
          `MATCH (sa) WHERE (sa:SelfAssessment OR sa:PracticeLog) AND sa.id = $aid
           SET sa.photoUrl = $url
           RETURN sa.id AS id`,
          { aid: assessmentId, url: photoUrl }
        );
      }
    } finally { await session.close(); }
    res.json({ success: true, photoUrl });
  } catch (err) {
    console.error('[Cloudinary upload error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Store LINE group ID for notifications
global.LINE_GROUP_ID = null;

// LINE Messaging API webhook
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || 'your-line-channel-secret';

app.post('/line/webhook', express.json({ type: '*/*' }), async (req, res) => {
  try {
    const events = req.body.events || [];
    console.log('[LINE Webhook] Received events:', JSON.stringify(events).slice(0, 200));

    for (const event of events) {
      // Capture group ID when bot receives a message in a group
      if (event.source && event.source.type === 'group') {
        const gid = event.source.groupId;
        if (gid && !global.LINE_GROUP_ID) {
          global.LINE_GROUP_ID = gid;
          console.log('[LINE] Group ID captured:', gid);
          // Save to file for persistence
          const fs2 = require('fs');
          fs2.writeFileSync('/tmp/line_group_id.txt', gid);
        }
      }
      // Respond to join events
      if (event.type === 'join') {
        console.log('[LINE] Bot joined:', event.source && event.source.type);
        if (event.source && event.source.type === 'group') {
          global.LINE_GROUP_ID = event.source.groupId;
          console.log('[LINE] Group ID from join:', event.source.groupId);
        }
      }
    }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('[LINE Webhook] Error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// LINE verification endpoint (LINE calls this to verify webhook)
app.get('/line/webhook', (req, res) => {
  console.log('[LINE] Webhook verification received');
  res.send('ok');
});

// PostgreSQL connection (shared booking system DB)
let pgPool = null;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  const isInternal = process.env.DATABASE_URL.includes('railway.internal');
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isInternal ? false : { rejectUnauthorized: false }
  });
  pgPool.query('SELECT 1').then(() => console.log('✓ PostgreSQL connected')).catch(e => console.error('✗ PostgreSQL failed:', e.message));
} else {
  console.log('⚠ No DATABASE_URL — PostgreSQL features disabled');
}

// Attach Neo4j driver + pg pool to all requests
app.use((req, res, next) => {
  req.driver = driver;
  req.pg = pgPool;
  next();
});

// Student Journal API Routes
const studentJournal = require('./api/student-journal');
app.use('/api/journal', studentJournal);

// POST /api/journal/ai-summary/:studentId — DeepSeek bilingual progress summary
app.post('/api/journal/ai-summary/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });

    // Get student + journal entries from Neo4j
    const session = req.driver.session();
    let studentName, entries;
    try {
      const result = await session.run(`
        MATCH (s:Student {id: $id})
        OPTIONAL MATCH (s)-[:HAS_PRACTICE_LOG]->(pl:PracticeLog)
        OPTIONAL MATCH (s)-[:HAS_SELF_ASSESSMENT]->(sa:SelfAssessment)
        RETURN s.name AS name,
          collect(DISTINCT {
            date: pl.sessionDate, vinyasa: pl.vinyasa, bandha: pl.bandha,
            stable: pl.stableToday, difficult: pl.difficultToday,
            lastAsana: coalesce(pl.lastAsana, pl.lastAsanaNote, ''),
            notes: pl.practiceNotes, source: 'log'
          }) AS practiceLogs,
          collect(DISTINCT {
            date: sa.sessionDate, vinyasa: sa.vinyasa, bandha: sa.bandha,
            stable: sa.stableToday, difficult: sa.difficultToday,
            lastAsana: coalesce(sa.lastAsana, sa.lastAsanaNote, ''),
            notes: sa.practiceNotes, source: 'assessment'
          }) AS selfAssessments
      `, { id: studentId });

      if (!result.records.length) return res.status(404).json({ error: 'Student not found' });
      const rec = result.records[0];
      studentName = rec.get('name');
      const allEntries = [
        ...(rec.get('practiceLogs') || []).filter(e => e.vinyasa),
        ...(rec.get('selfAssessments') || []).filter(e => e.vinyasa)
      ].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      entries = allEntries;
    } finally {
      await session.close();
    }

    if (!entries.length) return res.status(400).json({ error: 'No journal entries yet' });

    const toArr = v => Array.isArray(v) ? v : (v ? String(v).split(',').map(s => s.trim()) : []);
    const vLabel = { kept_moving: 'Good flow', stop_breathe: 'Stopped to breathe', tired_paused: 'Tired, had to pause' };
    const bLabel = { body_light: 'Body light/lifted', finding_light: 'Finding lightness', heavy_body: 'Body heavy' };

    const entrySummaries = entries.slice(0, 20).map((e, i) => {
      const parts = [`Session ${i + 1}${e.date ? ' (' + e.date + ')' : ''}:`];
      if (e.vinyasa) parts.push(`  Vinyasa: ${vLabel[e.vinyasa] || e.vinyasa}`);
      if (e.bandha) parts.push(`  Body: ${bLabel[e.bandha] || e.bandha}`);
      const stable = toArr(e.stable);
      const difficult = toArr(e.difficult);
      if (stable.length) parts.push(`  Strong: ${stable.join(', ')}`);
      if (difficult.length) parts.push(`  Challenging: ${difficult.join(', ')}`);
      if (e.lastAsana) parts.push(`  Last asana: ${e.lastAsana}`);
      if (e.notes) parts.push(`  Note: ${e.notes}`);
      return parts.join('\n');
    }).join('\n\n');

    const prompt = `You are Boonchu, Ashtanga yoga teacher at AYBKK. Write a warm, personal progress summary for your student ${studentName} based on their actual practice journal.

Be specific to what they actually wrote — reference real patterns (consistent vinyasa quality, recurring struggles, progress). Not generic — this should only make sense for this student.

Write TWO paragraphs:
1. English (3-4 sentences): Warm, teacher-to-student tone. Specific and encouraging.
2. 中文 (3-4句): Natural Mandarin, not a translation — speak directly to them.

Student: ${studentName}
Total sessions: ${entries.length}

${entrySummaries}

Respond with only valid JSON:
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

    res.json({ success: true, summary: JSON.parse(jsonMatch[0]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Student Engagement API Routes
const studentEngagement = require('./api/student-engagement');
app.use('/api', studentEngagement);

// Notion Sync API Routes
const notionSync = require('./api/notion-sync');
app.use('/api', notionSync);

// Knowledge Explorer API Routes
const knowledgeApi = require('./api/knowledge-api');
app.use('/api', knowledgeApi);

// Student Knowledge API Routes (Boonchu spec)
const studentKnowledge = require('./api/student-knowledge');
app.use('/api', studentKnowledge);

// Mindmap API Routes
const mindmapApi = require('./api/mindmap-api');
const teacherAssessment = require('./api/teacher-assessment');
app.use('/api/teacher', teacherAssessment);
app.use('/api/mindmap', mindmapApi);

// Routes

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const session = driver.session();
    await session.run('RETURN 1');
    await session.close();
    res.json({ status: 'ok', neo4j: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', neo4j: 'disconnected', error: err.message });
  }
});

// File upload endpoint
app.post('/api/upload/:type', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { type } = req.params;
    const { studentName, workshop, notes } = req.body;
    
    const fileData = {
      id: uuidv4(),
      filename: req.file.filename,
      originalName: req.file.originalname,
      path: req.file.path,
      type: req.file.mimetype.startsWith('image/') ? 'image' : 'video',
      size: req.file.size,
      uploadType: type, // 'student-video', 'assessment-form', etc.
      studentName: studentName || null,
      workshop: workshop || 'huizhou-2026',
      notes: notes || null,
      uploadedAt: new Date().toISOString()
    };

    // Save to Neo4j
    const session = driver.session();
    try {
      await session.run(`
        CREATE (f:File {
          id: $id,
          filename: $filename,
          originalName: $originalName,
          type: $type,
          uploadType: $uploadType,
          studentName: $studentName,
          workshop: $workshop,
          notes: $notes,
          size: $size,
          uploadedAt: datetime($uploadedAt)
        })
        RETURN f
      `, fileData);
    } finally {
      await session.close();
    }

    res.json({ success: true, file: fileData });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all uploads
app.get('/api/uploads', async (req, res) => {
  try {
    const session = driver.session();
    const result = await session.run(`
      MATCH (f:File)
      RETURN f
      ORDER BY f.uploadedAt DESC
    `);
    await session.close();
    
    const files = result.records.map(r => {
      const f = r.get('f').properties;
      return {
        ...f,
        url: `/uploads/${f.uploadType}/${f.filename}`
      };
    });
    
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get uploads by type
app.get('/api/uploads/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const session = driver.session();
    const result = await session.run(`
      MATCH (f:File {uploadType: $type})
      RETURN f
      ORDER BY f.uploadedAt DESC
    `, { type });
    await session.close();
    
    const files = result.records.map(r => {
      const f = r.get('f').properties;
      return {
        ...f,
        url: `/uploads/${f.uploadType}/${f.filename}`
      };
    });
    
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Student profile creation
app.post('/api/students', async (req, res) => {
  try {
    const student = {
      id: uuidv4(),
      name: req.body.name,
      nameChinese: req.body.nameChinese || null,
      workshop: req.body.workshop || 'huizhou-2026',
      practiceYears: req.body.practiceYears || 0,
      series: req.body.series || 'Primary',
      attributes: JSON.stringify(req.body.attributes || {}),
      limitations: JSON.stringify(req.body.limitations || []),
      strengths: JSON.stringify(req.body.strengths || []),
      injuries: JSON.stringify(req.body.injuries || []),
      totalBooking: req.body.totalBooking || req.body.total_booking || 0,
      completed: req.body.completed || req.body.completedClasses || 0,
      assessmentDate: req.body.assessmentDate || new Date().toISOString(),
      createdAt: new Date().toISOString()
    };

    const session = driver.session();
    try {
      await session.run(`
        CREATE (s:Student {
          id: $id,
          name: $name,
          nameChinese: $nameChinese,
          workshop: $workshop,
          practiceYears: $practiceYears,
          series: $series,
          attributes: $attributes,
          limitations: $limitations,
          strengths: $strengths,
          injuries: $injuries,
          totalBooking: $totalBooking,
          completed: $completed,
          assessmentDate: datetime($assessmentDate),
          createdAt: datetime($createdAt)
        })
        RETURN s
      `, student);
    } finally {
      await session.close();
    }

    res.json({ success: true, student });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// POST /api/orientations - Save orientation form and generate journal link
app.post('/api/orientations', async (req, res) => {
  try {
    const { name, wechat, experience, injuries, goals, emergency, size, photoConsent, medicalConsent, language, workshop, gameResults } = req.body;
    const studentId = 'gz-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
    const datetime = new Date().toISOString();
    const baseUrl = 'https://aybkk-ashtanga.up.railway.app';
    const journalLink = baseUrl + '/student.html?id=' + studentId + '&name=' + encodeURIComponent(name) + '&lang=' + (language || 'zh') + '&location=guangzhou';

    const session = driver.session();
    try {
      await session.run(
        'CREATE (s:Orientation {id: $id, name: $name, wechat: $wechat, experience: $experience, injuries: $injuries, goals: $goals, emergency: $emergency, size: $size, photoConsent: $photoConsent, medicalConsent: $medicalConsent, language: $language, workshop: $workshop, gameResults: $gameResults, createdAt: datetime($createdAt)})',
        {
          id: studentId,
          name: name,
          wechat: wechat || '',
          experience: experience || '',
          injuries: injuries || '',
          goals: goals || '',
          emergency: emergency || '',
          size: size || '',
          photoConsent: photoConsent || 'yes',
          medicalConsent: medicalConsent || 'yes',
          language: language || 'zh',
          workshop: workshop || 'Guangzhou WS Apr 2026',
          gameResults: JSON.stringify(gameResults || []),
          createdAt: datetime
        }
      );
      await session.run(
        `CREATE (s:Student {
          id: $id,
          name: $name,
          wechatId: $wechat,
          classType: 'chinese-workshop',
          location: 'guangzhou',
          isChineseStudent: true,
          isActive: true,
          oriented: true,
          language: $language,
          workshop: $workshop,
          injuries: $injuries,
          experience: $experience,
          journalLink: $journalLink,
          createdAt: datetime($createdAt)
        })`,
        {
          id: studentId,
          name: name,
          wechat: wechat || '',
          language: language || 'zh',
          workshop: workshop || 'Guangzhou WS Apr 2026',
          injuries: injuries || '',
          experience: experience || '',
          journalLink,
          createdAt: datetime
        }
      );
    } finally {
      await session.close();
    }

    res.json({ success: true, studentId, journalLink, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/orientations - Get all GZ orientation submissions for dashboard
app.get('/api/orientations', async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (s:Student)
      WHERE s.location = 'guangzhou' OR s.id STARTS WITH 'gz-'
      RETURN s.id AS id, s.name AS name, s.wechatId AS wechat,
             s.experience AS experience, s.injuries AS injuries,
             s.goals AS goals, s.workshop AS workshop,
             s.journalLink AS journalLink, s.createdAt AS createdAt
      ORDER BY s.createdAt DESC
    `);
    const orientations = result.records.map(r => ({
      id: r.get('id'),
      name: r.get('name'),
      wechat: r.get('wechat'),
      experience: r.get('experience'),
      injuries: r.get('injuries'),
      goals: r.get('goals'),
      workshop: r.get('workshop'),
      journalLink: r.get('journalLink'),
      submittedAt: r.get('createdAt')
    }));
    res.json({ orientations, count: orientations.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// ─── AYBKK Bangkok Shala — orientation save/list ─────────────────────────
// POST /api/orientations/bkk — only used for NEW shala students.
// Existing AYBKK students live in the booking-system PostgreSQL DB and don't
// re-fill an orientation — the dashboard surfaces them directly.
app.post('/api/orientations/bkk', async (req, res) => {
  try {
    const { name, wechat, contactType, experience, injuries, goals, emergency, size, photoConsent, medicalConsent, language, gameResults } = req.body;
    const studentId = 'bkk-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
    const datetime = new Date().toISOString();
    const baseUrl = 'https://aybkk-ashtanga.up.railway.app';
    const journalLink = baseUrl + '/student.html?id=' + studentId + '&name=' + encodeURIComponent(name) + '&lang=' + (language || 'th') + '&location=bangkok';

    const session = driver.session();
    try {
      await session.run(
        'CREATE (s:Orientation {id: $id, name: $name, wechat: $wechat, contactType: $contactType, experience: $experience, injuries: $injuries, goals: $goals, emergency: $emergency, size: $size, photoConsent: $photoConsent, medicalConsent: $medicalConsent, language: $language, workshop: $workshop, gameResults: $gameResults, createdAt: datetime($createdAt)})',
        {
          id: studentId,
          name: name,
          wechat: wechat || '',
          contactType: contactType || 'line',
          experience: experience || '',
          injuries: injuries || '',
          goals: goals || '',
          emergency: emergency || '',
          size: size || '',
          photoConsent: photoConsent || 'yes',
          medicalConsent: medicalConsent || 'yes',
          language: language || 'th',
          workshop: 'AYBKK Bangkok Shala',
          gameResults: JSON.stringify(gameResults || []),
          createdAt: datetime
        }
      );
      await session.run(
        `CREATE (s:Student {
          id: $id,
          name: $name,
          wechatId: $wechat,
          contactType: $contactType,
          classType: 'shala-regular',
          location: 'bangkok',
          isChineseStudent: false,
          isActive: true,
          oriented: true,
          language: $language,
          workshop: 'AYBKK Bangkok Shala',
          injuries: $injuries,
          experience: $experience,
          journalLink: $journalLink,
          createdAt: datetime($createdAt)
        })`,
        {
          id: studentId,
          name: name,
          wechat: wechat || '',
          contactType: contactType || 'line',
          language: language || 'th',
          injuries: injuries || '',
          experience: experience || '',
          journalLink,
          createdAt: datetime
        }
      );
    } finally {
      await session.close();
    }

    res.json({ success: true, studentId, journalLink, name });
  } catch (err) {
    console.error('[bkk orientation save]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/orientations/bkk — merged list: existing booking-system students + new BKK orientations
app.get('/api/orientations/bkk', async (req, res) => {
  const baseUrl = 'https://aybkk-ashtanga.up.railway.app';
  const out = [];

  // 1) Existing students from PostgreSQL booking DB (Reserv) — no orientation needed
  if (pgPool) {
    try {
      const result = await pgPool.query(`
        SELECT s.id::text AS id, s.name,
               count(je.id) AS session_count,
               max(je.session_date) AS last_date
        FROM students s
        LEFT JOIN journal_entries je ON je.student_id = s.id
        WHERE s.name IS NOT NULL AND s.name != ''
        GROUP BY s.id, s.name
        ORDER BY s.name ASC
      `);
      for (const r of result.rows) {
        const link = baseUrl + '/student.html?id=' + encodeURIComponent(r.id) + '&name=' + encodeURIComponent(r.name) + '&lang=th&location=bangkok';
        out.push({
          id: r.id,
          name: r.name,
          source: 'reserv',
          checkins: parseInt(r.session_count) || 0,
          lastDate: r.last_date ? r.last_date.toISOString().substring(0, 10) : null,
          journalLink: link,
          oriented: false
        });
      }
    } catch (err) {
      console.error('[bkk list pg]', err.message);
    }
  }

  // 2) New shala-walk-in students who filled the bkk orientation (Neo4j)
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (s:Student)
      WHERE s.location = 'bangkok' OR s.id STARTS WITH 'bkk-'
      OPTIONAL MATCH (s)-[:HAS_PRACTICE_LOG]->(pl:PracticeLog)
      OPTIONAL MATCH (s)-[:HAS_SELF_ASSESSMENT]->(sa:SelfAssessment)
      WITH s, count(DISTINCT pl) + count(DISTINCT sa) AS checkins
      RETURN s.id AS id, s.name AS name, s.journalLink AS journalLink,
             s.wechatId AS wechat, s.experience AS experience,
             s.createdAt AS createdAt, checkins
      ORDER BY s.createdAt DESC
    `);
    for (const r of result.records) {
      const id = r.get('id');
      const name = r.get('name');
      const link = r.get('journalLink') || (baseUrl + '/student.html?id=' + encodeURIComponent(id) + '&name=' + encodeURIComponent(name) + '&lang=th&location=bangkok');
      const checkinsRaw = r.get('checkins');
      out.push({
        id,
        name,
        source: 'orientation',
        checkins: typeof checkinsRaw === 'object' && checkinsRaw && 'low' in checkinsRaw ? checkinsRaw.low : (parseInt(checkinsRaw) || 0),
        wechat: r.get('wechat'),
        experience: r.get('experience'),
        journalLink: link,
        oriented: true
      });
    }
  } catch (err) {
    console.error('[bkk list neo4j]', err.message);
  } finally {
    await session.close();
  }

  // De-duplicate (Reserv ID may also exist as Neo4j student after first check-in)
  const seen = new Set();
  const merged = out.filter(s => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  res.json({ students: merged, count: merged.length });
});

// ─── Short journal link redirect ─────────────────────────────────────────
// /j/:slug — short link that 302s to the full Thai journal URL.
//   slug = numeric Reserv ID (e.g. /j/44) or fuzzy name (/j/tomoko)
// If the student already has a `journal_link` in Reserv, we preserve its
// underlying id (keeps existing journal history) but force lang=th & location=bangkok.
app.get('/j/:slug', async (req, res) => {
  const slug = decodeURIComponent(req.params.slug || '').trim();
  if (!slug) return res.status(404).send('Not found');
  if (!pgPool) return res.status(503).send('Booking DB unavailable');

  try {
    let row = null;
    // Pattern 1: pure numeric ID — /j/689
    // Pattern 2: pretty slug with trailing ID — /j/boonchu-test-689 (id wins, prefix is decorative)
    // Pattern 3: name-only fuzzy match — /j/tomoko (must resolve to exactly one)
    // ID can appear three ways: bare (/j/689), leading (/j/689-boonchu), trailing (/j/boonchu-689)
    let id = null;
    if (/^\d+$/.test(slug)) {
      id = parseInt(slug, 10);
    } else {
      const lead = slug.match(/^(\d+)[-_]/);
      const tail = slug.match(/[-_](\d+)$/);
      if (lead) id = parseInt(lead[1], 10);
      else if (tail) id = parseInt(tail[1], 10);
    }

    if (id !== null) {
      const r = await pgPool.query(
        'SELECT id, name, journal_link FROM students WHERE id = $1 LIMIT 1', [id]
      );
      row = r.rows[0] || null;
    } else {
      // Tokenize: "boonchu-test" → ["boonchu","test"], all must appear in name
      const tokens = slug.toLowerCase().replace(/[_]+/g, '-').split(/[-\s]+/).filter(Boolean);
      if (!tokens.length) return res.status(404).send('Not found');
      const params = tokens.map(t => '%' + t + '%');
      const where = tokens.map((_, i) => 'name ILIKE $' + (i + 1)).join(' AND ');
      const r = await pgPool.query(
        `SELECT id, name, journal_link FROM students WHERE ${where} ORDER BY id DESC LIMIT 3`,
        params
      );
      if (r.rowCount === 1) row = r.rows[0];
      else if (r.rowCount > 1) {
        const list = r.rows.map(x => `/j/${x.id}-${x.name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'')}`).join('\n');
        return res.status(409).type('text/plain').send(
          'Multiple matches for "' + slug + '" — pick one:\n\n' + list
        );
      }
    }

    if (!row) return res.status(404).send('Student not found');

    // Preserve any existing journal id (keeps practice history)
    let targetId = String(row.id);
    if (row.journal_link) {
      try {
        const u = new URL(row.journal_link);
        const qid = u.searchParams.get('id');
        if (qid) targetId = qid;
      } catch (_) { /* fall back to pg id */ }
    }

    const target = '/student.html?id=' + encodeURIComponent(targetId) +
      '&name=' + encodeURIComponent(row.name) +
      '&lang=th&location=bangkok';
    return res.redirect(302, target);
  } catch (err) {
    console.error('[/j redirect]', err.message);
    return res.status(500).send('Lookup failed');
  }
});

// ─── Short profile link redirect ─────────────────────────────────────────
// /p/:slug — same lookup as /j/ but redirects to the read-only profile page
// (my-journal.html). Use this for "here is your practice profile" links —
// students see their journal history + weekly AI report, no entry form.
app.get('/p/:slug', async (req, res) => {
  const slug = decodeURIComponent(req.params.slug || '').trim();
  if (!slug) return res.status(404).send('Not found');
  if (!pgPool) return res.status(503).send('Booking DB unavailable');

  try {
    let row = null;
    let id = null;
    if (/^\d+$/.test(slug)) {
      id = parseInt(slug, 10);
    } else {
      const lead = slug.match(/^(\d+)[-_]/);
      const tail = slug.match(/[-_](\d+)$/);
      if (lead) id = parseInt(lead[1], 10);
      else if (tail) id = parseInt(tail[1], 10);
    }

    if (id !== null) {
      const r = await pgPool.query(
        'SELECT id, name, journal_link FROM students WHERE id = $1 LIMIT 1', [id]
      );
      row = r.rows[0] || null;
    } else {
      const tokens = slug.toLowerCase().replace(/[_]+/g, '-').split(/[-\s]+/).filter(Boolean);
      if (!tokens.length) return res.status(404).send('Not found');
      const params = tokens.map(t => '%' + t + '%');
      const where = tokens.map((_, i) => 'name ILIKE $' + (i + 1)).join(' AND ');
      const r = await pgPool.query(
        `SELECT id, name, journal_link FROM students WHERE ${where} ORDER BY id DESC LIMIT 3`,
        params
      );
      if (r.rowCount === 1) row = r.rows[0];
      else if (r.rowCount > 1) {
        const list = r.rows.map(x => `/p/${x.id}-${x.name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'')}`).join('\n');
        return res.status(409).type('text/plain').send(
          'Multiple matches for "' + slug + '" — pick one:\n\n' + list
        );
      }
    }

    if (!row) return res.status(404).send('Student not found');

    let targetId = String(row.id);
    if (row.journal_link) {
      try {
        const u = new URL(row.journal_link);
        const qid = u.searchParams.get('id');
        if (qid) targetId = qid;
      } catch (_) { /* fall back to pg id */ }
    }

    const target = '/my-journal.html?id=' + encodeURIComponent(targetId) +
      '&name=' + encodeURIComponent(row.name) +
      '&lang=th';
    return res.redirect(302, target);
  } catch (err) {
    console.error('[/p redirect]', err.message);
    return res.status(500).send('Lookup failed');
  }
});

// ─── Share card image generator ──────────────────────────────────────────
// GET /api/share-card/:studentId
//   Optional query: ?type=welcome|journal (default: welcome)
//                   ?subtitle=... ?dateInfo=... ?quote=... ?uplift=... ?dayIndex=0..6
// Returns: PNG. Used by the Telegram bot to send a real designed share card
// (the same design as the in-page card on student.html).
const { renderShareCard } = require('./share-card-renderer');

// Yoga Sutra + Bhagavad Gita quote pool, bilingual.
const SHARE_CARD_QUOTES = {
  en: [
    'Atha Yoganushasanam — Yoga Sutra 1.1',
    'Yoga is the cessation of the fluctuations of the mind. — Yoga Sutra 1.2',
    'Sthira sukham asanam — steady, comfortable. — Yoga Sutra 2.46',
    'Practice becomes firmly grounded when attended to for a long time. — Yoga Sutra 1.14',
    'You have a right to action, but never to its fruits. — Bhagavad Gita 2.47',
    'Yoga is skill in action. — Bhagavad Gita 2.50',
    'Yoga is equanimity of mind. — Bhagavad Gita 2.48',
    'Like a lamp in a windless place that does not flicker. — Bhagavad Gita 6.19',
    'For one who has conquered the mind, the mind is the best of friends. — Bhagavad Gita 6.6',
    'Whatever happened, happened for the good. — Bhagavad Gita',
    'When meditation is mastered, the mind is unwavering. — Bhagavad Gita 6.19',
    'The soul is neither born, nor does it ever die. — Bhagavad Gita 2.20',
  ],
  ru: [
    'Атха йогануш́асанам — Йога-сутра 1.1',
    'Йога есть прекращение колебаний ума. — Йога-сутра 1.2',
    'Стхира сукхам асанам — устойчивая, удобная поза. — Йога-сутра 2.46',
    'Практика становится прочной при долгом, непрерывном внимании. — Йога-сутра 1.14',
    'У тебя есть право на действие, но не на его плоды. — Бхагавад-гита 2.47',
    'Йога есть искусство в действии. — Бхагавад-гита 2.50',
    'Йога есть невозмутимость ума. — Бхагавад-гита 2.48',
    'Как пламя лампы в безветренном месте, что не колышется. — Бхагавад-гита 6.19',
    'Для того, кто овладел умом, ум — лучший друг. — Бхагавад-гита 6.6',
    'Что бы ни произошло, произошло во благо. — Бхагавад-гита',
    'Когда медитация достигнута, ум неподвижен. — Бхагавад-гита 6.19',
    'Душа не рождается и не умирает. — Бхагавад-гита 2.20',
  ],
  zh: [
    'Atha Yoganushasanam — 瑜伽经 1.1',
    '瑜伽是心意波动的止息。— 瑜伽经 1.2',
    '体式应当稳定而舒适。— 瑜伽经 2.46',
    '长久持续的练习使根基稳固。— 瑜伽经 1.14',
    '你只有行动的权利，从无对结果的权利。— 薄伽梵歌 2.47',
    '瑜伽是行动中的技艺。— 薄伽梵歌 2.50',
    '瑜伽是心的平等。— 薄伽梵歌 2.48',
    '如无风之处的灯焰，不动摇。— 薄伽梵歌 6.19',
    '征服自心者，自心即是至友。— 薄伽梵歌 6.6',
  ],
};

// Deterministic quote per student (welcome) and per student+day (journal),
// so different students reliably see different quotes and the journal rotates daily.
function hashString(s) {
  let h = 0;
  for (const ch of s) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function quoteForCard({ studentId, type, lang }) {
  const pool = SHARE_CARD_QUOTES[lang] || SHARE_CARD_QUOTES.en;
  if (!pool.length) return '';
  const seed = type === 'journal'
    ? `${studentId}|${new Date().toISOString().split('T')[0]}`   // rotates daily
    : `${studentId}|welcome`;                                    // stable per student
  return pool[hashString(seed) % pool.length];
}

// POST /api/journal/share-to-group/:studentId
// Called from student.html after a Russia student completes their daily journal.
// Server fetches the rendered share card and posts it to the student's city group.
app.post('/api/journal/share-to-group/:studentId', async (req, res) => {
  const session = driver.session();
  try {
    const { studentId } = req.params;

    const result = await session.run(
      `MATCH (s:Student) WHERE s.id = $id
       RETURN s.name AS name, s.city AS city, s.location AS location,
              s.language AS language, s.telegramChatId AS tgChatId
       LIMIT 1`,
      { id: studentId }
    );
    if (result.records.length === 0) return res.status(404).json({ error: 'Student not found' });

    const r = result.records[0];
    const name = r.get('name') || 'Student';
    const city = r.get('city') || '';
    const location = r.get('location') || '';
    const language = r.get('language') || 'en';
    const tgChatId = r.get('tgChatId') || '';

    if (location !== 'russia') return res.json({ posted: false, reason: 'not a Russia student' });

    const groupMap = { spb: process.env.RU_GROUP_CHAT_ID_SPB, moscow: process.env.RU_GROUP_CHAT_ID_MOSCOW };
    const groupId = groupMap[city];
    if (!groupId) return res.json({ posted: false, reason: `no group chat_id for city ${city}` });

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN not set on server' });

    // Skip Boonchu's test entries
    if (process.env.BOONCHU_CHAT_ID && String(tgChatId) === String(process.env.BOONCHU_CHAT_ID)) {
      return res.json({ posted: false, reason: 'test mode (Boonchu)' });
    }

    // Fetch the journal-type share card
    const cardRes = await fetch(`https://aybkk-ashtanga.up.railway.app/api/share-card/${encodeURIComponent(studentId)}?type=journal`);
    if (!cardRes.ok) throw new Error(`share-card fetch ${cardRes.status}`);
    const cardBuf = Buffer.from(await cardRes.arrayBuffer());

    // Caption
    const today = new Date();
    const dateLabel = today.toLocaleDateString(language === 'ru' ? 'ru-RU' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const caption = language === 'ru'
      ? `🙏 ${name} · ${dateLabel}\nПрактика записана.`
      : `🙏 ${name} · ${dateLabel}\nPractice logged.`;

    // POST multipart to Telegram sendPhoto
    const fd = new FormData();
    fd.append('chat_id', String(groupId));
    fd.append('caption', caption);
    fd.append('photo', new Blob([cardBuf], { type: 'image/png' }), 'journal-card.png');

    const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: fd });
    const tgJson = await tgRes.json();
    if (!tgJson.ok) throw new Error(`telegram sendPhoto ${tgJson.description}`);

    res.json({ posted: true, city, groupId });
  } catch (err) {
    console.error('[journal share-to-group]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

app.get('/api/share-card/:studentId', async (req, res) => {
  const session = driver.session();
  try {
    const { studentId } = req.params;
    const { type, subtitle, dateInfo, quote, uplift, dayIndex } = req.query;

    // Look up the student
    const result = await session.run(
      `MATCH (s:Student) WHERE s.id = $id
       RETURN s.name AS name, s.photoUrl AS photoUrl, s.city AS city,
              s.location AS location, s.workshop AS workshop, s.language AS language,
              s.telegramPhotoFileId AS telegramPhotoFileId
       LIMIT 1`,
      { id: studentId }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const r = result.records[0];
    const name = r.get('name') || 'Student';
    let photoUrl = r.get('photoUrl') || '';
    const tgPhotoFileId = r.get('telegramPhotoFileId') || '';
    const city = r.get('city') || '';
    const location = r.get('location') || '';
    const workshop = r.get('workshop') || '';
    const language = r.get('language') || 'en';

    // Fallback: if no Cloudinary URL, fetch the photo URL directly from Telegram by file_id.
    // Telegram keeps photos for a long time, so this works even if Cloudinary upload failed.
    if (!photoUrl && tgPhotoFileId && process.env.TELEGRAM_BOT_TOKEN) {
      try {
        const fileRes = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(tgPhotoFileId)}`);
        const fileJson = await fileRes.json();
        if (fileJson.ok && fileJson.result?.file_path) {
          photoUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileJson.result.file_path}`;
          console.log('[share-card] using Telegram fallback photo for', studentId);
        }
      } catch (e) {
        console.warn('[share-card] telegram fallback failed:', e.message);
      }
    }

    // Build subtitle/dateInfo from defaults or query overrides
    const isWelcome = (type || 'welcome') === 'welcome';
    const cityLabel = city === 'moscow' ? 'Moscow' : (city === 'spb' ? 'St. Petersburg' : '');

    const defaultSubtitle = isWelcome
      ? (location === 'russia' ? 'AYBKK RUSSIA WS 2026' : (workshop || 'AYBKK 2026'))
      : 'AYBKK PRACTICE JOURNAL';

    const today = new Date();
    const opts = { weekday: 'short', month: 'short', day: 'numeric' };
    const todayStr = today.toLocaleDateString('en-US', opts);
    const defaultDateInfo = isWelcome
      ? (cityLabel ? `${cityLabel} · ${todayStr}` : todayStr)
      : `${todayStr} · Practice Journal saved ✅`;

    // Deterministic quote per student/day (Yoga Sutra + Bhagavad Gita), language-aware.
    const defaultQuote = quoteForCard({ studentId, type: type || 'welcome', lang: language });

    const png = await renderShareCard({
      name,
      subtitle: subtitle || defaultSubtitle,
      dateInfo: dateInfo || defaultDateInfo,
      quote: quote || defaultQuote,
      uplift: uplift || '',
      photoUrl,
      dayIndex: dayIndex !== undefined ? parseInt(dayIndex, 10) : undefined,
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(png);
  } catch (err) {
    console.error('[share-card]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// ─── Russia WS 2026 — orientation save/list ─────────────────────────────
// POST /api/orientations/ru — Telegram bot calls this after the chat orientation flow
app.post('/api/orientations/ru', async (req, res) => {
  try {
    const {
      name, email, city, size, experience, lastAsana,
      difficulties, injuries, language, workshop,
      telegramChatId, telegramUsername, telegramFirstName, telegramLastName,
      telegramPhotoFileId, photoUrl, quizResults
    } = req.body;

    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    if (!city || !['spb', 'moscow'].includes(city)) return res.status(400).json({ success: false, error: 'city must be spb or moscow' });

    const datetime = new Date().toISOString();
    const baseUrl = 'https://aybkk-ashtanga.up.railway.app';
    const tgChatStr = String(telegramChatId || '');
    const emailStr = (email || '').trim().toLowerCase();

    const diffStr = Array.isArray(difficulties) ? difficulties.join(', ') : (difficulties || '');
    const quizStr = JSON.stringify(quizResults || []);

    const session = driver.session();
    try {
      // Look up existing RU Student by telegramChatId, then by email — so a repeat
      // registration updates the same row instead of creating a duplicate.
      let existingId = null;
      let existingLink = null;
      if (tgChatStr) {
        const r = await session.run(
          `MATCH (s:Student {location: 'russia', telegramChatId: $tg})
           RETURN s.id AS id, s.journalLink AS link
           ORDER BY s.createdAt DESC LIMIT 1`,
          { tg: tgChatStr }
        );
        if (r.records.length) {
          existingId = r.records[0].get('id');
          existingLink = r.records[0].get('link');
        }
      }
      if (!existingId && emailStr) {
        const r = await session.run(
          `MATCH (s:Student {location: 'russia'})
           WHERE toLower(s.email) = $em AND s.email <> ''
           RETURN s.id AS id, s.journalLink AS link
           ORDER BY s.createdAt DESC LIMIT 1`,
          { em: emailStr }
        );
        if (r.records.length) {
          existingId = r.records[0].get('id');
          existingLink = r.records[0].get('link');
        }
      }

      const studentId = existingId || ('ru-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6));
      const journalLink = existingLink || (baseUrl + '/student.html?id=' + studentId
        + '&name=' + encodeURIComponent(name)
        + '&lang=' + (language || 'ru')
        + '&location=russia'
        + '&city=' + city);

      // Orientation = audit log of every registration event (always CREATE).
      await session.run(`
        CREATE (o:Orientation {
          id: $id, name: $name, email: $email, city: $city, size: $size,
          experience: $experience, lastAsana: $lastAsana, difficulties: $diff,
          injuries: $injuries, language: $language, workshop: $workshop,
          telegramChatId: $tgChat, telegramUsername: $tgUser,
          telegramFirstName: $tgFirst, telegramLastName: $tgLast,
          telegramPhotoFileId: $tgPhoto,
          photoUrl: $photoUrl, quizResults: $quiz, location: 'russia',
          createdAt: datetime($createdAt)
        })`, {
        id: studentId, name, email: email || '', city, size: size || '',
        experience: experience || '', lastAsana: lastAsana || '', diff: diffStr,
        injuries: injuries || '', language: language || 'ru',
        workshop: workshop || 'AYBKK Russia WS May 2026',
        tgChat: tgChatStr, tgUser: telegramUsername || '',
        tgFirst: telegramFirstName || '', tgLast: telegramLastName || '',
        tgPhoto: telegramPhotoFileId || '',
        photoUrl: photoUrl || '', quiz: quizStr, createdAt: datetime,
      });

      // Student = canonical profile (one per person). MERGE on id so a repeat
      // registration updates the existing node and journals stay attached.
      await session.run(`
        MERGE (s:Student { id: $id })
        ON CREATE SET
          s.createdAt = datetime($createdAt),
          s.classType = 'russia-workshop',
          s.location = 'russia',
          s.isActive = true
        SET
          s.name = $name, s.email = $email, s.city = $city, s.size = $size,
          s.oriented = true,
          s.language = $language, s.workshop = $workshop, s.injuries = $injuries,
          s.experience = $experience, s.lastAsana = $lastAsana,
          s.telegramChatId = $tgChat, s.telegramUsername = $tgUser,
          s.telegramPhotoFileId = $tgPhoto,
          s.photoUrl = $photoUrl, s.journalLink = $journalLink,
          s.updatedAt = datetime($createdAt)
        `, {
        id: studentId, name, email: email || '', city, size: size || '',
        language: language || 'ru', workshop: workshop || 'AYBKK Russia WS May 2026',
        injuries: injuries || '', experience: experience || '', lastAsana: lastAsana || '',
        tgChat: tgChatStr, tgUser: telegramUsername || '',
        tgPhoto: telegramPhotoFileId || '',
        photoUrl: photoUrl || '', journalLink, createdAt: datetime,
      });

      res.json({ success: true, studentId, journalLink, name, reused: !!existingId });
    } finally {
      await session.close();
    }
  } catch (err) {
    console.error('[ru orientation save]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/orientations/ru — list RU students (?city=spb|moscow, ?format=csv)
app.get('/api/orientations/ru', async (req, res) => {
  const session = driver.session();
  try {
    const { city, format } = req.query;
    const cityFilter = city ? `AND s.city = $city` : '';
    const result = await session.run(`
      MATCH (s:Student)
      WHERE s.location = 'russia' OR s.id STARTS WITH 'ru-'
      ${cityFilter}
      RETURN s.id AS id, s.name AS name, s.email AS email, s.city AS city,
             s.size AS size, s.experience AS experience, s.lastAsana AS lastAsana,
             s.injuries AS injuries, s.telegramChatId AS telegramChatId,
             s.telegramUsername AS telegramUsername, s.photoUrl AS photoUrl,
             s.journalLink AS journalLink, s.language AS language,
             s.workshop AS workshop, s.createdAt AS createdAt
      ORDER BY s.city, s.name
    `, { city: city || null });

    const students = result.records.map(r => ({
      id: r.get('id'), name: r.get('name'), email: r.get('email'),
      city: r.get('city'), size: r.get('size'), experience: r.get('experience'),
      lastAsana: r.get('lastAsana'), injuries: r.get('injuries'),
      telegramChatId: r.get('telegramChatId'), telegramUsername: r.get('telegramUsername'),
      photoUrl: r.get('photoUrl'), journalLink: r.get('journalLink'),
      language: r.get('language'), workshop: r.get('workshop'),
      createdAt: r.get('createdAt'),
    }));

    if (format === 'csv') {
      const cols = ['id','name','email','city','size','experience','lastAsana','injuries','telegramUsername','telegramChatId','photoUrl','journalLink','language','createdAt'];
      const escape = v => {
        if (v == null) return '';
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      };
      const csv = [cols.join(','), ...students.map(s => cols.map(c => escape(s[c])).join(','))].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.send(csv);
    }

    res.json({ students, count: students.length });
  } catch (err) {
    console.error('[ru orientation list]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Get all students
app.get('/api/students', async (req, res) => {
  try {
    const session = driver.session();
    const result = await session.run(`
      MATCH (s:Student)
      OPTIONAL MATCH (s)-[:HAS_VIDEO]->(f:File)
      RETURN s, collect(f) as files
      ORDER BY COALESCE(s.completed, s.totalBooking, 0) DESC, s.name ASC
    `);
    await session.close();
    
    const students = result.records.map(r => {
      const s = r.get('s').properties;
      const files = r.get('files').map(f => f.properties);
      return {
        ...s,
        attributes: JSON.parse(s.attributes || '{}'),
        limitations: JSON.parse(s.limitations || '[]'),
        strengths: JSON.parse(s.strengths || '[]'),
        injuries: JSON.parse(s.injuries || '[]'),
        files
      };
    });
    
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Link file to student
app.post('/api/students/:id/files', async (req, res) => {
  try {
    const { id } = req.params;
    const { fileId } = req.body;
    
    const session = driver.session();
    try {
      await session.run(`
        MATCH (s:Student {id: $studentId})
        MATCH (f:File {id: $fileId})
        CREATE (s)-[:HAS_VIDEO]->(f)
        RETURN s, f
      `, { studentId: id, fileId });
    } finally {
      await session.close();
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// NOTION SYNC API - Pull students from Notion
// ─────────────────────────────────────────────────────────────

const NOTION_STUDENTS_DB = process.env.NOTION_STUDENTS_DB || '7e6f9c96-5e13-4784-995f-4048c321a2f7';

app.post('/api/sync/notion', async (req, res) => {
  if (!notion) {
    return res.status(500).json({ error: 'Notion not configured. Set NOTION_API_KEY in .env' });
  }

  const session = driver.session();
  try {
    const response = await notion.databases.query({
      database_id: NOTION_STUDENTS_DB,
      page_size: 100
    });

    let synced = 0;
    let errors = 0;

    for (const page of response.results) {
      const props = page.properties;

      // Extract fields
      const name = props.Name?.title?.[0]?.plain_text || 'Unknown';
      const phone = props['Phone number']?.phone_number || '';
      const email = props['Personal email']?.email || '';
      const membership = props['Membership type']?.select?.name || 'standard';
      const status = props['Status']?.status?.name || 'active';
      const birthday = props['Birthday']?.date?.start || null;
      const startDay = props['Start day']?.date?.start || null;
      const strengths = props['Strength']?.multi_select?.map(s => s.name) || [];
      const weaknesses = props['Weaknesses']?.multi_select?.map(s => s.name) || [];
      const toImprove = props['To improve']?.multi_select?.map(s => s.name) || [];
      const practiceSeries = props['Practice series']?.multi_select?.map(s => s.name) || [];
      const notionId = props['ID']?.unique_id?.number || page.id;

      // Create or update student
      await session.run(`
        MERGE (s:Student {id: $id})
        SET s.name = $name,
            s.phone = $phone,
            s.email = $email,
            s.membership = $membership,
            s.status = $status,
            s.birthday = $birthday,
            s.startDay = $startDay,
            s.notionId = $notionId,
            s.source = 'notion',
            s.updatedAt = datetime()
        WITH s
        FOREACH (strength IN $strengths | MERGE (t:Tag {name: strength}) MERGE (s)-[:HAS_STRENGTH]->(t))
        FOREACH (weakness IN $weaknesses | MERGE (t:Tag {name: weakness}) MERGE (s)-[:HAS_WEAKNESS]->(t))
      `, {
        id: `notion-${page.id}`,
        name, phone, email, membership, status, birthday, startDay, notionId,
        strengths, weaknesses
      });

      synced++;
    }

    await session.close();
    res.json({ success: true, synced, errors, total: response.results.length });
  } catch (err) {
    await session.close();
    console.error('Notion sync error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get sync status
app.get('/api/sync/status', async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (s:Student {source: 'notion'})
      RETURN count(s) as notionStudents
    `);
    const notionCount = result.records[0]?.get('notionStudents')?.low || 0;

    const totalResult = await session.run(`MATCH (s:Student) RETURN count(s) as total`);
    const totalCount = totalResult.records[0]?.get('total')?.low || 0;

    await session.close();
    res.json({
      notionStudents: notionCount,
      totalStudents: totalCount,
      notionConfigured: !!notion
    });
  } catch (err) {
    await session.close();
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// PROGRESS TRACKING API
// ─────────────────────────────────────────────────────────────

// Create a progress check (snapshot of student attributes)
app.post('/api/progress-check', async (req, res) => {
  try {
    // Handle both integer IDs and Neo4j Integer objects {low, high}
    let studentId = req.body.studentId;
    if (typeof studentId === 'object' && studentId !== null && 'low' in studentId) {
      studentId = studentId.low; // Extract the actual integer
    }

    const progressCheck = {
      id: uuidv4(),
      studentId: studentId,
      checkDate: req.body.checkDate || new Date().toISOString(),
      attributes: JSON.stringify(req.body.attributes || {}),
      overallScore: req.body.overallScore || 0,
      notes: req.body.notes || null,
      videoId: req.body.videoId || null,
      assessor: req.body.assessor || null,
      createdAt: new Date().toISOString()
    };

    const session = driver.session();
    try {
      // Create the progress check node
      await session.run(`
        CREATE (p:ProgressCheck {
          id: $id,
          checkDate: datetime($checkDate),
          attributes: $attributes,
          overallScore: $overallScore,
          notes: $notes,
          videoId: $videoId,
          assessor: $assessor,
          createdAt: datetime($createdAt)
        })
        WITH p
        MATCH (s:Student {id: $studentId})
        CREATE (s)-[:HAS_PROGRESS_CHECK]->(p)
        RETURN p
      `, progressCheck);
    } finally {
      await session.close();
    }

    res.json({ success: true, progressCheck });
  } catch (err) {
    console.error('Progress check error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get progress for a specific student
app.get('/api/students/:id/progress', async (req, res) => {
  try {
    // Handle UUID strings (fcbe9bdc-...) and Neo4j Integer objects {low, high}
    let id = req.params.id;
    try {
      const parsed = JSON.parse(id);
      if (parsed && typeof parsed === 'object' && 'low' in parsed) {
        id = String(parsed.low); // Convert Neo4j Integer to string
      }
    } catch {
      // Not JSON - keep original string (handles UUIDs like "fcbe9bdc-565e-406a-b87d-23d40171c542")
      // Only parse as integer if it's purely numeric
      if (/^\d+$/.test(id)) {
        id = parseInt(id, 10);
      }
    }

    const session = driver.session();

    const result = await session.run(`
      MATCH (s) WHERE id(s) = $id AND s:Student
      MATCH (s)-[:HAS_PROGRESS_CHECK]->(p:ProgressCheck)
      OPTIONAL MATCH (p)-[:HAS_VIDEO]->(f:File)
      RETURN s as student, p as progressCheck, f as video
      ORDER BY p.checkDate ASC
    `, { id });

    let student;
    if (result.records.length === 0) {
      // Check if student exists
      const studentResult = await session.run(`
        MATCH (s) WHERE id(s) = $id AND s:Student RETURN s
      `, { id });
      
      if (studentResult.records.length === 0) {
        await session.close();
        return res.status(404).json({ error: 'Student not found' });
      }
      student = studentResult.records[0].get('s').properties;
      await session.close();
      return res.json({ studentId: id, studentName: student.name, progressChecks: [] });
    }
    
    student = result.records[0].get('student').properties;
    const progressChecks = result.records.map(r => {
      const p = r.get('progressCheck').properties;
      const video = r.get('video')?.properties || null;
      return {
        ...p,
        attributes: JSON.parse(p.attributes || '{}'),
        video: video ? { ...video, url: `/uploads/${video.uploadType}/${video.filename}` } : null
      };
    });
    
    await session.close();
    
    res.json({
      studentId: id,
      studentName: student.name,
      progressChecks
    });
  } catch (err) {
    console.error('Get progress error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all students with their latest progress
app.get('/api/progress/summary', async (req, res) => {
  try {
    const session = driver.session();
    const result = await session.run(`
      MATCH (s:Student)
      OPTIONAL MATCH (s)-[:HAS_PROGRESS_CHECK]->(p:ProgressCheck)
      WITH s, p ORDER BY p.checkDate DESC
      RETURN s as student, collect(p)[0] as latestProgress
      ORDER BY student.name
    `);
    await session.close();
    
    const students = result.records.map(r => {
      const s = r.get('student').properties;
      const p = r.get('latestProgress')?.properties || null;
      return {
        id: s.id,
        name: s.name,
        nameChinese: s.nameChinese,
        workshop: s.workshop,
        latestProgress: p ? {
          ...p,
          attributes: JSON.parse(p.attributes || '{}')
        } : null
      };
    });
    
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Link video to progress check
app.post('/api/progress-check/:id/video', async (req, res) => {
  try {
    const { id } = req.params;
    const { videoId } = req.body;
    
    const session = driver.session();
    try {
      await session.run(`
        MATCH (p:ProgressCheck {id: $progressCheckId})
        MATCH (f:File {id: $videoId})
        CREATE (p)-[:HAS_VIDEO]->(f)
        RETURN p, f
      `, { progressCheckId: id, videoId });
    } finally {
      await session.close();
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Initialize database schema
async function initSchema() {
  const session = driver.session();
  try {
    // Create constraints
    await session.run(`
      CREATE CONSTRAINT student_id IF NOT EXISTS
      FOR (s:Student) REQUIRE s.id IS UNIQUE
    `).catch(() => {});
    
    await session.run(`
      CREATE CONSTRAINT file_id IF NOT EXISTS
      FOR (f:File) REQUIRE f.id IS UNIQUE
    `).catch(() => {});
    
    // TaskQueue constraint for agent coordination
    await session.run(`
      CREATE CONSTRAINT task_id IF NOT EXISTS
      FOR (t:Task) REQUIRE t.id IS UNIQUE
    `).catch(() => {});
    
    // ProgressCheck constraint
    await session.run(`
      CREATE CONSTRAINT progresscheck_id IF NOT EXISTS
      FOR (p:ProgressCheck) REQUIRE p.id IS UNIQUE
    `).catch(() => {});
    
    console.log('✓ Schema initialized');
  } finally {
    await session.close();
  }
}

// Serve dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Claim page for LINE linking
app.get('/claim', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'claim.html'));
});

// Student self-assessment (redirect for clean QR URLs)
app.get('/student', (req, res) => {
  const qs = req.url.includes('?') ? req.url.split('?')[1] : '';
  res.redirect(`/student.html${qs ? '?' + qs : ''}`);
});

// LINE Account Claim API - Link LINE to student
// POST /api/line/claim
app.post('/api/line/claim', async (req, res) => {
  const { code, studentId } = req.body || {};

  if (!code || !studentId) {
    return res.status(400).json({ error: 'Missing code or name' });
  }

  const session = driver.session();
  try {
    // Find pending code in Neo4j (set by LINE bot)
    const codeResult = await session.run(
      `MATCH (la:LineAccount {pendingCode: $code})
       WHERE la.codeExpires > datetime()
       RETURN la.uid as uid, la.codeExpires as expires`,
      { code }
    );

    if (codeResult.records.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid or expired code. Get a new one from the LINE bot.' 
      });
    }

    const lineUid = codeResult.records[0].get('uid');

    // Find student
    const studentResult = await session.run(
      `MATCH (s:Student) WHERE s.studentId = $id OR s.name = $id RETURN s.studentId as id`,
      { id: studentId }
    );

    if (studentResult.records.length === 0) {
      return res.status(400).json({ success: false, error: 'Student not found. Check your name.' });
    }

    const actualStudentId = studentResult.records[0].get('id');

    // Link student to LINE account
    await session.run(
      `MATCH (s:Student {studentId: $studentId})
       MERGE (la:LineAccount {uid: $lineUid})
       MERGE (s)-[:HAS_LINE]->(la)
       REMOVE la.pendingCode, la.codeExpires
       SET la.linkedAt = datetime()`,
      { studentId: actualStudentId, lineUid }
    );

    res.json({ success: true, message: 'LINE account linked!' });
  } catch (err) {
    console.error('Claim error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  } finally {
    await session.close();
  }
});

// ═══════════════════════════════════════════════════════════
// TASK API - Agent Coordination
// ═══════════════════════════════════════════════════════════

// Create task
app.post('/api/tasks', async (req, res) => {
  const session = driver.session();
  try {
    const task = await taskApi.createTask(session, req.body);
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Get tasks by assignee
app.get('/api/tasks/assignee/:assignee', async (req, res) => {
  const session = driver.session();
  try {
    const { assignee } = req.params;
    const { status } = req.query;
    const tasks = await taskApi.getTasksByAssignee(session, assignee, status);
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Get all tasks (for timeline)
app.get('/api/tasks', async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (t:Task)
      RETURN t
      ORDER BY t.deadline ASC
    `);
    await session.close();
    
    const tasks = result.records.map(r => {
      const t = r.get('t').properties;
      // Calculate progress
      const actual = t.actualHours?.low ?? t.actualHours ?? 0;
      const estimated = t.estimatedHours?.low ?? t.estimatedHours ?? 0;
      const progress = estimated > 0 ? Math.round((actual / estimated) * 100) : 0;
      
      return {
        id: t.id,
        title: t.title,
        description: t.description,
        assignee: t.assignee,
        status: t.status,
        priority: t.priority,
        deadline: t.deadline,
        estimatedHours: estimated,
        actualHours: actual,
        progress: progress,
        result: t.result,
        createdAt: t.createdAt
      };
    });
    
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get task by ID
app.get('/api/tasks/:id', async (req, res) => {
  const session = driver.session();
  try {
    const task = await taskApi.getTaskById(session, req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Update task
app.patch('/api/tasks/:id', async (req, res) => {
  const session = driver.session();
  try {
    const task = await taskApi.updateTaskStatus(session, req.params.id, req.body);
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

// ─────────────────────────────────────────────────────────────
// BRAINSTORM / IDEAS API - Team Pulse
// ─────────────────────────────────────────────────────────────

// Create idea
app.post('/api/ideas', async (req, res) => {
  const session = driver.session();
  try {
    const { text, category, author } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Idea text required' });
    }

    const id = uuidv4();
    const result = await session.run(`
      CREATE (i:Idea {
        id: $id,
        text: $text,
        category: $category || 'general',
        author: $author || 'Anonymous',
        votes: 0,
        votedBy: '[]',
        createdAt: datetime()
      })
      RETURN i
    `, { id, text, category: category || 'general', author: author || 'Anonymous' });

    const idea = result.records[0].get('i').properties;
    res.status(201).json({ success: true, idea });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Get all ideas
app.get('/api/ideas', async (req, res) => {
  const session = driver.session();
  try {
    const { category } = req.query;

    let query = 'MATCH (i:Idea)';
    const params = {};

    if (category) {
      query += ' WHERE i.category = $category';
      params.category = category;
    }

    query += ' RETURN i ORDER BY i.votes DESC, i.createdAt DESC';

    const result = await session.run(query, params);
    const ideas = result.records.map(r => {
      const i = r.get('i').properties;
      return {
        ...i,
        votedBy: JSON.parse(i.votedBy || '[]')
      };
    });

    res.json(ideas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Vote for idea
app.post('/api/ideas/:id/vote', async (req, res) => {
  const session = driver.session();
  try {
    const { id } = req.params;
    const { voter, increment = true } = req.body;

    // Get current vote state
    const getResult = await session.run(`
      MATCH (i:Idea {id: $id})
      RETURN i.votes as votes, i.votedBy as votedBy
    `, { id });

    if (getResult.records.length === 0) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    const currentVotes = getResult.records[0].get('votes')?.low || getResult.records[0].get('votes') || 0;
    const votedBy = JSON.parse(getResult.records[0].get('votedBy') || '[]');

    // Check if already voted
    const alreadyVoted = votedBy.includes(voter);

    let newVotes, newVotedBy;
    if (alreadyVoted) {
      // Remove vote
      newVotes = currentVotes - 1;
      newVotedBy = votedBy.filter(v => v !== voter);
    } else {
      // Add vote
      newVotes = currentVotes + 1;
      newVotedBy = [...votedBy, voter];
    }

    // Update
    await session.run(`
      MATCH (i:Idea {id: $id})
      SET i.votes = $votes, i.votedBy = $votedBy
    `, { id, votes: newVotes, votedBy: JSON.stringify(newVotedBy) });

    res.json({ success: true, votes: newVotes, voted: !alreadyVoted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Delete idea
app.delete('/api/ideas/:id', async (req, res) => {
  const session = driver.session();
  try {
    const { id } = req.params;
    await session.run('MATCH (i:Idea {id: $id}) DELETE i', { id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// ─────────────────────────────────────────────────────────────
// NEO4J MEMORY VISUALIZATION API
// ─────────────────────────────────────────────────────────────

// Get graph data for visualization
app.get('/api/graph/visualize', async (req, res) => {
  const session = driver.session();
  try {
    const { type } = req.query;

    let query;
    if (type === 'asanas') {
      query = `
        MATCH (a:Asana)-[r]-(connected)
        RETURN a, type(r) as relType, connected
        LIMIT 100
      `;
    } else if (type === 'students') {
      query = `
        MATCH (s:Student)-[r]-(connected)
        WHERE s:Student
        RETURN s, type(r) as relType, connected
        LIMIT 50
      `;
    } else {
      // Full graph
      query = `
        MATCH (a:Asana)-[r]-(connected)
        WHERE NOT connected:Tag OR connected:Asana
        RETURN a, type(r) as relType, connected
        LIMIT 150
      `;
    }

    const result = await session.run(query);
    const nodes = new Map();
    const links = [];

    result.records.forEach(record => {
      const source = record.get('a');
      const target = record.get('connected');
      const relType = record.get('relType');

      // Add source node
      if (!nodes.has(source.identity.toString())) {
        nodes.set(source.identity.toString(), {
          id: source.identity.toString(),
          label: source.properties.name || source.properties.title || 'Node',
          type: source.labels[0],
          ...source.properties
        });
      }

      // Add target node
      if (!nodes.has(target.identity.toString())) {
        nodes.set(target.identity.toString(), {
          id: target.identity.toString(),
          label: target.properties.name || target.properties.title || 'Node',
          type: target.labels[0],
          ...target.properties
        });
      }

      // Add link
      links.push({
        source: source.identity.toString(),
        target: target.identity.toString(),
        type: relType
      });
    });

    res.json({
      nodes: Array.from(nodes.values()),
      links
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Get personal nodes (myAgent, team members)
app.get('/api/agent/memory', async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (a:Agent)
      OPTIONAL MATCH (a)-[r]-(connected)
      RETURN a, collect({type: type(r), node: connected}) as connections
      ORDER BY a.name
    `);

    const agents = result.records.map(record => ({
      ...record.get('a').properties,
      id: record.get('a').identity.toString(),
      connections: record.get('connections').filter(c => c.node !== null)
    }));

    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Create/update personal agent node
app.post('/api/agent', async (req, res) => {
  const session = driver.session();
  try {
    const { name, role, skills, notes } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Agent name required' });
    }

    const id = name.toLowerCase().replace(/\s+/g, '-');

    await session.run(`
      MERGE (a:Agent {id: $id})
      SET a.name = $name,
          a.role = $role,
          a.skills = $skills,
          a.notes = $notes,
          a.updatedAt = datetime()
    `, { id, name, role, skills, notes });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// ─────────────────────────────────────────────────────────────
// TEAM HEAT MAP / AVAILABILITY API
// ─────────────────────────────────────────────────────────────

// Get team availability
app.get('/api/team/availability', async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (a:Agent)
      OPTIONAL MATCH (a)-[:HAS_SLOT]->(s:Slot)
      RETURN a.name as name, a.role as role,
             collect(s) as slots
    `);

    const team = result.records.map(record => ({
      name: record.get('name'),
      role: record.get('role'),
      slots: record.get('slots').filter(Boolean).map(s => s.properties)
    }));

    res.json(team);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Update availability slot
app.post('/api/team/availability', async (req, res) => {
  const session = driver.session();
  try {
    const { agentName, dayOfWeek, startHour, endHour, available } = req.body;

    if (!agentName || dayOfWeek === undefined) {
      return res.status(400).json({ error: 'agentName and dayOfWeek required' });
    }

    const slotId = `${agentName}-${dayOfWeek}`;

    if (available) {
      await session.run(`
        MATCH (a:Agent {name: $agentName})
        MERGE (a)-[:HAS_SLOT]->(s:Slot {id: $slotId})
        SET s.dayOfWeek = $dayOfWeek,
            s.startHour = $startHour,
            s.endHour = $endHour
      `, { agentName, slotId, dayOfWeek, startHour, endHour });
    } else {
      await session.run(`
        MATCH (a:Agent {name: $agentName})-[r:HAS_SLOT]->(s:Slot {id: $slotId})
        DELETE r, s
      `, { agentName, slotId });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Get team workload (tasks per person)
app.get('/api/team/workload', async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (t:Task)
      RETURN t.assignee as assignee,
             count(t) as totalTasks,
             sum(case when t.status = 'COMPLETE' then 1 else 0 end) as completed,
             sum(case when t.status = 'IN_PROGRESS' then 1 else 0 end) as inProgress,
             sum(case when t.status = 'ASSIGNED' then 1 else 0 end) as assigned
      ORDER BY totalTasks DESC
    `);

    const workload = result.records.map(record => ({
      assignee: record.get('assignee'),
      totalTasks: record.get('totalTasks')?.low || 0,
      completed: record.get('completed')?.low || 0,
      inProgress: record.get('inProgress')?.low || 0,
      assigned: record.get('assigned')?.low || 0
    }));

    res.json(workload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// ─────────────────────────────────────────────────────────────
// ASANA / SERIES IMPORT API
// ─────────────────────────────────────────────────────────────

// Import asanas and link to series
app.post('/api/import/asanas', async (req, res) => {
  const session = driver.session();
  try {
    const { asanas } = req.body;
    if (!asanas || !Array.isArray(asanas)) {
      return res.status(400).json({ error: 'asanas array required' });
    }
    
    let imported = 0;
    for (const asana of asanas) {
      // Create series if not exists
      await session.run(`
        MERGE (s:Series {name: $series})
      `, { series: asana.series || 'Uncategorized' });
      
      // Create asana
      await session.run(`
        MERGE (a:Asana {name: $name})
        SET a.meaning = $meaning,
            a.function = $function,
            a.series = $series,
            a.type = 'pose'
        WITH a
        MATCH (s:Series {name: $series})
        MERGE (a)-[:BELONGS_TO_SERIES]->(s)
      `, { 
        name: asana.name, 
        meaning: asana.meaning || '', 
        function: asana.function || '', 
        series: asana.series || 'Uncategorized' 
      });
      imported++;
    }
    
    res.json({ success: true, imported });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Import tags (weaknesses/strengths) and link to students
app.post('/api/import/tags', async (req, res) => {
  const session = driver.session();
  try {
    const { studentTags } = req.body;
    if (!studentTags || !Array.isArray(studentTags)) {
      return res.status(400).json({ error: 'studentTags array required' });
    }
    
    let linked = 0;
    for (const item of studentTags) {
      const { studentName, weaknesses, strengths, practiceSeries } = item;
      
      // Link to practice series
      for (const series of (practiceSeries || [])) {
        await session.run(`
          MATCH (st:Student {name: $studentName})
          MERGE (s:Series {name: $series})
          MERGE (st)-[:PRACTICES]->(s)
        `, { studentName, series });
      }
      
      // Link to weaknesses
      for (const tag of (weaknesses || [])) {
        await session.run(`
          MATCH (st:Student {name: $studentName})
          MERGE (t:Tag {name: $tag, category: 'weakness'})
          MERGE (st)-[:HAS_WEAKNESS]->(t)
        `, { studentName, tag });
      }
      
      // Link to strengths
      for (const tag of (strengths || [])) {
        await session.run(`
          MATCH (st:Student {name: $studentName})
          MERGE (t:Tag {name: $tag, category: 'strength'})
          MERGE (st)-[:HAS_STRENGTH]->(t)
        `, { studentName, tag });
      }
      linked++;
    }
    
    res.json({ success: true, linkedStudents: linked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Get all asanas with series info
app.get('/api/asanas', async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (a:Asana)
      OPTIONAL MATCH (a)-[:BELONGS_TO_SERIES]->(s:Series)
      RETURN a.name as name, a.meaning as meaning, a.function as function, 
             a.series as series, s.name as seriesName
      ORDER BY s.name, a.name
    `);
    
    const asanas = result.records.map(r => ({
      name: r.get('name'),
      meaning: r.get('meaning'),
      function: r.get('function'),
      series: r.get('series'),
      seriesName: r.get('seriesName')
    }));
    
    res.json({ asanas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Get all series
app.get('/api/series', async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (s:Series) RETURN s.name as name, labels(s) as labels
      ORDER BY s.name
    `);
    const seriesList = result.records.map(r => ({ name: r.get('name'), labels: r.get('labels') }));
    res.json({ series: seriesList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Get all tags
app.get('/api/tags', async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (t:Tag) RETURN t.name as name, t.category as category, count(*) as count
    `);
    const tags = result.records.map(r => ({ name: r.get('name'), category: r.get('category'), count: r.get('count').toInt() }));
    res.json({ tags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Start server
async function start() {
  await testNeo4j();
  await initSchema();

  app.listen(PORT, () => {
    console.log(`✓ Mission Control running on http://localhost:${PORT}`);
  });

  // Auto-start the Telegram bot as a managed child process when running on Railway
  // (or anywhere RUN_BOT=1 is set). Auto-restarts on crash so it stays alive 24/7.
  if (process.env.RUN_BOT === '1' || process.env.RAILWAY_ENVIRONMENT) {
    startBot();
  }
}

function startBot() {
  const { spawn } = require('child_process');
  console.log('[bot-supervisor] starting assessment-bot.js as managed child');
  const child = spawn('node', ['assessment-bot.js'], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code, signal) => {
    console.log(`[bot-supervisor] bot exited (code=${code}, signal=${signal}) — restarting in 5s`);
    setTimeout(startBot, 5000);
  });
  child.on('error', (err) => {
    console.error('[bot-supervisor] spawn error:', err.message);
  });
}

start();

// Graceful shutdown
process.on('SIGINT', async () => {
  await driver.close();
  process.exit(0);
});
