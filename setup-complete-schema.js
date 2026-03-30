/**
 * AYBKK Student Progress - Complete Schema
 * Supports: Active students, Assessments, Daily check-ins, Weekly reports, Upsell
 */

const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));

async function setup() {
  const session = driver.session();

  try {
    console.log('Setting up complete AYBKK Student Progress schema...\n');

    // 1. Create tag indexes
    console.log('1. Creating indexes...');
    await session.run(`CREATE INDEX student_id IF NOT EXISTS FOR (s:Student) ON (s.id)`);
    await session.run(`CREATE INDEX student_name IF NOT EXISTS FOR (s:Student) ON (s.name)`);
    await session.run(`CREATE INDEX tag_name_type IF NOT EXISTS FOR (t:Tag) ON (t.name, t.type)`);
    await session.run(`CREATE INDEX assessment_id IF NOT EXISTS FOR (a:Assessment) ON (a.id)`);
    await session.run(`CREATE INDEX assessment_date IF NOT EXISTS FOR (a:Assessment) ON (a.created_at)`);
    await session.run(`CREATE INDEX checkin_date IF NOT EXISTS FOR (c:CheckIn) ON (c.created_at)`);
    await session.run(`CREATE INDEX tag_type IF NOT EXISTS FOR (t:Tag) ON (t.type)`);
    await session.run(`CREATE INDEX membership_status IF NOT EXISTS FOR (m:Membership) ON (m.status)`);
    await session.run(`CREATE INDEX membership_expires IF NOT EXISTS FOR (m:Membership) ON (m.expiresAt)`);
    console.log('   ✓ Indexes created');

    // 2. Create strength tags
    console.log('\n2. Creating strength tags...');
    const strengths = [
      'Core Strength', 'Flexibility', 'Breath Control', 'Balance',
      'Focus', 'Consistency', 'Stamina', 'Hip Opening',
      'Backbending', 'Forward Folding', 'Inversion Experience', 'Arm Strength',
      'Shoulder Stability', 'Core Stability', 'Drishti', 'Bandhas'
    ];
    for (const name of strengths) {
      await session.run(`MERGE (t:Tag {name: $name, type: 'strength'})`, { name });
    }
    console.log(`   ✓ ${strengths.length} strength tags`);

    // 3. Create weakness tags
    console.log('\n3. Creating weakness tags...');
    const weaknesses = [
      'Chaturanga', 'Jump Back', 'Jump Through', 'Breathing',
      'Core', 'Balance', 'Flexibility', 'Hip Tightness',
      'Shoulder Mobility', 'Backbending', 'Forward Folding',
      'Inversions', 'Arm Balance', 'Wrist Pain', 'Knee Pain',
      'Neck Strain', 'Lower Back', 'Hamstring Tightness',
      'Focus', 'Consistency', 'Bandhas', 'Drishti',
      'Ujjayi Breath', 'Third Eye Gaze', 'Floating'
    ];
    for (const name of weaknesses) {
      await session.run(`MERGE (t:Tag {name: $name, type: 'weakness'})`, { name });
    }
    console.log(`   ✓ ${weaknesses.length} weakness tags`);

    // 4. Create course/technique tags for upsell
    console.log('\n4. Creating course tags...');
    const courses = [
      'Chaturanga Mastery', 'Jump Back Technique', 'Core Building',
      'Hip Opener Intensive', 'Backbend Series', 'Breath Work Foundation',
      'Balance & Inversions', 'Flexibility Flow', 'Arm Balance Basics',
      'Foundation Primary', 'Mysore Prep', 'Energy Cultivation'
    ];
    for (const name of courses) {
      await session.run(`MERGE (t:Tag {name: $name, type: 'course'})`, { name });
    }
    console.log(`   ✓ ${courses.length} course tags`);

    // 5. Show schema summary
    console.log('\n5. Schema summary...');
    const labels = await session.run(`CALL db.labels() YIELD label RETURN label ORDER BY label`);
    console.log('   Labels:', labels.records.map(r => r.get('label')).join(', '));

    const rels = await session.run(`CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType ORDER BY relationshipType`);
    console.log('   Relationships:', rels.records.map(r => r.get('relationshipType')).join(', '));

    const tagCount = await session.run(`MATCH (t:Tag) RETURN t.type AS type, count(t) AS cnt ORDER BY type`);
    console.log('\n   Tags by type:');
    tagCount.records.forEach(r => console.log(`     ${r.get('type')}: ${r.get('cnt').toNumber()}`));

    console.log('\n✅ Complete schema ready!');
    console.log('\n📊 Data model:');
    console.log('   Student — HAS_STRENGTH/HAS_WEAKNESS → Tag');
    console.log('   Student — HAS_MEMBERSHIP → Membership {status, expiresAt}');
    console.log('   Assessment — FOR_STUDENT → Student');
    console.log('   CheckIn — FOR_STUDENT → Student {mood, note, energy}');
    console.log('   Tag — HELPS_WITH → Course');
    console.log('   Course — TARGETS_WEAKNESS → Tag');

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    session.close();
    driver.close();
  }
}

setup();
