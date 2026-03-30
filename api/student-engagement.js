/**
 * AYBKK Student Engagement API
 * Routes: /api/students, /api/checkin, /api/tags, /api/sessions, /api/reports
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// All routes use the shared Neo4j driver from server.js
// They expect `req.driver` to be set by the main server middleware

// ============================================
// STUDENT ROUTES
// ============================================

// GET /api/students - List all students
router.get('/students', async (req, res) => {
  const session = req.driver.session();
  try {
    const result = await session.run(`
      MATCH (s:Student)
      OPTIONAL MATCH (s)-[r]-(connected)
      WITH s, s.isActive as isActive, s.sortOrder as sortOrder,
           collect({type: type(r), node: connected}) as connections,
           [(s)-[:HAS_WEAKNESS]->(w:Tag) | w.name] as weaknesses,
           [(s)-[:HAS_STRENGTH]->(st:Tag) | st.name] as strengths,
           [(s)-[:INTERESTED_IN]->(i:Tag) | i.name] as interests
      RETURN s, connections, weaknesses, strengths, interests
      ORDER BY isActive DESC, sortOrder ASC
    `);
    
    const students = result.records.map(record => ({
      id: record.get('s').properties.id || record.get('s').identity.toString(),
      ...record.get('s').properties,
      weaknesses: record.get('weaknesses'),
      strengths: record.get('strengths'),
      interests: record.get('interests')
    }));
    
    res.json({ students, count: students.length });
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// GET /api/students/:id - Get single student
router.get('/students/:id', async (req, res) => {
  const session = req.driver.session();
  try {
    const result = await session.run(`
      MATCH (s:Student {id: $id})
      OPTIONAL MATCH (s)-[:HAS_WEAKNESS]->(w:Tag)
      OPTIONAL MATCH (s)-[:HAS_STRENGTH]->(st:Tag)
      OPTIONAL MATCH (s)-[:INTERESTED_IN]->(i:Tag)
      OPTIONAL MATCH (s)-[:CHECKED_IN]->(ses:Session)
      WITH s, collect(DISTINCT w.name) as weaknesses, collect(DISTINCT st.name) as strengths, 
           collect(DISTINCT i.name) as interests, collect(DISTINCT ses) as sessions
      RETURN s, weaknesses, strengths, interests, sessions
    `, { id: req.params.id });
    
    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    const record = result.records[0];
    res.json({
      id: record.get('s').properties.id,
      ...record.get('s').properties,
      weaknesses: record.get('weaknesses').filter(Boolean),
      strengths: record.get('strengths').filter(Boolean),
      interests: record.get('interests').filter(Boolean),
      sessions: record.get('sessions').filter(Boolean).map(s => s.properties)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// POST /api/students - Create new student
router.post('/students', async (req, res) => {
  const session = req.driver.session();
  try {
    const { name, email } = req.body;
    
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }
    
    const id = uuidv4();
    const phone = req.body.phone || '';
    const line_id = req.body.line_id || '';
    const wechat_id = req.body.wechat_id || '';
    const whatsapp = req.body.whatsapp || '';
    const instagram = req.body.instagram || '';
    const facebook = req.body.facebook || '';
    const platform = req.body.platform || 'line';
    
    const result = await session.run(`
      CREATE (s:Student {
        id: $id,
        name: $name,
        email: $email,
        phone: $phone,
        line_id: $line_id,
        wechat_id: $wechat_id,
        whatsapp: $whatsapp,
        instagram: $instagram,
        facebook: $facebook,
        platform: $platform,
        created_at: datetime()
      })
      RETURN s
    `, { id, name, email, phone, line_id, wechat_id, whatsapp, instagram, facebook, platform });
    
    res.status(201).json({ 
      success: true, 
      student: { id, name, email, ...req.body } 
    });
  } catch (error) {
    if (error.code === 'Neo.ClientError.Schema.ConstraintViolation') {
      return res.status(409).json({ error: 'Student with this email already exists' });
    }
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// PUT /api/students/:id - Update student
router.put('/students/:id', async (req, res) => {
  const session = req.driver.session();
  try {
    const { name, email, phone, line_id, wechat_id, whatsapp, instagram, facebook, platform } = req.body;
    
    const result = await session.run(`
      MATCH (s:Student {id: $id})
      SET s.name = COALESCE($name, s.name),
          s.email = COALESCE($email, s.email),
          s.phone = COALESCE($phone, s.phone),
          s.line_id = COALESCE($line_id, s.line_id),
          s.wechat_id = COALESCE($wechat_id, s.wechat_id),
          s.whatsapp = COALESCE($whatsapp, s.whatsapp),
          s.instagram = COALESCE($instagram, s.instagram),
          s.facebook = COALESCE($facebook, s.facebook),
          s.platform = COALESCE($platform, s.platform),
          s.updated_at = datetime()
      RETURN s
    `, { id: req.params.id, name, email, phone, line_id, wechat_id, whatsapp, instagram, facebook, platform });
    
    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    res.json({ success: true, student: result.records[0].get('s').properties });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// POST /api/students/:id/weaknesses - Add weakness tag
router.post('/students/:id/weaknesses', async (req, res) => {
  const session = req.driver.session();
  try {
    const { tagName } = req.body;
    
    const result = await session.run(`
      MATCH (s:Student {id: $studentId})
      MATCH (t:Tag {name: $tagName})
      MERGE (s)-[:HAS_WEAKNESS]->(t)
      RETURN s, t
    `, { studentId: req.params.id, tagName });
    
    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Student or Tag not found' });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// POST /api/students/:id/strengths - Add strength tag
router.post('/students/:id/strengths', async (req, res) => {
  const session = req.driver.session();
  try {
    const { tagName } = req.body;
    
    const result = await session.run(`
      MATCH (s:Student {id: $studentId})
      MATCH (t:Tag {name: $tagName})
      MERGE (s)-[:HAS_STRENGTH]->(t)
      RETURN s, t
    `, { studentId: req.params.id, tagName });
    
    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Student or Tag not found' });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// ============================================
// TAGS ROUTES
// ============================================

// GET /api/tags - List all tags
router.get('/tags', async (req, res) => {
  const session = req.driver.session();
  try {
    const { category } = req.query;
    
    let query = 'MATCH (t:Tag)';
    const params = {};
    
    if (category) {
      query += ' WHERE t.category = $category';
      params.category = category;
    }
    
    query += ' RETURN t ORDER BY t.category, t.name';
    
    const result = await session.run(query, params);
    
    const tags = result.records.map(record => record.get('t').properties);
    res.json({ tags, count: tags.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// GET /api/tags/:name/asanas - Get asanas that need this tag
router.get('/tags/:name/asanas', async (req, res) => {
  const session = req.driver.session();
  try {
    const result = await session.run(`
      MATCH (t:Tag {name: $tagName})-[:NEEDED_FOR]->(a:Asana)
      RETURN a ORDER BY a.name
    `, { tagName: req.params.name });
    
    const asanas = result.records.map(record => record.get('a').properties);
    res.json({ asanas, count: asanas.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// ============================================
// CHECK-IN ROUTES
// ============================================

// POST /api/checkin - Create a daily check-in
router.post('/checkin', async (req, res) => {
  const session = req.driver.session();
  try {
    const { studentId, className, mood, energy, note, tags } = req.body;
    
    if (!studentId) {
      return res.status(400).json({ error: 'studentId is required' });
    }
    
    const sessionId = uuidv4();
    const today = new Date().toISOString().split('T')[0];
    
    // Create session
    await session.run(`
      MATCH (s:Student {id: $studentId})
      CREATE (ses:Session {
        id: $sessionId,
        date: date($today),
        class_name: $className,
        mood: $mood,
        energy: $energy,
        note: $note,
        completed: true,
        created_at: datetime()
      })
      CREATE (s)-[:CHECKED_IN]->(ses)
      RETURN ses
    `, { studentId, sessionId, today, className, mood, energy, note });
    
    // Link tags if provided
    if (tags && tags.length > 0) {
      for (const tagName of tags) {
        await session.run(`
          MATCH (ses:Session {id: $sessionId})
          MATCH (t:Tag {name: $tagName})
          MERGE (ses)-[:TAGGED_WITH]->(t)
        `, { sessionId, tagName });
      }
    }
    
    res.status(201).json({ 
      success: true, 
      sessionId,
      message: 'Check-in recorded! See you Sunday for your weekly summary 📝'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// GET /api/checkin/:studentId/week - Get this week's check-ins
router.get('/checkin/:studentId/week', async (req, res) => {
  const session = req.driver.session();
  try {
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay()); // Sunday
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6); // Saturday
    
    const result = await session.run(`
      MATCH (s:Student {id: $studentId})-[r:CHECKED_IN]->(ses:Session)
      WHERE ses.date >= date($weekStart) AND ses.date <= date($weekEnd)
      WITH ses ORDER BY ses.date
      OPTIONAL MATCH (ses)-[:TAGGED_WITH]->(t:Tag)
      RETURN ses, collect(t.name) as tags
    `, { 
      studentId: req.params.studentId, 
      weekStart: weekStart.toISOString().split('T')[0],
      weekEnd: weekEnd.toISOString().split('T')[0]
    });
    
    const checkins = result.records.map(record => ({
      ...record.get('ses').properties,
      tags: record.get('tags').filter(Boolean)
    }));
    
    res.json({ checkins, count: checkins.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// GET /api/checkin/:studentId/stats - Get student's stats
router.get('/checkin/:studentId/stats', async (req, res) => {
  const session = req.driver.session();
  try {
    const { days = 30 } = req.query;
    const since = new Date();
    since.setDate(since.getDate() - parseInt(days));
    
    const result = await session.run(`
      MATCH (s:Student {id: $studentId})-[r:CHECKED_IN]->(ses:Session)
      WHERE ses.date >= date($since)
      WITH ses ORDER BY ses.date
      OPTIONAL MATCH (ses)-[:TAGGED_WITH]->(t:Tag)
      WITH ses, collect(t.name) as tags
      RETURN 
        count(ses) as total_sessions,
        avg(ses.energy) as avg_energy,
        collect(ses.mood) as moods,
        [tag IN tags WHERE tag IS NOT NULL] as all_tags
    `, { studentId: req.params.studentId, since: since.toISOString().split('T')[0] });
    
    if (result.records.length === 0) {
      return res.json({ 
        total_sessions: 0, 
        avg_energy: 0, 
        moods: [], 
        top_weaknesses: [],
        top_strengths: []
      });
    }
    
    const record = result.records[0];
    const allTags = record.get('all_tags').flat();
    
    // Count tag frequencies
    const tagCounts = {};
    allTags.forEach(tag => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
    
    // Separate by category (basic approach)
    const weaknessTags = Object.entries(tagCounts)
      .filter(([name]) => ['forwardBend', 'backbend', 'hipOpening', 'shoulderMobility', 'coreStrength', 'balance', 'twist', 'inversions', 'breathControl', 'bandha'].includes(name))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name);
    
    res.json({
      total_sessions: record.get('total_sessions').toNumber(),
      avg_energy: Math.round(record.get('avg_energy') || 0),
      moods: record.get('moods'),
      top_weaknesses: weaknessTags,
      consistency: Math.round((record.get('total_sessions').toNumber() / parseInt(days)) * 100)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// ============================================
// COURSES ROUTES
// ============================================

// GET /api/courses - List all courses
router.get('/courses', async (req, res) => {
  const session = req.driver.session();
  try {
    const result = await session.run(`
      MATCH (c:Course)
      OPTIONAL MATCH (c)-[:TARGETED_TO]->(t:Tag)
      RETURN c, collect(t.name) as tags
    `);
    
    const courses = result.records.map(record => ({
      ...record.get('c').properties,
      tags: record.get('tags').filter(Boolean)
    }));
    
    res.json({ courses, count: courses.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// POST /api/courses - Create a course
router.post('/courses', async (req, res) => {
  const session = req.driver.session();
  try {
    const { id, title, description, url, tags } = req.body;
    
    if (!id || !title) {
      return res.status(400).json({ error: 'id and title are required' });
    }
    
    await session.run(`
      CREATE (c:Course {
        id: $id,
        title: $title,
        description: $description,
        url: $url,
        created_at: datetime()
      })
    `, { id, title, description, url });
    
    // Link tags
    if (tags && tags.length > 0) {
      for (const tagName of tags) {
        await session.run(`
          MATCH (c:Course {id: $courseId})
          MATCH (t:Tag {name: $tagName})
          MERGE (c)-[:TARGETED_TO]->(t)
        `, { courseId: id, tagName });
      }
    }
    
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// GET /api/courses/recommend/:studentId - Get course recommendation for student
router.get('/courses/recommend/:studentId', async (req, res) => {
  const session = req.driver.session();
  try {
    // Get student's weaknesses and interests
    const studentResult = await session.run(`
      MATCH (s:Student {id: $studentId})
      OPTIONAL MATCH (s)-[:HAS_WEAKNESS]->(w:Tag)
      OPTIONAL MATCH (s)-[:HAS_STRENGTH]->(st:Tag)
      OPTIONAL MATCH (s)-[:INTERESTED_IN]->(i:Tag)
      RETURN collect(DISTINCT w.name) as weaknesses, 
             collect(DISTINCT st.name) as strengths,
             collect(DISTINCT i.name) as interests
    `, { studentId: req.params.studentId });
    
    if (studentResult.records.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    const record = studentResult.records[0];
    const studentTags = [
      ...record.get('weaknesses').filter(Boolean),
      ...record.get('interests').filter(Boolean)
    ];
    
    if (studentTags.length === 0) {
      return res.json({ recommendation: null, reason: 'No profile data yet' });
    }
    
    // Find courses matching student's tags
    const courseResult = await session.run(`
      MATCH (c:Course)-[:TARGETED_TO]->(t:Tag)
      WHERE t.name IN $studentTags
      WITH c, collect(t.name) as matching_tags, count(t) as match_score
      RETURN c, matching_tags, match_score
      ORDER BY match_score DESC
      LIMIT 1
    `, { studentTags });
    
    if (courseResult.records.length === 0) {
      return res.json({ recommendation: null, reason: 'No matching courses found' });
    }
    
    const course = courseResult.records[0].get('c').properties;
    const matchingTags = courseResult.records[0].get('matching_tags');
    
    res.json({
      recommendation: {
        ...course,
        matching_tags: matchingTags
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// ============================================
// WEEKLY REPORT ROUTES
// ============================================

// GET /api/reports/generate/:studentId - Generate weekly report (for AI input)
router.get('/reports/generate/:studentId', async (req, res) => {
  const session = req.driver.session();
  try {
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    
    // Get student info
    const studentResult = await session.run(`
      MATCH (s:Student {id: $studentId})
      RETURN s.name as name, s.email as email
    `, { studentId: req.params.studentId });
    
    if (studentResult.records.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    const studentName = studentResult.records[0].get('name');
    
    // Get week's check-ins
    const checkinResult = await session.run(`
      MATCH (s:Student {id: $studentId})-[r:CHECKED_IN]->(ses:Session)
      WHERE ses.date >= date($weekStart) AND ses.date <= date($weekEnd)
      WITH ses ORDER BY ses.date
      OPTIONAL MATCH (ses)-[:TAGGED_WITH]->(t:Tag)
      RETURN ses.date as date, ses.class_name as className, ses.mood as mood, 
             ses.energy as energy, ses.note as note, collect(t.name) as tags
      ORDER BY ses.date
    `, { 
      studentId: req.params.studentId,
      weekStart: weekStart.toISOString().split('T')[0],
      weekEnd: weekEnd.toISOString().split('T')[0]
    });
    
    const checkins = checkinResult.records.map(record => ({
      date: record.get('date').toString(),
      className: record.get('className'),
      mood: record.get('mood'),
      energy: record.get('energy'),
      note: record.get('note'),
      tags: record.get('tags').filter(Boolean)
    }));
    
    // Get student's profile
    const profileResult = await session.run(`
      MATCH (s:Student {id: $studentId})
      OPTIONAL MATCH (s)-[:HAS_WEAKNESS]->(w:Tag)
      OPTIONAL MATCH (s)-[:HAS_STRENGTH]->(st:Tag)
      RETURN collect(DISTINCT w.name) as weaknesses, collect(DISTINCT st.name) as strengths
    `, { studentId: req.params.studentId });
    
    const profile = profileResult.records[0];
    
    res.json({
      student: {
        name: studentName,
        weaknesses: profile.get('weaknesses').filter(Boolean),
        strengths: profile.get('strengths').filter(Boolean)
      },
      week: {
        start: weekStart.toISOString().split('T')[0],
        end: weekEnd.toISOString().split('T')[0]
      },
      checkins,
      raw_data: true // Flag for AI to know this is structured data
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// GET /api/students/:id/progress - Get progress history for a student
router.get('/students/:id/progress', async (req, res) => {
  const session = req.driver.session();
  try {
    let studentId = req.params.id;
    // Parse numeric ID for Neo4j internal id lookup
    let neo4jId = studentId;
    if (/^\d+$/.test(studentId)) {
      neo4jId = parseInt(studentId, 10);
    }

    // Get student by Neo4j internal id
    const studentResult = await session.run(`
      MATCH (s) WHERE id(s) = $neo4jId AND s:Student
      RETURN s.name as name
    `, { neo4jId });
    
    if (studentResult.records.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    const studentName = studentResult.records[0].get('name');
    
    // Get progress checks
    const progressResult = await session.run(`
      MATCH (s) WHERE id(s) = $neo4jId AND s:Student
      MATCH (s)-[r:HAS_PROGRESS_CHECK]->(p:ProgressCheck)
      RETURN p ORDER BY p.checkDate ASC
    `, { neo4jId });
    
    const progressChecks = progressResult.records.map(record => {
      const props = record.get('p').properties;
      return {
        id: props.id,
        checkDate: props.checkDate,
        attributes: {
          posture: props.posture || 0,
          breathing: props.breathing || 0,
          flexibility: props.flexibility || 0,
          strength: props.strength || 0,
          balance: props.balance || 0,
          focus: props.focus || 0
        },
        notes: props.notes || '',
        workshop: props.workshop || ''
      };
    });
    
    res.json({
      studentId,
      studentName,
      progressChecks
    });
  } catch (error) {
    console.error('Error fetching progress:', error);
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// POST /api/students/:id/progress-check - Add a new progress check
router.post('/students/:id/progress-check', async (req, res) => {
  const session = req.driver.session();
  try {
    const studentId = req.params.id;
    const {
      posture = 0,
      breathing = 0,
      flexibility = 0,
      strength = 0,
      balance = 0,
      focus = 0,
      notes = '',
      workshop = ''
    } = req.body;
    
    // Verify student exists
    const studentCheck = await session.run(`
      MATCH (s:Student {id: $studentId})
      RETURN s.id as id
    `, { studentId });
    
    if (studentCheck.records.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    const progressId = uuidv4();
    const checkDate = new Date().toISOString();
    
    // Create progress check node and relationship
    await session.run(`
      MATCH (s:Student {id: $studentId})
      CREATE (p:ProgressCheck {
        id: $progressId,
        checkDate: $checkDate,
        posture: $posture,
        breathing: $breathing,
        flexibility: $flexibility,
        strength: $strength,
        balance: $balance,
        focus: $focus,
        notes: $notes,
        workshop: $workshop,
        createdAt: datetime()
      })
      CREATE (s)-[:HAS_PROGRESS_CHECK]->(p)
      RETURN p
    `, { studentId, progressId, checkDate, posture, breathing, flexibility, strength, balance, focus, notes, workshop });
    
    res.status(201).json({
      success: true,
      progressCheck: {
        id: progressId,
        checkDate,
        attributes: { posture, breathing, flexibility, strength, balance, focus },
        notes,
        workshop
      }
    });
  } catch (error) {
    console.error('Error creating progress check:', error);
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

module.exports = router;
