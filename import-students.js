/**
 * Import students from CSV into Neo4j
 * Sorts: Active members with most completed classes first, inactive at bottom
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

async function importStudents() {
  const session = driver.session();
  
  try {
    // Read and parse CSV
    const csvData = fs.readFileSync('/Users/alfredoagent/Downloads/customer_report_20180211.csv', 'utf-8');
    const records = await new Promise((resolve, reject) => {
      csv.parse(csvData, { columns: true }, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
    
    console.log(`Parsed ${records.length} records from CSV`);
    
    // Separate active vs inactive
    const active = [];
    const inactive = [];
    
    for (const r of records) {
      const status = (r.Status || '').trim();
      const membership = (r.Membership || '').trim();
      const completed = parseInt(r.Completed || 0);
      const name = (r.CustomerName || '').trim();
      
      if (!name) continue; // Skip empty rows
      
      // Handle empty email with placeholder for unique constraint
      const email = (r.Email || '').trim();
      const emailKey = email || `noemail_${(r.Mobile || '').trim() || name.replace(/\s+/g, '_')}`;
      
      const student = {
        id: uuidv4(),
        name,
        mobile: (r.Mobile || '').trim(),
        email: emailKey, // Use placeholder if empty for unique constraint
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
        isActive: status === 'Active' && membership === 'Active Member'
      };
      
      if (student.isActive) {
        active.push(student);
      } else {
        inactive.push(student);
      }
    }
    
    // Sort active by completed descending
    active.sort((a, b) => b.completed - a.completed);
    
    console.log(`\nActive students: ${active.length}`);
    console.log(`Inactive students: ${inactive.length}`);
    
    // Clear existing students
    console.log('\nClearing existing students...');
    await session.run('MATCH (s:Student) DETACH DELETE s');
    
    // Import active students first (with sortOrder)
    console.log('\nImporting active students...');
    for (let i = 0; i < active.length; i++) {
      const s = active[i];
      await session.run(`
        CREATE (st:Student {
          id: $id,
          name: $name,
          mobile: $mobile,
          email: $email,
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
          createdAt: datetime()
        })
      `, {
        id: s.id,
        name: s.name,
        mobile: s.mobile,
        email: s.email,
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
        sortOrder: i
      });
      if (i < 20) {
        console.log(`  ${i + 1}. ${s.name} - ${s.completed} completed`);
      }
    }
    console.log(`  ... and ${active.length - 20} more active students`);
    
    // Import inactive students (sortOrder starts after active)
    console.log('\nImporting inactive students...');
    for (let i = 0; i < inactive.length; i++) {
      const s = inactive[i];
      await session.run(`
        CREATE (st:Student {
          id: $id,
          name: $name,
          mobile: $mobile,
          email: $email,
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
          createdAt: datetime()
        })
      `, {
        id: s.id,
        name: s.name,
        mobile: s.mobile,
        email: s.email,
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
        sortOrder: active.length + i
      });
    }
    console.log(`  ${inactive.length} inactive students imported`);
    
    console.log(`\n✅ Import complete!`);
    console.log(`   Active: ${active.length}`);
    console.log(`   Inactive: ${inactive.length}`);
    console.log(`   Total: ${active.length + inactive.length}`);
    
  } catch (err) {
    console.error('Import error:', err);
  } finally {
    await session.close();
    await driver.close();
  }
}

importStudents();
