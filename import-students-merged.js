/**
 * Import and merge students from CSV + Notion into Neo4j
 * - CSV provides: booking data, membership status
 * - Notion provides: weaknesses, strengths, practiceSeries, measurements
 */

const { v4: uuidv4 } = require('uuid');
const neo4j = require('neo4j-driver');
const fs = require('fs');
const csv = require('csv-parse');

const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    'aybkk_neo4j_2026'
  )
);

// Fetch Notion students from local server
async function fetchNotionStudents() {
  const response = await fetch('http://localhost:3000/api/notion/students');
  const data = await response.json();
  return data.students || [];
}

// Build Notion lookup - map each word to the student
function buildNotionLookup(notionStudents) {
  const byWord = {};
  for (const s of notionStudents) {
    const name = (s.name || '').trim();
    if (name) {
      // Add each word as a key (cleaned)
      const words = name.toLowerCase().split().map(w => w.replace(/[^a-z]/g, ''));
      for (const word of words) {
        if (word && !byWord[word]) {
          byWord[word] = s;
        }
      }
    }
  }
  return byWord;
}

// Find Notion data by matching any word in the name
function findNotionMatch(csvName, notionByWord) {
  if (!csvName) return null;
  const words = csvName.toLowerCase().split().map(w => w.replace(/[^a-z]/g, ''));
  for (const word of words) {
    if (word && notionByWord[word]) {
      return notionByWord[word];
    }
  }
  return null;
}

