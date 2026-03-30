/**
 * AYBKK Student Engagement System
 * Neo4j Database Setup - Phase 1
 * Run: node setup-database.js
 */

const neo4j = require('neo4j-driver');

require('dotenv').config();

const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    'aybkk_neo4j_2026'
  )
);

async function setupDatabase() {
  const session = driver.session();
  
  try {
    console.log('🔧 Setting up AYBKK Student Engagement Database...\n');

    // ============================================
    // CONSTRAINTS & INDEXES
    // ============================================
    
    console.log('📐 Creating constraints and indexes...');
    
    // Unique constraints
    await session.run('CREATE CONSTRAINT student_email IF NOT EXISTS FOR (s:Student) REQUIRE s.email IS UNIQUE');
    await session.run('CREATE CONSTRAINT student_phone IF NOT EXISTS FOR (s:Student) REQUIRE s.phone IS UNIQUE');
    await session.run('CREATE CONSTRAINT tag_name IF NOT EXISTS FOR (t:Tag) REQUIRE t.name IS UNIQUE');
    await session.run('CREATE CONSTRAINT asana_name IF NOT EXISTS FOR (a:Asana) REQUIRE a.name IS UNIQUE');
    await session.run('CREATE CONSTRAINT course_id IF NOT EXISTS FOR (c:Course) REQUIRE c.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT session_id IF NOT EXISTS FOR (s:Session) REQUIRE s.id IS UNIQUE');
    
    // Indexes for performance
    await session.run('CREATE INDEX student_platform IF NOT EXISTS FOR (s:Student) ON (s.platform)');
    await session.run('CREATE INDEX student_line_id IF NOT EXISTS FOR (s:Student) ON (s.line_id)');
    await session.run('CREATE INDEX student_wechat_id IF NOT EXISTS FOR (s:Student) ON (s.wechat_id)');
    await session.run('CREATE INDEX session_date IF NOT EXISTS FOR (s:Session) ON (s.date)');
    await session.run('CREATE INDEX tag_category IF NOT EXISTS FOR (t:Tag) ON (t.category)');
    
    console.log('✅ Constraints and indexes created\n');

    // ============================================
    // SEED DATA: TAGS (Yoga-specific)
    // ============================================
    
    console.log('🏷️ Seeding Tag nodes...');
    
    const tags = [
      // Weaknesses (common problem areas)
      { name: 'forwardBend', category: 'weakness', description: 'Tight hamstrings and hip flexors' },
      { name: 'backbend', category: 'weakness', description: 'Back flexibility and heart opening' },
      { name: 'hipOpening', category: 'weakness', description: 'Hip flexibility' },
      { name: 'shoulderMobility', category: 'weakness', description: 'Shoulder flexibility' },
      { name: 'coreStrength', category: 'weakness', description: 'Core stability and strength' },
      { name: 'balance', category: 'weakness', description: 'Balance and focus' },
      { name: 'twist', category: 'weakness', description: 'Spinal rotation' },
      { name: 'inversions', category: 'weakness', description: 'Headstands, handstands' },
      { name: 'breathControl', category: 'weakness', description: 'Pranayama and breath work' },
      { name: 'bandha', category: 'weakness', description: 'Bandha activation' },
      { name: 'drishti', category: 'weakness', description: 'Gaze and concentration' },
      
      // Strengths
      { name: 'strongBandha', category: 'strength', description: 'Excellent bandha control' },
      { name: 'flexibleHips', category: 'strength', description: 'Naturally open hips' },
      { name: 'strongBack', category: 'strength', description: 'Strong backbend capacity' },
      { name: 'goodBalance', category: 'strength', description: 'Steady in balancing poses' },
      { name: 'breathSync', category: 'strength', description: 'Great breath-movement connection' },
      { name: 'consistentPractice', category: 'strength', description: 'Regular practitioner' },
      { name: 'strongCore', category: 'strength', description: 'Solid core foundation' },
      
      // Interests
      { name: 'primarySeries', category: 'interest', description: 'Interested in Primary series' },
      { name: 'intermediateSeries', category: 'interest', description: 'Interested in Intermediate series' },
      { name: 'advancedSeries', category: 'interest', description: 'Interested in Advanced series' },
      { name: 'pranayama', category: 'interest', description: 'Interested in breath work' },
      { name: 'meditation', category: 'interest', description: 'Interested in meditation' },
      { name: 'yogaPhilosophy', category: 'interest', description: 'Interested in yoga philosophy' },
      { name: 'onlineClasses', category: 'interest', description: 'Prefers online classes' },
      { name: 'morningPractice', category: 'interest', description: 'Morning practice preference' },
    ];
    
    for (const tag of tags) {
      await session.run(`
        MERGE (t:Tag {name: $name})
        SET t.category = $category,
            t.description = $description
        RETURN t
      `, tag);
    }
    console.log(`✅ Created ${tags.length} Tag nodes\n`);

    // ============================================
    // SEED DATA: ASANAS (Primary Series focus)
    // ============================================
    
    console.log('🧘 Seeding Asana nodes (Primary Series)...');
    
    const asanas = [
      // Sun Salutations
      { name: 'Surya Namaskar A', sanskrit: 'Sun Salutation A', series: 'primary' },
      { name: 'Surya Namaskar B', sanskrit: 'Sun Salutation B', series: 'primary' },
      
      // Standing Poses
      { name: 'Padangusthasana', sanskrit: 'Big Toe Pose', series: 'primary' },
      { name: 'Padahastasana', sanskrit: 'Hand Under Foot Pose', series: 'primary' },
      { name: 'Utthita Trikonasana', sanskrit: 'Extended Triangle', series: 'primary' },
      { name: 'Prasarita Padottanasana A-D', sanskrit: 'Wide-Legged Forward Bend', series: 'primary' },
      { name: 'Parsvakonasana', sanskrit: 'Side Angle Pose', series: 'primary' },
      { name: 'Parivrtta Trikonasana', sanskrit: 'Revolved Triangle', series: 'primary' },
      { name: 'Virabhadrasana I', sanskrit: 'Warrior I', series: 'primary' },
      { name: 'Virabhadrasana II', sanskrit: 'Warrior II', series: 'primary' },
      { name: 'Virabhadrasana III', sanskrit: 'Warrior III', series: 'primary' },
      { name: 'Ardha Chandrasana', sanskrit: 'Half Moon', series: 'primary' },
      { name: 'Parsvottanasana', sanskrit: 'Intense Side Stretch', series: 'primary' },
      { name: 'Utthita Parsvakonasana', sanskrit: 'Extended Side Angle', series: 'primary' },
      { name: 'Pashasana', sanskrit: 'Noose Pose', series: 'primary' },
      { name: 'Marichyasana I', sanskrit: 'Sage Pose I', series: 'primary' },
      { name: 'Marichyasana III', sanskrit: 'Sage Pose III', series: 'primary' },
      { name: 'Navasana', sanskrit: 'Boat Pose', series: 'primary' },
      
      // Seated Poses
      { name: 'Bhujapidasana', sanskrit: 'Arm Pressure Pose', series: 'primary' },
      { name: 'Kurmasana', sanskrit: 'Tortoise Pose', series: 'primary' },
      { name: 'Garbha Pindasana', sanskrit: 'Embryo in Womb Pose', series: 'primary' },
      { name: 'Kukkutasana', sanskrit: 'Rooster Pose', series: 'primary' },
      { name: 'Baddha Konasana A-B', sanskrit: 'Bound Angle Pose', series: 'primary' },
      { name: 'Upavistha Konasana', sanskrit: 'Wide-Angle Seated Forward Bend', series: 'primary' },
      { name: 'Tirang Mukha Ekapada Paschimottanasana', sanskrit: 'Three-Limbed Forward Bend', series: 'primary' },
      { name: 'Janu Sirsasana A-C', sanskrit: 'Head-to-Knee Pose', series: 'primary' },
      { name: 'Paschimottanasana A-B', sanskrit: 'Seated Forward Bend', series: 'primary' },
      { name: 'Purvattanasana', sanskrit: 'Intense East Stretch', series: 'primary' },
      { name: 'Arbua Padmasana', sanskrit: 'Six-Part Lotus', series: 'primary' },
      { name: 'Yogagathi', sanskrit: 'Yoga Walk', series: 'primary' },
      { name: 'Chakorasana', sanskrit: 'Wheel-Bird Pose', series: 'primary' },
      { name: 'Bhujapidasana', sanskrit: 'Arm Pressure Pose', series: 'primary' },
      
      // Finishing Poses
      { name: 'Kapasana', sanskrit: 'Parrot Pose', series: 'primary' },
      { name: 'Karasana', sanskrit: 'Crow Pose', series: 'primary' },
      { name: 'Bharadvajasana', sanskrit: 'Bharadvaja\'s Twist', series: 'primary' },
      { name: 'Ardha Matsyendrasana', sanskrit: 'Half Lord of the Fishes', series: 'primary' },
      { name: 'Eka Pada Rajakapotasana', sanskrit: 'One-Legged King Pigeon', series: 'primary' },
      { name: 'Dwi Pada Rajakapotasana', sanskrit: 'Double Pigeon', series: 'primary' },
      { name: 'Setu Bandhasana', sanskrit: 'Bridge Pose', series: 'primary' },
      { name: 'Urbva Dhanurasana', sanskrit: 'Upward Bow Pose', series: 'primary' },
      { name: 'Salamba Sarvangasana', sanskrit: 'Shoulder Stand', series: 'primary' },
      { name: 'Halasana', sanskrit: 'Plow Pose', series: 'primary' },
      { name: 'Karnapidasana', sanskrit: 'Ear Pressure Pose', series: 'primary' },
      { name: 'Urdhva Padmasana', sanskrit: 'Upward Lotus', series: 'primary' },
      { name: 'Pindasana', sanskrit: 'Embryo Pose', series: 'primary' },
      { name: 'Matsyasana', sanskrit: 'Fish Pose', series: 'primary' },
      { name: 'Uttana Padasana', sanskrit: 'Raised Leg Pose', series: 'primary' },
      { name: 'Shavasana', sanskrit: 'Corpse Pose', series: 'primary' },
    ];
    
    for (const asana of asanas) {
      await session.run(`
        MERGE (a:Asana {name: $name})
        SET a.sanskrit = $sanskrit,
            a.series = $series
        RETURN a
      `, asana);
    }
    console.log(`✅ Created ${asanas.length} Asana nodes\n`);

    // ============================================
    // TAG → ASANA RELATIONSHIPS
    // ============================================
    
    console.log('🔗 Creating Tag → Asana relationships...');
    
    const tagAsanaLinks = [
      // Forward bend poses
      ['forwardBend', 'Paschimottanasana A-B'],
      ['forwardBend', 'Padangusthasana'],
      ['forwardBend', 'Padahastasana'],
      ['forwardBend', 'Prasarita Padottanasana A-D'],
      ['forwardBend', 'Janu Sirsasana A-C'],
      ['forwardBend', 'Upavistha Konasana'],
      ['forwardBend', 'Tirang Mukha Ekapada Paschimottanasana'],
      
      // Backbend poses
      ['backbend', 'Urbva Dhanurasana'],
      ['backbend', 'Setu Bandhasana'],
      ['backbend', 'Ardha Chandrasana'],
      ['backbend', 'Virabhadrasana I'],
      ['backbend', 'Virabhadrasana III'],
      ['backbend', 'Eka Pada Rajakapotasana'],
      ['backbend', 'Dwi Pada Rajakapotasana'],
      
      // Hip opening poses
      ['hipOpening', 'Baddha Konasana A-B'],
      ['hipOpening', 'Upavistha Konasana'],
      ['hipOpening', 'Eka Pada Rajakapotasana'],
      ['hipOpening', 'Dwi Pada Rajakapotasana'],
      ['hipOpening', 'Virabhadrasana I'],
      ['hipOpening', 'Marichyasana I'],
      ['hipOpening', 'Marichyasana III'],
      
      // Core strength poses
      ['coreStrength', 'Navasana'],
      ['coreStrength', 'Virabhadrasana III'],
      ['coreStrength', 'Ardha Chandrasana'],
      ['coreStrength', 'Kukkutasana'],
      ['coreStrength', 'Bhujapidasana'],
      
      // Balance poses
      ['balance', 'Virabhadrasana III'],
      ['balance', 'Ardha Chandrasana'],
      ['balance', 'Eka Pada Rajakapotasana'],
      ['balance', 'Natarajasana'],
      
      // Twist poses
      ['twist', 'Bharadvajasana'],
      ['twist', 'Ardha Matsyendrasana'],
      ['twist', 'Marichyasana III'],
      ['twist', 'Paschimottanasana'],
      
      // Bandha poses
      ['bandha', 'Mula Bandha'],
      ['bandha', 'Uddiyana Bandha'],
      ['bandha', 'Jalandhara Bandha'],
      ['bandha', 'Navasana'],
      ['bandha', 'Matsyasana'],
      
      // Inversions
      ['inversions', 'Salamba Sarvangasana'],
      ['inversions', 'Halasana'],
      ['inversions', 'Karnapidasana'],
      ['inversions', 'Urdhva Padmasana'],
      ['inversions', 'Sirsasana'],
    ];
    
    for (const [tagName, asanaName] of tagAsanaLinks) {
      await session.run(`
        MATCH (t:Tag {name: $tagName})
        MATCH (a:Asana {name: $asanaName})
        MERGE (t)-[:NEEDED_FOR]->(a)
      `, { tagName, asanaName });
    }
    console.log(`✅ Created ${tagAsanaLinks.length} Tag → Asana relationships\n`);

    // ============================================
    // VERIFY SETUP
    // ============================================
    
    console.log('🔍 Verifying database setup...\n');
    
    const counts = await session.run(`
      MATCH (s:Student) RETURN count(s) as count
      UNION ALL
      MATCH (t:Tag) RETURN count(t) as count
      UNION ALL
      MATCH (a:Asana) RETURN count(a) as count
      UNION ALL
      MATCH (c:Course) RETURN count(c) as count
      UNION ALL
      MATCH (s:Session) RETURN count(s) as count
    `);
    
    const result = {
      Students: (await session.run('MATCH (s:Student) RETURN count(s) as count')).records[0].get('count').toNumber(),
      Tags: (await session.run('MATCH (t:Tag) RETURN count(t) as count')).records[0].get('count').toNumber(),
      Asanas: (await session.run('MATCH (a:Asana) RETURN count(a) as count')).records[0].get('count').toNumber(),
      Courses: (await session.run('MATCH (c:Course) RETURN count(c) as count')).records[0].get('count').toNumber(),
      Sessions: (await session.run('MATCH (s:Session) RETURN count(s) as count')).records[0].get('count').toNumber(),
    };
    
    console.log('📊 Database counts:');
    console.table(result);
    
    console.log('\n✅ AYBKK Student Engagement Database setup complete!');
    console.log('\nNext steps:');
    console.log('1. node create-student.js - Add your first student');
    console.log('2. node create-course.js - Add course content');
    console.log('3. server.js - Start the API');

  } catch (error) {
    console.error('❌ Error setting up database:', error);
    throw error;
  } finally {
    await session.close();
    await driver.close();
  }
}

// Run if called directly
if (require.main === module) {
  setupDatabase().catch(console.error);
}

module.exports = { setupDatabase };
