require('dotenv').config();
const { Client } = require('@notionhq/client');
const neo4j = require('neo4j-driver');

console.log('=== Import Tags to Neo4j ===');

// Notion setup
const notion = new Client({ auth: process.env.NOTION_API_KEY });

// Neo4j setup
const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);
const session = driver.session();

// Student database ID
const dbId = '7e6f9c96-5e13-4784-995f-4048c321a2f7';

async function getAllStudents() {
  const allStudents = [];
  let cursor = null;
  
  do {
    try {
      const body = cursor ? { page_size: 100, start_cursor: cursor } : { page_size: 100 };
      const response = await notion.request({
        method: 'POST',
        path: `data_sources/${dbId}/query`,
        body
      });
      
      for (const page of response.results || []) {
        const props = page.properties;
        
        // Get name
        const name = props.Name?.title?.map(t => t.plain_text).join('') || 'Unknown';
        const studentId = props.ID?.unique_id?.number || page.id;
        
        // Get all multi-select fields
        const tags = {
          practiceSeries: [],
          weaknesses: [],
          toImprove: [],
          strength: []
        };
        
        for (const [key, value] of Object.entries(props)) {
          if (value.type === 'multi_select' && value.multi_select.length > 0) {
            const names = value.multi_select.map(s => s.name);
            if (key === 'Practice series') tags.practiceSeries.push(...names);
            else if (key === 'Weaknesses') tags.weaknesses.push(...names);
            else if (key === 'To improve') tags.toImprove.push(...names);
            else if (key === 'Strength') tags.strength.push(...names);
          }
        }
        
        allStudents.push({ name, studentId, tags, notionId: page.id });
      }
      
      cursor = response.has_more ? response.next_cursor : null;
      console.log('Fetched', allStudents.length, 'students so far...');
      
    } catch (e) {
      console.log('Error fetching:', e.message);
      break;
    }
  } while (cursor);
  
  return allStudents;
}

async function importToNeo4j(students) {
  // Collect all unique tags
  const allTags = {
    PracticeSeries: new Set(),
    Weakness: new Set(),
    ToImprove: new Set(),
    Strength: new Set()
  };
  
  for (const student of students) {
    student.tags.practiceSeries.forEach(t => allTags.PracticeSeries.add(t));
    student.tags.weaknesses.forEach(t => allTags.Weakness.add(t));
    student.tags.toImprove.forEach(t => allTags.ToImprove.add(t));
    student.tags.strength.forEach(t => allTags.Strength.add(t));
  }
  
  console.log('\n=== UNIQUE TAGS ===');
  for (const [category, tags] of Object.entries(allTags)) {
    console.log(category + ':', tags.size, 'tags');
  }
  
  // Create Tag nodes and Student->Tag relationships in Neo4j
  const result = await session.run(`
    // First, clear existing TAGGED_WITH relationships (but keep existing Tag nodes)
    MATCH (s:Student)-[r:TAGGED_WITH]->(t:Tag)
    DELETE r
    RETURN count(r) as deletedRels
  `);
  console.log('\nCleared existing relationships:', result.records[0].get('deletedRels'));
  
  // Create tag nodes and link students
  let tagCount = 0;
  let relCount = 0;
  
  for (const student of students) {
    for (const tagName of student.tags.weaknesses) {
      await session.run(`
        MERGE (t:Tag {name: $tagName, category: 'Weakness'})
        WITH t
        MATCH (s:Student {notionId: $notionId})
        MERGE (s)-[:TAGGED_WITH]->(t)
      `, { tagName, notionId: student.notionId });
      relCount++;
    }
    
    for (const tagName of student.tags.practiceSeries) {
      await session.run(`
        MERGE (t:Tag {name: $tagName, category: 'PracticeSeries'})
        WITH t
        MATCH (s:Student {notionId: $notionId})
        MERGE (s)-[:TAGGED_WITH]->(t)
      `, { tagName, notionId: student.notionId });
      relCount++;
    }
    
    for (const tagName of student.tags.toImprove) {
      await session.run(`
        MERGE (t:Tag {name: $tagName, category: 'ToImprove'})
        WITH t
        MATCH (s:Student {notionId: $notionId})
        MERGE (s)-[:TAGGED_WITH]->(t)
      `, { tagName, notionId: student.notionId });
      relCount++;
    }
    
    for (const tagName of student.tags.strength) {
      await session.run(`
        MERGE (t:Tag {name: $tagName, category: 'Strength'})
        WITH t
        MATCH (s:Student {notionId: $notionId})
        MERGE (s)-[:TAGGED_WITH]->(t)
      `, { tagName, notionId: student.notionId });
      relCount++;
    }
    
    tagCount++;
    if (tagCount % 50 === 0) console.log('Processed', tagCount, 'students...');
  }
  
  console.log('\n=== IMPORT COMPLETE ===');
  console.log('Students processed:', students.length);
  console.log('Relationships created:', relCount);
  
  // Verify
  const verify = await session.run(`
    MATCH (t:Tag)<-[:TAGGED_WITH]-(s:Student)
    RETURN t.category as category, count(DISTINCT t) as tagCount, count(s) as studentCount
    ORDER BY category
  `);
  
  console.log('\n=== VERIFICATION ===');
  for (const record of verify.records) {
    console.log(record.get('category') + ':', record.get('tagCount'), 'tags,', record.get('studentCount'), 'relationships');
  }
}

async function main() {
  try {
    console.log('Fetching students from Notion...');
    const students = await getAllStudents();
    console.log('\nTotal students:', students.length);
    
    // Show sample
    console.log('\nSample students with tags:');
    students.slice(0, 3).forEach(s => {
      console.log('-', s.name, ':', [...s.tags.weaknesses, ...s.tags.practiceSeries].join(', '));
    });
    
    console.log('\nImporting to Neo4j...');
    await importToNeo4j(students);
    
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);