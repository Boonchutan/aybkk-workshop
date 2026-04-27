/**
 * AYBKK Teacher Assessment API
 * Save teacher assessments from web form
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// POST /api/teacher/assessment - Save teacher assessment
router.post('/assessment', async (req, res) => {
  const session = req.driver.session();
  try {
    const {
      studentId,
      studentName,
      teacherName,
      strengths,
      weaknesses,
      energy,
      behavior,
      lastAsana,
      lastAsanaPass,
      toFix,
      notes
    } = req.body;

    if (!studentId) return res.status(400).json({ error: 'studentId is required' });
    if (!teacherName) return res.status(400).json({ error: 'teacherName is required' });

    const assessmentId = uuidv4();
    const now = new Date().toISOString();

    // MERGE student — creates Neo4j node if first time assessing a booking-system student
    const mergeResult = await session.run(`
      MERGE (s:Student {pgId: $pgId})
      ON CREATE SET s.id = $pgId, s.name = $name, s.pgId = $pgId, s.createdAt = datetime($now)
      ON MATCH SET s.name = COALESCE(s.name, $name)
      CREATE (a:Assessment {
        id: $id,
        teacher_name: $teacherName,
        energy_level: $energy,
        practice_behavior: $behavior,
        last_asana: $lastAsana,
        last_asana_pass: $lastAsanaPass,
        to_fix_now: $toFix,
        notes: $notes,
        strengths: $strengths,
        weaknesses: $weaknesses,
        created_at: datetime($now)
      })
      CREATE (a)-[:FOR_STUDENT]->(s)
      RETURN s.name AS resolvedName
    `, {
      pgId: studentId.toString(),
      name: studentName || '',
      id: assessmentId,
      teacherName,
      energy: energy || '',
      behavior: behavior || '',
      lastAsana: lastAsana || '',
      lastAsanaPass: lastAsanaPass || '',
      toFix: toFix || '',
      notes: notes || '',
      strengths: strengths || [],
      weaknesses: weaknesses || [],
      now
    });

    const resolvedName = mergeResult.records[0]?.get('resolvedName') || studentName || '';
    res.json({ success: true, assessmentId, studentName: resolvedName, createdAt: now });

  } catch (error) {
    console.error('Teacher assessment error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// GET /api/teacher/assessment/:studentId - Get assessment history for student
router.get('/assessment/:studentId', async (req, res) => {
  const session = req.driver.session();
  try {
    const { studentId } = req.params;
    
    const result = await session.run(`
      MATCH (a:Assessment)-[:FOR_STUDENT]->(s:Student)
      WHERE s.studentId = $studentId OR s.id = $studentId OR s.pgId = $studentId
      RETURN a.id AS id, a.teacher_name AS teacherName,
             a.energy_level AS energy, a.practice_behavior AS behavior,
             a.last_asana AS lastAsana, a.last_asana_pass AS lastAsanaPass,
             a.to_fix_now AS toFix, a.notes AS notes,
             a.strengths AS strengths, a.weaknesses AS weaknesses,
             a.created_at AS createdAt
      ORDER BY a.created_at DESC
      LIMIT 100
    `, { studentId });

    const assessments = result.records.map(r => ({
      id: r.get('id'),
      teacherName: r.get('teacherName'),
      energy: r.get('energy'),
      behavior: r.get('behavior'),
      lastAsana: r.get('lastAsana'),
      lastAsanaPass: r.get('lastAsanaPass'),
      toFix: r.get('toFix'),
      notes: r.get('notes'),
      strengths: r.get('strengths') || [],
      weaknesses: r.get('weaknesses') || [],
      createdAt: r.get('createdAt')
    }));

    res.json({ assessments, count: assessments.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// GET /api/teacher/students - Get students list for teacher
router.get('/students', async (req, res) => {
  const session = req.driver.session();
  try {
    const classTypeParam = req.query.classType;
    const dateParam = req.query.date; // YYYY-MM-DD format
    let query;
    let params = {};

    if (classTypeParam) {
      // Support comma-separated: classType=chinese-workshop,in-depth-mysore-cn2
      const types = classTypeParam.split(',').map(t => t.trim());
      if (dateParam) {
        // Filter by today's attendance
        params.classType = types[0];
        params.date = dateParam;
        query = `
          MATCH (s:Student)-[att:ATTENDED]->(c:Class)
          WHERE s.name IS NOT NULL AND att.date = date($date)
          RETURN DISTINCT s.id AS studentId, s.id AS id, s.name AS name,
                 s.phone AS phone, s.email AS email,
                 0 AS assessmentCount, null AS lastAssessment
          ORDER BY s.name ASC
          LIMIT 200
        `;
      } else if (types.length === 1) {
        params.classType = types[0];
        query = `
          MATCH (s:Student)
          WHERE s.name IS NOT NULL AND s.classType = $classType
          OPTIONAL MATCH (a:Assessment)-[:FOR_STUDENT]->(s)
          WITH s, count(a) AS assessmentCount, max(a.created_at) AS lastAssessment
          WHERE s.isActive = true OR s.isActive IS NULL
          RETURN s.studentId AS studentId, s.id AS id, s.name AS name,
                 s.phone AS phone, s.email AS email,
                 assessmentCount, lastAssessment
          ORDER BY s.name ASC
          LIMIT 200
        `;
      } else {
        params.types = types;
        query = `
          MATCH (s:Student)
          WHERE s.name IS NOT NULL AND s.classType IN $types
          OPTIONAL MATCH (a:Assessment)-[:FOR_STUDENT]->(s)
          WITH s, count(a) AS assessmentCount, max(a.created_at) AS lastAssessment
          WHERE s.isActive = true OR s.isActive IS NULL
          RETURN s.studentId AS studentId, s.id AS id, s.name AS name,
                 s.phone AS phone, s.email AS email,
                 assessmentCount, lastAssessment
          ORDER BY s.name ASC
          LIMIT 200
        `;
      }
    } else {
      query = `
        MATCH (s:Student)
        WHERE s.name IS NOT NULL
        OPTIONAL MATCH (a:Assessment)-[:FOR_STUDENT]->(s)
        WITH s, count(a) AS assessmentCount, max(a.created_at) AS lastAssessment
        WHERE s.isActive = true OR s.isActive IS NULL
        RETURN s.studentId AS studentId, s.id AS id, s.name AS name,
               s.phone AS phone, s.email AS email,
               assessmentCount, lastAssessment
        ORDER BY s.name ASC
        LIMIT 200
      `;
    }

    const result = await session.run(query, params);

    const students = result.records.map(r => ({
      studentId: r.get('studentId') || r.get('id'),
      name: r.get('name'),
      phone: r.get('phone'),
      email: r.get('email'),
      assessmentCount: r.get('assessmentCount')?.toNumber() || 0,
      lastAssessment: r.get('lastAssessment')
    }));

    res.json({ students, count: students.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// GET /api/teacher/tags - Get available strength/weakness tags
router.get('/tags', async (req, res) => {
  const session = req.driver.session();
  try {
    const result = await session.run(`
      MATCH (t:Tag)
      RETURN t.name AS name, t.type AS type
      ORDER BY t.type, t.name
    `);

    const tags = result.records.map(r => ({
      name: r.get('name'),
      type: r.get('type')
    }));

    const strengths = tags.filter(t => t.type === 'strength').map(t => t.name);
    const weaknesses = tags.filter(t => t.type === 'weakness').map(t => t.name);

    res.json({ strengths, weaknesses, count: tags.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// GET /api/teacher/today - Get today's assessment count
router.get('/today', async (req, res) => {
  const session = req.driver.session();
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const result = await session.run(`
      MATCH (a:Assessment)
      WHERE a.created_at >= datetime($date)
      RETURN count(a) AS count,
             collect(DISTINCT a.teacher_name) AS teachers
    `, { date: `${today}T00:00:00` });

    const record = result.records[0];
    res.json({
      count: record.get('count')?.toNumber() || 0,
      teachers: record.get('teachers').filter(Boolean)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// POST /api/teacher/comment - Teacher writes a comment for a student
router.post('/comment', async (req, res) => {
  const session = req.driver.session();
  try {
    const { studentId, teacherName, comment, weekLabel } = req.body;

    if (!studentId) return res.status(400).json({ error: 'studentId is required' });
    if (!teacherName) return res.status(400).json({ error: 'teacherName is required' });
    if (!comment || !comment.trim()) return res.status(400).json({ error: 'comment is required' });

    const commentId = uuidv4();
    const now = new Date().toISOString();
    const week = weekLabel || `Week of ${now.split('T')[0]}`;

    // Check student exists
    const studentResult = await session.run(
      'MATCH (s:Student) WHERE s.studentId = $studentId OR s.id = $studentId RETURN s',
      { studentId }
    );
    if (studentResult.records.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const studentNode = studentResult.records[0].get('s');
    const actualStudentId = studentNode.properties.studentId || studentNode.properties.id;

    // Create TeacherComment node
    await session.run(`
      MATCH (s:Student)
      WHERE s.studentId = $studentId OR s.id = $studentId
      CREATE (tc:TeacherComment {
        id: $id,
        teacher_name: $teacherName,
        comment: $comment,
        week_label: $weekLabel,
        is_read: false,
        created_at: datetime($createdAt)
      })
      CREATE (tc)-[:ABOUT_STUDENT]->(s)
      RETURN tc.id AS id
    `, {
      id: commentId,
      studentId: actualStudentId,
      teacherName,
      comment: comment.trim(),
      weekLabel: week,
      createdAt: now
    });

    res.json({
      success: true,
      commentId,
      studentName: studentNode.properties.name,
      createdAt: now
    });
  } catch (error) {
    console.error('Teacher comment error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// GET /api/teacher/comments/:studentId - Get teacher comments for a student
router.get('/comments/:studentId', async (req, res) => {
  const session = req.driver.session();
  try {
    const { studentId } = req.params;

    const result = await session.run(`
      MATCH (tc:TeacherComment)-[:ABOUT_STUDENT]->(s:Student)
      WHERE s.studentId = $studentId OR s.id = $studentId
      RETURN tc.id AS id, tc.teacher_name AS teacherName,
             tc.comment AS comment, tc.week_label AS weekLabel,
             tc.is_read AS isRead, tc.created_at AS createdAt
      ORDER BY tc.created_at DESC
      LIMIT 20
    `, { studentId });

    const comments = result.records.map(r => ({
      id: r.get('id'),
      teacherName: r.get('teacherName'),
      comment: r.get('comment'),
      weekLabel: r.get('weekLabel'),
      isRead: r.get('isRead'),
      createdAt: r.get('createdAt')
    }));

    res.json({ comments, count: comments.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// POST /api/teacher/comment/read - Mark comment as read
router.post('/comment/read', async (req, res) => {
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

// POST /api/workshop/orientation - Save student orientation profile
router.post('/orientation', async (req, res) => {
  const session = req.driver.session();
  try {
    const { englishName, chineseName, city, yearsPractice, lastAsana, difficulties, injury, classType } = req.body;
    
    if (!englishName) {
      return res.status(400).json({ ok: false, error: 'English name is required' });
    }

    // Try to match existing student by name
    const matchResult = await session.run(`
      MATCH (s:Student)
      WHERE toLower(s.name) CONTAINS toLower($name) AND s.classType = $ct
      RETURN s.id AS id, s.membershipNo AS mn
      LIMIT 1
    `, { name: englishName, ct: classType || 'chinese-workshop' });

    let studentId;
    if (matchResult.records.length > 0) {
      studentId = matchResult.records[0].get('id') || matchResult.records[0].get('mn');
      // Update existing student
      await session.run(`
        MATCH (s:Student)
        WHERE s.id = $id OR s.membershipNo = $id
        SET s.englishName = $en,
            s.chineseName = $cn,
            s.city = $city,
            s.yearsPractice = $yp,
            s.lastAsana = $la,
            s.difficulties = $diff,
            s.injury = $inj,
            s.oriented = true,
            s.orientedAt = datetime()
      `, {
        id: studentId,
        en: englishName,
        cn: chineseName || '',
        city: city || '',
        yp: yearsPractice || '',
        la: lastAsana || '',
        diff: difficulties || [],
        inj: injury || ''
      });
    } else {
      // Create new student
      studentId = 'ws-' + Date.now().toString(36);
      await session.run(`
        CREATE (s:Student {
          id: $id,
          name: $name,
          englishName: $en,
          chineseName: $cn,
          city: $city,
          yearsPractice: $yp,
          lastAsana: $la,
          difficulties: $diff,
          injury: $inj,
          classType: $ct,
          oriented: true,
          orientedAt: datetime()
        })
      `, {
        id: studentId,
        name: englishName,
        en: englishName,
        cn: chineseName || '',
        city: city || '',
        yp: yearsPractice || '',
        la: lastAsana || '',
        diff: difficulties || [],
        inj: injury || '',
        ct: classType || 'chinese-workshop'
      });
    }

    res.json({ ok: true, studentId });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    await session.close();
  }
});

module.exports = router;
