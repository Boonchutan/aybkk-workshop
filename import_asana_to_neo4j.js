const neo4j = require('neo4j-driver');
const fs = require('fs');

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'aybkk_neo4j_pass')
);

async function importToNeo4j() {
  const session = driver.session();
  
  // Load data
  const poses = JSON.parse(fs.readFileSync('/tmp/poses_for_neo4j.json', 'utf8'));
  const students = JSON.parse(fs.readFileSync('/tmp/students_for_neo4j.json', 'utf8'));
  
  console.log(`Importing ${poses.length} poses and ${students.length} students...`);
  
  try {
    // 1. Create unique Series nodes
    const seriesSet = new Set();
    poses.forEach(p => seriesSet.add(p.series));
    students.forEach(s => s.practice_series.forEach(sr => seriesSet.add(sr)));
    
    console.log(`Creating ${seriesSet.size} Series nodes...`);
    for (const seriesName of seriesSet) {
      await session.run(`
        MERGE (s:Series {name: $name})
        SET s.type = 'practice_series'
      `, { name: seriesName });
    }
    
    // 2. Create Asana nodes (individual poses)
    console.log(`Creating ${poses.length} Asana nodes...`);
    for (const pose of poses) {
      await session.run(`
        MERGE (a:Asana {name: $name})
        SET a.meaning = $meaning,
            a.function = $function,
            a.series = $series,
            a.notionId = $notionId,
            a.type = 'pose'
      `, { name: pose.name, meaning: pose.meaning, function: pose.function, series: pose.series, notionId: pose.notionId });
    }
    
    // 3. Link Asanas to their Series
    console.log('Linking Asanas to Series...');
    for (const pose of poses) {
      await session.run(`
        MATCH (a:Asana {name: $poseName})
        MATCH (s:Series {name: $seriesName})
        MERGE (a)-[:BELONGS_TO_SERIES]->(s)
      `, { poseName: pose.name, seriesName: pose.series });
    }
    
    // 4. Link students to their practice series
    console.log('Linking students to practice series...');
    for (const student of students) {
      for (const seriesName of student.practice_series) {
        await session.run(`
          MATCH (st:Student {name: $studentName})
          MATCH (s:Series {name: $seriesName})
          MERGE (st)-[:PRACTICES]->(s)
        `, { studentName: student.name, seriesName });
      }
    }
    
    // 5. Create weakness/strength tags and link students
    console.log('Creating weakness tags...');
    const allWeaknesses = new Set();
    students.forEach(s => s.weaknesses.forEach(w => allWeaknesses.add(w)));
    
    for (const weakness of allWeaknesses) {
      await session.run(`
        MERGE (t:Tag {name: $name})
        SET t.category = 'weakness'
      `, { name: weakness });
      
      await session.run(`
        MATCH (st:Student {name: $studentName})
        MATCH (t:Tag {name: $tagName, category: 'weakness'})
        MERGE (st)-[:HAS_WEAKNESS]->(t)
      `, { studentName: students.find(s => s.weaknesses.includes(weakness))?.name || '', tagName: weakness });
    }
    
    console.log('Creating strength tags...');
    const allStrengths = new Set();
    students.forEach(s => s.strengths.forEach(sr => allStrengths.add(sr)));
    
    for (const strength of allStrengths) {
      await session.run(`
        MERGE (t:Tag {name: $name})
        SET t.category = 'strength'
      `, { name: strength });
    }
    
    // 6. Link students to their weakness and strength tags
    console.log('Linking students to tags...');
    for (const student of students) {
      for (const weakness of student.weaknesses) {
        await session.run(`
          MATCH (st:Student {name: $name})
          MATCH (t:Tag {name: $tagName})
          MERGE (st)-[:HAS_WEAKNESS]->(t)
        `, { name: student.name, tagName: weakness });
      }
      for (const strength of student.strengths) {
        await session.run(`
          MATCH (st:Student {name: $name})
          MATCH (t:Tag {name: $tagName})
          MERGE (st)-[:HAS_STRENGTH]->(t)
        `, { name: student.name, tagName: strength });
      }
    }
    
    // Verify counts
    const result = await session.run(`
      MATCH (s:Series) RETURN count(s) as seriesCount
      UNION ALL
      MATCH (a:Asana) RETURN count(a) as asanaCount
      UNION ALL
      MATCH (t:Tag) RETURN count(t) as tagCount
    `);
    
    console.log('\n=== IMPORT COMPLETE ===');
    console.log(`Series nodes: ${[...seriesSet].join(', ')}`);
    console.log(`Total Asana nodes: ${poses.length}`);
    console.log(`Total Tag nodes: ${allWeaknesses.size + allStrengths.size}`);
    console.log(`Students linked to series and tags`);
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await session.close();
    await driver.close();
  }
}

importToNeo4j();
