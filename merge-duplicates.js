
const neo4j = require('neo4j-driver');

async function mergeDuplicates() {
  const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
  const session = driver.session();
  
  try {
    // Find duplicate tasks by grouping by subject
    const findDupes = await session.run(`
      MATCH (t:Task)
      WITH t.subject as subject, collect(t) as tasks, count(*) as cnt
      WHERE cnt > 1
      RETURN subject, tasks, cnt
    `);
    
    console.log('DUPLICATE GROUPS FOUND:', findDupes.records.length);
    
    for (const record of findDupes.records) {
      const subject = record.get('subject');
      const tasks = record.get('tasks');
      const count = record.get('cnt').low;
      
      console.log(`\nSubject: "${subject}" - ${count} copies`);
      
      // Keep the first one, delete the rest
      const keep = tasks[0];
      const deleteList = tasks.slice(1);
      
      console.log(`  Keeping: ${keep.properties.id || keep.identity.low}`);
      console.log(`  Deleting: ${deleteList.length} duplicates`);
      
      for (const dupe of deleteList) {
        const id = dupe.properties.id || dupe.identity.low;
        await session.run('MATCH (t:Task) WHERE elementId(t) = $elementId DETACH DELETE t', {
          elementId: dupe.elementId
        });
        console.log(`    Deleted: ${id}`);
      }
    }
    
    // Also check for duplicate decisions
    const findDecisions = await session.run(`
      MATCH (d:Decision)
      WITH d.subject as subject, collect(d) as decisions, count(*) as cnt
      WHERE cnt > 1
      RETURN subject, decisions, cnt
    `);
    
    console.log('\nDUPLICATE DECISIONS:', findDecisions.records.length);
    
    for (const record of findDecisions.records) {
      const subject = record.get('subject');
      const decisions = record.get('decisions');
      const count = record.get('cnt').low;
      
      console.log(`Subject: "${subject}" - ${count} copies`);
      
      const keep = decisions[0];
      const deleteList = decisions.slice(1);
      
      console.log(`  Keeping: ${keep.properties.id || keep.identity.low}`);
      
      for (const dupe of deleteList) {
        await session.run('MATCH (d:Decision) WHERE elementId(d) = $elementId DETACH DELETE d', {
          elementId: dupe.elementId
        });
        console.log(`    Deleted duplicate decision`);
      }
    }
    
    // Check for duplicate context nodes
    const findContext = await session.run(`
      MATCH (c:Context)
      WITH c.name as name, collect(c) as contexts, count(*) as cnt
      WHERE cnt > 1
      RETURN name, contexts, cnt
    `);
    
    console.log('\nDUPLICATE CONTEXT:', findContext.records.length);
    
    for (const record of findContext.records) {
      const name = record.get('name');
      const contexts = record.get('contexts');
      const count = record.get('cnt').low;
      
      console.log(`Name: "${name}" - ${count} copies`);
      
      const keep = contexts[0];
      const deleteList = contexts.slice(1);
      
      console.log(`  Keeping: ${keep.properties.id || keep.identity.low}`);
      
      for (const dupe of deleteList) {
        await session.run('MATCH (c:Context) WHERE elementId(c) = $elementId DETACH DELETE c', {
          elementId: dupe.elementId
        });
        console.log(`    Deleted duplicate context`);
      }
    }
    
    console.log('\n✅ Duplicate cleanup complete');
    
  } finally {
    await session.close();
    await driver.close();
  }
}

mergeDuplicates().catch(console.error);
