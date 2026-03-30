/**
 * Seed script for Mission Control
 * Creates sample students with progress checks
 */

const { v4: uuidv4 } = require('uuid');
const neo4j = require('neo4j-driver');

const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    'aybkk_neo4j_2026'
  )
);

async function seed() {
  const session = driver.session();
  
  // Sample students
  const students = [
    { name: 'Sarah Chen', nameChinese: '陈莎拉', practiceYears: 3, series: 'Primary' },
    { name: 'Marco Rossi', nameChinese: null, practiceYears: 5, series: 'Primary' },
    { name: 'Lin Wei', nameChinese: '林伟', practiceYears: 1, series: 'Primary' },
    { name: 'Emma Thompson', nameChinese: null, practiceYears: 2, series: 'Intermediate' },
    { name: 'James Wilson', nameChinese: null, practiceYears: 4, series: 'Primary' }
  ];
  
  // Progress attributes
  const attributes = ['posture', 'breathing', 'flexibility', 'strength', 'balance', 'focus'];
  
  try {
    for (const s of students) {
      const studentId = uuidv4();
      
      // Create student
      await session.run(`
        CREATE (st:Student {
          id: $id,
          name: $name,
          nameChinese: $nameChinese,
          workshop: 'huizhou-2026',
          practiceYears: $practiceYears,
          series: $series,
          attributes: '{}',
          limitations: '[]',
          strengths: '[]',
          injuries: '[]',
          createdAt: datetime()
        })
      `, { id: studentId, name: s.name, nameChinese: s.nameChinese, practiceYears: s.practiceYears, series: s.series });
      
      console.log('Created student:', s.name);
      
      // Create 3 progress checks for each student (spaced 2 weeks apart)
      for (let i = 0; i < 3; i++) {
        const checkDate = new Date();
        checkDate.setDate(checkDate.getDate() - (28 - i * 14)); // Feb 20, Mar 6, Mar 20
        
        const attrValues = {};
        attributes.forEach(attr => {
          // Generate realistic scores that improve over time
          const base = 2 + Math.random();
          const improvement = i * (0.3 + Math.random() * 0.3);
          attrValues[attr] = Math.min(5, Math.round((base + improvement) * 10) / 10);
        });
        
        const progressId = uuidv4();
        const overallScore = Object.values(attrValues).reduce((a, b) => a + b, 0) / 6;
        
        await session.run(`
          CREATE (p:ProgressCheck {
            id: $id,
            checkDate: datetime($checkDate),
            attributes: $attributes,
            overallScore: $overallScore,
            notes: $notes,
            assessor: 'Teacher',
            createdAt: datetime()
          })
          WITH p
          MATCH (st:Student {id: $studentId})
          CREATE (st)-[:HAS_PROGRESS_CHECK]->(p)
        `, { 
          id: progressId, 
          checkDate: checkDate.toISOString(), 
          attributes: JSON.stringify(attrValues), 
          overallScore: Math.round(overallScore * 10) / 10,
          notes: i === 0 ? 'Initial assessment' : 'Follow-up check',
          studentId: studentId
        });
        
        console.log('  Progress check', i + 1, ':', attrValues);
      }
    }
    
    console.log('\n✅ Seed complete! 5 students x 3 progress checks each = 15 progress checks');
  } catch (err) {
    console.error('Seed error:', err);
  } finally {
    await session.close();
    await driver.close();
  }
}

seed();