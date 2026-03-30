/**
 * Import active memberships from Rezerw CSV
 * Match students by email or phone, create Membership nodes
 */

const neo4j = require('neo4j-driver');
const fs = require('fs');

const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));

// Parse CSV manually
function parseCSV(filepath) {
  const content = fs.readFileSync(filepath, 'utf8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const row = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (values[idx] || '').trim();
    });
    rows.push(row);
  }
  return rows;
}

async function importActiveMemberships() {
  const csvPath = '/Users/alfredoagent/mission-control/data/rezerv/memberships.csv';
  const memberships = parseCSV(csvPath);

  console.log(`Total rows in CSV: ${memberships.length}`);

  // Filter active only
  const active = memberships.filter(m =>
    m.Status === 'Active' && m.Expiration_Date
  );
  console.log(`Active memberships: ${active.length}`);

  // Parse dates
  function parseDate(str) {
    if (!str || str === '--') return null;
    // Format: DD/MM/YY
    const parts = str.split('/');
    if (parts.length !== 3) return null;
    const [d, m, y] = parts;
    const fullYear = parseInt(y) + 2000;
    return new Date(fullYear, parseInt(m) - 1, parseInt(d));
  }

  const session = driver.session();
  let matched = 0;
  let created = 0;
  let skipped = 0;

  try {
    for (const m of active) {
      const email = m.Email;
      const phone = m.Mobile;
      const firstName = m.First_Name;
      const lastName = m.Last_Name;
      const membershipType = m.Membership;
      const membershipNumber = m['Membership Number'];
      const expiresAt = parseDate(m.Expiration_Date);
      const startDate = parseDate(m.Start_Date);
      const lastBooking = m.Last_Booking_Completed_Date;

      if (!email && !phone) {
        skipped++;
        continue;
      }

      // Find matching student by email (case insensitive)
      let studentId = null;
      let matchKey = '';

      if (email) {
        const result = await session.run(`
          MATCH (s:Student)
          WHERE toLower(s.email) = toLower($email)
          RETURN s.studentId AS id, s.name AS name
          LIMIT 1
        `, { email });
        if (result.records.length > 0) {
          studentId = result.records[0].get('id');
          matchKey = `email: ${email}`;
        }
      }

      // If no email match, try phone
      if (!studentId && phone) {
        const cleanPhone = phone.replace(/[^\d]/g, '');
        const result = await session.run(`
          MATCH (s:Student)
          WHERE replace(replace(replace(s.phone, ' ', ''), '-', ''), '+', '') CONTAINS $cleanPhone
          RETURN s.studentId AS id, s.name AS name
          LIMIT 1
        `, { cleanPhone });
        if (result.records.length > 0) {
          studentId = result.records[0].get('id');
          matchKey = `phone: ${phone}`;
        }
      }

      if (studentId) {
        // Create Membership node and link to student
        await session.run(`
          MATCH (s:Student {studentId: $studentId})
          MERGE (m:Membership {membershipNumber: $membershipNumber})
          SET m.type = $membershipType,
              m.status = 'active',
              m.expiresAt = date($expiresAt),
              m.startDate = date($startDate),
              m.source = 'rezerv',
              m.lastBookingDate = $lastBooking,
              m.email = $email,
              m.phone = $phone,
              m.firstName = $firstName,
              m.lastName = $lastName
          MERGE (s)-[:HAS_MEMBERSHIP]->(m)
        `, {
          studentId: studentId,
          membershipNumber: membershipNumber || email,
          membershipType: membershipType || 'Unknown',
          expiresAt: expiresAt ? expiresAt.toISOString().split('T')[0] : null,
          startDate: startDate ? startDate.toISOString().split('T')[0] : null,
          lastBooking: lastBooking || null,
          email: email || '',
          phone: phone || '',
          firstName: firstName || '',
          lastName: lastName || ''
        });
        matched++;
        console.log(`  ✓ ${firstName} ${lastName} → ${matchKey}`);
      } else {
        console.log(`  ✗ Not found: ${firstName} ${lastName} (${email || phone})`);
        skipped++;
      }
    }

    console.log(`\n✅ Import complete!`);
    console.log(`   Matched: ${matched}`);
    console.log(`   Skipped (no match): ${skipped}`);

    // Verify
    const membCount = await session.run(`MATCH (m:Membership) RETURN count(m) AS cnt`);
    console.log(`   Total Membership nodes: ${membCount.records[0].get('cnt').toNumber()}`);

    const studentWithMemb = await session.run(`
      MATCH (s:Student)-[:HAS_MEMBERSHIP]->(m:Membership)
      WHERE m.status = 'active'
      RETURN count(s) AS cnt
    `);
    console.log(`   Students with active membership: ${studentWithMemb.records[0].get('cnt').toNumber()}`);

  } finally {
    session.close();
    driver.close();
  }
}

importActiveMemberships().catch(e => console.error('ERR:', e.message));
