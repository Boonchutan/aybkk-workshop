/**
 * Notion Sync API
 * Syncs student data from Notion database to Neo4j
 */

const { Client } = require('@notionhq/client');
const express = require('express');
const router = express.Router();

// Initialize Notion client
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const STUDENTS_DB_ID = '7e6f9c96-5e13-4784-995f-4048c321a2f7';

/**
 * Parse Notion student properties into structured object
 */
function parseNotionStudent(page) {
  const props = page.properties;
  
  return {
    notionId: page.id,
    name: props.Name?.title?.[0]?.plain_text || '',
    phone: props['Phone number']?.phone_number || '',
    email: props['Personal email']?.email || '',
    membership: props['Membership type']?.select?.name || '',
    status: props['Status']?.status?.name || '',
    birthday: props['Birthday']?.date?.start || null,
    startDay: props['Start day']?.date?.start || null,
    measurements: props['Arm/Body/Leg/Hip/Waist/Weight/Hight']?.rich_text?.[0]?.plain_text || '',
    strength: props['Strength']?.multi_select?.map(s => s.name) || [],
    weaknesses: props['Weaknesses']?.multi_select?.map(s => s.name) || [],
    toImprove: props['To improve']?.multi_select?.map(s => s.name) || [],
    practiceSeries: props['Practice series']?.multi_select?.map(s => s.name) || [],
    studentNumber: props['Number']?.number || null,
    notionUniqueId: props['ID']?.unique_id?.number || null,
    lastSynced: new Date().toISOString()
  };
}

/**
 * GET /api/notion/students - Fetch students from Notion
 */
router.get('/notion/students', async (req, res) => {
  try {
    const response = await notion.request({
      method: 'POST',
      path: `data_sources/${STUDENTS_DB_ID}/query`,
      body: {
        page_size: 100
      }
    });

    const students = response.results?.map(parseNotionStudent) || [];
    
    res.json({
      success: true,
      count: students.length,
      students
    });
  } catch (err) {
    console.error('Notion fetch error:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message,
      details: err.code 
    });
  }
});

/**
 * POST /api/notion/sync - Sync Notion students to Neo4j
 */
router.post('/notion/sync', async (req, res) => {
  const driver = req.driver;
  const session = driver.session();
  
  try {
    // Fetch from Notion
    const response = await notion.request({
      method: 'POST',
      path: `data_sources/${STUDENTS_DB_ID}/query`,
      body: {
        page_size: 100
      }
    });

    const notionStudents = response.results?.map(parseNotionStudent) || [];
    
    // Sync to Neo4j
    const syncedStudents = [];
    const errors = [];
    
    for (const student of notionStudents) {
      try {
        // Create or update Student node
        const result = await session.run(`
          MERGE (s:Student {notionId: $notionId})
          ON CREATE SET 
            s.id = randomUUID(),
            s.createdAt = datetime(),
            s.source = 'notion'
          ON MATCH SET 
            s.updatedAt = datetime()
          SET s.name = $name,
              s.phone = $phone,
              s.email = $email,
              s.membership = $membership,
              s.status = $status,
              s.birthday = $birthday,
              s.startDay = $startDay,
              s.measurements = $measurements,
              s.studentNumber = $studentNumber,
              s.notionUniqueId = $notionUniqueId,
              s.lastSynced = datetime($lastSynced)
          WITH s
          UNWIND $strength as strengthName
          MERGE (tag:Tag {name: strengthName, category: 'strength'})
          MERGE (s)-[:HAS_STRENGTH]->(tag)
          WITH s
          UNWIND $weaknesses as weaknessName
          MERGE (tag:Tag {name: weaknessName, category: 'weakness'})
          MERGE (s)-[:HAS_WEAKNESS]->(tag)
          WITH s
          UNWIND $toImprove as improveName
          MERGE (tag:Tag {name: improveName, category: 'improvement'})
          MERGE (s)-[:WANTS_TO_IMPROVE]->(tag)
          WITH s
          UNWIND $practiceSeries as seriesName
          MERGE (series:Series {name: seriesName})
          MERGE (s)-[:PRACTICES]->(series)
          RETURN s
        `, {
          ...student,
          strength: student.strength || [],
          weaknesses: student.weaknesses || [],
          toImprove: student.toImprove || [],
          practiceSeries: student.practiceSeries || []
        });
        
        syncedStudents.push({
          notionId: student.notionId,
          name: student.name,
          status: 'synced'
        });
      } catch (studentErr) {
        errors.push({
          notionId: student.notionId,
          name: student.name,
          error: studentErr.message
        });
      }
    }
    
    await session.close();
    
    res.json({
      success: true,
      synced: syncedStudents.length,
      errors: errors.length,
      details: { synced: syncedStudents, errors }
    });
    
  } catch (err) {
    await session.close();
    console.error('Sync error:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

/**
 * GET /api/notion/sync-status - Get last sync status
 */
router.get('/notion/sync-status', async (req, res) => {
  const driver = req.driver;
  const session = driver.session();
  
  try {
    const result = await session.run(`
      MATCH (s:Student)
      WHERE s.source = 'notion' OR s.notionId IS NOT NULL
      RETURN 
        count(s) as totalNotionStudents,
        max(s.lastSynced) as lastSyncTime
    `);
    
    const stats = result.records[0];
    
    res.json({
      success: true,
      notionStudents: stats.get('totalNotionStudents').toNumber(),
      lastSync: stats.get('lastSyncTime')
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    await session.close();
  }
});

module.exports = router;
