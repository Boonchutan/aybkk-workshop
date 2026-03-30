const { Client } = require('@notionhq/client');
const neo4j = require('neo4j-driver');
require('dotenv').config();

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const STUDENTS_DB_ID = '7e6f9c96-5e13-4784-995f-4048c321a2f7';

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);

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

async function syncNotionToNeo4j() {
  const session = driver.session();
  
  try {
    console.log('📡 Fetching students from Notion...');
    
    const response = await notion.request({
      method: 'POST',
      path: `data_sources/${STUDENTS_DB_ID}/query`,
      body: { page_size: 100 }
    });

    const notionStudents = response.results?.map(parseNotionStudent) || [];
    console.log(`✅ Found ${notionStudents.length} students in Notion\n`);

    let synced = 0;
    let updated = 0;
    let errors = [];

    for (const student of notionStudents) {
      try {
        // Try to find existing student by email or phone
        const findResult = await session.run(`
          MATCH (s:Student)
          WHERE s.email = $email OR s.mobile = $phone OR s.name = $name
          RETURN s
          LIMIT 1
        `, { email: student.email, phone: student.phone, name: student.name });

        if (findResult.records.length > 0) {
          // Update existing student with Notion data
          await session.run(`
            MATCH (s:Student)
            WHERE s.email = $email OR s.mobile = $phone OR s.name = $name
            SET s.notionId = $notionId,
                s.notionUniqueId = $notionUniqueId,
                s.birthday = $birthday,
                s.startDay = $startDay,
                s.measurements = $measurements,
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
            MERGE (series:PracticeSeries {name: seriesName})
            MERGE (s)-[:PRACTICES]->(series)
            RETURN s.name as name
          `, {
            ...student,
            strength: student.strength || [],
            weaknesses: student.weaknesses || [],
            toImprove: student.toImprove || [],
            practiceSeries: student.practiceSeries || []
          });
          updated++;
          console.log(`🔄 Updated: ${student.name}`);
        } else {
          // Create new student from Notion
          await session.run(`
            CREATE (s:Student {
              id: randomUUID(),
              notionId: $notionId,
              name: $name,
              mobile: $phone,
              email: $email,
              membership: $membership,
              status: $status,
              birthday: $birthday,
              startDay: $startDay,
              measurements: $measurements,
              notionUniqueId: $notionUniqueId,
              source: 'notion',
              createdAt: datetime(),
              lastSynced: datetime($lastSynced)
            })
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
            MERGE (series:PracticeSeries {name: seriesName})
            MERGE (s)-[:PRACTICES]->(series)
            RETURN s.name as name
          `, {
            ...student,
            strength: student.strength || [],
            weaknesses: student.weaknesses || [],
            toImprove: student.toImprove || [],
            practiceSeries: student.practiceSeries || []
          });
          synced++;
          console.log(`✨ Created: ${student.name}`);
        }
      } catch (err) {
        errors.push({ name: student.name, error: err.message });
        console.error(`❌ Error with ${student.name}:`, err.message);
      }
    }

    console.log(`\n📊 SYNC COMPLETE`);
    console.log(`   Updated existing: ${updated}`);
    console.log(`   Created new: ${synced}`);
    console.log(`   Errors: ${errors.length}`);

    // Show summary of merged data
    const summaryResult = await session.run(`
      MATCH (s:Student)-[:HAS_STRENGTH|HAS_WEAKNESS|WANTS_TO_IMPROVE|PRACTICES]->(tag)
      WITH s, collect(DISTINCT tag.name) as conditions
      RETURN 
        count(s) as studentsWithConditions,
        avg(size(conditions)) as avgConditions,
        max(size(conditions)) as maxConditions
    `);
    
    const summary = summaryResult.records[0];
    console.log('\n📈 MERGE SUMMARY:');
    console.log(`   Students with conditions: ${summary.get('studentsWithConditions')}`);
    console.log(`   Average conditions per student: ${summary.get('avgConditions').toFixed(1)}`);
    console.log(`   Max conditions on one student: ${summary.get('maxConditions')}`);

    // Show sample of merged data
    const sampleResult = await session.run(`
      MATCH (s:Student)-[:HAS_STRENGTH|HAS_WEAKNESS|WANTS_TO_IMPROVE]->(tag)
      RETURN s.name as name, 
             collect(DISTINCT tag.name) as conditions,
             count(DISTINCT tag) as tagCount
      LIMIT 5
    `);
    
    console.log('\n🎯 Sample students with merged conditions:');
    sampleResult.records.forEach(r => {
      console.log(`   ${r.get('name')}: ${r.get('tagCount')} conditions - [${r.get('conditions').slice(0, 3).join(', ')}...]`);
    });

  } catch (err) {
    console.error('❌ Sync failed:', err.message);
    console.error('Details:', err);
  } finally {
    await session.close();
    await driver.close();
  }
}

syncNotionToNeo4j();