async function importStudents() {
  const session = driver.session();
  
  try {
    // Fetch Notion students
    console.log('Fetching Notion students...');
    const notionStudents = await fetchNotionStudents();
    console.log(`Got ${notionStudents.length} Notion students`);
    
    const notionByFirst = buildNotionLookup(notionStudents);
    
    // Read CSV
    const csvData = fs.readFileSync('/Users/alfredoagent/Downloads/customer_report_20180211.csv', 'utf-8');
    const records = await new Promise((resolve, reject) => {
      csv.parse(csvData, { columns: true }, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
    
    console.log(`Parsed ${records.length} CSV records`);
    
    // Separate active vs inactive and merge with Notion
    const active = [];
    const inactive = [];
    
    for (const r of records) {
      const status = (r.Status || '').trim();
      const membership = (r.Membership || '').trim();
      const completed = parseInt(r.Completed || 0);
      const name = (r.CustomerName || '').trim();
      
      if (!name) continue;
      
      // Check for Notion match
      const firstWord = name.split()[0].toLowerCase();
      const notionData = notionByFirst[firstWord] || null;
      
      // Handle empty email
      const email = (r.Email || '').trim();
      const emailKey = email || `noemail_${(r.Mobile || '').trim() || name.replace(/\s+/g, '_')}`;
      
      const student = {
        id: uuidv4(),
        name,
        mobile: (r.Mobile || '').trim(),
        email,
        emailKey,
        dob: (r.DateOfBirth || '').trim(),
        gender: (r.Gender || '').trim(),
        group: (r.Group || '').trim(),
        tag: (r.Tag || '').trim(),
        completed,
        totalBooking: parseInt(r['Total Booking'] || 0),
        status,
        membership,
        joinedDate: (r.JoinedDate || '').trim(),
        channel: (r.Channel || '').trim(),
        isActive: status === 'Active' && membership === 'Active Member',
        
        // Notion data
        notionId: notionData?.notionId || null,
        weaknesses: notionData?.weaknesses ? JSON.stringify(notionData.weaknesses) : '[]',
        strengths: notionData?.strengths ? JSON.stringify(notionData.strengths) : '[]',
        toImprove: notionData?.toImprove ? JSON.stringify(notionData.toImprove) : '[]',
        practiceSeries: notionData?.practiceSeries ? JSON.stringify(notionData.practiceSeries) : '[]',
        measurements: notionData?.measurements || '',
        notionStatus: notionData?.status || '',
        notionMembership: notionData?.membership || '',
        hasNotionData: notionData ? true : false
      };
      
      if (student.isActive) {
        active.push(student);
      } else {
        inactive.push(student);
      }
    }
    
    // Sort active by completed descending
    active.sort((a, b) => b.completed - a.completed);
    
    console.log(`\nActive: ${active.length} | Inactive: ${inactive.length}`);
    console.log(`Students with Notion data: ${active.filter(s => s.hasNotionData).length + inactive.filter(s => s.hasNotionData).length}`);
    
    // Clear existing students
    console.log('\nClearing existing students...');
    await session.run('MATCH (s:Student) DETACH DELETE s');
    
    // Import active students
    console.log('\nImporting active students...');
    for (let i = 0; i < active.length; i++) {
      const s = active[i];
      await session.run(`
        CREATE (st:Student {
          id: $id,
          name: $name,
          mobile: $mobile,
          email: $emailKey,
          dob: $dob,
          gender: $gender,
          groupTag: $group,
          tag: $tag,
          completed: $completed,
          totalBooking: $totalBooking,
          status: $status,
          membership: $membership,
          joinedDate: $joinedDate,
          channel: $channel,
          isActive: $isActive,
          sortOrder: $sortOrder,
          notionId: $notionId,
          weaknesses: $weaknesses,
          strengths: $strengths,
          toImprove: $toImprove,
          practiceSeries: $practiceSeries,
          measurements: $measurements,
          notionStatus: $notionStatus,
          notionMembership: $notionMembership,
          hasNotionData: $hasNotionData,
          createdAt: datetime()
        })
      `, {
        id: s.id,
        name: s.name,
        mobile: s.mobile,
        emailKey: s.emailKey,
        dob: s.dob,
        gender: s.gender,
        group: s.group,
        tag: s.tag,
        completed: s.completed,
        totalBooking: s.totalBooking,
        status: s.status,
        membership: s.membership,
        joinedDate: s.joinedDate,
        channel: s.channel,
        isActive: true,
        sortOrder: i,
        notionId: s.notionId,
        weaknesses: s.weaknesses,
        strengths: s.strengths,
        toImprove: s.toImprove,
        practiceSeries: s.practiceSeries,
        measurements: s.measurements,
        notionStatus: s.notionStatus,
        notionMembership: s.notionMembership,
        hasNotionData: s.hasNotionData
      });
      
      if (i < 10 || (i < 50 && i % 10 === 0)) {
        const notionTag = s.hasNotionData ? ' [HAS NOTION]' : '';
        console.log(`  ${i + 1}. ${s.name} - ${s.completed} completed${notionTag}`);
      }
    }
    console.log(`  ... and ${active.length - 10} more`);
    
    // Import inactive students
    console.log('\nImporting inactive students...');
    for (let i = 0; i < inactive.length; i++) {
      const s = inactive[i];
      await session.run(`
        CREATE (st:Student {
          id: $id,
          name: $name,
          mobile: $mobile,
          email: $emailKey,
          dob: $dob,
          gender: $gender,
          groupTag: $group,
          tag: $tag,
          completed: $completed,
          totalBooking: $totalBooking,
          status: $status,
          membership: $membership,
          joinedDate: $joinedDate,
          channel: $channel,
          isActive: $isActive,
          sortOrder: $sortOrder,
          notionId: $notionId,
          weaknesses: $weaknesses,
          strengths: $strengths,
          toImprove: $toImprove,
          practiceSeries: $practiceSeries,
          measurements: $measurements,
          notionStatus: $notionStatus,
          notionMembership: $notionMembership,
          hasNotionData: $hasNotionData,
          createdAt: datetime()
        })
      `, {
        id: s.id,
        name: s.name,
        mobile: s.mobile,
        emailKey: s.emailKey,
        dob: s.dob,
        gender: s.gender,
        group: s.group,
        tag: s.tag,
        completed: s.completed,
        totalBooking: s.totalBooking,
        status: s.status,
        membership: s.membership,
        joinedDate: s.joinedDate,
        channel: s.channel,
        isActive: false,
        sortOrder: active.length + i,
        notionId: s.notionId,
        weaknesses: s.weaknesses,
        strengths: s.strengths,
        toImprove: s.toImprove,
        practiceSeries: s.practiceSeries,
        measurements: s.measurements,
        notionStatus: s.notionStatus,
        notionMembership: s.notionMembership,
        hasNotionData: s.hasNotionData
      });
    }
    console.log(`  ${inactive.length} inactive students imported`);
    
    console.log(`\n✅ Import complete!`);
    console.log(`   Active: ${active.length}`);
    console.log(`   Inactive: ${inactive.length}`);
    console.log(`   Total: ${active.length + inactive.length}`);
    
    // Show some with Notion data
    console.log('\n=== STUDENTS WITH NOTION DATA ===');
    const withNotion = [...active, ...inactive].filter(s => s.hasNotionData).slice(0, 10);
    for (const s of withNotion) {
      const weaknessArr = JSON.parse(s.weaknesses);
      console.log(`  ${s.name}: ${weaknessArr.length} weaknesses, ${s.practiceSeries}`);
    }
    
  } catch (err) {
    console.error('Import error:', err);
  } finally {
    await session.close();
    await driver.close();
  }
}

importStudents();
