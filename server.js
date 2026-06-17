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
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

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
//
// When `assessmentId` is provided, we upload to a UNIQUE public_id per entry
// (`student_<studentId>_<assessmentId>`) so each entry gets its own immutable
// Cloudinary asset. Future uploads for OTHER entries can never overwrite this
// one. The historical photo is preserved forever.
//
// When `assessmentId` is omitted (orientation / profile setup), we use the
// canonical `student_<studentId>` id and `backup: true` so even those uploads
// keep an asset-version safety net.
// POST /api/upload/student-photo
// Body: { studentId, imageBase64, assessmentId?, slotIndex? }
//
// Per-assessment 4-slot photo storage:
//   - public_id = student_<studentId>_<assessmentId>_slot<slotIndex>
//   - each slot gets its OWN Cloudinary asset (never overwrites another slot)
//   - photoUrls array on the assessment node accumulates all 4 slots
app.post('/api/upload/student-photo', async (req, res) => {
  const { studentId, imageBase64, assessmentId, slotIndex } = req.body;
  if (!studentId || !imageBase64) return res.status(400).json({ error: 'Missing studentId or imageBase64' });
  try {
    const isPerEntry = !!assessmentId;
    // Slot-aware public_id: each slot index gets its own asset
    const slotSuffix = (slotIndex !== undefined && slotIndex !== null) ? `_slot${slotIndex}` : '';
    const publicId = isPerEntry
      ? `student_${studentId}_${assessmentId}${slotSuffix}`
      : `student_${studentId}${slotSuffix}`;
    const result = await cloudinary.uploader.upload(imageBase64, {
      folder: 'aybkk-students',
      public_id: publicId,
      overwrite: true, // re-upload same slot = refresh; different slot = separate asset
      backup: false,   // no backup version needed per slot
      transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face', quality: 'auto' }]
    });
    const photoUrl = result.secure_url;

    const session = driver.session();
    try {
      // Always update Student.photoUrl (latest-known face for dashboard)
      await session.run(
        `MERGE (s:Student {id: $sid})
         ON CREATE SET s.createdAt = datetime()
         SET s.photoUrl = $url`,
        { sid: studentId, url: photoUrl }
      );
      // Pin to the specific assessment using photoUrls array
      if (assessmentId) {
        await session.run(
          `MATCH (sa) WHERE (sa:SelfAssessment OR sa:PracticeLog) AND sa.id = $aid
           SET sa.photoUrls = coalesce(sa.photoUrls, []) + $url,
               sa.photoUrl = $url
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
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

// Push helper used by webhook handlers
async function linePushPlain(uid, messages) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.warn('[LINE] Missing access token, skipping push');
    return false;
  }
  try {
    const resp = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      },
      body: JSON.stringify({ to: uid, messages })
    });
    if (!resp.ok) console.error('[LINE] push failed', resp.status, await resp.text());
    return resp.ok;
  } catch (err) {
    console.error('[LINE] push error:', err.message);
    return false;
  }
}

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

      // Capture follow events: a user added the bot as a friend.
      // We need their userId to push messages to them later, and we send
      // back a claim code so they can link to their student profile.
      if (event.type === 'follow' && event.source && event.source.userId) {
        const uid = event.source.userId;
        console.log('[LINE] New follower UID:', uid);
        try {
          const session = driver.session();
          // If already linked to a Student, send a "welcome back" message and skip code.
          const existing = await session.run(
            `OPTIONAL MATCH (s:Student)-[:HAS_LINE]->(la:LineAccount {uid: $uid})
             RETURN s.name AS name`,
            { uid }
          );
          const linkedName = existing.records.length ? existing.records[0].get('name') : null;

          if (linkedName) {
            await session.close();
            await linePushPlain(uid, [
              { type: 'text', text:
                `${linkedName} ยินดีต้อนรับกลับมา 🙏\n` +
                `บัญชี LINE ของคุณเชื่อมกับ AYBKK แล้ว — คุณจะได้รับรูปจากการฝึกในแต่ละวันที่นี่\n\n` +
                `Welcome back, ${linkedName}!\nYour LINE is connected to AYBKK. Daily class photos will arrive here.` }
            ]);
          } else {
            const code = String(Math.floor(1000 + Math.random() * 9000));
            await session.run(
              `MERGE (la:LineAccount {uid: $uid})
               ON CREATE SET la.createdAt = datetime(), la.followedBot = true, la.linked = false
               ON MATCH SET la.followedBot = true, la.unfollowedAt = null
               SET la.pendingCode = $code,
                   la.codeExpires = datetime() + duration('PT24H')`,
              { uid, code }
            );
            await session.close();
            await linePushPlain(uid, [
              { type: 'text', text:
                `ยินดีต้อนรับสู่ AYBKK 🙏\n\n` +
                `เพื่อรับรูปจากการฝึกในแต่ละวัน:\n` +
                `1. เปิด https://aybkk-ashtanga.up.railway.app/claim\n` +
                `2. พิมพ์ชื่อของคุณ (ตามระบบจองคลาส)\n` +
                `3. ใส่รหัส: ${code}\n` +
                `(รหัสมีอายุ 24 ชม.)\n\n` +
                `— English —\n` +
                `Welcome to AYBKK. To receive your daily class photo:\n` +
                `1. Open https://aybkk-ashtanga.up.railway.app/claim\n` +
                `2. Type your name (as in our booking system)\n` +
                `3. Enter code: ${code}\n` +
                `(code expires in 24h)` }
            ]);
          }
        } catch (err) {
          console.error('[LINE] Failed to handle follow:', err.message);
        }
      }

      // Log incoming user messages with UID — useful for capturing UIDs
      // before/without a follow event during testing.
      if (event.type === 'message' && event.source && event.source.userId) {
        const uid = event.source.userId;
        const text = event.message && event.message.text ? event.message.text : `(${event.message?.type || 'non-text'})`;
        console.log(`[LINE] Message from ${uid}: ${text.slice(0, 80)}`);
      }

      // Unfollow: mark inactive so broadcaster skips them.
      if (event.type === 'unfollow' && event.source && event.source.userId) {
        const uid = event.source.userId;
        console.log('[LINE] Unfollowed:', uid);
        try {
          const session = driver.session();
          await session.run(
            `MATCH (la:LineAccount {uid: $uid})
             SET la.unfollowedAt = datetime(), la.followedBot = false`,
            { uid }
          );
          await session.close();
        } catch (err) {
          console.error('[LINE] Failed to mark unfollow:', err.message);
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

// LINE pipeline status — quick mobile-friendly dashboard
app.get('/admin/line-status', async (req, res) => {
  const session = driver.session();
  try {
    // Run each count as its own query so a zero result doesn't collapse the whole row
    const oneNum = async (cypher) => {
      const r = await session.run(cypher);
      return r.records[0] ? r.records[0].get('n').toNumber() : 0;
    };
    const totalStudents = await oneNum(`MATCH (s:Student) RETURN count(s) AS n`);
    const activeMembers = await oneNum(`MATCH (s:Student)-[:HAS_MEMBERSHIP]->(:Membership {status:'active'}) RETURN count(DISTINCT s) AS n`);
    const followers = await oneNum(`MATCH (la:LineAccount) WHERE la.followedBot=true AND la.unfollowedAt IS NULL RETURN count(la) AS n`);
    const linkedStudents = await oneNum(`MATCH (s:Student)-[:HAS_LINE]->(la:LineAccount) WHERE la.followedBot=true AND la.unfollowedAt IS NULL RETURN count(DISTINCT s) AS n`);
    const reachable = await oneNum(`MATCH (s:Student)-[:HAS_MEMBERSHIP]->(:Membership {status:'active'}) MATCH (s)-[:HAS_LINE]->(la:LineAccount) WHERE la.followedBot=true AND la.unfollowedAt IS NULL RETURN count(DISTINCT s) AS n`);
    const c = { totalStudents, activeMembers, followers, linkedStudents, reachable };

    const recent = await session.run(`
      MATCH (la:LineAccount)
      WHERE la.createdAt > datetime() - duration('PT24H')
      RETURN la.uid AS uid, la.followedBot AS following,
             la.unfollowedAt AS unfollowed, la.linked AS linked,
             la.createdAt AS at
      ORDER BY at DESC LIMIT 10
    `);

    const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AYBKK LINE status</title>
<style>body{font:16px/1.5 -apple-system,sans-serif;max-width:560px;margin:24px auto;padding:0 16px;color:#222}
h1{font-size:20px}.k{display:flex;justify-content:space-between;border-bottom:1px solid #eee;padding:8px 0}
.k b{font-variant-numeric:tabular-nums}.r{background:#fafaf6;padding:12px;border-radius:8px;margin-top:16px;font-size:14px}
.r div{padding:4px 0;border-bottom:1px solid #eee}.ok{color:#2a7}.no{color:#a55}</style>
<h1>AYBKK LINE pipeline</h1>
<div class="k"><span>Total students in DB</span><b>${c.totalStudents}</b></div>
<div class="k"><span>Active Rezerv members</span><b>${c.activeMembers}</b></div>
<div class="k"><span>LINE followers (added bot)</span><b>${c.followers}</b></div>
<div class="k"><span>Followers linked to a student</span><b>${c.linkedStudents}</b></div>
<div class="k"><span><b>Reachable today</b> (active + linked)</span><b>${c.reachable}</b></div>
<div class="r"><b>Recent LineAccount activity (24h)</b>
${recent.records.length === 0 ? '<div>nothing yet</div>' :
  recent.records.map(r => {
    const isLinked = r.get('linked');
    const isFollowing = r.get('following');
    const uf = r.get('unfollowed');
    const status = uf ? 'unfollowed' : (isLinked ? 'linked' : (isFollowing ? 'following' : 'pending'));
    const cls = uf ? 'no' : 'ok';
    return `<div class="${cls}">${String(r.get('uid')).slice(0,12)}…  ${status}</div>`;
  }).join('')}
</div>
<p style="color:#888;font-size:12px;margin-top:24px">${new Date().toISOString()}</p>`;
    res.set('Content-Type', 'text/html').send(html);
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  } finally {
    await session.close();
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

// Quote pool: Yoga Sutra + Bhagavad Gita + Hatha Yoga Pradipika + Stoic
// (Marcus Aurelius / Epictetus / Seneca). Sourced from quotes.js (root) so the
// ignore rules on data/ don't strip it during Railway upload. To update quotes,
// edit data/quotes.json then regenerate quotes.js (see header in quotes.js).
const SHARE_CARD_QUOTES = (() => {
  const raw = require('./quotes.js');
  const flat = {};
  for (const lang of Object.keys(raw)) {
    if (lang.startsWith('_')) continue;
    flat[lang] = Object.values(raw[lang]).flat();
  }
  console.log(`[share-card] loaded quotes: ${Object.entries(flat).map(([l, a]) => `${l}=${a.length}`).join(' ')}`);
  return flat;
})();

// Hash + seeded Fisher-Yates shuffle. Used to deterministically shuffle the
// quote pool per cohort/day so every student in the cohort gets a distinct quote.
function hashString(s) {
  let h = 0;
  for (const ch of s) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function shuffleSeeded(arr, seed) {
  let state = hashString(seed) || 1;
  const rand = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Zero-collision-within-cohort quote assignment.
// The cohort is the set of students who could co-post in the same group chat
// (Russia: location+city; workshop students: workshop; otherwise: location).
// We sort the cohort by id, shuffle the pool with a cohort-scoped seed, and
// assign the student the quote at their sorted index. Result: every student
// in the cohort sees a different quote on the same day. Journal rotates daily;
// welcome is stable across days.
async function quoteForCard({ studentId, type, lang, session, location, workshop, city }) {
  const pool = SHARE_CARD_QUOTES[lang] || SHARE_CARD_QUOTES.en;
  if (!pool.length) return '';
  const today = new Date().toISOString().split('T')[0];

  let cohortQuery, cohortParams, cohortKey;
  if (location === 'russia' && city) {
    cohortQuery = `MATCH (s:Student) WHERE s.location = $location AND s.city = $city RETURN s.id AS id ORDER BY s.id`;
    cohortParams = { location, city };
    cohortKey = `${location}|${city}`;
  } else if (workshop) {
    cohortQuery = `MATCH (s:Student) WHERE s.workshop = $workshop RETURN s.id AS id ORDER BY s.id`;
    cohortParams = { workshop };
    cohortKey = `ws|${workshop}`;
  } else if (location) {
    cohortQuery = `MATCH (s:Student) WHERE s.location = $location RETURN s.id AS id ORDER BY s.id`;
    cohortParams = { location };
    cohortKey = `loc|${location}`;
  } else {
    cohortQuery = `MATCH (s:Student) RETURN s.id AS id ORDER BY s.id`;
    cohortParams = {};
    cohortKey = 'all';
  }

  let cohortIdx = -1;
  if (session) {
    try {
      const r = await session.run(cohortQuery, cohortParams);
      const cohort = r.records.map(rec => rec.get('id'));
      if (cohort.length <= pool.length) cohortIdx = cohort.indexOf(studentId);
    } catch (err) {
      console.warn('[quoteForCard] cohort query failed, falling back to hash:', err.message);
    }
  }

  if (cohortIdx === -1) {
    // Fallback: hash-mod (collisions possible). Used when cohort exceeds pool,
    // student is missing from cohort, or no session was passed.
    const seed = type === 'journal' ? `${studentId}|${today}` : `${studentId}|welcome`;
    return pool[hashString(seed) % pool.length];
  }

  const seed = type === 'journal'
    ? `journal|${cohortKey}|${lang}|${today}`
    : `welcome|${cohortKey}|${lang}`;
  return shuffleSeeded(pool, seed)[cohortIdx];
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

    // Zero-collision-within-cohort quote (Yoga Sutra + Gita + HYP + Stoic), language-aware.
    const defaultQuote = await quoteForCard({
      studentId,
      type: type || 'welcome',
      lang: language,
      session,
      location,
      workshop,
      city,
    });

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

// POST /api/orientations/online — Mysore Room Online registration form posts here
app.post('/api/orientations/online', async (req, res) => {
  const session = driver.session();
  try {
    const {
      name, contactType, contact, city, country, timezone,
      experience, series, injuries, language, workshop, date, photoUrl
    } = req.body;

    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    if (!contact) return res.status(400).json({ success: false, error: 'contact required' });

    const datetime = date || new Date().toISOString();
    const baseUrl = 'https://aybkk-ashtanga.up.railway.app';
    const contactStr = String(contact || '').trim().toLowerCase();
    const contactTypeStr = String(contactType || 'telegram').trim().toLowerCase();

    // De-dupe on contactType + contact
    let existingId = null;
    let existingLink = null;
    if (contactStr) {
      const r = await session.run(
        `MATCH (s:Student {location: 'mysore-room'})
         WHERE toLower(s.contact) = $c AND toLower(s.contactType) = $ct
         RETURN s.id AS id, s.journalLink AS link
         ORDER BY s.createdAt DESC LIMIT 1`,
        { c: contactStr, ct: contactTypeStr }
      );
      if (r.records.length) {
        existingId = r.records[0].get('id');
        existingLink = r.records[0].get('link');
      }
    }

    const studentId = existingId || ('online-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6));
    const lang = language || 'en';
    const journalLink = existingLink || (baseUrl + '/student.html?id=' + studentId
      + '&name=' + encodeURIComponent(name)
      + '&lang=' + lang
      + '&location=mysore-room');

    // :Orientation audit row (always CREATE)
    await session.run(`
      CREATE (o:Orientation {
        id: $id, name: $name, contact: $contact, contactType: $contactType,
        city: $city, country: $country, timezone: $timezone,
        experience: $experience, series: $series, injuries: $injuries,
        language: $language, workshop: $workshop, photoUrl: $photoUrl,
        location: 'mysore-room', createdAt: datetime($createdAt)
      })`, {
      id: studentId, name, contact: contact || '', contactType: contactTypeStr,
      city: city || '', country: country || '', timezone: timezone || '',
      experience: experience || '', series: series || '', injuries: injuries || '',
      language: lang, workshop: workshop || "Boonchu's Mysore Room",
      photoUrl: photoUrl || '', createdAt: datetime,
    });

    // :Student canonical (MERGE on id so a repeat registration updates the same row)
    await session.run(`
      MERGE (s:Student { id: $id })
      ON CREATE SET
        s.createdAt = datetime($createdAt),
        s.classType = 'mysore-room',
        s.location = 'mysore-room',
        s.isActive = true
      SET
        s.name = $name, s.contact = $contact, s.contactType = $contactType,
        s.city = $city, s.country = $country, s.timezone = $timezone,
        s.experience = $experience, s.series = $series, s.injuries = $injuries,
        s.language = $language, s.workshop = $workshop, s.photoUrl = $photoUrl,
        s.journalLink = $journalLink, s.oriented = true,
        s.updatedAt = datetime($createdAt)
      `, {
      id: studentId, name, contact: contact || '', contactType: contactTypeStr,
      city: city || '', country: country || '', timezone: timezone || '',
      experience: experience || '', series: series || '', injuries: injuries || '',
      language: lang, workshop: workshop || "Boonchu's Mysore Room",
      photoUrl: photoUrl || '', journalLink, createdAt: datetime,
    });

    res.json({ success: true, studentId, journalLink, name, reused: !!existingId });
  } catch (err) {
    console.error('[online orientation save]', err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    await session.close();
  }
});

// GET /api/orientations/online — Mysore Room Online roster (admin)
app.get('/api/orientations/online', async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (s:Student)
      WHERE s.location = 'mysore-room' OR s.id STARTS WITH 'online-'
      OPTIONAL MATCH (s)<-[:FOR_STUDENT|ABOUT_STUDENT]-(c)
      WITH s, count(c) AS checkins
      RETURN s.id AS id, s.name AS name, s.contact AS contact, s.contactType AS contactType,
             s.city AS city, s.country AS country, s.timezone AS timezone,
             s.experience AS experience, s.series AS series, s.injuries AS injuries,
             s.language AS language, s.journalLink AS journalLink, s.photoUrl AS photoUrl,
             s.createdAt AS submittedAt, checkins
      ORDER BY s.createdAt DESC
    `);

    const students = result.records.map(r => ({
      id: r.get('id'),
      name: r.get('name'),
      contact: r.get('contact'),
      contactType: r.get('contactType'),
      city: r.get('city'),
      country: r.get('country'),
      timezone: r.get('timezone'),
      experience: r.get('experience'),
      series: r.get('series'),
      injuries: r.get('injuries'),
      language: r.get('language'),
      journalLink: r.get('journalLink'),
      photoUrl: r.get('photoUrl'),
      checkins: r.get('checkins')?.toNumber ? r.get('checkins').toNumber() : (r.get('checkins') || 0),
      submittedAt: r.get('submittedAt')
    }));

    res.json({ students, count: students.length });
  } catch (err) {
    console.error('[online orientation list]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// POST /api/orientations/private — private student self-registration
app.post('/api/orientations/private', async (req, res) => {
  const session = driver.session();
  try {
    const {
      name, contactType, contact, city, country,
      experience, series, injuries, language, date, photoUrl
    } = req.body;

    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    if (!contact) return res.status(400).json({ success: false, error: 'contact required' });

    const datetime = date || new Date().toISOString();
    const baseUrl = 'https://aybkk-ashtanga.up.railway.app';
    const contactStr = String(contact || '').trim().toLowerCase();
    const contactTypeStr = String(contactType || 'telegram').trim().toLowerCase();

    // De-dupe on contactType + contact within private cohort
    let existingId = null;
    let existingLink = null;
    if (contactStr) {
      const r = await session.run(
        `MATCH (s:Student {location: 'private'})
         WHERE toLower(s.contact) = $c AND toLower(s.contactType) = $ct
         RETURN s.id AS id, s.journalLink AS link
         ORDER BY s.createdAt DESC LIMIT 1`,
        { c: contactStr, ct: contactTypeStr }
      );
      if (r.records.length) {
        existingId = r.records[0].get('id');
        existingLink = r.records[0].get('link');
      }
    }

    const studentId = existingId || ('private-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6));
    const lang = language || 'en';
    const journalLink = existingLink || (baseUrl + '/student.html?id=' + studentId
      + '&name=' + encodeURIComponent(name)
      + '&lang=' + lang
      + '&location=private');

    await session.run(`
      CREATE (o:Orientation {
        id: $id, name: $name, contact: $contact, contactType: $contactType,
        city: $city, country: $country,
        experience: $experience, series: $series, injuries: $injuries,
        language: $language, photoUrl: $photoUrl,
        location: 'private', createdAt: datetime($createdAt)
      })`, {
      id: studentId, name, contact: contact || '', contactType: contactTypeStr,
      city: city || '', country: country || '',
      experience: experience || '', series: series || '', injuries: injuries || '',
      language: lang, photoUrl: photoUrl || '', createdAt: datetime,
    });

    await session.run(`
      MERGE (s:Student { id: $id })
      ON CREATE SET
        s.createdAt = datetime($createdAt),
        s.classType = 'private',
        s.location = 'private',
        s.isActive = true
      SET
        s.name = $name, s.contact = $contact, s.contactType = $contactType,
        s.city = $city, s.country = $country,
        s.experience = $experience, s.series = $series, s.injuries = $injuries,
        s.language = $language, s.photoUrl = $photoUrl,
        s.journalLink = $journalLink, s.oriented = true,
        s.updatedAt = datetime($createdAt)
      `, {
      id: studentId, name, contact: contact || '', contactType: contactTypeStr,
      city: city || '', country: country || '',
      experience: experience || '', series: series || '', injuries: injuries || '',
      language: lang, photoUrl: photoUrl || '', journalLink, createdAt: datetime,
    });

    res.json({ success: true, studentId, journalLink, name, reused: !!existingId });
  } catch (err) {
    console.error('[private orientation save]', err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    await session.close();
  }
});

// GET /api/orientations/private — list private students (admin)
app.get('/api/orientations/private', async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (s:Student)
      WHERE s.location = 'private' OR s.id STARTS WITH 'private-'
      RETURN s.id AS id, s.name AS name, s.contact AS contact, s.contactType AS contactType,
             s.city AS city, s.country AS country,
             s.experience AS experience, s.series AS series, s.injuries AS injuries,
             s.language AS language, s.journalLink AS journalLink, s.photoUrl AS photoUrl,
             s.createdAt AS submittedAt
      ORDER BY s.createdAt DESC
    `);

    const students = result.records.map(r => ({
      id: r.get('id'), name: r.get('name'),
      contact: r.get('contact'), contactType: r.get('contactType'),
      city: r.get('city'), country: r.get('country'),
      experience: r.get('experience'), series: r.get('series'),
      injuries: r.get('injuries'), language: r.get('language'),
      journalLink: r.get('journalLink'), photoUrl: r.get('photoUrl'),
      submittedAt: r.get('submittedAt')
    }));

    res.json({ students, count: students.length });
  } catch (err) {
    console.error('[private orientation list]', err.message);
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

// ─── Yearly Planner / Timeline ───────────────────────────────────────────────
// Single-operator planning tool: full-year timeline of projects, workshops,
// travel and kids' school holidays. Stored as one JSON document.
//
// Persistence: PostgreSQL (planner_state, one row) when DATABASE_URL is set —
// this is the source of truth in production so phone and laptop stay in sync.
// Without a DB (local dev) it falls back to data/calendar.json. On the first
// DB read the table is seeded from the local file if present, otherwise from
// the committed seed module (data/ is gitignored, so the seed ships in code).
const CALENDAR_FILE = path.join(__dirname, 'data', 'calendar.json');
let CALENDAR_SEED = null;
try {
  CALENDAR_SEED = require('./scripts/calendar-seed.js');
} catch (e) {
  console.error('calendar seed module unavailable, planner starts empty:', e.message);
}

const CALENDAR_DEFAULT = {
  lanes: [
    { id: 'school',   name: "Kids' School & Holidays", color: '#9a805d' },
    { id: 'travel',   name: 'Travel & Workshops',      color: '#7d6442' },
    { id: 'aybkk',    name: 'AYBKK',                    color: '#b8895a' },
    { id: 'tee',      name: 'Tee Shirt Plan',          color: '#a8693f' },
    { id: 'online',   name: 'Online Class',            color: '#8a7b53' },
    { id: 'personal', name: 'Personal',                color: '#6c5e4a' }
  ],
  events: []
};

function calendarDoc(data) {
  return {
    lanes: Array.isArray(data && data.lanes) && data.lanes.length
      ? data.lanes : CALENDAR_DEFAULT.lanes,
    events: Array.isArray(data && data.events) ? data.events : []
  };
}

// Race a Postgres query against a timeout so a hung pool / paused DB
// can't leave the planner request hanging forever.
function pgQueryT(pg, sql, params, ms) {
  const t = ms || 4500;
  return Promise.race([
    pg.query(sql, params),
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error('pg query timeout after ' + t + 'ms')), t))
  ]);
}

function readSeedFromDisk() {
  try {
    if (fs.existsSync(CALENDAR_FILE)) {
      return JSON.parse(fs.readFileSync(CALENDAR_FILE, 'utf8'));
    }
  } catch (e) { console.error('calendar disk read failed:', e.message); }
  return CALENDAR_SEED;
}

let calendarTableReady = false;
async function ensureCalendarTable(pg) {
  if (calendarTableReady) return;
  await pgQueryT(pg, `CREATE TABLE IF NOT EXISTS planner_state (
    id text PRIMARY KEY,
    doc jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  calendarTableReady = true;
}

async function readCalendar(pg) {
  if (pg) {
    await ensureCalendarTable(pg);
    const r = await pgQueryT(pg, `SELECT doc FROM planner_state WHERE id = 'default'`);
    if (r.rows.length) return calendarDoc(r.rows[0].doc);
    const doc = calendarDoc(readSeedFromDisk());
    await pgQueryT(pg,
      `INSERT INTO planner_state (id, doc) VALUES ('default', $1)
       ON CONFLICT (id) DO NOTHING`, [JSON.stringify(doc)]);
    return doc;
  }
  return calendarDoc(readSeedFromDisk());
}

async function writeCalendar(pg, doc) {
  if (pg) {
    await ensureCalendarTable(pg);
    await pgQueryT(pg,
      `INSERT INTO planner_state (id, doc, updated_at)
       VALUES ('default', $1, now())
       ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
      [JSON.stringify(doc)]);
    return;
  }
  fs.writeFileSync(CALENDAR_FILE, JSON.stringify(doc, null, 2));
}

app.get('/calendar', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'calendar.html'));
});

app.get('/api/calendar', async (req, res) => {
  try {
    res.json(await readCalendar(req.pg));
  } catch (err) {
    console.error('calendar read failed:', err.message);
    // DB unreachable: serve the on-disk seed so the planner still shows
    // a usable plan instead of going blank, and re-try the table next time.
    calendarTableReady = false;
    res.set('X-Calendar-Fallback', 'seed').json(calendarDoc(readSeedFromDisk()));
  }
});

app.put('/api/calendar', async (req, res) => {
  try {
    const { lanes, events } = req.body || {};
    if (!Array.isArray(lanes) || !Array.isArray(events)) {
      return res.status(400).json({ error: 'lanes and events arrays required' });
    }
    await writeCalendar(req.pg, { lanes, events });
    res.json({ ok: true, saved: events.length });
  } catch (err) {
    console.error('calendar write failed:', err.message);
    calendarTableReady = false;
    res.status(503).json({ error: 'calendar storage unavailable, please retry' });
  }
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

// Cloudflare Quick Tunnel — no account needed.
// Gives a *.trycloudflare.com URL routed through Cloudflare's HK/SG edge,
// making the app reachable from mainland China without a VPN.
// The URL is stable for the lifetime of this process (changes on Railway
// restart).  The teacher posts it to the workshop WeChat group each day.
function startChinaTunnel() {
  const { spawn } = require('child_process');
  const { existsSync } = require('fs');

  // Prefer local binary, then cloudflared from PATH (installed via nixPkgs).
  let cfBin = path.join(__dirname, 'cloudflared');
  if (!existsSync(cfBin)) {
    try {
      const { execSync } = require('child_process');
      cfBin = execSync('which cloudflared', { encoding: 'utf8' }).trim();
    } catch (_) { cfBin = ''; }
  }
  if (!cfBin) {
    console.warn('[china-tunnel] cloudflared not found locally or in PATH — tunnel disabled');
    return;
  }

  console.log(`[china-tunnel] starting (binary: ${cfBin})`);
  const child = spawn(cfBin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let found = false;
  const onData = (data) => {
    const text = data.toString();
    process.stdout.write('[cloudflared] ' + text);
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match && !found) {
      found = true;
      process.env.TUNNEL_URL = match[0];
      console.log('🇨🇳 ═══════════════════════════════════════════════════');
      console.log(`🇨🇳  CHINA ACCESS URL: ${match[0]}`);
      console.log('🇨🇳  Share this link with students in the WeChat group.');
      console.log('🇨🇳 ═══════════════════════════════════════════════════');
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  child.on('error', (err) => console.warn(`[china-tunnel] spawn error: ${err.message}`));
  child.on('exit', (code) => {
    console.warn(`[china-tunnel] cloudflared exited (code ${code}) — restarting in 10s`);
    process.env.TUNNEL_URL = '';
    found = false;
    setTimeout(startChinaTunnel, 10000);
  });
}

// GET /api/china-url — returns the current China-accessible tunnel URL.
// Teacher can open this on their device to get the current link to share.
app.get('/api/china-url', (req, res) => {
  const url = process.env.TUNNEL_URL;
  if (url && url.includes('trycloudflare.com')) {
    res.json({ url, instructions: 'Share this URL with students in China (no VPN needed).' });
  } else if (url) {
    res.json({ url, instructions: 'Custom domain or Railway URL.' });
  } else {
    res.status(503).json({ error: 'Tunnel not yet started, try again in 30s.' });
  }
});

// Start server
async function start() {
  await testNeo4j();
  await initSchema();

  app.listen(PORT, () => {
    console.log(`✓ Mission Control running on http://localhost:${PORT}`);
  });

  // Start China tunnel in production (Railway) or when explicitly requested.
  // Skipped in local dev unless ENABLE_TUNNEL=1 is set.
  if (process.env.RAILWAY_ENVIRONMENT || process.env.ENABLE_TUNNEL === '1') {
    startChinaTunnel();
  }

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
