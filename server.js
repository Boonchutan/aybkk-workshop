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
const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || '69645294',
    process.env.NEO4J_PASSWORD || 'aybkk_neo4j_2026'
  ),
  {
    // AuraDB requires encrypted connection
    encrypted: (process.env.NEO4J_URI || '').startsWith('neo4j+s') ? 'ENCRYPTION_ON' : 'ENCRYPTION_OFF',
  }
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
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

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
      // Also create a Student node so the journal checkin route can find this student
      const baseUrl = 'https://aybkk-ashtanga.up.railway.app';
      const journalLink = baseUrl + '/student.html?id=' + studentId + '&name=' + encodeURIComponent(name) + '&lang=' + (language || 'zh') + '&location=guangzhou';
      await session.run(
        `CREATE (s:Student {
          id: $id,
          name: $name,
          wechatId: $wechat,
          classType: 'chinese-workshop',
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
}

start();

// Graceful shutdown
process.on('SIGINT', async () => {
  await driver.close();
  process.exit(0);
});
