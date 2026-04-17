const express = require('express');
const router = express.Router();

function parseIntVal(val) {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (val.low !== undefined) return val.low;
  return parseInt(val);
}

// GET /api/mindmap/tree — full tree: structures -> stages -> asanas
router.get('/tree', async (req, res) => {
  const session = req.driver.session();
  try {
    const result = await session.run(`
      MATCH (ts:TeachingStructure)
      OPTIONAL MATCH (ts)-[:HAS_STAGE]->(stage:TeachingStage)
      OPTIONAL MATCH (stage)-[:TEACHES]->(a:Asana)
      OPTIONAL MATCH (a)-[:IN_SECTION]->(sec:Section)
      WITH ts, stage, a, sec
      ORDER BY ts.series, stage.name, a.name
      WITH ts, stage,
        collect({
          name: a.name,
          englishName: a.englishName,
          vinyasaCount: a.vinyasaCount,
          section: sec.name
        }) as asanas
      WITH ts, collect({
        name: stage.name,
        description: stage.description,
        asanas: asanas
      }) as stages
      RETURN ts.name as structureName, ts.series as series, stages
      ORDER BY
        CASE ts.series
          WHEN 'primary' THEN 0
          WHEN 'intermediate' THEN 1
          WHEN 'advance-a' THEN 2
          WHEN 'advance-b' THEN 3
          ELSE 4
        END
    `);

    const structures = result.records.map(record => {
      const stages = (record.get('stages') || [])
        .filter(s => s.name !== null)
        .map(s => ({
          name: s.name,
          description: s.description || '',
          asanas: (s.asanas || []).filter(a => a.name !== null)
        }));
      return {
        name: record.get('structureName'),
        series: record.get('series'),
        stages
      };
    });

    res.json({ structures });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// GET /api/mindmap/asanas — all asanas with tags
router.get('/asanas', async (req, res) => {
  const session = req.driver.session();
  try {
    const result = await session.run(`
      MATCH (stage:TeachingStage)-[:TEACHES]->(a:Asana)
      OPTIONAL MATCH (ts:TeachingStructure)-[:HAS_STAGE]->(stage)
      OPTIONAL MATCH (a)-[:INVOLVES]->(tag:Tag)
      OPTIONAL MATCH (a)-[:IN_SECTION]->(sec:Section)
      RETURN
        a.name as name,
        a.englishName as englishName,
        a.vinyasaCount as vinyasaCount,
        stage.name as stage,
        ts.series as series,
        sec.name as section,
        collect(DISTINCT tag.name) as tags
      ORDER BY a.name
    `);

    const asanas = result.records.map(r => ({
      name: r.get('name'),
      englishName: r.get('englishName'),
      vinyasaCount: parseIntVal(r.get('vinyasaCount')),
      stage: r.get('stage'),
      series: r.get('series'),
      section: r.get('section'),
      tags: (r.get('tags') || []).filter(t => t !== null)
    }));

    res.json({ asanas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// GET /api/mindmap/tags — all tags (actions) with asanas
router.get('/tags', async (req, res) => {
  const session = req.driver.session();
  try {
    const result = await session.run(`
      MATCH (tag:Tag)<-[:INVOLVES]-(a:Asana)
      RETURN
        tag.name as tagName,
        count(DISTINCT a) as asanaCount,
        collect(DISTINCT a.name) as asanas
      ORDER BY tagName
    `);

    const tags = result.records.map(r => ({
      name: r.get('tagName'),
      asanaCount: parseIntVal(r.get('asanaCount')),
      asanas: (r.get('asanas') || []).filter(a => a !== null)
    }));

    res.json({ tags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// GET /api/mindmap/students — all students (from PostgreSQL booking DB when available)
router.get('/students', async (req, res) => {
  // Prefer PostgreSQL — it has all 700+ real students
  if (req.pg) {
    try {
      const result = await req.pg.query(`
        SELECT s.id::text AS id, s.name,
               count(je.id) AS session_count,
               max(je.session_date) AS last_date
        FROM students s
        LEFT JOIN journal_entries je ON je.student_id = s.id
        WHERE s.name IS NOT NULL AND s.name != ''
        GROUP BY s.id, s.name
        ORDER BY s.name ASC
      `);
      const students = result.rows.map(r => ({
        id: r.id,
        name: r.name,
        sessionCount: parseInt(r.session_count) || 0,
        lastDate: r.last_date ? r.last_date.toISOString().substring(0, 10) : null
      }));
      return res.json({ students, source: 'postgres' });
    } catch (err) {
      console.error('PG students error:', err.message);
      // fall through to Neo4j
    }
  }

  // Fallback: Neo4j
  const session = req.driver.session();
  try {
    const result = await session.run(`
      MATCH (s:Student)
      WHERE s.isActive = true
      OPTIONAL MATCH (s)-[:HAS_SELF_ASSESSMENT]->(sa:SelfAssessment)
      WITH s, count(sa) as sessionCount, max(sa.sessionDate) as lastDate
      RETURN s.id as id, s.name as name, s.isChineseStudent as isChinese,
             sessionCount, lastDate
      ORDER BY s.name ASC
    `);
    const students = result.records.map(r => ({
      id: r.get('id'),
      name: r.get('name'),
      sessionCount: parseIntVal(r.get('sessionCount')),
      lastDate: r.get('lastDate')
    }));
    res.json({ students, source: 'neo4j' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// GET /api/mindmap/student-data/:studentId — student intelligence data
// Uses PostgreSQL when available (booking system DB), falls back to Neo4j
router.get('/student-data/:studentId', async (req, res) => {
  const { studentId } = req.params;

  const toArray = (val) => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') return val.split(',').map(s => s.trim()).filter(Boolean);
    return [];
  };

  const aggregateSkills = (sessions) => {
    const skills = {};
    sessions.forEach(s => {
      toArray(s.stable).forEach(tag => {
        if (!skills[tag]) skills[tag] = { stable: 0, difficult: 0 };
        skills[tag].stable++;
      });
      toArray(s.difficult).forEach(tag => {
        if (!skills[tag]) skills[tag] = { stable: 0, difficult: 0 };
        skills[tag].difficult++;
      });
    });
    return skills;
  };

  // Try PostgreSQL first
  if (req.pg) {
    try {
      // Get student
      const studentRes = await req.pg.query(
        'SELECT id, name FROM students WHERE id = $1',
        [parseInt(studentId)]
      );
      if (studentRes.rows.length === 0) {
        // ID might be a UUID (Neo4j) — fall through
      } else {
        const student = studentRes.rows[0];

        // Get journal entries
        const entriesRes = await req.pg.query(`
          SELECT session_date, vinyasa, bandha,
                 stable_today, difficult_today,
                 last_asana_note, practice_notes
          FROM journal_entries
          WHERE student_id = $1
          ORDER BY session_date DESC NULLS LAST
        `, [student.id]);

        const sessions = entriesRes.rows.map(r => ({
          date: r.session_date ? r.session_date.toISOString().substring(0, 10) : null,
          vinyasa: r.vinyasa,
          bandha: r.bandha,
          stable: toArray(r.stable_today),
          difficult: toArray(r.difficult_today),
          lastAsana: r.last_asana_note || null,
          notes: r.practice_notes || null
        }));

        const lastAsana = sessions.find(s => s.lastAsana && s.lastAsana.trim())?.lastAsana || null;
        const skills = aggregateSkills(sessions);

        // Also fetch teacher notes
        const notesRes = await req.pg.query(
          'SELECT comment, focus FROM teacher_notes WHERE student_id = $1',
          [student.id]
        );
        const teacherNote = notesRes.rows[0] || null;

        return res.json({
          student: {
            id: student.id.toString(),
            name: student.name,
            totalSessions: sessions.length
          },
          lastAsana,
          skills,
          sessions,
          teacherNote,
          source: 'postgres'
        });
      }
    } catch (err) {
      console.error('PG student-data error:', err.message);
      // fall through to Neo4j
    }
  }

  // Fallback: Neo4j
  const session = req.driver.session();
  try {
    const result = await session.run(`
      MATCH (s:Student {id: $id})
      OPTIONAL MATCH (s)-[:HAS_SELF_ASSESSMENT]->(sa:SelfAssessment)
      WITH s, sa ORDER BY sa.checkedInAt DESC
      RETURN s.id as id, s.name as name, s.isChineseStudent as isChinese,
             collect({
               stableToday: sa.stableToday,
               difficultToday: sa.difficultToday,
               lastAsana: sa.lastAsana,
               sessionDate: sa.sessionDate,
               vinyasa: sa.vinyasa,
               bandha: sa.bandha,
               practiceNotes: sa.practiceNotes,
               lastAsanaNote: sa.lastAsanaNote
             }) as sessions
    `, { id: studentId });

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const record = result.records[0];
    const rawSessions = (record.get('sessions') || []).filter(s => s.vinyasa !== null);

    const mappedSessions = rawSessions.slice(0, 10).map(s => ({
      date: s.sessionDate,
      vinyasa: s.vinyasa,
      bandha: s.bandha,
      stable: toArray(s.stableToday),
      difficult: toArray(s.difficultToday),
      lastAsana: s.lastAsana || null,
      notes: s.practiceNotes || s.lastAsanaNote || null
    }));

    const lastAsana = mappedSessions.find(s => s.lastAsana && s.lastAsana.trim())?.lastAsana || null;

    res.json({
      student: {
        id: record.get('id'),
        name: record.get('name'),
        isChinese: record.get('isChinese'),
        totalSessions: rawSessions.length
      },
      lastAsana,
      skills: aggregateSkills(mappedSessions),
      sessions: mappedSessions,
      source: 'neo4j'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// GET /api/mindmap/search?q= — search asanas
router.get('/search', async (req, res) => {
  const session = req.driver.session();
  const query = req.query.q || '';
  try {
    const result = await session.run(`
      MATCH (a:Asana)
      WHERE toLower(a.name) CONTAINS toLower($query) OR toLower(a.englishName) CONTAINS toLower($query)
      OPTIONAL MATCH (stage:TeachingStage)-[:TEACHES]->(a)
      OPTIONAL MATCH (ts:TeachingStructure)-[:HAS_STAGE]->(stage)
      OPTIONAL MATCH (a)-[:INVOLVES]->(tag:Tag)
      OPTIONAL MATCH (a)-[:IN_SECTION]->(sec:Section)
      RETURN
        a.name as name,
        a.englishName as englishName,
        a.vinyasaCount as vinyasaCount,
        stage.name as stage,
        ts.series as series,
        sec.name as section,
        collect(DISTINCT tag.name) as tags
      ORDER BY a.name
      LIMIT 20
    `, { query });

    const asanas = result.records.map(r => ({
      name: r.get('name'),
      englishName: r.get('englishName'),
      vinyasaCount: parseIntVal(r.get('vinyasaCount')),
      stage: r.get('stage'),
      series: r.get('series'),
      section: r.get('section'),
      tags: (r.get('tags') || []).filter(t => t !== null)
    }));

    res.json({ asanas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// GET /api/mindmap/tag/:tagName — get asanas by tag
router.get('/tag/:tagName', async (req, res) => {
  const session = req.driver.session();
  const tagName = req.params.tagName;
  try {
    const result = await session.run(`
      MATCH (tag:Tag)<-[:INVOLVES]-(a:Asana)
      WHERE tag.name = $tagName
      OPTIONAL MATCH (stage:TeachingStage)-[:TEACHES]->(a)
      OPTIONAL MATCH (ts:TeachingStructure)-[:HAS_STAGE]->(stage)
      RETURN
        a.name as name,
        a.englishName as englishName,
        a.vinyasaCount as vinyasaCount,
        stage.name as stage,
        ts.series as series,
        collect(DISTINCT tag.name) as tags
      ORDER BY a.name
    `, { tagName });

    const asanas = result.records.map(r => ({
      name: r.get('name'),
      englishName: r.get('englishName'),
      vinyasaCount: parseIntVal(r.get('vinyasaCount')),
      stage: r.get('stage'),
      series: r.get('series'),
      tags: (r.get('tags') || []).filter(t => t !== null)
    }));

    res.json({ tagName, asanas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// GET /api/mindmap/asana/:asanaName — get asana details
router.get('/asana/:asanaName', async (req, res) => {
  const session = req.driver.session();
  const asanaName = req.params.asanaName;
  try {
    const result = await session.run(`
      MATCH (a:Asana {name: $asanaName})
      OPTIONAL MATCH (stage:TeachingStage)-[:TEACHES]->(a)
      OPTIONAL MATCH (ts:TeachingStructure)-[:HAS_STAGE]->(stage)
      OPTIONAL MATCH (a)-[:INVOLVES]->(tag:Tag)
      OPTIONAL MATCH (a)-[:IN_SECTION]->(sec:Section)
      RETURN
        a.name as name,
        a.englishName as englishName,
        a.vinyasaCount as vinyasaCount,
        stage.name as stage,
        ts.name as structure,
        ts.series as series,
        sec.name as section,
        collect(DISTINCT tag.name) as tags
    `, { asanaName });

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Asana not found' });
    }

    const r = result.records[0];
    res.json({
      name: r.get('name'),
      englishName: r.get('englishName'),
      vinyasaCount: parseIntVal(r.get('vinyasaCount')),
      stage: r.get('stage'),
      structure: r.get('structure'),
      series: r.get('series'),
      section: r.get('section'),
      tags: (r.get('tags') || []).filter(t => t !== null)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

module.exports = router;
