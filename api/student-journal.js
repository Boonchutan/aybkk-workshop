/**
 * AYBKK Student Journal API
 * Routes: /api/journal/checkin, /api/journal/profile, /api/journal/qr, /api/journal/students
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');

const TUNNEL_URL = process.env.TUNNEL_URL || process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : 'https://aybkk-ashtanga.up.railway.app';

// Debug: test route
router.get('/_test', (req, res) => {
  res.json({ ok: true, routes: router.stack.map(l => l.route?.path).filter(Boolean) });
});

// ============================================
// STUDENT SELF-ASSESSMENT ROUTES
// ============================================

// POST /api/journal/checkin - Student submits self-assessment
router.post('/checkin', async (req, res) => {
  const session = req.driver.session();
  try {
    const { studentId, studentName, lastAsana, vinyasa, bandha, stableToday, difficultToday, lastAsanaNote, practiceNotes, sessionDate, platform, location } = req.body;

    // Validate required fields
    if (!vinyasa || !bandha || !stableToday || !difficultToday) {
      return res.status(400).json({ error: 'Missing required fields: vinyasa, bandha, stableToday, difficultToday' });
    }

    // Check if student exists
    let student = null;
    if (studentId) {
      const findResult = await session.run(
        'MATCH (s:Student {id: $id}) RETURN s',
        { id: studentId }
      );
      if (findResult.records.length > 0) {
        student = findResult.records[0].get('s');
      }
    }

    // If no studentId or student not found, try to find by name
    if (!student && studentName) {
      const findByName = await session.run(
        'MATCH (s:Student {name: $name}) RETURN s LIMIT 1',
        { name: studentName }
      );
      if (findByName.records.length > 0) {
        student = findByName.records[0].get('s');
      }
    }

    // If still no student but we have an ID + name from the URL (existing Reserv student
    // opening their journal for the first time, or a workshop student), auto-create the
    // Neo4j node so they're not bounced to registration.
    if (!student && studentId && studentName) {
      const created = await session.run(`
        MERGE (s:Student {id: $id})
        ON CREATE SET
          s.name = $name,
          s.location = $location,
          s.language = $language,
          s.classType = $classType,
          s.isActive = true,
          s.createdAt = datetime($now),
          s.autoCreatedFromCheckin = true
        RETURN s
      `, {
        id: studentId,
        name: studentName,
        location: location || 'bangkok',
        language: req.body.language || (location === 'bangkok' ? 'th' : 'en'),
        classType: location === 'bangkok' ? 'shala-regular' : (location || 'unknown'),
        now: new Date().toISOString()
      });
      student = created.records[0].get('s');
    }

    // If still no student (truly anonymous fresh user — no id, no name), prompt registration
    if (!student) {
      return res.status(404).json({
        error: 'Student not found',
        needsProfile: true,
        message: 'Please create your profile first by filling in your details below.'
      });
    }

    const studentIdVal = student.properties.id;
    const checkinId = uuidv4();
    const now = new Date().toISOString();

    // Create self-assessment node linked to student. We snapshot the student's
    // CURRENT photoUrl onto this assessment so that even if they skip the photo
    // step, this entry has a pinned versioned URL — and a *future* photo upload
    // for a different entry won't retroactively change this one.
    await session.run(`
      MATCH (s:Student {id: $studentId})
      CREATE (sa:SelfAssessment {
        id: $id,
        lastAsana: $lastAsana,
        lastAsanaNote: $lastAsanaNote,
        vinyasa: $vinyasa,
        bandha: $bandha,
        stableToday: $stableToday,
        difficultToday: $difficultToday,
        practiceNotes: $practiceNotes,
        sessionDate: $sessionDate,
        platform: $platform,
        location: $location,
        photoUrl: s.photoUrl,
        checkedInAt: datetime($checkedInAt)
      })
      CREATE (s)-[:HAS_SELF_ASSESSMENT]->(sa)
      RETURN sa
    `, {
      id: checkinId,
      studentId: studentIdVal,
      lastAsana: lastAsana || '',
      lastAsanaNote: lastAsanaNote || '',
      vinyasa,
      bandha,
      stableToday,
      difficultToday,
      practiceNotes: practiceNotes || '',
      sessionDate: sessionDate || new Date().toISOString().split('T')[0],
      platform: platform || 'web',
      location: location || 'unknown',
      checkedInAt: now
    });

    res.json({ 
      success: true, 
      checkinId,
      studentName: student.properties.name,
      checkedInAt: now
    });
  } catch (error) {
    console.error('Checkin error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// POST /api/journal/profile - Create new student profile
router.post('/profile', async (req, res) => {
  const session = req.driver.session();
  try {
    const { name, lineId, wechatId, phone, email, isChineseStudent, classType, language, location, platform } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const studentId = uuidv4();
    const now = new Date().toISOString();
    const lang = language || 'zh';
    const loc = location || 'unknown';
    const journalLink = `${TUNNEL_URL}/student.html?id=${studentId}`
      + `&name=${encodeURIComponent(name)}`
      + `&lang=${lang}`
      + `&location=${loc}`;

    // Check if student with same name exists
    const existing = await session.run(
      'MATCH (s:Student {name: $name}) RETURN s LIMIT 1',
      { name }
    );

    if (existing.records.length > 0) {
      const props = existing.records[0].get('s').properties;
      return res.status(409).json({
        error: 'Student with this name already exists',
        studentId: props.id,
        journalLink: props.journalLink || null,
        name
      });
    }

    // Create new student node
    await session.run(`
      CREATE (s:Student {
        id: $id,
        name: $name,
        lineId: $lineId,
        wechatId: $wechatId,
        phone: $phone,
        email: $email,
        isChineseStudent: $isChineseStudent,
        classType: $classType,
        language: $language,
        location: $location,
        platform: $platform,
        journalLink: $journalLink,
        createdAt: datetime($createdAt),
        isActive: true
      })
      RETURN s
    `, {
      id: studentId,
      name,
      lineId: lineId || null,
      wechatId: wechatId || null,
      phone: phone || null,
      email: email || null,
      isChineseStudent: isChineseStudent || false,
      classType: classType || 'regular',
      language: lang,
      location: loc,
      platform: platform || 'web',
      journalLink,
      createdAt: now
    });

    // Generate QR code for this student
    const qrUrl = `${TUNNEL_URL}/student?id=${studentId}`;
    const qrDataUrl = await QRCode.toDataURL(qrUrl, {
      width: 300,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' }
    });

    res.json({
      success: true,
      studentId,
      name,
      journalLink,
      qrUrl,
      qrDataUrl
    });
  } catch (error) {
    console.error('Profile creation error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// GET /api/journal/student/:id - Get student with history (PracticeLog + SelfAssessment)
router.get('/student/:id', async (req, res) => {
  const session = req.driver.session();
  try {
    const result = await session.run(`
      MATCH (s:Student {id: $id})
      OPTIONAL MATCH (s)-[:HAS_PRACTICE_LOG]->(pl:PracticeLog)
      OPTIONAL MATCH (s)-[:HAS_SELF_ASSESSMENT]->(sa:SelfAssessment)
      WITH s,
           collect(DISTINCT {
             id: coalesce(pl.id, ''),
             vinyasa: pl.vinyasa,
             bandha: pl.bandha,
             stableToday: pl.stableToday,
             difficultToday: pl.difficultToday,
             practiceNotes: pl.practiceNotes,
             lastAsana: coalesce(pl.lastAsana, pl.lastAsanaNote, ''),
             sessionDate: pl.sessionDate,
             checkedInAt: toString(pl.checkedInAt),
             photoUrl: pl.photoUrl,
             photoUrls: pl.photoUrls,
             source: 'practice_log'
           }) as practiceLogs,
           collect(DISTINCT {
             id: coalesce(sa.id, ''),
             vinyasa: sa.vinyasa,
             bandha: sa.bandha,
             stableToday: sa.stableToday,
             difficultToday: sa.difficultToday,
             practiceNotes: sa.practiceNotes,
             lastAsana: coalesce(sa.lastAsana, sa.lastAsanaNote, ''),
             sessionDate: sa.sessionDate,
             checkedInAt: toString(sa.checkedInAt),
             photoUrl: sa.photoUrl,
             photoUrls: sa.photoUrls,
             source: 'self_assessment'
           }) as selfAssessments
      RETURN s, practiceLogs, selfAssessments
    `, { id: req.params.id });

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const record = result.records[0];
    const s = record.get('s').properties;
    const practiceLogs = (record.get('practiceLogs') || []).filter(a => a && a.vinyasa);
    const selfAssessments = (record.get('selfAssessments') || []).filter(a => a && a.vinyasa);

    // Merge both sources, deduplicate by sessionDate, sort newest first
    const allAssessments = [...practiceLogs, ...selfAssessments]
      .sort((a, b) => (b.sessionDate || '').localeCompare(a.sessionDate || ''));

    res.json({
      id: s.id,
      name: s.name,
      lineId: s.lineId,
      wechatId: s.wechatId,
      photoUrl: s.photoUrl || null,
      isChineseStudent: s.isChineseStudent,
      classType: s.classType,
      createdAt: s.createdAt,
      assessments: allAssessments,
      assessmentCount: allAssessments.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// GET /api/journal/students - List all students (for teacher view)
router.get('/students', async (req, res) => {
  const session = req.driver.session();
  try {
    const { isChinese, hasAssessment } = req.query;
    
    let whereClause = '';
    const params = {};
    
    if (isChinese === 'true') {
      whereClause = 'WHERE s.isChineseStudent = true';
      params.isChinese = true;
    }
    
    let query = `
      MATCH (s:Student)
      ${whereClause}
      OPTIONAL MATCH (s)-[:HAS_PRACTICE_LOG]->(pl:PracticeLog)
      OPTIONAL MATCH (s)-[:HAS_SELF_ASSESSMENT]->(sa:SelfAssessment)
      WITH s,
           count(DISTINCT pl) + count(DISTINCT sa) as assessmentCount,
           max(coalesce(pl.sessionDate, sa.sessionDate)) as lastDate
      WHERE s.isActive = true
    `;

    if (hasAssessment === 'true') {
      query += ' AND assessmentCount > 0';
    }

    query += `
      RETURN s.id as id, s.name as name, s.isChineseStudent as isChineseStudent,
             s.classType as classType, s.createdAt as createdAt,
             s.photoUrl as photoUrl,
             lastDate, assessmentCount
      ORDER BY s.name ASC
    `;

    const result = await session.run(query, params);

    const students = result.records.map(r => ({
      id: r.get('id'),
      name: r.get('name'),
      isChineseStudent: r.get('isChineseStudent'),
      classType: r.get('classType'),
      photoUrl: r.get('photoUrl') || null,
      createdAt: r.get('createdAt'),
      lastDate: r.get('lastDate'),
      assessmentCount: Number(r.get('assessmentCount') || 0)
    }));

    res.json({ students, count: students.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// GET /api/journal/profile/:id - Get student orientation profile (for teacher summary card)
router.get('/profile/:id', async (req, res) => {
  const session = req.driver.session();
  try {
    const { id } = req.params;

    // Try by workshop ID first, then by name match across both ID systems
    const result = await session.run(`
      MATCH (s:Student)
      WHERE s.id = $id
      OPTIONAL MATCH (s)-[:HAS_SELF_ASSESSMENT]->(sa:SelfAssessment)
      WITH s, sa ORDER BY sa.checkedInAt DESC
      WITH s, collect(sa)[0..5] as recentAssessments, count(sa) as totalCheckins
      RETURN s, recentAssessments, totalCheckins
    `, { id });

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const record = result.records[0];
    const s = record.get('s').properties;
    const recent = record.get('recentAssessments').filter(Boolean).map(sa => sa.properties);
    const totalCheckins = record.get('totalCheckins').toInt();

    res.json({
      id: s.id,
      name: s.name,
      englishName: s.englishName || null,
      chineseName: s.chineseName || null,
      city: s.city || null,
      yearsPractice: s.yearsPractice || null,
      lastAsana: s.lastAsana || null,
      difficulties: s.difficulties || [],
      injury: s.injury || null,
      classType: s.classType || null,
      oriented: s.oriented || false,
      totalCheckins,
      recentAssessments: recent
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// GET /api/journal/profiles - Bulk fetch all student profiles (for teacher summary cards)
router.get('/profiles', async (req, res) => {
  const session = req.driver.session();
  try {
    const result = await session.run(`
      MATCH (s:Student {classType: 'chinese-workshop'})
      WHERE s.oriented = true
      OPTIONAL MATCH (s)-[:HAS_SELF_ASSESSMENT]->(sa:SelfAssessment)
      WITH s, sa ORDER BY sa.checkedInAt DESC
      WITH s, collect(sa)[0..3] as recentAssessments, count(sa) as totalCheckins
      RETURN s.id as id, s.name as name, s.englishName as englishName, 
             s.chineseName as chineseName, s.city as city,
             s.yearsPractice as yearsPractice, s.lastAsana as lastAsana,
             s.difficulties as difficulties, s.injury as injury,
             s.classType as classType, totalCheckins,
             recentAssessments
      ORDER BY s.name
    `);

    const profiles = result.records.map(r => ({
      id: r.get('id'),
      name: r.get('name'),
      englishName: r.get('englishName'),
      chineseName: r.get('chineseName'),
      city: r.get('city'),
      yearsPractice: r.get('yearsPractice'),
      lastAsana: r.get('lastAsana'),
      difficulties: r.get('difficulties'),
      injury: r.get('injury'),
      classType: r.get('classType'),
      totalCheckins: r.get('totalCheckins').toInt(),
      recentAssessments: r.get('recentAssessments').filter(Boolean).map(sa => sa.properties)
    }));

    res.json({ profiles, count: profiles.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// GET /api/journal/qr/:studentId - Get QR code for student
router.get('/qr/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const baseUrl = `${TUNNEL_URL}/student?id=${studentId}`;
    
    const qrDataUrl = await QRCode.toDataURL(baseUrl, {
      width: 300,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' }
    });

    res.json({ qrDataUrl, url: baseUrl, studentId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/journal/qr/batch - Generate QR codes for multiple students
router.post('/qr/batch', async (req, res) => {
  const session = req.driver.session();
  try {
    const { studentIds } = req.body;
    
    if (!studentIds || !Array.isArray(studentIds)) {
      return res.status(400).json({ error: 'studentIds array required' });
    }

    const results = [];
    const baseUrl = `${TUNNEL_URL}/student`;

    for (const studentId of studentIds) {
      const qrDataUrl = await QRCode.toDataURL(`${baseUrl}?id=${studentId}`, {
        width: 300,
        margin: 2,
        color: { dark: '#000000', light: '#FFFFFF' }
      });
      results.push({ studentId, qrDataUrl });
    }

    res.json({ success: true, qrcodes: results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// GET /api/journal/comments/:studentId - Get teacher comments for a student (student-facing)
router.get('/comments/:studentId', async (req, res) => {
  const session = req.driver.session();
  try {
    const { studentId } = req.params;

    const result = await session.run(`
      MATCH (tc:TeacherComment)-[:ABOUT_STUDENT]->(s:Student)
      WHERE s.studentId = $studentId OR s.id = $studentId
      RETURN tc.id AS id, tc.teacher_name AS teacherName,
             tc.comment AS comment, tc.focus AS focus, tc.week_label AS weekLabel,
             tc.is_read AS isRead, toString(tc.created_at) AS createdAt
      ORDER BY tc.created_at DESC
      LIMIT 10
    `, { studentId });

    const comments = result.records.map(r => ({
      id: r.get('id'),
      teacherName: r.get('teacherName'),
      comment: r.get('comment'),
      focus: r.get('focus'),
      weekLabel: r.get('weekLabel'),
      isRead: r.get('isRead'),
      createdAt: r.get('createdAt')
    }));

    res.json({ comments, count: comments.length, latest: comments[0] || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// POST /api/journal/comments - Teacher saves observation + next focus for a student.
// Always creates a new TeacherComment (history preserved); the latest one is the
// source of truth for both the teacher form (resume editing) and the student view.
router.post('/comments', async (req, res) => {
  const session = req.driver.session();
  try {
    const { studentId, comment, focus, teacherName, weekLabel } = req.body;
    if (!studentId) return res.status(400).json({ error: 'studentId is required' });
    if (!comment && !focus) return res.status(400).json({ error: 'comment or focus is required' });

    const commentId = uuidv4();
    const now = new Date().toISOString();

    const result = await session.run(`
      MATCH (s:Student {id: $studentId})
      CREATE (tc:TeacherComment {
        id: $id,
        comment: $comment,
        focus: $focus,
        teacher_name: $teacherName,
        week_label: $weekLabel,
        is_read: false,
        created_at: datetime($createdAt)
      })
      CREATE (tc)-[:ABOUT_STUDENT]->(s)
      RETURN tc.id AS id
    `, {
      studentId,
      id: commentId,
      comment: comment || '',
      focus: focus || '',
      teacherName: teacherName || 'Boonchu',
      weekLabel: weekLabel || '',
      createdAt: now
    });

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json({ success: true, commentId });
  } catch (error) {
    console.error('Save comment error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// POST /api/journal/comments/read - Mark comment as read (student confirms)
router.post('/comments/read', async (req, res) => {
  const session = req.driver.session();
  try {
    const { commentId } = req.body;
    if (!commentId) return res.status(400).json({ error: 'commentId is required' });

    await session.run(
      'MATCH (tc:TeacherComment {id: $commentId}) SET tc.is_read = true RETURN tc',
      { commentId }
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// GET /api/journal/history/:days - Get all self-assessments for last N days
router.get('/history/:days', async (req, res) => {
  const session = req.driver.session();
  try {
    const days = parseInt(req.params.days) || 7;
    const { isChinese } = req.query;
    
    let whereClause = '';
    if (isChinese === 'true') {
      whereClause = 'WHERE s.isChineseStudent = true';
    }

    const result = await session.run(`
      MATCH (s:Student)-[:HAS_SELF_ASSESSMENT]->(sa:SelfAssessment)
      ${whereClause}
      WITH s, sa
      WHERE sa.checkedInAt >= datetime() - duration({days: $days})
      RETURN s.id as studentId, s.name as studentName,
             s.isChineseStudent as isChineseStudent,
             coalesce(sa.location, s.location) as location,
             sa { .*, checkedInAt: toString(sa.checkedInAt) } as sa
      ORDER BY sa.checkedInAt DESC
    `, { days });

    const history = result.records.map(r => ({
      studentId: r.get('studentId'),
      studentName: r.get('studentName'),
      isChineseStudent: r.get('isChineseStudent'),
      location: r.get('location'),
      assessment: r.get('sa')
    }));

    res.json({ history, count: history.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

module.exports = router;
